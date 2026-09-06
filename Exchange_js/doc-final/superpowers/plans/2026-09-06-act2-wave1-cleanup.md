# 第二幕客户域 · 波一「清地基」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 客户主表 48→24 字段个个有主；material-refresh 子系统整体退役；死码清零；VIP 与交易档位解绑；客户详情接通三域交易；终拒文字上屏；文档同步。

**Architecture:** 纯清扫 + 小修，不建新流程。顺序是**先删代码、后删表**——每个任务收尾时三处 tsc 都绿，schema 变更集中在 Task 7 一次迁移完成（§3：不写兼容层，改完 reset 重铺）。

**Tech Stack:** NestJS + Prisma(SQLite) / React(admin-web, client-web) / jest / 项目栈脚本 `scripts/stack.sh`、`scripts/on-stack.sh`

**Spec:** `doc-final/superpowers/specs/2026-09-06-act2-wave1-cleanup-design.md`（业主裁定与验收口径）｜ 总纲 `2026-09-06-act2-customer-waves-outline.md`

## Global Constraints

- 工作目录一律 `Exchange_js/`；jest **必须在 Exchange_js 根下跑**；命令**不接管道尾 `| tail`**（zsh 吞退出码装死成功）
- **退役任何符号/文件前，现场重跑零引用 grep**（两种搜法：符号名全仓 + 文件路径名），命中先停下判读——体检快照会过期，并行会话在 main 上高频推进
- 禁做清单（CLAUDE.md §2）：不加输入校验、不加幂等、不修 `customers.service.ts` 裸 findUnique 的字段脱敏（PRODUCTION-NOTES 已记）
- 体检绿区不碰：能力门 `customer-access.service.ts`（除删 assertOffboardable）、限制账、材料请求主线（material-requests/ 整目录**保留**，别与 material-refresh/ 混淆）
- `constants/customer-lifecycle.constant.ts` **保留**（波二状态机地基）；`customer-lifecycle.util.ts` 才是删除对象
- 每任务收尾跑随手闸：`npx tsc --noEmit -p tsconfig.json`；改了 admin-web/client-web 再各自 `npx tsc -b --noEmit`；前端可见变更必须 preview 截图（工具可用 `scripts/demo-shot.js`）
- worktree 隔离执行（`superpowers:using-git-worktrees`，分支名 `act2-wave1-cleanup`）；worktree 内栈命令一律 `bash scripts/on-stack.sh self <script>` / `bash scripts/stack.sh reset self`
- 提交信息用业务中文、不加 attribution；任务收尾对照 `doc-final/rules/delivery-checklist.md`

---

### Task 1: material-refresh 后端退役

**Files:**
- Delete: `src/modules/identity/material-refresh/`（整目录 12 文件，含 4 个 spec）
- Modify: `src/app.module.ts:32,89`（import 与注册各一行）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts:259-264`（6 条 route）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts:951`（`CUSTOMER_TIER_CHANGE_SIMULATED` 行）及 928-931 头注中提及它的两句

**Interfaces:**
- Produces: 后端不再存在 `/admin/material-management/*` 任何路由；V2 审计词表 15→14 码；`MaterialPolicyLoader`（原 `MaterialRefreshPolicyLoader` 搬家改名）由 `material-requests/` 自持

**修正（2026-09-06 首次执行 Step 1 逮到两条活依赖，控制方裁决，Files 清单相应扩大）：**
- **策略加载器搬家不退役**：`MaterialRequestIssuerService.issue()` 运行时调 `policyLoader.getMaterialConfig(materialType)`（按材料类型查 Sumsub 认证等级名，建单主线真用）。把 `material-refresh/policy/material-refresh-policy.ts` 挪为 `src/modules/identity/material-requests/material-policy.ts`，类改名 `MaterialPolicyLoader`（"refresh" 概念随巡查退役），`MaterialConfig` 类型与 `getMaterialConfig()` 原样保留；`computeStage` / `getRequiredMaterialsForLevel` 确认除 material-refresh 自身外零引用后随目录死。策略 JSON（`config/material-refresh-policy.json`）路径不动；打开看内容——仅巡查消费的旋钮（如刷新窗口天数、阶段天数）一并修剪，只留 `getMaterialConfig` 消费的字段。`material-requests.module.ts` 摘 `forwardRef(() => MaterialRefreshModule)`，把 `MaterialPolicyLoader` 注册为自己的 provider；`material-request-issuer.service.ts` 的 import 与构造注入改指新位置新类名。
- **doc-monitoring 路由随巡查退役**：`SumsubIngestionService` 的 `handleSumsubDocMonitoringFire` 调用（:189 附近分支）是巡查的喂入口，摘掉注入与该分支——此类事件此后落到 dispatch 既有的 unrouted `logger.warn`（文档指定的将来重开位置）；`sumsub-ingestion.module.ts` 摘 `MaterialRefreshModule` import；`sumsub-ingestion.service.spec.ts` 里该路由的用例同步删；两处提及已删 `material-refresh-review.listener` 的注释（:123,:201）改口为「材料刷新监控已随巡查退役（2026-09-06），事件落 unrouted 警告」。
- Step 1 判读口径放宽：纯注释/字符串命中记录即可、不算阻塞；预期外的**代码**命中仍然停下报告。

