"use strict";
/** 优标宝商标数据开放 API TypeScript SDK 入口。 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VERSION = exports.exponentialBackoff = exports.parseRetryAfter = exports.raiseForEnvelope = exports.NetworkError = exports.ApiError = exports.CapabilityError = exports.ValidationError = exports.RateLimitError = exports.AuthenticationError = exports.SdkError = exports.MCP_BASE_URL = exports.DEFAULT_BASE_URL = exports.Client = void 0;
var client_js_1 = require("./client.js");
Object.defineProperty(exports, "Client", { enumerable: true, get: function () { return client_js_1.Client; } });
Object.defineProperty(exports, "DEFAULT_BASE_URL", { enumerable: true, get: function () { return client_js_1.DEFAULT_BASE_URL; } });
Object.defineProperty(exports, "MCP_BASE_URL", { enumerable: true, get: function () { return client_js_1.MCP_BASE_URL; } });
var errors_js_1 = require("./errors.js");
Object.defineProperty(exports, "SdkError", { enumerable: true, get: function () { return errors_js_1.SdkError; } });
Object.defineProperty(exports, "AuthenticationError", { enumerable: true, get: function () { return errors_js_1.AuthenticationError; } });
Object.defineProperty(exports, "RateLimitError", { enumerable: true, get: function () { return errors_js_1.RateLimitError; } });
Object.defineProperty(exports, "ValidationError", { enumerable: true, get: function () { return errors_js_1.ValidationError; } });
Object.defineProperty(exports, "CapabilityError", { enumerable: true, get: function () { return errors_js_1.CapabilityError; } });
Object.defineProperty(exports, "ApiError", { enumerable: true, get: function () { return errors_js_1.ApiError; } });
Object.defineProperty(exports, "NetworkError", { enumerable: true, get: function () { return errors_js_1.NetworkError; } });
Object.defineProperty(exports, "raiseForEnvelope", { enumerable: true, get: function () { return errors_js_1.raiseForEnvelope; } });
var retry_js_1 = require("./retry.js");
Object.defineProperty(exports, "parseRetryAfter", { enumerable: true, get: function () { return retry_js_1.parseRetryAfter; } });
Object.defineProperty(exports, "exponentialBackoff", { enumerable: true, get: function () { return retry_js_1.exponentialBackoff; } });
__exportStar(require("./helpers.js"), exports);
exports.VERSION = "1.0.3";
//# sourceMappingURL=index.js.map