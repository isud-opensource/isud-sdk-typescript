/**
 * 异常体系 —— 错误码/HTTP 状态码到异常类的映射。
 * 与 Python SDK 严格对齐，见 SDK-DESIGN.md §3。
 */

/** 每次调用都解析的响应元数据（扣点/追踪/限流），成功失败都有。 */
export interface ResponseMeta {
  requestId?: string;
  creditsCharged?: number;
  creditsRemaining?: number;
  rateLimit?: number;
  rateRemaining?: number;
  idempotentReplay: boolean;
  httpStatus?: number;
}

export const emptyMeta = (): ResponseMeta => ({ idempotentReplay: false });

/** 所有异常的基类。 */
export class SdkError extends Error {
  readonly code?: string;
  readonly requestId?: string;
  readonly suggestion?: string;
  readonly retryable: boolean;
  readonly meta: ResponseMeta;
  readonly statusCode?: number;

  constructor(
    message: string,
    opts: {
      code?: string;
      requestId?: string;
      suggestion?: string;
      retryable?: boolean;
      meta?: ResponseMeta;
      statusCode?: number;
      defaultRetryable?: boolean;
    } = {}
  ) {
    super(message);
    this.name = new.target.name;
    this.code = opts.code;
    this.requestId = opts.requestId;
    this.suggestion = opts.suggestion;
    this.retryable = opts.retryable ?? opts.defaultRetryable ?? false;
    this.meta = opts.meta ?? emptyMeta();
    this.statusCode = opts.statusCode;
  }

  /** 给示例/终端用的完整友好提示（不裸 stack）。 */
  friendly(): string {
    const lines = [`✗ ${this.message}`];
    if (this.code) lines.push(`  错误码: ${this.code}`);
    if (this.suggestion) lines.push(`  建议: ${this.suggestion}`);
    if (this.requestId) lines.push(`  追踪ID: ${this.requestId}（报障时提供）`);
    if (this.meta.creditsCharged !== undefined)
      lines.push(`  本次扣点: ${this.meta.creditsCharged}`);
    return lines.join("\n");
  }
}

/** 8889 / 401：密钥问题。不可重试。 */
export class AuthenticationError extends SdkError {
  constructor(message: string, opts: ConstructorParameters<typeof SdkError>[1] = {}) {
    super(message, { ...opts, defaultRetryable: false });
  }
}

/** 9002/9003 / 429 限流，携带 retryAfter 秒数。 */
export class RateLimitError extends SdkError {
  retryAfter?: number;
  constructor(
    message: string,
    opts: ConstructorParameters<typeof SdkError>[1] & { retryAfter?: number } = {}
  ) {
    super(message, { ...opts, defaultRetryable: true });
    this.retryAfter = opts.retryAfter;
  }
}

/** 9001 参数错误。不可重试，带 suggestion。 */
export class ValidationError extends SdkError {
  constructor(message: string, opts: ConstructorParameters<typeof SdkError>[1] = {}) {
    super(message, { ...opts, defaultRetryable: false });
  }
}

/** 0002 数据源未接入/类型未开放。不可重试，不扣点。 */
export class CapabilityError extends SdkError {
  constructor(message: string, opts: ConstructorParameters<typeof SdkError>[1] = {}) {
    super(message, { ...opts, defaultRetryable: false });
  }
}

/** 0001 通用业务错误。retryable 由信封字段决定。 */
export class ApiError extends SdkError {}

/** 超时/连接失败/5xx。可重试。 */
export class NetworkError extends SdkError {
  constructor(message: string, opts: ConstructorParameters<typeof SdkError>[1] = {}) {
    super(message, { ...opts, defaultRetryable: true });
  }
}

export interface EnvelopeLike {
  code?: string;
  msg?: string;
  data?: unknown;
  requestId?: string;
  suggestion?: string;
  retryable?: boolean;
  retryAfter?: number;
}

/** 根据信封 + HTTP 状态码抛出对应异常。成功（0000）时静默返回。 */
export function raiseForEnvelope(
  env: EnvelopeLike,
  ctx: { httpStatus: number; meta: ResponseMeta }
): void {
  const code = String(env.code ?? "");
  const msg = env.msg || "请求失败";
  const common = {
    code,
    requestId: env.requestId ?? ctx.meta.requestId,
    suggestion: env.suggestion,
    retryable: env.retryable,
    meta: ctx.meta,
    statusCode: ctx.httpStatus,
  };
  if (code === "0000") return;
  if (ctx.httpStatus === 401 || code === "8889") throw new AuthenticationError(msg, common);
  if (ctx.httpStatus === 429 || code === "9002" || code === "9003") {
    throw new RateLimitError(msg, {
      ...common,
      retryAfter: typeof env.retryAfter === "number" ? env.retryAfter : undefined,
    });
  }
  switch (code) {
    case "9001": throw new ValidationError(msg, common);
    case "0002": throw new CapabilityError(msg, common);
    default: throw new ApiError(msg, common);
  }
}

export const ERROR_CODE_MAP: Record<string, new (m: string, o?: object) => SdkError> = {
  "8889": AuthenticationError,
  "9001": ValidationError,
  "9002": RateLimitError,
  "9003": RateLimitError,
  "0002": CapabilityError,
  "0001": ApiError,
};
