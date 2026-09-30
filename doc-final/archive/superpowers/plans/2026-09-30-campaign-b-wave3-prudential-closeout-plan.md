# 战役乙波三 · NLA 红线 + 算术门 + 巡检 + 穿底主线 + 战役收官 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给公司资金看板画上监管红线（NLA=两币折算合计、1.2×月开支），付款/LP 两个提单口加事前算术门，金库巡检按钮接通「跌破→审慎事故→报送 VARA」甲既有链，修兑换腿权限缺口，走查穿底主线两场景，然后战役乙收官（第九幕定稿 / 销账 / decisions / 归档）。

**Architecture:** 新后端小模块 `asset-treasury/prudential/`（常量单源+计算服务+两端点），门以 L1 式「拒建单+DENIED 留痕」插进两个既有 workflow 的 initiate；审慎事故/报送/结案全走甲既有机制零改动；危机铺设是 recon-demo 的新独立模式。**零新表、零新转账码、零新审批类型**——执行中发现要加任何一个 = 停下上报。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle ｜ admin-web React ｜ jest

**Spec:** `doc-final/superpowers/specs/2026-09-30-campaign-b-wave3-prudential-closeout-spec.md`（§0 十裁定、§2-§4 门与巡检、§5 两场景帧序与校准表、§7 预期终态数量表、§10 验收判据）

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用
- 本轮特有：
  - **零新表 / 零新转账码（87 止）/ 零新审批类型（51 止）/ COA 十码零增删**（spec §7 表定死）——任何一项要突破 = 停下上报
  - 审计新码**只许两枚**：`PRUDENTIAL_CHECK_PERFORMED` / `PRUDENTIAL_GATE_BLOCKED`（TREASURY 域）；RBAC 增量**只许一桶一组**：`treasury.prudential_check` / `PRUDENTIAL_CHECK_WRITE`
  - **数字候选与校准判据**（spec §5 表）：月开支基数 1,000,000.00 AED（红线 1,200,000.00）/ 失窃 250,000.00 AED / 注资 300,000.00 AED——T6 按「先跑后选」实测钉死，若调整须回填 T1 常量注释 + spec §5 表 + T8/T9 剧本数字（**数字多处复述必漏改，改完 grep 清点**，甲判例）
  - ⚠️ 波二 MARKER 码 `cap.treasury.funding_dashboard` **必须保留**（删它=越权回归，骨架红字）；本波看板改动不碰其门控
  - **豁免是立场**：内部划转（补款/垫款）与注资**不接**算术门——执行者不得"顺手补上"；豁免的行为证明在 T8/T9 走查（跌破期补款/注资真实成功）
  - **SLA 判定（交付清单第 3 行的回答，写死在此）**：本波**零新状态、零新单据**，SLA 行不触发；巡检/门是动作不是状态，无计时语义
  - 本波动钱路径+动对账输入：**T1/T2/T6 任务级评审升档 opus**，其余执行档；终审 Fable 不降档（项目总纲 §6 派发表）
  - jest 必须在仓库根跑且带 `DATABASE_URL`（缺则假红——判例在案）；本机 shell 默认 node18，每条命令前置 nvm20 PATH（记忆在案）
  - 前端两条永不豁免：改前端必截图；动钱必 `verify:coa`
  - crisis 新 npm 脚本必须与既有 `recon:demo:*` 同律：**无内联默认值，缺 `DATABASE_URL`/`TB_ADDRESS` 当场 fail-fast**（2026-08-31 纪律），一律经 `on-stack.sh` 包装器跑
  - 变异测试的绿必须来自行为，禁止「扫源码文本」型断言（含"某模块没 import prudential"这类反向文本断言——豁免证明只认走查行为）

**任务模板（照抄对象，全程有效）**：门插点照 `vendor-payment-workflow.service.ts` initiate 既有前置检查段（`:81` 附近）；拦截审计照 `withdraw-workflow.service.ts:405-424`（`WITHDRAW_L1_BLOCKED` 信封）；RBAC/审计登记面照乙波二 plan T3/T10 同款清单。每个后端任务开工先读这三处。

---

### Task 1: 审慎地基——汇率单源 + 常量 + PrudentialService.computeStatus + GET status 端点 + 审计两码登记

**Files:**
- Modify: `src/modules/trading/pricing-center/providers/binance-rate.provider.ts`（`:29` 私有常量提为导出）
- Create: `src/modules/asset-treasury/prudential/prudential.constants.ts`
- Create: `src/modules/asset-treasury/prudential/prudential.service.ts`
- Create: `src/modules/asset-treasury/prudential/prudential.controller.ts`
- Create: `src/modules/asset-treasury/prudential/prudential.module.ts`（挂 `app.module.ts`；imports 照 company-funding.module：Prisma/Audit/TigerBeetle/AssetTreasury 钱包解析）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（两码五处登记）＋ `src/modules/audit-logging/constants/audit-vocabulary-closure.spec.ts`（名册基线十五→十六本）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（`GET /admin/prudential/status` route 挂 `['FUNDING_DASHBOARD_VIEW']`——登记进既有桶 `treasury.view_dashboard` 的组，零新组）
- Test: `src/modules/asset-treasury/prudential/prudential.service.spec.ts`

