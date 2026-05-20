# Deposit V4 Happy Path — Frontend + Backend Design Spec

## Goal

走通存款 happy path 的端到端模拟，同时将前端页面对齐 V4 状态机。

1. **前端**：admin/client 存款页面对齐 V4 状态机（9 状态 9 动作），遵循前端设计规范（`adm-*`/`fx-*` tokens、两栏布局、ActionSection）。
2. **后端**：接通 Sumsub → deposit 的合规链路（三道闸门：客户合规状态 + KYT + TR），实现自动审批。
3. **模拟**：端到端 happy path — 客户创建存款 → payin 推进 → KYT/TR 通过 → 自动到账。

**本轮聚焦 happy path**（PAYIN_PENDING → COMPLIANCE_PENDING → SUCCESS）。非 happy path 功能（SimulationRail、freeze/confiscate 流程）为低优先级。

---

## 1. Happy Path 端到端模拟（Crypto）

| 步骤 | 位置 | 操作 | 系统效果 |
|------|------|------|---------|
| 1 | Client-web 充值页 | 点击 "Simulate Deposit" | 创建 inbound transfer signal → scan → payin（DETECTED）+ deposit（PAYIN_PENDING） |
| 2a | Admin PayinDetail | SimulationRail → advance to CONFIRMING | Payin DETECTED → CONFIRMING（MEMPOOL_SEEN） |
| 2b | Admin PayinDetail | SimulationRail → advance to CONFIRMED | Payin CONFIRMING → CONFIRMED → `@OnEvent('payin.status.changed')` 触发 `orchestratePayinConfirmed` |
| — | （自动） | TB Step 1 + 状态转换 | TB: debit CUSTODY（资产↑）, credit CLIENT_AUDIT（负债↑）→ deposit COMPLIANCE_PENDING → payin CLEARED |
| — | （自动） | Gate 0：客户合规状态检查 | 客户正常 → travelRuleRequired=true, travelRuleStatus=PENDING。_（异常 → FROZEN）_ |
| 3a | Admin Sumsub Events | `simulate/kyt-check`：输入 txHash，结果 PASS | Gate 1：kytStatus → PASSED。审批门检查：TR 仍 PENDING → 等待 |
| 3b | Admin Sumsub Events | `simulate/tr-check`：输入 txHash，结果 PASS | Gate 2：travelRuleStatus → PASSED。三道闸门全绿 → `approveDeposit()` → TB Step 2 + deposit SUCCESS |

**TB 记账方向**：
- **Step 1**（Payin CONFIRMED）：debit CUSTODY（资产增加 — 交易所收到钱）, credit CLIENT_AUDIT（负债增加 — 暂挂）
- **Step 2**（Deposit APPROVED）：debit CLIENT_AUDIT（负债减少 — 暂挂清零）, credit CLIENT_CREDIT（负债增加 — 客户可用余额）
- **最终结果**：CUSTODY ↑，CLIENT_CREDIT ↑（都增加）。CLIENT_AUDIT 净零。

**步骤 3b 完成后**：deposit 为 SUCCESS，TB 记账完整（Step 1 + Step 2 均已记录）。

---

## 2. 三道闸门合规架构

```
COMPLIANCE_PENDING
  │
  ├── Gate 0：客户合规状态（自动，进入 COMPLIANCE_PENDING 时立即检查）
  │     ✗ 异常（FROZEN/SUSPENDED 等） → deposit 冻结为 FROZEN
  │     ✓ 正常 → 继续，设置 travelRuleRequired=true, travelRuleStatus=PENDING（kytStatus 已默认为 PENDING）
  │
  ├── Gate 1：KYT — Know Your Transaction（Sumsub 交易级检查）
  │     输入：deposit 的 txHash
  │     结果：PASSED / FAILED
  │
  ├── Gate 2：TR — Travel Rule（Sumsub 交易级检查）
  │     输入：deposit 的 txHash
  │     结果：travelRuleStatus = PASSED / FAILED
  │
  └── 自动审批：仅当 deposit 仍在 COMPLIANCE_PENDING 且三门全绿
```

