# 优标宝 SDK 跨语言设计规范 (SDK-DESIGN.md)

> 适用：Python SDK / TypeScript SDK（及后续 Go / Java / PHP）。
> 本文件是**契约驱动的体验层约定**：生成层由 `openapi.yaml` 自动产出，本文件锁定的
> 是生成器做不到的「体验」部分。两语言必须逐条对齐，用户从一门切到另一门零学习成本。
>
> 契约源：`https://docs.isud.cn/openapi.yaml`（OpenAPI 3.1，9 端点，v1.0.0）

---

## 0. 设计原则（不可妥协）

1. **契约驱动**：请求/响应模型从 `openapi.yaml` 生成，标记「勿手改」；API 变更时一条命令重新生成。
2. **依赖克制**：Python 运行时只依赖 `httpx`；TypeScript 零运行时依赖（原生 `fetch`，Node ≥18 / 浏览器）。
3. **三步跑通**：`clone → 填 key → run`，Time-to-Hello-World < 3 分钟。
4. **错误不裸奔**：任何失败都要转成有语义的异常 + 人类可读提示，绝不把 traceback / stack 甩给用户。
5. **安全默认值**：key 从环境变量读；超时、重试、退避都有合理默认；不打印密钥。

---

## 1. 对外 API 面（两语言严格对齐）

`operationId` 是唯一锚点，命名按语言习惯转换：

| operationId | Python (snake_case) | TypeScript (camelCase) | HTTP |
|---|---|---|---|
| `searchTrademarks` | `search_trademarks()` | `searchTrademarks()` | POST /ip/trademark/search |
| `listTrademarks` | `list_trademarks()` | `listTrademarks()` | GET /ip/trademark/list |
| `searchDesigns` | `search_designs()` | `searchDesigns()` | POST /ip/design/search |
| `listReports` | `list_reports()` | `listReports()` | GET /ip/report/list |
| `getWorkbenchStats` | `get_workbench_stats()` | `getWorkbenchStats()` | GET /ip/workbench/stats |
| `getOpenApiUsage` | `get_usage()` | `getUsage()` | GET /ip/usage |
| `queryRequestLog` | `query_request_log()` | `queryRequestLog()` | GET /ip/requests |
| `getMcpHealth` | `get_mcp_health()` | `getMcpHealth()` | GET /mcp/health |
| `callMcp` | `call_mcp()` | `callMcp()` | POST /mcp |

- 客户端统一入口：`Client`（Python：`isud_tm.Client`；TS：`new Client()`）。
- 分页迭代器：Python `client.iter_trademarks(...)`（generator）；TS `client.listTrademarksAll(...)`（async generator），
  自动翻页直到取完 `total`。
- 初始化统一接受：`api_key`（必填）、`base_url`（可选，默认 `https://app.isud.cn/api/v1/open`）、
  `timeout`（可选，默认 30s）、`max_retries`（可选，默认 3）。

---

## 2. 响应信封解析

所有响应信封：`{ code, msg, data, requestId, suggestion, retryable, retryAfter }`。

统一解析规则：
- `code == "0000"` → 返回 `data`（业务对象），并把**元数据**挂在返回的 `ResponseMeta` 上（见 §5）。
- `code != "0000"` → 按 §3 映射成异常抛出。
- 每次调用都解析响应头 `X-Request-Id` / `X-Credits-Charged` / `X-Credits-Remaining`
  / `X-RateLimit-Limit` / `X-RateLimit-Remaining`，即使失败也要保留（便于对账）。

---

## 3. 异常体系（错误码 → 异常类型）

两语言用**同名**异常类（Python 首字母大写驼峰，TS 相同），继承关系一致：

```
SdkError (基类，携带 message / code / request_id / suggestion / retryable)
├── AuthenticationError    # 8889 / HTTP 401 —— key 缺失/无效/禁用/过期/scope 不足。retryable=false
├── RateLimitError         # 9002 限流 / 9003 每日额度 —— HTTP 429，带 retry_after 秒数
├── ValidationError        # 9001 参数错误（含幂等键误用）—— 带 suggestion，retryable=false
├── CapabilityError        # 0002 数据源未接入/类型未开放 —— retryable=false，不扣点
├── ApiError              # 0001 通用业务错误 —— retryable 由信封字段决定
└── NetworkError          # 连接失败/超时/5xx —— 可重试
```

映射优先级：**先看 HTTP 状态码（401/429），再看信封 code**。因为 8889/9002/9003 有真实 HTTP 码，
其余业务错误 HTTP 恒 200，靠 code 区分。

| HTTP | code | 异常 | 默认可重试 |
|---|---|---|---|
| 401 | 8889 | `AuthenticationError` | 否 |
| 429 | 9002 | `RateLimitError` | 是（按 Retry-After） |
| 429 | 9003 | `RateLimitError` | 是（按 Retry-After，次日重置则提示） |
| 200 | 9001 | `ValidationError` | 否 |
| 200 | 0002 | `CapabilityError` | 否 |
| 200 | 0001 | `ApiError` | 依 `retryable` |
| 200 | 0000 | —（成功） | — |
| 网络/5xx | — | `NetworkError` | 是（指数退避） |

---

## 4. Retry-After 退避（核心体验，两语言一致）

触发条件：`RateLimitError`（9002/9003）或 `NetworkError` 且 `retryable=true` 且未超 `max_retries`。