**Interfaces:**
- Consumes: `SystemWalletResolver.resolve(assetId, 'F_OPS')` + `AccountingService.lookupBalance`（取数方式**照抄** `vendor-payment.service.ts:98-109` 那段：`available = creditsPosted - debitsPosted - debitsPending`）
- Produces（后续任务全靠这些名字）: `AED_USD_PEG_RATE`（导出字符串常量 `'3.6725'`）；`MONTHLY_OPEX_BASE_AED_MINOR = 100_000_000n`；`NLA_FLOOR_AED_MINOR = 120_000_000n`；`usdtMinorToAedMinor(usdtMinor: bigint): bigint`；`PrudentialService.computeStatus(): Promise<PrudentialStatus>`，其中 `PrudentialStatus = { perAsset: { assetCode, currency, balanceMinor: string, aedEquivalentMinor: string }[], nlaAedMinor: string, floorAedMinor: string, headroomAedMinor: string, breached: boolean, monthlyOpexBaseAedMinor: string, coefficient: '1.2' }`；端点 `GET /admin/prudential/status`；审计码两枚

- [ ] **Step 1: 汇率单源**——`binance-rate.provider.ts`：
```ts
/** AED 钉住汇率单源（战役乙波三提出为导出常量）：provider 报价与审慎 NLA 折算同源引用，不复制。 */
export const AED_USD_PEG_RATE = '3.6725';
```
`private readonly aedUsdRate = new Prisma.Decimal(AED_USD_PEG_RATE);`——provider 行为零变化（既有 swap 报价测试全绿为证）。
- [ ] **Step 2: 常量**——`prudential.constants.ts`：
```ts
import { Prisma } from '@prisma/client';
import { AED_USD_PEG_RATE } from '../../trading/pricing-center/providers/binance-rate.provider';

/** 月开支基数（AED 分）——演示写死常量，叙事含工资/房租等系统外开支（总纲不建⑫⑬）。
 *  候选 1,000,000.00 AED；T6 危机校准若调整须同步 spec §5 表与场景 31/32 数字。 */
export const MONTHLY_OPEX_BASE_AED_MINOR = 100_000_000n;
/** NLA 红线 = 1.2 × 月开支（Company VI.C.1，系数条款定死不可配）。 */
export const NLA_FLOOR_AED_MINOR = (MONTHLY_OPEX_BASE_AED_MINOR * 12n) / 10n; // 120,000,000 分 = 1,200,000.00 AED

/** USDT(6dp 分) → AED(2dp 分)：×3.6725 再降 4 个小数位，向下取整（保守）。
 *  例：113_600_000_000 µUSDT → 41_719_600 fils（=417,196.00 AED）。 */
export function usdtMinorToAedMinor(usdtMinor: bigint): bigint {
  return BigInt(new Prisma.Decimal(usdtMinor.toString()).mul(AED_USD_PEG_RATE).div(10_000).floor().toFixed(0));
}
```
- [ ] **Step 3: 审计两码**——`AuditBusinessWorkflowTypes` 加 `PRUDENTIAL`；`AuditEntityTypes` 加 `PRUDENTIAL_STATUS`（主体业务键固定 `'NLA'`——度量名当业务键，零 UUID）；契约表新 `CAMPAIGN_B_PRUDENTIAL_AUDIT_ACTIONS` 并入总注册（照 CAMPAIGN_B_CAPITAL_INJECTION 表挂法）：
```ts
PRUDENTIAL_CHECK_PERFORMED: { domain: 'TREASURY', correlationMode: N, requiredFields: ['reasonCode'], requiresCausation: false },
PRUDENTIAL_GATE_BLOCKED:    { domain: 'TREASURY', correlationMode: N, requiredFields: ['reasonCode','reason'], requiresCausation: false },
```
信封通则：primarySubject=`PRUDENTIAL_STATUS`·`'NLA'`；metadata 必带三个数（nlaAedMinor/floorAedMinor + 动后或缺口）；显式 `requestId`（`${action}_NLA_${randomUUID()}`）。`audit-vocabulary-closure.spec.ts` 名册清单加第十六本（漏了封册测试直接红——它就是防漏登记的闸）。outcome 取值开工 grep `AuditOutcome` 枚举实名取用：BLOCKED 用 `DENIED`（照 WITHDRAW_L1_BLOCKED）；CHECK 的 PASS/BREACH 用 `reasonCode: 'NLA_OK' | 'NLA_BREACH'` 区分、outcome 都用成功值（若枚举有告警值则 BREACH 改用之并回填 spec §4 措辞）。
- [ ] **Step 4: computeStatus**——查两资产（`prisma.asset` 按 currency ∈ {AED, USDT}）→ 逐资产 resolve F_OPS 钱包 → lookupBalance → available 口径同 `assertFirmOpsBalance` → AED 直加、USDT 经 `usdtMinorToAedMinor` → 汇总 `nlaAedMinor`、`headroomAedMinor = nla - floor`、`breached = nla < floor`。纯读零写。
- [ ] **Step 5: controller + RBAC**——`GET /admin/prudential/status`（`@RequirePermissions(buildPermissionCode('GET','/admin/prudential/status'))`）；`rbac.catalog.ts` route() 一条挂 `['FUNDING_DASHBOARD_VIEW']`（四职务本就持有，零权限扩张；不加新桶——语义归看板既有桶 `treasury.view_dashboard`）。
- [ ] **Step 6: 单测先红后绿**：
```ts
it('converts USDT minor to AED minor at the peg (113_600_000_000n → 41_719_600n)', ...);
it('computeStatus sums AED + converted USDT and flags breach when below floor', ...);  // mock 两钱包余额，一组在线上、一组在线下各断言
it('headroom is negative-safe (breached ⇒ headroom < 0 as string)', ...);
```
- [ ] **Step 7: 闸**——根 tsc + `npx jest src/modules/asset-treasury/prudential src/modules/audit-logging --rootDir .` 全绿（封册测试必须在本任务转绿）；`npm run db:base:sync` 记入交接。
- [ ] **Step 8: Commit** `feat(乙波三T1): 审慎地基——汇率单源+NLA常量与折算+computeStatus+status端点+审计两码第十六册`

