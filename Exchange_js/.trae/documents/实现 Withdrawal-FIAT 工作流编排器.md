## 任务目标
实现 **Withdrawal-FIAT Workflow Orchestrator**，负责编排法币提现（Withdrawal）、打款（Payout）、会计分录（Journal Entry）和清分（Clearing）之间的交互流转，确保流程的幂等性和跨域调用的隔离，特别处理法币退票（RETURNED）逻辑。

## 技术方案

### 1. 基础支撑更新
- **事件常量扩展**：
    - 在 [withdraw-events.constant.ts](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/src/modules/withdraw-transactions/constants/withdraw-events.constant.ts) 中增加法币专用事件：`EVT_WITHDRAWAL_APPROVED__FIAT`、`EVT_WITHDRAWAL_SUCCESS__FIAT`、`EVT_WITHDRAWAL_FAILED__FIAT`、`EVT_WITHDRAWAL_RETURNED__FIAT`。
    - 在 [payout-events.constant.ts](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/src/modules/payouts/constants/payout-events.constant.ts) 中增加 `EVT_PAYOUT_RETURNED`。
- **服务逻辑调整**：
    - 修改 [withdraw-transactions.service.ts](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/src/modules/withdraw-transactions/withdraw-transactions.service.ts) 在法币审批通过时发送 `EVT_WITHDRAWAL_APPROVED__FIAT`。
    - 修改 [payouts.service.ts](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/src/modules/payouts/payouts.service.ts) 在打款状态变为 `RETURNED` 时发送 `EVT_PAYOUT_RETURNED`。

### 2. 编排逻辑实现
创建 `WithdrawFiatWorkflowOrchestrator` 类，核心编排规则如下：

- **提现创建/取消/拒绝 (CREATED/CANCELLED/REJECTED)**：
    - 仅针对 CUSTOMER 触发会计分录（锁定或冲销锁定）。
- **提现审批通过 (APPROVED)**：
    - 发送 `EVT_WITHDRAWAL_APPROVED__FIAT`。
    - 触发清分（Clearing）逻辑。
    - 创建并绑定法币打款记录（Payout），将提现状态更新为 `PAYOUT_PENDING`。
- **打款终态处理 (Payout Terminal)**：
    - **打款成功 (CLEAR)**：提现标记为 `SUCCESS`，如果是客户则完成资产转移记账。
    - **打款失败/超时 (FAILED/TIMEOUT)**：提现标记为 `FAILED`，如果是客户则冲销审批阶段的资产影响。
    - **退票处理 (RETURNED)**：提现标记为 `RETURNED`，如果是客户则执行全单冲销：查找该 `withdraw_id` 下的所有 Journal Entries 并逐一调用 `reverseJournal`，确保资金恢复且手续费清零。

### 3. 核心约束保证
- **幂等性**：通过提现状态及审计日志校验，确保每个阶段仅处理一次。
- **跨域隔离**：严禁 Service 间直接调用，所有交互由 Orchestrator 负责。
- **客户过滤**：所有记账操作前强制检查 `owner_type === 'CUSTOMER'`。

## 实施步骤
1. 更新提现和打款的事件常量定义。
2. 调整 `WithdrawTransactionsService` 和 `PayoutsService` 的事件触发点。
3. 实现 `WithdrawFiatWorkflowOrchestrator` 核心编排逻辑。
4. 在 `WorkflowsModule` 中注册新编排器。
5. 验证法币提现的全链路流转，特别是退票时的全单冲销逻辑。

请确认此方案，确认后我将开始实施。