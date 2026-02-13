# Swap 工作流编排器实现方案

## 1. 核心定义
- **Events**: 定义 `EVT_SWAP_CREATED`, `EVT_SWAP_SUCCESS`, `EVT_SWAP_REJECTED`。
- **Actions**: 定义 `START_COMPLIANCE`, `COMPLIANCE_PASS`, `COMPLIANCE_REJECT`。

## 2. 逻辑实现 (SwapTransactionsService)
- **R0 (Create)**: 状态设为 `CREATED`，发出 `EVT_SWAP_CREATED`。
- **R1 (Start Compliance)**: 状态从 `CREATED` 迁至 `PENDING_COMPLIANCE`。
- **R2 (Pass)**: 状态从 `PENDING_COMPLIANCE` 迁至 `SUCCESS`，发出 `EVT_SWAP_SUCCESS`。
- **R3 (Reject)**: 状态从 `PENDING_COMPLIANCE` 迁至 `REJECTED`，发出 `EVT_SWAP_REJECTED`。

## 3. 约束保证
- **跳转校验**: 使用状态机映射表，禁止非法跳转（如 SUCCESS -> PENDING_COMPLIANCE）。
- **幂等性**: 基于状态变更触发事件，确保同状态下事件不重发。
- **审计记录**: 每次操作写入 `SwapTransactionAuditLog`。

## 4. 输出格式
所有操作返回结构体：
```json
{
  "swap_status_after": "...",
  "emitted_events": ["..."],
  "audit_log_id": "..."
}
```

请确认是否开始执行？