---

### Task 2: 算术门——assertPostOutflowCompliant + 付款/LP 两个插点 + 变异测试

**Files:**
- Modify: `src/modules/asset-treasury/prudential/prudential.service.ts`（加门方法）
- Modify: `src/modules/asset-treasury/company-funding/vendor-payment-workflow.service.ts`（initiate 插门，紧邻 `:81` 既有 `assertFirmOpsBalance` 前置检查之后）
- Modify: `src/modules/asset-treasury/lp-desk/lp-exchange-workflow.service.ts`（initiate 插门，卖出边）
- Modify: `src/modules/asset-treasury/company-funding/company-funding.module.ts` + `src/modules/asset-treasury/lp-desk/lp-desk.module.ts`（imports PrudentialModule）
- Test: `prudential.service.spec.ts`（扩）+ `vendor-payment-workflow.service.spec.ts`（扩）+ `lp-exchange-workflow.service.spec.ts`（扩）

**Interfaces:**
- Consumes: T1 `computeStatus`/`usdtMinorToAedMinor`/常量
- Produces: `PrudentialService.assertPostOutflowCompliant(input: { currency: 'AED' | 'USDT'; amountMinor: bigint; orderKind: 'VENDOR_PAYMENT' | 'LP_EXCHANGE'; counterpartyNo: string; actor: ApprovalActorContext }): Promise<void>`——通过则静默返回；拦截则**先写审计后抛 400**

- [ ] **Step 1: 门方法**：
```ts
async assertPostOutflowCompliant(input): Promise<void> {
  const status = await this.computeStatus();
  const outflowAed = input.currency === 'AED' ? input.amountMinor : usdtMinorToAedMinor(input.amountMinor);
  const after = BigInt(status.nlaAedMinor) - outflowAed;
  if (after >= BigInt(status.floorAedMinor)) return;
  // 被拦下也留痕（单未建、无单号）——照 WITHDRAW_L1_BLOCKED 形制
  await this.auditLogsService.recordByActor({
    action: 'PRUDENTIAL_GATE_BLOCKED', actionDomain: 'TREASURY', category: AuditCategory.BUSINESS,
    primarySubjectType: 'PRUDENTIAL_STATUS', primarySubjectNo: 'NLA', outcome: AuditOutcome.DENIED,
    reasonCode: 'NLA_FLOOR', reason: `${input.orderKind} to ${input.counterpartyNo} blocked: NLA after outflow would fall below the regulatory floor`,
    subjects: [{ subjectType: /* 对手方实体码开工 grep 实测：外包商/ LP 档案实体码已存在则引用，否则仅落 metadata */, subjectNo: input.counterpartyNo, subjectRole: AuditSubjectRole.RELATED }],
    metadata: { orderKind: input.orderKind, counterpartyNo: input.counterpartyNo, currency: input.currency, amountMinor: String(input.amountMinor), nlaBeforeAedMinor: status.nlaAedMinor, nlaAfterAedMinor: String(after), floorAedMinor: status.floorAedMinor },
    requestId: `PRUDENTIAL_GATE_BLOCKED_NLA_${randomUUID()}`,
  }, actorEnvelope(input.actor));
  throw new BadRequestException(
    `Blocked by prudential floor (Company Rulebook VI.C): this ${label(input.orderKind)} would take Net Liquid Assets below the regulatory floor — NLA now ${fmtAed(status.nlaAedMinor)}, after ${fmtAed(after)}, floor ${fmtAed(status.floorAedMinor)}.`,
  );
}
```
话术必带三个数（spec §3；`fmtAed` 分→元两位小数，最小单位铁律在展示串这一处换算）。
- [ ] **Step 2: 付款插点**——`vendor-payment-workflow.service.ts` initiate：既有 `assertFirmOpsBalance` 之后加 `await this.prudential.assertPostOutflowCompliant({ currency: asset.currency, amountMinor, orderKind: 'VENDOR_PAYMENT', counterpartyNo: dto.vendorNo, actor })`——两闸各管各的（余额闸=付得起，NLA 门=付完还合规），顺序先余额后 NLA。
- [ ] **Step 3: LP 插点**——`lp-exchange-workflow.service.ts` initiate：守卫段后按**卖出边**加 `assertPostOutflowCompliant({ currency: sellAsset.currency, amountMinor: sellAmountMinor, orderKind: 'LP_EXCHANGE', counterpartyNo: dto.lpNo, actor })`——买入腿是未来进项不抵扣（spec §3，保守口径与「在途不计」同轴）。
- [ ] **Step 4: 变异测试先红后绿**（mock computeStatus 控制水位；spec §10.2 的单测半）：
```ts
it('blocks a vendor payment whose outflow would cross the floor (400 + three figures in message)', ...);
it('passes a vendor payment within headroom', ...);
it('blocks an LP exchange by its SELL side only (buy side not credited)', ...);
it('converts USDT outflow before comparing (USDT payment can trip an AED-denominated floor)', ...);
it('writes PRUDENTIAL_GATE_BLOCKED with DENIED before throwing', ...);   // 断言 audit 先于异常
it('existing balance gate still runs independently (insufficient balance still 400s with its own message)', ...);
```
豁免（划转/注资不接门）**不写反向文本断言**——行为证明在 T8/T9 走查（Global Constraints）。
- [ ] **Step 5: 闸**——根 tsc + prudential、company-funding、lp-desk 三目录 jest 全绿。
- [ ] **Step 6: Commit** `feat(乙波三T2): NLA算术门——付款/LP两提单口拒建单+DENIED留痕+三个数话术`

