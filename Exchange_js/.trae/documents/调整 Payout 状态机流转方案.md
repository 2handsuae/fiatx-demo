# 调整 Payout 状态机流转方案

新方案逻辑清晰且严谨，没有硬伤。它增强了虚拟币签名的中间状态，并为法币增加了更灵活的退回逻辑。

## **1. 方案对比分析**

### **虚拟币 (Crypto)**
*   **新增状态**: 引入了 `SIGNING` (签名中) 状态，使流程更符合多签或异步签名的实际场景。
*   **动作调整**: 
    *   `SEEN_ONCHAIN` 更名为 `seen_in_mempool`。
    *   `DROPPED` 动作更名为 `drop`。
*   **路径增强**: 增加了 `BROADCASTED` 和 `CONFIRMING` 状态下超时 (`timeout`) 或失败 (`fail`) 的流转。

### **法币 (Fiat)**
*   **路径增强**: 允许 `CONFIRMED` (已确认) 直接流转到 `RETURNED` (已退回)，而不仅限于 `CLEAR` (已结算) 之后。
*   **简化流转**: 明确了从 `CREATED` 到 `CONFIRMING` 的 `submit` 动作。

## **2. 执行修改计划**

### **第一阶段：后端代码调整**
1.  **更新 DTO ([payout.dto.ts](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/src/modules/payouts/dto/payout.dto.ts))**:
    *   在 `PayoutAction` 中重命名或新增动作：`SEEN_IN_MEMPOOL`, `DROP`, `SIGN_FAIL`, `SUBMIT` 等。
2.  **重构状态转移规则 ([payouts.service.ts](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/src/modules/payouts/payouts.service.ts))**:
    *   根据新的状态机图表完全重写 `CRYPTO_TRANSITIONS` 和 `FIAT_TRANSITIONS` 常量。

### **第二阶段：管理后台 UI 适配**
1.  **更新列表与详情页**:
    *   修改 [PayoutDetail.tsx](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/admin-web/src/pages/PayoutDetail.tsx) 和 [PayoutList.tsx](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/admin-web/src/pages/PayoutList.tsx) 中的 `getPayoutActions` 函数。
    *   更新按钮的 `action` 键值、显示标签（Label）以及颜色/图标配置，确保与后端枚举一致。

### **第三阶段：验证**
1.  **手动测试**: 在管理后台分别创建虚拟币和法币 Payout，点击操作按钮验证状态流转是否符合预期。

**请确认以上方案，确认后我将开始执行修改。**
