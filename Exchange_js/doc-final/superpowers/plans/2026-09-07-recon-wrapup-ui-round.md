# 平账收尾 · 界面收口轮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按已拍板 spec 落地平账收尾轮：调账单独立菜单、Run/Case 详情页重排、Demo Compare 退役、全站英文化（含后端显示串）、客户端 Transaction History 页重做。

**Architecture:** 全部是读面 / 文案 / 展示层工作——零新表、零新审计码、零新状态边、零记账变更。改名 `SOFT_FLAG→COMPENSATING` 与 `reasonCustomer` 模板落库值靠合并后 reset 重铺收口。词表先行（后端显示串 → 页面重排消费 → 批量转英收尾），避免同一串改两遍。

**Tech Stack:** NestJS + Prisma(SQLite) 后端 ｜ React + Tailwind（adm-* / fx-* 令牌）双前端 ｜ jest / vitest ｜ 设计稿：https://claude.ai/code/artifact/6eca8c74-0b66-4b43-b210-c9e15a8c606e

**Spec:** `doc-final/superpowers/specs/2026-09-07-recon-wrapup-ui-round-design.md`（含 §10 交付清单触发对照，本 plan 逐任务落）

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用；命中/不触发行已在 spec §10 写死，任务不得现场再判
- 本轮特有：**无 i18n**（中文原地改英文字面量，注释不动）｜ **无 schema 迁移**（bucket 是 String 列，spec §2.2 钉死；`schema.prisma:1496/:1693` 注释里 SOFT_FLAG 字样同步改词）｜ 英文串消费共享词表（见下）不得各任务自造 ｜ 每个前端任务收尾必须 preview 截图（永不豁免①）｜ 派发模型：执行与任务级评审 `sonnet`，终审主会话
- 每次改完代码跑随手闸（CLAUDE.md §7 ①-⑤）；jest 在 **Exchange_js 根下**跑、不接管道尾（判例：`| tail` 吞退出码）
- **scripts 圈定结论（plan 阶段已做，spec §5③，执行者不必重查）**：`grep -rnP '[\x{4e00}-\x{9fff}]' scripts --include='*.ts' | grep -iE "assert|expect|===|!=="` 实证 scripts 断言全部比对**枚举值**非 UI 文案（唯 `SOFT_FLAG` 字样随 Task 1 改名连带）；check() 的中文标签是控制台叙事、不属"页面"，**保留不转**

### 共享英文词表（所有任务引用此表，不得另造同义词）

| 域 | 中文/码 | 英文 |
|---|---|---|
| 五桶 | MATCHED / IN_TRANSIT / COMPENSATING / BREAK | Matched / In-transit / Compensating / Break |
| 差异行型 | 已匹配/在途/我有外无/外有我无/金额不符 | Matched / In-transit / Internal only / External only / Mismatch |
| 出口族 | 冲正/冲销/补记/改记/挂起/留档/核销/认损/补单/事故/划转 | Correction / Reversal / Record entry / Reattribution / Hold / File only / Write-off / Loss recognition / Supplement / Incident / Transfer |
| 动作 | 处置/开单/去推单/发起补录/认领退汇/认领退回/核销/认损/登记事故/升级事故/登记欠款/发起补款/发起垫款/重新对账/拨到超期 | Record finding / Open adjustment / Push order / Record missed deposit / Claim recall / Claim return / Write off / Recognize loss / Register incident / Escalate to incident / Register shortfall / Initiate compensation / Initiate advance / Re-reconcile / Fast-forward aging |
| 状态徽标 | 已定性/已解释/已推进·待重对账/待 CFO 复核/已转补单/待补款/待登记事故 | Finding: `<cause>` → `<outlet>` / Explained · ADJxxx / Pushed · re-reconcile / Pending CFO review / Transferred · `<no>` / Awaiting compensation / Incident pending |
| 事故态 | 已登记/调查中/已定损/处置中/已结案/已撤回 | Registered / Investigating / Assessed / Resolving / Closed / Withdrawn |
| 客户流水行 | （spec §6 词表整表照抄，含 `Credit from FiatX · balance restoration` / `· advance`）| — |
| 敏感词禁令 | 没收/制裁/上缴涉客户面 | 一律 `Balance adjustment`，禁 confiscate / sanction / surrender（spec §6 tipping-off 节）|

翻译规则：标签 ≤4 词、银行业务用语、不用系统词（movement/snapshot 等）；成因菜单 label 短语、clue 完整句；同一语义三域同词。

---

