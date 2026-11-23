/** 结果展示与导出 helper —— 与 Python SDK extras 对齐，示例直接复用。 */

import type { TrademarkItem, TrademarkSearchResult } from "./client.js";

const STATUS_ZH: Record<string, string> = {
  Filed: "已申请", Published: "已公布", Registered: "已注册",
  Expired: "已失效", Withdrawn: "已撤回", Refused: "已驳回", Opposed: "异议中",
};

/**
 * 把毫秒时间戳格式化为 `YYYY-MM-DD`。
 * @param ms 毫秒时间戳；为空或非法时返回 `"未知"`。
 */
export function formatDateMs(ms?: number | null): string {
  if (!ms) return "未知";
  const d = new Date(ms);
  return Number.isNaN(d.getTime())
    ? "未知"
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 生成风险统计单行摘要（命中数 + 高/中/低风险分布）。
 * @param data 检索结果；为空时返回 `"无结果"`。
 */
export function riskSummary(data?: Partial<TrademarkSearchResult> | null): string {
  if (!data) return "无结果";
  return [
    `命中 ${data.total ?? 0} 件`,
    `高 ${data.highRisk ?? 0}`,
    `中 ${data.mediumRisk ?? 0}`,
    `低 ${data.lowRisk ?? 0}`,
  ].join(" | ");
}

/**
 * 把检索结果排版成可读的多行文本（含法域、关键词、风险、结论、前 N 条记录）。
 * @param data 检索结果；为空时返回占位提示。
 * @param limit 最多展示的记录条数，默认 10。
 */
export function formatSearchResult(data?: Partial<TrademarkSearchResult> | null, limit = 10): string {
  if (!data) return "（无结果）";
  const lines = [
    `法域: ${data.jurisdictionCode ?? "-"}  关键词: ${data.keyword ?? "-"}`,
    riskSummary(data),
    `结论: ${data.conclusion ?? "-"}`,
    `来源: ${data.source ?? "-"}  耗时: ${data.elapsedMs ?? "-"}ms`,
    "",
  ];
  const items: TrademarkItem[] = (data.items ?? []) as TrademarkItem[];
  if (items.length === 0) lines.push("  没有近似商标记录。");
  items.slice(0, limit).forEach((it, i) => {
    const status = it.status ?? "-";
    lines.push(
      `  ${String(i + 1).padStart(2)}. ${(it.markText || "(图形)").padEnd(20)} ` +
        `[${it.riskLevel ?? "-"}] ${STATUS_ZH[status] ?? status}  ${it.ownerName ?? "-"}  ` +
        `申请号 ${it.applicationNumber ?? "-"}  到期 ${formatDateMs(it.expiryDate)}`
    );
  });
  if (items.length > limit) lines.push(`  ... 还有 ${items.length - limit} 条（用 size/current 翻页查看）`);
  return lines.join("\n");
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 把对象数组转成 CSV 文本（含 UTF-8 BOM，便于 Excel 打开中文）。
 * @param rows 数据行；空数组返回空串。
 * @param columns 指定列及顺序；省略时取第一行的键。
 */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return "";
  const cols = columns ?? Object.keys(rows[0]);
  const lines = [cols.join(",")];
  for (const row of rows) lines.push(cols.map((c) => csvCell(row[c])).join(","));
  return "\uFEFF" + lines.join("\r\n"); // BOM 便于 Excel 打开中文
}
