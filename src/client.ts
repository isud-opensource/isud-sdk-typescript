/**
 * 优标宝开放 API TypeScript 客户端 —— 零运行时依赖（原生 fetch）。
 * 生成层在 schema.d.ts（勿手改），本文件实现 SDK-DESIGN.md 的全部体验。
 */

import type { paths, components } from "./schema.js";
import {
  SdkError,
  ApiError,
  RateLimitError,
  ValidationError,
  NetworkError,
  ResponseMeta,
  emptyMeta,
  raiseForEnvelope,
  type EnvelopeLike,
} from "./errors.js";
import { parseRetryAfter, withRetry } from "./retry.js";

/** 开放 API 默认基地址（`/api/v1/open`）。 */
export const DEFAULT_BASE_URL = "https://app.isud.cn/api/v1/open";
/** MCP JSON-RPC 主端点基地址（`/api/v1`）。 */
export const MCP_BASE_URL = "https://app.isud.cn/api/v1";

type Schemas = components["schemas"];
/** 单条商标档案记录。 */
export type TrademarkItem = Schemas["TrademarkItem"];
/** 点数余额与用量统计。 */
export type OpenApiUsage = Schemas["OpenApiUsage"];
/** 商标检索与冲突判定结果，含 conclusion 与 summary。 */
export type TrademarkSearchResult = Schemas["TrademarkSearchResult"];
/** 单次调用的请求日志条目。 */
export type RequestLogItem = Schemas["RequestLogItem"];
/** 工作台汇总统计数据。 */
export type WorkbenchStats = Schemas["WorkbenchStats"];

/** 构造 {@link Client} 的可选配置。 */
export interface ClientOptions {
  /** API 密钥；省略时自动读取环境变量 `ISUD_API_KEY`。 */
  apiKey?: string;
  /** 自定义 API 基地址；默认 {@link DEFAULT_BASE_URL}。 */
  baseUrl?: string;
  /** 单次请求超时（毫秒）。 */
  timeout?: number;
  /** 可重试错误的最大重试次数。 */
  maxRetries?: number;
  /** 测试注入；签名与全局 fetch 一致。 */
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

/**
 * 优标宝开放 API 客户端。
 *
 * 零运行时依赖，基于原生 `fetch`；所有方法自动附带 API Key、解析统一信封、
 * 处理 429/Retry-After 退避，并在 `lastMeta` 回读本次扣点与追踪 ID。
 *
 * @example
 * ```ts
 * const client = new Client(); // 读取 ISUD_API_KEY
 * const r = await client.searchTrademarks({ jurisdictionCode: "CN", keyword: "优标宝" });
 * console.log(r.conclusion, client.lastMeta.creditsCharged);
 * ```
 */
export class Client {
  /** 当前生效的 API 基地址。 */
  readonly baseUrl: string;
  /** 当前生效的最大重试次数。 */
  readonly maxRetries: number;
  private readonly apiKey: string;
  private readonly timeout: number;
  private readonly fetchFn: typeof globalThis.fetch;
  /** 最近一次调用的响应元数据（追踪 ID / 扣点 / 限流 / 幂等重放）。 */
  lastMeta: ResponseMeta = emptyMeta();

