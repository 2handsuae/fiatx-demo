# 调整 Payin 与 Deposit 状态机流转计划

我将按照您的要求，对 Payin（物理入账）和 DepositTransaction（充值交易）的状态机进行重构，并实现完全的手动控制与隔离。

## **1. 后端重构 (NestJS)**

### **状态机定义更新**

* **Payin**:

  * 状态：`DETECTED`, `CONFIRMING`, `CONFIRMED`, `CLEARED`, `FAILED`。

  * 动作：`confirm`, `fail`, `clear`, `seen_in_memopool`。

* **Deposit**:

  * 状态：`PAYIN_PENDING`, `COMPLIANCE_PENDING`, `SUCCESS`, `FLAGGED`, `REJECTED`。

  * 动作：`payin_cleared`, `success`, `flag`, `reject`。

### **业务逻辑调整**

* **隔离工作流**：在 [deposit-workflow.service.ts](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/src/modules/workflows/deposit-workflow.service.ts) 中注释掉事件监听器，确保两个主体的状态变更互不干扰，且不触发记账逻辑。

* **批量生成 Demo 数据**：修改 [deposit-transactions.service.ts](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/src/modules/deposit-transactions/deposit-transactions.service.ts) 的 `createRandom` 方法，使其一次性生成 10 条随机充值记录。

* **更新状态转换引擎**：在 `PayinsService` 和 `DepositTransactionsService` 中实现新的 `getNextStatus` 逻辑。

## **2. 前端重构 (React/Admin Web)**

### **手动流转控制**

* **详情页增强**：在 [PayinDetail.tsx](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/admin-web/src/pages/PayinDetail.tsx) 和 [DepositTransactionDetail.tsx](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/admin-web/src/pages/DepositTransactionDetail.tsx) 中，根据当前状态动态显示“可执行动作”按钮。

* **状态配色更新**：同步更新所有列表页和详情页的状态标签颜色，以适配新的状态。

### **列表页功能调整**

* **Deposit 列表**：将“Create New”按钮功能更改为“生成 10 条 Demo 数据”，并更新表格中的操作列按钮。

## **3. 验证步骤**

1. 运行 `npx prisma generate` 确保后端类型同步。
2. 通过 Admin 界面手动点击按钮，验证 Payin 和 Deposit 的状态机流转是否符合预期。
3. 确认在 Payin 状态变更时，Deposit 状态保持不变（验证隔离性）。

**确认以上计划后，我将立即开始执行代码修改。**
