# Spec #4 — INTERNAL_FUND audit 改名 + INTERNAL_TRANSFER 去双写设计稿

**日期**：2026-06-16
**范围**：聚焦 INTERNAL_*（INTERNAL_FUND + INTERNAL_TRANSFER），不动 SWAP/DEPOSIT/PAYIN/WITHDRAWAL/BATCH（留下一轮）
**前序**：DT Spec #3 完成（Outstanding/FeeAccrual dual traceId）

---

## 1. 问题陈述（侦察证据）

### 1.1 INTERNAL_FUND 状态机 audit 名过长且字面拼装

DB 实测 `audit_log_events` where `entityType='INTERNAL_FUND'`：

| action | n |
|---|---|
| `INTERNAL_FUND_CREATED` | 372 |
| `INTERNAL_FUND_CONFIRMING_TO_CONFIRMED` | 331 |
| `INTERNAL_FUND_CONFIRMED_TO_CLEAR` | 331 |
| `INTERNAL_FUND_CREATED_TO_CONFIRMING` | 317 |
| `INTERNAL_FUND_CREATED_TO_SIGNING` | 19 |
| `INTERNAL_FUND_SIGNING_TO_BROADCASTED` | 18 |
| `INTERNAL_FUND_BROADCASTED_TO_CONFIRMING` | 16 |
| 另外 8 种小数量 _TO_FAILED / _TO_TIMEOUT / _TO_CANCELLED / _TO_RETURNED | 共 7 |

共 **15 种 action**，最长 41 字符（`INTERNAL_FUND_BROADCASTED_TO_CONFIRMING`），字面是状态机 `FROM_TO_TO` 字符串。

### 1.2 INTERNAL_TRANSFER 同一动作被记两遍（50% 噪音）

DB 实测 `audit_log_events` where `entityType='INTERNAL_TRANSFER'`：

| action | n |
|---|---|
| `INTERNAL_TRANSFER_INTERNAL_FUNDS_PENDING_TO_SUCCESS` | 237 |
| `TRANSFER_COMPLETED` | 225 |
| `INTERNAL_TRANSFER_REQUESTED` | 35 |
| `TRANSFER_FAILED` | 5 |
| `INTERNAL_TRANSFER_INTERNAL_FUNDS_PENDING_TO_FAILED` | 5 |
| `INTERNAL_TRANSFER_INTERNAL_FUNDS_PENDING_TO_CANCELLED` | 1 |

铁证：`PENDING_TO_SUCCESS=237 ≈ TRANSFER_COMPLETED=225`、`PENDING_TO_FAILED=5 = TRANSFER_FAILED=5`。每笔成功 transfer 产生 2 条同义 audit。

### 1.3 老入口残留：INTERNAL_TX_CREATED 在 V7 之后理应弃用

- `internal-transactions.service.ts:294` 仍发 `AuditActions.INTERNAL_TX_CREATED`
- `internal-transfer-workflow.service.ts:115` 发 `AuditActions.INTERNAL_TRANSFER_REQUESTED`
- 注释 `internal-transfer.service.ts:174` 明确："journey audit is written by [workflow]"——即 service 层不该写、workflow 才该写。但 `internal-transactions.service.ts:294` 仍违反此意图。

---

## 2. 顶层设计

**底层逻辑**：audit `action` 应是描述"发生了什么"的动词过去式，不是状态机原始字面。`entityType` 已经标识对象、`action` 不需要重复实体名。

**抓手**：
1. INTERNAL_FUND 15 种长名压成 7 种短名（按"进入状态"折叠），`from` 状态进 metadata 保留历史可读性
2. 删 INTERNAL_TRANSFER 状态机端的双写（PENDING_TO_*）+ 老入口（INTERNAL_TX_CREATED），只留 workflow 的 4 个短名
3. 公共 helper `buildStateTransitionAction()` **不动**（被 WITHDRAW/PAYIN/REIMBURSEMENT 共用、下一轮再拉通）。本轮只换 INTERNAL_FUND 与 INTERNAL_TX 调用点

**闭环边界**：本 spec 不动 SWAP/QUOTE/DEPOSIT/PAYIN/WITHDRAWAL/BATCH 的 action 名；不动 audit_log_events 表结构；不回填历史行；不修横切 audit/tx 共用 prisma 连接的 SQLite 写锁问题（已 flag 下一轮）。

---

## 3. INTERNAL_FUND 改名表（15 → 7）

### 3.1 折叠规则