### 核心原则

- **Gate 0 冻结自动审批，不冻结信息采集**。KYT/TR 结果始终写入，无论 deposit 状态。
- **自动审批仅在以下条件全部满足时触发**：
  - deposit 状态为 `COMPLIANCE_PENDING`（非 FROZEN）
  - 客户 complianceStatus 正常
  - kytStatus === `PASSED`
  - travelRuleStatus === `PASSED`
- **FROZEN deposit 接受 KYT/TR 结果但不自动转换**。Admin 在详情页看到三道闸门的完整信息后手动 approve/confiscate。

### 审批门检查逻辑

每次事件（Gate 0 结果、KYT webhook、TR webhook）后执行：

```typescript
function checkAutoApproval(deposit, customer) {
  if (deposit.status !== 'COMPLIANCE_PENDING') return;
  if (!isNormalComplianceStatus(customer.complianceStatus)) return;
  if (deposit.kytStatus !== 'PASSED') return;
  if (deposit.travelRuleStatus !== 'PASSED') return;
  await approveDeposit(deposit.id); // TB Step 2 + SUCCESS
}
```

---

## 3. V4 状态机参考

### 9 个状态

| 状态 | 终态? | 说明 |
|------|------|------|
| PAYIN_PENDING | 否 | 等待 payin 系统确认 |
| COMPLIANCE_PENDING | 否 | Sumsub 合规审查中 |
| ACTION_PENDING | 否 | 标记需额外审查/补充材料 |
| FROZEN | 否 | 资金冻结，等待法律裁定 |
| SUCCESS | 是 | 到账成功 |
| REJECTED | 是 | 合规拒绝 |
| FAILED | 是 | 技术/系统失败 |
| EXPIRED | 是 | 超时 |
| CONFISCATED | 是 | 依法没收 |

### 状态转换图

```
PAYIN_PENDING ──payin_confirmed──→ COMPLIANCE_PENDING
PAYIN_PENDING ──fail──────────────→ FAILED

COMPLIANCE_PENDING ──(auto-approve)─→ SUCCESS        (三门全绿)
COMPLIANCE_PENDING ──reject─────────→ REJECTED       (Sumsub webhook)
COMPLIANCE_PENDING ──freeze─────────→ FROZEN         (Sumsub webhook / Gate 0)
COMPLIANCE_PENDING ──action_pending─→ ACTION_PENDING (Sumsub webhook)
COMPLIANCE_PENDING ──fail───────────→ FAILED

ACTION_PENDING ──approve──→ SUCCESS            (Sumsub webhook)
ACTION_PENDING ──reject───→ REJECTED           (Sumsub webhook)
ACTION_PENDING ──freeze───→ FROZEN             (Sumsub webhook)
ACTION_PENDING ──resume───→ COMPLIANCE_PENDING (Sumsub webhook)
ACTION_PENDING ──expire───→ EXPIRED            (系统 cron / 操作员)

FROZEN ──approve────→ SUCCESS      (法务/操作员手动)
FROZEN ──confiscate─→ CONFISCATED  (法务/操作员手动)
```

### 动作触发来源

| 动作 | 触发来源 | 说明 |
|------|---------|------|
| payin_confirmed | Payin 系统 webhook | 收款确认 |
| approve | 三门全绿自动 / 手动（仅 FROZEN） | 到账审批 |
| reject | Sumsub webhook | 合规拒绝 |
| freeze | Sumsub webhook / Gate 0 | 资金冻结 |
| action_pending | Sumsub webhook | 标记需补充材料 |
| resume | Sumsub webhook | 补充材料后恢复审查 |
| confiscate | 法务/操作员手动 | 依法没收 |
| expire | 系统 cron / 操作员手动 | 超时过期 |
| fail | 系统错误 | 技术失败 |

---

## 4. 后端变更

### 4.1 Prisma 模型 — 已有字段，无需迁移