- [ ] **Step 1: 现场零引用复核**（删目录前）

```bash
grep -rn "material-refresh\|MaterialRefreshModule\|MaterialRefreshService\|MaterialFreshnessCron" --include="*.ts" src/ | grep -v "src/modules/identity/material-refresh/"
```
Expected: 代码级命中只有修正块列出的四个文件（material-requests.module / material-request-issuer.service / sumsub-ingestion.module / sumsub-ingestion.service）+ `app.module.ts` 两行；其余为注释/字符串。超出此清单的代码命中先停下判读。

- [ ] **Step 2: 搬家 + 摘喂入口 + 删目录、摘装配**

先按修正块完成策略加载器搬家与 doc-monitoring 路由摘除，再 `rm -rf src/modules/identity/material-refresh/`；删 `app.module.ts` 第 32 行 import 与第 89 行 `MaterialRefreshModule,`。

- [ ] **Step 3: 摘 rbac 6 条路由**

删 `rbac.catalog.ts` 259-264 的 6 个 `route(...)`（cycles×2 / holdings×2 / simulate-stage / simulate-tier-change）及其上 258 行的「── 材料管理 ──」注释。

- [ ] **Step 4: 退役审计码**

删 `V2_CUSTOMER_AUDIT_ACTIONS` 中 `CUSTOMER_TIER_CHANGE_SIMULATED` 一行及「── 档位模拟（1，站6 新铸）──」分节注释；头注（:929-931）里解释该码的两句一并删。

- [ ] **Step 5: 闸门**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/modules/identity src/modules/audit-logging src/modules/sumsub-ingestion
```
Expected: tsc 0 错；jest 全绿（material-refresh 的 spec 已随目录消失，sumsub-ingestion 摘路由后其余用例仍绿）。

- [ ] **Step 6: Commit**：`refactor(客户域波一): material-refresh 子系统后端退役——策略加载器搬家进材料请求域,doc-monitoring 喂入口随巡查摘除（业主2026-09-06拍板）`

---

### Task 2: material-refresh 前端退役 + CustomerDetail 持仓卡片

**Files:**
- Delete: `admin-web/src/pages/MaterialManagementPage.tsx`、`MaterialHoldingDetailPage.tsx`、`RefreshCyclesPage.tsx`、`RefreshCycleDetailPage.tsx`
- Modify: `admin-web/src/App.tsx:202-205`（4 条 Route）+ 顶部对应 4 个 import
- Modify: `admin-web/src/components/DashboardLayout.tsx:152`（material-holdings 侧栏项；159 的 refresh-cycles 已是注释，一并删）
- Modify: `admin-web/src/pages/CustomerDetail.tsx`（Material Holdings 卡片整块：state/fetch `fetchHoldings`、`GET /admin/material-management/holdings?customerId=` 调用、卡片 JSX、`View All →` 按钮 :1020、相关 interface 字段）

**Interfaces:**
- Consumes: Task 1 已删后端路由（本任务把调用方清干净）

- [ ] **Step 1: 删 4 页 + 路由 + import + 侧栏项**（按上表逐处）
- [ ] **Step 2: 清 CustomerDetail 持仓卡片**——搜 `material-management` 与 `holding`（不分大小写）于该文件，state、fetch、JSX、类型逐块删；**材料请求（material-requests）区块别动**
- [ ] **Step 3: 复核前端零残留**

```bash
grep -rn "material-management\|material-holdings\|refresh-cycles" admin-web/src client-web/src
```
Expected: 零命中。

- [ ] **Step 4: 闸门 + 截图**

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
```
起 preview 打开某客户详情页，截图确认持仓卡片消失、页面无报错（read_console_messages 无 error）。

