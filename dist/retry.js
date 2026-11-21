/**
 * Retry-After 退避策略 —— 与 Python SDK 行为对齐，见 SDK-DESIGN.md §4。
 */
import { SdkError, RateLimitError, NetworkError } from "./errors.js";
export const MAX_WAIT_SECONDS = 60;
const BASE_BACKOFF = 1;
const MAX_BACKOFF = 30;
/** 解析 Retry-After 头：整数秒 或 HTTP-date。 */
export function parseRetryAfter(value) {
    if (!value)
        return null;
    const v = value.trim();
    if (/^\d+$/.test(v))
        return parseInt(v, 10);
    const t = Date.parse(v);
    if (!Number.isNaN(t))
        return Math.max(0, Math.floor((t - Date.now()) / 1000));
    return null;
}
/** 指数退避秒数，带抖动防惊群。 */
export function exponentialBackoff(attempt, jitter = true) {
    let raw = Math.min(BASE_BACKOFF * 2 ** attempt, MAX_BACKOFF);
    if (jitter)
        raw = raw * (0.5 + Math.random() * 0.5);
    return raw;
}
export function resolveWait(exc, attempt, maxWait = MAX_WAIT_SECONDS) {
    let wait;
    if (exc instanceof RateLimitError && exc.retryAfter != null) {
        wait = exc.retryAfter;
    }
    else {
        wait = exponentialBackoff(attempt);
    }
    return Math.max(0, Math.min(wait, maxWait));
}
const defaultSleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
/** 通用重试执行器（异步）。 */
export async function withRetry(fn, opts) {
    const sleep = opts.sleep ?? defaultSleep;
    let attempt = 0;
    while (true) {
        try {
            return await fn();
        }
        catch (err) {
            if (!(err instanceof SdkError))
                throw err;
            if (attempt >= opts.maxRetries || !err.retryable || !opts.shouldRetry(err))
                throw err;
            const wait = resolveWait(err, attempt);
            opts.onRetry?.(err, attempt + 1, wait);
            await sleep(wait);
            attempt += 1;
        }
    }
}
// 让 NetworkError 参与类型收窄的显式引用（避免 tree-shaking 误判未使用）
export { NetworkError };
//# sourceMappingURL=retry.js.map