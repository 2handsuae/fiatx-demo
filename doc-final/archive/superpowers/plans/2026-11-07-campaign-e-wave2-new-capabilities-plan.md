# 戊波二「新账本才有的能力」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在波一立好的「按钱包开户」账本上，落四件新事（认损补缺一张单、公司调拨单、应收 LP、对内差额）与付款单 from 可选，对账引擎改成锚配对，读面、种子、剧本、基线随之，全部闸门绿。

**Architecture:** 新科目码 2 / 51 与新转账码 88–91 先进常量与开户（T1–T2），共用件（钱包守卫 / 余额闸 / NLA 门）抽出一份（T3），再按单据逐个接线（T4 付款单、T5–T6 公司调拨单、T7–T8 认损补缺），对账引擎最后改（T9：解析器合一、对内差额、第 0 轮），读面一次收（T10），种子 / 剧本 / 基线 / 文档事实句收尾（T11），全量闸与终审（T12）。每个任务自带单测 + 相关 e2e，收尾一次全量。

**Tech Stack:** NestJS + Prisma + SQLite + TigerBeetle 0.17.3；React admin-web；jest（根目录跑）；e2e 经 `bash scripts/on-stack.sh self test:e2e`。

**Spec:** `doc-final/archive/superpowers/specs/2026-11-07-campaign-e-wave2-new-capabilities-spec.md`（已随合并归档）（§0 / §0.1 裁定 1–22 是权威；分录以总纲 `2026-11-06-campaign-e-ledger-by-location-charter.md` 附录 B「波二」列为准；承接与悬挂项在 `2026-11-06-campaign-e-wave2-skeleton.md`）

## Global Constraints

- 科目码只加 **2 `CLIENT_SHORTFALL`**（WALLET 归属、借方户）与 **51 `LP_RECEIVABLE`**（LP 归属、借方户）；`CASH_TB_CODES` 仍 {1, 50}；`cashAccountCodeFor('LP')` 仍抛错（spec §3.1）。
- 转账码只加 **88 `LP_EXCHANGE_RECEIVABLE` / 89 `HOUSE_TRANSFER` / 90 `FEE_INCOME_CLOSE` / 91 `CLIENT_SHORTFALL_RECOGNIZED`**；现有码一个不改号；83 与 85 只改语义与注释（spec §3.2）。
- 90 的 eventCode 三个：`FEE_INCOME_CLOSE_SWAP / FEE_INCOME_CLOSE_WITHDRAW / FEE_INCOME_CLOSE_OTHER`；结转额 = min(调拨金额, Σ(210..212))；顺序 210 → 211 → 212（裁定 13）。
- 公司侧 from 钱包可选范围恒为该币种网络的 **F_OPS / F_FEE** 两只；认损补缺、付款、调拨三张单同一守卫（spec §5.2）；NLA 门只在 from = F_OPS 时调，认损补缺不调（裁定 12）。
- 认损补缺复用 `InternalTransfer`，用途 `SHORTFALL_TOPUP`（原 `CLIENT_COMPENSATION` 改名），`CLIENT_ADVANCE` 原样不动、入口仍置灰。
- 公司调拨单前缀 **`HTR`**，用途本波只有 `'FEE_SWEEP'`，六态六边抄划转单。
- 新审批类型只有 **`HOUSE_TRANSFER_APPROVAL`**（金库提 / CFO 单步 / 48h / 可撤）；新审计码 **8** 个（V7 +1 `INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED`，新名册 `CAMPAIGN_E_HOUSE_TRANSFER_AUDIT_ACTIONS` 7 个）；不加权限组，复用 `FUNDING_READ / FUNDING_WRITE / INTERNAL_TRANSFER_WRITE`。
- 预期终态数量（spec §6）：审批策略 56、MAKER 表 55 + 豁免 1、S9 表 = 路由表 46、审计现役 386（名册 19）、科目码 13、演示库科目 105、转账码最大 91。**对不上就停**。
- 改 schema 一律新迁移、无 backfill，改完 = `stack.sh reset self`。
- 每个任务 prompt 带项目总纲 `CLAUDE.md` §0–§5 要点；执行档 `sonnet`，评审档 `opus`；**T1 / T2 / T5 / T7 / T9 动钱动状态机动对账引擎，任务级评审升 `opus`**；终审 `opus`。
- 证据目录 `doc-final/superpowers/checkups/2026-11-07-campaign-e-wave2-evidence/`；e2e 对照协议照波一（冷缓存 `--cacheDirectory=<新目录>`，比失败名集合）。
- 闸门：每任务随手闸 ①②③ + 相关 jest；T1 起每次改种子或分录后 `reset self` → `verify:coa`；T12 收尾闸 ⑥⑦⑧。
- commit message 不加署名行；每任务一个提交（T1 两个：常量与开户分开）。

## Review Focus