- [ ] **Step 5: Commit**：`refactor(客户域波一): 材料时效四页与详情持仓卡片退役`

---

### Task 3: 死码清扫

**Files:**
- Delete: `src/modules/identity/customer-lifecycle.util.ts` + `customer-lifecycle.util.spec.ts`
- Delete: `src/modules/identity/review-response-compat.util.ts`
- Modify: `src/modules/identity/customers/customer-access.service.ts`（删 `assertOffboardable` 方法 :176-207 及其独用的注入依赖）
- Modify: `src/modules/identity/customers/customers.module.ts`（删 :20-22 注释与 TigerBeetleModule / FundsOrdersModule 两个 import——注释自证仅为 assertOffboardable 存在）
- Modify: `src/modules/identity/material-requests/constants/material-request.constant.ts`（删 `MATERIAL_REQUEST_TERMINAL` 导出）
- Modify: `src/modules/identity/customers/customer-access.service.ts:55`（`ALL_CAPABILITIES` 去 `export` 保留常量）
- Modify: `src/modules/identity/customer-tags/constants/customer-tag.constant.ts:20-21`（删 `isDerivedTag`、`staticTagCodes` 两函数）

- [ ] **Step 1: 逐键现场零引用复核**（每个删除对象一条命令，全空才动手）

```bash
for s in resolveLifecycleTransition buildLifecycleTransitionPatch readLifecycle projectResponseRecord resolveLegacyIncidentAssigneeUserId assertOffboardable MATERIAL_REQUEST_TERMINAL isDerivedTag staticTagCodes; do echo "== $s"; grep -rnw "$s" --include="*.ts" --include="*.tsx" src/ admin-web/src client-web/src scripts/ | grep -v spec; done
```
Expected: 每个符号只命中定义处。`assertOffboardable` 在 workflow spec 里有 `jest.fn()` mock 占位——删方法后同步删那些 mock 行。

- [ ] **Step 2: 按上表逐处删**；`customer-access.service.ts` 里 assertOffboardable 独用的构造注入（TigerBeetle/资金单相关）一并摘，其它方法共用的注入不动
- [ ] **Step 3: 闸门**

```bash
npx tsc --noEmit -p tsconfig.json && npx jest src/modules/identity
```
- [ ] **Step 4: Commit**：`refactor(客户域波一): 死码清扫——旧生命周期工具/无主兼容件/销户校验及其两个死依赖/三个死导出`

---

### Task 4: VIP 与交易档位解绑（⚠️ 带电作业：站2 费率对照戏依赖 Grace 命中 VIP-USDT-AED）

**Files:**
- Modify: `src/modules/identity/customer-tags/constants/customer-tag.constant.ts`（VIP 定义行）
- Modify: `src/modules/identity/customer-tags/customer-tag.service.ts`（`effectiveTags()` 删派生一行）
- Modify: `prisma/seed.business.ts`（Grace 补手打 VIP 标签 fixture）

**Interfaces:**
- Produces: `effectiveTags()` 的 VIP 只来自 `customer_explicit_tags` 行；Grace 报价命中 `VIP-USDT-AED` 的行为**不变**（来源换了）

- [ ] **Step 1: 改标签注册表**

```ts
// customer-tag.constant.ts —— VIP 行改为：
{ tagCode: 'VIP', displayName: 'VIP', type: 'STATIC', description: '手动指定：商务/高净值客户，费率受众用（2026-09-06 与交易档位解绑）' },
```

- [ ] **Step 2: 删派生**——`customer-tag.service.ts effectiveTags()` 删 `if (c?.tradingTier === 'PREMIUM') tags.add('VIP');` 一行，select 里的 `tradingTier: true` 一并摘（`onboardingApprovedAt` 与 NEW_CUSTOMER 逻辑**原样保留**）
- [ ] **Step 3: 种子给 Grace 手打 VIP**——`seed.business.ts` 的 `seedCustomers()` 循环里，upsert 之后仿照限制账 fixture 的「直接铺终态」风格补：