---

### Task 3: 巡检——POST check 端点 + 新桶新组 RBAC 四处

**Files:**
- Modify: `src/modules/asset-treasury/prudential/prudential.service.ts`（加 `performCheck`）+ `prudential.controller.ts`（加 POST）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（联合类型 +`'PRUDENTIAL_CHECK_WRITE'`；route() 一条；Treasury 桶 +1；金库职务绑定 +1）
- Test: `prudential.service.spec.ts`（扩）

**Interfaces:**
- Consumes: T1 computeStatus
- Produces: `PrudentialService.performCheck(actor): Promise<PrudentialStatus>`（实算+审计+返回）；端点 `POST /admin/prudential/check`；组 `PRUDENTIAL_CHECK_WRITE`（唯金库）；桶 `treasury.prudential_check`——T4 按钮、T7 判据全靠这些名字

- [ ] **Step 1: performCheck**——computeStatus → 写 `PRUDENTIAL_CHECK_PERFORMED`（recordByActor，reasonCode `NLA_OK`/`NLA_BREACH`，metadata=status 全量快照，requestId 显式）→ 返回 status。**不自动生成事故**（甲波五判例：事件登记须有操作人；PRUDENTIAL_BREACH 经办 CFO 族独占）——服务注释写明这句，防后人"顺手补全"。
- [ ] **Step 2: RBAC 四处**——联合类型 +1；route：
```ts
route('POST', '/admin/prudential/check', 'Run prudential (NLA) check', ['PRUDENTIAL_CHECK_WRITE']),
```
桶（Treasury 域数组，`treasury.view_dashboard` 旁）：
```ts
{ key: 'treasury.prudential_check', label: 'Run daily prudential check',
  description: 'Compute Net Liquid Assets against the regulatory floor on demand and log the result — the demo stand-in for the daily monitoring job', groups: ['PRUDENTIAL_CHECK_WRITE'] },
```
职务绑定：`TREASURY_OFFICER` 行加 `'PRUDENTIAL_CHECK_WRITE'`（**唯金库**——运营/CFO/合规官等一律不加，T7 判据）。
- [ ] **Step 3: 单测**——`performCheck` 两分支各断言审计 reasonCode 与 metadata 快照键齐；二连跑写两条（无去重语义——每次核对都是一次留痕）。
- [ ] **Step 4: 闸**——根 tsc + prudential 目录 jest 全绿；`npm run db:base:sync` + **重启后端**记入交接（只 seed 不重启=403，清单第 8 行）。
- [ ] **Step 5: Commit** `feat(乙波三T3): 巡检端点——performCheck审计留痕+prudential_check桶+CHECK_WRITE组唯金库`

---

### Task 4: 看板前端——NLA 区（红线/横幅/巡检按钮）

**Files:**
- Modify: `admin-web/src/pages/CompanyFundsDashboard.tsx`（新增 NLA 区块，置于五区之上）
- Modify: `admin-web/src/pages/companyFundsThresholds.ts`（头注释追加一句：NLA 红线不在此文件——单源在后端 `prudential.constants.ts`，本文件只管分币种见底线）
- Modify: `admin-web/src/rbac/permissions.ts`（`PRUDENTIAL_CHECK_WRITE` 前端码——取值形态照 `FUNDS_ORDER_PUSH_WRITE` 现有写法 grep 后同款）

**Interfaces:**
- Consumes: T1 `GET /admin/prudential/status`（返回 `PrudentialStatus`，全部最小单位字符串）；T3 `POST /admin/prudential/check`；既有 `gaugeScale()`/`OperatingBalanceCard` 的水位条与刻线渲染模式（`CompanyFundsDashboard.tsx:105-151`）
- Produces: 看板 NLA 区（全部 dashboard 观众可见）+ 巡检按钮（唯持码人可见）

