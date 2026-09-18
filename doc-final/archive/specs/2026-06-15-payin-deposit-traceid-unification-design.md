# Payin + Deposit Audit traceId 拉通 — 设计

日期：2026-06-15
状态：已确认（用户拍板：payin 为源、deposit 继承、不回填历史）

## 背景与根因

同一笔 deposit 的 audit_log_events 里两条轨各用自己的 traceId、互不相通：

| 主体 | 当前 traceId |
|---|---|
| `DEPOSIT_TRANSACTION` 事件 | `deposit.traceId`（randomUUID，存 deposit 表）|
| `PAYIN` 事件 | fallback `buildDepositTraceId(payinId)` = **`DEPOSIT:${payinId}`**（字面拼装）|

实测证据（branch DB）：
```
deposit.id=dcc1341d-…  payin.id=25302ee3-…
DEPOSIT_TRANSACTION traceId = a49afe3e-…              (UUID)
PAYIN              traceId = DEPOSIT:25302ee3-…      (拼装)
```

根因结构：
1. `payins` 表**没有 traceId 列**——payin 自己没"业务起点"。
2. `payins.service.createDetected` audit 调用**不传 traceId**，让 `audit-logs.service.buildDepositTraceId(payinId)` 兜底字面拼装。
3. 时序：**payin 先创建** → emit `payin.created` → `deposit-workflow.onPayinCreated` 才创建 deposit。payin 创建瞬间 deposit 不存在，无法回查 deposit.traceId。

> 顶层设计：traceId 是「一笔业务的贯穿抓手」，**入口（payin）是源头**，下游对象（deposit + 后续）一律继承。当前根本错位——deposit 自造 traceId、payin 用字面拼装、两条线对不上。

## 治本设计

把 traceId 的**源头钉死在 payin**：
- `payins.traceId String?` 加列。
- `payins.createDetected` 现场 `randomUUID()` 入表 + audit 显式带 traceId。
- `deposit-workflow.onPayinCreated` 通过 `createFromPayin` 把 `payin.traceId` 写入 `deposit.traceId`。
- `payins.updateStatus` 各终态转换的 audit 调用从 payin 表读 traceId 显式带。
- `audit-logs.buildDepositTraceId` fallback 顺序：`input.traceId` > `deposit.traceId` > `payin.traceId` > `DEPOSIT:${payinId}`（历史兜底）。

闭环：一根 UUID 贯穿 payin 全生命周期 → deposit 继承同 UUID → 所有下游 audit 都用同一 UUID；deposit 详情按 traceId 反查能找回**所有**事件（payin + deposit + 合规 + TB 证据）。

## 数据流（修后）

```
createDetected
  traceId = randomUUID()
  payin.create({ traceId, ... })
  audit.PAYIN_CREATED   traceId=<UUID>
  emit payin.created({ payinId })

@OnEvent deposit-workflow.onPayinCreated
  payin = read(payinId)
  deposit.create({ traceId: payin.traceId, ... })

deposit-workflow downstream audits
  audit.DEPOSIT_*   traceId = deposit.traceId  (= payin.traceId)

payin.updateStatus (DETECTED→CONFIRMED→CLEARED 等)
  audit.PAYIN_*   traceId = (read payin.traceId)

audit-logs.buildDepositTraceId(payinId, depositId)
  return input.traceId
       ?? deposit.traceId           (lookup)
       ?? payin.traceId             (lookup)
       ?? `DEPOSIT:${payinId}`      (legacy fallback)
```

## 历史数据处置

**不回填**——历史 audit_log_events 行的 traceId 已冻结，回填 payin 表也改不了它们；新流程双轨同 UUID 闭环，旧 deposit 详情用 fallback 兜底继续按它当时的形态显示。

## 改动颗粒度

| 文件 | 改动 |
|---|---|
| `prisma/schema.prisma` | `Payin` model 加 `traceId String?` |
| `prisma/migrations/<new>/migration.sql` | `ALTER TABLE payins ADD COLUMN traceId TEXT;` |
| `src/modules/asset-treasury/payins/payins.service.ts` | `createDetected` 生成 UUID 入表 + audit 带 traceId；`updateStatus` 各 audit 调用从表读 traceId 显式带 |
| `src/modules/trading/deposit-transactions/deposit-transactions.service.ts` | `createFromPayin` 接受/读取 payin.traceId 写入 deposit.traceId |
| `src/modules/trading/deposit-transactions/deposit-workflow.service.ts` | `onPayinCreated` 把 payin.traceId 流到 createFromPayin |
| `src/modules/audit-logging/audit-logs.service.ts` | `buildDepositTraceId` fallback 顺序按 input → deposit → payin → 拼装 |

总颗粒度：**1 表新列 + 1 迁移 + 4 服务点 + 1 fallback 升级**，约 20 行净改。**不动**资金口径、TB 记账、状态机、UI。

## 测试（TDD）

1. `payins.service.spec`：createDetected → 返回 payin.traceId 是 UUID 格式；recordSystem 收到的 input.traceId 等于该 UUID。
2. `payins.service.spec`：updateStatus → recordSystem 收到的 input.traceId 等于表里读到的 payin.traceId（mock prisma 返回带 traceId 的 payin）。
3. `deposit-workflow.service.spec`：onPayinCreated → createFromPayin 收到的 traceId === payin.traceId。
4. `audit-logs.service.spec`：buildDepositTraceId fallback 顺序——
   - 给 deposit.traceId 优先返回它；
   - 没 deposit.traceId、给 payin.traceId 返回它；
   - 都没、回退到 `DEPOSIT:${payinId}`。

## 验收

- `npx jest` 0 failed；`npm run build` 0 error。
- 新建一笔 deposit + 它的 payin → 两组 audit 事件的 `traceId` **完全相等**（一根 UUID）。SQL 实证：
  ```sql
  SELECT entityType, COUNT(DISTINCT traceId)
  FROM audit_log_events
  WHERE entityId IN (<depId>, <payinId>)
  GROUP BY entityType;
  -- 期望：DEPOSIT_TRANSACTION 1, PAYIN 1，且两者 traceId 同一值
  ```
- 历史 deposit 详情仍正常（fallback 兜底）。

## 非目标

- 不改 audit_log_events 表结构。
- 不改 traceId UUID 算法（仍 `randomUUID`）。
- 不动其他业务流（swap/withdraw/internal）的 traceId 体系。
- 不回填历史 payin.traceId。
- 不调整 UI（detail 页按 traceId 反查的能力天然受益、无需改前端）。