| 旧 action | 新 action (值) | metadata 携带 |
|---|---|---|
| `INTERNAL_FUND_CREATED` | `CREATED` | — |
| `INTERNAL_FUND_CREATED_TO_SIGNING` | `SIGNING` | `from: 'CREATED'` |
| `INTERNAL_FUND_SIGNING_TO_BROADCASTED` | `BROADCASTED` | `from: 'SIGNING'` |
| `INTERNAL_FUND_CONFIRMING_TO_BROADCASTED` | `BROADCASTED` | `from: 'CONFIRMING'` |
| `INTERNAL_FUND_CREATED_TO_CONFIRMING` | `CONFIRMING` | `from: 'CREATED'`（fiat 直进） |
| `INTERNAL_FUND_BROADCASTED_TO_CONFIRMING` | `CONFIRMING` | `from: 'BROADCASTED'`（crypto 链上） |
| `INTERNAL_FUND_CONFIRMING_TO_CONFIRMED` | `CONFIRMED` | `from: 'CONFIRMING'` |
| `INTERNAL_FUND_CONFIRMED_TO_CLEAR` | `CLEARED` | `from: 'CONFIRMED'` |
| `INTERNAL_FUND_*_TO_FAILED`（共 3 种） | `FAILED` | `from: <SIGNING/BROADCASTED/CONFIRMING>` |
| `INTERNAL_FUND_*_TO_TIMEOUT`（共 2 种） | `TIMED_OUT` | `from: <BROADCASTED/CONFIRMING>` |
| `INTERNAL_FUND_CREATED_TO_CANCELLED` | `CANCELLED` | `from: 'CREATED'` |
| `INTERNAL_FUND_CLEAR_TO_RETURNED` | `REORGED` | `from: 'CLEAR'` |

**最终 7 个 action 短名**：`CREATED / SIGNING / BROADCASTED / CONFIRMING / CONFIRMED / CLEARED / FAILED`
**+ 3 个 terminal 异常**：`TIMED_OUT / CANCELLED / REORGED`
= 10 个短名（其中 CREATED/FAILED/CANCELLED 已与 OUTSTANDING/FEE_ACCRUAL 共享同名常量、复用即可）

### 3.2 TS 常量改名策略

**复用既有短名常量、删除旧 `INTERNAL_FUND_*` 长名常量**。调用点 grep 替换 `AuditActions.INTERNAL_FUND_CREATED` → `AuditActions.CREATED` 等（已统计 §1.3 列出仅 ~8 处生产引用、可控）：

```ts
// src/modules/audit-logging/constants/audit-actions.constant.ts

export const AuditActions = {
  // ...
  // INTERNAL_FUND lifecycle (复用既有短名常量)
  CREATED: 'CREATED',          // 已存（OUTSTANDING/FEE_ACCRUAL 同用）
  SIGNING: 'SIGNING',          // 新增
  BROADCASTED: 'BROADCASTED',  // 新增
  CONFIRMING: 'CONFIRMING',    // 新增
  CONFIRMED: 'CONFIRMED',      // 新增
  CLEARED: 'CLEARED',          // 新增
  FAILED: 'FAILED',            // 新增（也是 INTERNAL_TRANSFER 用）
  TIMED_OUT: 'TIMED_OUT',      // 新增
  CANCELLED: 'CANCELLED',      // 新增
  REORGED: 'REORGED',          // 已存
  // ...
}
```

**删除的常量**（共 15 个 INTERNAL_FUND_*）：
- `INTERNAL_FUND_CREATED` ✗（值已变，但常量名复用 `CREATED`）
- `INTERNAL_FUND_CREATED_TO_SIGNING` / `_TO_CONFIRMING` / `_TO_CANCELLED` ✗
- `INTERNAL_FUND_SIGNING_TO_BROADCASTED` / `_TO_FAILED` ✗
- `INTERNAL_FUND_BROADCASTED_TO_CONFIRMING` / `_TO_TIMEOUT` / `_TO_FAILED` ✗
- `INTERNAL_FUND_CONFIRMING_TO_CONFIRMED` / `_TO_BROADCASTED` / `_TO_TIMEOUT` / `_TO_FAILED` ✗
- `INTERNAL_FUND_CONFIRMED_TO_CLEAR` ✗
- `INTERNAL_FUND_CLEAR_TO_RETURNED` ✗

### 3.3 实现抓手：`buildInternalFundStateAction()` helper

公共 `buildStateTransitionAction()` 不动（其他 entity 用）。在 audit-actions.constant.ts 内新增 INTERNAL_FUND 专用 mapping：

