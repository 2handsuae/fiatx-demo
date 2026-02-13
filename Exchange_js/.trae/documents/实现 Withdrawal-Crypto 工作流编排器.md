## 任务目标
实现 **Withdrawal-Crypto Workflow Orchestrator**，负责编排提现（Withdrawal）、打款（Payout）、会计分录（Journal Entry）和清分（Clearing）之间的交互流转，确保流程的幂等性和跨域调用的隔离。

## 技术方案

### 1. 基础支撑
- **事件定义**：创建 `WithdrawEvents` 和 `PayoutEvents` 常量，统一管理流程中的各个触发点。
- **清分引擎增强**：在 [clearings.service.ts](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/src/modules/clearing/clearings.service.ts) 中实现 `triggerClearing` 方法，支持根据模板自动生成清分记录，并保证幂等性。

### 2. 编排逻辑实现
创建 `WithdrawCryptoWorkflowOrchestrator` 类，核心编排规则如下：

- **提现创建 (CREATED)**：
    - 发送 `EVT_WITHDRAWAL_CREATED` 事件。
    - 如果是 CUSTOMER 身份，触发会计分录锁定用户资金。
- **提现取消/拒绝 (CANCELLED/REJECTED)**：
    - 发送对应事件。
    - 如果是 CUSTOMER 身份，触发冲销分录，释放锁定的资金。
- **提现审批通过 (APPROVED)**：
    - 发送 `EVT_WITHDRAWAL_APPROVED__CRYPTO` 事件。
    - 触发清分（Clearing）逻辑生成分账记录。
    - 创建并绑定打款记录（Payout），建立 1:1 关联。
    - 将提现状态更新为 `PAYOUT_PENDING`。
- **打款终态处理 (Payout Terminal)**：
    - 监听打款状态变化：
        - **打款成功 (CLEAR)**：提现标记为 `SUCCESS`，发送成功事件，如果是客户则完成最终资产转移记账。
        - **打款失败/超时 (FAILED/TIMEOUT)**：提现标记为 `FAILED`，发送失败事件，如果是客户则回滚审批阶段的资产影响并恢复资金。

### 3. 核心约束保证
- **幂等性**：通过 `WithdrawAuditLog` 校验 `(withdrawal_id, event_type)`，确保每个环节只成功处理一次。
- **跨域隔离**：所有跨 Service 调用（如 Withdrawal -> Payout）仅在 Orchestrator 中进行，各 Service 保持原子性。

## 实施步骤
1. 定义提现与打款的事件常量文件。
2. 完善 `ClearingsService`，增加清分触发与记录创建逻辑。
3. 编写 `WithdrawCryptoWorkflowOrchestrator` 核心逻辑，并注册到 `WorkflowsModule`。
4. 在提现和打款服务的状态更新处集成 Orchestrator 的调用或事件触发。
5. 验证提现全流程的闭环（从创建到打款成功/失败）。

请确认以上方案，完成后我将开始编码实现。