/**
 * 优标宝开放 API TypeScript 客户端 —— 零运行时依赖（原生 fetch）。
 * 生成层在 schema.d.ts（勿手改），本文件实现 SDK-DESIGN.md 的全部体验。
 */

import type { paths, components } from "./schema.js";
import {
  SdkError,
  RateLimitError,
  ValidationError,
  NetworkError,
  ResponseMeta,
  emptyMeta,
  raiseForEnvelope,
  type EnvelopeLike,
} from "./errors.js";
import { parseRetryAfter, withRetry } from "./retry.js";

export const DEFAULT_BASE_URL = "https://app.isud.cn/api/v1/open";
export const MCP_BASE_URL = "https://app.isud.cn/api/v1";

type Schemas = components["schemas"];
export type TrademarkItem = Schemas["TrademarkItem"];
export type OpenApiUsage = Schemas["OpenApiUsage"];
export type TrademarkSearchResult = Schemas["TrademarkSearchResult"];
export type RequestLogItem = Schemas["RequestLogItem"];
export type WorkbenchStats = Schemas["WorkbenchStats"];

export interface ClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  /** 测试注入；签名与全局 fetch 一致 */
  fetch?: typeof globalThis.fetch;
}

function readInt(v: string | null): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** 跨平台读环境变量，不硬依赖 Node 类型定义（浏览器环境安全）。 */
function readEnvKey(): string | undefined {
  const g = globalThis as {
    process?: { env?: Record<string, string | undefined> };
  };
  return g.process?.env?.ISUD_API_KEY;
}

/** 幂等键生成：优先 crypto.randomUUID，回退随机串。 */
function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "");
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

export class Client {
  readonly baseUrl: string;
  readonly maxRetries: number;
  private readonly apiKey: string;
  private readonly timeout: number;
  private readonly fetchFn: typeof globalThis.fetch;
  lastMeta: ResponseMeta = emptyMeta();

  constructor(opts: ClientOptions = {}) {
    const key = opts.apiKey ?? readEnvKey();
    if (!key) {
      throw new ValidationError(
        "缺少 API 密钥：请传入 apiKey 或设置环境变量 ISUD_API_KEY。密钥在控制台创建（注册即送调用次数）。"
      );
    }
    this.apiKey = key;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeout = opts.timeout ?? 30_000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.fetchFn = opts.fetch ?? globalThis.fetch;
  }

  private buildMeta(res: Response, env: EnvelopeLike): ResponseMeta {
    const h = res.headers;
    return {
      requestId: env.requestId ?? h.get("x-request-id") ?? undefined,
      creditsCharged: readInt(h.get("x-credits-charged")),
      creditsRemaining: readInt(h.get("x-credits-remaining")),
      rateLimit: readInt(h.get("x-ratelimit-limit")),
      rateRemaining: readInt(h.get("x-ratelimit-remaining")),
      idempotentReplay: (h.get("idempotency-replayed") ?? "").toLowerCase() === "true",
      httpStatus: res.status,
    };
  }

  private async request(
    method: string,
    path: string,
    opts: {
      params?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
      idempotent?: boolean;
      idempotencyKey?: string;
      baseUrl?: string;
      retries?: number;
      envelope?: boolean;
    } = {}
  ): Promise<unknown> {
    const root = (opts.baseUrl ?? this.baseUrl).replace(/\/$/, "");
    const url = new URL(root + path);
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    const attempts = opts.retries ?? this.maxRetries;
    const headers: Record<string, string> = {
      "X-API-Key": this.apiKey,
      Accept: "application/json",
      "User-Agent": "isud-tm-ts/1.0.0",
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.idempotent) {
      const key = opts.idempotencyKey ?? newIdempotencyKey();
      if (key.length < 1 || key.length > 128)
        throw new ValidationError("幂等键长度必须在 1~128 字符之间。");
      headers["Idempotency-Key"] = key;
    }

    const doOnce = async (): Promise<unknown> => {
      let res: Response;
      try {
        res = await this.fetchFn(url.toString(), {
          method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout?.(this.timeout),
        } as RequestInit);
      } catch (err) {
        throw new NetworkError(`网络请求失败: ${(err as Error).message}`);
      }

      let payload: unknown;
      const text = await res.text();
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { code: "0001", msg: `HTTP ${res.status} 返回了非 JSON 内容`, data: null };
      }

      if (opts.envelope === false) {
        this.lastMeta = this.buildMeta(res, {});
        if (res.status >= 400)
          throw new NetworkError(`HTTP ${res.status}: ${text.slice(0, 200)}`, {
            meta: this.lastMeta,
            statusCode: res.status,
          });
        return payload;
      }

      const env = (payload && typeof payload === "object" ? payload : {}) as EnvelopeLike;
      const meta = this.buildMeta(res, env);
      this.lastMeta = meta;
      try {
        raiseForEnvelope(env, { httpStatus: res.status, meta });
      } catch (err) {
        if (err instanceof RateLimitError && err.retryAfter == null) {
          const ra = parseRetryAfter(res.headers.get("retry-after"));
          if (ra != null) err.retryAfter = ra;
        }
        throw err;
      }
      return env.data;
    };

