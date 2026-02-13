# 重构充值工作流编排器 (Deposit Workflow Orchestrator)

我将重写 `DepositWorkflowService`，使其严格遵循编排规则、幂等性要求和结构化输出。

## **1. 核心编排逻辑优化**

* **结构化输出**: 每次触发（`handlePayinStatusChanged` 或 `handleDepositStatusChanged`）都将返回包含以下字段的对象：
  * `updated_payin_status`
  * `updated_deposit_status`
  * `emitted_events[]`
  * `created_or_reversed_journal_entry_ids[]`
  * `audit_log_id`

* **顺序执行与约束**:
  * 在 `PayIn` 进入 `CONFIRMED` 时，确保事件发送和（如适用）记账成功后，再调用 `PayinsService` 设置 `CLEARED`。
  * 记账逻辑仅针对 `deposit.owner_type === 'CUSTOMER'` 执行。

## **2. 幂等性与审计强化**

* **幂等检查**: 实现一个内部方法 `isAlreadyProcessed(entityId, stepName)`。
  * 利用 `DepositAuditLog` 或 `PayinAuditLog` 的 `reason` 字段记录特定步骤的标记（例如 `[ORCH_CONFIRMED]`），防止同一状态转移被多次编排。
* **后缀计算**: 严格按照 `payin.type`（映射 `fiat` -> `FIAT`, `crypto` -> `CRYPTO`）计算事件后缀。

## **3. 监听源实现细则**

### **A. PayIn 状态变更监听**
1. **DETECTED**: 
   * 确保 `Deposit` 存在（不存在则创建）。
   * 调用 `DepositService` 设置状态为 `PAYIN_PENDING`。
2. **FAILED**: 
   * 调用 `DepositService` 设置状态为 `FAILED`。
3. **CONFIRMED**: 
   * 调用 `DepositService` 设置状态为 `COMPLIANCE_PENDING`。
   * 发出 `EVT_DEPOSIT_CONFIRMED__{suffix}`。
   * **(JE)**: 若为 `CUSTOMER`，创建记账凭证。
   * **CLEARED**: 只有在上述成功后，调用 `PayinsService` 设置 `CLEARED`。

### **B. Deposit 状态变更监听**
1. **SUCCESS**: 
   * 发出 `EVT_DEPOSIT_SUCCESS__{suffix}`。
   * **(JE)**: 若为 `CUSTOMER`，创建记账凭证。

## **4. 验证与交付**

* **禁止跨域**: 再次核查 `PayInsService` 和 `DepositTransactionsService` 的实现，确保它们之间没有直接调用。
* **测试路径**: 验证 `CONFIRMED -> CLEARED` 的顺序性，以及 `CUSTOMER` 与非 `CUSTOMER` 在记账上的差异。

**请确认以上重构逻辑，确认后我将开始实现。**