### Task 1: SOFT_FLAG → COMPENSATING 全仓改名

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/engine/v2/bucket-classifier.ts`（`ReconBucket` 联合类型）
- Modify: `src/modules/clearing-settle/reconciliation/dto/reconciliation.dto.ts`（`ReconWalletBucket` / `ReconCaseQuery`）
- Modify: `prisma/schema.prisma:1496` `:1693`（仅注释里的 `SOFT_FLAG` 字样，列定义不动）
- Modify: `admin-web/src/utils/reconBucketMap.ts`（键与词表：`COMPENSATING: { en: 'Compensating', tone: 'amber' }`，顺带删 `zh` 半边与 `formatBucketBilingual` → 改导出 `formatBucket` 只出英文）
- Modify: 全部引用点（`grep -rn "SOFT_FLAG" src admin-web scripts test` 圈定，含 `recon-demo.ts` manifest 桶名、e2e 断言、`wallet-recon-run.service.ts`）

**Interfaces:**
- Produces: `ReconBucket = 'MATCHED' | 'IN_TRANSIT' | 'COMPENSATING' | 'BREAK'`；前端 `BUCKET_LABELS[bucket].en`、`formatBucket(bucket): string`——Task 6/8/15 消费

**交付清单命中：** 无（纯改名）；不触发 schema 迁移（写死）

- [ ] **Step 1:** `grep -rn "SOFT_FLAG" src admin-web scripts test prisma --include='*.ts' --include='*.tsx' --include='*.prisma'` 全量圈定引用清单，逐处替换为 `COMPENSATING`（词表值 `Compensating`）
- [ ] **Step 2:** 跑受影响测试，先确认改名让旧断言红过（如 recon e2e 断言 `bucket: 'SOFT_FLAG'` 的用例），再全绿：`npx jest --config jest.config.js src/modules/clearing-settle test/recon- 2>&1; echo EXIT=$?`
- [ ] **Step 3:** 复跑圈定命令，期望 0 命中；随手闸 ①②③
- [ ] **Step 4:** Commit `refactor(recon): SOFT_FLAG→COMPENSATING 五桶定名对齐 PRD（BACKLOG 销账）`

### Task 2: 后端显示串转英 · 对账处置族

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/disposition/cause-registry.ts`（20 成因的 `label`/`clue`/`outletLabel`/客户词，58 行）
- Modify: `.../disposition/adjustment-rules.ts`（14 行）、`adjustment.service.ts`（56 行：`reasonInternal`/`reasonCustomer` 模板 + 报错串）、`disposition.service.ts`（20）、`supplement-evidence.service.ts`（17，`describeLine`）、`push-order.service.ts` 与三个 controller 的管理台可见报错
- Modify: 对应 `.spec.ts` 断言期望值（`cause-registry.spec.ts` 55 / `adjustment.service.spec.ts` 154 / `disposition.service.spec.ts` 37 / `supplement-evidence.service.spec.ts` 19 / `adjustment-rules.spec.ts` 30 / `adjustment-approval.service.spec.ts` 14）

**Interfaces:**
- Produces: `menuFor()` / `resolveOutlet()` 下发的 `label/clue/outletLabel` 全英文；`reasonCustomer` 英文模板（Task 10 客户流水直接取用）；出口族词照共享词表

**交付清单命中：** 无新持久化动作；落库值（reasonCustomer）变更靠 reset（闸⑧）

- [ ] **Step 1:** 逐文件转英（注释不动）：成因 `label` ≤4 词短语（例：重复入账双胞胎→`Duplicate posting (twin)`、银行轧差→`Bank fee netted`、银行利息→`Bank interest`、跨账期→`Cross-period timing`、查无果→`Unexplained (exhausted)`、记错客户→`Misattributed customer`、未授权转出→`Unauthorized outflow`）；`clue` 完整句；`reasonCustomer` 模板用客户话术（例：重复入账→`This deposit was recorded twice; the duplicate entry has been reversed.`）
- [ ] **Step 2:** 先跑旧 spec 看红（词表断言必须先红——证明断言真在咬词），再更新期望值到新英文，全绿：`npx jest src/modules/clearing-settle/reconciliation/disposition 2>&1; echo EXIT=$?`
- [ ] **Step 3:** 残留复查：`grep -rnP '[\x{4e00}-\x{9fff}]' src/modules/clearing-settle/reconciliation/disposition --include='*.ts' | grep -v '//' | grep -vE ':\s*\*'` 期望仅剩注释（0 行代码命中）
- [ ] **Step 4:** Commit `i18n(recon-backend): 处置族显示串转英——成因注册表/调账话术模板/候选行描述`

### Task 3: 后端显示串转英 · 事故登记 + 内部划转

**Files:**
- Modify: `src/modules/governance/incidents/incident.service.ts`（32）、`incident-close-workflow.service.ts`（19）、`incidents.controller.ts`（13）
- Modify: `src/modules/asset-treasury/internal-transfers/internal-transfer-workflow.service.ts`（28）、同目录 service/controller 报错串
- Modify: 对应 `.spec.ts` 断言（incident 103+24+22、transfer 40+16）

