# V5 虚拟币提现 Happy Path — 设计文档

> Scope: 虚拟币提现正常流程（客户发起 → 合规门控 → Payout 链上执行 → TB 记账完成）
> 前置: V2（客户合规）+ V3（资产/钱包/TB 账户/提现地址）+ V4（充值 — TB 记账模式参考）
> 不含: 法币提现、异常/冻结路径、大额审批门（列入后续 spec）

---

## 1. 设计决策总览

### 1.1 与 V4 充值的镜像关系

| 维度 | V4 充值 | V5 提现 |
|------|---------|---------|
| 触发 | 链上到账（被动） | 客户发起（主动） |
| TB 机制 | 两步 Posted Transfer（经 CLIENT_AUDIT 中转） | 两阶段 Pending Transfer（CLIENT_CREDIT → CUSTODY / FEE_RECEIVABLE） |
| 为何不同 | 充值资金来自外部，需 CLIENT_AUDIT "隔离区" | 提现资金已在客户账户，TB pending 原生锁定即可 |
| 合规时序 | KYT 阻塞在记账之前 | KYT Phase 1（预筛）+ TR 阻塞在 payout 之前；KYT Phase 2（txHash 补全）异步在 payout 之后 |
| 记账时点 | STEP_1(到账确认) + STEP_2(合规通过) | 一次性 POST pending（链上确认时） |
| 取消/失败 | 充值一般不可取消 | VOID pending transfer → 余额自动恢复 |

### 1.2 为什么用 TB Pending Transfer 而非 CLIENT_AUDIT 中转

V4 充值用 CLIENT_AUDIT 是因为资金从外部进入平台，在合规审查期间需要一个"隔离区"——资金已物理到达 CUSTODY 但尚未归属客户。

V5 提现相反：资金已在客户 CLIENT_CREDIT 账户中。只需要"冻结"一部分余额不让客户使用，TigerBeetle 的 Pending Transfer 天然支持这一需求：
- 创建 pending transfer 后，`debits_pending` 立即增加 → 可用余额减少
- 合规通过 + 链上确认后 POST → `debits_pending` 变为 `debits_posted`
- 合规失败 / payout 失败时 VOID → `debits_pending` 清零，余额恢复

不需要额外的中转账户，且 VOID 操作是原子的。

### 1.3 改造策略：原地重构

现有代码保留 Prisma model（WithdrawTransaction / Payout 字段完整）和 Payout 状态机。核心改动：

1. 编排层：`withdraw-workflow.orchestrator.ts` → 标准 `withdraw-workflow.service.ts`（3-Layer）
2. 新增：TB pending/post/void 调用（AccountingService 扩展）
3. 新增：Gate 0 / Gate 1(KYT 预筛) / Gate 2(Travel Rule) 门控
4. 新增：Sumsub KYT Phase 2 异步回调处理（txHash 补全）
5. 迁移：审计日志从 WithdrawAuditLog → AuditLogsService

---

## 2. 状态机

### 2.1 WithdrawTransaction 状态机

```
                    客户发起
                       │
                       ▼
               ┌───────────────┐
               │ COMPLIANCE_   │  TB: 2笔 Pending Transfer 创建
               │ PENDING       │  ① CLIENT_CREDIT→CUSTODY (netAmount)
               │               │  ② CLIENT_CREDIT→FEE_RECEIVABLE (feeAmount)
               └───────┬───────┘
                       │ Gate 0 PASS
                       │ Gate 1 PASS (KYT Phase 1 预筛)
                       │ Gate 2 PASS (Travel Rule ACK)
                       ▼
               ┌───────────────┐
               │ PAYOUT_       │  Payout 创建并开始链上执行
               │ PENDING       │
               └───────┬───────┘
                       │ Payout CONFIRMED
                       │ TB: POST 2笔 Pending Transfer
                       ▼
               ┌───────────────┐
               │   SUCCESS     │  终态
               └───────────────┘
```

Happy path 只涉及三个状态：`COMPLIANCE_PENDING` → `PAYOUT_PENDING` → `SUCCESS`。