- [ ] **Step 1: NLA 区块**——标题 `Net Liquid Assets (regulatory)`：合计水位条（分子=nlaAedMinor，红线刻线在 floorAedMinor 位置，照既有阈值刻线样式但用红色区分「监管红线」与琥珀色「见底线」）+ 三个数并排（NLA / Floor / Headroom，分→元展示换算）+ perAsset 折算小注（`AED xxx + USDT xxx ≈ AED xxx @ 3.6725`）；`breached` 时整区红边 + 横幅 `NLA below regulatory floor — shortfall AED x. A prudential incident must be registered (Incident Register, CFO).`（纯文案无按钮——登记入口在事件中心，CFO 族独占）。
- [ ] **Step 2: 巡检按钮**——区块头部 `Run prudential check`（`hasPermission(PERMISSIONS.PRUDENTIAL_CHECK_WRITE)` 才渲染；**不挂** useSimulationMode——巡检是真实业务动作不是 ⚡）；点击 POST → 结果内联卡（绿 `NLA_OK`：三个数 + `Logged to audit trail`；红 `NLA_BREACH`：缺口 + 同横幅话术）→ 顺手刷新 status。
- [ ] **Step 3: 闸（两条永不豁免①）**——admin tsc；self 栈 `stack.sh reset self` → `up` → preview：金库视角截「NLA 区正常态 + 巡检绿结果」帧、CFO 视角截「有区无按钮」帧、运营快速登录截「无看板入口」负例帧；截图入 `doc-final/superpowers/checkups/2026-09-30-campaign-b-wave3-evidence/`（按实际日期定名，后续任务沿用）。跌破态的红横幅/红结果帧留 T8（危机现场才有）。
- [ ] **Step 4: Commit** `feat(乙波三T4): 看板NLA区——合计水位+红线刻线+跌破横幅+金库巡检按钮`

---

### Task 5: 兑换腿权限重挂（丙案）

**Files:**
- Modify: `src/modules/identity/access-control/rbac.catalog.ts:435`（groups `['TRADING_SWAP_WRITE']` → `['FUNDS_ORDER_ACT']`，仅此一处——controller 装饰器走 `buildPermissionCode` 自动跟随）

**Interfaces:**
- Consumes: 波二 §E 缺口事实（面板门控 `FUNDS_ORDER_PUSH_WRITE`@`FundsOrderDetail.tsx:218,525` 与端点组两分裂）
- Produces: 兑换腿推进端点归金库（推单纪律 2026-09-10 定案顺延）；T7 探针、T11 主线一走查依赖此修

- [ ] **Step 1: 重挂**——改 `:435` 一行 groups；grep `TRADING_SWAP_WRITE` 全文确认该组其余挂载（处理兑换/提拒退等）**原样不动**——本任务只动这一条路由（纪律 4：每行改动可追溯，spec §0 裁定 6）。
- [ ] **Step 2: 桶目录核对**——`ACTION_BUCKET_CATALOG` 零改动预期（桶引组、路由引组，桶不列路由）；跑 `verify:rbac` 既有 S13d 三源并集判据确认仍 89 前的基线数（本任务不动组数）。
- [ ] **Step 3: 行为快证**——self 栈 `db:base:sync` + 重启后：`curl` 金库 token POST 该端点（任意 swapNo）预期**非 403**（业务 404/400 均算通过——权限门已开）；运营 token 同端点预期 **403**。命令+状态码记入交接。
- [ ] **Step 4: 闸**——根 tsc；`verify:rbac` 全量跑、既有红集与波前基线恒等。
- [ ] **Step 5: Commit** `fix(乙波三T5): 兑换腿推进端点改挂FUNDS_ORDER_ACT——推单归金库定案顺延,面板与端点同源`

---

### Task 6: 危机铺设——recon:demo:crisis 模式 + 金额校准（先跑后选）

**Files:**
- Modify: `scripts/recon-demo.ts`（新 mode `crisis`：只铺一条 AED 大额未授权转出外部账单行，照场景⑱ `:1696-1730` 同构；常量段照⑱字面量风格）
- Modify: `package.json`（`"recon:demo:crisis": "ts-node -r tsconfig-paths/register scripts/recon-demo.ts --mode=crisis"`）
- Modify: `doc-final/demo/baseline.md`（新增「乙波三 NLA 静态判据」节：reset 后 NLA 合计期望值、红线值、crisis 后跌破期望——由常量+基线推得）

**Interfaces:**
- Consumes: T1 常量（校准的红线基准）；⑱ 的 `planByOwnerAsset`/外部账单行直写机制
- Produces: `CRISIS_THEFT_AED_MINOR` 字面量常量（`recon-demo.ts` 内，候选 `D('25000000')` 分 = 250,000.00 AED）+ 选定客户钱包；T8 场景 31 的 ⚡起点

