# 平账 B 批：补单三入口（充值补录 / 入金退汇认领 / 出金退回认领）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对账案子里三种「外面真有钱进出、我方没记」的成因（漏记客户入金 / 入金被退汇 / 提现被银行退回）从「留档 · 指路」变成能走完的补单：运营在案子上发起，CFO 复核，充值域或提现域把流程补跑或补一个真结局，重对账后案子自愈。

**Architecture:** 入口在对账案子上、逻辑与数据在业务域（甲）。对账域只出一个「证据守卫 + 候选原单」读服务和定性行上的 `supplementNo` 回挂；充值域承接 ①补录（入站信号走既有通道，新增「待复核」态）和 ②退汇（充值单新终态 `CLAWED_BACK` + 一笔反向分录）；提现域承接 ③退回（`SUCCESS → RETURNED` 一条新边 + 复用退汇重记分录）。三条路各一个审批类型，CFO 单步。三条硬规矩：账务生效日 = 案子业务日、流水参考号 = 账单行参考号、一行只补一次。

**Tech Stack:** NestJS 10 + Prisma 5 (SQLite) + TigerBeetle ｜ React + Vite (admin-web / client-web) ｜ jest（单测）/ jest-e2e（`test/*.e2e-spec.ts`，on-stack self 串行）/ vitest（client-web）

**Spec:** `doc-final/superpowers/specs/2026-09-03-recon-supplement-design.md`（§ 号引用均指它）｜ **总纲:** `doc-final/superpowers/specs/2026-09-03-recon-settlement-waves-outline.md`

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用
- 本轮特有：**三个新审批类型全部 CFO 单步 / 48h / 可撤**；**退汇与退回不建资金单，只落账本分录**；**不新增科目**（借贷只在 `CLIENT_PAYABLE` / `CLIENT_ASSET` 之间）；**对账引擎（匹配器 / 桶 / 余额检查）一行不改**；**一条账单行只能被补单一次**（三张表各一个唯一列）；**分录 `effectiveDate` = 案子 `businessDate`、`externalRef` = 账单行 `externalRef`**（spec §2.3，匹配器第二轮按 `createdAt` 模糊配、跨天配不上，只有第一轮参考号精确配能把事后补的流水认回去）
- 派 subagent 的 prompt 必须带 CLAUDE.md §0–§5 要点：演示系统不是生产系统 ｜ 判断标准两句 ｜ 禁做清单（幂等 / 去重 / 重试 / 补偿 / 并发锁 / 兼容层 / 权限加固 / 防御校验 / 性能 / 边界防御）｜ 允许的假设（单人顺序、外部准时回调、管理员善意、数据可重铺、不写 backfill）｜ 六铁律（操作必留痕 / 门不可绕 / 各管各的 / 状态只能沿边走 / 钱动必过账 / 对外用业务键）
- 各管各的：对账域**不写**充值 / 提现 / 信号表；充值域与提现域**不写**对账表，回挂 `supplementNo` 只经 `DispositionService.linkSupplement / replaceSupplement / unlinkSupplement`；证据校验只经 `SupplementEvidenceService`
- 审计：每次带**显式 `requestId`**；十个新码出生即冻结四属性（含义 / domain / correlationMode / 特有必填）；① 的三码 + 拒绝码 `correlationMode: N`（信号没有 correlationId，照 `INBOUND_SIGNAL_*`）；②③ 的六码 `I`（照 `DEPOSIT_RETURN_*`），`*_STARTED` 带 `approvalNo` + `causationId = event.approvalId`
- 金额：账单行 `amount` 是**最小单位**；充值 / 提现单 `amount` / `netAmount` 是**业务单位**（照 `decimalToBigint`）；比对一律换到最小单位再比
- 客户面：`CLAWED_BACK` 客户可见（白名单加），标签文案沿用状态表英文口径（`CLAWED BACK`）；提现 `RETURNED` 文案已有不改
- 管理台不暴露 UUID：新端点路径用 `:depositNo` / `:withdrawNo`；`externalLineId` 只作表单隐藏锚，页面显示参考号
- 每条 Bash 命令前置 Node 20：`source scripts/node-env.sh && ensure_node20 && <命令>`（本机 shell 默认 Node 18）；一切与库 / 账本相关的命令走 `bash scripts/on-stack.sh self <npm-script> [-- args]`
- 随手闸（每个任务收尾）：`npx tsc --noEmit -p tsconfig.json`；改了 admin-web 再 `cd admin-web && npx tsc -b --noEmit && cd ..`；改了 client-web 再 `cd client-web && npx tsc -b --noEmit && cd ..` + `npm run test:client`；jest 只跑本任务目录；改了前端 → 起 preview 截图
- 提交信息用业务语言、中文、不带署名行；每个任务一个 commit
- 模型分层（CLAUDE.md §6）：任务执行 / 任务级评审 / 截图 / 文档收口 → `sonnet`；**Task 3 / 5 / 6 / 7 / 8 动钱或动状态机 → 评审升 `opus`**；终审 + 变异测试 → `fable`

## 前置：工作树与栈

```bash
# 在主工作树根（Exchange_js 的上一级 = 重做版/）执行
git worktree add -b feat/recon-supplement .claude/worktrees/recon-supplement main
cd .claude/worktrees/recon-supplement/Exchange_js
source scripts/node-env.sh && ensure_node20 && npm ci
bash scripts/stack.sh up            # self 栈，端口记在 .stackports
bash scripts/stack.sh status
```
之后所有任务在 `.claude/worktrees/recon-supplement/Exchange_js` 下进行。Task 1 改 schema 后必须 `bash scripts/stack.sh reset self` 重铺一次（含 TigerBeetle 清理重建），再 `bash scripts/on-stack.sh self demo:all` 铺演示数据。⚠ worktree 会话的 harness 拒绝复合命令（`a && b`），一条命令一次调用；后端跑的是 dist，改完后端要 `bash scripts/stack.sh up` 重启才生效。

## 文件地图

| 责任 | 文件 | 动作 |
|---|---|---|
| 数据模型 | `prisma/schema.prisma`、`prisma/migrations/<自动>_recon_supplement_entries/migration.sql` | 四张表加列 + 三个唯一索引 |
| 枚举 / 常量 | `deposit-transactions/dto/deposit-transaction.dto.ts`、`dto/inbound-transfer-signal.dto.ts`、`accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts`、`governance/approvals/constants/approval.constants.ts`、`audit-logging/constants/audit-actions.constant.ts`、`scripts/verify-rbac.ts`、`identity/access-control/rbac.catalog.ts` | 新状态 / 动作 / 转账码 / 审批类型与策略 / 审计十码 / maker 表 / 权限组四处 |
| 成因表 + 定性联动 | `reconciliation/disposition/cause-registry.ts`、`disposition.service.ts`、`domain/reconciliation-query.service.ts` | `SUPPLEMENT` 出口、新码、`supplementNo` 三个方法、读面字段 |
| 生效日管道 | `funds-orders/funds-order.service.ts`、`funds-orders/dto/funds-order.dto.ts`、`deposit-transactions.service.ts`（`detected`）、`deposit-workflow.service.ts`（`executeDepositAccounting`）、`inbound-transfer-signals.service.ts`（`advanceFundsOrder`） | 事件载荷带 `effectiveDate`；充值单 `effectiveDate` 列两步都读 |
| 证据守卫 + 候选 | `reconciliation/disposition/supplement-evidence.service.ts`（新）、`disposition.controller.ts`、`reconciliation.module.ts` | `assertClaimable` / `listCandidates` / `describeLine`；GET 端点；导出 |
| ① 补录 | `inbound-transfer-signals.service.ts`、`deposit-supplement-approval.service.ts`（新）、`deposit-transactions.controller.ts`、`deposit-transactions.module.ts` | 发起 / 批准回调 / 执行 / 拒绝；route |
| ② 退汇 | `deposit-transactions.service.ts`（迁移表、桶、白名单、两个标记方法）、`deposit-workflow.service.ts`、`deposit-clawback-approval.service.ts`（新）、`deposit-transactions.controller.ts` | 新终态一条边；发起 / 回调 / 记账 |
| ③ 退回 | `withdraw-transactions.service.ts`（迁移表、两个标记方法）、`withdraw-workflow.service.ts`、`withdraw-return-claim-approval.service.ts`（新）、`withdraw-transactions.controller.ts`、`withdraw-transactions.module.ts` | `SUCCESS→RETURNED` 一条边；发起 / 回调 / 重记 |
| 前端 · 管理台 | `admin-web/src/components/ReconciliationSupplementModal.tsx`（新）、`ReconciliationDispositionModal.tsx`、`pages/ReconciliationCasesDetailPage.tsx`、`pages/DepositTransactionDetail.tsx`、`pages/DepositTransactionList.tsx`、`pages/WithdrawTransactionDetail.tsx`、`utils/depositStatusMap.ts`、`components/ui/StatusPill.tsx` | 补单表单 / 徽标 / 新状态 / 来源块 / 补录小标 |
| 前端 · 客户端 | `client-web/src/utils/depositStatusView.ts` + `.spec.ts` | `CLAWED_BACK` 视图 |
| 演示种子 | `scripts/recon-demo.ts` | 场景 14 搬 Kate AED、新场景 15 Grace AED、头注释 15 行 |
| 测试 | 各 `*.spec.ts` + `test/recon-supplement.e2e-spec.ts`（新） | |
| 文档 | `doc-final/decisions.md`、`modules/v8-recon.md`、`modules/v4-deposit.md`、`modules/v5-withdraw.md`、`modules/overview.md`、`reference/recon-cause-handbook.md`、`demo/script.md`、`demo/data.md`、`demo/baseline.md`、`BACKLOG.md`、`CHANGELOG.md`、`superpowers/specs/2026-09-03-internal-transfer-order-design.md`（承接段） | 收口 + 承接 B 批 |

---

### Task 1: 数据模型 + 枚举 + 常量地基（审批类型 / 审计十码 / 转账码 / 权限组四处）

**本任务做：** 四张表加列与唯一索引；充值单新状态与动作、信号两态；转账码 `DEPOSIT_CLAWBACK`；三个审批类型 + 策略；审计十码 + 合同 + 三个工作流类型；`verify-rbac` maker 表三行；权限组三个（联合类型 / route / 桶 / 职务持有）。
**本任务不做：** 任何业务逻辑；不写 backfill；不动对账引擎。

**Files:**
- Modify: `prisma/schema.prisma`（`InboundTransferSignal` 约 783–810 行；`DepositTransaction` 约 816–866 行；`WithdrawTransaction` 约 1060–1118 行；`ReconciliationDisposition` 1659–1681 行）
- Create: `prisma/migrations/<时间戳>_recon_supplement_entries/migration.sql`（由 `prisma migrate dev --create-only` 生成）
- Modify: `src/modules/trading/deposit-transactions/dto/deposit-transaction.dto.ts:4-20`（状态）与 `:83-100`（动作）
- Modify: `src/modules/trading/deposit-transactions/dto/inbound-transfer-signal.dto.ts:13-18`
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts`（「充值·上缴续段(20–29)」处）
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`（`ApprovalActionTypes` 约 60 行处；`DEFAULT_APPROVAL_POLICIES` 约 344 行 `RECON_ADJUSTMENT_POST` 之后）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（`AuditBusinessWorkflowTypes` 约 124 行处；`AuditActions` 约 240 行 `DEPOSIT_RETURN_STUCK` 之后与约 373 行 `WITHDRAW_UNFROZEN` 之后；合同表约 735 行 `DEPOSIT_SEIZED` 之后与约 793 行 `WITHDRAW_UNFROZEN` 之后）
- Modify: `scripts/verify-rbac.ts:217-231`（`MAKER_GROUP_BY_POLICY`）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（`PermissionGroup` 联合 24–58 行；`route()` 292 / 317 / 392 行附近；`ACTION_BUCKET_CATALOG` trading 桶约 782 行、recon 桶约 812 行；`OPS_OFFICER` 持有块约 979 行）
- Test: `src/modules/governance/approvals/constants/approval.constants.spec.ts`（若无则新建）、`src/modules/audit-logging/constants/audit-actions.constant.spec.ts`（若无则新建）

**Interfaces（Produces，后续任务全靠这些名字）:**
- 状态 / 动作：`DepositTransactionStatus.CLAWED_BACK = 'CLAWED_BACK'`、`DepositTransactionAction.CLAWBACK = 'clawback'`、`InboundTransferSignalStatus.SUPPLEMENT_PENDING` / `SUPPLEMENT_REJECTED`
- 转账码：`TB_TRANSFER_CODES.DEPOSIT_CLAWBACK = 21`
- 审批类型：`ApprovalActionTypes.DEPOSIT_SUPPLEMENT` / `DEPOSIT_CLAWBACK` / `WITHDRAW_RETURN_CLAIM`；工作流类型同名；派生事件名 `workflow.deposit-supplement.decided` / `workflow.deposit-clawback.decided` / `workflow.withdraw-return-claim.decided`
- 审计码（10）：`DEPOSIT_SUPPLEMENT_REQUESTED` / `_STARTED` / `_REJECTED` / `DEPOSIT_SUPPLEMENTED`；`DEPOSIT_CLAWBACK_REQUESTED` / `_STARTED` / `DEPOSIT_CLAWED_BACK`；`WITHDRAW_RETURN_CLAIM_REQUESTED` / `_STARTED` / `WITHDRAW_RETURNED_AFTER_SUCCESS`
- 权限组：`DEPOSIT_SUPPLEMENT_WRITE` / `DEPOSIT_CLAWBACK_WRITE` / `WITHDRAW_RETURN_CLAIM_WRITE`（`OPS_OFFICER` 持有）
- 列：`inbound_transfer_signals.supplementOfExternalLineId(@unique) / supplementReconCaseNo / supplementDispositionNo / supplementEffectiveDate / supplementRequestedByUserId`；`deposit_transactions.effectiveDate / clawbackExternalLineId(@unique) / clawbackReconCaseNo / clawbackDispositionNo`；`withdraw_transactions.returnExternalLineId(@unique) / returnReconCaseNo / returnDispositionNo`；`reconciliation_dispositions.supplementNo`

- [ ] **Step 1: schema 四处加列**

`InboundTransferSignal` 在 `scanResult` 之后加：
```prisma
  // 平账 B 批 ①：运营凭外部账单行补录（spec §3）。一行只补一次 → 唯一。
  supplementOfExternalLineId  String?   @unique
  supplementReconCaseNo       String?
  supplementDispositionNo     String?
  supplementEffectiveDate     String?   // 案子业务日 YYYY-MM-DD，两步记账都写它
  supplementRequestedByUserId String?
```
`DepositTransaction` 在 `limitHoldReason` 之后加：
```prisma
  // 平账 B 批：补录才有值（业务归属日，两步记账都读）；② 退汇认领三列，一行只认一次 → 唯一
  effectiveDate            String?
  clawbackExternalLineId   String?   @unique
  clawbackReconCaseNo      String?
  clawbackDispositionNo    String?
```
`WithdrawTransaction` 在 `tbPendingFeeId` 之后加：
```prisma
  // 平账 B 批 ③：出款后被银行退回的认领（spec §5）
  returnExternalLineId     String?   @unique
  returnReconCaseNo        String?
  returnDispositionNo      String?
```
`ReconciliationDisposition` 在 `adjustmentNo` 之后加：
```prisma
  supplementNo            String?   // 平账 B 批：与 adjustmentNo 平行，① 先写信号号、执行后改写为充值单号
```

- [ ] **Step 2: 生成迁移并核对**

```bash
source scripts/node-env.sh && ensure_node20 && DATABASE_URL="file:/tmp/exchange_js_wt_recon-supplement/dev.db" npx prisma migrate dev --create-only --name recon_supplement_entries
```
（`DATABASE_URL` 以本 worktree `.env` 里的为准，用 `cat .env | grep DATABASE_URL` 取。）打开生成的 `migration.sql`，只允许出现 `ALTER TABLE … ADD COLUMN` 与 `CREATE UNIQUE INDEX`；有任何 DROP / 重建表即停下检查 schema 改动是否越界。

- [ ] **Step 3: 枚举与转账码**

`deposit-transaction.dto.ts`：`DepositTransactionStatus` 末尾加 `CLAWED_BACK = 'CLAWED_BACK',`（注释：`/** 平账 B 批②：入账后被银行/托管方退汇，反向分录已落，零出边终态 */`）；`DepositTransactionAction` 末尾加 `CLAWBACK = 'clawback',`。
`inbound-transfer-signal.dto.ts`：`InboundTransferSignalStatus` 加 `SUPPLEMENT_PENDING = 'SUPPLEMENT_PENDING',` 与 `SUPPLEMENT_REJECTED = 'SUPPLEMENT_REJECTED',`。
`tb-transfer-codes.constant.ts` 「充值·上缴续段(20–29)」段 `DEPOSIT_SEIZE_VOID: 20,` 之后加：
```ts
  // 平账 B 批②：入账后被银行/托管方退汇（SUCCESS→CLAWED_BACK），单腿反向：
  // DR CLIENT_PAYABLE(客户) / CR CLIENT_ASSET(SYSTEM)。不建资金单（decisions 2026-08-28）。
  DEPOSIT_CLAWBACK: 21,
```

- [ ] **Step 4: 审批类型与策略**

`ApprovalActionTypes` 在 `RECON_ADJUSTMENT_POST` 之后加：
```ts
  // 平账 B 批（2026-09-03）：补单三入口，纯资金件 → CFO 单步（合规件才归 MLRO）
  DEPOSIT_SUPPLEMENT: 'DEPOSIT_SUPPLEMENT',
  DEPOSIT_CLAWBACK: 'DEPOSIT_CLAWBACK',
  WITHDRAW_RETURN_CLAIM: 'WITHDRAW_RETURN_CLAIM',
```
`DEFAULT_APPROVAL_POLICIES` 在 `RECON_ADJUSTMENT_POST` 条目之后加三条，形状完全一样：
```ts
  [ApprovalActionTypes.DEPOSIT_SUPPLEMENT]: { steps: [{ stepNo: 1, roles: ['CFO'] }], timeoutHours: 48, allowCancel: true },
  [ApprovalActionTypes.DEPOSIT_CLAWBACK]: { steps: [{ stepNo: 1, roles: ['CFO'] }], timeoutHours: 48, allowCancel: true },
  [ApprovalActionTypes.WITHDRAW_RETURN_CLAIM]: { steps: [{ stepNo: 1, roles: ['CFO'] }], timeoutHours: 48, allowCancel: true },
```

- [ ] **Step 5: 审计十码 + 合同 + 工作流类型**

`AuditBusinessWorkflowTypes` 在 `DEPOSIT_RETURN` 附近加 `DEPOSIT_SUPPLEMENT: 'DEPOSIT_SUPPLEMENT',`、`DEPOSIT_CLAWBACK: 'DEPOSIT_CLAWBACK',`；在 `WITHDRAW_UNFREEZE` 附近加 `WITHDRAW_RETURN_CLAIM: 'WITHDRAW_RETURN_CLAIM',`。
`AuditActions`：`DEPOSIT_RETURN_STUCK` 之后加
```ts
  // 平账 B 批（2026-09-03）：补单三入口。① 主体是入站信号（无 correlationId，照 INBOUND_SIGNAL_* 走 N）
  DEPOSIT_SUPPLEMENT_REQUESTED: 'DEPOSIT_SUPPLEMENT_REQUESTED',
  DEPOSIT_SUPPLEMENT_STARTED: 'DEPOSIT_SUPPLEMENT_STARTED',
  DEPOSIT_SUPPLEMENT_REJECTED: 'DEPOSIT_SUPPLEMENT_REJECTED',
  DEPOSIT_SUPPLEMENTED: 'DEPOSIT_SUPPLEMENTED',
  // ② 主体是充值单（INHERIT，照 DEPOSIT_RETURN_*）
  DEPOSIT_CLAWBACK_REQUESTED: 'DEPOSIT_CLAWBACK_REQUESTED',
  DEPOSIT_CLAWBACK_STARTED: 'DEPOSIT_CLAWBACK_STARTED',
  DEPOSIT_CLAWED_BACK: 'DEPOSIT_CLAWED_BACK',
```
`WITHDRAW_UNFROZEN` 之后加
```ts
  // 平账 B 批③：出款成功后被银行退回的认领（INHERIT，照 WITHDRAW_UNFREEZE_*）
  WITHDRAW_RETURN_CLAIM_REQUESTED: 'WITHDRAW_RETURN_CLAIM_REQUESTED',
  WITHDRAW_RETURN_CLAIM_STARTED: 'WITHDRAW_RETURN_CLAIM_STARTED',
  WITHDRAW_RETURNED_AFTER_SUCCESS: 'WITHDRAW_RETURNED_AFTER_SUCCESS',
```
合同表（`DEPOSIT_SEIZED` 之后）：
```ts
  // ── 平账 B 批 · 补单（10）────────────────────────────────
  DEPOSIT_SUPPLEMENT_REQUESTED:   { domain: 'DEPOSIT', correlationMode: N, requiredFields: [], requiresCausation: false },
  DEPOSIT_SUPPLEMENT_STARTED:     { domain: 'DEPOSIT', correlationMode: N, requiredFields: ['approvalNo'], requiresCausation: false },
  DEPOSIT_SUPPLEMENT_REJECTED:    { domain: 'DEPOSIT', correlationMode: N, requiredFields: ['approvalNo'], requiresCausation: false },
  DEPOSIT_SUPPLEMENTED:           { domain: 'DEPOSIT', correlationMode: N, requiredFields: ['depositNo'], requiresCausation: false },
  DEPOSIT_CLAWBACK_REQUESTED:     { domain: 'DEPOSIT', correlationMode: I, requiredFields: [], requiresCausation: false },
  DEPOSIT_CLAWBACK_STARTED:       { domain: 'DEPOSIT', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  DEPOSIT_CLAWED_BACK:            { domain: 'DEPOSIT', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
```
（`WITHDRAW_UNFROZEN` 合同之后）：
```ts
  WITHDRAW_RETURN_CLAIM_REQUESTED: { domain: 'WITHDRAW', correlationMode: I, requiredFields: [], requiresCausation: false },
  WITHDRAW_RETURN_CLAIM_STARTED:   { domain: 'WITHDRAW', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  WITHDRAW_RETURNED_AFTER_SUCCESS: { domain: 'WITHDRAW', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
```
若该文件有按域封册的数组（`grep -n "_AUDIT_ACTIONS" src/modules/audit-logging/constants/audit-actions.constant.ts`，如 `V4_DEPOSIT_AUDIT_ACTIONS`），把对应新码加进去；`verify:audit` 的词表守卫会因漏加而红。

- [ ] **Step 6: maker 表 + 权限组四处**