1. **手续费户里有非收入的钱时整扫**（没收贷 212 落手续费户、`F_OPS → F_FEE` 调过一笔）：90 必须封顶在 Σ(210..212)、不被 TB 拒 → T5 e2e「封顶」用例。
2. **钱包挂着待批提现锁定时认损**：提交与批准各拒一次、指路文案 → T7 用例「pending lock」；提交后、批准前新挂一笔锁定 → 批准时 `RECOGNITION_FAILED` 且行锁解开 → T7 用例「lock after submit」。
3. **无锚调账单仍自愈、有锚金额更正按组配对**：`recon-adjustment-money-arcs` 11 例一例不红；场景 16 认损后原「金额不对」行 MATCHED → T9。
4. **码 2 流水不混进钱包流水**：`getWalletStatement` 与 `account-flows?walletRef=` 对认损后的钱包不含码 2 行 → T1 投影器用例。
5. **按案件业务日重对账看得见 91**：91 的 `effectiveDate` = 案件业务日，事后记账经 `effectiveCutoffFilter` 第三支可见 → T7 e2e 断言「按 businessDate 重跑后案愈」。

---

### Task 0: 对照组采样（改前基线）

**Files:**
- Create: `doc-final/superpowers/checkups/2026-11-07-campaign-e-wave2-evidence/README.md`、`e2e-baseline-<base sha>.md`、`client-snapshot-before.json`、`counts-before.md`

**Interfaces:** 产出三份基线供 T12 对照：e2e 冷缓存失败名集合；`client:snapshot` 改前（demo:all 后、recon:demo 前）；计数（审批 55 / MAKER 54+1 / 审计 378 / 科目 87 / 转账码 87）。

- [ ] **Step 1**: 在隔离 worktree 的基点（`git merge-base main HEAD`）上 `reset self` → `demo:all` → `client:snapshot -- --out client-snapshot-before.json`
- [ ] **Step 2**: 同树 `on-stack.sh self test:e2e --runInBand --cacheDirectory=<新目录>`，失败名逐条抄进 `e2e-baseline-<sha>.md`（预期 = 波一基线 20 名 ∪ 已登记连带）
- [ ] **Step 3**: 用 spec §1 末尾两条 node 一行命令取审批 / 审计计数，`verify:coa` 取科目数，写 `counts-before.md`
- [ ] **Step 4**: Commit `chore(戊波二): 对照组采样——e2e 基线、客户侧快照、计数`

### Task 1: 科目码 2 / 51、开户、投影、天平

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts:11-28, 46-58, 83-95, 110, 154-160`；`tb-account-codes.constant.spec.ts:23-37, 67-69, 82, 151, 169-177`
- Modify: `src/modules/accounting/tigerbeetle/wallet-cash-account.service.ts:36`（CUSTOMER 钱包开 1 + 2）；`prisma/seed-tb.helper.ts:92`（同款）
- Create: `src/modules/asset-treasury/lp-desk/lp-receivable-account.service.ts`（`ensureForLp(lpId, tx?)`：每 ledger 一户，`ownerType 'LP'`、`ownerUuid lpId`、`ownerNo lpNo`、`description 'Due from LP · <name>'`）+ spec
- Modify: `src/modules/asset-treasury/lp-desk/lp-profile-workflow.service.ts:170, 181`（两条 →ACTIVE 边后调 `ensureForLp`）；`prisma/seed.business.ts`（Falcon / Dune 开 51）
- Modify: `src/modules/accounting/tigerbeetle/projector/account-flow-projector.service.ts:150-153`（`ownerType === 'WALLET' && isCashCode(code)`）+ spec
- Modify: `src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts:678-692`、`scripts/verify-realtime-coa.ts:33-39`、`verify:coa` 脚本（天平加 2、51）
- Modify: `src/modules/accounting/tigerbeetle/types/accounting.types.ts:4`（ownerType 联合已含 LP，确认不动）

**Interfaces:**
- Produces: `TB_ACCOUNT_CODES.CLIENT_SHORTFALL = 2`、`LP_RECEIVABLE = 51`；`LpReceivableAccountService.ensureForLp(lpId: string, tx?): Promise<void>`；`isDebitNormalCode(2) === true`、`isCashCode(2) === false`。

- [ ] **Step 1**: 写红测试：`tb-account-codes.constant.spec.ts` 整表 `toEqual` 13 码、借方户集 `[1, 2, 50, 51, 300, 301, 302]`、现金类仍 `[1, 50]`、`cashAccountCodeFor('LP')` 仍抛；`wallet-cash-account.service.spec.ts` CUSTOMER 钱包开两户（码 1、2，同 ledger、同 ownerUuid）、PLATFORM 只开一户；`lp-receivable-account.service.spec.ts` 开 AED + USDT 两户、已存在直接返回；`account-flow-projector.service.spec.ts` 码 2 户的流水 `walletRef` 为 null
- [ ] **Step 2**: 跑以上四支，确认红
- [ ] **Step 3**: 实现常量、开户、投影判据、天平三处
- [ ] **Step 4**: 跑四支绿；`npx tsc --noEmit -p tsconfig.json` 零输出
- [ ] **Step 5**: Commit `feat(戊波二): 科目码 2 / 51、类别函数、码 2 流水不打 walletRef`
- [ ] **Step 6**: 种子：Falcon / Dune 开 51；`stack.sh reset self` → `verify:coa` ALL PASS、科目数 = 87 + 14 + 4 = 105 → `demo:all` 35/35 → `verify:coa` 再过
- [ ] **Step 7**: 失效验证：往某客户码 2 户记一笔无对手借方，`verify:coa` 客户本恒等式必红；还原
- [ ] **Step 8**: Commit `feat(戊波二): 客户钱包开短缺待补户、LP 开应收户、天平加 2 / 51`

### Task 2: 转账码 88–91 常量 + 应收 LP 接线

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts`（加 88–91；83 / 85 注释改写）
- Modify: `src/modules/asset-treasury/lp-desk/lp-exchange-workflow.service.ts:274-277`（84 后加 88）、`:446-460`（85 贷方改 51）；`lp-exchange-workflow.service.spec.ts:328-383`
- Modify: `prisma/seed.business.ts:2802-2821`（LP 历史兑换单三腿 → 四腿：84、88、85（贷 51）、86）
- Modify: `src/modules/accounting/tigerbeetle/tb-account-registry.service.ts:135`（ownerType LP 的 `ownerName` = LP 名称）
- Create: `test/lp-receivable.e2e-spec.ts`（夹具 prisma 直造 ACTIVE LP + 打款地址 + `ensureForLp`）

