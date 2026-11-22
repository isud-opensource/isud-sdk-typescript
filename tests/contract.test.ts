/** 契约测试：信封解析、异常映射、退避、幂等、分页、本地校验。全 mock，不发真实请求。 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Client, AuthenticationError, RateLimitError, ValidationError,
  CapabilityError, ApiError, parseRetryAfter,
} from "../src/index.js";
import { makeFetch, env } from "./helpers.js";

const key = "lgr_live_test";

function client(fetch: typeof globalThis.fetch, maxRetries = 0): Client {
  return new Client({ apiKey: key, fetch, maxRetries });
}

test("成功：返回 data 并解析 meta", async () => {
  const { fetch } = makeFetch(() => ({
    status: 200, body: env({ conclusion: "安全", total: 0 }, { requestId: "req_abc" }),
    headers: {
      "x-credits-charged": "10", "x-credits-remaining": "990",
      "x-ratelimit-limit": "30", "x-ratelimit-remaining": "29",
    },
  }));
  const c = client(fetch);
  const data = await c.searchTrademarks({ jurisdictionCode: "CN", keyword: "优标宝" }) as { conclusion: string };
  assert.equal(data.conclusion, "安全");
  assert.equal(c.lastMeta.requestId, "req_abc");
  assert.equal(c.lastMeta.creditsCharged, 10);
  assert.equal(c.lastMeta.creditsRemaining, 990);
  assert.equal(c.lastMeta.rateLimit, 30);
});

test("幂等键自动注入", async () => {
  const { fetch, calls } = makeFetch(() => ({ status: 200, body: env({ total: 0 }) }));
  const c = client(fetch);
  await c.searchTrademarks({ jurisdictionCode: "CN", keyword: "x" });
  const h = calls[0].init.headers as Record<string, string>;
  assert.ok(h["Idempotency-Key"]);
  assert.equal(h["Idempotency-Key"].length, 32);
});

test("自定义幂等键 + 回放标记", async () => {
  const { fetch, calls } = makeFetch(() => ({
    status: 200, body: env({ total: 0 }), headers: { "idempotency-replayed": "true" },
  }));
  const c = client(fetch);
  await c.searchTrademarks({ jurisdictionCode: "CN", keyword: "x" }, "ORDER-1");
  const h = calls[0].init.headers as Record<string, string>;
  assert.equal(h["Idempotency-Key"], "ORDER-1");
  assert.equal(c.lastMeta.idempotentReplay, true);
});

test("异常映射：401/9001/0002/0001", async () => {
  const cases: Array<[number, string, new (...a: never[]) => Error]> = [
    [401, "8889", AuthenticationError],
    [200, "9001", ValidationError],
    [200, "0002", CapabilityError],
    [200, "0001", ApiError],
  ];
  for (const [status, code, Cls] of cases) {
    const { fetch } = makeFetch(() => ({
      status, body: { code, msg: "出错啦", suggestion: "换词", requestId: "req_e" },
    }));
    const c = client(fetch);
    try {
      await c.getUsage();
      assert.fail(`应抛 ${Cls.name}`);
    } catch (e) {
      assert.ok(e instanceof Cls, `期望 ${Cls.name}，实际 ${(e as Error).name}`);
      assert.equal((e as { code?: string }).code, code);
      assert.match((e as Error).friendly(), /换词/);
    }
  }
});

test("429 限流：信封 retryAfter 优先，头兜底", async () => {
  const { fetch } = makeFetch(() => ({
    status: 429,
    body: { code: "9002", msg: "频繁", retryAfter: 7 },
    headers: { "retry-after": "99" },
  }));
  const c = client(fetch);
  try {
    await c.getUsage();
    assert.fail("应抛 RateLimitError");
  } catch (e) {
    assert.ok(e instanceof RateLimitError);
    assert.equal(e.retryAfter, 7);
  }
});

test("本地校验：size/keyword/requestId 不发请求", async () => {
  const { fetch, calls } = makeFetch(() => ({ status: 200, body: env({}) }));
  const c = client(fetch);
  await assert.rejects(() => c.searchTrademarks({ jurisdictionCode: "CN", keyword: "x", size: 0 }), ValidationError);
  await assert.rejects(() => c.searchTrademarks({ jurisdictionCode: "CN" }), ValidationError);
  await assert.rejects(() => c.queryRequestLog("x".repeat(65)), ValidationError);
  assert.equal(calls.length, 0);
});

test("自动分页迭代", async () => {
  const { fetch } = makeFetch((url) => {
    if (url.includes("current=1")) return { status: 200, body: env({ total: 3, records: [{ markText: "A" }, { markText: "B" }] }) };
    if (url.includes("current=2")) return { status: 200, body: env({ total: 3, records: [{ markText: "C" }] }) };
    return { status: 200, body: env({ total: 3, records: [] }) };
  });
  const c = client(fetch);
  const marks: string[] = [];
  for await (const item of c.listTrademarksAll({}, 2)) marks.push(item.markText ?? "");
  assert.deepEqual(marks, ["A", "B", "C"]);
});

test("MCP health 走裸响应且 base URL 正确", async () => {
  const { fetch, calls } = makeFetch(() => ({ status: 200, body: { status: "ok", toolCount: 15 } }));
  const c = client(fetch);
  const r = await c.getMcpHealth() as { toolCount: number };
  assert.equal(r.toolCount, 15);
  assert.ok(calls[0].url.includes("/api/v1/open/mcp/health"));
});

test("四个数据能力端点走 GET 且参数透传", async () => {
  const cases: Array<[keyof Client, Record<string, string | number>, string]> = [
    ["queryVienna", { mode: "codes", q: "王冠" }, "/ip/vienna/query"],
    ["queryGazette", { mode: "issues" }, "/ip/gazette/query"],
    ["queryReview", { q: "华为", size: 1 }, "/ip/review/query"],
    ["queryIpr", { mode: "stats" }, "/ip/ipr/query"],
  ];
  for (const [name, params, path] of cases) {
    const { fetch, calls } = makeFetch(() => ({ status: 200, body: env({ ok: true }) }));
    const c = client(fetch);
    const data = await (c[name] as (p: Record<string, string | number>) => Promise<unknown>)(params);
    assert.deepEqual(data, { ok: true });
    assert.ok(calls[0].url.includes(path), `${name} path`);
    assert.ok(calls[0].url.includes("mode=") || calls[0].url.includes("q="), `${name} params`);
  }
});

test("parseRetryAfter 支持整数秒与 HTTP-date", () => {
  assert.equal(parseRetryAfter("30"), 30);
  assert.equal(parseRetryAfter(" 12 "), 12);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter("not-a-date"), null);
  const future = new Date(Date.now() + 5000).toUTCString();
  const secs = parseRetryAfter(future);
  assert.ok(secs != null && secs >= 3 && secs <= 5, `期望 3~5 秒，实际 ${secs}`);
});
