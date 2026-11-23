/**
 * 异常体系 —— 错误码/HTTP 状态码到异常类的映射。
 * 与 Python SDK 严格对齐，见 SDK-DESIGN.md §3。
 */

/** 每次调用都解析的响应元数据（扣点/追踪/限流），成功失败都有。 */
export interface ResponseMeta {
  /** 本次调用的追踪 ID。 */
  requestId?: string;
  /** 本次调用扣减的点数。 */
  creditsCharged?: number;
  /** 调用后剩余点数。 */
  creditsRemaining?: number;
  /** 限流阈值（每分钟调用数）。 */
  rateLimit?: number;
  /** 当前窗口剩余可调用次数。 */
  rateRemaining?: number;
  /** 本次结果是否来自幂等键重放。 */
  idempotentReplay: boolean;
  /** 响应的 HTTP 状态码。 */
  httpStatus?: number;
}

/** 构造一份空的响应元数据（未发生调用时的初始值）。 */
export const emptyMeta = (): ResponseMeta => ({ idempotentReplay: false });

/** 所有异常的基类。 */
export class SdkError extends Error {
  /** 业务错误码。 */
  readonly code?: string;
  /** 本次调用的追踪 ID。 */
  readonly requestId?: string;
  /** 针对该错误的改进建议。 */
  readonly suggestion?: string;
  /** 该错误是否可重试。 */
  readonly retryable: boolean;
  /** 响应元数据（扣点 / 限流 / 追踪）。 */
  readonly meta: ResponseMeta;
  /** 对应的 HTTP 状态码。 */
  readonly statusCode?: number;

  /** 创建异常实例。 */
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
  /** 建议的重试等待秒数（来自 Retry-After 头或信封）。 */
  retryAfter?: number;
  /** 创建限流异常。 */
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

/** 开放 API 统一响应信封的最小结构，供异常映射使用。 */
export interface EnvelopeLike {
  /** 业务错误码，`0000` 表示成功。 */
  code?: string;
  /** 错误或提示信息。 */
  msg?: string;
  /** 业务数据载荷。 */
  data?: unknown;
  /** 本次调用的追踪 ID。 */
  requestId?: string;
  /** 针对错误的改进建议。 */
  suggestion?: string;
  /** 服务端标记该错误是否可重试。 */
  retryable?: boolean;
  /** 限流时建议的重试等待秒数。 */
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

/** 业务错误码到异常构造器的映射表。 */
export const ERROR_CODE_MAP: Record<string, new (m: string, o?: object) => SdkError> = {
  "8889": AuthenticationError,
  "9001": ValidationError,
  "9002": RateLimitError,
  "9003": RateLimitError,
  "0002": CapabilityError,
  "0001": ApiError,
};
