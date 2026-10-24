# LP 两步准入与打款地址簿 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 LP 准入拆成「档案+背调+CFO」与「按资产打款地址簿（先筛后批）」两步，开单改为选地址抄单，⚡到货加来源筛查；改结算流程整体退役。

**Architecture:** 新主体 `LpPayoutAddress` 落在既有 `lp-desk` 模块内（迁移表/服务/工作流/审批薄壳四件与 LP 档案同构）；归因与筛查复用 `sumsub-shared/travel-rule` 的 `TRAVEL_RULE_ADAPTER`（lp-desk 第四个 provide 点）；实体背调是 lp-desk 本地 mock 纯函数。消费侧只改 `lp-exchange-workflow` 的三个坐标点（开单抄单、腿 1 to、腿 2 from）。

**Tech Stack:** NestJS + Prisma(SQLite) + jest ｜ admin-web React ｜ 既有审批/审计/RBAC 基建

**Spec:** `doc-final/superpowers/specs/2026-10-23-lp-two-step-onboarding-spec.md`（执行者先读 spec 再读本 plan）

## Global Constraints

- 通用交付清单见 `doc-final/rules/delivery-checklist.md`，全部适用——各任务收尾按下方「任务×清单命中表」自查
- 本轮特有：**客户面零触碰**（LP 全链 admin-only，无 tipping-off 面）；**记账三腿结构零改动**（只改坐标来源，不新增科目），`verify:coa` 照跑（永不豁免②，含负余额断言读法）；审计写入一律显式 `requestId`；新审计码出生即冻结四属性（含义 / actionDomain / correlationMode / 特有必填，`assertActionSpec` 校验）
- 根纲 §2 禁做清单与六铁律全程适用；派 subagent 的 prompt 必须带根纲 §0–§5 要点
- 执行环境：worktree 隔离（`superpowers:using-git-worktrees`），栈用 self；shell 每条命令前置 nvm20 PATH（`export PATH="$(ls -d $HOME/.nvm/versions/node/v20* | sort -V | tail -1)/bin:$PATH"`）
- 随手闸每任务必跑：`npx tsc --noEmit -p tsconfig.json` ＋ 本任务相关 jest（仓库根跑）；改了 admin-web 另跑 `cd admin-web && npx tsc -b --noEmit`；改前端的任务必须 preview 渲染＋截图（tsc 不算数）
- 测试绿必须来自行为，禁「扫源码文本」型断言
- **命名纠偏（覆盖 spec 简写）**：审计码按仓库真实惯例全称——新增 `LP_PROFILE_SCREENED`、`LP_ADDRESS_*` 族 8 码、`LP_EXCHANGE_DELIVERY_SCREENED`；退役 `LP_PROFILE_CHANGE_{PROPOSED,APPLIED,REJECTED}`。业务单号前缀 `LPA`（已 grep 确认不撞现役族）
- 模型分层：任务执行与任务级 review 走执行档；**本波动钱动状态机，评审/终审不降档**（spec 点名升档）
- 新 admin 端点必须登记 `rbac.catalog.ts`（漏登 = 403）；合并 main 后必做 `db:base:sync` + 重启后端

## Review Focus

1. **法币 IBAN 登记尾号 `3333`** → 与链上同律「登记即拒」（IBAN 走 `screenAddress(iban, BANK_RAIL_NETWORK)` 先例）——测试入 Task 3
2. **同坐标重复登记**：非终态（待批/生效/停用）占用 → 拒；终态（REJECTED/CANCELLED/DEACTIVATED）后可重新登记——用应用层守卫不用 DB 唯一键——测试入 Task 3
3. **CFO 批准兑换单时所选地址已非 ACTIVE** → 落 `FAILED`（`failureReasonCode='PAYOUT_ADDRESS_INACTIVE'`，不建资金单，同余额闸先例）——测试入 Task 5
4. **⚡到货来源参数空串/全空白** → 视同未填，用干净占位、筛出 GREEN——测试入 Task 6
5. **`LP_ADDRESS_APPROVAL` 漏登 admin-web `approvalEntityRoutes.ts`** → 审批台 UI 永不渲染（甲教训）——Task 7 显式步骤＋走查核对

