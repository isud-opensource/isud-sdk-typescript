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
export declare const emptyMeta: () => ResponseMeta;
/** 所有异常的基类。 */
export declare class SdkError extends Error {
    readonly code?: string;
    readonly requestId?: string;
    readonly suggestion?: string;
    readonly retryable: boolean;
    readonly meta: ResponseMeta;
    readonly statusCode?: number;
    constructor(message: string, opts?: {
        code?: string;
        requestId?: string;
        suggestion?: string;
        retryable?: boolean;
        meta?: ResponseMeta;
        statusCode?: number;
        defaultRetryable?: boolean;
    });
    /** 给示例/终端用的完整友好提示（不裸 stack）。 */
    friendly(): string;
}
/** 8889 / 401：密钥问题。不可重试。 */
export declare class AuthenticationError extends SdkError {
    constructor(message: string, opts?: ConstructorParameters<typeof SdkError>[1]);
}
/** 9002/9003 / 429 限流，携带 retryAfter 秒数。 */
export declare class RateLimitError extends SdkError {
    retryAfter?: number;
    constructor(message: string, opts?: ConstructorParameters<typeof SdkError>[1] & {
        retryAfter?: number;
    });
}
/** 9001 参数错误。不可重试，带 suggestion。 */
export declare class ValidationError extends SdkError {
    constructor(message: string, opts?: ConstructorParameters<typeof SdkError>[1]);
}
/** 0002 数据源未接入/类型未开放。不可重试，不扣点。 */
export declare class CapabilityError extends SdkError {
    constructor(message: string, opts?: ConstructorParameters<typeof SdkError>[1]);
}
/** 0001 通用业务错误。retryable 由信封字段决定。 */
export declare class ApiError extends SdkError {
}
/** 超时/连接失败/5xx。可重试。 */
export declare class NetworkError extends SdkError {
    constructor(message: string, opts?: ConstructorParameters<typeof SdkError>[1]);
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
export declare function raiseForEnvelope(env: EnvelopeLike, ctx: {
    httpStatus: number;
    meta: ResponseMeta;
}): void;
export declare const ERROR_CODE_MAP: Record<string, new (m: string, o?: object) => SdkError>;
//# sourceMappingURL=errors.d.ts.map