DepositTransaction 模型已有以下字段（schema.prisma L1484-1492）：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `kytStatus` | String | `"PENDING"` | KYT 检查状态 |
| `kytScreeningId` | String? | — | Sumsub KYT screening ID |
| `kytRiskScore` | Int? | — | KYT 风险评分 |
| `kytCheckedAt` | DateTime? | — | KYT 检查时间 |
| `travelRuleRequired` | Boolean | `false` | 是否需要 Travel Rule |
| `travelRuleStatus` | String | `"NOT_REQUIRED"` | TR 检查状态 |
| `travelRuleTransferId` | String? | — | Sumsub TR transfer ID |
| `counterpartyVasp` | String? | — | 对手方 VASP |
| `travelRuleCheckedAt` | DateTime? | — | TR 检查时间 |

**无需数据库迁移。**

### 4.2 Gate 0：客户合规状态检查

**触发时机**：deposit 进入 COMPLIANCE_PENDING 时（`@OnEvent('deposit.status.changed')`）。

**逻辑**：
- 查询 customer.complianceStatus
- 异常（FROZEN / SUSPENDED 等）→ 立即冻结 deposit（action=freeze，reason=`customer compliance status: {status}`）
- 正常 → 设置 travelRuleRequired=true, travelRuleStatus=PENDING（kytStatus 已默认 PENDING，无需重复设置）

### 4.3 KYT/TR 模拟端点

| 端点 | 输入 | 效果 |
|------|------|------|
| `POST /admin/sumsub/simulate/kyt-check` | `{ txHash, result: 'PASS' \| 'FAIL' }` | 按 txHash 找到 deposit → 更新 kytStatus → 执行审批门检查 |
| `POST /admin/sumsub/simulate/tr-check` | `{ txHash, result: 'PASS' \| 'FAIL' }` | 按 txHash 找到 deposit → 更新 travelRuleStatus → 执行审批门检查 |

两个端点均可对任意状态的 deposit 写入结果（包括 FROZEN），但自动审批仅对 COMPLIANCE_PENDING 生效。

### 4.4 FROZEN 保护规则

- Sumsub webhook **不得**自动转换 FROZEN 状态的 deposit
- FROZEN deposit 的 KYT/TR 结果照常记录，供 admin 审查
- 仅手动 admin 操作可转换 FROZEN（approve 释放 / confiscate 没收）

### 4.5 后端文件清单

| 文件 | 变更 |
|------|------|
| `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts` | 新增 `simulateKytCheck()`、`simulateTrCheck()` |
| `src/modules/trading/deposit-transactions/deposit-workflow.service.ts` | 新增 Gate 0 检查 + `checkAutoApproval()` |
| `src/modules/trading/deposit-transactions/deposit-transactions.service.ts` | 新增 L1 方法：`initializeComplianceGates()`、`updateKytStatus()`、`updateTravelRuleStatus()`、`getOwnerComplianceStatus()` |

---

## 5. Admin 存款列表页

**文件**：`admin-web/src/pages/DepositTransactionList.tsx`

### 变更

1. **状态 badge 颜色映射** — 去掉 UNDER_REVIEW，加入全部 9 个 V4 状态：

| 状态 | 颜色语义 |
|------|---------|
| PAYIN_PENDING | blue |
| COMPLIANCE_PENDING | purple |
| ACTION_PENDING | amber |
| SUCCESS | green |
| REJECTED | red |
| FAILED | orange |
| EXPIRED | gray |
| FROZEN | cyan |
| CONFISCATED | dark red |

2. **筛选下拉** — 更新为 9 个 V4 状态，移除 UNDER_REVIEW
3. **共享工具** — 更新 `transactionRootDisplay.ts` 的 `formatStatusLabel()` 支持 9 个状态

---

## 6. Admin 存款详情页（核心重构）

**文件**：`admin-web/src/pages/DepositTransactionDetail.tsx`

### 两栏布局