```ts
// VIP 手打标签 fixture（2026-09-06 解绑：VIP 不再由 tradingTier 派生）。
// 与限制账 fixture 同一性质：直接铺终态，不走 service、不写审计。
if (c.email === 'demo_grace@example.com') {
  await prisma.customerExplicitTag.upsert({
    where: { customerId_tagCode: { customerId: customer.id, tagCode: 'VIP' } },
    update: {},
    create: { customerId: customer.id, tagCode: 'VIP', assignedByUserId: 'SEED' },
  });
}
```
（`assignedByUserId` 列 Task 7 才删，届时此处同步去掉该属性。）

- [ ] **Step 4: 行为验证——Grace 仍命中 VIP 档**

```bash
npx tsc --noEmit -p tsconfig.json && npx jest src/modules/identity/customer-tags src/modules/trading/swap-transactions
bash scripts/stack.sh reset self
bash scripts/on-stack.sh self demo:all
```
Expected: 全绿；demo:all 花名册断言含 Grace 兑换素材（站2 对照价 VIP 12 < STD 20 的前提是她命中 VIP 档——demo:all 绿即证）。

- [ ] **Step 5: Commit**：`refactor(客户域波一): VIP 与交易档位解绑——改手打标签,Grace 种子补 fixture（业主2026-09-06拍板）`

---

### Task 5: 前端死读与 UUID 修复 + 僵尸展示区

**Files:**
- Modify: `src/modules/identity/customers/customer-profile.controller.ts`（select：`id: true` → `customerNo: true`；删 `cddDocumentExpiresAt: true`、`investorTier: true` 两行）
- Modify: `client-web/src/hooks/useCustomerProfile.ts`（类型与映射：`id`→`customerNo`；删 `nextReviewAt` :37,88）
- Modify: `client-web/src/pages/CustomerProfile.tsx`（:413 `value={profile.id}` → `value={profile.customerNo}`；删 :267-268 nextReviewAt 横幅；删 investorTier / cddDocumentExpiresAt 展示行）
- Modify: `admin-web/src/pages/CustomerDetail.tsx`（僵尸展示区：删 interface 与 JSX 中 `verificationSubstatus / verificationCustomerActionRequired / verificationCanContinue / verificationLatestEventType / verificationLatestEventAt / sumsubLatestReviewId / sumsubLatestAttemptId / sumsubExperiencedLevel2 / nextReviewAt(:668,:1119) / investorTier / investorTierUpdatedAt / cddDocumentExpiresAt` 的全部展示；`riskTier ?? riskRating` 兜底改直读 `riskRating`。**保留**：sumsubApplicantId、sumsubCurrentLevelName、riskRating、eddRequired 的展示）

**Interfaces:**
- Produces: `GET /onboarding/me` 响应含 `customerNo`、不含 `id`（客户面业务键，铁律⑥）

- [ ] **Step 1: 改后端 select**（上表三行）；确认 tipping-off 契约测试无涉：`npx jest src/modules/identity/customers/customer-access.contract.spec.ts` 绿
- [ ] **Step 2: 改 client 两文件**；`grep -n "profile.id\|nextReviewAt" client-web/src` 零命中收尾
- [ ] **Step 3: 清 CustomerDetail 僵尸区**（上表字段名逐个搜删）；BACKLOG:109 六处死读经查**已全修**（第四批修复轮改读 lifecycle，本波仅销账，见 Task 8）
- [ ] **Step 4: 闸门 + 截图**

```bash
npx tsc --noEmit -p tsconfig.json && cd admin-web && npx tsc -b --noEmit && cd .. && cd client-web && npx tsc -b --noEmit && cd .. && npm run test:client
```
preview 截图两张：client `/profile`（Member identifier 显 CU 开头业务号）、admin 客户详情（无空白 verification 区）。

- [ ] **Step 5: Commit**：`fix(客户域波一): 客户面标识改业务键,僵尸展示区随字段治理撤除`

---

### Task 6: 客户详情 → 三域交易跳转 + 终拒文字

**Files:**
- Modify: `admin-web/src/pages/CustomerDetail.tsx`（新增 Transactions 跳转区 + 终拒提示行；材料请求数据已在页内 state :234,:896，直接复用）
- Modify: `admin-web/src/pages/DepositTransactionList.tsx`、`WithdrawTransactionList.tsx`、`SwapTransactionList.tsx`（支持 URL `?ownerNo=` 初始化过滤）

