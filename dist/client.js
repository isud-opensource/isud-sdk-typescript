/**
 * 优标宝开放 API TypeScript 客户端 —— 零运行时依赖（原生 fetch）。
 * 生成层在 schema.d.ts（勿手改），本文件实现 SDK-DESIGN.md 的全部体验。
 */
import { RateLimitError, ValidationError, NetworkError, emptyMeta, raiseForEnvelope, } from "./errors.js";
import { parseRetryAfter, withRetry } from "./retry.js";
export const DEFAULT_BASE_URL = "https://app.isud.cn/api/v1/open";
export const MCP_BASE_URL = "https://app.isud.cn/api/v1";
function readInt(v) {
    if (v == null)
        return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}
/** 跨平台读环境变量，不硬依赖 Node 类型定义（浏览器环境安全）。 */
function readEnvKey() {
    const g = globalThis;
    return g.process?.env?.ISUD_API_KEY;
}
/** 幂等键生成：优先 crypto.randomUUID，回退随机串。 */
function newIdempotencyKey() {
    const c = globalThis.crypto;
    if (c?.randomUUID)
        return c.randomUUID().replace(/-/g, "");
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}
export class Client {
    baseUrl;
    maxRetries;
    apiKey;
    timeout;
    fetchFn;
    lastMeta = emptyMeta();
    constructor(opts = {}) {
        const key = opts.apiKey ?? readEnvKey();
        if (!key) {
            throw new ValidationError("缺少 API 密钥：请传入 apiKey 或设置环境变量 ISUD_API_KEY。密钥在控制台创建（注册即送调用次数）。");
        }
        this.apiKey = key;
        this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
        this.timeout = opts.timeout ?? 30_000;
        this.maxRetries = opts.maxRetries ?? 3;
        this.fetchFn = opts.fetch ?? globalThis.fetch;
    }
    buildMeta(res, env) {
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
    async request(method, path, opts = {}) {
        const root = (opts.baseUrl ?? this.baseUrl).replace(/\/$/, "");
        const url = new URL(root + path);
        if (opts.params) {
            for (const [k, v] of Object.entries(opts.params)) {
                if (v !== undefined)
                    url.searchParams.set(k, String(v));
            }
        }
        const attempts = opts.retries ?? this.maxRetries;
        const headers = {
            "X-API-Key": this.apiKey,
            Accept: "application/json",
            "User-Agent": "isud-tm-ts/1.0.1",
        };
        if (opts.body !== undefined)
            headers["Content-Type"] = "application/json";
        if (opts.idempotent) {
            const key = opts.idempotencyKey ?? newIdempotencyKey();
            if (key.length < 1 || key.length > 128)
                throw new ValidationError("幂等键长度必须在 1~128 字符之间。");
            headers["Idempotency-Key"] = key;
        }
        const doOnce = async () => {
            let res;
            try {
                res = await this.fetchFn(url.toString(), {
                    method,
                    headers,
                    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
                    signal: AbortSignal.timeout?.(this.timeout),
                });
            }
            catch (err) {
                throw new NetworkError(`网络请求失败: ${err.message}`);
            }
            let payload;
            const text = await res.text();
            try {
                payload = text ? JSON.parse(text) : {};
            }
            catch {
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
            const env = (payload && typeof payload === "object" ? payload : {});
            const meta = this.buildMeta(res, env);
            this.lastMeta = meta;
            try {
                raiseForEnvelope(env, { httpStatus: res.status, meta });
            }
            catch (err) {
                if (err instanceof RateLimitError && err.retryAfter == null) {
                    const ra = parseRetryAfter(res.headers.get("retry-after"));
                    if (ra != null)
                        err.retryAfter = ra;
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
    checkSize(size) {
        if (!Number.isInteger(size) || size < 1 || size > 100)
            throw new ValidationError(`size 必须在 1~100 之间（收到 ${size}）。`);
    }
    // ---------------------------------------------------------------- 9 端点
    async searchTrademarks(body, idempotencyKey) {
        if (body.size != null)
            this.checkSize(body.size);
        if (!body.keyword && !body.owner)
            throw new ValidationError("keyword 与 owner 至少提供一项。");
        return (await this.request("POST", "/ip/trademark/search", {
            body, idempotent: true, idempotencyKey,
        }));
    }
    async searchDesigns(body, idempotencyKey) {
        return this.request("POST", "/ip/design/search", {
            body, idempotent: true, idempotencyKey,
        });
    }
    async listTrademarks(params = {}) {
        if (params.size != null)
            this.checkSize(params.size);
        return (await this.request("GET", "/ip/trademark/list", { params }));
    }
    /** 自动翻页迭代商标档案。 */
    async *listTrademarksAll(filters = {}, size = 50, maxPages) {
        this.checkSize(size);
        let page = 1;
        let pages = 0;
        while (true) {
            if (maxPages != null && pages >= maxPages)
                return;
            const result = await this.listTrademarks({ ...filters, current: page, size });
            const records = result?.records ?? [];
            for (const r of records)
                yield r;
            pages += 1;
            const total = result?.total ?? 0;
            const totalPages = Math.ceil(total / size);
            if (records.length === 0 || page >= totalPages)
                return;
            page += 1;
        }
    }
    async listReports(current = 1, size = 10) {
        this.checkSize(size);
        return this.request("GET", "/ip/report/list", { params: { current, size } });
    }
    async getWorkbenchStats() {
        return (await this.request("GET", "/ip/workbench/stats"));
    }
    async getUsage() {
        return (await this.request("GET", "/ip/usage"));
    }
    async queryRequestLog(requestId) {
        if (!requestId || requestId.length > 64)
            throw new ValidationError("requestId 必须为 1~64 字符。");
        return (await this.request("GET", "/ip/requests", { params: { requestId } }));
    }
    async getMcpHealth() {
        return (await this.request("GET", "/mcp/health", {
            baseUrl: MCP_BASE_URL, retries: 0, envelope: false,
        }));
    }
    async callMcp(method, params, id = 1) {
        return this.request("POST", "/mcp", {
            body: { jsonrpc: "2.0", method, id, ...(params ? { params } : {}) },
            baseUrl: MCP_BASE_URL, retries: 0, envelope: false,
        });
    }
}
//# sourceMappingURL=client.js.map