**Interfaces:**
- Produces: `TB_TRANSFER_CODES.LP_EXCHANGE_RECEIVABLE = 88`、`HOUSE_TRANSFER = 89`、`FEE_INCOME_CLOSE = 90`、`CLIENT_SHORTFALL_RECOGNIZED = 91`（后三个本任务只定常量，T5 / T7 用）；`GET /admin/tb/accounts?ownerType=LP&code=51` 返回 `ownerName`。

- [ ] **Step 1**: 红测试：单测断言批准后两笔（84 借 200 贷 50·sellFrom；88 借 51·lp 贷 200 买入币）、交货 85 贷 51；e2e：批准后 51·Falcon USDT = 13,600、200 USDT +13,600、200 AED −50,000；交货后 51 = 0、F_LIQ +13,600；验收后 F_OPS USDT +13,600；端点返回 LP 行
- [ ] **Step 2**: 跑红
- [ ] **Step 3**: 实现；种子四腿
- [ ] **Step 4**: 单测 + e2e 绿；`reset self` → `verify:coa` 过（种子期末 51 = 0）→ `demo:all` 过
- [ ] **Step 5**: Commit `feat(戊波二): 转账码 88–91，LP 兑换挂应收、交货消应收`

### Task 3: 共用件——钱包守卫、余额闸、NLA 门种类

**Files:**
- Create: `src/modules/funds-layer/domain/firm-wallet-picker.service.ts`（`assertEligible(walletId, assetId, tx?)`：PLATFORM、network = 资产网络、`vaultCode ∈ ['F_OPS','F_FEE']`，否则 400 `FROM_WALLET_NOT_ELIGIBLE`）+ spec
- Modify: `src/modules/accounting/tigerbeetle/accounting.service.ts`（加 `assertWalletBalance(walletId, ledger, amountMinor)`：现金户 `debitsPosted − creditsPosted − creditsPending ≥ amount`，否则 400 `INSUFFICIENT_FIRM_BALANCE`）+ spec
- Modify: `src/modules/asset-treasury/internal-transfers/internal-transfer.service.ts:77-94`、`company-funding/vendor-payment.service.ts:99-118`（两份 `assertFirmOpsBalance` 删，改调共用闸）
- Modify: `src/modules/asset-treasury/prudential/prudential.service.ts:22, 43-47`（`PrudentialOrderKind` 加 `'HOUSE_TRANSFER'`；对手方分支：无外部对手方时子主体写 to 钱包）

**Interfaces:**
- Produces: `FirmWalletPickerService.assertEligible(walletId: string, assetId: string): Promise<Wallet>`；`AccountingService.assertWalletBalance(walletId: string, ledger: number, amountMinor: bigint): Promise<void>`。

- [ ] **Step 1**: 红测试：picker 四条（F_OPS 过、F_FEE 过、F_SET 拒、客户钱包拒）；余额闸两条（够 / 不够含挂起贷方）；划转单与付款单既有 spec 改为 spy 共用闸
- [ ] **Step 2**: 跑红 → 实现 → 绿；tsc 零输出
- [ ] **Step 3**: Commit `refactor(戊波二): 公司侧 from 钱包守卫与余额闸收成一份`

### Task 4: 付款单 from 可选

**Files:**
- Modify: `src/modules/asset-treasury/company-funding/dto/vendor-payment.dto.ts:41-50`（加 `fromWalletId` 必填）；`vendor-payment-workflow.service.ts:78-121`（`assertEligible` → 余额闸 → from = F_OPS 时才 NLA 门 → `fromWalletId` 入库 → 快照加 `fromWalletNo`）；`vendor-payment-workflow.service.spec.ts`
- Modify: `admin-web/src/pages/VendorPaymentList.tsx:49-172`（币种下拉后加 from 下拉：`GET /admin/tb/accounts?ownerType=WALLET&code=50&assetCurrency=<ccy>` 过滤 `walletRole ∈ {F_OPS, F_FEE}`，默认 F_OPS，显示余额）；`VendorPaymentDetail.tsx`（显示 from 钱包号）
- Create: `test/vendor-payment-from-wallet.e2e-spec.ts`