- [ ] **Step 1: 先跑后选**（⑱ 方法论 `:1698-1701`）——self 栈 `reset` → `up` → `demo:all` 后直读：Bob AED 托管钱包当刻余额（其 250,000 在途提现单的当刻影响一并核）、F_OPS(AED)、F_OPS(USDT)；算 NLA 前值。对 spec §5 校准表五判据逐条验：①失窃 < F_OPS(AED) ②NLA前−失窃 < 1,200,000.00 < NLA前 ③失窃 ≤ 选定客户钱包余额 ④F_OPS(AED)−失窃 < 900,000（双线齐红加分项）⑤场景 26/29 金额不误伤。Bob 撑不住 250,000 就换候选（次选降失窃额并连动②重验；**改数须回填 T1 注释 + spec §5 + T8/T9 剧本，grep 清点复述处**）。五判据的实测数字+复现命令记入交接。
- [ ] **Step 2: crisis 模式**——照⑱裁剪：只写**一条**外部账单行（选定客户 AED 钱包、借方流出、我方无单、金额=常量；参考号 `CRISIS-...` 族便于走查指认）；**不触碰** 18 场景常规集与 pass 模式；头注释写明用途（场景 31 专用 ⚡、reset 即消、可反复演）与用法（必经 `on-stack.sh`）。
- [ ] **Step 3: 隔离与失效双证**——①隔离：reset 干净库跑 `recon:demo:break` 仍 **18/18**（crisis 不混入）；②生效：reset → demo:all → `on-stack self recon:demo:crisis` → 跑对账 → **恰开 1 案**、差异行 ORPHAN_EXTERNAL/CLIENT、金额=常量；③失效验证（报绿之前先让它红）：故意不给 `DATABASE_URL` 裸跑一次断言 fail-fast 拒跑。三证命令+关键行记入交接。
- [ ] **Step 4: baseline 静态判据**——`baseline.md` 新节三行：reset 后 NLA 合计期望（公式+值）、红线 1,200,000.00、crisis+补款后 breached=true 期望。
- [ ] **Step 5: 闸**——根 tsc（scripts 在闸①覆盖内）；jest 零波及确认。
- [ ] **Step 6: Commit** `feat(乙波三T6): recon:demo:crisis危机铺设——AED大额未授权转出单场景+五判据校准+隔离失效双证`

---

### Task 7: verify:rbac S15 判据 + 行为探针 + 词表入库

**Files:**
- Modify: `scripts/verify-rbac.ts`（S15a-c 静态判据 + 五探针）
- Run: `npm run audit:vocab`（324→**326** 入库——数字以实测为准，偏差回填 spec §7 表）＋ lark 词表目录 TREASURY 域新分组 + 重导全量册（照波二惯例）

- [ ] **Step 1: 静态判据**——S15a：桶数 80→**81**、组数 88→**89**、`treasury.prudential_check`/`PRUDENTIAL_CHECK_WRITE` 四处齐（route/桶/职务；联合类型 tsc 收口）；S15b：`PRUDENTIAL_CHECK_WRITE` **唯金库**持有；S15c：兑换腿 route（`POST /admin/swap-transactions/:swapNo/legs/:legSeq/advance`）groups **恰** `['FUNDS_ORDER_ACT']`（丙案钉死防回退）。
- [ ] **Step 2: 行为探针**（DirectionalProbe 照 `:1557-1566` 形态）——金库 POST `/admin/prudential/check` ALLOW ｜ 运营同端点 DENY ｜ 合规官同端点 DENY ｜ 高管 GET `/admin/prudential/status` ALLOW ｜ 运营 GET status DENY ｜ 金库 POST 兑换腿 advance ALLOW（探针 swapNo 用占位号——非 403 即过）｜ 运营同端点 DENY。**探针路径先故意打错核实会红**（自证绿灯判例），再改对。
- [ ] **Step 3: 全量跑**——`verify:rbac` 全绿；**既有红集与波前基线恒等**（甲判例口径：S7/V2 两既有红零新增）。
- [ ] **Step 4: Commit** `feat(乙波三T7): verify:rbac S15三判据+七探针+词表326入库`

---

### Task 8: 场景 31 走查——⚡穿底：托管失窃与客户复原

**Files:**
- Modify: `doc-final/demo/script.md`（新增场景 31，spec §5 帧序照录成走查步骤——账号/页面/按钮/期望逐帧）
- 证据目录 `checkups/2026-09-30-campaign-b-wave3-evidence/`

**Interfaces:**
- Consumes: T6 crisis；甲既有链全套（对账开案→差异行「登记事故」→`UNAUTHORIZED_OUTFLOW` 登记带 sourceDispositionNo→定损 FIRM_LOSS→认损调账（金额锁）→补款划转（金额锁）——UI 走法照场景⑱既有路径）；T4 看板
- Produces: 场景 31 剧本文字 + 全程截图；T9 的开场状态（跌破在场）

- [ ] **Step 1: 剧本落 script.md**——spec §5 场景 31 九帧展开成走查步骤（每帧：登录谁/开哪页/点什么/看什么），归第九幕（幕号 T10 统一定稿，本步先占 31 号写内容）；帧 5 注明：定损勾 reportRequired + `CRM_IV_E_5`（自动开的报送单在场景 32 帧 6 收）。
- [ ] **Step 2: 全程实走**——self 栈 reset→up→demo:all → `on-stack self recon:demo:crisis` → 按剧本九帧走完（金库/CFO 两账号）；关键截图：开案帧、定性帧、事故定损帧、认损批后帧、补款划转 SUCCESS 帧、**收尾双线齐红看板帧**（F_OPS(AED) 破见底线 + NLA 破红线 + 红横幅——spec §10.1 点名帧）。
- [ ] **Step 3: 账实证据**——走查后 `on-stack self verify:coa` 全绿（两恒等式+负余额——补款划转后的时点）；客户池复原断言：选定客户 AED 托管余额回失窃前值、F_OPS(AED) 差额=失窃额（TB 直读两数记入交接）。
- [ ] **Step 4: Commit** `docs(乙波三T8): 场景31穿底主线——失窃/认损/补款九帧实走+双线齐红物证`