异常分支（本 spec 不实现，后续 spec 补充）使用的状态：
- `FROZEN`：Gate 0 客户异常 / Gate 1 KYT 预筛失败，合规冻结
- `UNDER_REVIEW`：大额审批门或人工审核
- `FAILED`：Payout 链上失败
- `CANCELLED`：Gate 2 TR 超时/拒绝，或客户取消
- `REJECTED`：合规拒绝

### 2.2 Payout 状态机（Crypto，复用现有）

```
CREATED → SIGNING → BROADCASTED → CONFIRMING → CONFIRMED → CLEARED
```

Happy path 下 Payout 状态机不需要改动，现有 `payouts.service.ts` 的 CRYPTO_TRANSITIONS 已正确。

新增行为：
- `CONFIRMED` 时触发 `payout.status.confirmed` 事件 → WithdrawWorkflowService 订阅并 POST pending transfers
- `CLEARED` 由 workflow 在 POST 成功后设置

### 2.3 状态转换 Action 映射

| 当前状态 | Action | 目标状态 | 触发者 |
|----------|--------|----------|--------|
| (新建) | CREATE | COMPLIANCE_PENDING | 客户 API |
| COMPLIANCE_PENDING | COMPLIANCE_PASS | PAYOUT_PENDING | WithdrawWorkflowService（三门全过） |
| PAYOUT_PENDING | PAYOUT_CONFIRMED | SUCCESS | WithdrawWorkflowService（链上确认+TB POST） |

---

## 3. TB 记账设计

### 3.1 AccountingService 扩展

现有 `executeTransfer()` 硬编码 `flags: 0`（仅支持 posted）。需新增三个方法：

```typescript
// 创建 pending transfer — 锁定资金但不移动
async executePendingTransfer(params: {
  debitAccountId: bigint;
  creditAccountId: bigint;
  amount: bigint;
  ledger: number;
  code: number;
  timeout: number;            // TB timeout in seconds（0 = no timeout；提现用 0，由 workflow 显式 void）
  evidence: EvidenceParams;
}): Promise<{ tbTransferId: bigint }>

// POST pending transfer — 确认资金移动
async postPendingTransfer(params: {
  pendingTransferId: bigint;  // 原 pending transfer 的 ID
  evidence: EvidenceParams;
}): Promise<void>

// VOID pending transfer — 取消锁定，余额恢复
async voidPendingTransfer(params: {
  pendingTransferId: bigint;
  evidence: EvidenceParams;
}): Promise<void>
```

TB flags 说明：
- Pending: `flags.pending = true`
- Post: 新 transfer with `flags.post_pending_transfer = true`, 其 `id` 指向原 pending 的 `id`
- Void: 新 transfer with `flags.void_pending_transfer = true`, 其 `id` 指向原 pending 的 `id`

### 3.2 新增 Transfer Codes

在 `tb-transfer-codes.constant.ts` 中新增：

```typescript
// Withdrawal: pending lock
WITHDRAW_CREDIT_TO_CUSTODY_PENDING: 10,   // CLIENT_CREDIT → CUSTODY (net)
WITHDRAW_CREDIT_TO_FEE_PENDING: 11,       // CLIENT_CREDIT → FEE_RECEIVABLE (fee)

// Withdrawal: post (chain confirmed)
WITHDRAW_CREDIT_TO_CUSTODY_POST: 12,      // POST pending #10
WITHDRAW_CREDIT_TO_FEE_POST: 13,          // POST pending #11

// Withdrawal: void (cancel/fail)
WITHDRAW_CREDIT_TO_CUSTODY_VOID: 14,      // VOID pending #10
WITHDRAW_CREDIT_TO_FEE_VOID: 15,          // VOID pending #11
```

### 3.3 Evidence 记录

每笔 TB transfer（pending / post / void）都写 `TbEvidence` 行：

| 字段 | 值 |
|------|-----|
| sourceType | `'WITHDRAWAL'` |
| sourceNo | `withdrawNo` |
| eventCode | `WITHDRAW_LOCK` / `WITHDRAW_POST` / `WITHDRAW_VOID` |
| debitCode | `CLIENT_CREDIT (100)` |
| creditCode | `CUSTODY (10)` 或 `FEE_RECEIVABLE (120)` |
| transferType | `'PENDING'` / `'POST_PENDING'` / `'VOID_PENDING'` |
| traceId | 提现单 traceId |