`scripts/verify-rbac.ts` `MAKER_GROUP_BY_POLICY` 末尾加：
```ts
    DEPOSIT_SUPPLEMENT: 'DEPOSIT_SUPPLEMENT_WRITE',
    DEPOSIT_CLAWBACK: 'DEPOSIT_CLAWBACK_WRITE',
    WITHDRAW_RETURN_CLAIM: 'WITHDRAW_RETURN_CLAIM_WRITE',
```
`rbac.catalog.ts`：
1. `PermissionGroup` 联合类型在 `'DEPOSIT_UNFREEZE_WRITE'` 后加 `| 'DEPOSIT_SUPPLEMENT_WRITE' | 'DEPOSIT_CLAWBACK_WRITE'`，在 `'WITHDRAW_UNFREEZE_WRITE'` 后加 `| 'WITHDRAW_RETURN_CLAIM_WRITE'`
2. `route()`：`/deposit-transactions/:id/unfreeze` 那行之后加
```ts
  route('POST', '/deposit-transactions/supplement', 'Open a supplement approval: replay a missed inbound (from a reconciliation statement line)', ['DEPOSIT_SUPPLEMENT_WRITE']),
  route('POST', '/deposit-transactions/:depositNo/clawback', 'Open a clawback approval: a credited deposit was reversed by the bank', ['DEPOSIT_CLAWBACK_WRITE']),
```
`/withdraw-transactions/:id/refund` 之后加
```ts
  route('POST', '/withdraw-transactions/:withdrawNo/return-claim', 'Open a return-claim approval: a completed payout bounced back', ['WITHDRAW_RETURN_CLAIM_WRITE']),
```
`/admin/reconciliation/cases/:caseNo/reattribution-candidates` 之后加
```ts
  route('GET', '/admin/reconciliation/cases/:caseNo/supplement-candidates', 'Statement-line facts + candidate original orders for a supplement', ['RECON_CASE_READ']),
```
3. `ACTION_BUCKET_CATALOG` trading 桶在 `trading.act_deposit_unfreeze` 之后加
```ts
      { key: 'trading.act_deposit_supplement', label: 'Request missed-deposit replay', description: 'Open a CFO approval to replay a missed inbound from a reconciliation statement line', groups: ['DEPOSIT_SUPPLEMENT_WRITE'] },
      { key: 'trading.act_deposit_clawback', label: 'Request deposit clawback', description: 'Open a CFO approval to book a bank reversal of a credited deposit', groups: ['DEPOSIT_CLAWBACK_WRITE'] },
```
`trading.act_withdraw_unfreeze` 之后加
```ts
      { key: 'trading.act_withdraw_return_claim', label: 'Request payout-return claim', description: 'Open a CFO approval to re-credit a completed payout that bounced back', groups: ['WITHDRAW_RETURN_CLAIM_WRITE'] },
```
4. `OPS_OFFICER` 持有块的 `'DEPOSIT_WAIVE_WRITE', … 'DEPOSIT_SEIZE_WRITE',` 那行末尾加 `'DEPOSIT_SUPPLEMENT_WRITE', 'DEPOSIT_CLAWBACK_WRITE',`；`'TRADING_WITHDRAW_WRITE', 'WITHDRAW_BOUNCE_WRITE', 'WITHDRAW_REFUND_WRITE',` 那行末尾加 `'WITHDRAW_RETURN_CLAIM_WRITE',`

- [ ] **Step 7: 单测（先红后绿）**

`src/modules/governance/approvals/constants/approval.constants.spec.ts`（无则新建）加：
```ts
import { ApprovalActionTypes, DEFAULT_APPROVAL_POLICIES } from './approval.constants';

describe('平账 B 批：补单三审批策略', () => {
  it.each([
    ApprovalActionTypes.DEPOSIT_SUPPLEMENT,
    ApprovalActionTypes.DEPOSIT_CLAWBACK,
    ApprovalActionTypes.WITHDRAW_RETURN_CLAIM,
  ])('%s = CFO 单步 / 48h / 可撤', (type) => {
    const p = (DEFAULT_APPROVAL_POLICIES as any)[type];
    expect(p.steps).toEqual([{ stepNo: 1, roles: ['CFO'] }]);
    expect(p.timeoutHours).toBe(48);
    expect(p.allowCancel).toBe(true);
  });
});
```
`src/modules/audit-logging/constants/audit-actions.constant.spec.ts`（无则新建）加：
```ts
import { AuditActions, AUDIT_ACTION_CONTRACTS } from './audit-actions.constant';

describe('平账 B 批：补单十码出生即冻结四属性', () => {
  const codes = [
    'DEPOSIT_SUPPLEMENT_REQUESTED', 'DEPOSIT_SUPPLEMENT_STARTED', 'DEPOSIT_SUPPLEMENT_REJECTED', 'DEPOSIT_SUPPLEMENTED',
    'DEPOSIT_CLAWBACK_REQUESTED', 'DEPOSIT_CLAWBACK_STARTED', 'DEPOSIT_CLAWED_BACK',
    'WITHDRAW_RETURN_CLAIM_REQUESTED', 'WITHDRAW_RETURN_CLAIM_STARTED', 'WITHDRAW_RETURNED_AFTER_SUCCESS',
  ] as const;
  it.each(codes)('%s 在词表且有合同', (code) => {
    expect((AuditActions as any)[code]).toBe(code);
    const c = (AUDIT_ACTION_CONTRACTS as any)[code];
    expect(c).toBeDefined();
    expect(['DEPOSIT', 'WITHDRAW']).toContain(c.domain);
  });
  it('STARTED 三码必填 approvalNo；终态三码必填 from/toStatus 或 depositNo', () => {
    const contracts = AUDIT_ACTION_CONTRACTS as any;
    for (const c of ['DEPOSIT_SUPPLEMENT_STARTED', 'DEPOSIT_CLAWBACK_STARTED', 'WITHDRAW_RETURN_CLAIM_STARTED']) {
      expect(contracts[c].requiredFields).toContain('approvalNo');
    }
    expect(contracts.DEPOSIT_CLAWED_BACK.requiredFields).toEqual(['fromStatus', 'toStatus']);
    expect(contracts.WITHDRAW_RETURNED_AFTER_SUCCESS.requiredFields).toEqual(['fromStatus', 'toStatus']);
    expect(contracts.DEPOSIT_SUPPLEMENTED.requiredFields).toEqual(['depositNo']);
  });
});
```
（合同表的导出名以文件里实际的为准：`grep -n "export const .*CONTRACTS" src/modules/audit-logging/constants/audit-actions.constant.ts`。）

Run: `source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test -- src/modules/governance/approvals/constants src/modules/audit-logging/constants`
Expected: 全绿

- [ ] **Step 8: 重铺 + 同步 + 重启 + 闸门**

```bash
source scripts/node-env.sh && ensure_node20 && npm run prisma:generate
bash scripts/stack.sh reset self
bash scripts/on-stack.sh self demo:all
bash scripts/stack.sh up
npx tsc --noEmit -p tsconfig.json
bash scripts/on-stack.sh self verify:rbac
```
Expected: reset 全绿、demo:all 29/29 + COA 5/5、tsc 0、verify:rbac 全绿（新三策略 maker≠checker 通过；四处齐：`PermissionGroup` / route / 桶 / OPS_OFFICER）。

- [ ] **Step 9: 提交**

```bash
git add prisma/schema.prisma prisma/migrations src/modules/trading/deposit-transactions/dto src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts src/modules/governance/approvals/constants src/modules/audit-logging/constants scripts/verify-rbac.ts src/modules/identity/access-control/rbac.catalog.ts
git commit -m "feat(recon): 平账 B 批地基——补单三入口的表列 / 新状态 / 转账码 / 三个 CFO 审批策略 / 审计十码 / 权限组四处"
```

---

### Task 2: 成因表开出 `SUPPLEMENT` 出口 + 新码 `PAYOUT_RETURNED` + 定性行回挂 `supplementNo`

**本任务做：** `cause-registry.ts` 加 `kind: 'SUPPLEMENT'`（两码改口、一码新增、方向校验）；`DispositionService` 三个回挂方法 + 覆盖锁扩到 `supplementNo`；读面把 `supplementNo` / `deferredTarget` / `supplementRef` 随定性行下发。
**本任务不做：** 任何充值 / 提现域代码；不改匹配器；不动 `resolveWriteOff`。

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/disposition/cause-registry.ts`（类型 9–20 行；`CauseSpec` 39–46 行；注册表 `MISSED_DEPOSIT` / `BOUNCED_FUNDS` 69–70 行；`staticOutletLabel` 100–106 行；`resolveOutlet` 136–146 行）
- Modify: `src/modules/clearing-settle/reconciliation/disposition/disposition.service.ts`（`record` 55–60 行的覆盖锁；`linkAdjustment` 119–128 行之后加三个方法）
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts:497-504`（定性行映射）
- Test: `disposition/cause-registry.spec.ts`、`disposition/disposition.service.spec.ts`

**Interfaces（Produces）:**
- `CauseSpec.kind` 新值 `'SUPPLEMENT'`，配 `supplementTarget: DeferredTarget`、`supplementLabel: string`、`requiredDirection: 'IN' | 'OUT'`
- `StoredOutlet` 新值 `'SUPPLEMENT'`；`DeferredTarget` 新值 `'SUPPLEMENT_PAYOUT_RETURN'`；`CauseCode` 新值 `'PAYOUT_RETURNED'`
- `resolveOutlet(code, facts)` 对 SUPPLEMENT 码返回 `{ outlet: 'SUPPLEMENT', outletLabel: '补单·<label>', deferredTarget }`；`facts.externalDirection` 与 `requiredDirection` 不符 → `BadRequestException`
- `DispositionService.linkSupplement(dispositionNo, supplementNo, target)` / `replaceSupplement(dispositionNo, from, to)` / `unlinkSupplement(dispositionNo, expected)`
- 读面定性行新增字段：`deferredTarget: string | null`、`supplementNo: string | null`、`supplementRef: { kind: 'SIGNAL' | 'DEPOSIT' | 'WITHDRAW'; no: string; id: string | null } | null`

- [ ] **Step 1: 注册表单测先红**

`cause-registry.spec.ts` 追加：
```ts
describe('平账 B 批：补单出口（spec §6）', () => {
  it('成因码 21 个；三码走 SUPPLEMENT 出口', () => {
    expect(Object.keys(CAUSE_REGISTRY)).toHaveLength(21);
    expect(CAUSE_REGISTRY.MISSED_DEPOSIT.kind).toBe('SUPPLEMENT');
    expect(CAUSE_REGISTRY.BOUNCED_FUNDS.kind).toBe('SUPPLEMENT');
    expect(CAUSE_REGISTRY.PAYOUT_RETURNED.kind).toBe('SUPPLEMENT');
    expect(staticOutletLabel('MISSED_DEPOSIT')).toBe('补单·充值补录');
    expect(staticOutletLabel('BOUNCED_FUNDS')).toBe('补单·退汇认领');
    expect(staticOutletLabel('PAYOUT_RETURNED')).toBe('补单·退回认领');
  });
  it('resolveOutlet：出口 SUPPLEMENT + 去向', () => {
    expect(resolveOutlet('MISSED_DEPOSIT', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'IN' }))
      .toEqual({ outlet: 'SUPPLEMENT', outletLabel: '补单·充值补录', deferredTarget: 'SUPPLEMENT_DEPOSIT' });
    expect(resolveOutlet('BOUNCED_FUNDS', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'OUT' }).deferredTarget).toBe('SUPPLEMENT_BOUNCE');
    expect(resolveOutlet('PAYOUT_RETURNED', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'IN' }).deferredTarget).toBe('SUPPLEMENT_PAYOUT_RETURN');
  });
  it('成因与账单行方向不符 → 400', () => {
    expect(() => resolveOutlet('MISSED_DEPOSIT', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'OUT' })).toThrow(/方向不符/);
    expect(() => resolveOutlet('BOUNCED_FUNDS', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'IN' })).toThrow(/方向不符/);
  });
  it('菜单顺序：外有我无×客户 = 漏记 / 退汇 / 退回 / 记错客户 / 未授权 / 查不出', () => {
    expect(menuFor('ORPHAN_EXTERNAL', 'CLIENT').map((m) => m.code))
      .toEqual(['MISSED_DEPOSIT', 'BOUNCED_FUNDS', 'PAYOUT_RETURNED', 'MISATTRIBUTED_TO', 'UNAUTHORIZED_OUTFLOW', 'UNEXPLAINED']);
  });
});
```
Run: `source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test -- src/modules/clearing-settle/reconciliation/disposition/cause-registry.spec.ts`
Expected: FAIL（`PAYOUT_RETURNED` 不存在、码数 20、标签仍是「留档·…」）

- [ ] **Step 2: 改注册表**

类型：
```ts
export type StoredOutlet =
  | 'ADJUST_CORRECT' | 'ADJUST_REVERSE' | 'ADJUST_RECORD' | 'ADJUST_REATTRIBUTE'
  | 'HOLD_NEXT_PERIOD' | 'HOLD_INVESTIGATING' | 'DEFERRED' | 'SUPPLEMENT';
export type DeferredTarget =
  | 'SUPPLEMENT_DEPOSIT'        // 补单 → 充值域补录（B 批已开）
  | 'SUPPLEMENT_BOUNCE'         // 补单 → 入金退汇认领（B 批已开）
  | 'SUPPLEMENT_PAYOUT_RETURN'  // 补单 → 出金退回认领（B 批已开）
  | 'INTERNAL_TRANSFER'         // 二期内部划转
  | 'INCIDENT'                  // 三期事故升级
  | 'NO_REASON_CODE';           // 冲正类成因遇 SWAP 流水，无对应 reason 码（spec §11-6）
```
`CauseCode` 联合在 `'BOUNCED_FUNDS'` 后插入 `| 'PAYOUT_RETURNED'`。`CauseSpec`：
```ts
  kind: 'ADJUST' | 'HOLD_NEXT_PERIOD' | 'HOLD_INVESTIGATING' | 'DEFERRED' | 'SUPPLEMENT';
  family?: AdjustFamily;           // kind=ADJUST 必有
  deferredTarget?: DeferredTarget; // kind=DEFERRED 必有
  deferredLabel?: string;          // kind=DEFERRED 必有（界面显示去向）
  supplementTarget?: DeferredTarget; // kind=SUPPLEMENT 必有（业务域入口）
  supplementLabel?: string;          // kind=SUPPLEMENT 必有（「补单·<label>」）
  requiredDirection?: 'IN' | 'OUT';  // kind=SUPPLEMENT 必有：账单行方向必须与成因一致
```
注册表「外有我无 × 客户」段改为（顺序即菜单顺序，手册同步）：
```ts
  MISSED_DEPOSIT:   { cells: [C('ORPHAN_EXTERNAL', 'CLIENT')], label: '漏记客户入金', clue: '外部行带客户归属（VIBAN/链上地址）', kind: 'SUPPLEMENT', supplementTarget: 'SUPPLEMENT_DEPOSIT', supplementLabel: '充值补录', requiredDirection: 'IN' },
  BOUNCED_FUNDS:    { cells: [C('ORPHAN_EXTERNAL', 'CLIENT')], label: '入金被退汇/回冲', clue: '外部 OUT 与此前某笔成功入金同源', kind: 'SUPPLEMENT', supplementTarget: 'SUPPLEMENT_BOUNCE', supplementLabel: '退汇认领', requiredDirection: 'OUT' },
  PAYOUT_RETURNED:  { cells: [C('ORPHAN_EXTERNAL', 'CLIENT')], label: '提现被银行退回（出款后退汇）', clue: '外部 IN 与某笔成功提现同额，带原出款关联号', kind: 'SUPPLEMENT', supplementTarget: 'SUPPLEMENT_PAYOUT_RETURN', supplementLabel: '退回认领', requiredDirection: 'IN' },
  MISATTRIBUTED_TO:     …（原样）
  UNAUTHORIZED_OUTFLOW: …（原样）
```
`staticOutletLabel` 在 `HOLD_INVESTIGATING` 分支后加 `if (spec.kind === 'SUPPLEMENT') return \`补单·${spec.supplementLabel}\`;`。
`resolveOutlet` 在 `DEFERRED` 分支前加：
```ts
  if (spec.kind === 'SUPPLEMENT') {
    // 平账 B 批（spec §2.1-3）：补单三路各认一个方向，选错成因当场拒，不让错方向的表单开出来。
    if (facts.externalDirection && facts.externalDirection !== spec.requiredDirection) {
      throw new BadRequestException(`成因 ${code} 要求账单行方向为 ${spec.requiredDirection}，该行是 ${facts.externalDirection}——成因与账单行方向不符`);
    }
    return { outlet: 'SUPPLEMENT', outletLabel: `补单·${spec.supplementLabel}`, deferredTarget: spec.supplementTarget };
  }
```
文件头注释追加一行：`// 平账 B 批（2026-09-03）：漏记入金 / 入金退汇 / 提现退回 三码改走 SUPPLEMENT 出口（补单开门）。`

- [ ] **Step 3: 定性服务**

`record()` 的覆盖锁改为：
```ts
    if (existing?.adjustmentNo) {
      throw new BadRequestException(`该行定性已挂调账单 ${existing.adjustmentNo}，不可覆盖——单和结论必须对得上`);
    }
    if (existing?.supplementNo) {
      throw new BadRequestException(`该行定性已转补单 ${existing.supplementNo}，不可覆盖——单和结论必须对得上`);
    }
```
`linkAdjustment` 之后加：
```ts
  /**
   * 平账 B 批（spec §2.5）：补单回挂。① 申请时挂信号号、执行后改写为充值单号；② 挂充值单号；③ 挂提现单号。
   * 挂了就锁死（record 的覆盖锁），审批被拒 / 撤回 / 超时由业务域调 unlinkSupplement 解开。
   */
  async linkSupplement(dispositionNo: string, supplementNo: string, target: DeferredTarget): Promise<void> {
    const row = await (this.prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo } });
    if (!row) throw new NotFoundException(`定性记录不存在：${dispositionNo}`);
    if (row.outlet !== 'SUPPLEMENT' || row.deferredTarget !== target) {
      throw new BadRequestException(`定性 ${dispositionNo} 的出口是 ${row.outlet}/${row.deferredTarget ?? '-'}，不接 ${target} 的补单`);
    }
    if (row.supplementNo) throw new BadRequestException(`定性 ${dispositionNo} 已转补单 ${row.supplementNo}`);
    await (this.prisma as any).reconciliationDisposition.update({ where: { dispositionNo }, data: { supplementNo } });
  }

  async replaceSupplement(dispositionNo: string, from: string, to: string): Promise<void> {
    const row = await (this.prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo } });
    if (!row) throw new NotFoundException(`定性记录不存在：${dispositionNo}`);
    if (row.supplementNo !== from) throw new BadRequestException(`定性 ${dispositionNo} 挂的是 ${row.supplementNo ?? '-'}，不是 ${from}`);
    await (this.prisma as any).reconciliationDisposition.update({ where: { dispositionNo }, data: { supplementNo: to } });
  }

  async unlinkSupplement(dispositionNo: string, expected: string): Promise<void> {
    const row = await (this.prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo } });
    if (!row) throw new NotFoundException(`定性记录不存在：${dispositionNo}`);
    if (row.supplementNo !== expected) return; // 已被别的路径清掉或改写，不动
    await (this.prisma as any).reconciliationDisposition.update({ where: { dispositionNo }, data: { supplementNo: null } });
  }
```
（`DeferredTarget` 从 `./cause-registry` 引入。）

- [ ] **Step 4: 定性服务单测**

`disposition.service.spec.ts` 追加（照该文件既有的 prisma mock 写法）：
```ts
describe('平账 B 批：supplementNo 回挂与覆盖锁', () => {
  it('linkSupplement：出口不是 SUPPLEMENT 或去向不符 → 400；已挂 → 400；正常写入', async () => {
    prisma.reconciliationDisposition.findUnique.mockResolvedValueOnce({ dispositionNo: 'RCD1', outlet: 'HOLD_INVESTIGATING', deferredTarget: null, supplementNo: null });
    await expect(service.linkSupplement('RCD1', 'SIG1', 'SUPPLEMENT_DEPOSIT')).rejects.toThrow(/不接/);
    prisma.reconciliationDisposition.findUnique.mockResolvedValueOnce({ dispositionNo: 'RCD1', outlet: 'SUPPLEMENT', deferredTarget: 'SUPPLEMENT_DEPOSIT', supplementNo: 'SIG0' });
    await expect(service.linkSupplement('RCD1', 'SIG1', 'SUPPLEMENT_DEPOSIT')).rejects.toThrow(/已转补单/);
    prisma.reconciliationDisposition.findUnique.mockResolvedValueOnce({ dispositionNo: 'RCD1', outlet: 'SUPPLEMENT', deferredTarget: 'SUPPLEMENT_DEPOSIT', supplementNo: null });
    await service.linkSupplement('RCD1', 'SIG1', 'SUPPLEMENT_DEPOSIT');
    expect(prisma.reconciliationDisposition.update).toHaveBeenCalledWith({ where: { dispositionNo: 'RCD1' }, data: { supplementNo: 'SIG1' } });
  });
  it('record：已转补单的定性不可覆盖', async () => {
    // 按该文件既有 record() 用例的 mock 铺法，只把 existing 换成带 supplementNo 的行
    // …expect(service.record(...)).rejects.toThrow(/已转补单/)
  });
  it('unlinkSupplement：挂的不是期望值就不动', async () => {
    prisma.reconciliationDisposition.findUnique.mockResolvedValueOnce({ dispositionNo: 'RCD1', supplementNo: 'DEP9' });
    await service.unlinkSupplement('RCD1', 'SIG1');
    expect(prisma.reconciliationDisposition.update).not.toHaveBeenCalled();
  });
});
```
第二个用例的 mock 铺法照本文件里现成的 `record()` 用例复制（它们已经 mock 了 `reconciliationCase.findUnique` + `reconciliationDisposition.findFirst`），只改 `findFirst` 返回 `{ dispositionNo: 'RCD1', adjustmentNo: null, supplementNo: 'SIG1' }` 并断言 `rejects.toThrow(/已转补单/)`——写成真实断言，不留注释。

- [ ] **Step 5: 读面**

`reconciliation-query.service.ts` 定性行映射对象加三个字段（放在 `adjustmentNo` 之后）：
```ts
        findingNote: d.findingNote, adjustmentNo: d.adjustmentNo ?? null,
        deferredTarget: d.deferredTarget ?? null,
        supplementNo: d.supplementNo ?? null,
        supplementRef: await this.resolveSupplementRef(d.supplementNo ?? null),
```
并在同文件加一个私有方法（横向只读三张业务表，取展示用的 id 与类型）：
```ts
  /** 补单回挂的单号 → 详情页链接用的 { kind, no, id }。SIG… 没有页面，id 为 null。 */
  private async resolveSupplementRef(no: string | null): Promise<{ kind: 'SIGNAL' | 'DEPOSIT' | 'WITHDRAW'; no: string; id: string | null } | null> {
    if (!no) return null;
    if (no.startsWith('DEP')) {
      const d = await (this.prisma as any).depositTransaction.findUnique({ where: { depositNo: no }, select: { id: true } });
      return { kind: 'DEPOSIT', no, id: d?.id ?? null };
    }
    if (no.startsWith('WDR') || no.startsWith('WD')) {
      const w = await (this.prisma as any).withdrawTransaction.findUnique({ where: { withdrawNo: no }, select: { id: true } });
      return { kind: 'WITHDRAW', no, id: w?.id ?? null };
    }
    return { kind: 'SIGNAL', no, id: null };
  }
```
提现单号前缀以 `generateReferenceNo` 在提现域实际用的前缀为准（`grep -n "generateReferenceNo('" src/modules/trading/withdraw-transactions/*.ts`），把上面的判断改成那个前缀。映射所在的循环若是同步 `map`，改成 `for … of` 顺序 `await`。

- [ ] **Step 6: 闸门 + 提交**

```bash
source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test -- src/modules/clearing-settle/reconciliation
npx tsc --noEmit -p tsconfig.json
git add src/modules/clearing-settle/reconciliation
git commit -m "feat(recon): 成因表开出补单出口——漏记入金 / 入金退汇 / 提现退回三码 + 定性行回挂 supplementNo"
```

---

### Task 3: 生效日管道——事后补的流水记到案子的业务日

**本任务做：** 资金单 `create` 事件载荷带 `effectiveDate`；充值 `detected()` 接收并落到充值单 `effectiveDate` 列；两步记账都读它；信号服务 `advanceFundsOrder` / `processSignal` 透传。
**本任务不做：** 任何补单业务逻辑；不改匹配器；不给资金单表加列（spec §2.3：事件字段，不落表）。