- [ ] **Step 1**: 红测试：单测 from = F_FEE 时不调 `assertPostOutflowCompliant`（spy）、from = F_SET 400；e2e：from = F_FEE 付款落账 87 贷手续费户现金、无 90；from = F_OPS 时 NLA 门被调用（spy）
- [ ] **Step 2**: 跑红 → 实现后端 → 绿
- [ ] **Step 3**: 前端表单；`preview` 起 admin 走查建单弹层，截图 `t4-vendor-payment-from.png`
- [ ] **Step 4**: Commit `feat(戊波二): 付款单 from 钱包可选（运营户 / 手续费户）`

### Task 5: 公司调拨单——后端

**Files:**
- Modify: `prisma/schema.prisma`（`model HouseTransfer @@map("house_transfers")` 字段照 spec §4.2；`FundsOrder.houseTransferId String?` + 关系，照 `:1103, 1137` 的 `internalTransferId` 同款）；Create: `prisma/migrations/<ts>_campaign_e_house_transfers/migration.sql`
- Create: `src/modules/asset-treasury/company-funding/house-transfer.service.ts`（建单、迁移表强制、列表 / 详情投影、`transferNo = generateReferenceNo('HTR')`）、`house-transfer-workflow.service.ts`（initiate / submitForApproval / onDecided / createLeg / onLegConfirmed / cancel / 审计信封）、`house-transfer-approval.service.ts`、`house-transfer.controller.ts`、`dto/house-transfer.dto.ts`、`constants/house-transfer-transitions.constant.ts`（六态六边抄划转单）+ 各 spec
- Modify: `company-funding.module.ts`；`src/modules/funds-orders/funds-order.service.ts:27-72`（`parentOf / directionOf / fks / create` 四处加 `houseTransferId`，方向 `INTERNAL`）；`src/modules/clearing-settle/reconciliation/disposition/push-order.service.ts`（`loadPushable` 对 `houseTransferId` 显式拒，照 2026-09-21 甲案）
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`（类型、策略行、V1 白名单）；`scripts/verify-rbac.ts:254-340`（`HOUSE_TRANSFER_APPROVAL: 'FUNDING_WRITE'`）；`scripts/verify-rbac.tables.ts:6`（S9：`FUNDING_READ`）；`admin-web/src/pages/approvalEntityRoutes.ts`（`/admin/house-transfers/${r}`）；`admin-web/src/pages/ApprovalPoliciesPage.tsx:37`（标签 `'House transfer'`）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（`AuditEntityTypes.HOUSE_TRANSFER`、`AuditBusinessWorkflowTypes.HOUSE_TRANSFER`、平面枚举 7 码、名册 `CAMPAIGN_E_HOUSE_TRANSFER_AUDIT_ACTIONS` 四属性照 V7 同名码）；`audit-vocabulary-closure.spec.ts:52-71`（名册 19）；Create: `house-transfer-audit-codes.spec.ts`（键集恰 7 + 逐码四属性）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（四条 `route()`：POST 建单 / POST cancel → `FUNDING_WRITE`；GET 列表 / 详情 → `FUNDING_READ`；动作桶 `treasury.view_house_transfers` / `treasury.act_house_transfers`）
- Modify: 模拟托管方在腿提交时写两侧外部行——照划转腿先例（builder 以 `rg "externalStatementLine" src/modules/funds-layer src/modules/funds-orders` 找到写回单处，给 `houseTransferId` 腿同款）
- Create: `test/house-transfer.e2e-spec.ts`

**Interfaces:**
- Produces: `POST /admin/house-transfers {purpose, assetId, amount, fromWalletId, toWalletId, reason}` → `{transferNo, approvalNo}`；`GET /admin/house-transfers`、`GET /admin/house-transfers/:transferNo`（投影含 `fromWalletNo / toWalletNo / status / approvalNo / fundsOrderNo / closeTbTransferIds / failureReasonCode`）；`POST /admin/house-transfers/:transferNo/cancel {reason}`。
- 落账：腿确认 → 89 借 50·to / 贷 50·from；仅 from.vaultCode = F_FEE 且 to.vaultCode = F_OPS → 90 ×（1～3 笔）借 210/211/212 贷 200，总额 = min(amount, Σ210..212)，eventCode 各异；TB 拒 → 审计 `HOUSE_TRANSFER_FAILED(POSTING_FAILED)`、单停 EXECUTING。

- [ ] **Step 1**: 迁移 + `prisma generate`；`reset self` 能建库
- [ ] **Step 2**: 红测试（单测）：迁移表六边 + 非法跃迁拒；建单守卫（from = to 拒、F_SET 拒、余额不够拒、from = F_OPS 调 NLA 门 / from = F_FEE 不调）；`onDecided` 批准 → EXECUTING + 腿建；腿确认 → 89；F_FEE → F_OPS 加 90 且封顶与顺序（三条：收入够 / 只扣到 211 / 封顶）；审计七码各一处写点；审批快照字段
- [ ] **Step 3**: 跑红 → 实现 → 绿；`audit-vocabulary-closure.spec`、`house-transfer-audit-codes.spec` 绿；`approvalEntityRoutes.spec` 键集相等
- [ ] **Step 4**: e2e：① 手续费户先铺一笔没收（贷 212）→ 整扫 → CFO 批 → ⚡ 腿 → 89 + 三笔 90、210/211/212 归零、200 增 Σ收入、`verify:coa` 过；② 扫一半只扣 210 → 211；③ 先 F_OPS → F_FEE 调一笔再整扫，结转封顶、90 不被拒；④ F_OPS → F_FEE 不结转且 NLA 门被调（spy）；⑤ CFO 拒 → REJECTED、撤回 → CANCELLED
- [ ] **Step 5**: `db:base:sync` + 重启后 `verify:rbac` 全绿，记 S 系列前后数；`npm run verify:rbac` 的 S8 恒等 56 = 55 + 1
- [ ] **Step 6**: Commit `feat(戊波二): 公司调拨单——主体、审批、审计、腿与扫费结转`

### Task 6: 公司调拨单——管理台

**Files:**
- Modify: `admin-web/src/rbac/permissions.ts`（`HOUSE_TRANSFERS_READ / HOUSE_TRANSFER_DETAIL_READ / HOUSE_TRANSFER_WRITE / HOUSE_TRANSFER_CANCEL`）
- Create: `admin-web/src/pages/HouseTransferList.tsx`（列表 + `InitiateHouseTransferModal`：用途下拉只 Fee sweep、币种、from / to 下拉（同 T4 的数据源，过滤 F_OPS / F_FEE，带余额）、金额默认 = from 余额可改小、理由）、`HouseTransferDetail.tsx`（路线、状态、审批号、腿、分录两行 89 / 90、撤回）、`utils/houseTransferStatusMap.ts`
- Modify: `admin-web/src/App.tsx:268-273` 附近（两条路由，照 vendor-payments）；`components/DashboardLayout.tsx:313` 附近（Treasury 组加「House Transfers」）

- [ ] **Step 1**: `cd admin-web && npx tsc -b --noEmit` 零输出
- [ ] **Step 2**: `preview` 起 admin，金库号登录：建单弹层（默认整扫）→ 列表 → 详情；CFO 号批；金库 ⚡ 推腿；详情看 89 / 90 两行；截图 `t6-house-transfer-{create,list,detail}.png`
- [ ] **Step 3**: Commit `feat(戊波二): 公司调拨单两页 + 建单弹层`

### Task 7: 认损补缺一张单——后端

**Files:**
- Modify: `prisma/schema.prisma:888-921`（`InternalTransfer` 加 `explainedFlowId? / explainedExternalLineId? / recognizedTbTransferId? / recognizedAt? / effectiveDate / lossSource / sourceIncidentNo?`，删 `sourceAdjustmentNo` 与其索引）；`:1810-1836`（`ReconciliationDisposition` 加 `transferNo?`）；Create 迁移
- Modify: `src/modules/asset-treasury/internal-transfers/dto/internal-transfer.dto.ts:15`（`['SHORTFALL_TOPUP','CLIENT_ADVANCE']`；加 `InitiateShortfallTopupDto {caseNo, flowId?, externalLineId?, fromWalletId, reason}`；删 `InitiateCompensationDto`）
- Modify: `internal-transfer-workflow.service.ts`（删 `initiateCompensation:56-79`；加 `initiateShortfallTopup`：解析案与锚 → 账龄路 / 事故路守卫（搬自 `adjustment.service.ts:177-211 / :247-276`）→ 阻塞（含带 `recognizedTbTransferId` 的 FAILED）→ `FirmWalletPicker.assertEligible` → 余额闸 → 客户钱包「posted − 挂起贷方 ≥ 短缺额」→ 建单 `effectiveDate = kase.businessDate` → 处置记录挂 `transferNo` + 行锁 → 提审；`onDecided:152` 批准分支：复查两闸 → 码 91（借 2 / 贷 1，`effectiveDate`，eventCode `INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED`）→ 审计 → EXECUTING + 腿 1；失败 → FAILED(`RECOGNITION_FAILED`) + 解锁；`resolveRoute:108-112` from 改读 `row.fromWalletId`（ADVANCE 路建单时仍写 F_OPS）；`postFinalLeg:313-319` 按用途：SHORTFALL_TOPUP → 贷 2·客户钱包、eventCode `INTERNAL_TRANSFER_SHORTFALL_TOPUP_IN`；ADVANCE 原样；`onRejected / cancel / 超时` 解开行锁）
- Modify: `internal-transfer.controller.ts:30-35`（`/compensation` → `/shortfall-topup`）；`rbac.catalog.ts:512`（路由改名，组不变）；`admin-web/src/rbac/permissions.ts:89`（常量改名 `INTERNAL_TRANSFER_SHORTFALL_TOPUP_WRITE`）
- Modify: `src/modules/clearing-settle/reconciliation/disposition/disposition.service.ts:160-170, 209-213`（挂 / 解 `transferNo`，同 `adjustmentNo`）；`funding-next-step.ts:16-24`（删 `COMPENSATION` 分支；`transfer` 回链保留）；`reconciliation-query.service.ts:765-780, 795-813`（客户池 WRITE_OFF → `nextStep.kind 'SHORTFALL_TOPUP'`，带 `amount / effectiveDate / lossSource`；`:815-829` 补款推导删）；`adjustment-rules.ts:72`（`UNEXPLAINED_CLIENT_LOSS` 出 `REASON_SPECS`，留作 `CLIENT_SHORTFALL_CAUSE` 常量）；`adjustment.service.ts:91/177-211/220/247-276/307/553`（客户池认损路径删，公司池保留）；`cause-registry.ts:206-209`（客户池分支产出新 kind）
- Modify: `src/modules/governance/incidents/incident.service.ts:489-527`（Remediation 挂 `TRANSFER` 即满足善后）；`src/modules/asset-treasury/treasury/customer-statement.service.ts:181-185`（删 `INTERNAL_TRANSFER_COMPENSATION_IN`）+ spec `:178-194`
- Modify: `audit-actions.constant.ts:1159-1167`（V7 加 `INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED`：INHERIT、`['amount','effectiveDate']`、要因果）；`internal-transfer-audit-codes.spec.ts:10-13`（8 码）
- Modify: `test/recon-internal-transfer.e2e-spec.ts:507-553, 557, 684, 698, 737`、`test/incident-register.e2e-spec.ts:536`、`test/recon-aging-write-off.e2e-spec.ts:523`

**Interfaces:**
- Produces: `POST /admin/internal-transfers/shortfall-topup` → `{transferNo, approvalNo}`；`nextStep: { kind: 'SHORTFALL_TOPUP'; amount; effectiveDate; lossSource; customerNo; walletNo }`；`ReconciliationDisposition.transferNo`；T9 的第 0 轮要读 `InternalTransfer.recognizedTbTransferId` 与两个锚。

- [ ] **Step 1**: 迁移 + generate；`reset self` 能建库
- [ ] **Step 2**: 红测试（单测 `internal-transfer-workflow.service.spec.ts`）：账龄路开单成功、事故路金额锁定、挂起锁定不够 400 指路、FAILED-with-recognition 阻塞、批准记 91 + 审计 + EXECUTING、记 91 失败 → FAILED(`RECOGNITION_FAILED`) + 解锁、最后一腿 83 贷 2、ADVANCE 路 83 仍贷 100；`funding-next-step.spec` 删 COMPENSATION；`customer-statement.service.spec` 认损补缺零行
- [ ] **Step 3**: 跑红 → 实现 → 绿；tsc 零输出；`internal-transfer-audit-codes.spec` 8 码绿；路由改名后 `db:base:sync` + 重启后端（只 seed 不重启 = 403）
- [ ] **Step 4**: e2e 改写：A（账龄路全弧：开单即挂 → 批 → 91 / 生效日 = 案件业务日 / 应付不动 → 按 businessDate 重对账案愈〔T9 前先只断言到 91 落账与余额，案愈断言在 T9 解锁〕→ ⚡ 腿 → 83 贷 2 → 短缺 0）；C1（客户池 INCREASE 仍指路补录）；C2（腿失败 → FAILED、入口不回、短缺不归零）；P2（法币两腿）；incident-register 5（事故路：定损 → 开单金额锁定 → 批 → 腿 → 挂 TRANSFER → 结案）；aging 反例③（客户池超期拿公司池码 400 / 认损补缺建单放行）；新增「pending lock」「lock after submit」两条
- [ ] **Step 5**: Commit `feat(戊波二): 认损补缺一张单——记短缺、腿补缺、补款旧路退役`

### Task 8: 认损补缺——管理台与事故页

**Files:**
- Modify: `admin-web/src/components/reconciliation/CaseFlowTable.tsx:159-171, 319-325, 388-399`（菜单项「Recognize loss & top up」；Status 标签三态 + 失败态；删「Initiate compensation」）；`components/InternalTransferInitiateModal.tsx`（补款分支改为认损补缺弹层：成因只读、金额锁定、生效日只读、from 下拉、理由；垫款分支原样）；`pages/ReconciliationCasesDetailPage.tsx:159, 370-410, 601, 738-742`；`utils/reconTypes.ts:89-93`
- Modify: `admin-web/src/pages/IncidentDetailPage.tsx:328-332, 650`（入口改跳案件页并自动开认损补缺弹层，`lossSource=INCIDENT`）；`utils/internalTransferStatusMap.ts`（用途标签）

- [ ] **Step 1**: admin tsc 零输出
- [ ] **Step 2**: `preview` 走查：`recon:demo:break` → Alice USDT 案 → Hold → ⚡ 拨钟 → 「Recognize loss & top up」弹层（from 默认运营户）→ 提交后行标签「Pending CFO · ITR…」→ CFO 批 → 「Shortfall recognised · topping up」→ ⚡ 腿 → Re-reconcile；事故页入口；截图 `t8-shortfall-{menu,modal,pending,topping,explained}.png`、`t8-incident-entry.png`
- [ ] **Step 3**: Commit `feat(戊波二): 案件页认损补缺入口、标签、事故页入口`

### Task 9: 对账引擎——解析器合一、对内差额、第 0 轮

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/engine/v2/wallet-balance-checker.service.ts:69-130`（删自查注册表 `resolveCashAccount`，改 `AccountingService.resolveCashAccountId(walletRef, ledgerForNetwork(network))`；客户钱包同时算 2 / 100 / 101 在截止点的 posted 流水和 → `internalDelta`，公司钱包 null）+ spec
- Modify: `prisma/schema.prisma:2088-2112, 1681-1735`（`ReconciliationRunWallet.internalDeltaAmount Decimal?`、`ReconciliationCase.internalDeltaAmount Decimal?`）；迁移
- Modify: `engine/v2/bucket-classifier.ts:17-23`（第 0 条 `internalDelta ≠ 0 → BREAK`）+ spec；`workflow/wallet-recon-run.service.ts:318-463, 776-869, 871-959`（快照与案件落 internalDelta；`INVARIANT` 差异行；`:392-398` 抑制逻辑删；`:878-887` 改写 Pass 0 MATCHED 行 `resolution = byNo`）
- Modify: `engine/v2/wallet-flow-matcher.service.ts:55-72, 158-176, 198-277`（输入加 `explainedAnchors`；取数条件收窄为「非（调账流水 ∧ 两锚皆空）」；Pass 0 照 spec §4.5）+ spec；`disposition/explained-difference.service.ts:67-84`（改供 anchors：POSTED 调账单的落账流水 + 已记短缺的认损补缺单的 91 流水；改记两侧钱包都认）
- Modify: `domain/flow-comparison.builder.ts:96-101, 146, 191, 208, 237`（过滤收窄；`explainedBy` 改读 `resolution` 与处置记录 `adjustmentNo / transferNo`）；`dto/reconciliation.dto.ts:160-173`（MATCHED 行允许 `explainedBy`）
- Modify: `scripts/recon-demo.ts:457-463`（模拟对账单取数加排除 eventCode `INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED`；文件头 ⑯ 注释）
- Create: `test/recon-internal-delta.e2e-spec.ts`

