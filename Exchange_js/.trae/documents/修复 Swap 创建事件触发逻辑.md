# 修复 EVT_SWAP_CREATED 触发失效计划

## 1. 修正会计事件配置
- 修改 `src/config/manifests/acct-config.data.ts`：
  - 将 `EVT_SWAP_CREATED` 的 `toStatus` 从 `'CREATED'` 改为 `'PENDING_COMPLIANCE'`。
  - 检查 `EVT_WITHDRAWAL_CREATED` 是否也需要从 `'CREATED'` 调整为业务实际状态。

## 2. 业务状态一致性检查
- 阅读 `withdraw-transactions.service.ts` 或其编排器，确认提现创建时的初始状态。
- 如果不一致，统一修正 `acct-config.data.ts` 中的 `toStatus`。

## 3. 同步数据库配置
- 执行 `npx ts-node prisma/seed.ts` 确保数据库中的 `acct_events` 表更新为最新的状态触发规则。

## 4. 验证
- 尝试创建一个新的 Swap 交易，观察控制台是否输出 `Accounting triggered for Swap...` 日志。
