# Crypto Deposit Happy Path — Design Spec

**Date:** 2026-05-18
**Scope:** V4 MVP — 虚拟币充值工作流 happy path + 架构违规修复
**Approach:** 方案 A（渐进修复）

---

## 1. 目标

在现有充值流程基础上完成两件事：

1. **接入 TB 记账**：将空壳 `triggerDepositAccounting()` 替换为真实的两步 TB Transfer（CUSTODY→CLIENT_AUDIT + CLIENT_AUDIT→CLIENT_CREDIT）
2. **修复架构违规**：修正代码审查中发现的 11 个违规问题，使充值流程完全符合 backend rules

---

## 2. 修订后的 Deposit 状态机

去掉 UNDER_REVIEW，新增 ACTION_PENDING / EXPIRED / CONFISCATED。

### 合法状态转换

```
PAYIN_PENDING → COMPLIANCE_PENDING, FAILED
COMPLIANCE_PENDING → SUCCESS, REJECTED, FROZEN, ACTION_PENDING, FAILED
ACTION_PENDING → SUCCESS, REJECTED, FROZEN, COMPLIANCE_PENDING, EXPIRED
FROZEN → SUCCESS, CONFISCATED
终态：SUCCESS, REJECTED, FAILED, EXPIRED, CONFISCATED
```

### Action 枚举（修订）

| Action | 触发转换 |
|---|---|
| `payin_confirmed` | PAYIN_PENDING → COMPLIANCE_PENDING |
| `approve` | COMPLIANCE_PENDING/ACTION_PENDING/FROZEN → SUCCESS |
| `reject` | COMPLIANCE_PENDING/ACTION_PENDING → REJECTED |
| `freeze` | COMPLIANCE_PENDING/ACTION_PENDING → FROZEN |
| `action_pending` | COMPLIANCE_PENDING → ACTION_PENDING |
| `resume` | ACTION_PENDING → COMPLIANCE_PENDING |
| `confiscate` | FROZEN → CONFISCATED |
| `expire` | ACTION_PENDING → EXPIRED |
| `fail` | PAYIN_PENDING/COMPLIANCE_PENDING → FAILED |

### Payin 状态机（不变）

```
DETECTED → CONFIRMING → CONFIRMED → CLEARED
                ↓
              FAILED
```

Payin CLEARED 时机：第一步 TB 记账（CUSTODY→CLIENT_AUDIT）完成后。

---

## 3. COMPLIANCE_PENDING 复合状态与决策函数

Deposit 在 COMPLIANCE_PENDING 内部跟踪两个独立子状态，均由 Sumsub webhook 驱动。

### 子状态

| 子状态 | 可能值 | 驱动来源 |
|---|---|---|
| `kytStatus` | PENDING → APPROVED / REJECTED / ON_HOLD / AWAITING_USER | webhook `kytTxnType="finance"` |
| `travelRuleStatus` | PENDING → COMPLETED / FAILED / ON_HOLD / AWAITING_USER / NOT_REQUIRED | webhook `kytTxnType="travelRule"` |

### 判断时刻

每次 Sumsub webhook 到达时：
1. 识别 webhook 类型 + `kytTxnType` → 更新对应子状态
2. 运行决策函数 → 计算目标 Deposit 状态
3. 如果目标状态 ≠ 当前状态 → 执行状态转换

### 决策函数（优先级从高到低，首条命中即决策）

| 优先级 | 条件 | → Deposit 状态 | 说明 |
|---|---|---|---|
| P1 | kytStatus = REJECTED 且含制裁信号 | → FROZEN | 法律义务，立即冻结，不等 TR |
| P2 | kytStatus = REJECTED（非制裁） | → REJECTED | KYT 否决即否决，不等 TR |
| P3 | kytStatus = APPROVED 且 TR ∈ {COMPLETED, NOT_REQUIRED} | → SUCCESS | 两个都通过，入账 |
| P4 | kytStatus = APPROVED 且 TR = FAILED | → REJECTED | KYT 过了但 TR 失败 |
| P5 | kytStatus = AWAITING_USER 或 TR = AWAITING_USER | → ACTION_PENDING | 客户需要操作 |
| P6 | 其他所有组合 | → COMPLIANCE_PENDING | 继续等待 |

