#!/usr/bin/env node
/** 示例 1：近似商标排查（与 Python 版对齐）。
 *
 * 运行（3 步）:
 *   npm install @isud/tm
 *   export ISUD_API_KEY="lgr_live_你的密钥"
 *   npx tsx main.ts 优标宝 CN
 */

import { Client, SdkError, formatSearchResult } from "@isud/tm";

async function main(): Promise<number> {
  const keyword = process.argv[2] ?? "优标宝";
  const jurisdiction = process.argv[3] ?? "CN";

  if (!process.env.ISUD_API_KEY) {
    console.log("✗ 请先设置环境变量 ISUD_API_KEY");
    console.log("  获取方式：注册 https://app.isud.cn 后在控制台创建密钥（注册即送调用次数）");
    return 2;
  }

  const client = new Client();
  try {
    const data = (await client.searchTrademarks({
      jurisdictionCode: jurisdiction, keyword, size: 10,
    })) as Parameters<typeof formatSearchResult>[0];
    console.log(formatSearchResult(data));
    console.log();
    console.log(
      `✓ 本次扣点 ${client.lastMeta.creditsCharged ?? 0} ` +
      `| 剩余 ${client.lastMeta.creditsRemaining ?? "-"} ` +
      `| requestId ${client.lastMeta.requestId ?? "-"}`);
    return 0;
  } catch (err) {
    if (err instanceof SdkError) {
      console.log(err.friendly()); // 友好提示，不裸 stack
      return 1;
    }
    throw err;
  }
}

main().then((code) => process.exit(code));
