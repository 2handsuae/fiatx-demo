# 实施通用提现工作流编排器 (Withdrawal Workflow Orchestrator)

我将重组提现工作流，创建一个通用的 `WithdrawWorkflowOrchestrator`，统一处理虚拟币和法币的提现逻辑，并严格遵守您提出的编排规则、幂等性要求以及结构化输出规范。

## **1. 核心逻辑调整**

### **集中式编排**
- 创建 `WithdrawWorkflowOrchestrator`，合并原有的 `WithdrawFiatWorkflowOrchestrator` 和 `WithdrawCryptoWorkflowOrchestrator`。
- **禁止跨域调用**: 编排器将作为唯一的胶水层，直接调用各域 Service（Withdrawal, Payout, Event, JournalEntry, Clearing）。

### **状态流转规则实施**
- **CREATED**: 发送 `EVT_WITHDRAWAL_CREATED` 事件；若为 `CUSTOMER`，触发锁定资金记账。
- **CANCELLED / REJECTED**: 发送对应事件；若为 `CUSTOMER`，触发冲销锁定记账。
- **APPROVED (进入 PAYOUT_PENDING)**: 
    - 发送 `EVT_WITHDRAWAL_APPROVED__{suffix}`。
    - 触发清算逻辑（Clearing）。
    - 创建并绑定 Payout 记录。
    - 将提现单状态设为 `PAYOUT_PENDING`。
- **Payout 回推处理**:
    - **成功 (CONFIRMED)**: 提现单设为 `SUCCESS` -> 发送成功事件 -> 记账 (if CUSTOMER) -> Payout 设为 `CLEAR`。
    - **失败/超时 (FAILED/TIMEOUT)**: 提现单设为 `FAILED` -> 发送失败事件 -> **全量回滚** 所有关联记账 (if CUSTOMER) -> 取消清算记录。
    - **法币退回 (RETURNED)**: 提现单设为 `RETURNED` -> 发送退回事件 -> **全量回滚** 所有关联记账 (if CUSTOMER)。

### **幂等性与记账约束**
- 基于 `(withdrawal_id, event_type)` 的强幂等校验，防止重复处理。
- 仅当 `withdrawal.owner_type = CUSTOMER` 时执行记账逻辑。
- 根据 `withdrawal.type` 动态决定事件后缀 (`CRYPTO` 或 `FIAT`)。

## **2. 执行步骤**

1. **定义接口**: 在新编排器中定义 `OrchestrationResult` 接口，支持要求的结构化输出。
2. **实现新编排器**: 在 `src/modules/workflows/withdraw-workflow.orchestrator.ts` 中实现全量逻辑。
3. **迁移与清理**:
    - 更新 `WorkflowsModule` 以注册新编排器并移除旧编排器。
    - 删除 `withdraw-fiat-workflow.orchestrator.ts` 和 `withdraw-crypto-workflow.orchestrator.ts`。
4. **验证**: 确保所有状态变更均记录审计日志并输出要求的 JSON 结果。

**请确认以上方案，确认后我将开始执行。**