```ts
const INTERNAL_FUND_STATE_TO_ACTION: Record<string, string> = {
  CREATED: 'CREATED',
  SIGNING: 'SIGNING',
  BROADCASTED: 'BROADCASTED',
  CONFIRMING: 'CONFIRMING',
  CONFIRMED: 'CONFIRMED',
  CLEAR: 'CLEARED',
  FAILED: 'FAILED',
  TIMEOUT: 'TIMED_OUT',
  CANCELLED: 'CANCELLED',
  RETURNED: 'REORGED',
};

export function buildInternalFundStateAction(nextStatus: string): string {
  return INTERNAL_FUND_STATE_TO_ACTION[nextStatus] ?? nextStatus.toLowerCase();
}
```

调用方（`internal-funds.service.ts` line 246/499、`funds-flow.service.ts` 状态机推进点）：

```ts
// 旧
action: buildStateTransitionAction('INTERNAL_FUND', currentStatus, nextStatus),
// 新
action: buildInternalFundStateAction(nextStatus),
metadata: JSON.stringify({ from: currentStatus, ...existing }),
```

---

## 4. INTERNAL_TRANSFER 去双写 + 改名

### 4.1 删除点

| 文件 | 行 | 操作 | 原因 |
|---|---|---|---|
| `internal-transactions.service.ts` | 294 | **删** `AuditActions.INTERNAL_TX_CREATED` 整个 audit 调用 | V7 后老入口，与 workflow REQUESTED 重复 |
| `internal-transactions.service.ts` | 723 | **删** `buildStateTransitionAction('INTERNAL_TX', ...)` audit 调用 | 即生成 `INTERNAL_TRANSFER_INTERNAL_FUNDS_PENDING_TO_SUCCESS` 的源、与 workflow TRANSFER_COMPLETED 重复 |

> 注：`internal-transactions.service.ts` 是 V7 之前的 legacy 入口，新业务通过 `internal-transfer-workflow.service` 进。删除 audit 只删审计噪音、不删 service 主体（其他模块可能仍有调用）。

### 4.2 保留 + 改名（workflow 端唯一来源）

| 文件 | 行 | 旧 action | 新 action（值） |
|---|---|---|---|
| `internal-transfer-workflow.service.ts` | 115 | `INTERNAL_TRANSFER_REQUESTED` | `REQUESTED` |
| `internal-transfer-workflow.service.ts` | 159 | `TRANSFER_COMPLETED` | `SUCCEEDED` |
| `internal-transfer-workflow.service.ts` | 168 | `TRANSFER_FAILED` | `FAILED`（复用 INTERNAL_FUND.FAILED） |

INTERNAL_TRANSFER 最终 4 个短名：`REQUESTED / SUCCEEDED / FAILED / CANCELLED`。

### 4.3 删除常量

`audit-actions.constant.ts` 删除：
- `INTERNAL_TX_CREATED`
- `INTERNAL_TRANSFER_REQUESTED`（常量名复用 `REQUESTED`）
- `TRANSFER_COMPLETED`（替换为 `SUCCEEDED`）
- `TRANSFER_FAILED`（删除，复用通用 `FAILED`）

**新增**：
```ts
REQUESTED: 'REQUESTED',
SUCCEEDED: 'SUCCEEDED',
```

---

## 5. 影响清单（颗粒度对齐）

| 文件 | 操作 | 净变化 |
|---|---|---|
| `audit-actions.constant.ts` | 删 ~17 常量 / 新增 9 短名常量 / 新增 `buildInternalFundStateAction()` | ~+20 行 / -40 行 |
| `internal-funds.service.ts` | line 246、499 改 build 函数；line 355 改常量名 | ~3 行 |
| `funds-flow.service.ts` | line 383、463 改常量名（CREATED）；状态机推进 audit 改 helper + metadata.from | ~10 行 |
| `internal-transactions.service.ts` | **删** line 294 audit / **删** line 723 audit | ~-20 行 |
| `internal-transfer-workflow.service.ts` | line 115、159、168 改常量名 | ~3 行 |
| 6 个对应 `.spec.ts` | 字面 action 值替换 + 删除 transfer 双写断言 | ~30 行 |

**净改动估算**：~80 行（含测试），6 个生产文件 + 6 个测试文件。

---

## 6. 测试覆盖（TDD）