## 任务×清单命中表（各任务收尾自查，plan 写死）

| 任务 | 收尾过哪几条 |
|---|---|
| T1 | 改 schema（新迁移 / 空库能建 / 禁 backfill） |
| T2 | 持久状态写审计（显式 requestId）｜新审计码四属性冻结 |
| T3 | 新状态机加边 + **SLA 答复：地址各态不计时**（待批超时由审批单自身 48h 兜底，无冷却无扫描）｜对外业务键（LPA，投影零 UUID） |
| T4 | **新增审批策略 → `scripts/verify-rbac.ts` 的 `MAKER_GROUP_BY_POLICY` 加 `LP_ADDRESS_APPROVAL` 行**（表外策略不受自批死锁闸保护——调账单判例）｜新 admin 端点 rbac.catalog 登记｜新审计码四属性 |
| T5 | 持久状态写审计｜涉钱但记账结构零改动（verify:coa 由 T11 兜） |
| T6 | 新审计码｜持久状态写审计 |
| T7/T8 | 新业务动作前端有入口｜改前端必截图（永不豁免①） |
| T9 | 退役动作**前端入口同步删**（幽灵按钮判例）｜改 schema｜**审批策略退役 → `MAKER_GROUP_BY_POLICY` 摘 `LP_PROFILE_CHANGE` 行 + `verify:rbac` 全绿**｜种子改动的 data.md/script.md 同步在 T10 |
| T10 | 改页面/种子 → 同步 `demo/data.md`（**生成区由 demo:all 自己写，不手改**）+ `demo/script.md`｜每轮收尾：CHANGELOG 一行 + BACKLOG 落账 + §9 报告行 |
| T11 | 永不豁免两条：前端行为截图 ＋ 动钱 verify:coa（负余额断言是起点缺笔的唯一探针，恒等式绿不豁免它） |

不触发的行（根本没命中，非跳过）：交易三域一致性（LP 属财资域）｜客户面白名单（client-web 零触碰）｜新事件（无 domain event 新增）｜新权限组（复用 LP_READ / LP_WRITE / DEMO_VERDICT_WRITE）｜多波承接（本轮单波）。

---

### Task 1: Schema 加法迁移 + reset 登记

**Files:**
- Modify: `prisma/schema.prisma`、`scripts/reset-business-data.ts`
- Create: `prisma/migrations/<ts>_lp_two_step_additive/migration.sql`（`prisma migrate dev` 生成）

**Interfaces（Produces，后续任务全依赖）:**
- 新 model `LpPayoutAddress`：`addressNo`(unique)、`lpId`/`lpNo`、`assetId`、链上组 `network?`/`address?`、法币组 `iban?`/`bankName?`/`swiftBic?`、`declaredHosting?`、`addressType?`、`hostingMismatch Boolean @default(false)`、`counterpartyVaspName?`/`counterpartyVaspDid?`、`screeningAnswer?`/`screenedAt?`、`evidenceRef String`、`label?`、`approvalNo?`、`status String @default("PENDING_APPROVAL")`、`suspendedAt?`/`cancelledAt?`/`deactivatedAt?`、`traceId`、时间戳；relation → `LiquidityProvider`；索引 `@@index([lpId, assetId, status])`。**不建坐标唯一键**（Review Focus 2 的守卫在应用层）
- `LiquidityProvider` 加三列：`screeningAnswer String?`、`screenedAt DateTime?`、`dueDiligenceRef String?`（schema 可空，必填在 DTO 层——本任务不动种子）
- `LpExchange` 加七列：`payoutAddressNo?`、`payoutAddress?`、`payoutIban?`、`deliveryFromAddress?`、`deliveryFromIban?`、`deliveryScreeningAnswer?`、`deliveryScreenedAt?`

- [ ] **Step 1**: schema 落上述三处 → `npx prisma migrate dev --name lp_two_step_additive` + `npx prisma generate`
- [ ] **Step 2**: `scripts/reset-business-data.ts` 删表序加 `lpPayoutAddress`（在 `lpExchange` 之后、`liquidityProvider` 之前——FK 方向）
- [ ] **Step 3**: 验证：`npx tsc --noEmit -p tsconfig.json` 过；`bash scripts/stack.sh reset self` 从零重铺全绿（加法迁移不碰既有种子）
- [ ] **Step 4**: Commit `feat(lp): additive schema for two-step onboarding + payout address book`