**Interfaces:**
- Consumes: T7 的 `InternalTransfer.recognizedTbTransferId / explainedFlowId / explainedExternalLineId`。
- Produces: `MatcherInput.explainedAnchors: Array<{ flowId; anchorFlowId?; anchorExternalLineId?; byNo }>`；`ReconciliationRunWallet.internalDeltaAmount`、`ReconciliationCase.internalDeltaAmount`；差异行 `matchStatus 'INVARIANT'`。

- [ ] **Step 1**: 迁移 + generate
- [ ] **Step 2**: 红测试：checker spec（客户钱包四户求和、公司钱包 null、未开户抛同码）；classifier spec（第 0 条）；matcher spec（Pass 0 三形态：锚外部行相等 → MATCHED、锚外部行不等 → AMOUNT_MISMATCH、锚内部行净 0 → 消化、净 ≠ 0 → 合成行进 Pass 1；无锚调账流水不进输入）；explained-difference spec（认损补缺单也供锚）
- [ ] **Step 3**: 跑红 → 实现 → 绿
- [ ] **Step 4**: e2e：`recon-internal-delta`（同本跨客户造不平 → A、B 两案 INVARIANT + Δ；反向 → 自愈）；`recon-reattribution:442` 不改断言跑绿；`recon-adjustment-money-arcs` 11 例绿；T7 留下的「按 businessDate 重对账案愈、原行 MATCHED / resolution = ITR」断言补进 A 并跑绿
- [ ] **Step 5**: `reset self` → `demo:all` → `recon:demo:pass` 21 钱包 0 案 → `recon:demo:break` 18/18、12/12、12/12 → `verify:coa` 过
- [ ] **Step 6**: Commit `feat(戊波二): 对账读现金户经单一解析器、对内差额进跑批与案件、匹配器第 0 轮锚配对`