| # | 测试 | 验证 |
|---|---|---|
| 1 | `funds-flow.service.spec` 状态机推进 → audit 用短名 + metadata.from | 7 个状态短名映射正确 |
| 2 | `internal-funds.service.spec` createForXxx → audit `CREATED` | INTERNAL_FUND 创建短名 |
| 3 | `internal-transfer-workflow.service.spec` 三入口 → `REQUESTED/SUCCEEDED/FAILED` | workflow 端单写 |
| 4 | `internal-transfer.service.spec` 同一 transfer 产 1 条 SUCCEEDED（不再有重复） | 双写消除 |
| 5 | `internal-transactions.service.spec` 删 INTERNAL_TX_CREATED → 不再发该 action | 老入口闭环 |
| 6 | `internal-transactions.service.spec` 状态推进 → 不再发 PENDING_TO_SUCCESS | 状态机双写消除 |

---

## 7. 验收（Live Recon）

跑一轮完整 sim 后 SQL 验证：

```sql
-- ① INTERNAL_FUND 新短名出现、旧拼装名 0 条新增
SELECT action, COUNT(*) FROM audit_log_events
WHERE entityType='INTERNAL_FUND' AND occurredAt > datetime('now','-30 minutes')
GROUP BY action;
-- 期望：只见 CREATED/SIGNING/BROADCASTED/CONFIRMING/CONFIRMED/CLEARED/FAILED 等短名
--      不再见 INTERNAL_FUND_*_TO_* 的新增行

-- ② INTERNAL_TRANSFER 同动作单写
SELECT action, COUNT(*) FROM audit_log_events
WHERE entityType='INTERNAL_TRANSFER' AND occurredAt > datetime('now','-30 minutes')
GROUP BY action;
-- 期望：REQUESTED + SUCCEEDED 各 N 条（N = transfer 数）
--      INTERNAL_TRANSFER_INTERNAL_FUNDS_PENDING_TO_SUCCESS 0 新增
--      INTERNAL_TX_CREATED 0 新增

-- ③ metadata.from 保留状态机字面
SELECT json_extract(metadata, '$.from') AS from_state, action, COUNT(*) n
FROM audit_log_events
WHERE entityType='INTERNAL_FUND' AND action IN ('CONFIRMING','CONFIRMED','FAILED')
  AND occurredAt > datetime('now','-30 minutes')
GROUP BY from_state, action;
-- 期望：CONFIRMING 行 from_state ∈ {CREATED, BROADCASTED}
--      CONFIRMED 行 from_state='CONFIRMING'
--      FAILED 行 from_state ∈ {SIGNING, BROADCASTED, CONFIRMING}
```

---

## 8. 不做（YAGNI）

- ❌ 不动公共 `buildStateTransitionAction()` 函数（其他 entity 共用、下一轮拉通）
- ❌ 不动 SWAP/QUOTE/DEPOSIT/PAYIN/WITHDRAWAL/BATCH 的 action 长名（下一轮）
- ❌ 不动 INTERNAL_FUND 实体拆分（fiat/crypto 同一 entityType，不拆）
- ❌ 不动 audit_log_events 表结构、不回填历史行（前端兼容自然降级）
- ❌ 不修横切 audit/business-tx 共用 prisma 连接的 SQLite 写锁冲突（Spec #3 末尾 flag、单独一轮）
- ❌ 不留 alias、不做兼容层（与 SW Spec #1 一致路线）

---

## 9. 任务拆解预告（具体见下一步 plan）

预计 6-7 任务：

1. T1：扩 `audit-actions.constant.ts`——加 9 短名 + `buildInternalFundStateAction()`
2. T2：`funds-flow.service` 状态机推进点改 helper + metadata.from（TDD）
3. T3：`internal-funds.service` 3 处常量名改 short（TDD）
4. T4：`internal-transfer-workflow.service` 3 处常量名改 short（TDD）
5. T5：`internal-transactions.service` 删 line 294 + 723 双写（TDD）
6. T6：`audit-actions.constant.ts` 删 17 个废常量
7. T7：Live recon 跑一轮 sim、SQL 三连验证

---

## 10. 决策记录

| 决策点 | 选择 | 原因 |
|---|---|---|
| INTERNAL_FUND 折叠粒度 | 15→10 按"进入状态"折叠、from 进 metadata | 用户拍板：可读性 > 状态机字面历史保留度，metadata 兜底 |
| TS 常量名 vs 值 | 名不变只改值（除新增/废弃） | blast radius 最小、grep 替换面缩小 90% |
| 公共 helper 改造 | 不动 `buildStateTransitionAction()` | 跨实体共用、本 spec 边界外 |
| 删 service 层老入口 vs 加新短名 alias | 删 | 与 SW Spec #1 路线一致、不留兼容层 |
| 历史行回填 | 不做 | 字面已冻结、前端兼容降级即可 |