**Files:**
- Modify: `src/modules/funds-orders/dto/funds-order.dto.ts:23-47`（`CreateFundsOrderInput`）
- Modify: `src/modules/funds-orders/funds-order.service.ts:45-100`（`create` 的 emit）
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts:1090-1101`（`detected` 入参）与 create data
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts:1711-1717`（`executeDepositAccounting` 生效日取值）与 STEP_2 调用处 `:1169`
- Modify: `src/modules/trading/deposit-transactions/inbound-transfer-signals.service.ts:361-365`（`processSignal` 签名）、`:375-385`（`detected` 调用）、`:391-393`（`advanceFundsOrder` 调用）、`:498-530`（`advanceFundsOrder` 签名与 CONFIRM 步）
- Test: `src/modules/funds-orders/funds-order.service.spec.ts`、`src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts`

**Interfaces（Produces）:**
- `CreateFundsOrderInput.effectiveDate?: string`；`funds_order.status.changed` 事件载荷在 create 路径也带 `effectiveDate`
- `DepositTransactionsService.detected(input & { effectiveDate?: string })` → 充值单 `effectiveDate` 列
- `InboundTransferSignalsService.processSignal(signal, wallet, mode, opts?: { effectiveDate?: string })`（私有，Task 5 用）
- 记账规则：`effectiveDate = deposit.effectiveDate ?? 事件带来的 effectiveDate ?? undefined`，STEP_1 与 STEP_2 一致

- [ ] **Step 1: 资金单单测先红**

`funds-order.service.spec.ts` 加（照该文件 `advance forwards opts.effectiveDate` 用例的 mock 铺法）：
```ts
  it('create emits effectiveDate from input when given (fiat CONFIRMED-at-birth path)', async () => {
    // 复制文件里 create() 既有用例的 prisma/eventEmitter mock，initialStatus 用 CONFIRMED
    await service.create({ depositTransactionId: 'dep1', assetId: 'asset-aed', amount: '10', initialStatus: FundsOrderStatus.CONFIRMED, effectiveDate: '2026-09-01' } as any);
    const payload = eventEmitter.emit.mock.calls.find(([name]: any[]) => name === 'funds_order.status.changed')[1];
    expect(payload.effectiveDate).toBe('2026-09-01');
  });
```
Run: `source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test -- src/modules/funds-orders/funds-order.service.spec.ts`
Expected: FAIL（payload 无 effectiveDate）

- [ ] **Step 2: 资金单**

`CreateFundsOrderInput` 加 `effectiveDate?: string; // 平账 B 批：事后补的单记到案子业务日；只随事件走，不落表`。`create()` 的 emit 对象加 `effectiveDate: input.effectiveDate,`。

- [ ] **Step 3: 充值单 + 记账**

`detected()` 入参加 `effectiveDate?: string;`，create data 加 `effectiveDate: input.effectiveDate ?? undefined,`；`fundsOrders.create({...})` 加 `effectiveDate: input.effectiveDate ?? undefined,`。
`executeDepositAccounting` 开头（取 `asset` 之后）加：
```ts
    // 平账 B 批（spec §2.3）：补录的充值单带业务归属日，两步记账都用它；普通充值恒 undefined
    // （推单回填那条路径仍从事件带来，优先级低于单上的列）。
    const effectiveDateResolved: string | undefined = deposit.effectiveDate ?? effectiveDate;
```
两处 `...(effectiveDate && { effectiveDate })` 改为 `...(effectiveDateResolved && { effectiveDate: effectiveDateResolved })`。STEP_2 的调用处 `executeDepositAccounting(deposit, 'STEP_2', payinFundsOrder)` 不用改（列在 deposit 上）。`deposit-workflow.service.spec.ts` 加一条：deposit 带 `effectiveDate: '2026-09-01'` 时，STEP_2 的 `executeTransfer` evidence 含 `effectiveDate: '2026-09-01'`（照该文件既有 STEP_2 用例的 mock）。

- [ ] **Step 4: 信号服务透传**

`processSignal(signal, wallet, mode = QUICK_DEMO, opts?: { effectiveDate?: string })`；`detected({ …, effectiveDate: opts?.effectiveDate })`；`advanceFundsOrder(fundsOrder.id, signal.channelType, opts?.effectiveDate)`。`advanceFundsOrder(fundsOrderId, channelType, effectiveDate?: string)` 的 CONFIRM 步改为 `this.fundsOrderService.advance(fundsOrderId, FundsOrderAction.CONFIRM, 'SYSTEM', undefined, effectiveDate ? { effectiveDate } : undefined)`。

- [ ] **Step 5: 闸门 + 提交**

```bash
source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test -- src/modules/funds-orders src/modules/trading/deposit-transactions
npx tsc --noEmit -p tsconfig.json
git add src/modules/funds-orders src/modules/trading/deposit-transactions
git commit -m "feat(deposit): 生效日管道——补录的充值单记到案子业务日，两步记账与资金单事件一并带上"
```

---

### Task 4: 补单证据守卫 + 候选原单读接口（对账域）

**本任务做：** `SupplementEvidenceService`（`assertClaimable` / `listCandidates` / `describeLine`）；`GET /admin/reconciliation/cases/:caseNo/supplement-candidates`；`ReconciliationModule` 导出该服务与 `DispositionService`。
**本任务不做：** 不写任何表；不建审批；充值 / 提现域代码不动。

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/disposition/supplement-evidence.service.ts`
- Modify: `src/modules/clearing-settle/reconciliation/disposition/disposition.controller.ts:37-41`（加 GET）
- Modify: `src/modules/clearing-settle/reconciliation/reconciliation.module.ts:39-56`（providers + exports）
- Test: `src/modules/clearing-settle/reconciliation/disposition/supplement-evidence.service.spec.ts`

**Interfaces（Produces）:**
```ts
export type SupplementKind = 'SUPPLEMENT_DEPOSIT' | 'SUPPLEMENT_BOUNCE' | 'SUPPLEMENT_PAYOUT_RETURN';
export interface ClaimableLine {
  externalLineId: string; caseNo: string; caseId: string; businessDate: string;   // 生效日 = businessDate
  dispositionNo: string | null;
  walletId: string; walletNo: string | null; walletAddress: string | null; walletIban: string | null;
  ownerId: string; ownerNo: string | null;
  assetId: string; currency: string; assetType: 'CRYPTO' | 'FIAT'; decimals: number;
  direction: 'IN' | 'OUT'; amountMinor: string; amountMajor: string;
  externalRef: string | null; channelRef: string | null; datetime: string; description: string | null; source: string;
}
export interface SupplementCandidate { orderNo: string; id: string; amountMajor: string; createdAt: string; status: string }
assertClaimable(input: { caseNo; externalLineId; dispositionNo; kind: SupplementKind }): Promise<ClaimableLine>   // 守卫 §2.1 1–5，任一不满足 400
listCandidates(caseNo, externalLineId): Promise<{ line: ClaimableLine; kind: SupplementKind | null; candidates: SupplementCandidate[] }>
describeLine(externalLineId): Promise<Pick<ClaimableLine, 'externalLineId' | 'externalRef' | 'channelRef' | 'businessDate' | 'caseNo' | 'amountMinor' | 'direction'>>  // 执行期取参考号与生效日
minorToMajor(minor: string, decimals: number): string   // 纯函数，导出供三域复用
```

- [ ] **Step 1: 单测先红**

`supplement-evidence.service.spec.ts`（prisma 用 jest mock 对象，照同目录 `disposition.service.spec.ts` 的搭法）：
```ts
import { BadRequestException } from '@nestjs/common';
import { SupplementEvidenceService, minorToMajor } from './supplement-evidence.service';

const prisma: any = {
  reconciliationCase: { findUnique: jest.fn() },
  externalStatementLine: { findUnique: jest.fn() },
  reconciliationDisposition: { findUnique: jest.fn() },
  wallet: { findUnique: jest.fn() },
  customerMain: { findUnique: jest.fn() },
  inboundTransferSignal: { findFirst: jest.fn() },
  depositTransaction: { findFirst: jest.fn(), findMany: jest.fn() },
  withdrawTransaction: { findFirst: jest.fn(), findMany: jest.fn() },
};
const service = new SupplementEvidenceService(prisma);

const kase = { id: 'case-1', caseNo: 'REC1', status: 'OPEN', book: 'CLIENT', walletRef: 'w1', businessDate: '2026-09-01', ownerNo: 'CUS1',
  lineItems: [{ externalTxId: 'line-1', matchStatus: 'ORPHAN_EXTERNAL' }] };
const line = { id: 'line-1', direction: 'IN', amount: '120000', currency: 'AED', externalRef: 'REF-1', channelRef: null, datetime: new Date('2026-09-01T10:00:00Z'), description: 'Incoming', source: 'ZAND' };
const wallet = { id: 'w1', walletNo: 'W-1', address: null, iban: 'AE00', ownerId: 'cust-1', assetId: 'a1', asset: { id: 'a1', currency: 'AED', type: 'FIAT', decimals: 2 } };
const disposition = { dispositionNo: 'RCD1', caseNo: 'REC1', explainedExternalLineId: 'line-1', outlet: 'SUPPLEMENT', deferredTarget: 'SUPPLEMENT_DEPOSIT', supplementNo: null };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.reconciliationCase.findUnique.mockResolvedValue(kase);
  prisma.externalStatementLine.findUnique.mockResolvedValue(line);
  prisma.wallet.findUnique.mockResolvedValue(wallet);
  prisma.customerMain.findUnique.mockResolvedValue({ customerNo: 'CUS1' });
  prisma.reconciliationDisposition.findUnique.mockResolvedValue(disposition);
  prisma.inboundTransferSignal.findFirst.mockResolvedValue(null);
  prisma.depositTransaction.findFirst.mockResolvedValue(null);
  prisma.withdrawTransaction.findFirst.mockResolvedValue(null);
});

describe('minorToMajor', () => {
  it('120000 分 → 1200.00；4700 → 0.004700（6 位）', () => {
    expect(minorToMajor('120000', 2)).toBe('1200.00');
    expect(minorToMajor('4700', 6)).toBe('0.004700');
  });
});

describe('assertClaimable（spec §2.1）', () => {
  const ok = { caseNo: 'REC1', externalLineId: 'line-1', dispositionNo: 'RCD1', kind: 'SUPPLEMENT_DEPOSIT' as const };
  it('全部满足 → 返回行事实（最小单位 + 业务单位 + 业务日）', async () => {
    const r = await service.assertClaimable(ok);
    expect(r.amountMinor).toBe('120000'); expect(r.amountMajor).toBe('1200.00'); expect(r.businessDate).toBe('2026-09-01');
    expect(r.ownerNo).toBe('CUS1'); expect(r.assetType).toBe('FIAT');
  });
  it('案子不是 OPEN / 不是客户账簿 → 400', async () => {
    prisma.reconciliationCase.findUnique.mockResolvedValueOnce({ ...kase, status: 'RESOLVED' });
    await expect(service.assertClaimable(ok)).rejects.toThrow(BadRequestException);
    prisma.reconciliationCase.findUnique.mockResolvedValueOnce({ ...kase, book: 'FIRM' });
    await expect(service.assertClaimable(ok)).rejects.toThrow(/客户账簿/);
  });
  it('行不在最新一轮差异行里 / 不是外有我无 → 400', async () => {
    prisma.reconciliationCase.findUnique.mockResolvedValueOnce({ ...kase, lineItems: [{ externalTxId: 'line-1', matchStatus: 'MATCHED' }] });
    await expect(service.assertClaimable(ok)).rejects.toThrow(/外有我无/);
  });
  it('方向与路不符 → 400（① 要 IN，给 OUT）', async () => {
    prisma.externalStatementLine.findUnique.mockResolvedValueOnce({ ...line, direction: 'OUT' });
    await expect(service.assertClaimable(ok)).rejects.toThrow(/方向/);
  });
  it('已被认领（信号 / 充值 / 提现任一）→ 400', async () => {
    prisma.inboundTransferSignal.findFirst.mockResolvedValueOnce({ signalNo: 'SIG9' });
    await expect(service.assertClaimable(ok)).rejects.toThrow(/SIG9/);
  });
  it('定性不是该行 / 出口不是 SUPPLEMENT / 去向不符 / 已挂补单 → 400', async () => {
    prisma.reconciliationDisposition.findUnique.mockResolvedValueOnce({ ...disposition, deferredTarget: 'SUPPLEMENT_BOUNCE' });
    await expect(service.assertClaimable(ok)).rejects.toThrow(/去向/);
    prisma.reconciliationDisposition.findUnique.mockResolvedValueOnce({ ...disposition, supplementNo: 'SIG1' });
    await expect(service.assertClaimable(ok)).rejects.toThrow(/已转补单/);
  });
});

describe('listCandidates', () => {
  it('② 退汇：同钱包 SUCCESS 同额充值单，按创建时间倒序', async () => {
    prisma.externalStatementLine.findUnique.mockResolvedValueOnce({ ...line, direction: 'OUT' });
    prisma.reconciliationDisposition.findUnique.mockResolvedValue(null);
    prisma.depositTransaction.findMany.mockResolvedValueOnce([
      { id: 'd1', depositNo: 'DEP1', amount: '1200', status: 'SUCCESS', createdAt: new Date('2026-08-30') },
      { id: 'd2', depositNo: 'DEP2', amount: '4000', status: 'SUCCESS', createdAt: new Date('2026-08-31') },
    ]);
    const r = await service.listCandidates('REC1', 'line-1');
    expect(r.kind).toBe('SUPPLEMENT_BOUNCE');
    expect(r.candidates.map((c) => c.orderNo)).toEqual(['DEP1']);
  });
});
```
Run: `source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test -- src/modules/clearing-settle/reconciliation/disposition/supplement-evidence.service.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 2: 写服务**

```ts
// src/modules/clearing-settle/reconciliation/disposition/supplement-evidence.service.ts
// 平账 B 批（spec §2.1）：补单三路共用的证据守卫 + 候选原单。只读；证据永远是一条
// external_statement_lines 行，认领与否写在业务域各自的表上（三张表各一个唯一列），
// 对账域在这里只负责「能不能补」的判断，不写任何表。
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';

export type SupplementKind = 'SUPPLEMENT_DEPOSIT' | 'SUPPLEMENT_BOUNCE' | 'SUPPLEMENT_PAYOUT_RETURN';

const DIRECTION_BY_KIND: Record<SupplementKind, 'IN' | 'OUT'> = {
  SUPPLEMENT_DEPOSIT: 'IN', SUPPLEMENT_BOUNCE: 'OUT', SUPPLEMENT_PAYOUT_RETURN: 'IN',
};

export interface ClaimableLine {
  externalLineId: string; caseNo: string; caseId: string; businessDate: string;
  dispositionNo: string | null;
  walletId: string; walletNo: string | null; walletAddress: string | null; walletIban: string | null;
  ownerId: string; ownerNo: string | null;
  assetId: string; currency: string; assetType: 'CRYPTO' | 'FIAT'; decimals: number;
  direction: 'IN' | 'OUT'; amountMinor: string; amountMajor: string;
  externalRef: string | null; channelRef: string | null; datetime: string; description: string | null; source: string;
}

export interface SupplementCandidate { orderNo: string; id: string; amountMajor: string; createdAt: string; status: string }

/** 最小单位整数字符串 → 业务单位字符串（补零到 decimals 位，不四舍五入）。 */
export function minorToMajor(minor: string, decimals: number): string {
  const neg = minor.startsWith('-');
  const digits = (neg ? minor.slice(1) : minor).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals);
  return `${neg ? '-' : ''}${whole}${decimals > 0 ? '.' + frac : ''}`;
}

function majorToMinor(major: Prisma.Decimal | string, decimals: number): bigint {
  const [whole, frac = ''] = String(major).split('.');
  return BigInt(whole + frac.padEnd(decimals, '0').slice(0, decimals));
}

@Injectable()
export class SupplementEvidenceService {
  constructor(private readonly prisma: PrismaService) {}

  async assertClaimable(input: { caseNo: string; externalLineId: string; dispositionNo: string; kind: SupplementKind }): Promise<ClaimableLine> {
    const facts = await this.loadLine(input.caseNo, input.externalLineId);
    const want = DIRECTION_BY_KIND[input.kind];
    if (facts.direction !== want) {
      throw new BadRequestException(`该账单行方向是 ${facts.direction}，这条补单路要求 ${want}——成因与账单行方向不符`);
    }
    const d = await (this.prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo: input.dispositionNo } });
    if (!d || d.caseNo !== input.caseNo || d.explainedExternalLineId !== input.externalLineId) {
      throw new BadRequestException(`定性 ${input.dispositionNo} 不是这条账单行的定性`);
    }
    if (d.outlet !== 'SUPPLEMENT') throw new BadRequestException(`定性 ${input.dispositionNo} 的出口是 ${d.outlet}，不是补单`);
    if (d.deferredTarget !== input.kind) throw new BadRequestException(`定性 ${input.dispositionNo} 的去向是 ${d.deferredTarget}，与本路不符`);
    if (d.supplementNo) throw new BadRequestException(`定性 ${input.dispositionNo} 已转补单 ${d.supplementNo}`);
    await this.assertUnclaimed(input.externalLineId);
    return { ...facts, dispositionNo: d.dispositionNo };
  }

  async listCandidates(caseNo: string, externalLineId: string) {
    const line = await this.loadLine(caseNo, externalLineId);
    const kase = await (this.prisma as any).reconciliationCase.findUnique({ where: { caseNo } });
    const d = await (this.prisma as any).reconciliationDisposition.findFirst({ where: { caseNo, explainedExternalLineId: externalLineId } });
    const kind: SupplementKind | null = d?.outlet === 'SUPPLEMENT' ? d.deferredTarget : (line.direction === 'OUT' ? 'SUPPLEMENT_BOUNCE' : null);
    const target = BigInt(line.amountMinor);
    let candidates: SupplementCandidate[] = [];
    if (kind === 'SUPPLEMENT_BOUNCE') {
      const rows = await (this.prisma as any).depositTransaction.findMany({
        where: { toWalletId: line.walletId, status: 'SUCCESS' }, orderBy: { createdAt: 'desc' },
      });
      candidates = rows.filter((r: any) => majorToMinor(r.amount, line.decimals) === target)
        .map((r: any) => ({ orderNo: r.depositNo, id: r.id, amountMajor: String(r.amount), createdAt: r.createdAt.toISOString(), status: r.status }));
    } else if (kind === 'SUPPLEMENT_PAYOUT_RETURN') {
      const rows = await (this.prisma as any).withdrawTransaction.findMany({
        where: { fromWalletId: line.walletId, status: 'SUCCESS' }, orderBy: { createdAt: 'desc' },
      });
      candidates = rows.filter((r: any) => majorToMinor(r.netAmount, line.decimals) === target)
        .map((r: any) => ({ orderNo: r.withdrawNo, id: r.id, amountMajor: String(r.netAmount), createdAt: r.createdAt.toISOString(), status: r.status }));
    }
    return { line: { ...line, dispositionNo: d?.dispositionNo ?? null, businessDate: kase.businessDate }, kind, candidates };
  }

  /** 执行期：只要参考号 / 关联号 / 业务日 / 案号，不重跑守卫（守卫在提交与批准两个时点已跑）。 */
  async describeLine(externalLineId: string) {
    const line = await (this.prisma as any).externalStatementLine.findUnique({ where: { id: externalLineId } });
    if (!line) throw new NotFoundException(`账单行不存在：${externalLineId}`);
    const li = await (this.prisma as any).reconciliationLineItem.findFirst({
      where: { externalTxId: externalLineId }, orderBy: { createdAt: 'desc' }, include: { case: true },
    });
    return {
      externalLineId, externalRef: line.externalRef ?? null, channelRef: line.channelRef ?? null,
      businessDate: li?.case?.businessDate ?? line.datetime.toISOString().slice(0, 10),
      caseNo: li?.case?.caseNo ?? null, amountMinor: line.amount.toString(), direction: line.direction as 'IN' | 'OUT',
    };
  }

  // ── 内部 ──
  private async loadLine(caseNo: string, externalLineId: string): Promise<ClaimableLine> {
    const kase = await (this.prisma as any).reconciliationCase.findUnique({ where: { caseNo }, include: { lineItems: true } });
    if (!kase) throw new NotFoundException(`对账案件不存在：${caseNo}`);
    if (kase.status !== 'OPEN') throw new BadRequestException(`案子 ${caseNo} 不是打开状态，不能补单`);
    if (kase.book !== 'CLIENT') throw new BadRequestException(`案子 ${caseNo} 不是客户账簿，补单只对客户钱包`);
    const li = (kase.lineItems ?? []).find((x: any) => x.externalTxId === externalLineId);
    if (!li || li.matchStatus !== 'ORPHAN_EXTERNAL') {
      throw new BadRequestException('该账单行不是本案最新一轮的「外有我无」差异行');
    }
    const line = await (this.prisma as any).externalStatementLine.findUnique({ where: { id: externalLineId } });
    if (!line) throw new NotFoundException(`账单行不存在：${externalLineId}`);
    const wallet = await (this.prisma as any).wallet.findUnique({ where: { id: kase.walletRef }, include: { asset: true } });
    if (!wallet?.asset) throw new BadRequestException(`案子 ${caseNo} 的钱包或资产不存在`);
    if (String(wallet.asset.currency) !== String(line.currency)) {
      throw new BadRequestException(`账单行币种 ${line.currency} 与钱包资产 ${wallet.asset.currency} 不符`);
    }
    const owner = wallet.ownerId ? await (this.prisma as any).customerMain.findUnique({ where: { id: wallet.ownerId }, select: { customerNo: true } }) : null;
    const decimals: number = wallet.asset.decimals ?? 2;
    const amountMinor = line.amount.toString();
    return {
      externalLineId, caseNo, caseId: kase.id, businessDate: kase.businessDate, dispositionNo: null,
      walletId: wallet.id, walletNo: wallet.walletNo ?? null, walletAddress: wallet.address ?? null, walletIban: wallet.iban ?? null,
      ownerId: wallet.ownerId, ownerNo: owner?.customerNo ?? kase.ownerNo ?? null,
      assetId: wallet.assetId, currency: wallet.asset.currency, assetType: String(wallet.asset.type).toUpperCase() === 'CRYPTO' ? 'CRYPTO' : 'FIAT', decimals,
      direction: line.direction, amountMinor, amountMajor: minorToMajor(amountMinor, decimals),
      externalRef: line.externalRef ?? null, channelRef: line.channelRef ?? null, datetime: line.datetime.toISOString(),
      description: line.description ?? null, source: line.source,
    };
  }

  private async assertUnclaimed(externalLineId: string): Promise<void> {
    const sig = await (this.prisma as any).inboundTransferSignal.findFirst({ where: { supplementOfExternalLineId: externalLineId }, select: { signalNo: true } });
    if (sig) throw new BadRequestException(`该账单行已被补录 ${sig.signalNo} 认领`);
    const dep = await (this.prisma as any).depositTransaction.findFirst({ where: { clawbackExternalLineId: externalLineId }, select: { depositNo: true } });
    if (dep) throw new BadRequestException(`该账单行已被退汇认领 ${dep.depositNo} 占用`);
    const wd = await (this.prisma as any).withdrawTransaction.findFirst({ where: { returnExternalLineId: externalLineId }, select: { withdrawNo: true } });
    if (wd) throw new BadRequestException(`该账单行已被退回认领 ${wd.withdrawNo} 占用`);
  }
}
```

- [ ] **Step 3: 端点 + 模块**