```
┌──────────────────────────────────────────┬─────────────────┐
│ DetailPageHeader（仅 back nav）            │                 │
├──────────────────────────────────────────┤  272px Sidebar   │
│ [SimulationRail — 仅模拟模式，低优先级]     │                 │
│                                          │ ┌─────────────┐ │
│ Hero Zone                                │ │ Actions     │ │
│  状态 badge（大号）+ 金额 + 资产 + 类型     │ │ (workflow)   │ │
│                                          │ └─────────────┘ │
│ Core Context                             │ ┌─────────────┐ │
│  ownerNo + 合规/onboarding 状态           │ │ Compliance  │ │
│  来源钱包 → 目标钱包                       │ │ Gates       │ │
│                                          │ └─────────────┘ │
│ Process / Timeline                       │ ┌─────────────┐ │
│  StatusTimeline（复用现有组件）              │ │ Identity    │ │
│                                          │ │ Summary     │ │
│ Technical Detail                         │ └─────────────┘ │
│  txHash, 地址, payinNo, traceId          │ ┌─────────────┐ │
│                                          │ │ Lifecycle   │ │
│                                          │ └─────────────┘ │
└──────────────────────────────────────────┴─────────────────┘
```

### 主体区域（信息梯度）

1. **Hero Zone**：depositNo、大号状态 badge、金额 + asset code、crypto/fiat 类型标签
2. **Core Context**：ownerNo（通过 customer 关联，**不显示 UUID**）、ownerType、complianceStatus、onboardingStatus、来源/目标钱包号（walletNo，非 UUID）
3. **Process/Timeline**：复用现有 StatusTimeline 组件渲染 `statusHistory` JSON，更新状态标签/颜色至 V4
4. **Technical Detail**：txHash、fromAddress、toAddress、fromIban、toIban、payinNo（可点击跳转 PayinDetail）、traceId、referenceNo

### Sidebar 组件

**顺序遵循 admin 规范：ACTIONS → COMPLIANCE GATES → IDENTITY → LIFECYCLE**

#### ActionSection（真实操作员动作）

仅在需要手动操作员决策的状态下显示：

| 当前状态 | 可用操作 | 按钮样式 |
|---------|---------|---------|
| ACTION_PENDING | expire | workflowSecondary |
| FROZEN | approve（释放）, confiscate（没收） | workflowPrimary, workflowNegative |
| 其他状态 | — | — |

- ACTION_PENDING 不需要 approve/reject — 客户通过 Sumsub SDK 上传材料后，Sumsub 重新评估并发 webhook 推进状态。resume 也不需要（COMPLIANCE_PENDING 是 Sumsub 驱动的，退回去会形成死循环）。
- `confiscate` 点击后弹出 reason 输入弹窗（同 SwapTransactionDetail 的 reject 模式）
- 调用 `PATCH /deposit-transactions/:id/status` `{ action, reason? }`

#### Compliance Gates（新增）

三道闸门状态一目了然：

- **Gate 0**：客户状态 — complianceStatus badge（ACTIVE / FROZEN / ...）
- **Gate 1**：KYT — kytStatus badge（PENDING / PASSED / FAILED）
- **Gate 2**：TR — travelRuleStatus badge（PENDING / PASSED / FAILED）

对 FROZEN deposit 尤为重要：admin 在 approve/confiscate 前看到完整的三门信息，做综合判断。

#### Identity Summary

- ownerNo（可点击 → 客户详情）
- ownerType
- complianceStatus badge
- onboardingStatus badge

#### Lifecycle

- 创建时间
- 完成时间（终态/冻结时）
- 当前状态持续时长

### 其他

- **DetailPageHeader**：不设置 title/subtitle（遵循 admin 规范），仅 back 导航。depositNo 展示在 Hero Zone。
- **路由**：保持 `/exchange/deposit-transactions/:id`
- **关联信息**：payinNo → 可点击跳转 PayinDetail；toWalletNo、fromWalletNo 显示业务键

---

## 7. Client 存款页

