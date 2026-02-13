# 修复充值记账未触发的问题

## 问题分析
经核查，充值流程未触发记账的原因是 **entityType (sourceType) 不一致**：
1. **数据库配置**：`AcctEvent` 表中所有充值相关事件（如 `EVT_DEPOSIT_CONFIRMED__CRYPTO`）的 `entityType` 字段当前被设置为 `'PAYIN'`。
2. **代码逻辑**：`DepositWorkflowService` 在调用 `triggerEvent` 时，传入的 `entityType` 是 `'DEPOSIT'`。
3. **匹配失败**：由于 `triggerEvent` 采用精确匹配，`'DEPOSIT'` 无法匹配到数据库中的 `'PAYIN'`，导致记账动作被跳过。

## 解决方案

### 1. 标准化 entityType
将充值业务的会计主体类型统一为 `'DEPOSIT'`，以符合项目目前使用业务实体名称（如 `SWAP`, `WITHDRAW`）作为会计主体的惯例。

### 2. 更新数据库配置
执行修复脚本，将 `acct_events` 表中 `entityType` 为 `'PAYIN'` 的记录全部更新为 `'DEPOSIT'`。

### 3. 同步代码逻辑
更新 `JournalsService.createDepositJournal` 中的硬编码字符串，将 `sourceType` 从 `'PAYIN'` 修改为 `'DEPOSIT'`，确保即使使用此备用方法也能保持一致。

## 验证计划
1. 执行数据库更新脚本。
2. 使用 `inspect_events.ts` 确认数据库中的 `entityType` 已正确更改。
3. 模拟一次充值状态流转，验证 `triggerEvent` 是否能正确匹配并生成 `Journal` 记录。