`disposition.controller.ts` 注入 `SupplementEvidenceService`，在 `reattribution-candidates` 之后加：
```ts
  @Get('supplement-candidates')
  @ApiOperation({ summary: 'Statement-line facts + candidate original orders for a supplement (平账 B 批)' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/reconciliation/cases/:caseNo/supplement-candidates'))
  supplementCandidates(@Param('caseNo') caseNo: string, @Query('externalLineId') externalLineId: string) {
    return this.supplementEvidence.listCandidates(caseNo, externalLineId);
  }
```
`reconciliation.module.ts`：providers 加 `SupplementEvidenceService`；`exports` 改为 `[WalletReconRunService, CaseAgingService, DispositionService, SupplementEvidenceService]`。

- [ ] **Step 4: 闸门 + 提交**

```bash
source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test -- src/modules/clearing-settle/reconciliation/disposition
npx tsc --noEmit -p tsconfig.json
bash scripts/stack.sh up
git add src/modules/clearing-settle/reconciliation
git commit -m "feat(recon): 补单证据守卫与候选原单读接口——一条账单行只能补一次、方向与成因必须对上"
```

---

### Task 5: ① 充值补录——凭账单行补喂入站信号，CFO 批准后走正常充值通道

**本任务做：** `InboundTransferSignalsService.initiateSupplement`（守卫 → 建 `SUPPLEMENT_PENDING` 信号 → 审批单 → 回挂 → 审计）、`workflow.deposit-supplement.decided` 回调（批准：信号进通道，QUICK_DEMO 驱动，生效日 = 案子业务日；拒绝 / 撤回 / 超时：信号 `SUPPLEMENT_REJECTED`、解挂、审计）、`DepositSupplementApprovalService`、`POST /deposit-transactions/supplement`。
**本任务不做：** ②③；不做客户端那道「可交易资格」检查（spec §3：钱已物理进了，该冻该退由充值域自己的闸决定）；不做幂等 / 重试。

**Files:**
- Modify: `src/modules/trading/deposit-transactions/inbound-transfer-signals.service.ts`（构造函数 62–68 行；`createForCustomer` 之后加三个公开方法 + 一个 `@OnEvent`；`processSignal` 已在 Task 3 加了 opts）
- Create: `src/modules/trading/deposit-transactions/deposit-supplement-approval.service.ts`
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.controller.ts`（`:id/return` 那组之前加 `@Post('supplement')`——**必须排在所有 `:id` 路由之前声明**）
- Modify: `src/modules/trading/deposit-transactions/dto/deposit-transaction.dto.ts`（`InitiateDepositReturnDto` 旁加 `InitiateDepositSupplementDto`）
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.module.ts:23-58`（imports 加 `ReconciliationModule`；providers 加 `DepositSupplementApprovalService`）
- Test: `src/modules/trading/deposit-transactions/inbound-transfer-signals.service.spec.ts`

**Interfaces（Produces）:**
- `initiateSupplement(dto: { externalLineId; caseNo; dispositionNo; fromAddress?; fromIban?; reason }, actor: ApprovalActorContext): Promise<{ signalNo; approvalNo; status: 'SUPPLEMENT_PENDING' }>`
- 事件 `workflow.deposit-supplement.decided` → `onSupplementDecided(event: ApprovalDecidedEvent)`
- 审批 `objectSnapshot`：`{ signalNo, caseNo, dispositionNo, externalLineId, externalRef, walletNo, customerNo, amount, currency, impact }`

- [ ] **Step 1: 单测先红**

`inbound-transfer-signals.service.spec.ts` 追加（照该文件的 mock 搭法，新增 `supplementEvidence` / `reconDisposition` / `approvalsService` 三个 mock）：
```ts
describe('平账 B 批 ①：补录', () => {
  const line = { externalLineId: 'line-1', caseNo: 'REC1', caseId: 'c1', businessDate: '2026-09-01', dispositionNo: 'RCD1',
    walletId: 'w1', walletNo: 'W-1', walletAddress: null, walletIban: 'AE00', ownerId: 'cust-1', ownerNo: 'CUS1',
    assetId: 'a1', currency: 'AED', assetType: 'FIAT', decimals: 2, direction: 'IN', amountMinor: '120000', amountMajor: '1200.00',
    externalRef: 'REF-1', channelRef: null, datetime: '2026-09-01T10:00:00.000Z', description: 'Incoming', source: 'ZAND' };
  const actor = { actorType: 'ADMIN', userId: 'u1', userNo: 'ADM1', role: 'OPS_OFFICER', roleCodes: ['OPS_OFFICER'] } as any;

  it('发起：法币缺来源 IBAN → 400；链上缺来源地址 → 400', async () => {
    supplementEvidence.assertClaimable.mockResolvedValue(line);
    await expect(service.initiateSupplement({ externalLineId: 'line-1', caseNo: 'REC1', dispositionNo: 'RCD1', reason: 'x' }, actor)).rejects.toThrow(/IBAN/);
    supplementEvidence.assertClaimable.mockResolvedValue({ ...line, assetType: 'CRYPTO', externalRef: '0xabc' });
    await expect(service.initiateSupplement({ externalLineId: 'line-1', caseNo: 'REC1', dispositionNo: 'RCD1', reason: 'x' }, actor)).rejects.toThrow(/地址/);
  });

  it('发起：建 SUPPLEMENT_PENDING 信号（参考号 = 账单行参考号、金额换业务单位、生效日 = 案子业务日）→ 审批单 → 回挂 → 审计', async () => {
    supplementEvidence.assertClaimable.mockResolvedValue(line);
    prisma.inboundTransferSignal.create.mockResolvedValue({ id: 's1', signalNo: 'SIG1', walletId: 'w1' });
    approvalsService.createAndSubmit.mockResolvedValue({ approvalNo: 'APR1' });
    const r = await service.initiateSupplement({ externalLineId: 'line-1', caseNo: 'REC1', dispositionNo: 'RCD1', fromIban: 'AE11', reason: '银行看到了我们漏了' }, actor);
    const data = prisma.inboundTransferSignal.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'SUPPLEMENT_PENDING', channelType: 'FIAT', referenceNo: 'REF-1', fromIban: 'AE11',
      supplementOfExternalLineId: 'line-1', supplementReconCaseNo: 'REC1', supplementDispositionNo: 'RCD1', supplementEffectiveDate: '2026-09-01' });
    expect(String(data.amount)).toBe('1200.00');
    expect(approvalsService.createAndSubmit.mock.calls[0][0]).toMatchObject({ actionType: 'DEPOSIT_SUPPLEMENT', entityRef: 'SIG1' });
    expect(reconDisposition.linkSupplement).toHaveBeenCalledWith('RCD1', 'SIG1', 'SUPPLEMENT_DEPOSIT');
    expect(auditLogsService.recordByActor.mock.calls[0][0]).toMatchObject({ action: 'DEPOSIT_SUPPLEMENT_REQUESTED', primarySubjectNo: 'SIG1' });
    expect(r).toEqual({ signalNo: 'SIG1', approvalNo: 'APR1', status: 'SUPPLEMENT_PENDING' });
  });

  it('批准：信号 → PENDING_SCAN，processSignal 带生效日，回挂改写为充值单号，审计 SUPPLEMENTED', async () => {
    prisma.inboundTransferSignal.findUnique.mockResolvedValue({ id: 's1', signalNo: 'SIG1', status: 'SUPPLEMENT_PENDING', walletId: 'w1', channelType: 'FIAT',
      supplementDispositionNo: 'RCD1', supplementEffectiveDate: '2026-09-01', wallet: { id: 'w1', asset: { type: 'FIAT' } } });
    const spy = jest.spyOn(service as any, 'processSignal').mockResolvedValue({ depositNo: 'DEP7', depositId: 'd7' });
    await service.onSupplementDecided({ decision: 'APPROVED', entityRef: 'SIG1', approvalId: 'ap1', approvalNo: 'APR1' } as any);
    expect(spy.mock.calls[0][3]).toEqual({ effectiveDate: '2026-09-01' });
    expect(reconDisposition.replaceSupplement).toHaveBeenCalledWith('RCD1', 'SIG1', 'DEP7');
    const actions = auditLogsService.recordSystem.mock.calls.map((c: any[]) => c[0].action);
    expect(actions).toEqual(expect.arrayContaining(['DEPOSIT_SUPPLEMENT_STARTED', 'DEPOSIT_SUPPLEMENTED']));
  });

  it('拒绝：信号 → SUPPLEMENT_REJECTED，解挂，审计 REJECTED；不进通道', async () => {
    prisma.inboundTransferSignal.findUnique.mockResolvedValue({ id: 's1', signalNo: 'SIG1', status: 'SUPPLEMENT_PENDING', supplementDispositionNo: 'RCD1' });
    const spy = jest.spyOn(service as any, 'processSignal');
    await service.onSupplementDecided({ decision: 'DECLINED', entityRef: 'SIG1', approvalId: 'ap1', approvalNo: 'APR1' } as any);
    expect(spy).not.toHaveBeenCalled();
    expect(prisma.inboundTransferSignal.update.mock.calls[0][0].data.status).toBe('SUPPLEMENT_REJECTED');
    expect(reconDisposition.unlinkSupplement).toHaveBeenCalledWith('RCD1', 'SIG1');
  });
});
```
Run: `source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test -- src/modules/trading/deposit-transactions/inbound-transfer-signals.service.spec.ts`
Expected: FAIL（方法不存在）

- [ ] **Step 2: 审批处理器（17 行）**

```ts
// src/modules/trading/deposit-transactions/deposit-supplement-approval.service.ts
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

/** 平账 B 批 ①：补录审批（CFO 单步）。裁决后派生 `workflow.deposit-supplement.decided`，由 InboundTransferSignalsService 接。 */
@Injectable()
export class DepositSupplementApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.DEPOSIT_SUPPLEMENT;
  readonly workflowType = AuditBusinessWorkflowTypes.DEPOSIT_SUPPLEMENT;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
```

- [ ] **Step 3: 信号服务**

构造函数加三个依赖（`ApprovalsService`、`SupplementEvidenceService`、对账域 `DispositionService`——与本域钱侧的 `DispositionService` 同名，**用别名引入**）：
```ts
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import { SupplementEvidenceService, ClaimableLine } from '../../clearing-settle/reconciliation/disposition/supplement-evidence.service';
import { DispositionService as ReconDispositionService } from '../../clearing-settle/reconciliation/disposition/disposition.service';
import { OnEvent } from '@nestjs/event-emitter';
…
    private readonly approvalsService: ApprovalsService,
    private readonly supplementEvidence: SupplementEvidenceService,
    private readonly reconDisposition: ReconDispositionService,
```
在 `createForCustomer` 之后加：
```ts
  // ═══ 平账 B 批 ①：运营凭账单行补录（spec §3）═══════════════════════════════
  // 与 createForCustomer 的区别：① 不做 assertTradingEligibility——那是拦客户「发起」的，
  // 钱已经物理进了，该冻该退由充值域自己的闸决定；② 金额 / 币种 / 钱包 / 参考号全从账单行来，
  // 运营只补来源地址或来源 IBAN；③ 先挂「待复核」，CFO 批了才进通道。
  async initiateSupplement(
    dto: { externalLineId: string; caseNo: string; dispositionNo: string; fromAddress?: string; fromIban?: string; reason: string },
    actor: ApprovalActorContext,
  ): Promise<{ signalNo: string; approvalNo: string; status: 'SUPPLEMENT_PENDING' }> {
    const line = await this.supplementEvidence.assertClaimable({ caseNo: dto.caseNo, externalLineId: dto.externalLineId, dispositionNo: dto.dispositionNo, kind: 'SUPPLEMENT_DEPOSIT' });
    const isCrypto = line.assetType === 'CRYPTO';
    if (isCrypto && !dto.fromAddress?.trim()) throw new BadRequestException('链上补录必须填来源地址');
    if (!isCrypto && !dto.fromIban?.trim()) throw new BadRequestException('法币补录必须填来源 IBAN');
    if (!line.externalRef) throw new BadRequestException('该账单行没有参考号，补录后对账配不回去——先在账单侧补参考号');
    const channelType = isCrypto ? InboundTransferChannelType.CRYPTO : InboundTransferChannelType.FIAT;
    const dedupeKey = this.buildDedupeKey({ channelType, walletId: line.walletId, assetId: line.assetId, txHash: isCrypto ? line.externalRef : undefined, referenceNo: isCrypto ? undefined : line.externalRef });
    const created = await (this.prisma as any).inboundTransferSignal.create({
      data: {
        signalNo: generateReferenceNo('SIG'),
        ownerId: line.ownerId, walletId: line.walletId, assetId: line.assetId, channelType,
        amount: new Prisma.Decimal(line.amountMajor),
        txHash: isCrypto ? line.externalRef : null, referenceNo: isCrypto ? null : line.externalRef,
        fromAddress: dto.fromAddress ?? null, fromIban: dto.fromIban ?? null,
        counterpartyIsVasp: isCrypto ? false : null,
        status: InboundTransferSignalStatus.SUPPLEMENT_PENDING, dedupeKey, submittedAt: new Date(),
        supplementOfExternalLineId: line.externalLineId, supplementReconCaseNo: line.caseNo,
        supplementDispositionNo: line.dispositionNo, supplementEffectiveDate: line.businessDate,
        supplementRequestedByUserId: actor.userId ?? null,
      },
    });
    const traceId = randomUUID();
    const impact = `补录 ${line.ownerNo ?? line.ownerId} 的 ${line.amountMajor} ${line.currency} 入金（对账案 ${line.caseNo}，账单行 ${line.externalRef}）——充值单将照常过 KYT 与合规闸`;
    const approvalCase = await this.approvalsService.createAndSubmit(
      { actionType: ApprovalActionTypes.DEPOSIT_SUPPLEMENT, entityRef: created.signalNo, traceId,
        objectSnapshot: { signalNo: created.signalNo, caseNo: line.caseNo, dispositionNo: line.dispositionNo, externalLineId: line.externalLineId,
          externalRef: line.externalRef, walletNo: line.walletNo, customerNo: line.ownerNo, amount: line.amountMajor, currency: line.currency, impact } },
      { reason: dto.reason, traceId }, actor,
    );
    await this.reconDisposition.linkSupplement(line.dispositionNo!, created.signalNo, 'SUPPLEMENT_DEPOSIT');
    await this.auditLogsService.recordByActor({
      action: AuditActions.DEPOSIT_SUPPLEMENT_REQUESTED, actionDomain: 'DEPOSIT',
      primarySubjectType: AuditEntityTypes.INBOUND_TRANSFER_SIGNAL, primarySubjectNo: created.signalNo,
      ownerCustomerNo: line.ownerNo ?? undefined,
      subjects: [
        { subjectType: AuditEntityTypes.INBOUND_TRANSFER_SIGNAL, subjectNo: created.signalNo, subjectRole: 'PRIMARY' },
        { subjectType: 'RECONCILIATION_CASE', subjectNo: line.caseNo, subjectRole: 'RELATED' },
        { subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: approvalCase.approvalNo, subjectRole: 'INSTRUMENT' },
      ],
      reason: dto.reason, approvalNo: approvalCase.approvalNo,
      requestId: `DEPOSIT_SUPPLEMENT_REQUESTED_${created.signalNo}_${randomUUID()}`,
      metadata: { caseNo: line.caseNo, dispositionNo: line.dispositionNo, externalLineId: line.externalLineId, externalRef: line.externalRef, amount: line.amountMajor, currency: line.currency },
      sourcePlatform: 'ADMIN_API',
    } as any, { actorType: 'ADMIN', actorNo: actor.userNo ?? actor.userId ?? 'ADMIN', actorDisplayName: actor.userNo ?? actor.userId ?? 'ADMIN', actorRolesAtTime: actor.roleCodes ?? [] });
    return { signalNo: created.signalNo, approvalNo: approvalCase.approvalNo, status: 'SUPPLEMENT_PENDING' };
  }

  @OnEvent('workflow.deposit-supplement.decided', { async: true })
  async onSupplementDecided(event: ApprovalDecidedEvent) {
    const signal = await (this.prisma as any).inboundTransferSignal.findUnique({ where: { signalNo: event.entityRef }, include: { wallet: { include: { asset: true } } } });
    if (!signal) return; // entityRef 不是我们的主体
    if (signal.status !== InboundTransferSignalStatus.SUPPLEMENT_PENDING) {
      this.logger.warn(`Supplement ${signal.signalNo} decided ${event.decision} but status is ${signal.status} — ignored`);
      return;
    }
    if (event.decision !== 'APPROVED') {
      await (this.prisma as any).inboundTransferSignal.update({ where: { id: signal.id }, data: { status: InboundTransferSignalStatus.SUPPLEMENT_REJECTED, scanResult: `Supplement ${event.decision} (${event.approvalNo})` } });
      if (signal.supplementDispositionNo) await this.reconDisposition.unlinkSupplement(signal.supplementDispositionNo, signal.signalNo);
      await this.recordSignalAudit({ action: AuditActions.DEPOSIT_SUPPLEMENT_REJECTED, signal, reason: `补录审批 ${event.decision}：${event.decisionReason ?? ''}`, approvalNo: event.approvalNo, metadata: { approvalNo: event.approvalNo, decision: event.decision }, sourcePlatform: 'SYSTEM' });
      return;
    }
    await (this.prisma as any).inboundTransferSignal.update({ where: { id: signal.id }, data: { status: InboundTransferSignalStatus.PENDING_SCAN } });
    await this.recordSignalAudit({ action: AuditActions.DEPOSIT_SUPPLEMENT_STARTED, signal, reason: 'CFO 批准补录，信号进入正常充值通道', approvalNo: event.approvalNo, metadata: { approvalNo: event.approvalNo, caseNo: signal.supplementReconCaseNo }, sourcePlatform: 'SYSTEM' });
    const result = await this.processSignal(signal, signal.wallet, InboundTransferScanMode.QUICK_DEMO, { effectiveDate: signal.supplementEffectiveDate ?? undefined });
    if (result.depositNo && signal.supplementDispositionNo) {
      await this.reconDisposition.replaceSupplement(signal.supplementDispositionNo, signal.signalNo, result.depositNo);
    }
    await this.recordSignalAudit({ action: AuditActions.DEPOSIT_SUPPLEMENTED, signal, reason: '补录完成：充值单已建，走正常 KYT / 合规', approvalNo: event.approvalNo, metadata: { depositNo: result.depositNo, caseNo: signal.supplementReconCaseNo, effectiveDate: signal.supplementEffectiveDate }, sourcePlatform: 'SYSTEM' });
  }
```
`recordSignalAudit` 的入参加可选 `approvalNo?: string`，写进 `recordSystem` 的顶层字段（`approvalNo` 是合同必填，metadata 不算）。`processSignal` 的返回值里 `depositNo` 已有（第 445 行附近）。

- [ ] **Step 4: 端点 + DTO + 模块**

`deposit-transaction.dto.ts` 在 `InitiateDepositReturnDto` 旁加：
```ts
export class InitiateDepositSupplementDto {
  @IsString() externalLineId!: string;
  @IsString() caseNo!: string;
  @IsString() dispositionNo!: string;
  @IsOptional() @IsString() fromAddress?: string;
  @IsOptional() @IsString() fromIban?: string;
  @IsString() reason!: string;
}
```
`deposit-transactions.controller.ts` 注入 `InboundTransferSignalsService`（已在本模块），在第一个 `:id` 路由之前加：
```ts
  @Post('supplement')
  @ApiOperation({ summary: '平账 B 批 ①：凭对账账单行补录漏记入金（CFO maker-checker）' })
  @RequirePermissions(buildPermissionCode('POST', '/deposit-transactions/supplement'))
  initiateSupplement(@Body() dto: InitiateDepositSupplementDto, @Req() req: any) {
    this.assertAdmin(req);
    const actor: ApprovalActorContext = { actorType: 'ADMIN', userId: req.user?.userId, userNo: req.user?.userNo, role: req.user?.role, roleCodes: req.user?.roleCodes || (req.user?.role ? [req.user.role] : []) };
    return this.inboundSignals.initiateSupplement(dto, actor);
  }
```
`deposit-transactions.module.ts`：imports 加 `ReconciliationModule`（`import { ReconciliationModule } from '../../clearing-settle/reconciliation/reconciliation.module';`），providers 加 `DepositSupplementApprovalService`。若 Nest 启动报模块环，用 `forwardRef(() => ReconciliationModule)`——这是 DI 接线，不是兼容层。

- [ ] **Step 5: 闸门 + 提交**

```bash
source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test -- src/modules/trading/deposit-transactions
npx tsc --noEmit -p tsconfig.json
bash scripts/on-stack.sh self db:base:sync
bash scripts/stack.sh up
git add src/modules/trading/deposit-transactions
git commit -m "feat(deposit): 补录入口——凭对账账单行补喂入站信号，CFO 批准后走正常充值通道并记到案子业务日"
```
启动后用 SUPER_ADMIN token 打一次 `POST /deposit-transactions/supplement`（缺参数）确认 400 而不是 404 / 403。

---

### Task 6: ② 入金退汇认领——充值单 SUCCESS → CLAWED_BACK，一笔反向分录

**本任务做：** 充值单迁移表加边 `SUCCESS —CLAWBACK→ CLAWED_BACK`；列表桶与客户白名单收编 `CLAWED_BACK`；`DepositWorkflowService.initiateClawback / onClawbackDecided / executeClawback`（余额前置条件两时点各查一次；分录借 `CLIENT_PAYABLE` / 贷 `CLIENT_ASSET`，码 `DEPOSIT_CLAWBACK`，`externalRef` = 行参考号，`effectiveDate` = 案子业务日）；`DepositClawbackApprovalService`；`POST /deposit-transactions/:depositNo/clawback`。
**本任务不做：** 不建资金单；不做垫款 / 追索（二期 / 三期）；不触发合规复核；不改引擎。

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`（迁移表 `[DepositTransactionStatus.RETURNING]` 之前加 `[SUCCESS]` 块；桶 `RETURNED_BUCKET_WHERE` 约 58 行；白名单 `CUSTOMER_STATUS_PASSTHROUGH` 约 94 行与 `completedAt` 白名单约 103 行；末尾加两个标记方法）
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`（构造函数加 `SupplementEvidenceService` + 对账 `DispositionService` 别名；`initiateReturn` 附近加三个方法 + 一个 `@OnEvent`）
- Create: `src/modules/trading/deposit-transactions/deposit-clawback-approval.service.ts`（与 Task 5 处理器同形，类型换 `DEPOSIT_CLAWBACK`）
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.controller.ts`（`:id/return` 之后加 `@Post(':depositNo/clawback')`）
- Modify: `src/modules/trading/deposit-transactions/dto/deposit-transaction.dto.ts`（`InitiateDepositClawbackDto`）
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.module.ts`（providers 加 `DepositClawbackApprovalService`）
- Test: `deposit-transactions.service.spec.ts`、`deposit-workflow.service.spec.ts`

**Interfaces（Produces）:**
- `DepositTransactionsService.markClawbackRequested(id, { externalLineId, caseNo, dispositionNo })` / `clearClawbackRequest(id)`
- `DepositWorkflowService.initiateClawback(depositNo, dto: { externalLineId; caseNo; dispositionNo; reason }, actor): Promise<{ depositNo; approvalNo; status: 'PENDING_APPROVAL' }>`
- 事件 `workflow.deposit-clawback.decided` → `onClawbackDecided(event)`
- 分录：`DR CLIENT_PAYABLE(客户) / CR CLIENT_ASSET(SYSTEM)`，evidence `{ sourceType: 'DEPOSIT', sourceNo: depositNo, eventCode: 'DEPOSIT_CLAWBACK', debitWalletRef = creditWalletRef = toWalletId, externalRef, isExternalCrossing: true, effectiveDate }`

- [ ] **Step 1: 单测先红**