### Task 2: 实体背调——mock + 建档流程改造

**Files:**
- Create: `src/modules/asset-treasury/lp-desk/lp-entity-screening.mock.ts`
- Modify: `lp-profile-workflow.service.ts`（`initiateCreate`）、`dto/lp-profile.dto.ts`、`lp-profile.service.ts`（投影加三字段）、`src/modules/audit-logging/constants/audit-actions.constant.ts`
- Test: `lp-profile-workflow.service.spec.ts`

**Interfaces:**
- Produces: `screenLpEntityName(name: string): ScreeningAnswer`（纯函数：`/sanction/i`→RED、`/offshore/i`→YELLOW、其余 GREEN；`ScreeningAnswer` 类型从 `sumsub-shared/travel-rule/travel-rule-adapter.interface` import）
- Produces: 建档 DTO 新必填 `dueDiligenceRef: string`（trim 非空）；审批 `objectSnapshot` 新键 `screeningAnswer`、`dueDiligenceRef`
- 审计：`LP_PROFILE_SCREENED` 新码（`CAMPAIGN_B_LP_PROFILE_AUDIT_ACTIONS` 表内，`requiredFields` 照族内惯例）

- [ ] **Step 1**: 写失败测试三条——①名称含 `Sanction` 建档 → 档案落 `REJECTED`、不开审批单、审计序列 `LP_PROFILE_CREATED`+`LP_PROFILE_SCREENED`+`LP_PROFILE_REJECTED`（reason 固定 `Entity screening returned RED at registration`）；②名称含 `Offshore` → `screeningAnswer='YELLOW'` 且照常 `PENDING_APPROVAL` 开审批、快照含两新键；③缺 `dueDiligenceRef` → 400
- [ ] **Step 2**: `npx jest src/modules/asset-treasury/lp-desk/lp-profile-workflow -t "背调"` → FAIL
- [ ] **Step 3**: 实现：`initiateCreate` 开头调 `screenLpEntityName`，RED 走落点计算（直建 `REJECTED` 行，同客户地址 3333 先例），GREEN/YELLOW 落 `screeningAnswer/screenedAt` 后走既有审批路径
- [ ] **Step 4**: 测试过 + 随手闸 → Commit `feat(lp): entity screening at profile registration`

### Task 3: 地址簿主体（迁移表 + service 落点计算）

**Files:**
- Create: `lp-desk/constants/lp-payout-address-transitions.constant.ts`（+ 同名 spec：锁态数边数）、`lp-desk/lp-payout-address.service.ts`
- Modify: `lp-desk.module.ts`（provide `TRAVEL_RULE_ADAPTER` → `MockTravelRuleAdapter`，第四个 provide 点）
- Test: `lp-payout-address.service.spec.ts`

**Interfaces:**
- Produces: 六态 `PENDING_APPROVAL/ACTIVE/SUSPENDED/DEACTIVATED/REJECTED/CANCELLED`；六动作 `APPROVE/REJECT/CANCEL/SUSPEND/REACTIVATE/DEACTIVATE`；边：`PENDING_APPROVAL→{ACTIVE,REJECTED,CANCELLED}`、`ACTIVE⇄SUSPENDED`、`ACTIVE→DEACTIVATED`
- Produces: `LpPayoutAddressService.create(input): Promise<LpPayoutAddress>`——落点计算：调 adapter `attributeAddress`（仅链上）+`screenAddress`（IBAN 传 `BANK_RAIL_NETWORK`），RED→直落 `REJECTED`，否则 `PENDING_APPROVAL`；算 `hostingMismatch`；`generateReferenceNo('LPA')`
- Produces: `transition(addressNo, action, patch?)`（非法跃迁 409）、`updateLabel(addressNo, label)`（只收 label）、`findByNo`、`listByLp(lpNo)`
- 守卫（service 层）：档案非 ACTIVE 拒；`evidenceRef` trim 非空；链上必填 `declaredHosting`；**同 (lpId, 坐标) 非终态行已存在 → 409 `ADDRESS_ALREADY_REGISTERED`，终态后可重登**