    const safe = method.toUpperCase() === "GET" || !!opts.idempotent;
    return withRetry(doOnce, {
      maxRetries: attempts,
      shouldRetry: () => safe,
    });
  }

  // ---------------------------------------------------------------- 本地校验
  private checkSize(size: number): void {
    if (!Number.isInteger(size) || size < 1 || size > 100)
      throw new ValidationError(`size 必须在 1~100 之间（收到 ${size}）。`);
  }

  // ---------------------------------------------------------------- 9 端点
  async searchTrademarks(body: {
    jurisdictionCode: string;
    keyword?: string;
    owner?: string;
    niceClasses?: string[];
    status?: string[];
    current?: number;
    size?: number;
    saveReport?: boolean;
    reportTitle?: string;
    intentMark?: string;
    connectorCode?: string;
  }, idempotencyKey?: string): Promise<TrademarkSearchResult> {
    if (body.size != null) this.checkSize(body.size);
    if (!body.keyword && !body.owner)
      throw new ValidationError("keyword 与 owner 至少提供一项。");
    return (await this.request("POST", "/ip/trademark/search", {
      body, idempotent: true, idempotencyKey,
    })) as TrademarkSearchResult;
  }

  async searchDesigns(body: {
    jurisdictionCode: string;
    keyword: string;
    locarnoClasses?: string[];
    status?: string[];
    owner?: string;
    saveReport?: boolean;
    reportTitle?: string;
  }, idempotencyKey?: string): Promise<unknown> {
    return this.request("POST", "/ip/design/search", {
      body, idempotent: true, idempotencyKey,
    });
  }

  async listTrademarks(params: {
    current?: number;
    size?: number;
    keyword?: string;
    markText?: string;
    ownerName?: string;
    status?: string;
    niceClass?: string;
    markType?: string;
    riskLevel?: string;
    sortBy?: string;
    isOwned?: boolean;
    isWatched?: boolean;
  } = {}): Promise<{ current: number; size: number; total: number; records: TrademarkItem[] }> {
    if (params.size != null) this.checkSize(params.size);
    return (await this.request("GET", "/ip/trademark/list", { params })) as {
      current: number; size: number; total: number; records: TrademarkItem[];
    };
  }

  /** 自动翻页迭代商标档案。 */
  async *listTrademarksAll(
    filters: Parameters<Client["listTrademarks"]>[0] = {},
    size = 50,
    maxPages?: number
  ): AsyncGenerator<TrademarkItem> {
    this.checkSize(size);
    let page = 1;
    let pages = 0;
    while (true) {
      if (maxPages != null && pages >= maxPages) return;
      const result = await this.listTrademarks({ ...filters, current: page, size });
      const records = result?.records ?? [];
      for (const r of records) yield r;
      pages += 1;
      const total = result?.total ?? 0;
      const totalPages = Math.ceil(total / size);
      if (records.length === 0 || page >= totalPages) return;
      page += 1;
    }
  }

  async listReports(current = 1, size = 10): Promise<unknown> {
    this.checkSize(size);
    return this.request("GET", "/ip/report/list", { params: { current, size } });
  }

  async getWorkbenchStats(): Promise<WorkbenchStats> {
    return (await this.request("GET", "/ip/workbench/stats")) as WorkbenchStats;
  }

  async getUsage(): Promise<OpenApiUsage> {
    return (await this.request("GET", "/ip/usage")) as OpenApiUsage;
  }

  async queryRequestLog(requestId: string): Promise<RequestLogItem | null> {
    if (!requestId || requestId.length > 64)
      throw new ValidationError("requestId 必须为 1~64 字符。");
    return (await this.request("GET", "/ip/requests", { params: { requestId } })) as RequestLogItem | null;
  }

  async getMcpHealth(): Promise<{ status: string; toolCount: number }> {
    return (await this.request("GET", "/mcp/health", {
      baseUrl: MCP_BASE_URL, retries: 0, envelope: false,
    })) as { status: string; toolCount: number };
  }

  async callMcp(method: string, params?: Record<string, unknown>, id = 1): Promise<unknown> {
    return this.request("POST", "/mcp", {
      body: { jsonrpc: "2.0", method, id, ...(params ? { params } : {}) },
      baseUrl: MCP_BASE_URL, retries: 0, envelope: false,
    });
  }
}
