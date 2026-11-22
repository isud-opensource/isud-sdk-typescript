/**
 * 优标宝开放 API TypeScript 客户端 —— 零运行时依赖（原生 fetch）。
 * 生成层在 schema.d.ts（勿手改），本文件实现 SDK-DESIGN.md 的全部体验。
 */
import type { components } from "./schema.js";
import { ResponseMeta } from "./errors.js";
export declare const DEFAULT_BASE_URL = "https://app.isud.cn/api/v1/open";
export declare const MCP_BASE_URL = "https://app.isud.cn/api/v1";
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
export declare class Client {
    readonly baseUrl: string;
    readonly maxRetries: number;
    private readonly apiKey;
    private readonly timeout;
    private readonly fetchFn;
    lastMeta: ResponseMeta;
    constructor(opts?: ClientOptions);
    private buildMeta;
    private request;
    private checkSize;
    searchTrademarks(body: {
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
    }, idempotencyKey?: string): Promise<TrademarkSearchResult>;
    searchDesigns(body: {
        jurisdictionCode: string;
        keyword: string;
        locarnoClasses?: string[];
        status?: string[];
        owner?: string;
        saveReport?: boolean;
        reportTitle?: string;
    }, idempotencyKey?: string): Promise<unknown>;
    listTrademarks(params?: {
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
    }): Promise<{
        current: number;
        size: number;
        total: number;
        records: TrademarkItem[];
    }>;
    /** 自动翻页迭代商标档案。 */
    listTrademarksAll(filters?: Parameters<Client["listTrademarks"]>[0], size?: number, maxPages?: number): AsyncGenerator<TrademarkItem>;
    listReports(current?: number, size?: number): Promise<unknown>;
    getWorkbenchStats(): Promise<WorkbenchStats>;
    getUsage(): Promise<OpenApiUsage>;
    queryRequestLog(requestId: string): Promise<RequestLogItem | null>;
    queryVienna(params?: Record<string, string | number | boolean | undefined>): Promise<unknown>;
    queryGazette(params?: Record<string, string | number | boolean | undefined>): Promise<unknown>;
    queryReview(params?: Record<string, string | number | boolean | undefined>): Promise<unknown>;
    queryIpr(params?: Record<string, string | number | boolean | undefined>): Promise<unknown>;
    getMcpHealth(): Promise<{
        status: string;
        toolCount: number;
    }>;
    callMcp(method: string, params?: Record<string, unknown>, id?: number): Promise<unknown>;
}
export {};
//# sourceMappingURL=client.d.ts.map