## Payout 状态机实现计划

我们将为 Payout 模块实现一套完整的状态机管理机制，涵盖虚拟币（CRYPTO）和法币（FIAT）两种业务场景，并更新后台管理界面。

### 1. 后端实现 (NestJS)

#### 1.1 更新 DTO 与 常量定义
- 在 [payout.dto.ts](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/src/modules/payouts/dto/payout.dto.ts) 中扩展 `PayoutStatus` 枚举：
  - 共有状态：`CREATED`, `CONFIRMING`, `CONFIRMED`, `CLEAR`, `FAILED`, `TIMEOUT`
  - 虚拟币特有：`SIGNING`, `BROADCASTED`
  - 法币特有：`RETURNED`
- 更新 `UpdatePayoutStatusDto` 以支持可选的 `action` 参数。

#### 1.2 完善状态流转逻辑
- 在 [payouts.service.ts](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/src/modules/payouts/payouts.service.ts) 中：
  - 定义 `CRYPTO_TRANSITIONS` 和 `FIAT_TRANSITIONS` 映射表。
  - 修改 `create` 方法，将初始状态由 `PENDING` 改为 `CREATED`。
  - 修改 `updateStatus` 方法，增加状态流转合法性校验，并记录审计日志。

#### 1.3 增加 Mock 数据生成接口
- 在 [payouts.controller.ts](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/src/modules/payouts/payouts.controller.ts) 中：
  - 新增 `POST /payouts/mock` 接口，用于随机生成 3 条 Payout 数据（包含不同类型和随机金额）。

### 2. 前端实现 (React + Tailwind)

#### 2.1 更新列表页按钮逻辑
- 修改 [PayoutList.tsx](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/admin-web/src/pages/PayoutList.tsx)：
  - 根据 Payout 的 `type` (CRYPTO/FIAT) 和 `status` 动态计算可执行的操作按钮。
  - 虚拟币操作：`Sign`, `Broadcast`, `Seen Onchain`, `Confirm`, `Clear`, `Fail`, `Timeout` 等。
  - 法币操作：`Submit`, `Confirm`, `Clear`, `Return`, `Fail`, `Timeout` 等。
  - 为不同操作配置不同的颜色和图标，提升交互体验。

#### 2.2 实现 Mock 数据生成功能
- 在列表页顶部添加 “Create 3 Mock Payouts” 按钮。
- 点击按钮后调用后端 Mock 接口，并自动刷新列表。

### 3. 验证
- 手动点击按钮测试每种状态流转是否符合预定义的 Mermaid 图表。
- 检查 `payout_audit_logs` 表是否正确记录了每一次状态变更及其原因。

是否按照此计划开始执行？