### 3.4 Deterministic Transfer ID

复用 V4 模式：`deterministicTransferId(sourceType, sourceNo, eventCode, seq)`

- Pending lock (net): `deterministicTransferId('WITHDRAWAL', withdrawNo, 'WITHDRAW_LOCK_NET', 0)`
- Pending lock (fee): `deterministicTransferId('WITHDRAWAL', withdrawNo, 'WITHDRAW_LOCK_FEE', 0)`
- Post/Void 使用对应 pending transfer 的 ID

---

## 4. 合规门控

### 4.1 Gate 0 — 客户合规状态检查

与 V4 充值 Gate 0 完全一致：

```typescript
private async runGate0(withdrawId: string) {
  const complianceStatus = await this.withdrawService.getOwnerComplianceStatus(withdrawId);
  
  if (ABNORMAL_COMPLIANCE.has(complianceStatus)) {
    // Happy path 不走这里；异常 spec 再实现
    await this.freezeWithdrawal(withdrawId, `Customer compliance: ${complianceStatus}`);
    return false;
  }
  return true; // Gate 0 PASS
}
```

### 4.2 Gate 1 — KYT（两阶段模型）

提现方向的 KYT 是**一个流程、两个阶段**，与充值 KYT（单阶段阻塞）不同：

| 阶段 | 时机 | 输入 | 输出 | 是否阻塞 |
|------|------|------|------|----------|
| **Phase 1（预筛）** | Payout 之前 | 目标地址 + 金额 + 币种 | 地址风险评分 + 初步 PASS/FAIL | **阻塞** — Gate 1 放行条件 |
| **Phase 2（完整）** | Payout 广播后 | 补提 txHash 到同一笔 KYT 记录 | 完整链上分析 + 最终风险评分 | **不阻塞** — 更新同一个 kytStatus |

**Phase 1（预筛，阻塞门）：**
- **触发时机**：Gate 0 通过后立即发起
- **Provider**：Sumsub KYT API — 提交目标地址 + 金额 + 币种，创建 KYT screening 记录
- **Happy path 行为**：Sumsub 返回地址预筛 PASS → `kytStatus = 'PASSED'`
- **Gate 1 放行条件**：`kytStatus === 'PASSED'`
- **字段**：复用现有 `kytStatus`（PENDING → PASSED / FAILED）、`kytScreeningId`（Sumsub screening reference）、`kytRiskScore`、`kytCheckedAt`

**Phase 2（完整分析，不阻塞）：**
- **触发时机**：Payout BROADCASTED，拿到 txHash 后
- **操作**：将 txHash 补提到 Phase 1 创建的同一笔 Sumsub KYT 记录
- **Happy path 行为**：Sumsub 完整链上分析确认 PASSED（kytStatus 无变化）
- **异常行为**（后续 spec）：Sumsub 返回 HIGH_RISK → kytStatus 升级 → 提现已 SUCCESS，创建合规 Case 供 MLRO 审查

### 4.3 Gate 2 — Travel Rule

提现方向的 Travel Rule 是**主动发送**（与充值的被动接收相反）。

- **触发时机**：Gate 0 通过后立即发起（与 Gate 1 并行）
- **流程**：识别目标地址归属 → VASP 目标：发送受益人信息包 → 等待 ACK；自托管：客户已在注册地址时完成声明
- **Happy path 行为**：TR ACK 收到 或 NOT_REQUIRED → `travelRuleStatus = 'PASSED'` 或 `'NOT_REQUIRED'`
- **字段**：复用现有 `travelRuleStatus`（PENDING → PASSED / NOT_REQUIRED）、`travelRuleTransferId`、`travelRuleCheckedAt`

### 4.4 门控编排

Gate 1 和 Gate 2 并行发起。全部 PASS 后自动推进到 PAYOUT_PENDING：