- [ ] **Step 1: 三张列表页接 URL 参数**——Deposit/Withdraw 已有 `ownerNo` 过滤 state（`DepositTransactionList.tsx:45,62`）；用 `useSearchParams` 把初始 state 的 `ownerNo: ''` 换成 `ownerNo: searchParams.get('ownerNo') ?? ''`，首屏即按其取数。Swap 列表执行时核验：有 ownerNo 过滤则同款接参；没有则仿照 Deposit 的过滤输入与请求参数补一个（后端 swap 列表接口的过滤参数名以 controller 为准，先 grep 再接）。
- [ ] **Step 2: CustomerDetail 加跳转区**——在交易相关卡片附近（如限制账卡片旁）加：

```tsx
{/* 客户名下交易入口（第二幕③联动走查用；铁律⑥ 参数用业务键） */}
<div className="flex gap-2">
  <Link to={`/admin/deposit-transactions?ownerNo=${detail.customerNo}`}>Deposits →</Link>
  <Link to={`/admin/withdraw-transactions?ownerNo=${detail.customerNo}`}>Withdrawals →</Link>
  <Link to={`/admin/swap-transactions?ownerNo=${detail.customerNo}`}>Swaps →</Link>
</div>
```
（三条路由路径以 `App.tsx` 实际注册为准，先查再写；样式对齐页内既有按钮组。）

- [ ] **Step 3: 终拒提示**——sticky header（:498 起）状态徽标区加：当材料请求列表存在 `status === 'REJECTED'` 的行时渲染文字徽标「尽调未完成 · 待离场处理」（中英文案对齐页内既有徽标风格；只读展示，无按钮）。
- [ ] **Step 4: 闸门 + 走查截图**——admin tsc 绿；preview 三截图：①详情页点 Deposits → 到达按 Grace/Bob 过滤的充值列表 ②终拒徽标（走查手工把 Bob 的 EMIRATES_ID 请求打到 FINAL 拒绝后截）③兑换列表带参过滤。
- [ ] **Step 5: Commit**：`feat(客户域波一): 客户详情接通三域交易列表 + 材料终拒待离场提示`

---