**Interfaces:**
- Produces: 事故类型/通报依据/结案文案、划转 purpose 文案全英文；Task 8/9/13 消费

**交付清单命中：** 无

- [ ] **Step 1:** 转英（词表：事故态照共享表；通报依据目录三条的展示名转英、依据码 TIR_K_H 等不动）
- [ ] **Step 2:** spec 断言先红后绿：`npx jest src/modules/governance/incidents src/modules/asset-treasury/internal-transfers 2>&1; echo EXIT=$?`
- [ ] **Step 3:** 残留复查同 Task 2 口径；Commit `i18n(governance/treasury-backend): 事故与划转显示串转英`

### Task 4: 调账单列表端点 + RBAC 登记

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/disposition/adjustment.controller.ts`（加 `@Get()`）
- Modify: `src/modules/clearing-settle/reconciliation/disposition/adjustment.service.ts`（加 `listAdjustments`）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts:386` 附近（加列表 route）
- Test: `src/modules/clearing-settle/reconciliation/disposition/adjustment.controller.spec.ts`（或就近既有 spec 文件加用例）

**Interfaces:**
- Produces: `GET /admin/reconciliation/adjustments?status=&from=&to=&skip=&take=` → `{ items: AdjustmentListRow[], total }`；`AdjustmentListRow = { adjustmentNo, caseNo, ownerNo, assetCode, decimals, reasonCode, direction, amount, status, effectiveDate, createdAt }`（Task 5 消费；**无 UUID 字段**）

**交付清单命中：** 新增 admin 端点（route + sync + 重启）｜ 对外识别业务键

- [ ] **Step 1:** 写失败测试：列表按 `createdAt desc` 排、`status` 过滤生效、行含 `decimals`（join asset 表按 `assetCode` 取）、响应不含 `id`/`walletRef`。跑红。
- [ ] **Step 2:** 实现 `listAdjustments`（prisma `reconciliation_adjustments` findMany + count，select 白名单字段 + asset decimals map），controller `@Get()` 挂 query DTO
- [ ] **Step 3:** `rbac.catalog.ts` 加：`route('GET', '/admin/reconciliation/adjustments', 'List Recon Adjustments', ['RECON_CASE_READ'])`（放在 `:adjustmentNo` 那条**之前**）
- [ ] **Step 4:** 跑绿 + 随手闸①；Commit `feat(recon): 调账单列表端点（RECON_CASE_READ 同门）+ RBAC 登记`
- [ ] **Step 5:** 主树验证段记入任务报告：合并后须 `npm run db:base:sync` + 重启（收尾 Task 16 统一做，此处只登记不做）

### Task 5: 调账单列表页 + 路由 + 菜单项

**Files:**
- Create: `admin-web/src/pages/ReconciliationAdjustmentListPage.tsx`
- Modify: `admin-web/src/App.tsx:244-250` 一带（静态 `reconciliation/adjustments` 注册在 `:adjustmentNo` **之前**）
- Modify: `admin-web/src/components/DashboardLayout.tsx:277-299`（Reconciliation 组加第四项）
- Modify: `admin-web/src/rbac/permissions.ts`（加 `RECON_ADJUSTMENT_LIST_READ: 'api.get.admin_reconciliation_adjustments'`）

**Interfaces:**
- Consumes: Task 4 的 `GET /admin/reconciliation/adjustments` 与 `AdjustmentListRow`
- Produces: 路由 `/admin/reconciliation/adjustments`；菜单 label `Adjustments`

**交付清单命中：** 新增业务动作前端入口 ｜ 涉及金额分存元显 ｜ 改前端截图

- [ ] **Step 1:** 建列表页，照 `ReconciliationCasesListPage.tsx` 既有列表法（adminFetch / 表格 grammar / Pagination 共享件）。列序：Adjustment No（amber mono，链详情）｜ Case No（链案件）｜ Customer（ownerNo）｜ Asset ｜ Reason（Task 2 英文词表 `REASON_LABEL`）｜ Dir（REDUCE/INCREASE 徽标）｜ Amount（右对齐，`formatAmount(amount, decimals)` 分→元）｜ Status（StatusPill）｜ Effective Date。状态过滤下拉（All/Draft/Pending approval/Posted/Rejected）
- [ ] **Step 2:** App.tsx 路由 + 侧栏项 `{ path: '/admin/reconciliation/adjustments', label: 'Adjustments', requiredPermissions: [PERMISSIONS.RECON_ADJUSTMENT_LIST_READ] }`
- [ ] **Step 3:** 随手闸②；preview 起主栈登录 SUPER_ADMIN → 菜单可见 → 列表渲染 → 点行进详情回案件，**截图列表页**（空态 + 有数据态各一张；主栈现无调账单，从案件页开一张 DRAFT 制造数据）
- [ ] **Step 4:** Commit `feat(admin): 调账单独立菜单——列表页/路由/侧栏项`