`deposit-transactions.service.spec.ts` 加：
```ts
describe('平账 B 批 ②：退汇终态', () => {
  it('SUCCESS —clawback→ CLAWED_BACK；其余状态 clawback 非法', () => {
    expect((service as any).resolveNextStatus(DepositTransactionStatus.SUCCESS, DepositTransactionAction.CLAWBACK)).toBe(DepositTransactionStatus.CLAWED_BACK);
    expect(() => (service as any).resolveNextStatus(DepositTransactionStatus.COMPLIANCE_PENDING, DepositTransactionAction.CLAWBACK)).toThrow(/Invalid action/);
    expect(() => (service as any).resolveNextStatus(DepositTransactionStatus.CLAWED_BACK, DepositTransactionAction.APPROVE)).toThrow(/Invalid action/);
  });
  it('CLAWED_BACK 客户可见（白名单）且落 RETURNED 桶', () => {
    expect(service.toCustomerStatus('CLAWED_BACK')).toBe('CLAWED_BACK');
    expect(CUSTOMER_BUCKETS.RETURNED).toEqual({ status: { in: ['RETURNED', 'CLAWED_BACK'] } });
  });
});
```
（迁移表所在私有方法名与 `CUSTOMER_BUCKETS` 导出名以文件实际为准：`grep -n "transitions\[current\]\|CUSTOMER_BUCKETS" deposit-transactions.service.ts`。）

`deposit-workflow.service.spec.ts` 加（照该文件既有 `initiateReturn` / `onReturnDecided` 用例的 mock 搭法，新增 `supplementEvidence` / `reconDisposition` mock）：
```ts
describe('平账 B 批 ②：退汇认领', () => {
  const line = { externalLineId: 'line-2', caseNo: 'REC2', businessDate: '2026-09-01', dispositionNo: 'RCD2', walletId: 'w1', ownerId: 'cust-1', ownerNo: 'CUS1',
    assetId: 'a1', currency: 'AED', assetType: 'FIAT', decimals: 2, direction: 'OUT', amountMinor: '120000', amountMajor: '1200.00', externalRef: 'RET-1' };
  const deposit = { id: 'd1', depositNo: 'DEP1', status: 'SUCCESS', toWalletId: 'w1', ownerId: 'cust-1', amount: '1200', asset: { currency: 'AED', decimals: 2, tbLedgerId: 2 }, traceId: 't1', customer: { customerNo: 'CUS1' } };
  const actor = { actorType: 'ADMIN', userId: 'u1', userNo: 'ADM1', role: 'OPS_OFFICER', roleCodes: ['OPS_OFFICER'] } as any;

  it('发起：原单不是 SUCCESS / 钱包不符 / 金额不符 → 400', async () => {
    supplementEvidence.assertClaimable.mockResolvedValue(line);
    depositService.findOneByNo.mockResolvedValue({ ...deposit, status: 'COMPLIANCE_PENDING' });
    await expect(service.initiateClawback('DEP1', { externalLineId: 'line-2', caseNo: 'REC2', dispositionNo: 'RCD2', reason: 'x' }, actor)).rejects.toThrow(/SUCCESS/);
    depositService.findOneByNo.mockResolvedValue({ ...deposit, amount: '999' });
    await expect(service.initiateClawback('DEP1', { externalLineId: 'line-2', caseNo: 'REC2', dispositionNo: 'RCD2', reason: 'x' }, actor)).rejects.toThrow(/金额/);
  });
  it('发起：可用余额不足 → 400，文案带可用与需要', async () => {
    supplementEvidence.assertClaimable.mockResolvedValue(line);
    depositService.findOneByNo.mockResolvedValue(deposit);
    accountingService.getCustomerAvailableBalance.mockResolvedValue({ available: 50000n });
    await expect(service.initiateClawback('DEP1', { externalLineId: 'line-2', caseNo: 'REC2', dispositionNo: 'RCD2', reason: 'x' }, actor)).rejects.toThrow(/可用 500\.00，需要 1200\.00/);
  });
  it('发起：余额够 → 审批单 + 三列标记 + 回挂 + 审计 REQUESTED', async () => {
    supplementEvidence.assertClaimable.mockResolvedValue(line);
    depositService.findOneByNo.mockResolvedValue(deposit);
    accountingService.getCustomerAvailableBalance.mockResolvedValue({ available: 500000n });
    approvalsService.list.mockResolvedValue({ total: 0, items: [] });
    approvalsService.createAndSubmit.mockResolvedValue({ approvalNo: 'APR2' });
    const r = await service.initiateClawback('DEP1', { externalLineId: 'line-2', caseNo: 'REC2', dispositionNo: 'RCD2', reason: '银行撤回' }, actor);
    expect(depositService.markClawbackRequested).toHaveBeenCalledWith('d1', { externalLineId: 'line-2', caseNo: 'REC2', dispositionNo: 'RCD2' });
    expect(reconDisposition.linkSupplement).toHaveBeenCalledWith('RCD2', 'DEP1', 'SUPPLEMENT_BOUNCE');
    expect(r).toEqual({ depositNo: 'DEP1', approvalNo: 'APR2', status: 'PENDING_APPROVAL' });
  });
  it('批准：再查余额 → 分录借应付贷资产（码 21，externalRef 行参考号，effectiveDate 业务日）→ 状态 CLAWED_BACK → 审计', async () => {
    depositService.findOneByNo.mockResolvedValue({ ...deposit, clawbackExternalLineId: 'line-2', clawbackReconCaseNo: 'REC2', clawbackDispositionNo: 'RCD2' });
    supplementEvidence.describeLine.mockResolvedValue({ externalLineId: 'line-2', externalRef: 'RET-1', businessDate: '2026-09-01', amountMinor: '120000', direction: 'OUT', caseNo: 'REC2' });
    accountingService.getCustomerAvailableBalance.mockResolvedValue({ available: 500000n });
    accountingService.resolveTbAccountId.mockResolvedValueOnce(100n).mockResolvedValueOnce(1n);
    depositService.updateStatus.mockResolvedValue({ ...deposit, status: 'CLAWED_BACK' });
    await service.onClawbackDecided({ decision: 'APPROVED', entityRef: 'DEP1', approvalId: 'ap2', approvalNo: 'APR2' } as any);
    const call = accountingService.executeTransfer.mock.calls[0][0];
    expect(call.code).toBe(TB_TRANSFER_CODES.DEPOSIT_CLAWBACK);
    expect(call.amount).toBe(120000n);
    expect(call.evidence).toMatchObject({ eventCode: 'DEPOSIT_CLAWBACK', externalRef: 'RET-1', effectiveDate: '2026-09-01', isExternalCrossing: true, debitWalletRef: 'w1', creditWalletRef: 'w1' });
    expect(depositService.updateStatus).toHaveBeenCalledWith('d1', expect.objectContaining({ action: DepositTransactionAction.CLAWBACK }));
    const actions = auditLogsService.recordSystem.mock.calls.map((c: any[]) => c[0].action);
    expect(actions).toEqual(expect.arrayContaining(['DEPOSIT_CLAWBACK_STARTED', 'DEPOSIT_CLAWED_BACK']));
  });
  it('拒绝：状态不动、清三列、解挂', async () => {
    depositService.findOneByNo.mockResolvedValue({ ...deposit, clawbackExternalLineId: 'line-2', clawbackDispositionNo: 'RCD2' });
    await service.onClawbackDecided({ decision: 'DECLINED', entityRef: 'DEP1', approvalId: 'ap2', approvalNo: 'APR2' } as any);
    expect(accountingService.executeTransfer).not.toHaveBeenCalled();
    expect(depositService.clearClawbackRequest).toHaveBeenCalledWith('d1');
    expect(reconDisposition.unlinkSupplement).toHaveBeenCalledWith('RCD2', 'DEP1');
  });
});
```
Run: `source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test -- src/modules/trading/deposit-transactions`
Expected: FAIL

- [ ] **Step 2: 充值单服务**

迁移表在 `[DepositTransactionStatus.RETURNING]` 块之前加：
```ts
      [DepositTransactionStatus.SUCCESS]: {
        // 平账 B 批②（spec §4）：入账后被银行/托管方退汇——唯一出边，反向分录先落再翻。
        [DepositTransactionAction.CLAWBACK]: DepositTransactionStatus.CLAWED_BACK,
      },
```
`RETURNED_BUCKET_WHERE` 改为 `{ status: { in: ['RETURNED', 'CLAWED_BACK'] } }`（桶名文案「Returned」保留，列表筛选说明加「/ clawed back」）。`CUSTOMER_STATUS_PASSTHROUGH` 加 `'CLAWED_BACK'`（注释：银行事实，非合规动作，不涉 tipping-off）；`completedAt` 白名单同加。文件末尾加：
```ts
  /** 平账 B 批②：退汇认领申请的三列标记（域服务写自己的表；workflow 不直写）。 */
  async markClawbackRequested(id: string, m: { externalLineId: string; caseNo: string; dispositionNo: string }) {
    return (this.prisma as any).depositTransaction.update({
      where: { id }, data: { clawbackExternalLineId: m.externalLineId, clawbackReconCaseNo: m.caseNo, clawbackDispositionNo: m.dispositionNo },
    });
  }
  async clearClawbackRequest(id: string) {
    return (this.prisma as any).depositTransaction.update({
      where: { id }, data: { clawbackExternalLineId: null, clawbackReconCaseNo: null, clawbackDispositionNo: null },
    });
  }
```

- [ ] **Step 3: workflow**

构造函数加 `private readonly supplementEvidence: SupplementEvidenceService,` 与 `private readonly reconDisposition: ReconDispositionService,`（别名引入，同 Task 5）。在 `initiateReturn` 之后加：
```ts
  // ═══ 平账 B 批②：入金退汇认领（spec §4）═══════════════════════════════════
  private async assertClawbackBalance(deposit: any, amountMinor: bigint, decimals: number) {
    const bal = await this.accountingService.getCustomerAvailableBalance(deposit.ownerId, deposit.asset.currency);
    if (bal.available < amountMinor) {
      const fmt = (v: bigint) => minorToMajor(v.toString(), decimals);
      throw new BadRequestException(`客户可用余额不足以退汇（可用 ${fmt(bal.available)}，需要 ${fmt(amountMinor)} ${deposit.asset.currency}），待二期公司垫款与三期追索`);
    }
  }

  async initiateClawback(depositNo: string, dto: { externalLineId: string; caseNo: string; dispositionNo: string; reason: string }, actor: ApprovalActorContext) {
    const line = await this.supplementEvidence.assertClaimable({ caseNo: dto.caseNo, externalLineId: dto.externalLineId, dispositionNo: dto.dispositionNo, kind: 'SUPPLEMENT_BOUNCE' });
    const deposit = await this.depositService.findOneByNo(depositNo);
    if (deposit.status !== DepositTransactionStatus.SUCCESS) throw new BadRequestException(`充值单 ${depositNo} 不是 SUCCESS，不能退汇`);
    if (deposit.toWalletId !== line.walletId) throw new BadRequestException(`充值单 ${depositNo} 不在该案子的钱包上`);
    const amountMinor = BigInt(line.amountMinor);
    if (this.decimalToBigint(deposit.amount, line.decimals) !== amountMinor) throw new BadRequestException(`充值单 ${depositNo} 金额与账单行金额不符`);
    if (deposit.clawbackExternalLineId) throw new BadRequestException(`充值单 ${depositNo} 已在退汇认领中`);
    await this.assertClawbackBalance(deposit, amountMinor, line.decimals);
    const open = await this.approvalsService.list({ actionType: ApprovalActionTypes.DEPOSIT_CLAWBACK, entityRef: deposit.depositNo, status: ApprovalStatuses.PENDING, take: 1 });
    if (open.total > 0) throw new ConflictException(`充值单 ${depositNo} 已有待批的退汇认领`);
    const traceId = deposit.traceId || randomUUID();
    const impact = `${line.ownerNo ?? deposit.ownerId} 的 ${line.amountMajor} ${line.currency} 充值将被退汇，余额相应减少（对账案 ${line.caseNo}，账单行 ${line.externalRef}）`;
    const approvalCase = await this.approvalsService.createAndSubmit(
      { actionType: ApprovalActionTypes.DEPOSIT_CLAWBACK, entityRef: deposit.depositNo, traceId,
        objectSnapshot: { depositNo: deposit.depositNo, caseNo: line.caseNo, dispositionNo: line.dispositionNo, externalLineId: line.externalLineId, externalRef: line.externalRef, customerNo: line.ownerNo, amount: line.amountMajor, currency: line.currency, impact } },
      { reason: dto.reason, traceId }, actor,
    );
    await this.depositService.markClawbackRequested(deposit.id, { externalLineId: line.externalLineId, caseNo: line.caseNo, dispositionNo: line.dispositionNo! });
    await this.reconDisposition.linkSupplement(line.dispositionNo!, deposit.depositNo, 'SUPPLEMENT_BOUNCE');
    await this.depositAudit(deposit, { action: 'DEPOSIT_CLAWBACK_REQUESTED', reason: dto.reason, approvalNo: approvalCase.approvalNo,
      metadata: { caseNo: line.caseNo, dispositionNo: line.dispositionNo, externalLineId: line.externalLineId, externalRef: line.externalRef, amount: line.amountMajor },
      actor: this.toAuditActor(actor), sourcePlatform: 'ADMIN_API' });
    return { depositNo: deposit.depositNo, approvalNo: approvalCase.approvalNo, status: 'PENDING_APPROVAL' as const };
  }

  @OnEvent('workflow.deposit-clawback.decided', { async: true })
  async onClawbackDecided(event: ApprovalDecidedEvent) {
    let deposit: any;
    try { deposit = await this.depositService.findOneByNo(event.entityRef); } catch (err) { if (err instanceof NotFoundException) return; throw err; }
    if (event.decision !== 'APPROVED') {
      const dispositionNo = deposit.clawbackDispositionNo;
      await this.depositService.clearClawbackRequest(deposit.id);
      if (dispositionNo) await this.reconDisposition.unlinkSupplement(dispositionNo, deposit.depositNo);
      this.logger.log(`Deposit ${deposit.depositNo} clawback ${event.decision} (case ${event.approvalNo}) — SUCCESS intact, request cleared.`);
      return;
    }
    await this.executeClawback(deposit, event);
  }

  /** 先账后状态：反向分录落了再翻 CLAWED_BACK；余额在批准时点再查一次（提交后客户可能又花了钱）。 */
  private async executeClawback(deposit: any, event: ApprovalDecidedEvent) {
    if (deposit.status !== DepositTransactionStatus.SUCCESS || !deposit.clawbackExternalLineId) {
      this.logger.warn(`Deposit ${deposit.depositNo} clawback approved but status ${deposit.status} / no line — no-op`);
      return;
    }
    const asset = deposit.asset; const decimals: number = asset.decimals;
    const line = await this.supplementEvidence.describeLine(deposit.clawbackExternalLineId);
    const amountMinor = BigInt(line.amountMinor);
    try {
      await this.assertClawbackBalance(deposit, amountMinor, decimals);
    } catch (err) {
      await this.depositAudit(deposit, { action: 'DEPOSIT_CLAWBACK_STARTED', outcome: AuditOutcome.FAILED, reasonCode: 'INSUFFICIENT_BALANCE', reason: (err as Error).message, approvalNo: event.approvalNo, causationId: event.approvalId });
      const dispositionNo = deposit.clawbackDispositionNo;
      await this.depositService.clearClawbackRequest(deposit.id);
      if (dispositionNo) await this.reconDisposition.unlinkSupplement(dispositionNo, deposit.depositNo);
      return;
    }
    await this.depositAudit(deposit, { action: 'DEPOSIT_CLAWBACK_STARTED', reason: 'CFO 批准退汇认领，落反向分录', approvalNo: event.approvalNo, causationId: event.approvalId, metadata: { externalLineId: line.externalLineId, externalRef: line.externalRef, effectiveDate: line.businessDate } });
    const ledger = asset.tbLedgerId;
    const debitAccountId = await this.accountingService.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger, ownerType: 'CUSTOMER', ownerUuid: deposit.ownerId });
    const creditAccountId = await this.accountingService.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_ASSET, ledger, ownerType: 'SYSTEM' });
    await this.accountingService.executeTransfer({
      debitAccountId, creditAccountId, amount: amountMinor, ledger, code: TB_TRANSFER_CODES.DEPOSIT_CLAWBACK,
      evidence: {
        sourceType: 'DEPOSIT', sourceNo: deposit.depositNo, eventCode: 'DEPOSIT_CLAWBACK',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
        assetCurrency: asset.currency, traceId: deposit.traceId || deposit.id, actorType: 'SYSTEM', actorId: 'SYSTEM',
        memo: `Deposit clawed back by bank/custodian — statement line ${line.externalRef ?? line.externalLineId} (recon case ${line.caseNo ?? '-'})`,
        debitWalletRef: deposit.toWalletId, creditWalletRef: deposit.toWalletId,
        externalRef: line.externalRef, isExternalCrossing: true, effectiveDate: line.businessDate,
      },
    });
    const row = await this.depositService.updateStatus(deposit.id, { action: DepositTransactionAction.CLAWBACK, reason: `Clawed back per approval ${event.approvalNo}` } as any);
    await this.depositAudit(deposit, { action: 'DEPOSIT_CLAWED_BACK', reason: '入账后被银行/托管方退汇，客户余额已相应减少', fromStatus: DepositTransactionStatus.SUCCESS, toStatus: row.status, approvalNo: event.approvalNo,
      metadata: { externalLineId: line.externalLineId, externalRef: line.externalRef, amount: String(deposit.amount), effectiveDate: line.businessDate, caseNo: line.caseNo } });
  }
```
（`minorToMajor` 从 `supplement-evidence.service` 引入；`updateStatus` 的 dto 形状照 `initiateReturn` 现用的写法。）

- [ ] **Step 4: 处理器 + 端点 + DTO + 模块**

`deposit-clawback-approval.service.ts`：复制 Task 5 的处理器，`actionType = ApprovalActionTypes.DEPOSIT_CLAWBACK`、`workflowType = AuditBusinessWorkflowTypes.DEPOSIT_CLAWBACK`，类名 `DepositClawbackApprovalService`。
DTO：
```ts
export class InitiateDepositClawbackDto {
  @IsString() externalLineId!: string;
  @IsString() caseNo!: string;
  @IsString() dispositionNo!: string;
  @IsString() reason!: string;
}
```
控制器在 `:id/return` 之后加：
```ts
  @Post(':depositNo/clawback')
  @ApiOperation({ summary: '平账 B 批 ②：认领入金被银行退汇（CFO maker-checker）' })
  @RequirePermissions(buildPermissionCode('POST', '/deposit-transactions/:depositNo/clawback'))
  initiateClawback(@Param('depositNo') depositNo: string, @Body() dto: InitiateDepositClawbackDto, @Req() req: any) {
    this.assertAdmin(req);
    const actor: ApprovalActorContext = { actorType: 'ADMIN', userId: req.user?.userId, userNo: req.user?.userNo, role: req.user?.role, roleCodes: req.user?.roleCodes || (req.user?.role ? [req.user.role] : []) };
    return this.workflow.initiateClawback(depositNo, dto, actor);
  }
```
模块 providers 加 `DepositClawbackApprovalService`。

- [ ] **Step 5: 闸门 + 提交**

```bash
source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test -- src/modules/trading/deposit-transactions
npx tsc --noEmit -p tsconfig.json
bash scripts/on-stack.sh self db:base:sync
bash scripts/stack.sh up
git add src/modules/trading/deposit-transactions
git commit -m "feat(deposit): 入金退汇认领——SUCCESS 充值单加一条边到 CLAWED_BACK，CFO 批准后落反向分录，余额不够即拒"
```

---

### Task 7: ③ 出金退回认领——提现单 SUCCESS → RETURNED 一条新边，复用退汇重记分录

**本任务做：** 提现迁移表 `[SUCCESS]` 从 `{}` 改为 `{ RETURN: RETURNED }`；`WithdrawWorkflowService.initiateReturnClaim / onReturnClaimDecided / onReturnAfterSuccess`（重记分录借 `CLIENT_ASSET` / 贷 `CLIENT_PAYABLE`，码 `WITHDRAW_BOUNCE_REENTRY`，金额 = 净额，`externalRef` = 行参考号，`effectiveDate` = 案子业务日；**跳过** `onBounce` 的费腿分支，手续费不退）；`WithdrawReturnClaimApprovalService`；`POST /withdraw-transactions/:withdrawNo/return-claim`。
**本任务不做：** 不动 `onBounce`（出款中退回的既有路径）；不建资金单；不退手续费；不改引擎。

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts:143`（`[WithdrawTransactionStatus.SUCCESS]: {}`）+ 末尾加两个标记方法
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`（构造函数加两依赖；`initiateUnfreeze` 附近加三个方法 + `@OnEvent`）
- Create: `src/modules/trading/withdraw-transactions/withdraw-return-claim-approval.service.ts`
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.controller.ts`（`:id/refund` 之后加 `@Post(':withdrawNo/return-claim')`）
- Modify: `src/modules/trading/withdraw-transactions/dto/withdraw-transaction.dto.ts`（`InitiateWithdrawReturnClaimDto`）
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts:24-52`（imports 加 `ReconciliationModule`；providers 加处理器）
- Test: `withdraw-transactions.service.spec.ts`、`withdraw-workflow.service.spec.ts`

**Interfaces（Produces）:**
- `WithdrawTransactionsService.markReturnClaimRequested(id, { externalLineId, caseNo, dispositionNo })` / `clearReturnClaimRequest(id)`
- `WithdrawWorkflowService.initiateReturnClaim(withdrawNo, dto: { externalLineId; caseNo; dispositionNo; reason }, actor): Promise<{ withdrawNo; approvalNo; status: 'PENDING_APPROVAL' }>`
- 事件 `workflow.withdraw-return-claim.decided` → `onReturnClaimDecided(event)`
- 分录：`DR CLIENT_ASSET(SYSTEM) / CR CLIENT_PAYABLE(客户)`，evidence `{ sourceType: 'WITHDRAWAL', sourceNo: withdrawNo, eventCode: 'WITHDRAW_BOUNCE_REENTRY', debitWalletRef = creditWalletRef = fromWalletId, externalRef, isExternalCrossing: true, effectiveDate }`

- [ ] **Step 1: 单测先红**

`withdraw-transactions.service.spec.ts` 加：
```ts
describe('平账 B 批 ③：SUCCESS 之后的退回', () => {
  it('SUCCESS —return→ RETURNED；SUCCESS 其余动作仍非法', () => {
    expect(WithdrawTransactionsService.TRANSITIONS[WithdrawTransactionStatus.SUCCESS]).toEqual({ [WithdrawTransactionAction.RETURN]: WithdrawTransactionStatus.RETURNED });
  });
});
```
（迁移表常量名以文件实际为准，静态可访问就直接断言，否则经 `resolveNextStatus` 私有方法断言，照该文件既有写法。）