**文件**：`client-web/src/pages/Deposit.tsx`

### 防通风报信状态映射

客户不得被告知其交易正在合规审查、资金被冻结、或已提交可疑活动报告。内部状态映射为简化的客户视图：

| 内部状态 | 客户看到 | 颜色 | 原因 |
|---------|---------|------|------|
| PAYIN_PENDING | Processing | blue | 正常 — 等待到账 |
| COMPLIANCE_PENDING | Processing | blue | **遮掩** — 不能暴露合规审查 |
| ACTION_PENDING | Processing | blue | **遮掩** — 不能暴露标记状态 |
| FROZEN | Processing | blue | **遮掩** — 不能暴露资金冻结 |
| SUCCESS | Completed | green | 正常 |
| REJECTED | Declined | red | 拒绝原因必须通用化，不能提及 AML/制裁 |
| FAILED | Failed | orange | 技术失败 |
| EXPIRED | Expired | gray | 超时 |
| CONFISCATED | Contact Support | red | **遮掩** — 法律通知走线下渠道 |

**客户只看到 6 种状态**：Processing、Completed、Declined、Failed、Expired、Contact Support。

### 变更

1. 更新状态 badge 映射（移除 UNDER_REVIEW、HELD；加入上表 V4 映射）
2. 使用客户可理解的语言（遵循 `doc-final/rules/frontend-client.md`）
3. 模拟功能：保持现有 "Simulate Deposit" 流程不变（创建 inbound signal + scan）

---

## 8. SimulationRail（低优先级，非 happy path）

**组件**：复用 `admin-web/src/components/SimulationRail.tsx`

仅在 `simulationModeEnabled` 时显示（localStorage `admin_simulation_mode`），位于 Hero Zone 上方。

动态 rail items 基于当前状态构建，可点击的 available 节点直接 PATCH 状态（绕过事件链，仅用于 dev 快捷测试）。

本轮不作为交付要求。

---

## 9. 文件变更总览

### 后端（Happy Path 关键路径）

| 文件 | 操作 | 范围 | 优先级 |
|------|------|------|-------|
| `src/modules/trading/deposit-transactions/deposit-transactions.service.ts` | 修改 | 新增 L1 方法（initializeComplianceGates, updateKytStatus, updateTravelRuleStatus, getOwnerComplianceStatus） | 关键 |
| `src/modules/trading/deposit-transactions/deposit-workflow.service.ts` | 修改 | Gate 0 检查 + checkAutoApproval() | 关键 |
| `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts` | 修改 | 新增 simulateKytCheck()、simulateTrCheck() | 关键 |

### 前端

| 文件 | 操作 | 范围 | 优先级 |
|------|------|------|-------|
| `admin-web/src/pages/DepositTransactionList.tsx` | 修改 | V4 状态 badge、筛选下拉 | 高 |
| `admin-web/src/pages/DepositTransactionDetail.tsx` | 重写 | 两栏布局、ActionSection、Compliance Gates、V4 数据展示 | 高 |
| `admin-web/src/utils/transactionRootDisplay.ts` | 修改 | 新增 V4 状态标签 | 高 |
| `client-web/src/pages/Deposit.tsx` | 修改 | 防通风报信状态映射、移除旧状态 | 高 |

---

## 10. 设计约束

1. **Sumsub webhook 不得自动转换 FROZEN deposit** — 冻结资金的释放/没收是法律决策，仅允许手动 admin 操作。
2. **KYT/TR 结果始终记录** — 无论 deposit 当前状态（包括 FROZEN），确保 admin 有完整信息做判断。
3. **客户端不暴露合规信息** — 防通风报信原则，COMPLIANCE_PENDING / ACTION_PENDING / FROZEN 统一显示为 Processing。
4. **Admin 页面不显示 UUID** — Hero Zone 和 Sidebar 使用业务键（depositNo、ownerNo、walletNo）。
5. **DetailPageHeader 无 title/subtitle** — 遵循 admin entity 页面规范。