- [ ] **Step 1**: 失败测试——迁移表 spec（6 态 6 边穷举）；service：①尾号 3333 链上地址登记即 `REJECTED`；②**IBAN 尾号 3333 同律即拒**（Review Focus 1）；③尾号 1111 落 `addressType` 归因 + 自报 SELF_CUSTODY 时 `hostingMismatch=true`；④档案 SUSPENDED 登记 → 409；⑤同坐标 PENDING 占用重登 → 409，REJECTED 后重登 → 成功（Review Focus 2）；⑥ `updateLabel` 改坐标字段不可能（方法签名只收 label）＋ `transition('ACTIVE'→'ACTIVE')` 非法 409
- [ ] **Step 2**: 跑 → FAIL；**Step 3**: 实现（照 `lp-profile.service.ts` 迁移表写法与零 UUID 投影惯例）；**Step 4**: 过 + 随手闸 → Commit `feat(lp): payout address book subject with screening-at-registration`

### Task 4: 地址审批 + ⚡覆写 + 端点

**Files:**
- Create: `lp-desk/lp-payout-address-workflow.service.ts`、`lp-desk/lp-payout-address-approval.service.ts`、`lp-desk/lp-payout-address.controller.ts`、`lp-desk/dto/lp-payout-address.dto.ts`
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`（三处：ActionTypes ~L96 / policy 表 ~L457 照 `LP_PROFILE_APPROVAL` 同形状 / 白名单数组 ~L533）、`scripts/verify-rbac.ts`（`MAKER_GROUP_BY_POLICY` 加 `LP_ADDRESS_APPROVAL` 行——人工维护表，漏加不受自批死锁闸保护）、`audit-actions.constant.ts`（新表 `LP_ADDRESS_AUDIT_ACTIONS`：`LP_ADDRESS_{REGISTERED,SCREENED,APPROVED,REJECTED,CANCELLED,SUSPENDED,REACTIVATED,DEACTIVATED}` 8 码 + subjectType `LP_ADDRESS` 登记）、`rbac.catalog.ts`（新端点逐条登记）
- Test: `lp-payout-address-workflow.service.spec.ts`

**Interfaces:**
- Produces: `registerAddress(lpNo, dto, actor)`（建行；非 RED 开 `LP_ADDRESS_APPROVAL` 审批，objectSnapshot 键：`addressNo/lpNo/lpName/assetCode/coordinate/declaredHosting/addressType/screeningAnswer/evidenceRef/impact`）、`onApproved/onRejected(case)`、`cancel/suspend/reactivate/deactivate(addressNo, actor)`（启停退留痕不批）、`feedScreening(addressNo, answer, reason, actor)`（仅 `PENDING_APPROVAL`：GREEN/YELLOW 覆写记 `LP_ADDRESS_SCREENED`，RED 走 REJECT 边）
- 端点（RBAC：读 `LP_READ`、写 `LP_WRITE`、⚡挂 `DEMO_VERDICT_WRITE`）：`GET/POST /admin/lp-profiles/:lpNo/payout-addresses`、`GET /admin/lp-payout-addresses/:addressNo`、`POST .../:addressNo/{cancel,suspend,reactivate,deactivate}`、`PATCH .../:addressNo/label`、`POST .../:addressNo/simulate-screening`（body `{answer, reason}`，照客户簿同款）

- [ ] **Step 1**: 失败测试——①登记→CFO 批→ACTIVE 全链（审批快照键齐）；②CFO 拒→REJECTED；③待批时 ⚡喂 RED→REJECTED 记 `LP_ADDRESS_REJECTED`、喂 YELLOW 只改结论记 `LP_ADDRESS_SCREENED`；④ACTIVE 后 feedScreening → 409；⑤suspend/reactivate/deactivate 各留痕不开审批
- [ ] **Step 2**: FAIL → **Step 3**: 实现（审批薄壳照 `lp-profile-approval.service.ts` 逐行同构）→ **Step 4**: 过 + 随手闸 + `npm run audit:vocab` 跑通 → Commit `feat(lp): payout address approval flow with simulate-screening backdoor`

### Task 5: 开单消费侧（选地址抄单 + 腿 1 坐标 + 批时复查）

**Files:**
- Modify: `lp-desk/dto/lp-exchange.dto.ts`（`payoutAddressNo: string` 必填）、`lp-exchange-workflow.service.ts`（`initiate` 守卫+抄单；`onApproved` 腿 1 坐标 ~L186-199；批时复查）、`lp-exchange.service.ts`（投影带 payout 三列）
- Test: `lp-exchange-workflow.service.spec.ts`

**Interfaces:**
- Consumes: Task 3 `findByNo`；Task 1 的 `LpExchange.payout*` 三列
- Produces: 开单守卫链——地址存在 ∧ `lpId` 匹配 ∧ `assetId===sellAssetId` ∧ `status==='ACTIVE'`，违者 400（各自错误码 `PAYOUT_ADDRESS_{NOT_FOUND,WRONG_LP,ASSET_MISMATCH,INACTIVE}`）；通过则抄 `payoutAddressNo/payoutAddress/payoutIban` 进单据；审批快照加 `payoutAddressNo/coordinate`
- 腿 1 资金单 `toAddress/toIban` 改读**单据** payout 列（不读档案、不回读地址簿）；`onApproved` 开头复查地址仍 ACTIVE，否则落 `FAILED`（`failureReasonCode='PAYOUT_ADDRESS_INACTIVE'`，零资金单——同余额闸形状）

- [ ] **Step 1**: 失败测试——守卫四拒各一条；正路抄单三列 + 腿 1 to 坐标=地址条目值；**批准时地址已 SUSPENDED → FAILED 零资金单**（Review Focus 3）
- [ ] **Step 2**: FAIL → **Step 3**: 实现 → **Step 4**: 过 + 随手闸 → Commit `feat(lp): exchange initiation selects an active payout address (snapshot-on-order)`

### Task 6: 到货来源筛查

**Files:**
- Modify: `lp-exchange-workflow.service.ts#simulateDelivery`（~L262-295）、`lp-exchange.controller.ts`（simulate-delivery body）、`dto/lp-exchange.dto.ts`（`SimulateLpDeliveryDto { fromSource?: string }`）、`audit-actions.constant.ts`（`LP_EXCHANGE_DELIVERY_SCREENED` 入兑换族表）
- Test: `lp-exchange-workflow.service.spec.ts`