`withdraw-workflow.service.spec.ts` 加（照 `initiateUnfreeze` / `onUnfreezeDecided` / `onBounce` 既有用例的 mock 搭法）：
```ts
describe('平账 B 批 ③：退回认领', () => {
  const line = { externalLineId: 'line-3', caseNo: 'REC3', businessDate: '2026-09-01', dispositionNo: 'RCD3', walletId: 'w9', ownerId: 'cust-2', ownerNo: 'CUS2',
    assetId: 'a1', currency: 'AED', assetType: 'FIAT', decimals: 2, direction: 'IN', amountMinor: '90000', amountMajor: '900.00', externalRef: 'PAYRET-1' };
  const w = { id: 'wd1', withdrawNo: 'WDR1', status: 'SUCCESS', fromWalletId: 'w9', ownerId: 'cust-2', netAmount: '900', feeAmount: '10', asset: { currency: 'AED', decimals: 2 }, traceId: 't9', tbPendingFeeId: null };
  const actor = { actorType: 'ADMIN', userId: 'u1', userNo: 'ADM1', role: 'OPS_OFFICER', roleCodes: ['OPS_OFFICER'] } as any;

  it('发起：非 SUCCESS / 钱包不符 / 净额不符 → 400', async () => {
    supplementEvidence.assertClaimable.mockResolvedValue(line);
    withdrawService.findByNo.mockResolvedValue({ ...w, status: 'PAYOUT_PENDING' });
    await expect(service.initiateReturnClaim('WDR1', { externalLineId: 'line-3', caseNo: 'REC3', dispositionNo: 'RCD3', reason: 'x' }, actor)).rejects.toThrow(/SUCCESS/);
    withdrawService.findByNo.mockResolvedValue({ ...w, netAmount: '850' });
    await expect(service.initiateReturnClaim('WDR1', { externalLineId: 'line-3', caseNo: 'REC3', dispositionNo: 'RCD3', reason: 'x' }, actor)).rejects.toThrow(/净额/);
  });
  it('发起：审批单 + 三列 + 回挂 + 审计', async () => {
    supplementEvidence.assertClaimable.mockResolvedValue(line);
    withdrawService.findByNo.mockResolvedValue(w);
    approvalsService.list.mockResolvedValue({ total: 0, items: [] });
    approvalsService.createAndSubmit.mockResolvedValue({ approvalNo: 'APR3' });
    const r = await service.initiateReturnClaim('WDR1', { externalLineId: 'line-3', caseNo: 'REC3', dispositionNo: 'RCD3', reason: 'IBAN 错退回' }, actor);
    expect(withdrawService.markReturnClaimRequested).toHaveBeenCalledWith('wd1', { externalLineId: 'line-3', caseNo: 'REC3', dispositionNo: 'RCD3' });
    expect(reconDisposition.linkSupplement).toHaveBeenCalledWith('RCD3', 'WDR1', 'SUPPLEMENT_PAYOUT_RETURN');
    expect(r).toEqual({ withdrawNo: 'WDR1', approvalNo: 'APR3', status: 'PENDING_APPROVAL' });
  });
  it('批准：净额腿已 POST 才重记；分录借资产贷应付（码 17，externalRef 行参考号，effectiveDate 业务日）；不碰费腿；状态 RETURNED', async () => {
    withdrawService.findByNo.mockResolvedValue({ ...w, returnExternalLineId: 'line-3', returnReconCaseNo: 'REC3', returnDispositionNo: 'RCD3' });
    withdrawService.findOneInternal.mockResolvedValue({ ...w, returnExternalLineId: 'line-3' });
    supplementEvidence.describeLine.mockResolvedValue({ externalLineId: 'line-3', externalRef: 'PAYRET-1', businessDate: '2026-09-01', amountMinor: '90000', direction: 'IN', caseNo: 'REC3' });
    prisma.tbTransferEvidence.findMany.mockResolvedValue([{ eventCode: 'WITHDRAW_NET_POST' }]);
    accountingService.resolveTbAccountId.mockResolvedValueOnce(1n).mockResolvedValueOnce(100n);
    withdrawService.updateStatus.mockResolvedValue({ ...w, status: 'RETURNED' });
    await service.onReturnClaimDecided({ decision: 'APPROVED', entityRef: 'WDR1', approvalId: 'ap3', approvalNo: 'APR3' } as any);
    const call = accountingService.executeTransfer.mock.calls[0][0];
    expect(call.code).toBe(TB_TRANSFER_CODES.WITHDRAW_BOUNCE_REENTRY);
    expect(call.amount).toBe(90000n);
    expect(call.evidence).toMatchObject({ externalRef: 'PAYRET-1', effectiveDate: '2026-09-01', isExternalCrossing: true });
    expect(accountingService.voidPendingTransferBestEffort).not.toHaveBeenCalled();
    expect(withdrawService.updateStatus).toHaveBeenCalledWith('wd1', expect.objectContaining({ action: WithdrawTransactionAction.RETURN }), expect.anything());
  });
  it('拒绝：状态不动、清三列、解挂', async () => {
    withdrawService.findByNo.mockResolvedValue({ ...w, returnExternalLineId: 'line-3', returnDispositionNo: 'RCD3' });
    await service.onReturnClaimDecided({ decision: 'EXPIRED', entityRef: 'WDR1', approvalId: 'ap3', approvalNo: 'APR3' } as any);
    expect(accountingService.executeTransfer).not.toHaveBeenCalled();
    expect(withdrawService.clearReturnClaimRequest).toHaveBeenCalledWith('wd1');
    expect(reconDisposition.unlinkSupplement).toHaveBeenCalledWith('RCD3', 'WDR1');
  });
});
```
Run: `source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test -- src/modules/trading/withdraw-transactions`
Expected: FAIL

- [ ] **Step 2: 提现单服务**

第 143 行改为：
```ts
    [WithdrawTransactionStatus.SUCCESS]: {
      // 平账 B 批③（spec §5）：出款成功后被银行退回——唯一出边；反向分录先落再翻（与 PAYOUT_PENDING 的退汇同终态）。
      [WithdrawTransactionAction.RETURN]: WithdrawTransactionStatus.RETURNED,
    },
```
文件头「终态集合 TERMINAL = SUCCESS/…」那段注释改口：SUCCESS 不再是零出边，只剩 REJECTED / FAILED / RETURNED 三个零出边终态；若有「零出边终态」的常量或单测列表，把 SUCCESS 移出。末尾加：
```ts
  async markReturnClaimRequested(id: string, m: { externalLineId: string; caseNo: string; dispositionNo: string }) {
    return (this.prisma as any).withdrawTransaction.update({ where: { id }, data: { returnExternalLineId: m.externalLineId, returnReconCaseNo: m.caseNo, returnDispositionNo: m.dispositionNo } });
  }
  async clearReturnClaimRequest(id: string) {
    return (this.prisma as any).withdrawTransaction.update({ where: { id }, data: { returnExternalLineId: null, returnReconCaseNo: null, returnDispositionNo: null } });
  }
```

- [ ] **Step 3: workflow**

构造函数加 `supplementEvidence: SupplementEvidenceService` 与 `reconDisposition: ReconDispositionService`（别名引入）。`initiateUnfreeze` 附近加：
```ts
  // ═══ 平账 B 批③：出款成功后被银行退回的认领（spec §5）═══════════════════════
  async initiateReturnClaim(withdrawNo: string, dto: { externalLineId: string; caseNo: string; dispositionNo: string; reason: string }, actor: ApprovalActorContext) {
    const line = await this.supplementEvidence.assertClaimable({ caseNo: dto.caseNo, externalLineId: dto.externalLineId, dispositionNo: dto.dispositionNo, kind: 'SUPPLEMENT_PAYOUT_RETURN' });
    const w = await this.withdrawService.findByNo(withdrawNo);
    if (!w) throw new NotFoundException(`提现单不存在：${withdrawNo}`);
    if (w.status !== WithdrawTransactionStatus.SUCCESS) throw new BadRequestException(`提现单 ${withdrawNo} 不是 SUCCESS，出款中的退回走既有 bounce`);
    if (w.fromWalletId !== line.walletId) throw new BadRequestException(`提现单 ${withdrawNo} 不在该案子的钱包上`);
    const netMinor = this.decimalToBigint(w.netAmount, line.decimals);
    if (netMinor !== BigInt(line.amountMinor)) throw new BadRequestException(`提现单 ${withdrawNo} 净额与账单行金额不符`);
    if (w.returnExternalLineId) throw new BadRequestException(`提现单 ${withdrawNo} 已在退回认领中`);
    const open = await this.approvalsService.list({ actionType: ApprovalActionTypes.WITHDRAW_RETURN_CLAIM, entityRef: w.withdrawNo, status: ApprovalStatuses.PENDING, take: 1 });
    if (open.total > 0) throw new ConflictException(`提现单 ${withdrawNo} 已有待批的退回认领`);
    const traceId = w.traceId || randomUUID();
    const impact = `${line.ownerNo ?? w.ownerId} 的 ${line.amountMajor} ${line.currency} 提现被银行退回，本金将重新记入余额，手续费不退（对账案 ${line.caseNo}，账单行 ${line.externalRef}）`;
    const approvalCase = await this.approvalsService.createAndSubmit(
      { actionType: ApprovalActionTypes.WITHDRAW_RETURN_CLAIM, entityRef: w.withdrawNo, traceId,
        objectSnapshot: { withdrawNo: w.withdrawNo, caseNo: line.caseNo, dispositionNo: line.dispositionNo, externalLineId: line.externalLineId, externalRef: line.externalRef, customerNo: line.ownerNo, netAmount: line.amountMajor, currency: line.currency, impact } },
      { reason: dto.reason, traceId }, actor,
    );
    await this.withdrawService.markReturnClaimRequested(w.id, { externalLineId: line.externalLineId, caseNo: line.caseNo, dispositionNo: line.dispositionNo! });
    await this.reconDisposition.linkSupplement(line.dispositionNo!, w.withdrawNo, 'SUPPLEMENT_PAYOUT_RETURN');
    await this.withdrawAudit(w, { action: 'WITHDRAW_RETURN_CLAIM_REQUESTED', reason: dto.reason, approvalNo: approvalCase.approvalNo,
      metadata: { caseNo: line.caseNo, dispositionNo: line.dispositionNo, externalLineId: line.externalLineId, externalRef: line.externalRef, netAmount: line.amountMajor },
      actor: this.toAuditActor(actor), sourcePlatform: 'ADMIN_API' });
    return { withdrawNo: w.withdrawNo, approvalNo: approvalCase.approvalNo, status: 'PENDING_APPROVAL' as const };
  }

  @OnEvent('workflow.withdraw-return-claim.decided', { async: true })
  async onReturnClaimDecided(event: ApprovalDecidedEvent) {
    const w = await this.withdrawService.findByNo(event.entityRef);
    if (!w) return;
    if (event.decision !== 'APPROVED') {
      const dispositionNo = w.returnDispositionNo;
      await this.withdrawService.clearReturnClaimRequest(w.id);
      if (dispositionNo) await this.reconDisposition.unlinkSupplement(dispositionNo, w.withdrawNo);
      this.logger.log(`Withdrawal ${w.withdrawNo} return-claim ${event.decision} (case ${event.approvalNo}) — SUCCESS intact, request cleared.`);
      return;
    }
    await this.onReturnAfterSuccess(w.id, event);
  }

  /**
   * SUCCESS 之后的退回：与 onBounce 同一笔重记分录（DR CLIENT_ASSET / CR CLIENT_PAYABLE，净额），
   * 但 ① 不碰费腿——SUCCESS 时费腿早已结清，手续费不退；② externalRef / effectiveDate 用账单行的，
   * 让重跑案子那天的对账按参考号把这条流水认回去。先账后状态。
   */
  private async onReturnAfterSuccess(withdrawId: string, event: ApprovalDecidedEvent) {
    const w = await this.withdrawService.findOneInternal(withdrawId);
    if (w.status !== WithdrawTransactionStatus.SUCCESS || !w.returnExternalLineId) {
      this.logger.warn(`Withdrawal ${w.withdrawNo} return-claim approved but status ${w.status} / no line — no-op`);
      return;
    }
    const posted = await (this.prisma as any).tbTransferEvidence.findMany({ where: { sourceType: 'WITHDRAWAL', sourceNo: w.withdrawNo, eventCode: 'WITHDRAW_NET_POST' } });
    if (posted.length === 0) throw new BadRequestException(`提现单 ${w.withdrawNo} 净额腿未 POST，没有可退回的钱`);
    const line = await this.supplementEvidence.describeLine(w.returnExternalLineId);
    await this.withdrawAudit(w, { action: 'WITHDRAW_RETURN_CLAIM_STARTED', reason: 'CFO 批准退回认领，落重记分录', approvalNo: event.approvalNo, causationId: event.approvalId,
      metadata: { externalLineId: line.externalLineId, externalRef: line.externalRef, effectiveDate: line.businessDate } });
    const decimals = w.asset?.decimals ?? 8;
    const netBigint = this.decimalToBigint(w.netAmount, decimals);
    const ledger = TB_LEDGERS[w.asset.currency as keyof typeof TB_LEDGERS];
    const clientAssetId = await this.accountingService.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_ASSET, ledger, ownerType: 'SYSTEM' });
    const clientPayableId = await this.accountingService.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger, ownerType: 'CUSTOMER', ownerUuid: w.ownerId });
    await this.accountingService.executeTransfer({
      debitAccountId: clientAssetId, creditAccountId: clientPayableId, amount: netBigint, ledger, code: TB_TRANSFER_CODES.WITHDRAW_BOUNCE_REENTRY,
      evidence: {
        sourceType: 'WITHDRAWAL', sourceNo: w.withdrawNo, eventCode: 'WITHDRAW_BOUNCE_REENTRY',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE],
        assetCurrency: w.asset?.currency || '', traceId: w.traceId || w.id, actorType: 'SYSTEM', actorId: 'SYSTEM',
        memo: `Payout returned by bank after SUCCESS — statement line ${line.externalRef ?? line.externalLineId} (recon case ${line.caseNo ?? '-'}); fee retained`,
        debitWalletRef: w.fromWalletId ?? null, creditWalletRef: w.fromWalletId ?? null,
        externalRef: line.externalRef, isExternalCrossing: true, effectiveDate: line.businessDate,
      },
    });
    const returnedRow = await this.withdrawService.updateStatus(w.id, { action: WithdrawTransactionAction.RETURN, reason: `Returned by bank per approval ${event.approvalNo}` }, this.systemCtx);
    await this.withdrawAudit(w, { action: 'WITHDRAW_RETURNED_AFTER_SUCCESS', reason: '出款成功后被银行退回，本金已重新记入余额，手续费不退', fromStatus: WithdrawTransactionStatus.SUCCESS, toStatus: returnedRow.status, approvalNo: event.approvalNo,
      metadata: { reversedNet: String(w.netAmount), externalLineId: line.externalLineId, externalRef: line.externalRef, effectiveDate: line.businessDate, caseNo: line.caseNo, feeDisposition: 'fee retained (collected)' } });
  }
```
（`findByNo` 若不带 `asset` 关系，在 `onReturnAfterSuccess` 里用 `findOneInternal`——上面已经这么写；`decimalToBigint` / `TB_LEDGERS` / `systemCtx` 都是本文件现成的。）

- [ ] **Step 4: 处理器 + 端点 + DTO + 模块**

`withdraw-return-claim-approval.service.ts`：同 Task 5 处理器形状，`actionType = ApprovalActionTypes.WITHDRAW_RETURN_CLAIM`、`workflowType = AuditBusinessWorkflowTypes.WITHDRAW_RETURN_CLAIM`。
DTO `InitiateWithdrawReturnClaimDto { externalLineId; caseNo; dispositionNo; reason }`（四个 `@IsString()`）。
控制器 `:id/refund` 之后加：
```ts
  @Post(':withdrawNo/return-claim')
  @ApiOperation({ summary: '平账 B 批 ③：认领出款成功后被银行退回（CFO maker-checker）' })
  @RequirePermissions(buildPermissionCode('POST', '/withdraw-transactions/:withdrawNo/return-claim'))
  initiateReturnClaim(@Param('withdrawNo') withdrawNo: string, @Body() dto: InitiateWithdrawReturnClaimDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.workflowService.initiateReturnClaim(withdrawNo, dto, this.toApprovalActor(req));
  }
```
（该控制器若尚未引入 `RequirePermissions` / `buildPermissionCode`，照充值控制器的 import 补上。）模块 imports 加 `ReconciliationModule`，providers 加 `WithdrawReturnClaimApprovalService`。

- [ ] **Step 5: 闸门 + 提交**

```bash
source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test -- src/modules/trading/withdraw-transactions
npx tsc --noEmit -p tsconfig.json
bash scripts/on-stack.sh self db:base:sync
bash scripts/stack.sh up
git add src/modules/trading/withdraw-transactions
git commit -m "feat(withdraw): 出金退回认领——SUCCESS 提现单加一条边到 RETURNED，CFO 批准后复用退汇重记分录，手续费不退"
```

---

### Task 8: e2e · 三条补单路全链 + 拒绝路径 + 审计（真 AppModule 零 mock）

**本任务做：** `test/recon-supplement.e2e-spec.ts`：①a 链上补录、①b 法币补录、② 退汇、③ 退回 四条主链 + 拒绝路径 + 审计断言（spec §9）。
**本任务不做：** 不改任何 src；不 mock。

**Files:**
- Create: `test/recon-supplement.e2e-spec.ts`
- 参照: `test/recon-aging-write-off.e2e-spec.ts`（夹具函数 `makeActor / waitUntil / createCustomerWallet / fundCustomerWallet / createExternalLine / upsertExternalBalance / openCaseFor / latestApprovalCase` **原样复制**到新文件，`dedupKey` 前缀改 `E2E-SUPP-`）

**Interfaces（Consumes）:** Task 2 `DispositionService.record`、Task 5 `InboundTransferSignalsService.initiateSupplement`、Task 6 `DepositWorkflowService.initiateClawback`、Task 7 `WithdrawWorkflowService.initiateReturnClaim`、`ApprovalsService.approve / reject`、`WalletReconRunService.run`、`DepositWorkflowService.applyKytVerdict`（花名册 ⚡① 同一条通道，见 `scripts/demo-lib.ts` `driveVerdict`）。

- [ ] **Step 1: 文件骨架 + 夹具**

```ts
// test/recon-supplement.e2e-spec.ts —— 头部 polyfill / dotenv / imports 与 recon-aging-write-off.e2e-spec.ts 完全一致，再加：
import { InboundTransferSignalsService } from '../src/modules/trading/deposit-transactions/inbound-transfer-signals.service';
import { DepositWorkflowService } from '../src/modules/trading/deposit-transactions/deposit-workflow.service';
import { DepositTransactionsService } from '../src/modules/trading/deposit-transactions/deposit-transactions.service';
import { WithdrawWorkflowService } from '../src/modules/trading/withdraw-transactions/withdraw-workflow.service';
import { WithdrawTransactionsService } from '../src/modules/trading/withdraw-transactions/withdraw-transactions.service';
import { DEPOSIT_VERDICT_BUTTONS } from '../src/modules/deposit-sumsub/fixtures/verdict-buttons';

/**
 * 平账 B 批（spec §9）e2e：补单三入口全链。案子 → 定性（SUPPLEMENT 出口）→ 案子上发起 →
 * 真审批中心（三类型，单步 CFO）→ 业务域执行（① 信号进通道 → 充值单 SUCCESS；② CLAWED_BACK；
 * ③ RETURNED）→ WalletReconRunService.run() 重跑 → 案子 AUTO_HEALED。审计断言按 recordedAt >= testStartedAt 圈定
 * （同日 reset 重跑复用案件号，见 A 批 e2e 的说明）。与另外三份 recon e2e 串行（jest-e2e.json maxWorkers: 1）。
 */
describe('Recon supplement e2e (平账 B 批, Task 8)', () => {
  jest.setTimeout(90000);
  let app: INestApplication; let prisma: PrismaService;
  let dispositions: DispositionService; let walletRecon: WalletReconRunService; let approvalsService: ApprovalsService;
  let signals: InboundTransferSignalsService; let depositWf: DepositWorkflowService; let deposits: DepositTransactionsService;
  let withdrawWf: WithdrawWorkflowService; let withdraws: WithdrawTransactionsService; let tbEvidence: TbEvidenceService; let accounting: AccountingService;
  let aedAssetId: string; let usdtAssetId: string; let carolId: string; let carolNo: string; let daveId: string;
  let CUTOFF: Date; let BUSINESS_DATE: string; let testStartedAt: Date;
  const ops = () => makeActor('E2E_OPS', 'OPS_OFFICER');
  const cfo = () => makeActor('E2E_CFO', 'CFO');

  beforeAll(async () => {
    // …与 A 批 e2e 相同的 createTestingModule / app.get；再取 signals / depositWf / deposits / withdrawWf / withdraws
    // aedAssetId / usdtAssetId 各 findFirst({ where: { currency } })；carol / dave 同 A 批
    CUTOFF = new Date(Date.now() + 3 * 24 * 3600 * 1000); BUSINESS_DATE = CUTOFF.toISOString().slice(0, 10); testStartedAt = new Date();
  });
  afterAll(async () => { await app.close(); });

  /** 造一个「外有我无」案子：新钱包 + 外部行 + 收盘 + 跑一次对账，返回案子与差异行。 */
  async function breakCase(opts: { assetId: string; currency: string; decimals: number; direction: 'IN' | 'OUT'; amountMinor: bigint; externalRef: string; ownerId: string; internalMinor?: bigint }) {
    const wallet = await createCustomerWallet({ ownerId: opts.ownerId, assetId: opts.assetId });
    if (opts.internalMinor && opts.internalMinor > 0n) await fundCustomerWallet({ walletId: wallet.id, ownerId: opts.ownerId, currency: opts.currency, amount: opts.internalMinor, externalRef: `E2E-BASE-${randomUUID()}` });
    const line = await createExternalLine({ walletId: wallet.id, currency: opts.currency, book: 'CLIENT', direction: opts.direction, amount: opts.amountMinor, externalRef: opts.externalRef });
    const closing = (opts.internalMinor ?? 0n) + (opts.direction === 'IN' ? opts.amountMinor : -opts.amountMinor);
    await upsertExternalBalance({ walletId: wallet.id, currency: opts.currency, book: 'CLIENT', closingBalance: closing });
    expect((await walletRecon.run({ cutoff: CUTOFF })).status).toBe('BREAK');
    const kase = await openCaseFor(wallet.id);
    return { wallet, line, kase };
  }
  async function auditSince(action: string, subjectNo: string) {
    return (prisma as any).auditLogEvent.findMany({ where: { action, primarySubjectNo: subjectNo, recordedAt: { gte: testStartedAt } } });
  }
```
（`fundCustomerWallet` 的铺底要同时把外部收盘算进去——A 批 e2e 里它是 `isExternalCrossing` 铺底 + 对应外部行，照抄其签名；`openCaseFor` 返回 OPEN 案子。）

- [ ] **Step 2: ①a 链上补录**

