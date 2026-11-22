"use strict";
/** 结果展示与导出 helper —— 与 Python SDK extras 对齐，示例直接复用。 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDateMs = formatDateMs;
exports.riskSummary = riskSummary;
exports.formatSearchResult = formatSearchResult;
exports.toCsv = toCsv;
const STATUS_ZH = {
    Filed: "已申请", Published: "已公布", Registered: "已注册",
    Expired: "已失效", Withdrawn: "已撤回", Refused: "已驳回", Opposed: "异议中",
};
function formatDateMs(ms) {
    if (!ms)
        return "未知";
    const d = new Date(ms);
    return Number.isNaN(d.getTime())
        ? "未知"
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function riskSummary(data) {
    if (!data)
        return "无结果";
    return [
        `命中 ${data.total ?? 0} 件`,
        `高 ${data.highRisk ?? 0}`,
        `中 ${data.mediumRisk ?? 0}`,
        `低 ${data.lowRisk ?? 0}`,
    ].join(" | ");
}
function formatSearchResult(data, limit = 10) {
    if (!data)
        return "（无结果）";
    const lines = [
        `法域: ${data.jurisdictionCode ?? "-"}  关键词: ${data.keyword ?? "-"}`,
        riskSummary(data),
        `结论: ${data.conclusion ?? "-"}`,
        `来源: ${data.source ?? "-"}  耗时: ${data.elapsedMs ?? "-"}ms`,
        "",
    ];
    const items = (data.items ?? []);
    if (items.length === 0)
        lines.push("  没有近似商标记录。");
    items.slice(0, limit).forEach((it, i) => {
        const status = it.status ?? "-";
        lines.push(`  ${String(i + 1).padStart(2)}. ${(it.markText || "(图形)").padEnd(20)} ` +
            `[${it.riskLevel ?? "-"}] ${STATUS_ZH[status] ?? status}  ${it.ownerName ?? "-"}  ` +
            `申请号 ${it.applicationNumber ?? "-"}  到期 ${formatDateMs(it.expiryDate)}`);
    });
    if (items.length > limit)
        lines.push(`  ... 还有 ${items.length - limit} 条（用 size/current 翻页查看）`);
    return lines.join("\n");
}
function csvCell(v) {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows, columns) {
    if (rows.length === 0)
        return "";
    const cols = columns ?? Object.keys(rows[0]);
    const lines = [cols.join(",")];
    for (const row of rows)
        lines.push(cols.map((c) => csvCell(row[c])).join(","));
    return "\uFEFF" + lines.join("\r\n"); // BOM 便于 Excel 打开中文
}
//# sourceMappingURL=helpers.js.map