### Task 7: schema 总迁移（24 字段 + 两张表 + 标签列）

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/modules/identity/customer-tags/customer-tag.service.ts`（assign() 去 `assignedByUserId`）、`prisma/seed.business.ts`（Task 4 fixture 去该属性）、`src/modules/audit-logging/audit-logs.service.ts:2007`（`investorTier: true` select 行）
- Create: 迁移 `prisma/migrations/<ts>_act2_wave1_customer_slim/`

- [ ] **Step 1: schema 三组删除**
  - CustomerMain 删 24 字段：`riskLevel investorTier investorTierUpdatedAt latestRiskApprovalId latestRiskApprovalStatus latestRiskAssessmentId nextReviewAt verificationSubstatus verificationCustomerActionRequired verificationCanContinue verificationLatestEventType verificationLatestEventAt sumsubLatestReviewId sumsubLatestAttemptId sumsubExperiencedLevel2 pepStatus pepConfirmedAt emailVerifiedAt phoneVerifiedAt locale timezone lastLoginIp termsAcceptedAt cddDocumentExpiresAt`；关系 `latestRiskApproval`(:264)、`materialHoldings`(:265)、`materialRefreshCycles`(:266) 三行；ApprovalCase 侧 `"CustomerLatestRiskApproval"` 反向关系（grep 定位）
  - 删 `CustomerMaterialHolding`(:1205-1232)、`MaterialRefreshCycle`(:1235-1270) 两个 model
  - `CustomerExplicitTag` 删 `assignedByUserId`（贴/撕已有 recordByActor 双审计留痕，列是重复记录——2026-09-06 已验）
- [ ] **Step 2: 残引清扫**——逐字段 grep（上面 24 词 + `assignedByUserId` + `customerMaterialHolding` + `materialRefreshCycle`）于 src/ + scripts/ + seed，清掉残余 select/赋值（已知点：audit-logs.service.ts:2007、customer-tag.service assign()、Task 4 种子属性；注册接口注释里的 `termsAcceptedAt` TODO 注释一并删）
- [ ] **Step 3: 迁移 + 生成 + 重铺**

```bash
npx prisma migrate dev --name act2_wave1_customer_slim
npm run prisma:generate
bash scripts/stack.sh reset self
```
Expected: 迁移生成成功、空库能建起、重铺全绿（判据对照 `doc-final/demo/baseline.md`）。

- [ ] **Step 4: 全量闸门**

```bash
npx tsc --noEmit -p tsconfig.json && cd admin-web && npx tsc -b --noEmit && cd .. && cd client-web && npx tsc -b --noEmit && cd ..
npx jest src/modules/identity src/modules/audit-logging
bash scripts/on-stack.sh self demo:all
```
- [ ] **Step 5: 字段清点断言**——`awk '/^model CustomerMain \{/,/^\}/' prisma/schema.prisma` 数标量字段恰 24 个（身份8/认证5/轴3/业务4/Sumsub2/时间戳2）。
- [ ] **Step 6: Commit**：`refactor(客户域波一): 客户表 48→24 字段治理 + 材料两表退役迁移`

---

### Task 8: 文档收口

**Files:**
- Modify: `doc-final/modules/v2-customer-compliance.md`、`doc-final/BACKLOG.md`、`doc-final/demo/data.md`、`doc-final/CHANGELOG.md`

- [ ] **Step 1: v2 篇**（对照 spec T8 清单）：§0 范围行撤「开户流程不演」改指总纲；§2 删材料时效行；§5 删 `resolveCustomerCanonicalState` 死引用、`nextLifecycle` 口径改「状态表在册、驱动待波二接上」、「15 码」改 14 并删档位模拟半句、删材料时效/cron 两条 bullet；§6 重排（cron 失配条销、新记「材料终拒→离场」指 BACKLOG）；Last Verified 更新
- [ ] **Step 2: BACKLOG**：:99 重写引总纲；:101 销（列已删，波二承接）；:103 重写指波三骨架；:105 重写为现状口径（ubo_profiles 已 DROP）；:109 凭证销账（三张交易详情第四批已改读 lifecycle、RiskAssessmentDetailPage 已不存在、material 两页本波退役）；:111 销（主体已退役）；:113 与新条合并——新记「材料终拒 → 离场清退流程（与 :107 销户缺口并链；管理台已有待离场文字）」
- [ ] **Step 3: demo/data.md**：Grace 行（:24）注明 VIP=手打标签（不再由 PREMIUM 派生）；§47 费率段核对措辞；客户矩阵表如列了被删字段则同步
- [ ] **Step 4: CHANGELOG 一行**（合并当日补）；`decisions.md` 五条 2026-09-06 已在案（核对在场即可，不重写）
- [ ] **Step 5: Commit**：`docs(客户域波一): v2 篇口径重写 + BACKLOG 七条销改 + demo 数据同步`

---

### Task 9: 收尾闸与走查

- [ ] **Step 1: 收尾闸全跑**（worktree 内）

```bash
bash scripts/stack.sh reset self && bash scripts/on-stack.sh self demo:all
bash scripts/on-stack.sh self verify:rbac
bash scripts/on-stack.sh self verify:audit
bash scripts/on-stack.sh self verify:demo-data
npx jest   # 全量，净新失败必须为 0
```
- [ ] **Step 2: 走查四景截图归档**：①客户详情无恒空区 ②三跳转到位 ③终拒文字 ④client Profile 业务号 + Grace 标签区手打 VIP
- [ ] **Step 3: 承接记录**——按 delivery-checklist 多波行，把实际偏差/新事实写进 `specs/2026-09-06-act2-wave2-onboarding-skeleton.md` 的「承接波一」节
- [ ] **Step 4: 合并（业主点头后）**：main 快进 → 重启后端 + `npm run db:base:sync` + `bash scripts/stack.sh reset main`（rbac catalog 与 schema 都动了，缺一不可）→ spec/plan 归档 `doc-final/archive/` → 清 worktree 与分支

## Self-Review 备忘（已核）

- spec 八任务 ↔ plan Task1-9 全覆盖（spec T1→plan T7、T2→plan T1+T2、T3→T3、T4→T4、T5→T5、T6+T7→T6、T8→T8、验收→T9）
- 类型一致：`customerNo` 贯穿 T5/T6；`assignedByUserId` 两触点（T4 建、T7 删）已互相注明
- 已知陷阱已写入：站2 费率对照对 Grace VIP 的依赖（T4 Step 4 行为验证兜底）、jest 根目录、管道吞码、逐键复核判例