### P6 覆盖的等待场景

| kytStatus | travelRuleStatus | 原因 |
|---|---|---|
| PENDING | 任意 | KYT 未出结果 |
| ON_HOLD | 任意 | KYT 在 Sumsub 内部审查队列 |
| APPROVED | PENDING | KYT 通过，等 TR |
| APPROVED | ON_HOLD | KYT 通过，TR 在 Sumsub 内部审查 |

### ACTION_PENDING 后续

ACTION_PENDING 不是终态。客户完成操作后 Sumsub 推后续 webhook，子状态更新，再次运行决策函数：

- 两个都通过 → SUCCESS
- 一方操作完但另一方未出结果 → COMPLIANCE_PENDING（回退等待）
- 客户超时未操作 → EXPIRED（cron 扫描触发）

---

## 4. TB 记账设计

### 两步记账

| 步骤 | 时机 | Debit Account | Credit Account | 意义 |
|---|---|---|---|---|
| Step 1 | Deposit → COMPLIANCE_PENDING（同步） | CUSTODY (code=10) | CLIENT_AUDIT (code=101) | 确认资金在托管，进审计持有户 |
| Step 2 | Deposit → SUCCESS | CLIENT_AUDIT (code=101) | CLIENT_CREDIT (code=100) | 合规通过，资金入客户可用余额 |

### 账户解析

通过 `AccountingService.resolveTbAccountId()` 按 `code + ledger + ownerType + ownerUuid` 查找 TB 账户 ID。

- CUSTODY：`code=10, ledger=asset.tbLedgerId, ownerType=SYSTEM`
- CLIENT_AUDIT：`code=101, ledger=asset.tbLedgerId, ownerType=CUSTOMER, ownerUuid=deposit.ownerId`
- CLIENT_CREDIT：`code=100, ledger=asset.tbLedgerId, ownerType=CUSTOMER, ownerUuid=deposit.ownerId`

### Evidence 参数

每次 TB Transfer 写入 `tbTransferEvidence`：

| 字段 | Step 1 值 | Step 2 值 |
|---|---|---|
| sourceType | `DEPOSIT` | `DEPOSIT` |
| sourceNo | deposit.depositNo | deposit.depositNo |
| eventCode | `DEPOSIT_CUSTODY_TO_AUDIT` | `DEPOSIT_AUDIT_TO_CREDIT` |
| debitCode | 10 (CUSTODY) | 101 (CLIENT_AUDIT) |
| creditCode | 101 (CLIENT_AUDIT) | 100 (CLIENT_CREDIT) |
| assetCode | asset.code | asset.code |
| traceId | deposit.traceId | deposit.traceId |
| actorType | `SYSTEM` | `SYSTEM` |
| memo | `Payin confirmed, funds in audit hold` | `Compliance approved, funds credited` |

### 记账失败处理

记账失败 ≠ 业务失败。记账失败时状态不转换，等待运维修复后重试：

- Step 1 失败：Deposit 不进 COMPLIANCE_PENDING，保持 PAYIN_PENDING，进 repair surface
- Step 2 失败：Deposit 不进 SUCCESS，保持 COMPLIANCE_PENDING（Sumsub 已 approved），进 repair surface

`fail` action 仅用于外部业务失败（如 Payin 链上确认失败），与 TB 记账失败无关。

---

## 5. Happy Path 完整时序

```
1. Payin CONFIRMED
2. Deposit PAYIN_PENDING → COMPLIANCE_PENDING
   + TB 同步: CUSTODY → CLIENT_AUDIT（失败则不转状态）
3. Payin → CLEARED
4. 提交 KYT: POST /resources/applicants/{id}/kyt/txns/-/data (type:"finance", direction:"in")
5. 提交 TR: POST /resources/applicants/{id}/kyt/txns/-/data (type:"travelRule", direction:"in")
   如果金额 ≤ 阈值: travelRuleStatus = NOT_REQUIRED，跳过
6. Webhook: applicantKytTxnApproved (kytTxnType:"finance")
   → kytStatus = APPROVED → 决策函数: P6 → 继续等 TR
7. Webhook: applicantKytTxnApproved (kytTxnType:"travelRule")
   → travelRuleStatus = COMPLETED → 决策函数: P3 → SUCCESS
8. Deposit COMPLIANCE_PENDING → SUCCESS
   + TB 同步: CLIENT_AUDIT → CLIENT_CREDIT（失败则不转状态）
```

