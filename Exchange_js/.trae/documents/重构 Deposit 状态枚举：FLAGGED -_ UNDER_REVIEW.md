# 重构计划：将 Deposit 状态从 FLAGGED 修改为 UNDER_REVIEW

我将按照以下步骤完成全量重构，确保前后端及状态机逻辑的一致性：

## **1. 后端重构 (NestJS)**
* **修改 [deposit-transaction.dto.ts](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/src/modules/deposit-transactions/dto/deposit-transaction.dto.ts)**: 
  - 将 `DepositTransactionStatus` 枚举中的 `FLAGGED` 重命名为 `UNDER_REVIEW`。
  - 将对应的字符串值从 `'FLAGGED'` 修改为 `'UNDER_REVIEW'`。
* **修改 [deposit-transactions.service.ts](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/src/modules/deposit-transactions/deposit-transactions.service.ts)**:
  - 更新 `getNextStatus` 方法中的状态转换映射。
  - 同步更新方法上方的 Mermaid 状态机注释。

## **2. 前端重构 (Admin Web)**
* **修改 [DepositTransactionList.tsx](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/admin-web/src/pages/DepositTransactionList.tsx)**:
  - 更新状态过滤下拉框的 `<option>` 值与文本。
  - 更新 `renderStatusBadge` 的配色映射。
  - 更新 `getAvailableActions` 的状态判断逻辑。
* **修改 [DepositTransactionDetail.tsx](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/admin-web/src/pages/DepositTransactionDetail.tsx)**:
  - 更新 `renderStatusBadge` 的配色映射。
  - 更新 `getAvailableActions` 的状态判断逻辑。

## **3. 验证与回归**
* **运行单元测试**: 执行 `npm test src/modules/deposit-transactions/` 确保状态机流转依然符合预期。
* **类型检查**: 运行 `npx prisma generate` 并确认后端服务启动无误。
* **手动验证**: 在管理后台验证“待审核”状态的显示及后续流转按钮是否正常。

**注意**: 数据库层面的 `deposit_transactions` 表中 `status` 为 `String` 类型。重构完成后，代码将无法识别旧的 `'FLAGGED'` 字符串。如果数据库中已有存量数据，建议执行批量更新。

**确认计划后，我将立即开始执行。**