```typescript
async checkAllGatesPass(withdrawId: string) {
  const w = await this.withdrawService.findOne(withdrawId);

  const gate1Pass = w.kytStatus === 'PASSED';
  const gate2Pass = w.travelRuleStatus === 'PASSED'
                 || w.travelRuleStatus === 'NOT_REQUIRED';

  if (gate1Pass && gate2Pass) {
    await this.initiatePayoutPhase(withdrawId);
  }
}
```

---

## 5. 完整 Happy Path 流程（事件驱动）

```
┌─ 客户 API ─────────────────────────────────────────────────────┐
│ POST /client/withdraw-transactions                              │
│  body: { assetId, withdrawalAddressId, amount }                 │
│                                                                 │
│  前置校验（同步，失败返回 4xx，不创建订单）：                      │
│   • 余额 ≥ grossAmount (netAmount + feeAmount)                  │
│   • WithdrawalAddress.status = ACTIVE                           │
│   • Asset.status = ACTIVE                                       │
│   • onboardingService.assertTradingEligibility('WITHDRAWAL')    │
│                                                                 │
│  通过后：                                                       │
│   1. 计算 fee（从 WithdrawPricingQuote 或限额策略表）            │
│   2. 创建 WithdrawTransaction (status: COMPLIANCE_PENDING)      │
│   3. TB: executePendingTransfer ×2                               │
│      ① CLIENT_CREDIT → CUSTODY (netAmount)                      │
│      ② CLIENT_CREDIT → FEE_RECEIVABLE (feeAmount)               │
│   4. 写审计: WITHDRAW_REQUESTED                                 │
│   5. emit 'withdrawal.created'                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ WithdrawWorkflowService @OnEvent('withdrawal.created') ───────┐
│                                                                 │
│  Gate 0: 检查 customer.complianceStatus                         │
│   └─ ACTIVE → PASS                                              │
│                                                                 │
│  并行发起:                                                      │
│   Gate 1: submitKytPreScreening(withdrawId)                     │
│    → Sumsub KYT API: 提交目标地址 + 金额 + 币种                 │
│    → 设置 kytStatus = 'PENDING', kytScreeningId = ref           │
│    → (Happy path) Sumsub 返回预筛 PASS                          │
│    → 更新 kytStatus = 'PASSED', kytRiskScore, kytCheckedAt      │
│    → checkAllGatesPass(withdrawId)                              │
│                                                                 │
│   Gate 2: submitTravelRule(withdrawId)                          │
│    → 设置 travelRuleStatus = 'PENDING'                          │
│    → (Happy path) ACK 收到 或 自托管 NOT_REQUIRED               │
│    → 更新 travelRuleStatus = 'PASSED' / 'NOT_REQUIRED'          │
│    → checkAllGatesPass(withdrawId)                              │
│                                                                 │
│  checkAllGatesPass: 两门全 PASS →                               │
│   1. 更新 status: COMPLIANCE_PENDING → PAYOUT_PENDING           │
│   2. 创建 Payout (type: CRYPTO, status: CREATED)                │
│   3. 绑定 withdraw.payoutId = payout.id                         │
│   4. 写审计: WITHDRAW_COMPLIANCE_PASSED                          │
│   5. emit 'payout.created'                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ Payout 链上执行（模拟 / 实际）─────────────────────────────────┐
│                                                                 │
│  CREATED → SIGNING → BROADCASTED → CONFIRMING → CONFIRMED      │
│                                                                 │
│  BROADCASTED 时拿到 txHash:                                     │
│   → 更新 withdraw.txHash = txHash                               │
│   → KYT Phase 2: 补提 txHash 到 Phase 1 同一笔 Sumsub 记录     │
│     （不阻塞流程；Sumsub 异步完成完整链上分析）                    │
│     → Happy path: kytStatus 保持 PASSED                         │
│                                                                 │
│  CONFIRMED 时:                                                  │
│   → emit 'payout.status.confirmed'                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ WithdrawWorkflowService @OnEvent('payout.status.confirmed') ──┐
│                                                                 │
│  1. TB: postPendingTransfer ×2                                  │
│     ① POST CLIENT_CREDIT → CUSTODY pending                     │
│     ② POST CLIENT_CREDIT → FEE_RECEIVABLE pending              │
│  2. 更新 WithdrawTransaction.status → SUCCESS                   │
│  3. 更新 Payout.status → CLEARED                                │
│  4. 写审计: WITHDRAW_ACCOUNTING_POSTED                          │
│  5. 写审计: WITHDRAW_SUCCESS                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Domain Events 注册

在 `domain-events.constants.ts` 中新增：

| 事件名 | 发射层 | 订阅者 | Payload |
|--------|--------|--------|---------|
| `withdrawal.created` | WithdrawTransactionsService | WithdrawWorkflowService | `{ withdrawId, status, ownerType, ownerId, assetId, amount }` |
| `withdrawal.status.changed` | WithdrawTransactionsService | WithdrawWorkflowService | `{ withdrawId, oldStatus, newStatus, ownerType, ownerId, assetId }` |
| `withdrawal.kyt.updated` | WithdrawTransactionsService | WithdrawWorkflowService | `{ withdrawId, kytStatus, phase }` |
| `withdrawal.travelrule.updated` | WithdrawTransactionsService | WithdrawWorkflowService | `{ withdrawId, travelRuleStatus }` |
| `payout.created` | PayoutsService | WithdrawWorkflowService | `{ payoutId, withdrawId, type, status }` |
| `payout.status.confirmed` | PayoutsService | WithdrawWorkflowService | `{ payoutId, withdrawId, txHash }` |

> `payout.created` 和 `payout.status.confirmed` 已在 `payout-events.constant.ts` 有定义，但需注册到统一 registry。

---

## 7. 审计日志

### 7.1 审计 Action 序列（Happy Path）

| 序号 | Action | workflowType | 触发时机 |
|------|--------|-------------|----------|
| 1 | `WITHDRAW_REQUESTED` | `WITHDRAWAL` | 提现单创建 + TB pending |
| 2 | `WITHDRAW_GATE0_PASSED` | `WITHDRAWAL` | 客户合规检查通过 |
| 3 | `WITHDRAW_KYT_PHASE1_PASSED` | `WITHDRAWAL` | Gate 1 KYT 预筛通过 |
| 4 | `WITHDRAW_TRAVEL_RULE_PASSED` | `WITHDRAWAL` | Gate 2 TR ACK 或 NOT_REQUIRED |
| 5 | `WITHDRAW_COMPLIANCE_PASSED` | `WITHDRAWAL` | 三门全过，进入 PAYOUT_PENDING |
| 6 | `PAYOUT_CREATED` | `WITHDRAWAL` | Payout 创建 |
| 7 | `WITHDRAW_KYT_PHASE2_SUBMITTED` | `WITHDRAWAL` | txHash 补提到同一笔 Sumsub KYT 记录 |
| 8 | `WITHDRAW_ACCOUNTING_POSTED` | `WITHDRAWAL` | TB POST pending 成功 |
| 9 | `WITHDRAW_SUCCESS` | `WITHDRAWAL` | 提现完成 |

### 7.2 traceId 传播

- 在 `WithdrawTransactionsService.create()` 时生成 `traceId`，写入 `withdraw_transactions.traceId`
- 所有后续审计行共享该 traceId
- Payout 创建时继承提现单的 traceId

---

## 8. Prisma Schema 变更

WithdrawTransaction 新增字段（现有字段保留不动）：

```prisma
model WithdrawTransaction {
  // ... 现有字段 ...

  // TB Pending Transfer IDs（新增）
  tbPendingNetId          String?    // hex of TB pending transfer ID (net amount)
  tbPendingFeeId          String?    // hex of TB pending transfer ID (fee amount)
}
```

> Gate 1 KYT 复用现有字段：`kytStatus`、`kytScreeningId`、`kytRiskScore`、`kytCheckedAt`。
> Gate 2 Travel Rule 复用现有字段：`travelRuleStatus`、`travelRuleTransferId`、`travelRuleCheckedAt`。
> 其他复用：`txHash`、`traceId`、`complianceStatus`。
> 无需新增 `addressScreeningStatus` 等独立字段——KYT Phase 1 已覆盖地址筛查能力。

---

## 9. 3-Layer 架构文件映射

| Layer | 文件 | 职责 |
|-------|------|------|
| L1 Domain | `withdraw-transactions.service.ts`（重构） | CRUD + 状态转换 + 事件发射；write 方法接受可选 `tx` 参数 |
| L1 Domain | `payouts.service.ts`（小幅调整） | Payout CRUD + 状态机；确认时 emit `payout.status.confirmed` |
| L2 Approval | 本 spec 不涉及（大额审批门留后续 spec） | — |
| L3 Workflow | `withdraw-workflow.service.ts`（新建，替代旧 orchestrator） | 订阅事件、编排 Gate 0/1/2、调用 AccountingService、写审计 |

旧文件 `withdraw-workflow.orchestrator.ts` 在新 workflow service 完成后废弃。

---

## 10. API 端点

### 10.1 客户端

| 方法 | 路由 | 说明 |
|------|------|------|
| POST | `/client/withdraw-transactions` | 客户发起提现（新建或改造现有） |
| GET | `/client/withdraw-transactions` | 客户提现列表 |
| GET | `/client/withdraw-transactions/:withdrawNo` | 提现详情 |

### 10.2 管理端（模拟用）

| 方法 | 路由 | 说明 |
|------|------|------|
| POST | `/admin/payouts/:payoutNo/simulate` | 模拟 Payout 状态推进（SIGN→BROADCAST→CONFIRM） |
| POST | `/admin/sumsub/simulate/withdrawal-kyt` | 模拟 KYT Phase 1 预筛结果 |
| POST | `/admin/sumsub/simulate/withdrawal-kyt-phase2` | 模拟 KYT Phase 2 完整分析结果（txHash 补全后） |

---

## 11. 异常流程全景（后续 spec 范围）

### 虚拟币提现异常（6 种）

| # | 异常 | 触发点 | 状态 | TB |
|---|------|--------|------|-----|
| 1 | Gate 0 失败 — 客户被冻结/暂停 | Gate 0 | FROZEN → MLRO 审批 | VOID pending |
| 2 | Gate 1 失败 — KYT 预筛目标地址命中制裁/高风险 | KYT Phase 1 | FROZEN → MLRO 审批 | VOID pending |
| 3 | Gate 2 失败 — TR ACK 超时/拒绝 | Travel Rule | CANCELLED | VOID pending |
| 4 | Payout 签名/广播失败 | SIGNING/BROADCAST | FAILED | VOID pending |
| 5 | 链上交易失败 — tx dropped/stuck | CONFIRMING | FAILED/TIMEOUT | VOID pending |
| 6 | KYT Phase 2 高风险 — 完整分析返回 HIGH_RISK | KYT Phase 2 回调 | 已 SUCCESS，创建合规 Case | 无 TB 动作（资金已走）→ MLRO 审查存档 |

### 法币提现异常（5 种）

| # | 异常 | 触发点 | 状态 | TB |
|---|------|--------|------|-----|
| 1 | Gate 0 失败 | Gate 0 | FROZEN | VOID pending |
| 2 | 目标银行账户 KYT 筛查失败 | KYT Phase 1 | FROZEN | VOID pending |
| 3 | 银行转账失败 | Bank instruction | FAILED | VOID pending |
| 4 | 银行退汇（Bounce） | 到账后 | RETURNED | 反向 Posted Transfer |
| 5 | Post-KYT 高风险 | 异步 KYT | 已 SUCCESS | 创建合规 Case |

---

## 12. 前端影响（最小化）

### Admin Web
- DepositTransaction 详情页已有的模式可复用到 WithdrawTransaction 详情页
- 新增 Payout 模拟控件（simulate 按钮，推进 payout 状态）
- 新增 KYT Phase 1/Phase 2 模拟控件

### Client Web
- `Withdraw.tsx` 已有提现表单，需对接新 API
- 状态映射需实现 Tipping-Off Safe 映射（与充值一致：FROZEN/REJECTED → Processing）
- 提现历史 Tab 展示 TB 真实余额变动
