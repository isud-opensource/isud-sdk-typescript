/**
 * Retry-After 退避策略 —— 与 Python SDK 行为对齐，见 SDK-DESIGN.md §4。
 */
import { SdkError, NetworkError } from "./errors.js";
export declare const MAX_WAIT_SECONDS = 60;
/** 解析 Retry-After 头：整数秒 或 HTTP-date。 */
export declare function parseRetryAfter(value: string | null | undefined): number | null;
/** 指数退避秒数，带抖动防惊群。 */
export declare function exponentialBackoff(attempt: number, jitter?: boolean): number;
export declare function resolveWait(exc: SdkError, attempt: number, maxWait?: number): number;
export interface RetryOptions {
    maxRetries: number;
    shouldRetry: (exc: SdkError) => boolean;
    sleep?: (seconds: number) => Promise<void>;
    onRetry?: (exc: SdkError, attempt: number, wait: number) => void;
}
/** 通用重试执行器（异步）。 */
export declare function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T>;
export { NetworkError };
//# sourceMappingURL=retry.d.ts.map