### Task 6: Demo Compare 整页退役

**Files:**
- Delete: `admin-web/src/pages/ReconciliationDemoComparePage.tsx`
- Modify: `admin-web/src/App.tsx`（删 lazy import + `reconciliation/demo-compare/:runNo` 路由）
- Modify: `admin-web/src/pages/ReconciliationRunsDetailPage.tsx:331-341`（删 `hasDemoManifest` 按钮块）
- Modify: `src/modules/clearing-settle/reconciliation/controllers/reconciliation-admin.controller.ts:40`（删 `GET demo/compare`）
- Modify: `src/modules/clearing-settle/reconciliation/reconciliation-query.service.ts:640` 一带（删 compare 读块 + `.breaks` 孤儿逻辑 + DTO `hasDemoManifest` 投影）
- Modify: `rbac.catalog.ts`（若有 demo/compare route 登记则删）

**交付清单命中：** 退役业务动作删前端入口（逐键 grep 零残余）

- [ ] **Step 1:** 删除上述各处；`recon:demo` 的 manifest 写入与答案键打印**不动**（spec §4）
- [ ] **Step 2:** 逐键 grep 零残余：`grep -rni "demo-compare\|demoCompare\|hasDemoManifest\|DemoComparePage" src admin-web scripts test` = 0；随手闸①②④（对账相关 jest）
- [ ] **Step 3:** Commit `retire(recon): Demo Compare 页整体退役——路由/页面/读端点/投影（BACKLOG №246 销账，业主拍板删）`

### Task 7: Run 详情页重排（英文版，设计稿画板 Run Detail）

**Files:**
- Modify: `admin-web/src/pages/ReconciliationRunsDetailPage.tsx`（全页重写渲染层，数据获取/排序逻辑保留）
- Modify: `admin-web/src/pages/ReconciliationRunsListPage.tsx`（若残留中文/旧桶词随手齐）

**Interfaces:**
- Consumes: Task 1 `formatBucket` / `BUCKET_LABELS`；后端 DTO 不变（`hasDemoManifest` 已由 Task 6 删）
- Produces: 无（叶子页面）

**交付清单命中：** 改前端截图

- [ ] **Step 1:** 照设计稿逐节改：① 判词横幅 `BREAK — {walletCount} wallets checked: {matched} matched, {inTransit} in transit, {needsAttention} need attention`（PASS 绿版同构）② Health Check 五瓦（Total Wallets / Matched / In-Transit / Compensating / Break，单语）③ Case Flow 压成一条细条（三个内联数字 + 右链 `View all cases for this run`）④ 快照表：表头 `Wallet / Owner / Asset / Internal / External / Δ / In-Transit / Flow Lines / Status / Case`；Flow Lines 生成器替换 `flowParts`：

```tsx
const flowWords = [
  `${row.flowMatched} matched`,
  row.flowMismatch > 0 && `${row.flowMismatch} mismatch`,
  row.flowOrphanInternal > 0 && `${row.flowOrphanInternal} internal-only`,
  row.flowOrphanExternal > 0 && `${row.flowOrphanExternal} external-only`,
  row.inTransitCount > 0 && `${row.inTransitCount} in-transit`,
].filter(Boolean).join(' · ');
```

⑤ 侧栏动作 `Re-reconcile`、legacy 提示句转英
- [ ] **Step 2:** 随手闸②⑤：preview 打开 RUN20260906-2，对照设计稿截图（横幅 / 五瓦 / 细条 / 表格四要素齐）
- [ ] **Step 3:** Commit `redesign(admin): Run 详情页重排转英——判词人话/CaseFlow 细条/FlowLines 人话`

### Task 8: Case 详情页重排（英文版，设计稿画板 Case Detail——本轮最重）

**Files:**
- Modify: `admin-web/src/pages/ReconciliationCasesDetailPage.tsx`（渲染层重排 + 全词表转英；六态逻辑/权限门控/四弹层挂载点/自动开弹层 effect 全保留）
- Modify: `admin-web/src/utils/caseConclusion.ts`（重写英文 + 已解释口径）
- Modify: `admin-web/src/utils/causeRegistry.ts`（前端出口词若有中文随 Task 2 词对齐）
- Test: `admin-web/src/utils/caseConclusion` 若有 spec 随写（前端 .spec 不在闸内也照写，防漂移）

**Interfaces:**
- Consumes: Task 1 桶词表、Task 2 后端英文 `causeLabel/outletLabel`、共享动作词表
- Produces: 无

**交付清单命中：** 改前端截图 ｜ 对外识别业务键（Source 列）

