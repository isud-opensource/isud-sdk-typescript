# 示例 2：批量风险筛查（TypeScript）

读 CSV 批量检索商标，汇总高/中/低风险，导出结果 CSV。与 Python 版结构对齐。

## 运行（3 步）

```bash
npm install isud-sdk
export ISUD_API_KEY="lgr_live_你的密钥"
npx tsx main.ts marks.sample.csv results.csv CN
```

> 密钥从 https://app.isud.cn 控制台创建，**注册即送调用次数**。

## 输入 / 输出

输入 `marks.sample.csv`：每行一个商标名，`#` 开头为注释。

输出 `results.csv`：商标名、命中总数、高/中/低风险、结论、requestId。

## 演示的能力

- **幂等键**：业务序号当 `idempotencyKey`，脚本重跑不重复扣点
- **429 退避**：SDK 自动按 Retry-After 退避；示例额外 2s 节流
- **用量对账**：跑完调 `getUsage()` 看剩余点数
- **批量容错**：单个商标失败不影响整批