**Interfaces:**
- Produces: 常量 `DEFAULT_DELIVERY_SOURCE = { CRYPTO: <干净 TRON 占位串>, FIAT: <干净 IBAN 占位串> }`（值 builder 定，Task 10 抄进 `demo/data.md`）；`fromSource` trim 后为空视同未填（Review Focus 4）
- 行为：来源落腿 2 资金单 `fromAddress/fromIban`（废除抄档案坐标的旧写法）+ 单据 `deliveryFrom*` 快照；同步调 adapter `screenAddress`（crypto 传 buy 资产网络、法币传 `BANK_RAIL_NETWORK`）落 `deliveryScreeningAnswer/At` + 记 `LP_EXCHANGE_DELIVERY_SCREENED`；**验收 `accept` 不读筛查结论**——RED 单验收照常可执行

- [ ] **Step 1**: 失败测试——①⚡到货带尾号 3333 → 单据 RED + 审计留痕 + **验收仍成功**（拦人不拦状态的行为判据）；②不带参数 → 占位来源 + GREEN；③全空白串 → 同②；④腿 2 资金单 from 坐标=入参值（不再是档案值）
- [ ] **Step 2**: FAIL → **Step 3**: 实现 → **Step 4**: 过 + 随手闸 → Commit `feat(lp): delivery source screening at simulate-delivery (flag, no gate)`

### Task 7: 管理台·档案与地址簿

**Files:**
- Modify: `admin-web/src/pages/LpProfileList.tsx`（建档表单 + `dueDiligenceRef` 必填项）、`LpProfileDetail.tsx`（背调结论徽章区 + 「Payout addresses」区块：列表行/Register modal/行内动作）、`admin-web/src/pages/approvalEntityRoutes.ts`（`LP_ADDRESS_APPROVAL: (r) => \`/admin/lp-payout-addresses/${r}\``）、路由表
- Create: `admin-web/src/pages/LpPayoutAddressDetail.tsx`（route-only，不进导航——信息区 + Attribution/Red Flag/Screening 区块 + ⚡ Screening Simulation + 启停退动作；四区块照 `WithdrawalAddressDetail.tsx` 同款组件，操作段排信息段前）

