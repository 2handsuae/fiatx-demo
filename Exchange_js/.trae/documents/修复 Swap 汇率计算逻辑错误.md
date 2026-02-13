# 修复 Swap 汇率计算 Bug 计划

## 1. 重构 fetchMarketRate 逻辑
- 修改 `src/modules/trading/swap-transactions/swap-transactions.service.ts`：
  - 移除 `if (bFrom === bTo) return new Prisma.Decimal(1);` 这一行。
  - 只有在 `fromCode === toCode` 时才返回 1.0。
  - 当映射后的 Binance 编码相同（如 AED 对 USDT）时，将基础汇率设为 1.0，但继续向下执行 AED Bridge 逻辑。

## 2. 增强汇率桥接逻辑
- 确保 `AED_USD_RATE` (3.6725) 被正确应用于 `fromAsset` 或 `toAsset` 是 AED 的情况。

## 3. 验证与测试
- 启动开发服务器并检查日志输出，确保 AED/USDT 兑换时不再显示汇率为 1.0。
- 验证 Preview 接口返回的汇率是否符合预期。