---

### Task 9: 场景 32 走查——审慎红线：跌破 → 报监管 → 注资复原

**Files:**
- Modify: `doc-final/demo/script.md`（新增场景 32，spec §5 十一帧展开）
- 证据目录同 T8

**Interfaces:**
- Consumes: T8 收尾状态（跌破在场）；T2 门（帧 2）；T3 巡检（帧 1/8）；甲既有链（PRUDENTIAL_BREACH 登记锚键 `subjectRefs:{metric:'NLA',shortfallAmount}`→SHORTFALL 定损→`COMPANY_VI_C_F` 报送单→合规官起草/高管签发/标提交→高管结案；`INCIDENT_CLOSE_SECURITY` MLRO→CFO 两步）；波二注资单全弧
- Produces: 场景 32 剧本文字 + 全程截图；战役主线四的完整物证

- [ ] **Step 1: 剧本落 script.md**——十一帧展开（金库/CFO/合规官/高管/MLRO 五账号轮转，每帧写清切谁）；帧 7 注资金额=校准终值（候选 300,000.00 AED，≥缺口取整，T6 若改数此处连动）。
- [ ] **Step 2: 全程实走**——接 T8 现场：①金库巡检红（截图+审计行）②金库试开付款单 400（**三个数话术帧**，spec §10.1 点名）③CFO 登记审慎事故（锚键两枚）④定损勾码→报送单自动开 ⑤合规官起草→送签→高管签发→标提交 ⑥快帧收 CRM_IV_E_5 那张 ⑦注资全弧→看板复原 ⑧再巡检绿（**红绿审计对照帧**）⑨高管结案审慎事故（前置门二证：定损✓报送已提交✓）⑩FUNDS 事故挂善后（ADJUSTMENT+TRANSFER 两引用）→提结案→MLRO→CFO 两步批 ⑪尾帧双 CLOSED+看板复原。
- [ ] **Step 3: 账实与验收断言**——`verify:coa` 全绿（注资后时点）；NLA ≥ 红线（status 端点直读）；两事故 CLOSED、两报送单 SUBMITTED（列表截图）；**豁免行为证明在案**：跌破期补款划转（T8 帧 7）与注资（本任务帧 7）均真实成功——记入交接作为 spec §10.2 豁免判据的物证。
- [ ] **Step 4: Commit** `docs(乙波三T9): 场景32审慎链——巡检/门拒/事故/报送/注资复原十一帧实走`

---

### Task 10: 收官文档——第九幕定稿 + 导航归并 + modules/overview/decisions/BACKLOG/CHANGELOG + 销账快照

**Files:**
- Modify: `doc-final/demo/script.md`（场景 26-32 摘「暂编」、统一挂**第九幕「公司的钱」**；篇首主线句续「→ 公司的钱」）
- Modify: `admin-web/src/components/DashboardLayout.tsx`（LP Register/LP Exchanges 两项从 Custody 组（`:286,292`）迁入 Treasury 组；Custody 余项不动）
- Modify: `doc-final/modules/company-funds.md`（扩「审慎红线与巡检」节：口径公式/门的豁免立场/按钮修订注记/8 年安全港叙事收口；§4 补场景 31/32；§5 补 prudential 模块与两码；§6 缺口增减）＋ `doc-final/modules/lp-desk.md`（导航组注记一句）
- Modify: `doc-final/modules/overview.md`（§4 桶 80→81、组 88→89、Treasury 行扩巡检桶与丙案重挂注记；页首计数与审计 326 连动——**聚合计数≠逐行，全文 grep 数字逐处核**，甲判例）
- Modify: `doc-final/decisions.md`（**七条一并落笔**，收官统一落的欠账+本波新增：①F_LIQ 复活翻案（含 COA v2 局部取代声明，新事实=LP 在途验收需求当年不存在）②LP 三拍板（档案/价手填/审批照划转抄）③⑰穿底甲案+B1/B2 两分 ④NLA 门与口径（含对总纲岔口④原倾向的推翻依据：闭环论证+VI.C.4 一手条款）⑤巡检按钮版与金库归属（E5 判语边界澄清：否决的是 cron 引擎非巡检）⑥穿底甲案顺序（先补款后注资，红线真实穿越）⑦兑换腿丙案（推单归金库定案顺延）——素材：波一/波二骨架承接节 + 本波 spec §0，只抄不脑暴）
- Modify: `doc-final/BACKLOG.md`（§E 兑换腿条销账注丙案 commit；§M decimals 两条保留不动）＋ `doc-final/CHANGELOG.md` 一行
- Create: `doc-final/superpowers/checkups/2026-09-30-campaign-b-closeout-ledger.md`（销账快照：业主 20 条枚举 + roadmap 13 条逐项四态表【波内/收编/不建/满足】+ 依据一句话——照甲 `2026-09-28-campaign-a-closeout-ledger.md` 章法；⑳ 无主资金措辞照波二 spec §0 尾注原文）

