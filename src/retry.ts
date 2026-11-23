/**
 * Retry-After 退避策略 —— 与 Python SDK 行为对齐，见 SDK-DESIGN.md §4。
 */

import { SdkError, RateLimitError, NetworkError } from "./errors.js";

/** 单次重试等待的封顶秒数。 */
export const MAX_WAIT_SECONDS = 60;
const BASE_BACKOFF = 1;
const MAX_BACKOFF = 30;

/**
 * 解析 Retry-After 头：整数秒 或 HTTP-date。
 * @returns 需等待的秒数；无法解析时返回 `null`。
 */
export function parseRetryAfter(value: string | null | undefined): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  const t = Date.parse(v);
  if (!Number.isNaN(t)) return Math.max(0, Math.floor((t - Date.now()) / 1000));
  return null;
}

/**
 * 指数退避秒数，带抖动防惊群。
 * @param attempt 当前重试次数（从 0 开始）。
 * @param jitter 是否加入随机抖动，默认开启。
 */
export function exponentialBackoff(attempt: number, jitter = true): number {
  let raw = Math.min(BASE_BACKOFF * 2 ** attempt, MAX_BACKOFF);
  if (jitter) raw = raw * (0.5 + Math.random() * 0.5);
  return raw;
}

/**
 * 计算异常后的重试等待秒数：限流优先用 `retryAfter`，否则指数退避，最后封顶。
 * @param exc 捕获到的 SDK 异常。
 * @param attempt 当前重试次数。
 * @param maxWait 等待上限秒数。
 */
export function resolveWait(exc: SdkError, attempt: number, maxWait = MAX_WAIT_SECONDS): number {
  let wait: number;
  if (exc instanceof RateLimitError && exc.retryAfter != null) {
    wait = exc.retryAfter;
  } else {
    wait = exponentialBackoff(attempt);
  }
  return Math.max(0, Math.min(wait, maxWait));
}

/** {@link withRetry} 的重试策略配置。 */
export interface RetryOptions {
  /** 最大重试次数。 */
  maxRetries: number;
  /** 判定某个异常是否应重试。 */
  shouldRetry: (exc: SdkError) => boolean;
  /** 自定义等待实现（测试可注入），默认 `setTimeout`。 */
  sleep?: (seconds: number) => Promise<void>;
  /** 每次重试前的回调，用于观测退避。 */
  onRetry?: (exc: SdkError, attempt: number, wait: number) => void;
}

const defaultSleep = (s: number) => new Promise<void>((r) => setTimeout(r, s * 1000));

/**
 * 通用重试执行器：捕获 SDK 异常，按策略退避后重试，直至成功或放弃。
 * 非 SDK 异常原样抛出。
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof SdkError)) throw err;
      if (attempt >= opts.maxRetries || !err.retryable || !opts.shouldRetry(err)) throw err;
      const wait = resolveWait(err, attempt);
      opts.onRetry?.(err, attempt + 1, wait);
      await sleep(wait);
      attempt += 1;
    }
  }
}

// 让 NetworkError 参与类型收窄的显式引用（避免 tree-shaking 误判未使用）
/** 网络/5xx 异常类（从 errors 重导出，便于类型收窄）。 */
export { NetworkError };