- [ ] **Step 1: Hero 减负**——只留案号 + 徽标行（bucket/severity/`OVERDUE {n}D`/StatusPill）+ 结论句。`buildCaseConclusion` 重写：残差非零但存在已解释行时输出 `External balance is {delta} {asset} short of our books — no in-transit cover; {explainedSum} explained, awaiting re-reconcile.`；全额未解释 `…— full amount unexplained.`；在途覆盖 `…— fully covered by in-transit orders.`（explainedSum = flowComparison 里 `explainedByAdjustmentNo` 非空行的金额合计，前端可算）
- [ ] **Step 2: Account 独立节**——五字段网格（Wallet / Customer 链客户详情 / Ledger Account 短语标签 / Asset · book / Business Date）。科目短语映射新建：

```tsx
const COA_PHRASE: Record<string, string> = {
  'L.CLIENT_PAYABLE': 'Client payable',
  'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE': 'Client payable + Deposit suspense',
  'E.FIRM_OPS': 'Firm operating',
};  // 兜底：原码原样显示（缺映射不算错，标进 title）
```

- [ ] **Step 3: Case History 三格**（替换 ObservationBar）：`OPENED BY`（firstSeenRunNo + firstSeenAt）｜`LAST RE-CHECKED`（lastObservedRunNo + 时间 + `still unmatched`；RESOLVED 时值=closedByRunNo + `closed`）｜`AGING`（超期红格 `Overdue by {n} days`+`deadline was {t}`；未超期中性格 `day {n} of 3-day SLA`；RESOLVED 冻结口径沿用 `agingReferenceMs` 既有逻辑）。**复观察次数不渲染**（spec §3.3）
- [ ] **Step 4: Differences 表治横滚**——列 `Type / Dir / Amount / Reference / Source / Time / Disposition(width 250px)`。Reference 截断组件：

```tsx
const ShortRef = ({ value }: { value: string | null }) =>
  !value ? <span className="text-adm-t3">—</span> : (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-adm-t2" title={value}>
      {value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-4)}` : value}
      <button type="button" onClick={() => navigator.clipboard.writeText(value)}><Copy size={11} /></button>
    </span>
  );