```ts
  it('①a 链上补录：案子 → 定性漏记入金 → 发起（来源地址）→ CFO 批 → 信号进通道 → 充值单 SUCCESS（STEP_1 流水 effectiveDate=业务日、externalRef=行参考号）→ 重跑愈', async () => {
    const txHash = `0xe2esupp${randomUUID().replace(/-/g, '')}`;
    const { wallet, line, kase } = await breakCase({ assetId: usdtAssetId, currency: 'USDT', decimals: 6, direction: 'IN', amountMinor: 61_000_000n, externalRef: txHash, ownerId: carolId });
    const disp = await dispositions.record(kase.caseNo, { explainedExternalLineId: line.id, matchType: 'ORPHAN_EXTERNAL', causeCode: 'MISSED_DEPOSIT', externalDirection: 'IN', findingNote: '托管账单有、我方监听漏了' } as any, ops());
    expect(disp.outlet).toBe('SUPPLEMENT'); expect(disp.deferredTarget).toBe('SUPPLEMENT_DEPOSIT');

    const req = await signals.initiateSupplement({ externalLineId: line.id, caseNo: kase.caseNo, dispositionNo: disp.dispositionNo, fromAddress: 'TE2eSupplementSender', reason: '补录漏记入金' }, ops());
    const sig = await (prisma as any).inboundTransferSignal.findUnique({ where: { signalNo: req.signalNo } });
    expect(sig.status).toBe('SUPPLEMENT_PENDING'); expect(sig.txHash).toBe(txHash); expect(String(sig.amount)).toBe('61'); expect(sig.supplementEffectiveDate).toBe(kase.businessDate);
    expect((await (prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo: disp.dispositionNo } })).supplementNo).toBe(req.signalNo);

    await approvalsService.approve(req.approvalNo, { reason: 'e2e CFO approve supplement' }, cfo());
    await waitUntil(async () => (await (prisma as any).inboundTransferSignal.findUnique({ where: { signalNo: req.signalNo } })).status === 'PAYIN_CREATED', 15000);
    const deposit = await (prisma as any).depositTransaction.findFirst({ where: { toWalletId: wallet.id }, orderBy: { createdAt: 'desc' } });
    expect(deposit.txHash).toBe(txHash); expect(deposit.effectiveDate).toBe(kase.businessDate);
    // 走完合规闸：与花名册 ⚡① 同一条通道
    await waitUntil(async () => (await deposits.findOne(deposit.id)).status === 'COMPLIANCE_PENDING', 15000);
    await depositWf.applyKytVerdict(deposit.id, verdictArgs('approved'));   // verdictArgs = scripts/demo-lib.ts verdictArgsForButton 的同款换算，复制过来
    await waitUntil(async () => (await deposits.findOne(deposit.id)).status === 'SUCCESS', 15000);
    expect((await (prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo: disp.dispositionNo } })).supplementNo).toBe(deposit.depositNo);

    const flow = await (prisma as any).accountFlow.findFirst({ where: { walletRef: wallet.id, externalRef: txHash } });
    expect(flow.effectiveDate).toBe(kase.businessDate);
    await walletRecon.run({ cutoff: CUTOFF });
    expect((await (prisma as any).reconciliationCase.findUnique({ where: { id: kase.id } })).status).toBe('RESOLVED');
    expect(await auditSince('DEPOSIT_SUPPLEMENT_REQUESTED', req.signalNo)).toHaveLength(1);
    expect(await auditSince('DEPOSIT_SUPPLEMENTED', req.signalNo)).toHaveLength(1);
  });
```
`verdictArgs('approved')`：把 `scripts/demo-lib.ts` 的 `verdictArgsForButton` + `VERDICT_BY_WEBHOOK_TYPE` 复制为测试内的私有函数（选 `DEPOSIT_VERDICT_BUTTONS` 里 webhookType 为 approved 的那个键），不改 demo-lib。`accountFlow` 模型名与 `walletRef` 列名以 schema 为准（`grep -n "^model AccountFlow" -A12 prisma/schema.prisma`）。

- [ ] **Step 3: ①b 法币补录**

同 ①a，换 `assetId: aedAssetId, currency: 'AED', decimals: 2, amountMinor: 120_000n, externalRef: 'E2E-BANK-REF-…'`，发起时传 `fromIban: 'AE070331234567890123456'`，断言 `sig.referenceNo === externalRef`、`sig.channelType === 'FIAT'`；法币资金单出生即 CONFIRMED，`waitUntil` 直接等 `COMPLIANCE_PENDING`。

- [ ] **Step 4: ② 退汇**

```ts
  it('② 退汇：SUCCESS 充值 1200 AED → 银行扣回 → 定性 → 发起（候选含原单）→ CFO 批 → CLAWED_BACK，借应付贷资产，余额减 → 重跑愈', async () => {
    // 先造一笔真充值到 SUCCESS（signals.createForCustomer + scanForCustomer QUICK_DEMO + applyKytVerdict），拿到 deposit 与 wallet
    const { deposit, wallet } = await makeSuccessfulFiatDeposit(carolId, '1200');
    const ref = `E2E-CLAW-${randomUUID()}`;
    const line = await createExternalLine({ walletId: wallet.id, currency: 'AED', book: 'CLIENT', direction: 'OUT', amount: 120_000n, externalRef: ref, description: 'Return' });
    await upsertExternalBalance({ walletId: wallet.id, currency: 'AED', book: 'CLIENT', closingBalance: 0n });   // 外部：1200 进又 1200 出
    expect((await walletRecon.run({ cutoff: CUTOFF })).status).toBe('BREAK');
    const kase = await openCaseFor(wallet.id);
    const disp = await dispositions.record(kase.caseNo, { explainedExternalLineId: line.id, matchType: 'ORPHAN_EXTERNAL', causeCode: 'BOUNCED_FUNDS', externalDirection: 'OUT', findingNote: '银行撤回' } as any, ops());
    const cands = await app.get(SupplementEvidenceService).listCandidates(kase.caseNo, line.id);
    expect(cands.kind).toBe('SUPPLEMENT_BOUNCE'); expect(cands.candidates.map((c) => c.orderNo)).toContain(deposit.depositNo);

    const before = (await accounting.getCustomerAvailableBalance(carolId, 'AED')).available;
    const req = await depositWf.initiateClawback(deposit.depositNo, { externalLineId: line.id, caseNo: kase.caseNo, dispositionNo: disp.dispositionNo, reason: '银行撤回' }, ops());
    await approvalsService.approve(req.approvalNo, { reason: 'e2e CFO approve clawback' }, cfo());
    await waitUntil(async () => (await deposits.findOne(deposit.id)).status === 'CLAWED_BACK');
    const ev = (await tbEvidence.findBySource('DEPOSIT', deposit.depositNo)).find((e: any) => e.eventCode === 'DEPOSIT_CLAWBACK');
    expect(ev.debitCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE]); expect(ev.creditCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET]);
    expect(ev.externalRef).toBe(ref); expect(ev.effectiveDate).toBe(kase.businessDate);
    expect((await accounting.getCustomerAvailableBalance(carolId, 'AED')).available).toBe(before - 120_000n);
    await walletRecon.run({ cutoff: CUTOFF });
    expect((await (prisma as any).reconciliationCase.findUnique({ where: { id: kase.id } })).status).toBe('RESOLVED');
    expect(await auditSince('DEPOSIT_CLAWED_BACK', deposit.depositNo)).toHaveLength(1);
  });
```
`makeSuccessfulFiatDeposit`：`signals.createForCustomer(customerId, { walletId, amount, referenceNo: 'E2E-DEP-…', fromIban })` → `signals.scanForCustomer(customerId, { walletId, mode: 'QUICK_DEMO' })`（签名以文件为准）→ 等 `COMPLIANCE_PENDING` → `applyKytVerdict` → 等 `SUCCESS`；随后把这笔充值的外部对账镜像补上（`createExternalLine` IN 120_000 + 同参考号），让案子只剩退汇那一条差异。

- [ ] **Step 5: ③ 退回**

同 ② 的结构：先造一笔 SUCCESS 提现 900 AED（照 `recon-adjustment-money-arcs.e2e-spec.ts` 里驱动提现到 SUCCESS 的夹具），外部行 IN 90_000 参考号 `E2E-PAYRET-…`，定性 `PAYOUT_RETURNED`，`withdrawWf.initiateReturnClaim`，CFO 批，等 `RETURNED`，断言 evidence `eventCode === 'WITHDRAW_BOUNCE_REENTRY'`、`externalRef`、`effectiveDate`、客户余额 +90_000n、费腿 evidence 数量不变、案子愈、审计 `WITHDRAW_RETURNED_AFTER_SUCCESS` 一条。

- [ ] **Step 6: 拒绝路径 + 变异钩子**

```ts
  it('拒绝路径：同一行二次发起 400；② 余额不足 400；成因与方向不符 400；CFO 拒绝后原状态不动、supplementNo 清空、可再发起', async () => {
    // (a) 方向不符：外部 OUT 行定性 MISSED_DEPOSIT → dispositions.record 抛 /方向不符/
    // (b) ② 余额不足：SUCCESS 充值 1200 后让客户把钱换走/提走（或直接造一笔 SUCCESS 提现 1100），再发起退汇 → /余额不足/
    // (c) 二次发起：①a 主链上已被认领的行再 initiateSupplement → /已被补录 .* 认领/
    // (d) 拒绝：新造 ② 场景，initiateClawback 后 approvalsService.reject(approvalNo, { reason }, cfo())，等待 supplementNo 变 null、deposit.clawbackExternalLineId 变 null、status 仍 SUCCESS；再 initiateClawback 成功拿到新 approvalNo
  });
```
把四段注释各写成真实断言（`rejects.toThrow(/…/)` + `waitUntil`），不留注释体。

- [ ] **Step 7: 跑绿 + 提交**

```bash
source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test:e2e -- --testPathPattern 'test/recon-supplement'
bash scripts/on-stack.sh self test:e2e -- --testPathPattern 'test/recon-'
git add test/recon-supplement.e2e-spec.ts
git commit -m "test(recon): 补单三入口 e2e——四条主链 + 拒绝路径 + 审计，真审批真记账真重对账"
```
Expected: 新文件全绿；四份 recon e2e 一起跑仍全绿（串行，共用一套库）。红了先看是不是同日案件号复用（审计断言已按 testStartedAt 圈定）与 `waitUntil` 超时（把 15000 提到 30000 再判）。

---

### Task 9: 管理台 · 案子上的补单入口（三路一个弹层）+ 徽标 + 定性弹层文案

**本任务做：** 新组件 `ReconciliationSupplementModal.tsx`（证据只读区 + 按去向切表单 + 候选原单单选 + 提交）；案子详情定性行的「发起补录 / 认领退汇 / 认领退回」按钮与「已转补单 → 单号」徽标；定性弹层 `SUPPLEMENT` 出口的确认文案。
**本任务不做：** 审批中心（通用不改）；充值 / 提现详情页（Task 10）。

**Files:**
- Create: `admin-web/src/components/ReconciliationSupplementModal.tsx`
- Modify: `admin-web/src/pages/ReconciliationCasesDetailPage.tsx`（行类型 105–121 行加 `deferredTarget` / `supplementNo` / `supplementRef`；徽标区 940–985 行；权限判定处照 `canCreateAdjustment` 加 `canSupplement`）
- Modify: `admin-web/src/components/ReconciliationDispositionModal.tsx:188-193`（结果屏加 `SUPPLEMENT` 分支）
- Test: `cd admin-web && npx tsc -b --noEmit`；preview 截图三张（三路表单）+ 一张徽标

**Interfaces（Consumes）:** Task 4 `GET /admin/reconciliation/cases/:caseNo/supplement-candidates?externalLineId=`；Task 5/6/7 三个 POST；读面字段 `disposition.deferredTarget / supplementNo / supplementRef`。

- [ ] **Step 1: 类型与徽标**

`FlowComparisonRow.disposition` 加：
```ts
    deferredTarget?: 'SUPPLEMENT_DEPOSIT' | 'SUPPLEMENT_BOUNCE' | 'SUPPLEMENT_PAYOUT_RETURN' | string | null;
    supplementNo?: string | null;
    supplementRef?: { kind: 'SIGNAL' | 'DEPOSIT' | 'WITHDRAW'; no: string; id: string | null } | null;
```
权限：在算 `canCreateAdjustment` 的地方同款加
```ts
  const canSupplement = hasAnyPermissionGroup(['DEPOSIT_SUPPLEMENT_WRITE', 'DEPOSIT_CLAWBACK_WRITE', 'WITHDRAW_RETURN_CLAIM_WRITE']);
```
（`hasAnyPermissionGroup` 以该页面现有的权限判定 helper 名为准。）徽标区在 `WRITE_OFF` 按钮块之前加：
```tsx
{row.disposition.outlet === 'SUPPLEMENT' && !row.disposition.supplementNo && canSupplement && kase.status === 'OPEN' && (
  <button type="button" onClick={() => setSupplementRow(row)} className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[10px] font-medium text-adm-blue hover:underline">
    <Plus size={10} />
    {SUPPLEMENT_ACTION_LABEL[row.disposition.deferredTarget ?? ''] ?? '发起补单'}
  </button>
)}
{row.disposition.outlet === 'SUPPLEMENT' && row.disposition.supplementNo && (
  <span className="whitespace-nowrap font-mono text-[10px] text-adm-t2">
    已转补单 →{' '}
    {row.disposition.supplementRef?.kind === 'DEPOSIT' && row.disposition.supplementRef.id
      ? <Link to={`/admin/trading/deposits/${row.disposition.supplementRef.id}`} className="text-adm-blue hover:underline">{row.disposition.supplementNo}</Link>
      : row.disposition.supplementRef?.kind === 'WITHDRAW' && row.disposition.supplementRef.id
        ? <Link to={`/admin/trading/withdrawals/${row.disposition.supplementRef.id}`} className="text-adm-blue hover:underline">{row.disposition.supplementNo}</Link>
        : <span>{row.disposition.supplementNo}（待 CFO 复核）</span>}
  </span>
)}
```
文件顶部加常量：
```ts
const SUPPLEMENT_ACTION_LABEL: Record<string, string> = { SUPPLEMENT_DEPOSIT: '发起补录', SUPPLEMENT_BOUNCE: '认领退汇', SUPPLEMENT_PAYOUT_RETURN: '认领退回' };
```
提现详情路由前缀以路由表为准（`grep -n "withdrawals/" admin-web/src/App.tsx admin-web/src/routes*.tsx`）。页面挂上 `<ReconciliationSupplementModal open={!!supplementRow} caseNo={caseNo} row={supplementRow} decimals={…} currency={…} onClose={() => setSupplementRow(null)} onDone={() => { setSupplementRow(null); fetchCase(); }} />`。

- [ ] **Step 2: 弹层组件**

