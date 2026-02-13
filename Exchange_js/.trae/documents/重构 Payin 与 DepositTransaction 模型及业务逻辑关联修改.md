## 数据库 Schema 重构 (prisma/schema.prisma)
1. **引入枚举 (Enums)**: 定义 `PayinStatus` 和 `DepositStatus` 枚举，取代当前的字符串硬编码。
2. **重构 Payin 模型**:
   - 将 `status` 字段类型更改为 `PayinStatus` 枚举。
   - 添加 `@@unique([txHash, assetId, toAddress])` 复合索引，从数据库层面防止重复入账。
   - 建立与 `PayinAuditLog` 的一对多关联。
3. **重构 DepositTransaction 模型**:
   - **重命名**: `walletId` -> `toWalletId`，语义更明确。
   - **关联**: 添加 `payinId` 字段并建立与 `Payin` 的一对一显式关联。
   - **快照**: 添加 `toAddress` 和 `toIban` 字段，在交易发生时记录钱包/银行卡快照。
   - **金额分拆**: 添加 `netAmount` (净额) 和 `feeAmount` (手续费) 字段。
   - 建立与 `DepositAuditLog` 的关联。
4. **新增审计模型**: 创建 `PayinAuditLog` 和 `DepositAuditLog` 表，用于记录每一笔状态变更的历史。

## 后端逻辑同步修改
1. **DTO 更新**:
   - 修改 `payin.dto.ts` 和 `deposit-transaction.dto.ts`，导出枚举并更新属性名（`toWalletId`）。
2. **Service 重构**:
   - **PayinsService**: 在 `updateStatus` 时自动写入 `PayinAuditLog`。
   - **DepositTransactionsService**: 
     - 修改 `createFromPayin`，在创建时同步 `payinId` 并拍摄 `toAddress`/`toIban` 快照。
     - 更新 `updateStatus` 以记录 `DepositAuditLog`。
   - **DepositWorkflowService**: 更新工作流引擎，确保 Payin 到 Deposit 的状态联动适配新的字段结构。
   - **JournalsService**: 修正所有引用 `DepositTransaction.walletId` 的财务分录逻辑。

## 前端与测试适配
1. **管理端 (Admin Web)**: 
   - 搜索并替换 `DepositTransactionDetail.tsx` 等页面中的 `walletId` 为 `toWalletId`。
   - 在详情页展示 `toAddress`/`toIban` 快照及审计日志列表。
2. **测试用例**: 更新 `deposit-transactions.service.spec.ts` 等测试脚本，确保所有自动化测试通过。

## 验证步骤
1. 执行 `npx prisma generate` 更新客户端。
2. 运行 `npm test` 验证后端逻辑一致性。
3. 检查前端编译是否通过。