**Interfaces:** Consumes Task 4 全部端点（路径与 body 以其为准）

- [ ] **Step 1**: 实现两页改造 + 新详情页 + entityRoutes 登记
- [ ] **Step 2**: `cd admin-web && npx tsc -b --noEmit` 过
- [ ] **Step 3**: preview 走查并截图（闸⑤）：建档填三件套 → 背调徽章；登记尾号 1111/2222/3333 三条各见归因/黄/当场拒；CFO 批后 ACTIVE；审批台打开 `LP_ADDRESS_APPROVAL` 深链点得进详情页（Review Focus 5）
- [ ] **Step 4**: Commit `feat(admin): LP profile screening badges + payout address book UI`

### Task 8: 管理台·兑换单

**Files:**
- Modify: `admin-web/src/pages/LpExchangeList.tsx`（开单 modal：选定卖出资产后列该 LP 该资产 ACTIVE 地址，必选；默认选中策略 builder 定）、`LpExchangeDetail.tsx`（LP 区块加打款地址行〔addressNo 业务键回链详情页〕；到货后新「Delivery screening」区：来源坐标 + 三档徽章，RED 醒目红；⚡ Simulate LP delivery 弹层加可选来源输入框）

- [ ] **Step 1**: 实现 → **Step 2**: admin tsc 过 → **Step 3**: preview 走查截图：开单选地址一拍（两条 USDT 地址可选时下拉可见）；⚡到货填 3333 → 详情 RED 徽章 + Accept 仍可点
- [ ] **Step 4**: Commit `feat(admin): address picker at initiation + delivery screening panel`

### Task 9: 退役与种子终态（本波最大任务，动 schema 必重铺）

**Files:**
- Modify: `lp-profile-workflow.service.ts`/`lp-profile-approval.service.ts`/`lp-profile.controller.ts`/`dto/lp-profile.dto.ts`（删 propose/applySettlementChange 全链）、`approval.constants.ts`（三处摘 `LP_PROFILE_CHANGE`）、`approvalEntityRoutes.ts`（摘行）、`audit-actions.constant.ts`（摘 `LP_PROFILE_CHANGE_*` 三码）、`LpProfileDetail.tsx`（摘改结算入口与坐标展示）、`prisma/schema.prisma`（drop `LiquidityProvider` 四坐标列，新迁移）、`prisma/seed.business.ts`（~L2177-2381 重写）
- Test: 既有 lp-desk specs 全量回归

**种子终态口径（spec §4）:**
- Falcon：`dueDiligenceRef='DD-2026-FALCON-001'`、背调 GREEN 回填；地址三条全 ACTIVE（AED IBAN ×1 复用 `buildSystemPoolIban('LP_FALCON','AED')`、USDT TRON ×2 用 `fakeTronAddress` 两个不同种子串），各配已批 `LP_ADDRESS_APPROVAL` 审批单（objectSnapshot 照 Task 4 真实形状，同 R15 甲案先例）+ 登记/批准审计
- Dune：`dueDiligenceRef` + GREEN 回填，零地址
- 历史 SUCCESS 兑换单：`payoutAddressNo` 指向 Falcon AED 地址、payout 坐标抄该条目；`deliveryFrom*` = 干净占位、`deliveryScreeningAnswer='GREEN'`；三腿资金单坐标改读新来源（腿 1 to=地址条目、腿 2 from=占位）