```tsx
// admin-web/src/components/ReconciliationSupplementModal.tsx
// 平账 B 批（spec §2.2 / §7）：三路补单一个组件。证据区只读（金额 / 币种 / 时间 / 参考号 / 银行描述），
// 下半按定性去向切：① 链上填来源地址、法币填来源 IBAN；②③ 候选原单单选；都要原因。
// 提交打业务域端点；对账域只给候选。UUID 不出现在页面（externalLineId 只是隐藏锚）。
import { useEffect, useState } from 'react';
import { adminFetch, AdminSessionError, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../utils/adminButtonClass';   // 以现有弹层的 import 为准

type Kind = 'SUPPLEMENT_DEPOSIT' | 'SUPPLEMENT_BOUNCE' | 'SUPPLEMENT_PAYOUT_RETURN';
interface LineFacts { externalLineId: string; caseNo: string; businessDate: string; dispositionNo: string | null; walletNo: string | null; ownerNo: string | null;
  currency: string; assetType: 'CRYPTO' | 'FIAT'; decimals: number; direction: 'IN' | 'OUT'; amountMajor: string; externalRef: string | null; channelRef: string | null; datetime: string; description: string | null; source: string }
interface Candidate { orderNo: string; id: string; amountMajor: string; createdAt: string; status: string }
interface Props { open: boolean; caseNo: string; row: any | null; onClose: () => void; onDone: () => void }

const TITLE: Record<Kind, string> = { SUPPLEMENT_DEPOSIT: '发起补录 · 漏记客户入金', SUPPLEMENT_BOUNCE: '认领退汇 · 入金被银行扣回', SUPPLEMENT_PAYOUT_RETURN: '认领退回 · 出款后被银行退回' };
const ENDPOINT = (kind: Kind, orderNo: string) => kind === 'SUPPLEMENT_DEPOSIT' ? '/deposit-transactions/supplement'
  : kind === 'SUPPLEMENT_BOUNCE' ? `/deposit-transactions/${encodeURIComponent(orderNo)}/clawback` : `/withdraw-transactions/${encodeURIComponent(orderNo)}/return-claim`;

const ReconciliationSupplementModal = ({ open, caseNo, row, onClose, onDone }: Props) => {
  const [facts, setFacts] = useState<LineFacts | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [orderNo, setOrderNo] = useState('');
  const [fromAddress, setFromAddress] = useState(''); const [fromIban, setFromIban] = useState(''); const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState(''); const [result, setResult] = useState<{ approvalNo: string; no: string } | null>(null);

  useEffect(() => {
    if (!open || !row?.externalLine?.id) return;
    setFacts(null); setResult(null); setError(''); setOrderNo(''); setFromAddress(''); setFromIban(''); setReason('');
    (async () => {
      try {
        const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/reconciliation/cases/${encodeURIComponent(caseNo)}/supplement-candidates?externalLineId=${encodeURIComponent(row.externalLine.id)}`);
        if (!res.ok) { setError(await getApiErrorMessage(res, '读取账单行失败')); return; }
        const data = await res.json();
        setFacts(data.line); setKind(data.kind); setCandidates(data.candidates ?? []);
        if (data.candidates?.length === 1) setOrderNo(data.candidates[0].orderNo);
      } catch (e) { if (e instanceof AdminSessionError) throw e; setError(e instanceof Error ? e.message : '读取账单行失败'); }
    })();
  }, [open, caseNo, row]);

  if (!open || !row) return null;
  const dispositionNo: string | undefined = row.disposition?.dispositionNo;
  const needAddr = kind === 'SUPPLEMENT_DEPOSIT' && facts?.assetType === 'CRYPTO';
  const needIban = kind === 'SUPPLEMENT_DEPOSIT' && facts?.assetType === 'FIAT';
  const needOrder = kind === 'SUPPLEMENT_BOUNCE' || kind === 'SUPPLEMENT_PAYOUT_RETURN';
  const canSubmit = !!facts && !!kind && !!dispositionNo && reason.trim().length > 0 && (!needAddr || fromAddress.trim()) && (!needIban || fromIban.trim()) && (!needOrder || orderNo);

  const submit = async () => {
    if (!canSubmit || !facts || !kind) return;
    setSubmitting(true); setError('');
    try {
      const body: Record<string, unknown> = { externalLineId: facts.externalLineId, caseNo, dispositionNo, reason: reason.trim() };
      if (needAddr) body.fromAddress = fromAddress.trim(); if (needIban) body.fromIban = fromIban.trim();
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}${ENDPOINT(kind, orderNo)}`, { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) { setError(await getApiErrorMessage(res, '发起失败')); return; }
      const r = await res.json();
      setResult({ approvalNo: r.approvalNo, no: r.signalNo ?? r.depositNo ?? r.withdrawNo });
    } catch (e) { if (e instanceof AdminSessionError) throw e; setError(e instanceof Error ? e.message : '发起失败'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[600px] max-h-[85vh] overflow-y-auto rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-adm-t1">{kind ? TITLE[kind] : '补单'}</h3>
        {facts && (
          <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1 rounded border border-adm-border bg-adm-hover/40 p-3 text-xs">
            <dt className="text-adm-t3">来源</dt><dd className="font-mono">{facts.source}</dd>
            <dt className="text-adm-t3">方向 / 金额</dt><dd className="font-mono">{facts.direction} {facts.amountMajor} {facts.currency}</dd>
            <dt className="text-adm-t3">入账时刻</dt><dd className="font-mono">{facts.datetime.replace('T', ' ').slice(0, 19)}</dd>
            <dt className="text-adm-t3">参考号</dt><dd className="font-mono">{facts.externalRef ?? '—'}</dd>
            <dt className="text-adm-t3">银行描述</dt><dd>{facts.description ?? '—'}</dd>
            <dt className="text-adm-t3">钱包 / 客户</dt><dd className="font-mono">{facts.walletNo ?? '—'} · {facts.ownerNo ?? '—'}</dd>
            <dt className="text-adm-t3">生效日（案子业务日）</dt><dd className="font-mono">{facts.businessDate}</dd>
          </dl>
        )}
        {result ? (
          <>
            <p className="text-xs text-adm-t2">已发起，等待 CFO 复核。审批单 <span className="font-mono">{result.approvalNo}</span>，补单号 <span className="font-mono">{result.no}</span>。批准后由业务域执行，回案子点「重新对账」看自愈。</p>
            <div className="mt-4 flex justify-end"><button type="button" onClick={onDone} className={adminButtonClass('modalConfirm')}>完成</button></div>
          </>
        ) : (
          <>
            {needAddr && <label className="mb-3 block text-xs">来源地址<input value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 font-mono text-xs" placeholder="链上付款方地址" /></label>}
            {needIban && <label className="mb-3 block text-xs">来源 IBAN<input value={fromIban} onChange={(e) => setFromIban(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 font-mono text-xs" placeholder="付款方 IBAN" /></label>}
            {needOrder && (
              <fieldset className="mb-3 text-xs">
                <legend className="mb-1 text-adm-t3">原单（同钱包 · 已成功 · 同金额，最近的在前）</legend>
                {candidates.length === 0 && <p className="text-adm-red">没有金额相符的原单，不能认领</p>}
                {candidates.map((c) => (
                  <label key={c.orderNo} className="flex items-center gap-2 py-0.5">
                    <input type="radio" name="orderNo" checked={orderNo === c.orderNo} onChange={() => setOrderNo(c.orderNo)} />
                    <span className="font-mono">{c.orderNo}</span><span>{c.amountMajor}</span><span className="text-adm-t3">{c.createdAt.slice(0, 10)}</span>
                  </label>
                ))}
              </fieldset>
            )}
            <label className="mb-3 block text-xs">原因<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="写清依据：银行回单 / 托管通知 / 客户申报" /></label>
            {error && <p className="mb-2 text-xs text-adm-red">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>取消</button>
              <button type="button" disabled={!canSubmit || submitting} onClick={submit} className={adminButtonClass('modalConfirm')}>{submitting ? '提交中…' : '提交给 CFO 复核'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
export default ReconciliationSupplementModal;
```
`row.externalLine.id` 的取法以行类型里外部行字段名为准（`grep -n "externalLine" ReconciliationCasesDetailPage.tsx | head`）；`adminButtonClass` 的取法照 `ReconciliationDispositionModal.tsx`。

- [ ] **Step 3: 定性弹层结果文案**

`ReconciliationDispositionModal.tsx` 结果屏加一行：
```tsx
{result.outlet === 'SUPPLEMENT' && `不落任何分录。这条差异要回业务域补单（${result.outletLabel.replace('补单·', '')}）：点「完成」后在定性行旁发起，CFO 复核通过由业务域执行，再回来「重新对账」。`}
```
`DEFERRED` 那行文案里的「本期未开放」保留（二期 / 三期仍留档）。

- [ ] **Step 4: 渲染验证 + 提交**

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
```
起 preview（`.claude/launch.json` 的 admin 配置，self 栈端口），用 OPS_OFFICER 账号登录，打开 Bob USDT 案（场景 13）→ 定性「漏记客户入金」→ 「发起补录」弹层截图；Kate AED 案（场景 14，Task 11 搬家后）→ 「认领退汇」弹层截图（候选含 1200 AED 那笔）；Grace AED 案（场景 15）→ 「认领退回」弹层截图；提交一笔后回案子看「已转补单 → SIG…（待 CFO 复核）」徽标截图。四张存 `doc-final/superpowers/plans/artifacts/2026-09-03-B-supplement-{deposit,clawback,payout-return,badge}.png`。
```bash
git add admin-web/src/components/ReconciliationSupplementModal.tsx admin-web/src/components/ReconciliationDispositionModal.tsx admin-web/src/pages/ReconciliationCasesDetailPage.tsx doc-final/superpowers/plans/artifacts
git commit -m "feat(admin): 案子上的补单入口——三路一个弹层，证据只读、候选原单单选、提交给 CFO 复核"
```

---

### Task 10: 管理台充值 / 提现页 + 客户端 · 新终态、来源块、补录小标

**本任务做：** 充值状态表加 `CLAWED_BACK`；充值详情「补录来源」块与「业务归属日」；充值列表「补录」小标（列表接口回 `isSupplement`）；提现详情「出款后退回」来源块；`StatusPill`；客户端 `depositStatusView` 加 `CLAWED_BACK`（+ vitest）。
**本任务不做：** 客户端余额历史页（账本投影，自然出现）；提现 `RETURNED` 客户文案（已有）。

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`（`findOne` 返回加 `supplementOrigin` / `clawbackOrigin`；`findAll` 列表项加 `isSupplement`）
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts`（详情加 `returnOrigin`）
- Modify: `admin-web/src/utils/depositStatusMap.ts:54-55,115-116`、`admin-web/src/components/ui/StatusPill.tsx:41`
- Modify: `admin-web/src/pages/DepositTransactionDetail.tsx`（约 589–594 行 InfoField 区）、`admin-web/src/pages/DepositTransactionList.tsx`（约 336 行 Deposit No 单元格）、`admin-web/src/pages/WithdrawTransactionDetail.tsx`（约 442 行 Net Amount 之后）
- Modify: `client-web/src/utils/depositStatusView.ts:56-95` + `depositStatusView.spec.ts:19-48`

- [ ] **Step 1: 后端读面**

充值 `findOne`：查 legSeq 1 资金单的 `providerTxnId` → `inboundTransferSignal.findUnique({ where: { id } })`；若 `supplementOfExternalLineId` 非空，返回 `supplementOrigin: { signalNo, reconCaseNo: supplementReconCaseNo, externalRef: <该行 externalRef>, effectiveDate }`，否则 `null`。`clawbackOrigin`：`clawbackExternalLineId` 非空时 `{ reconCaseNo: clawbackReconCaseNo, externalRef, dispositionNo }`。`findAll`：一次 `inboundTransferSignal.findMany({ where: { id: { in: providerTxnIds }, supplementOfExternalLineId: { not: null } } })` 标 `isSupplement`。提现详情：`returnExternalLineId` 非空时 `returnOrigin: { reconCaseNo, externalRef }`。外部行参考号用 `externalStatementLine.findUnique` 取（横向只读）。

- [ ] **Step 2: 管理台**

`depositStatusMap.ts`：`RETURNED` 之后加 `CLAWED_BACK: { label: 'CLAWED BACK', group: 'COMPLETED', badgeClass: GRAYBLUE },`；筛选桶 `{ label: 'Returned', statuses: ['RETURNED', 'CLAWED_BACK'] }`。`StatusPill.tsx` 加 `CLAWED_BACK: 'bg-red-100 text-red-800',`。
充值详情在 `Reference No` 之后加：
```tsx
{data.effectiveDate && <InfoField label="业务归属日" value={data.effectiveDate} mono />}
{data.supplementOrigin && <InfoField label="补单来源" value={`对账案 ${data.supplementOrigin.reconCaseNo} · 账单行 ${data.supplementOrigin.externalRef} · 信号 ${data.supplementOrigin.signalNo}`} mono />}
{data.clawbackOrigin && <InfoField label="退汇来源" value={`对账案 ${data.clawbackOrigin.reconCaseNo} · 账单行 ${data.clawbackOrigin.externalRef}`} mono />}
```
充值列表 Deposit No 单元格加 `{item.isSupplement && <span className="ml-1 rounded bg-adm-blue/10 px-1 text-[9px] text-adm-blue">补录</span>}`。提现详情 `Net Amount` 之后加 `{data.returnOrigin && <InfoField label="退回来源" value={`出款后被银行退回 · 对账案 ${data.returnOrigin.reconCaseNo} · 账单行 ${data.returnOrigin.externalRef} · 本金已重记，手续费不退`} />}`。

- [ ] **Step 3: 客户端**

`depositStatusView.ts` `RETURNED` 之后加：
```ts
  CLAWED_BACK: {
    label: 'CLAWED BACK',
    note: 'The bank reversed this deposit; your balance was reduced accordingly',
    tone: 'neutral',
  },
```
spec：`ALL_STATUSES` 加 `'CLAWED_BACK'`，`LABEL_CASES` 加 `['CLAWED_BACK', 'CLAWED BACK']`。

- [ ] **Step 4: 闸门 + 截图 + 提交**

```bash
source scripts/node-env.sh && ensure_node20 && npx tsc --noEmit -p tsconfig.json
cd admin-web && npx tsc -b --noEmit && cd ..
cd client-web && npx tsc -b --noEmit && cd ..
npm run test:client
bash scripts/on-stack.sh self test -- src/modules/trading/deposit-transactions src/modules/trading/withdraw-transactions
bash scripts/stack.sh up
```
preview 截图三张：充值详情「CLAWED BACK」+ 退汇来源块；提现详情「RETURNED」+ 退回来源块；客户端充值详情「CLAWED BACK」。存 `artifacts/2026-09-03-B-{deposit-clawed-back,withdraw-returned-after-success,client-clawed-back}.png`。
```bash
git add src/modules/trading admin-web/src client-web/src doc-final/superpowers/plans/artifacts
git commit -m "feat(ui): 退汇终态与补单来源——管理台充值/提现页、状态表、客户端充值视图"
```

---

### Task 11: 演示种子 · 场景 14 搬 Kate AED + 新场景 15 Grace AED

**本任务做：** `scripts/recon-demo.ts`：场景 14 从 Alice USDT 搬到 Kate AED（退 #28 那笔 1200 AED 成功充值，叠在改记接收端钱包上），新场景 15 Grace AED（退 #16 那笔 900 AED 成功提现，叠进展示位甲），头注释改 15 行，答案键 / 钱包条目同步。
**本任务不做：** 不改引擎；不加客户；花名册不动。

**Files:**
- Modify: `scripts/recon-demo.ts`（头注释 20–34 行；slot 计划 746–753 行；场景 14 块 1521–1567 行；展示位甲的 `wallets.push` 1221–1230 行；改记接收端的 `wallets.push` 1462–1469 行）

- [ ] **Step 1: 头注释**

⑬ ⑭ 两行改为，并加 ⑮：
```
//                    ⑬ 漏监听充值   补单·充值补录（B 批开门，链上）
//                    ⑭ 入金被退汇   补单·退汇认领（B 批开门，法币，叠 Kate AED）
//                    ⑮ 出金被退回   补单·退回认领（B 批开门，法币，叠 Grace AED）
```
「14 行 = 14 场景」改「15 行 = 15 场景」。

- [ ] **Step 2: slot**

`slotReturn` 改为 `planByOwnerAsset(KATE_NO, 'AED'); // ⑭ 入金被退汇（B 批搬家：退汇只有法币；Alice USDT 位空出给二期场景 16）`，并加 `const slotPayoutReturn = planByOwnerAsset(GRACE_NO, 'AED'); // ⑮ 出金被退回（叠展示位甲）`。`KATE_NO` 已在 736 行取到。

- [ ] **Step 3: 场景 14 改写**

整块替换为：
```ts
  // ── 场景 ⑭ — 入金被退汇 (BREAK / ORPHAN_EXTERNAL / 客户账簿 / 法币) ──────────
  // 银行把一笔已经入账的钱扣了回去：账单上多一条 OUT，我方账上那笔充值仍在 → 外有我无 + 余额差。
  // B 批（2026-09-03）搬到 Kate AED：退汇只有法币；原单必须是一笔真实 SUCCESS 充值（花名册 #28，1200 AED），
  // 认领时候选靠「同钱包 · SUCCESS · 同金额」找它，所以这里先断言它在。叠在改记接收端钱包上（一案两行）。
  {
    const s14Amount = D('120000');   // 分 —— 1200.00 AED = 花名册 #28
    const original = await (prisma as any).depositTransaction.findFirst({
      where: { toWalletId: slotReturn.walletRef, status: 'SUCCESS', amount: new Prisma.Decimal('1200') },
    });
    if (!original) throw new Error('场景 14 需要 Kate 有一笔 SUCCESS 的 1200 AED 充值（花名册 #28）—— demo:all 是否跑过？');
    const outRef = refFor(slotReturn.currency, 'CLAWBACK');
    const created = await (prisma as any).externalStatementLine.create({
      data: {
        source: sourceFor(slotReturn.currency), accountRef: slotReturn.walletRef, subAccount: slotReturn.walletRef,
        book: slotReturn.book, currency: slotReturn.currency, direction: 'OUT', amount: s14Amount, externalRef: outRef,
        channelRef: original.referenceNo ?? null, datetime: cutoff,
        description: 'Demo bank return — a previously credited deposit was clawed back',
        dedupKey: `DEMO-INJ-${cutoffDate}-${slotReturn.walletRef}-s14-bounced`,
      },
    });
    const prevClose = await bumpClosing(slotReturn, s14Amount.negated());
    scenarios.push({
      scenarioId: 14, rootCause: 'BOUNCED_FUNDS',
      expectedLines: [{ walletRef: slotReturn.walletRef, lineType: 'ORPHAN_EXTERNAL', amount: s14Amount.toString(), externalRef: outRef }],
      detail: { insertedExternalLineId: created.id, originalDepositNo: original.depositNo, prevClosingBalance: prevClose, closingBalanceDelta: s14Amount.negated().toString() },
    });
  }
```
改记接收端那个 `wallets.push` 改为 `scenarioIds: [8, 14]`，`bucketRationale` 追加一句 `'；⑭ 再加一条 OUT 幽灵行并压低同额收盘（1200 AED 退汇），残差仍 ≠ 0 → BREAK'`。删除原场景 14 末尾单独的 `wallets.push({ walletRef: slotReturn.walletRef, scenarioIds: [14] … })`。

- [ ] **Step 4: 新场景 15**

紧接场景 14 之后加：
```ts
  // ── 场景 ⑮ — 出金被退回 (BREAK / ORPHAN_EXTERNAL / 客户账簿 / 法币) ──────────
  // 一笔已经成功出款的提现，几天后被银行原路退回：账单上多一条 IN、带原出款关联号，我方账上那笔提现仍是 SUCCESS。
  // 原单 = 花名册 #16（Grace 900 AED 提现成功）。叠进展示位甲（一案四行）。
  {
    const s15Amount = D('90000');   // 分 —— 900.00 AED = 花名册 #16 净额
    const original = await (prisma as any).withdrawTransaction.findFirst({
      where: { fromWalletId: slotPayoutReturn.walletRef, status: 'SUCCESS', netAmount: new Prisma.Decimal('900') },
    });
    if (!original) throw new Error('场景 15 需要 Grace 有一笔 SUCCESS 的 900 AED 提现（花名册 #16）—— demo:all 是否跑过？');
    const inRef = refFor(slotPayoutReturn.currency, 'PAYOUTRET');
    const created = await (prisma as any).externalStatementLine.create({
      data: {
        source: sourceFor(slotPayoutReturn.currency), accountRef: slotPayoutReturn.walletRef, subAccount: slotPayoutReturn.walletRef,
        book: slotPayoutReturn.book, currency: slotPayoutReturn.currency, direction: 'IN', amount: s15Amount, externalRef: inRef,
        channelRef: original.withdrawNo, datetime: cutoff,
        description: 'Demo bank return — a completed payout bounced back (Return)',
        dedupKey: `DEMO-INJ-${cutoffDate}-${slotPayoutReturn.walletRef}-s15-payout-returned`,
      },
    });
    const prevClose = await bumpClosing(slotPayoutReturn, s15Amount);
    scenarios.push({
      scenarioId: 15, rootCause: 'PAYOUT_RETURNED',
      expectedLines: [{ walletRef: slotPayoutReturn.walletRef, lineType: 'ORPHAN_EXTERNAL', amount: s15Amount.toString(), externalRef: inRef }],
      detail: { insertedExternalLineId: created.id, originalWithdrawNo: original.withdrawNo, prevClosingBalance: prevClose, closingBalanceDelta: s15Amount.toString() },
    });
  }
```
展示位甲的 `wallets.push` 改 `scenarioIds: [2, 3, 4, 15]`，`bucketRationale` 追加 `'；⑮ 再加一条 IN 幽灵行并抬高同额收盘（900 AED 出款退回），残差仍 ≠ 0 → BREAK'`。`ScenarioExpectation.detail` 的类型若是固定字段，加可选 `originalDepositNo?` / `originalWithdrawNo?`。`RootCause` 类型来自 `CauseCode`，Task 2 已含 `PAYOUT_RETURNED`。

⚠ 方向不会误配：Kate 幽灵 OUT 对内部 IN、Grace 幽灵 IN 对内部 OUT（900 提现是 OUT 流水），模糊匹配按方向先筛，不会被第二轮吞掉。

- [ ] **Step 5: 重铺闸 + 提交**

```bash
source scripts/node-env.sh && ensure_node20 && bash scripts/stack.sh reset self
bash scripts/on-stack.sh self demo:all
bash scripts/on-stack.sh self recon:demo:break
```
Expected: demo:all 29/29 + COA 5/5；`recon:demo:break` 打印 **scenarios 15/15、wallets 11/11、casesOpened 11/11、identities OK、ALL 15 SCENARIOS DETECTED PER MANIFEST**。
```bash
git add scripts/recon-demo.ts
git commit -m "chore(demo): 场景 14 退汇搬到 Kate AED（退汇只有法币）、新增场景 15 Grace AED 出款退回——15/15"
```

---

### Task 12: 第六幕走查 + 全套闸门 + 变异测试

**本任务做：** 在 self 栈上按第六幕顺序把三笔补单走完（场景 9 先演），拍 AUTO_HEALED 截图；全套闸门；两条变异测试（spec §9）。
**本任务不做：** 不改代码（红了回到对应任务修）。

- [ ] **Step 1: 走查（用 UI，OPS 与 CFO 两个账号）**

顺序：`reset self` → `demo:all` → `recon:demo:break` → 先演场景 9（挂起·等下期）→ 场景 13：Bob USDT 案定性「漏记客户入金」→「发起补录」（来源地址随便填链上格式）→ 场景 14：Kate AED 案定性「入金被退汇/回冲」→「认领退汇」选 1200 AED 原单 → 场景 15：Grace AED 案第四行定性「提现被银行退回」→「认领退回」选 900 AED 原单 → 切 CFO 账号到审批中心批三张单（摘要各是后果原话）→ 充值列表看到新充值单带「补录」小标、走到 SUCCESS（若停在 COMPLIANCE_PENDING，用充值详情 ⚡ 喂「approved」）；Kate 的 1200 充值「CLAWED BACK」；Grace 的 900 提现「RETURNED」→ 回案子点「重新对账」→ 三案 AUTO_HEALED 截图 `artifacts/2026-09-03-B-three-cases-healed.png`；客户端登 Kate 看充值「CLAWED BACK」+ 余额历史先加后减两行截图 `artifacts/2026-09-03-B-client-balance-history.png`。

- [ ] **Step 2: 全套闸门**

```bash
source scripts/node-env.sh && ensure_node20 && npx tsc --noEmit -p tsconfig.json
cd admin-web && npx tsc -b --noEmit && cd ..
cd client-web && npx tsc -b --noEmit && cd ..
npm run test:client
bash scripts/on-stack.sh self test -- src/modules/clearing-settle/reconciliation src/modules/trading/deposit-transactions src/modules/trading/withdraw-transactions src/modules/funds-orders src/modules/governance/approvals src/modules/audit-logging/constants
bash scripts/on-stack.sh self test:e2e -- --testPathPattern 'test/recon-'
bash scripts/on-stack.sh self verify:coa
bash scripts/on-stack.sh self verify:audit
bash scripts/on-stack.sh self verify:rbac
```
Expected: 全绿（`verify:audit` 需先用 admin 查一次审计日志播种 Q6，照 A 批报告）。

- [ ] **Step 3: 变异测试（终审前由 fable 执行，记录到报告）**

1. 把 Task 6 `executeClawback` 里的 `assertClawbackBalance` 调用注掉 → e2e 拒绝路径「② 余额不足 400」必须红；恢复。
2. 把 Task 3 `advanceFundsOrder` CONFIRM 步的 `{ effectiveDate }` 去掉 → e2e ①a「重跑愈」必须红（流水落在今天，D 日重跑看不见）；恢复。
两条都红过再绿，写进终审报告。

---

### Task 13: 文档收口 + 承接 B 批写进二期骨架

**本任务做：** decisions +5；v8-recon / v4-deposit / v5-withdraw / overview；成因手册三行；demo 三件；BACKLOG 销三加二；CHANGELOG 一行；二期骨架开头「承接 B 批」段。
**本任务不做：** 不展开二期 spec（交付清单多波行：只写承接）。

**Files:**
- Modify: `doc-final/decisions.md`（末尾追加 spec §11 五条原文）
- Modify: `doc-final/modules/v8-recon.md`（§1 业务叙事补一段；§2 状态表加 SUPPLEMENT 出口；§3 决策表补单三行；§4 场景表 13/14/15 三行 + 第六幕新步；§5 技术节点加「补单三入口」一条；§6 缺口：删「补单两入口未建」，加「余额不足待二期垫款三期追索」「无主入金超期退回付款方（BACKLOG）」）
- Modify: `doc-final/modules/v4-deposit.md`（§2 状态机：14 状态 → 15，`SUCCESS → CLAWED_BACK` 一条边；§3 决策点：补录与退汇认领两行，CFO；§4 演示脚本加一句指向第六幕；§5 技术节点：`effectiveDate` 列、`DEPOSIT_CLAWBACK` 码）
- Modify: `doc-final/modules/v5-withdraw.md`（§2 状态图：`SUCCESS → RETURNED`（出款后退回，B 批）；「4 个零出边终态」改 3；§3 决策点加退回认领行，CFO；§4 第 7 步旁注「SUCCESS 之后的退回见第六幕场景 15」）
- Modify: `doc-final/modules/overview.md`（V8 那行「破口分案处置」后补「补单回业务域」；职务表 OPS_OFFICER 那行加「发起补单」，CFO 行加「补单三路复核」）
- Modify: `doc-final/reference/recon-cause-handbook.md`（158–182 行：`MISSED_DEPOSIT` / `BOUNCED_FUNDS` 出口改「补单 · …」并各加「怎么演」一句；`BOUNCED_FUNDS` 之后新增 `PAYOUT_RETURNED` 小节；来源链接加本批 spec）
- Modify: `doc-final/demo/script.md`（第六幕 13 / 14 两行改写 + 15 一行 + 末尾「三笔补单批完后重对账，三案自愈」一步；14 行里「承接第五幕」那句改「第五幕出款后的退回见本幕场景 15」）
- Modify: `doc-final/demo/data.md:40`（14 个场景 / 11 张案子 → 15 / 11）、`doc-final/demo/baseline.md:57`（14/14 → 15/15）
- Modify: `doc-final/BACKLOG.md`（销 106「运营补录入站信号无入口」、159「后半批：补单两入口」、188「SUCCESS 后退汇无处理」三行为 `[x]` 并注「已解（2026-09-03 平账 B 批）」；G 段加两行：「退汇认领余额不足 → 二期公司垫款 + 三期追索」「无主入金超期退回付款方（行业惯例，今天只挂起）」）
- Modify: `doc-final/CHANGELOG.md`（顶部一行）
- Modify: `doc-final/superpowers/specs/2026-09-03-internal-transfer-order-design.md`（「承接上一波（B 批）」段）

- [ ] **Step 1: decisions.md**

追加 spec §11 五条原文（日期 2026-09-03）。

- [ ] **Step 2: 模块篇四处 + 手册**

按上表逐处改；手册三小节的「出口」行写成「补单 · 充值补录 / 退汇认领 / 退回认领 → 案子上发起，CFO 复核，业务域执行，重对账自愈」；`PAYOUT_RETURNED` 小节照 `BOUNCED_FUNDS` 的段落结构写（是什么 / 线索 / 查证怎么做 / 出口 / 怎么演）。

- [ ] **Step 3: 演示三件 + BACKLOG + CHANGELOG**

`script.md` 第六幕：
```
| 13 | 漏监听的客户入金 | Bob USDT 案那行「处置」→ 选「漏记客户入金」→ 保存 → 定性行旁「发起补录」→ 填来源地址 → 提交 | 徽标「已转补单 → SIG…（待 CFO 复核）」；审批中心 CFO 批 → 充值列表多一张带「补录」小标的单，照常过 KYT / 合规到 SUCCESS |
| 14 | 入金被退汇（法币） | Kate AED 案那行 OUT「处置」→ 选「入金被退汇/回冲」→「认领退汇」→ 选 1200 AED 原单 | CFO 批 → Kate 那笔充值变「CLAWED BACK」，客户余额减 1200；余额不够时系统直接拒（不演，讲一句：待二期垫款、三期追索） |
| 15 | 出金被银行退回（法币） | Grace AED 案第四行 IN「处置」→ 选「提现被银行退回」→「认领退回」→ 选 900 AED 原单 | CFO 批 → Grace 那笔提现变「RETURNED」，本金 900 重新记入余额，手续费不退 |
| 16 | 三笔补单收尾 | 回案件页点「重新对账」（⚠ 场景 9 必须已演过） | Bob USDT / Kate AED / Grace AED 三案 AUTO_HEALED；长红只剩公司池那张（若未核销） |
```
CHANGELOG 顶部：
`- [2026-09-03] **平账 B 批：外面真有钱进出、我方没记的，终于有门了** —— 观众能感知的变化是：漏记的客户入金在案子上一键补录，走正常充值流程；入金被银行扣回、出款被银行退回都能在案子上认领，CFO 批一下，客户余额跟着外面走，案子重对账后自愈。退汇只有法币；三条路复核人都是 CFO；余额不够退汇的系统直接拒（等二期公司垫款）。`

- [ ] **Step 4: 承接 B 批 → 二期骨架**

把二期骨架的「承接上一波（B 批）」空段填成三小段：**实际偏差**（对照 spec 列出所有偏离：审计码 9 → 10（拒绝码）、其他执行中改口的地方）、**执行中发现的新事实**（e2e / 闸门 / 环境里逮到的）、**二期前提有无变化**（Alice USDT 位是否真空出、`assertWriteOffAllowed` 前提 3 仍锁公司池、`SupplementEvidenceService` 与 `DispositionService` 已从 ReconciliationModule 导出可复用、生效日管道已通到充值两步）。只写承接，不展开设计段。

- [ ] **Step 5: 提交 + 收尾报告**

```bash
git add doc-final
git commit -m "docs: 平账 B 批收口——decisions 五条 / v8 v4 v5 overview / 成因手册三条 / 第六幕三步 / data baseline / BACKLOG 销三加二 / CHANGELOG / 二期骨架承接段"
```
收尾一行：`Documentation updated: modules§0-4 / modules§5 / demo / decisions — 平账 B 批：补单三入口（充值补录 / 入金退汇认领 / 出金退回认领），退汇只有法币，三路 CFO 复核`

---

## 收尾（合并前）

- 对照 spec §9 逐条勾：随手闸三处 ｜ 单测（Task 1/2/3/4/5/6/7 各自目录）｜ e2e 四份 recon 串行全绿 ｜ 重铺闸 15/15 + 11/11 ｜ 第六幕走查 ｜ verify:coa / verify:audit / verify:rbac ｜ 截图九张 ｜ 文档十二处 ｜ 变异测试两条红过再绿 ｜ 二期骨架承接段已填
- 终审（fable）用 `scripts/review-package <merge-base> HEAD`，评审三件事按 `rules/review-rubric.md`；动钱 / 动状态机任务（3/5/6/7/8）的任务级评审已用 opus
- 走 `superpowers:finishing-a-development-branch`：合 main 前查主工作树未提交改动（别的会话常在主树干活，只 add 具名文件）；ff 合并后主栈 `bash scripts/stack.sh reset main` → `up main` → `demo:all` → `recon:demo:break`（15/15）→ verify 三件（main 库上 `verify:audit` 不变量③ 与 `verify:rbac` V2·CFO 两条历史红照 B 批 spec「承接 A 批」段预期）；清 worktree + 分支 + `/tmp/exchange_js_wt_recon-supplement*`
- spec / plan 移入 `doc-final/archive/{specs,plans}/`；总纲留在 `specs/`；成因手册来源链接改指 archive