  /** 创建客户端；配置项见 {@link ClientOptions}。 */
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
      "User-Agent": "isud-tm-ts/1.0.3",
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
          // 已拿到 HTTP 响应（服务端返回的 4xx/5xx）归 ApiError；
          // 真正的 fetch 失败在上面 catch 分支仍是 NetworkError。
          throw new ApiError(`HTTP ${res.status}: ${text.slice(0, 200)}`, {
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
  /**
   * 商标检索与冲突判定（10 点）。自动附带幂等键，429 时按 Retry-After 退避。
   * @param body 检索条件；`jurisdictionCode` 必填，`keyword`/`owner` 至少一项。
   * @param idempotencyKey 自定义幂等键；省略时自动生成。
   */
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

  /**
   * 外观设计检索（10 点）。按关键词与洛迦诺分类查找外观设计。
   * @param body 检索条件；`jurisdictionCode` 与 `keyword` 必填。
   * @param idempotencyKey 自定义幂等键；省略时自动生成。
   */
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

  /**
   * 商标档案分页列表（读类 1 点）。支持关键词、状态、尼斯类等多维筛选。
   * @param params 筛选与分页条件，默认返回第一页。
   */
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

  /**
   * 自动翻页迭代商标档案，逐条 yield，直到取完或到达 `maxPages`。
   * @param filters 与 {@link Client.listTrademarks} 相同的筛选条件。
   * @param size 每页条数（1~100）。
   * @param maxPages 最多翻多少页；省略则翻到结束。
   */
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

  /** 排查报告分页列表（读类 1 点）。 */
  async listReports(current = 1, size = 10): Promise<unknown> {
    this.checkSize(size);
    return this.request("GET", "/ip/report/list", { params: { current, size } });
  }

  /** 工作台汇总统计（读类 1 点）。 */
  async getWorkbenchStats(): Promise<WorkbenchStats> {
    return (await this.request("GET", "/ip/workbench/stats")) as WorkbenchStats;
  }

  /** 查询点数余额与用量明细（读类 1 点）。 */
  async getUsage(): Promise<OpenApiUsage> {
    return (await this.request("GET", "/ip/usage")) as OpenApiUsage;
  }

  /**
   * 按追踪 ID 回查单次调用的请求日志（读类 1 点）。
   * @param requestId 调用返回的 `requestId`，长度 1~64。
   */
  async queryRequestLog(requestId: string): Promise<RequestLogItem | null> {
    if (!requestId || requestId.length > 64)
      throw new ValidationError("requestId 必须为 1~64 字符。");
    return (await this.request("GET", "/ip/requests", { params: { requestId } })) as RequestLogItem | null;
  }

  // ---- 数据能力：图形检索 / 商标公告 / 评审文书 / 海关备案（GET，读类 1 点）----
  // 返回 data 原始 JSON，结构随 mode 变化，调用方按传入的 mode 解析。
  /**
   * 图形检索：维也纳 VCL10 分类、关键词换码、分类树、以图搜图（读类 1 点）。
   * @param params 由 `mode` 决定的查询参数，返回 `data` 原始 JSON。
   */
  async queryVienna(params: Record<string, string | number | boolean | undefined> = {}): Promise<unknown> {
    return this.request("GET", "/ip/vienna/query", { params });
  }

  /**
   * 商标公告查询：CN 公告明细与期号、全球多局事件（读类 1 点）。
   * @param params 由 `mode` 决定的查询参数，返回 `data` 原始 JSON。
   */
  async queryGazette(params: Record<string, string | number | boolean | undefined> = {}): Promise<unknown> {
    return this.request("GET", "/ip/gazette/query", { params });
  }

  /**
   * 评审文书查询：CNIPA 裁定书（读类 1 点）。
   * @param params 由 `mode` 决定的查询参数，返回 `data` 原始 JSON。
   */
  async queryReview(params: Record<string, string | number | boolean | undefined> = {}): Promise<unknown> {
    return this.request("GET", "/ip/review/query", { params });
  }

  /**
   * 海关备案查询（读类 1 点，可选接入）。
   * @param params 由 `mode` 决定的查询参数，返回 `data` 原始 JSON。
   */
  async queryIpr(params: Record<string, string | number | boolean | undefined> = {}): Promise<unknown> {
    return this.request("GET", "/ip/ipr/query", { params });
  }

  /** MCP 服务探活，返回服务状态与可用工具数（不解析信封，不扣点）。 */
  async getMcpHealth(): Promise<{ status: string; toolCount: number }> {
    // /mcp/health 在 openapi 规范中未覆盖 servers，继承全局 /api/v1/open；
    // 只有 MCP JSON-RPC 主端点 /mcp 挂在 /api/v1（见 callMcp）。
    // 这里不传 baseUrl，走默认 DEFAULT_BASE_URL（/api/v1/open）。
    return (await this.request("GET", "/mcp/health", {
      retries: 0, envelope: false,
    })) as { status: string; toolCount: number };
  }

  /**
   * 调用 MCP JSON-RPC 主端点（不解析信封，不扣点）。
   * @param method JSON-RPC 方法名。
   * @param params 方法参数。
   * @param id 请求 ID，默认 1。
   */
  async callMcp(method: string, params?: Record<string, unknown>, id = 1): Promise<unknown> {
    return this.request("POST", "/mcp", {
      body: { jsonrpc: "2.0", method, id, ...(params ? { params } : {}) },
      baseUrl: MCP_BASE_URL, retries: 0, envelope: false,
    });
  }
}
