# @isud/tm (TypeScript)

[![npm version](https://img.shields.io/npm/v/@isud/tm)](https://www.npmjs.com/package/@isud/tm)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

优标宝商标数据开放 API 的 TypeScript SDK —— **零运行时依赖**（原生 fetch），契约驱动。

- **零依赖**：不用 axios/node-fetch，Node ≥18 或浏览器直接跑
- **契约驱动**：类型从 [OpenAPI 3.1 契约](https://docs.isud.cn/openapi.yaml) 自动生成
- **体验完整**：Retry-After 退避、幂等键、扣点回读、异步分页、类型化异常

> 密钥从[控制台](https://app.isud.cn)创建（**注册即送调用次数**），仅创建时完整展示一次。

## 安装

```bash
npm install @isud/tm
```

## 3 分钟上手

```bash
export ISUD_API_KEY="lgr_live_你的密钥"    # Windows PowerShell: $env:ISUD_API_KEY="..."
npx tsx hello.ts
```

`hello.ts`：

```ts
import { Client } from "@isud/tm";

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
import { Client, RateLimitError } from "@isud/tm";

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
| `queryVienna(params)` | 图形检索：维也纳 VCL10 / 关键词换码 / 分类树 / 以图搜图 |
| `queryGazette(params)` | 商标公告：CN 公告明细与期号 / 全球 7 局事件 |
| `queryReview(params)` | 评审文书：CNIPA 298 万裁定书 |
| `queryIpr(params)` | 海关备案：12 万条备案记录（可选接入） |

四个数据能力方法均为 GET、读类 1 点/次，返回 `data` 原始 JSON（结构随 `mode` 变化）：

```ts
const codes = await client.queryVienna({ mode: "codes", q: "王冠" });
const rows  = await client.queryGazette({ mode: "rows", issue: "2008", mark: "华为" });
const docs  = await client.queryReview({ q: "华为", size: 10 });
const filings = await client.queryIpr({ q: "华为" });
```

## 示例项目

- [`examples/conflict-check`](https://github.com/isud-opensource/isud-sdk-typescript/tree/main/examples/conflict-check) —— 近似商标排查
- [`examples/batch-screen`](https://github.com/isud-opensource/isud-sdk-typescript/tree/main/examples/batch-screen) —— 批量风险筛查（CSV 批量读 → 汇总导出）

## 重新生成类型层

类型由契约生成，**不要手改** `src/schema.d.ts`：

```bash
npm run generate
```

## 契约与文档

- 契约源：<https://docs.isud.cn/openapi.yaml>
- 完整文档：<https://docs.isud.cn/>
- 设计规范：[SDK-DESIGN.md](SDK-DESIGN.md)

## 双发：npm + JSR

同一份 TypeScript 源码，两个注册表都发，**无需编译即可被 Deno / JSR 直接消费**：

| 注册表 | 安装方式 | 消费的源码 |
|---|---|---|
| npm | `npm install @isud/tm` | 编译产物 `dist/`（ESM + CJS + `.d.ts`） |
| JSR | `npx jsr add @isud/tm` | **原始 `src/*.ts`**，Deno 原生跑 TypeScript |

JSR 版零依赖、原生 `fetch`，Node ≥18 / Deno / 浏览器都能用。JSR 的 `exports` 直接指向 `./src/index.ts`，不需要 `tsc` 编译这一步。

维护者发布（`package.json` 与 `jsr.json` 版本号需保持一致）：

```bash
npm run release:check     # 类型检查 + 测试 + 构建 + JSR dry-run
npm run publish:npm       # 发 npm（需 npm login）
npm run publish:jsr       # 发 JSR（首次会打开浏览器用 GitHub 授权）
```

## License

MIT
