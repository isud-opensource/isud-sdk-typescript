#!/usr/bin/env node
/** 示例 2：批量风险筛查（与 Python 版对齐）。
 *
 * 运行:
 *   npm install isud-sdk
 *   export ISUD_API_KEY="lgr_live_你的密钥"
 *   npx tsx main.ts marks.sample.csv results.csv CN
 */

import { readFileSync, writeFileSync } from "node:fs";
import { Client, SdkError, RateLimitError, toCsv } from "isud-sdk";

const BATCH_PAUSE_MS = 2000;

function readMarks(path: string): string[] {
  return readFileSync(path, "utf-8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

async function main(): Promise<number> {
  if (process.argv.length < 4) {
    console.log("用法: npx tsx main.ts <输入.csv> <输出.csv> [法域]");
    console.log("输入 CSV：每行一个商标名（可用 # 注释）");
    return 2;
  }
  const inPath = process.argv[2];
  const outPath = process.argv[3];
  const jurisdiction = process.argv[4] ?? "CN";

  if (!process.env.ISUD_API_KEY) {
    console.log("✗ 请先设置环境变量 ISUD_API_KEY（控制台创建，注册即送调用次数）");
    return 2;
  }

  const marks = readMarks(inPath);
  if (marks.length === 0) {
    console.log("✗ 输入文件没有有效商标名");
    return 2;
  }

  const client = new Client();
  const results: Record<string, unknown>[] = [];
  console.log(`开始筛查 ${marks.length} 个商标（法域 ${jurisdiction}）...`);
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    try {
      const data = (await client.searchTrademarks(
        { jurisdictionCode: jurisdiction, keyword: mark },
        `batch-${jurisdiction}-${String(i + 1).padStart(4, "0")}` // 幂等键：重跑不重复扣点
      )) as Record<string, unknown> | null;
      results.push({
        "商标名": mark,
        "命中总数": data?.total ?? 0,
        "高风险": data?.highRisk ?? 0,
        "中风险": data?.mediumRisk ?? 0,
        "低风险": data?.lowRisk ?? 0,
        "结论": data?.conclusion ?? "",
        "requestId": client.lastMeta.requestId ?? "",
      });
      console.log(`  [${i + 1}/${marks.length}] ${mark}: 高${data?.highRisk ?? 0} 中${data?.mediumRisk ?? 0} 低${data?.lowRisk ?? 0}`);
    } catch (err) {
      if (err instanceof RateLimitError) {
        console.log(`  [${i + 1}/${marks.length}] ${mark}: 限流，SDK 已自动退避；仍失败 -> ${err.message}`);
        results.push({ "商标名": mark, "结论": "限流失败", "requestId": err.requestId ?? "" });
      } else if (err instanceof SdkError) {
        console.log(`  [${i + 1}/${marks.length}] ${mark}: ${err.message}`);
        results.push({ "商标名": mark, "结论": `失败:${err.code}`, "requestId": err.requestId ?? "" });
      } else {
        throw err;
      }
    }
    if (i < marks.length - 1) await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
  }

  writeFileSync(outPath, toCsv(results), "utf-8");
  let balance: number | undefined;
  try {
    balance = (await client.getUsage())?.balance;
  } catch {
    /* 用量查询失败不影响主流程 */
  }
  console.log(`\n✓ 完成，已写出 ${results.length} 行到 ${outPath}`);
  if (balance !== undefined) console.log(`  剩余点数: ${balance}`);
  return 0;
}

main().then((code) => process.exit(code));