### Task 10: 读面汇总与截图

**Files:**
- Modify: `admin-web/src/components/reconciliation/CaseBalanceTiles.tsx`（客户案 Internal 格下副行 `Cash + Shortfall ｜ Payable + Held ｜ Δ`，Δ ≠ 0 红）；`CaseFlowTable.tsx`（`INVARIANT` 行：无菜单、标签「Books out of balance · needs correction」）；跑批详情页钱包表加列「Internal check」；`CompanyFundsDashboard.tsx:524` 附近加格「Due from LP — Pending Delivery」（`GET /admin/tb/accounts?ownerType=LP&code=51&take=100`，每行 LP 名 × 币种 × 余额，空文案 `No LP delivery outstanding.`）
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts:379-481`（`explain` 加四户与 Δ）

- [ ] **Step 1**: tsc 零输出
- [ ] **Step 2**: `preview` 走查并截图：`t10-case-customer-balance-row.png`（副行）、`t10-case-invariant-row.png`（用 T9 e2e 的造数法在 self 栈造一次）、`t10-run-detail-internal-check.png`、`t10-dashboard-due-from-lp.png`（LP 兑换批后 / 交货后两张）、`t10-ledger-accounts-owner-lp.png`、`t10-transfer-evidence-88-91.png`（凭证页四码）
- [ ] **Step 3**: Commit `feat(戊波二): 案件页副行与 INVARIANT 行、跑批页对内列、看板应收 LP 格`

### Task 11: 种子 / 剧本 / 基线 / 文档事实句

**Files:**
- Modify: `doc-final/demo/script.md:230, 232, 565-612, 618-659`（场景 16、18、31、32 按 spec §7；第 31 场先拒 #18；删 `:597` 剧本纪律；第 26 场加一句；公司的钱那幕末新增场景 41 扫费）；`doc-final/demo/data.md:350`；`doc-final/demo/baseline.md:432, 484, 534-545`
- Modify: `doc-final/modules/v7-treasury.md §2`、`company-funds.md §2`、`lp-desk.md §2.3`、`v8-recon.md §1/§5`、`accounting-coa.md §2`（只改事实句）
- Modify: `doc-final/BACKLOG.md:188`（销账）；`doc-final/PRODUCTION-NOTES.md`（追加三行：对内不平无业务修法；短缺窗口内客户提现 TB 拒锁沿用既有报错；91 已落腿失败不重补）；`doc-final/TOOLING-DEBT.md`（LP e2e 夹具绕私库种子一行）

- [ ] **Step 1**: 按 spec §7 逐条改；`data.md` 生成区由 `demo:all` 重生后 `git diff` 只剩手改句
- [ ] **Step 2**: 剧本场景 16 / 31 / 41 在 self 栈按新剧本各走一遍（账号切换按剧本），截图入证据目录 `t11-scene-{16,31,41}-*.png`
- [ ] **Step 3**: Commit `docs(戊波二): 剧本 16 / 18 / 26 / 31 / 32 / 41、data / baseline 数字、模块事实句、BACKLOG 销账`

### Task 12: 收尾闸、证据、承接、终审

**Files:**
- Create / Modify: `doc-final/superpowers/checkups/2026-11-07-campaign-e-wave2-evidence/README.md`（闸表、计数终态表、e2e 对照、截图清单）、`evidence-by-transfer-code.md`（88–91 新四码 + 83 两形态 + 85 新贷方，照波一 `a4-table.js` 取 TB 实记）、`client-snapshot-after.json` + diff（预期差异：场景 16 客户 Alice 少两行，其余逐字同）
- Modify: `doc-final/superpowers/specs/2026-11-06-campaign-e-wave3-skeleton.md`「承接波二」；`doc-final/CHANGELOG.md` 一行

- [ ] **Step 1**: 随手闸 ①②③ 零输出；全量 jest（仓库根，不接管道）全绿
- [ ] **Step 2**: `reset self` → `demo:all` 35/35、5/5 → `client:snapshot` → `verify:coa`（105 户全 ≥ 0）→ `recon:demo:pass` → `recon:demo:break` 18/18 → `verify:coa`
- [ ] **Step 3**: 全量 e2e 冷缓存串行，失败名集合 ⊆ T0 基线 ∪ 已登记连带；多出的名字干净重铺单跑必须绿
- [ ] **Step 4**: 计数终态逐项实跑（审批 56 / MAKER 55+1 / S9 46 / 审计 386 / 科目码 13 / 科目 105 / 转账码 91 / `HTR` 恰 1 处 / 码 2 流水 walletRef 全空）
- [ ] **Step 5**: 承接波二写进波三骨架（合并基线、实际交付含订正、偏差、悬挂项、对波三的前提）；CHANGELOG 一行
- [ ] **Step 6**: Commit `docs(戊波二): 收尾证据、承接波三、CHANGELOG`
- [ ] **Step 7**: 终审（`opus`）：逐条问 spec §0 / §0.1 每条裁定的代码在哪；Review Focus 五条各指到测试；退役四件套 grep 清点（`CLIENT_COMPENSATION`、`/compensation`、`COMPENSATION` nextStep、`UNEXPLAINED_CLIENT_LOSS` 在 `REASON_SPECS`、`sourceAdjustmentNo`、读端 `resolveCashAccount`、两份 `assertFirmOpsBalance`）；修复轮 1–3 `sonnet`、4–5 `opus`

---

**依赖**：T0 → T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11 → T12（SDD 串行；T4 与 T5–T6 互不依赖但同树不并行）。T7 的「重对账案愈」断言在 T9 才能绿，T7 只断言到 91 落账与余额（Step 4 已注明）。