```

Source 列：IN_TRANSIT 行保留资金单链 + `Pushed · re-reconcile` 徽标；其余内部行显示 `intl.sourceNo`（DEP/WD/SWP 业务号）链到对应订单详情（映射沿 `approvalEntityRoutes.ts` 既有路由表），`eventCode` 进 title；外部孤儿行 `—`
- [ ] **Step 5: 六态词表**——动作列全部换共享词表英文（Record finding / Open adjustment / Claim recall…），`SUPPLEMENT_ACTION_LABEL`、事故按钮、补款垫款按钮、`buildIncidentHref` 的 title/description 预填模板同步转英（例：`退汇欠款 · 客户 X` → `Deposit-recall shortfall · customer X`）
- [ ] **Step 6:** 随手闸②⑤：preview 打开 REC20260906-003（真数据）核对：1280 视口 Differences **无横向滚动条**（用 `javascript_tool` 断言 `el.scrollWidth <= el.clientWidth`）、三格 Case History、英文结论句不与已解释行打架；截图整页 + Differences 局部
- [ ] **Step 7:** Commit `redesign(admin): Case 详情页重排转英——Hero 减负/Account 节/CaseHistory 三格/Differences 治横滚/六态词表`

### Task 9: 四个处置弹窗转英

**Files:**
- Modify: `admin-web/src/components/ReconciliationDispositionModal.tsx`（28 行中文）
- Modify: `admin-web/src/components/ReconciliationAdjustmentCreateModal.tsx`（148 行，含 `REASON_LABEL` 表转英——Task 5 列表页消费同一份）
- Modify: `admin-web/src/components/ReconciliationSupplementModal.tsx`（28）
- Modify: `admin-web/src/components/InternalTransferInitiateModal.tsx`（17）

**Interfaces:**
- Consumes: Task 2 后端下发的英文 menu/clue；共享词表
- Produces: `REASON_LABEL: Record<string,string>` 英文版（Task 5/8 消费，单一来源不复制）

**交付清单命中：** 改前端截图

- [ ] **Step 1:** 逐弹窗转英：表单标签、锁定视图说明（成因定死/方向只读附推导依据句）、按钮、校验报错。方向推导句模板：`Direction = make internal equal external: external shows less → REDUCE`
- [ ] **Step 2:** preview 实开四弹窗各截一图（处置两屏、调账锁定视图、补单三路切换、划转发起）；随手闸②
- [ ] **Step 3:** Commit `i18n(admin): 四个处置弹窗转英（词表与后端菜单同源）`

### Task 10: 客户流水读模型（statement 端点扩展 + tipping-off 盘点）

**Files:**
- Modify: `src/modules/asset-treasury/treasury/customer-portfolio.controller.ts:39-66`（`GET statement` 加 `from/to/skip/take` query，返回聚合行）
- Create: `src/modules/asset-treasury/treasury/customer-statement.service.ts`（聚合器，消费 `TbEvidenceService.getAccountStatement` 的逐腿 items）
- Test: `src/modules/asset-treasury/treasury/customer-statement.service.spec.ts`

**Interfaces:**
- Consumes: `getAccountStatement(tbAccountId)` → `items[{ sourceType, sourceNo, eventCode, direction, amount, runningBalance, externalRef, createdAt }]`（`tb-evidence.service.ts:396`，金额已是最小单位）
- Produces: `GET /client/portfolio/statement?assetCurrency=&from=&to=&skip=&take=` → `{ items: StatementRow[], total, currentBalance, assetCurrency, decimals }`；`StatementRow = { postedAt, kind, title, subtitle: string | null, amount: string /*净额,最小单位,带符号*/, feeAmount: string | null, balanceAfter: string, refs: Array<{sourceType, sourceNo}> /*追溯用,前端不渲染*/ }`

**交付清单命中：** 新内容到客户面 tipping-off（**本任务核心**）｜ 金额分存元显 ｜ 业务键 ｜ 改交易域问三域对称

- [ ] **Step 1: 事件码盘点（先做，产出进任务报告）**——`grep -rn "EVT_" src/modules/accounting --include='*.constant*.ts'` 列全量事件码；对每码回答"会不会出现在客户 CLIENT_PAYABLE 户的 statement 里、客户看到什么词"。**判定表落在 service 顶部常量 `ROW_PRESENTATION`**，键=eventCode 或 sourceType 族，值=`{ kind, title 模板, subtitle 规则 }`；没收/上缴/制裁相关若命中客户户一律 `{ kind: 'ADJUSTMENT', title: 'Balance adjustment' }`（禁词表见 Global Constraints）；盘点发现"从未触及客户户"的码记为 N/A 并留 grep 证据
- [ ] **Step 2: 写失败测试**（喂手造 legs 断行为，不 mock 聚合器内部）：① 同 sourceNo 多腿并一行、净额=签名和、`feeAmount`=费腿（eventCode 含 `FEE`）合计、`balanceAfter`=组内最后一腿 runningBalance ② 调账行（sourceType=RECON_ADJUSTMENT）title=`Balance correction · {reasonCustomer}`、subtitle 有 relatedOrderNo 时 `Original order {no}` 否则 null、**不含 ADJ 号** ③ 划转 COMPENSATION/ADVANCE 行 title 照 spec 词表、subtitle null ④ 退汇 CLAWED_BACK 行 `Deposit recalled by bank` + 原 DEP 号 ⑤ 日期区间过滤 + 分页 total ⑥ 没收类事件码 → `Balance adjustment` 且响应文本无 confiscate 字样
- [ ] **Step 3:** 实现聚合器跑绿：`npx jest src/modules/asset-treasury/treasury 2>&1; echo EXIT=$?`；调账行的 `reasonCustomer` 从 `reconciliation_adjustments` 按 sourceNo=adjustmentNo 查（Task 2 已英文模板）；改记两侧行只出各自户的腿（引擎天然按户查，正主方 subtitle=null 在 ROW_PRESENTATION 分支写死）
- [ ] **Step 4:** 随手闸①④；Commit `feat(client-api): 客户流水读模型——statement 聚合行/费用拆列/tipping-off 判定表`

### Task 11: 客户端 Transaction History 页重做 + Overview 入口切换 + 弹层退役

**Files:**
- Rewrite: `client-web/src/pages/TransactionHistory.tsx`（整页按设计稿 fx-* 重写；死端点调用消失）
- Modify: `client-web/src/pages/DashboardOverview.tsx:346-358`（History 图标 `openStatement(item)` → `navigate('/transactions?assetId=' + row.assetId)`）+ 删弹层挂载/state/fetch（`:105-160` 一带）
- Delete: 弹层专属连带死码（`statementSourceLabel.ts` 等，以 grep 实证为准）
- Modify: `client-web/src/App.tsx:56`（路由保留原位）

**Interfaces:**
- Consumes: Task 10 `StatementRow`（`refs` 字段**不渲染**）
- Produces: 无（叶子页面）

**交付清单命中：** 退役动作删入口（弹层，逐键 grep）｜ 新入口 ｜ 金额换算 ｜ 改前端截图

- [ ] **Step 1:** 重写页面（照设计稿画板 Client · Transaction History）：返回箭头回 `/overview`；标题 `Transaction History` + 副题 `Every balance change on your account — one row per order.`；资产 chips（客户持仓资产，当前 assetId 高亮）+ 日期区间 + Clear；四列表格 Date（日+时分两行）/ Description（title 主行 + subtitle 副行）/ Amount（主行 `{±net} {code}` sage/rust + 副行 `fee {x}` 仅 feeAmount 非零）/ Balance（mono）；分页照设计稿 footer；`loading/empty/error` 三态齐（frontend-client 规则）
- [ ] **Step 2:** Overview 图标改跳转；删 `openStatement`/statement 五个 state/弹层 JSX；`grep -rni "openStatement\|statementSourceLabel\|statementRows" client-web/src` = 0
- [ ] **Step 3:** 随手闸③ + `npm run test:client`；preview 客户端登录种子客户 → Overview 点 AED 行图标 → 落流水页；**逐行验算 Balance 列 = 上一行 Balance + Amount**（页面截图 + 手算记录进报告）
- [ ] **Step 4:** Commit `feat(client): Transaction History 页重做——Overview 图标直达/弹层退役/两行金额制`

### Task 12: admin-web 批量转英 A（交易三域 + 状态词表 + parity spec）

**Files:**
- Modify: `admin-web/src/pages/{Deposit,Withdraw,Swap}TransactionDetail.tsx`（63/28/72 行）、三域 List 页残留、`SwapQuote*`/`WithdrawQuote*`
- Modify: `admin-web/src/utils/{swapStatusMap,fundsOrderStatusMap,fundsOrderSimActionMap,internalTransferStatusMap}.ts` 等状态词表
- Modify: `admin-web/src/pages/module-parity.spec.ts`（153 行期望值随词表）
- Modify: `admin-web/src/components/compliance/StatusTimeline.tsx`（22）、`SimulationPanel.tsx` 等三域共享件

**交付清单命中：** 改交易三域 → 三域对称（**逐词对照表进任务报告**）｜ 改前端截图

- [ ] **Step 1:** 转英；三域同义状态一词表（例：解冻=Unfreeze、退票=Bounce、放行=Release 三域统一）；对照表（语义 × 三域词）写进报告
- [ ] **Step 2:** `module-parity.spec.ts` 先红后绿；随手闸②④
- [ ] **Step 3:** preview 三域各开一张详情页截图；Commit `i18n(admin): 交易三域详情与状态词表转英（三域对称核对表在册）`

### Task 13: admin-web 批量转英 B（事故/治理/其余全部）

**Files:**
- Modify: `admin-web/src/pages/{IncidentListPage,IncidentDetailPage}.tsx`（37/92）、`admin-web/src/utils/incidentStatusMap.ts`（37）、`admin-web/src/components/governance/**`（含 NewIncidentModal）
- Modify: `admin-web/src/pages/ApprovalPoliciesPage.tsx:37`（`ACTION_TYPE_LABELS` 转英 + **补 4 键**：`DEPOSIT_SUPPLEMENT: 'Deposit supplement'` / `DEPOSIT_CLAWBACK: 'Deposit recall (clawback)'` / `WITHDRAW_RETURN_CLAIM: 'Withdrawal return claim'` / `INTERNAL_TRANSFER_APPROVAL: 'Internal transfer'`）
- Modify: 其余全部含中文文件（首页占位 `AdminHomePlaceholder`、Quick Login 弹层、`rbac/permissions.ts` 描述、`approvalEntityRoutes.ts`、Funds/Ledger/Customer/Asset 各页残留——以 Step 1 扫描清单为准）

**交付清单命中：** 每轮收尾 BACKLOG №87 销账 ｜ 改前端截图

- [ ] **Step 1:** 圈定：`grep -rlP '[\x{4e00}-\x{9fff}]' admin-web/src --include='*.tsx' --include='*.ts'` 减去 Task 5-9/12 已清文件 = 本任务清单（写进报告）
- [ ] **Step 2:** 逐文件转英（注释不动）；随手闸②④
- [ ] **Step 3:** 英文化闸预跑（spec §9 命令）应仅剩 client-web 命中；preview 首页/QuickLogin/事故列表+详情/审批策略页截图（策略页四个新标签入镜）
- [ ] **Step 4:** Commit `i18n(admin): 全站批量转英收口 + 审批策略页补 4 缺失标签（BACKLOG №87）`

### Task 14: client-web 批量转英

**Files:**
- Modify: `client-web/src/utils/depositStatusView.ts`（27，**保持 CONFISCATED 刻意缺席的教义与文件头注释**）、`restrictedCapabilities.ts`、各 pages/components 含中文文件（27 个，Task 11 已清者除外）
- Modify: `client-web/src/utils/depositStatusView.spec.ts`（18 行期望）

**交付清单命中：** 新内容到客户面（沿用既有白名单，不新增可见性）｜ 三域对称（与 Task 12 词对照）｜ 改前端截图

- [ ] **Step 1:** 转英；客户话术校准（客户面禁系统词）；状态词与 Task 12 管理台词**允许不同**（客户话术 vs 操作话术两套受众），但同端内三域一致
- [ ] **Step 2:** spec 先红后绿 + `npm run test:client`；英文化闸全量跑 = 0 命中
- [ ] **Step 3:** preview 客户端首页/充值/兑换/提现页截图；Commit `i18n(client): 客户端全站转英（tipping-off 白名单教义保持）`

### Task 15: 对账页轻整理（Cases 列表治横滚 + External Balances 默认日期）

**Files:**
- Modify: `admin-web/src/pages/ReconciliationCasesListPage.tsx`（14 行中文顺清）
- Modify: `admin-web/src/pages/ReconciliationExternalBalancesPage.tsx`（1 行顺清）
- Modify: 后端 `reconciliation-admin.controller.ts` / query service **仅当**默认日期需服务端支持（优先前端解：balances 接口若已能按日回数据，前端首载先查最近有数日）

**交付清单命中：** 改前端截图

- [ ] **Step 1:** Cases 列表列瘦身：COA 列用 Task 8 的 `COA_PHRASE` 短语；First Run / Last Run 并一列 `RUNxxx-1 → -2`（同 run 只显一次）；验收 `scrollWidth <= clientWidth`（1280 视口，javascript_tool 断言）
- [ ] **Step 2:** External Balances 默认日期改"最近一个有数据的账单日"：首载先 `GET external-balances`（无日期参）取最新 `businessDate` 回填 date input；后端若不支持无参查询则加 `latest=true` 分支（同文件小改，不新增端点不动 RBAC——沿用既有 route）
- [ ] **Step 3:** 随手闸②⑤：两页截图（Cases 无横滚、Balances 打开即有数据）；Commit `polish(admin): Cases 列表治横滚 + External Balances 默认最近账单日`

### Task 16: 收尾闸 + 全线走查 + 文档收口

**Files:**
- Modify: `doc-final/modules/v8-recon.md` §4/§5 前端节 ｜ `doc-final/demo/script.md` 涉按钮词步骤 ｜ `doc-final/BACKLOG.md`（销 №87/№200/№232/№246/№290，№290 注明十格设计被 spec §8.3 取代）｜ `doc-final/decisions.md`（spec §8 七条）｜ `doc-final/CHANGELOG.md` 一行 ｜ `doc-final/demo/data.md` 仅核对不手改生成区

**交付清单命中：** 改页面同步 demo 两文档 ｜ 每轮收尾三件套 ｜ 永不豁免①②

- [ ] **Step 1: 合并前收尾闸**（在 worktree 内 self 栈）：`bash scripts/stack.sh reset self` → `bash scripts/on-stack.sh self demo:all` 全绿（闸⑧覆盖 bucket/话术落库值变更）→ `on-stack self verify:coa`（未动钱兜底）→ `on-stack self test:e2e -- --testPathPattern 'test/recon-'` 全绿
- [ ] **Step 2: RBAC 闸**：`bash scripts/on-stack.sh self verify:rbac` 全绿（新列表端点 + demo/compare 退役后的目录一致性）
- [ ] **Step 3: 英文化闸**（spec §9 命令原文）= 0；`grep -rn "SOFT_FLAG" src admin-web scripts` = 0
- [ ] **Step 4: 走查截图集**（demo-shot.js 落盘）：①第六幕主线（Run 详情 → Cases → Case 详情处置一条冲正到 Explained → 重对账自愈）②调账单菜单闭环（列表→详情→回案件）③客户端 Overview 图标→流水页（余额逐行验算）④**没收场景 tipping-off 实证**：跑一条充值没收（⚡面板），打开该客户流水页——要么无行（钱未进可用余额，grep 证据）要么中性 `Balance adjustment`，截图留证
- [ ] **Step 5: 文档收口** + Commit `docs(平账收尾): 界面收口轮文档收口——modules/demo/BACKLOG/decisions/CHANGELOG`
- [ ] **Step 6: 合并主树后**（主会话做）：`npm run db:base:sync` + 重启后端 + `bash scripts/stack.sh reset main` + `on-stack main demo:all` 复绿

---

## Self-Review 记录

- **Spec 覆盖**：§1→T4/T5 ｜ §2→T1/T7 ｜ §3→T8/T9 ｜ §4→T6 ｜ §5→T2/T3/T12/T13/T14（连带①-⑤含 parity spec、4 标签、首页、三域对称）｜ §6→T10/T11（tipping-off/金额契约/退役纪律各有落点）｜ §7→T13(事故页)/T15 ｜ §8→T16 Step 5 ｜ §9/§10→各任务"命中行" + T16
- **类型一致**：`AdjustmentListRow`（T4→T5）、`StatementRow`（T10→T11）、`formatBucket`（T1→T7/T8）、`REASON_LABEL`（T9→T5/T8 单源）、`COA_PHRASE`（T8→T15）已对齐
- **顺序依赖**：T1→T7/T8（桶词）；T2→T8/T9/T10（后端词）；T4→T5；T6→T7（先删投影再重排）；T10→T11；T12 词表→T14 对照。T3 可与 T4-T9 并行，但本轮**单 worktree 串行执行**（一会话一 worktree 铁律），plan 顺序即执行顺序