- [ ] **Step 1: 剧本定稿**——第九幕节头 + 26-32 摘暂编注（26 帧下那句「幕次归属留收官」删除改定稿注）；grep `暂编` 场景 26-32 相关行清零。
- [ ] **Step 2: 导航迁移 + 截图**——两项搬家后 admin tsc + preview 以金库登录截 Treasury 组全家福帧（LP 两页+公司资金三页同组）、Custody 组余项帧。
- [ ] **Step 3: 文档五件**（modules 两篇/overview/decisions 七条/BACKLOG+CHANGELOG）。
- [ ] **Step 4: 销账快照**——20+13 逐项表，尾注「交业主确认」；四态计数核对（20=5+6+9、13=5+1+7，总纲 §4 原口径零失踪）。
- [ ] **Step 5: Commit** `docs(乙波三T10): 第九幕定稿+LP导航迁Treasury+decisions七条+销账快照+overview 81桶89组`

---

### Task 11: 战役终闸——四主线连走 + 闸⑥⑦⑧ + 承诺清点 + 归档

**Files:**
- 证据目录同 T8；`doc-final/superpowers/specs/` + `plans/` 归档移动

- [ ] **Step 1: 重铺闸⑧全序**——`bash scripts/stack.sh reset self` → `up self` → `on-stack self demo:all`（全绿断言终态，闸⑥）→ `on-stack self recon:demo:pass`（F_OPS/F_LIQ MATCHED）→ `on-stack self recon:demo:break`（**18/18**——crisis 隔离终证）→ `on-stack self verify:coa`（闸⑦复核）→ 对 `demo/baseline.md`（含 T6 新增 NLA 静态判据）全绿。
- [ ] **Step 2: 四主线连走**（战役终闸第 1 条；31/32 已 T8/T9 实走，此处走另三条+核对表）——主线一：28 注资→26 LP 补货→30 客户兑换消耗库存（**金库经面板推兑换腿**，丙案后无超管——全程截图即 spec §10.4 物证）→水位逼近见底线→26' 再补货；主线二：27 反向回吐；主线三：29 HexTrust 付款。四主线各一行「场景号+关键帧+结果」核对表记入 evidence。
- [ ] **Step 3: 承诺清点**——对 spec 逐条问「这一条的代码/文档在哪」（「承诺没代码不产生 diff」判例）；对 spec §7 数量表逐行报实测值（81 桶/89 组/51 审批/326 码/87 止/10 码/+0 表——对不上停下回填订正，不硬报绿）；对 `rules/delivery-checklist.md` 逐触发行报「本波过哪几条」（命中行清单见文末）。
- [ ] **Step 4: 归档**——战役乙收官：总纲 `2026-09-28-campaign-b-company-funds-charter.md` + 三波骨架/spec + 波一二三 plan 移入 `doc-final/archive/superpowers/` 对应子目录（总纲头注「活文档存续到末波收官」到期；路由表「不读 archive」自此生效）；`modules/`+`demo/` 为现状唯一真相的交接句写入 CHANGELOG 行。
- [ ] **Step 5: Commit** `chore(乙波三T11): 战役终闸四主线+闸⑥⑦⑧全绿+乙战役文档归档`

---

## 任务依赖与派发

```
T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11（线性；T3/T5/T7 同动 rbac/verify-rbac 文件，禁并行）
```
- 执行者一律带项目总纲 §0–§5 要点（派发惯例）；每任务先读 Global Constraints 注明的模板三处。
- **评审档位**：T1/T2/T6 评审升档 opus（动钱路径/动定价常量/动对账输入与全剧数字），T3/T4/T5/T7/T8/T9/T10/T11 评审执行档；终审 Fable 不降档 + 逐条追 spec 承诺 + 变异测试抽查。
- 收尾对照 `rules/delivery-checklist.md`；**本波命中行**：任何持久状态变化（巡检/拦截审计，显式 requestId）｜新增审计动作码（两枚四属性冻结+第十六册）｜新增权限组四处（PRUDENTIAL_CHECK_WRITE）｜新增 admin 端点（status/check，route+sync+重启）｜新增业务动作前端入口（巡检按钮）｜改了交易三域任一（丙案重挂后三域腿推进权限**归一**，答「另两域」：充提腿本就走 FUNDS_ORDER_ACT，兑换是最后一个 outlier）｜涉及金额（NLA 全程最小单位）｜对外识别（PRUDENTIAL_STATUS·'NLA'，零 UUID）｜改页面或种子（script 场景 31/32+第九幕；data.md 生成区不动——crisis 非种子）｜改了前端截图（T4/T8/T9/T10）｜每轮收尾（T10）。**不触发行**（列明防评审误报）：新状态/新结局（零新状态机，SLA 不触发）｜动了钱的新记账（零新分录动作，走查全用既有链；verify:coa 照跑）｜maker-checker/新审批策略/MAKER 表（零新审批）｜退役业务动作（丙案端点重挂非退役，运营本就无面板入口、无幽灵产生）｜新字段/新状态到客户面（client-web 零触碰）｜新事件（零新 domain event）｜改 schema（零迁移）｜多波承接（**末波**——不立下一波骨架，代之 T10 销账+T11 归档）。