- [ ] **Step 1**: 退役四件套——现场逐键 grep `proposeSettlementChange|applySettlementChange|LP_PROFILE_CHANGE|fiatBankName|fiatIban|cryptoNetwork|cryptoAddress`（范围 src/ + admin-web/src/ + prisma/ + **scripts/**——`verify-rbac.ts` 的 `MAKER_GROUP_BY_POLICY` 必有 `LP_PROFILE_CHANGE` 行要摘），拿到消费者清单后逐一清除；预期终态：前三键 0 命中，后四键仅剩 `LpPayoutAddress`/提现域自己的同名字段（改前写下清单，改后复核对数——纪律 5）
- [ ] **Step 2**: schema drop 四列 → `prisma migrate dev --name retire_lp_profile_coordinates` + generate；种子按上述口径重写
- [ ] **Step 3**: 既有测试修绿（改结算相关 spec 用例删除；其余回归）：`npx jest src/modules/asset-treasury/lp-desk` 全绿 + 三连 tsc 全过
- [ ] **Step 4**: `bash scripts/stack.sh reset self` 重铺全绿；`npm run audit:vocab` 分域计数 = 原数 +10 −3（实测回填 spec/modules 文档由 Task 10 收口）；`bash scripts/on-stack.sh self verify:rbac`（或该脚本既有跑法）全绿——判据数随策略增删变动的，按输出实数回填本行
- [ ] **Step 5**: Commit `feat(lp)!: retire settlement-change flow & profile coordinates; seed to end-state`

### Task 10: 文档收口

**Files:**
- Modify: `doc-final/modules/lp-desk.md`（§1/2/3/5 按新现状重写，Last Verified 更新）、`doc-final/reference/sumsub-mock-touchpoints.md`（新行：实体背调——位置/行为/真集成对应照 spec §2.2 末段措辞「KYB 或人工尽调二选一，届时定」/刀口；② 行调用点列加 lp-desk 两处）、`doc-final/reference/sumsub-services-needed.md`（KYB 候补一行）、`doc-final/demo/data.md`（mock 速查：背调关键词、LPA 地址与占位来源串；种子清单）、`doc-final/demo/script.md`（场景 26/27 加「选地址」一拍；第九幕新场景一组照 spec §4 清单）、`doc-final/demo/baseline.md`（新判据行）、`doc-final/BACKLOG.md`（KYT house applicant 一行，照 spec 拍板 7 措辞）、`doc-final/CHANGELOG.md`
- [ ] **Step 1**: 逐文件落笔（真相只写已实现行为，对照代码不对照记忆）
- [ ] **Step 2**: 路由表自查：本波新文档均被 CLAUDE.md §8 既有行覆盖（modules/demo/reference），无需新行
- [ ] **Step 3**: Commit `docs(lp): two-step onboarding module truth + demo script + mock registry`

### Task 11: 收尾闸与走查

- [ ] **Step 1**: 随手闸三连（根 tsc / admin tsc / client tsc）+ `npx jest src/modules/asset-treasury` 全绿（**不接管道、看原始退出码**——module-parity 判例）
- [ ] **Step 2**: `bash scripts/stack.sh reset self` → `bash scripts/on-stack.sh self demo:all` 花名册全绿（对照 baseline）
- [ ] **Step 3**: `bash scripts/on-stack.sh self verify:coa` 全绿（动钱闸⑦）
- [ ] **Step 4**: 按 script.md 新场景逐拍走查 + 截图入 `doc-final/superpowers/checkups/2026-10-XX-lp-two-step-evidence/`：建档红黄绿 ｜ 地址 1111/2222/3333 三拍 ｜ CFO 批生效 ｜ 开单选地址 ｜ ⚡到货 3333 红旗 + 验收仍可点 ｜ 场景 26/27 回归
- [ ] **Step 5**: 对照 `doc-final/rules/delivery-checklist.md` 收尾；Commit `chore(lp): closing gates & walkthrough evidence`

---

## Self-Review 记录

- spec 全节对照：§2→T2，§3→T3/T4，§4 开单→T5、到货→T6、管理台→T7/T8、退役与种子→T9、文档→T10，§5 验收→T11；拍板 7（KYT BACKLOG 行）→T10。无缺口
- 命名一致性：`LpPayoutAddressService.create/transition/updateLabel/findByNo/listByLp` 与 T4/T5 消费处一致；审计码全称族贯穿 T2/T4/T6/T9/T10
- Review Focus 五条各有归属测试（T3×2、T5、T6、T7 走查）
- 比例：plan ≈ spec 1.5 倍，无成段代码体，步骤均为单决定