退避取值的**优先级**：
1. 信封字段 `retryAfter`（秒）——服务端明确给出，最权威
2. 响应头 `Retry-After`（整数秒；也支持 HTTP-date，转成秒差）
3. 兜底指数退避：`base=1s`，第 n 次 `min(2^n, 30)` 秒（n 从 0 起）

行为约定：
- 每次重试前重新读取退避值（服务端可能动态调整）。
- 尊重 `retryable=false`：**绝不重试**（0002/8889/9001 大多属此类）。
- 只有**幂等安全**的请求才自动重试：
  - GET 全部安全；
  - POST 检索类（search）通过自动注入的 `Idempotency-Key` 保证安全（§5）；
  - `callMcp` 视 method 而定，默认不自动重试。
- 重试耗尽后抛最后一次异常，异常-message 里说明「已重试 N 次」。
- 429 的 `Retry-After` 可能长达 60s；**单次等待上限默认 60s**，超过则直接抛，不长时间阻塞用户。

---

## 5. 幂等键 / 扣点回读 / 请求追踪

### 幂等键
- `search_trademarks` / `search_designs` 每次调用自动生成 `Idempotency-Key`（UUID4，去掉连字符），
  也允许用户通过 `idempotency_key=` 显式传入（用业务单号）。
- 同源同键同体 24h 内重放不重复扣点；SDK 解析 `Idempotency-Replayed: true` 头挂到 meta。
- 长度约束 1~128 字符：客户端**本地校验**，超长直接抛 `ValidationError`，不发请求。

### 客户端参数校验（避免无谓扣点）
- `size` 必须在 1~100：本地校验，非法直接抛 `ValidationError`（后端对 size=0 静默按默认，SDK 要挡住）。
- `keyword` 与 `owner` 至少一项（商标检索）：本地校验。
- `requestId` 查询长度 ≤64：本地校验。

### 扣点回读（ResponseMeta）
每次成功/失败都提供元数据对象（Python `resp.meta` 或 returned-data 的 `.meta` 属性；TS `result.meta`）：

```
request_id        # X-Request-Id / 信封 requestId
credits_charged   # X-Credits-Charged（失败/幂等回放为 0）
credits_remaining # X-Credits-Remaining
rate_limit        # X-RateLimit-Limit
rate_remaining    # X-RateLimit-Remaining
idempotent_replay # Idempotency-Replayed == 'true'
```

SDK 额外维护 `client.last_meta`（最近一次调用的 meta），方便示例/调试。

---

## 6. 分页迭代器

- `iter_trademarks(**filters)` / `listTrademarksAll(filters)`：从 `current=1` 起，按 `size` 翻页，
  直到 `current >= ceil(total/size)` 或 `records` 为空。
- 每页之间遵守 §4 退避（GET 安全重试）。
- 提供 `max_pages` 参数防止意外拉爆（默认不限，示例里设小值）。
- 迭代器 yield 单条记录（Python）/ 单条记录（TS `for await`），用户无需关心翻页。

---

## 7. 生成层 vs 手写层边界

```
isud-sdk-python/
├── src/isud_tm/
│   ├── models.py          # 【生成】openapi.yaml → dataclass，头部标注 GENERATED，勿手改
│   ├── client.py          # 【手写】Client 主体 + 9 个端点方法
│   ├── errors.py          # 【手写】异常体系（§3）
│   ├── retry.py           # 【手写】退避策略（§4）
│   └── extras/            # 【手写】分页迭代器、便捷方法
├── examples/
│   ├── conflict_check/    # 示例1：近似商标排查
│   └── batch_screen/      # 示例2：批量风险筛查
├── tests/                 # 契约测试（mock，不依赖真实 key）
├── pyproject.toml         # 仅 httpx 运行时依赖
├── README.md              # 首屏 = 3 行 Hello World + 运行截图占位
└── LICENSE                # MIT
```

- **生成命令**写进 README/CONTRIBUTING：`datamodel-codegen --input openapi.yaml ...`。
- 生成模型只负责「数据结构」，不含任何行为；行为全在手写层。
- 契约测试要校验：9 个端点方法都存在、模型能解析契约示例、错误码映射正确。

---

## 8. 示例项目规范（内容营销单元）

首批两个示例（两语言各一份，结构对齐）：

1. **conflict_check — 近似商标排查**：输入商标名 + 法域 → 调 `search_trademarks` → 打印风险分级与结论。
   - 演示点：key 从环境变量读、信封解析、错误友好提示、扣点回读展示。
2. **batch_screen — 批量风险筛查**：读 CSV（商标名列表）→ 逐个检索 → 汇总 high/medium/low → 导出 CSV。
   - 演示点：幂等键、429 退避、分页、批量场景下的用量查询。

硬门槛（做不到就不发）：
- `clone → 填 key → run` 三步内跑通，README 首屏是**运行输出截图**不是架构图；
- 不依赖任何自建中间层/额外服务；
- 出错给友好提示，不裸 traceback；
- 明示「注册即送 N 次调用」的获取入口（key 从控制台领）。

---

## 9. 版本与演进

- SDK 版本跟随 API 主版本（`1.0.x`）。
- `status` / `riskLevel` 是开放枚举，新增值不构成破坏性变更：模型层用 `str` 不用封闭 Enum，
  客户端按未知值兜底（不要 `raise`）。
- 日期字段统一 Unix 毫秒 int64，`0` = 未知；SDK 提供可选的人类可读格式化 helper（不改动原始值）。

---

*本文件在两仓库各存一份，内容必须一致。任一语言修改体验层约定，先改本文件再同步另一语言。*
