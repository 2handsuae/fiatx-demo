# 修改 Swap 交易状态机流转方案

新方案逻辑清晰，没有硬伤。它简化了流程，去除了初始的 `CREATED` 状态（创建即进入合规审核），并引入了 `UNDER_REVIEW` 状态以支持人工标记复审。

## **1. 方案对比分析**

| 特性 | 当前方案 | 新方案 |
| :--- | :--- | :--- |
| **起始状态** | `CREATED` | `PENDING_COMPLIANCE` |
| **新增状态** | 无 | `UNDER_REVIEW` (复审中) |
| **动作命名** | `START_COMPLIANCE`, `COMPLIANCE_PASS`, `COMPLIANCE_REJECT` | `success`, `reject`, `flag` |
| **终止状态** | `SUCCESS`, `REJECTED` (支持重开) | `SUCCESS`, `REJECTED` (严格终止) |

## **2. 执行修改计划**

### **第一阶段：后端定义与逻辑修改**
1. **DTO 更新**: 
   - 在 `SwapTransactionStatus` 中添加 `UNDER_REVIEW`，移除 `CREATED`（或将其标记为弃用）。
   - 在 `SwapTransactionAction` 中新增 `SUCCESS`, `REJECT`, `FLAG` 动作。
2. **Service 修改**: 
   - 更新 `SwapTransactionsService.create` 方法，将新交易的初始状态设为 `PENDING_COMPLIANCE`。
3. **Orchestrator 修改**: 
   - 更新 `getNextStatus` 方法，实现 `PENDING_COMPLIANCE` -> `UNDER_REVIEW` / `SUCCESS` / `REJECTED` 以及 `UNDER_REVIEW` -> `SUCCESS` / `REJECTED` 的流转逻辑。
   - 调整 `handleStatusTransition` 中的事件触发逻辑。

### **第二阶段：前端 UI 适配**
1. **列表页 (`SwapTransactionList.tsx`)**:
   - 更新状态过滤器，加入 `UNDER_REVIEW`。
   - 更新 `getAvailableActions`，适配新的动作按钮。
2. **详情页 (`SwapTransactionDetail.tsx`)**:
   - 更新操作按钮组，支持 `success`, `reject`, `flag`。
   - 更新状态标签（Badge）的配色，为 `UNDER_REVIEW` 分配黄色/橙色。

### **第三阶段：测试与验证**
1. **单元测试**: 重构 `swap-orchestrator.spec.ts`，确保覆盖所有新的路径。
2. **手动验证**: 在管理后台模拟一笔 Swap 交易，测试完整的合规审核流转。

**请确认以上方案，确认后我将开始执行修改。**
