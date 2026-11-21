# isud-sdk (TypeScript)

优标宝商标数据开放 API 的 TypeScript SDK —— **零运行时依赖**（原生 fetch），契约驱动。

- **零依赖**：不用 axios/node-fetch，Node ≥18 或浏览器直接跑
- **契约驱动**：类型从 [OpenAPI 3.1 契约](https://docs.isud.cn/openapi.yaml) 自动生成
- **体验完整**：Retry-After 退避、幂等键、扣点回读、异步分页、类型化异常

> 密钥从[控制台](https://app.isud.cn)创建（**注册即送调用次数**），仅创建时完整展示一次。

## 安装

```bash
npm install isud-sdk
```

## 3 分钟上手

```bash
export ISUD_API_KEY="lgr_live_你的密钥"    # Windows PowerShell: $env:ISUD_API_KEY="..."
npx tsx hello.ts
```

`hello.ts`：

```ts
import { Client } from "isud-sdk";

const client = new Client();  // 自动读环境变量 ISUD_API_KEY
const result = await client.searchTrademarks({ jurisdictionCode: "CN", keyword: "优标宝" });
console.log(result?.conclusion);
console.log("本次扣点:", client.lastMeta.creditsCharged);
```

运行输出：

```
存在中度相似商标，建议进一步人工评估
本次扣点: 10
```

## 核心能力

```ts
import { Client, RateLimitError } from "isud-sdk";

const client = new Client({ apiKey: "lgr_live_..." });

// 1. 商标排查（自动幂等 + 429 退避 + 扣点回读）
const r = await client.searchTrademarks({ jurisdictionCode: "CN", keyword: "优标宝", niceClasses: ["35"] });

// 2. 异步分页：自动翻完所有页
for await (const item of client.listTrademarksAll({ keyword: "优标" }, 50)) {
  console.log(item.markText, item.status);
}

// 3. 用量自助对账
const usage = await client.getUsage();
console.log("余额:", usage?.balance);

// 4. 失败有语义，不裸 stack
try {
  await client.searchTrademarks({ jurisdictionCode: "XX", keyword: "x" });
} catch (e) {
  if (e instanceof RateLimitError) console.log(e.friendly(), "请等", e.retryAfter, "秒");
}
```

所有方法：

| 方法 | 说明 |
|---|---|
| `searchTrademarks()` | 商标检索与冲突判定（10 点） |
| `searchDesigns()` | 外观设计检索（10 点） |
| `listTrademarks()` / `listTrademarksAll()` | 商标档案分页 / 异步翻页迭代 |
| `listReports()` | 排查报告分页 |
| `getWorkbenchStats()` | 工作台汇总统计 |
| `getUsage()` | 点数余额与用量 |
| `queryRequestLog(requestId)` | 按追踪 ID 回查调用结果 |
| `getMcpHealth()` / `callMcp()` | MCP 探活 / JSON-RPC 调用 |

## 示例项目

- [`examples/conflict-check`](examples/conflict-check) —— 近似商标排查
- [`examples/batch-screen`](examples/batch-screen) —— 批量风险筛查（CSV 批量读 → 汇总导出）

## 重新生成类型层

类型由契约生成，**不要手改** `src/schema.d.ts`：

```bash
npm run generate
```

## 契约与文档

- 契约源：<https://docs.isud.cn/openapi.yaml>
- 完整文档：<https://docs.isud.cn/>
- 设计规范：[SDK-DESIGN.md](SDK-DESIGN.md)

## License

MIT