---

## 6. 架构违规修复清单

### 文件结构

| # | 修复项 | 说明 |
|---|---|---|
| F1 | 移动 `deposit-workflow.service.ts` | 从 `src/orchestrators/` 移入 `src/modules/trading/deposit-transactions/` |
| F2 | 合并 `TransactionDepositWorkflowService` | 将其合规桥接功能并入 Workflow，删除此文件 |
| F3 | 更新 `workflows.module.ts` | 移除 deposit workflow 的导出，改在 trading module 注册 |

### 三层架构修正

| # | 修复项 | 当前问题 | 修复方案 |
|---|---|---|---|
| L1 | L1 不写审计日志 | `DepositTransactionsService.updateStatus()` 直接写审计 | 审计写入移到 Workflow 层 |
| L2 | L1 不依赖合规服务 | `DepositTransactionsService` 注入 `TransactionComplianceService` | 合规检查移到 Workflow 层 |
| L3 | Workflow 不直接操作 Prisma | `findDepositByPayinId` 直接用 `prisma.depositTransaction` | 改为调用 `DepositTransactionsService` 方法 |
| L4 | Workflow 不直接操作 Prisma | `orchestrateDepositRejected` 直接用 `tx.payin.update` | 改为调用 `PayinsService.updateStatus()` |

### 废弃字段清理

| # | 修复项 | 说明 |
|---|---|---|
| D1 | 移除 `AuditModules` 导入 | 3 个文件引用了已废弃的 `AuditModules`，`module` 字段已从 `audit_log_events` 移除 |
| D2 | 移除 `workflowId` / `workflowNo` | `DepositStatusUpdateOptions` 接口中定义了这两个已废弃字段 |
| D3 | 修正 traceId 格式 | `TRANSACTION:${deposit.id}` → UUID v4，在 Deposit 创建时生成并持久化 |

### 状态机修正

| # | 修复项 | 说明 |
|---|---|---|
| S1 | 去掉 UNDER_REVIEW | 合并到 COMPLIANCE_PENDING，由子状态驱动 |
| S2 | 新增 ACTION_PENDING / EXPIRED / CONFISCATED | 新状态 + 对应 action |
| S3 | 修正 FROZEN 吞掉所有 action | FROZEN 只接受 `approve` 和 `confiscate`，其余拒绝 |
| S4 | 修正 FAILED 吞掉所有 action | FAILED 是终态，拒绝所有 action |

### Domain Events 注册

| # | 修复项 | 说明 |
|---|---|---|
| E1 | 注册 `payin.created` | 补充到 `domain-events.constants.ts` |
| E2 | 注册 `payin.status.changed` | 同上 |
| E3 | 注册 `deposit.status.changed` | 同上 |

---

## 7. 验证方案

使用现有模拟流程端到端验证：

1. 启动 dev stack（`npm run dev:start`）
2. 创建 Inbound Transfer Signal（模拟链上到账）
3. 执行 scan → Payin DETECTED → CONFIRMING → CONFIRMED
4. 验证：Deposit 自动创建并进入 COMPLIANCE_PENDING
5. 验证：TB 查询确认 CUSTODY→CLIENT_AUDIT Transfer 存在
6. 验证：Payin 状态为 CLEARED
7. 模拟 Sumsub webhook 返回 KYT APPROVED + TR COMPLETED
8. 验证：Deposit → SUCCESS
9. 验证：TB 查询确认 CLIENT_AUDIT→CLIENT_CREDIT Transfer 存在
10. 验证：客户余额（`getCustomerAvailableBalance`）反映充值金额

---

## 8. 不在本次范围内

- 异常分支实现（ACTION_PENDING / FROZEN / REJECTED / EXPIRED / CONFISCATED 的完整处理逻辑）
- TB 记账回退（CLIENT_AUDIT→CUSTODY）
- Sumsub webhook 真实接入（本次用模拟）
- 法币充值工作流
- 前端 UI 变更
- MLRO 审批门（L2 ApprovalHandlerBase）
