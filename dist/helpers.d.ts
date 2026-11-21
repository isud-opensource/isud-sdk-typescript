/** 结果展示与导出 helper —— 与 Python SDK extras 对齐，示例直接复用。 */
import type { TrademarkSearchResult } from "./client.js";
export declare function formatDateMs(ms?: number | null): string;
export declare function riskSummary(data?: Partial<TrademarkSearchResult> | null): string;
export declare function formatSearchResult(data?: Partial<TrademarkSearchResult> | null, limit?: number): string;
export declare function toCsv(rows: Record<string, unknown>[], columns?: string[]): string;
//# sourceMappingURL=helpers.d.ts.map