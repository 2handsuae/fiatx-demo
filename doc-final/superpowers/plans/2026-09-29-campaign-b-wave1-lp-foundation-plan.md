# 战役乙波一 · LP 地基与调拨 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建 LP 档案（CFO 批准入）与 LP 兑换单（先款后货 + F_LIQ 前厅验收），复活 FIRM_LIQ 科目，全程单据+审批+账本+对账可见。

**Architecture:** 两个新主体照内部划转单模板（显式迁移表 / CFO 单步审批 / workflow 编排 / 资金单腿 / 审计信封），记账走法照 swap 跨 ledger 先例；F_LIQ 从「有壳无肉」复活为 LP 在途验收户。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle ｜ admin-web React ｜ jest

**Spec:** `doc-final/superpowers/specs/2026-09-29-campaign-b-wave1-lp-foundation-spec.md`（§0 七裁定、§4 三腿三码、§7 预期终态数量表、§9 验收判据）

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用
- 本轮特有：
  - ⚠️ **清单「动了钱→不新增科目」行的显式例外**：FIRM_LIQ=203 复活是业主拍板（总纲 §2 翻案在案）。**除 203 外一个科目都不许加**；评审不得按清单把 203 砍掉，也不得纵容 203 之外的新科目
  - 转账码**只许 84/85/86** 三枚（spec §4 定死），执行中发现不够 = 停下上报，不许自加
  - LP 兑换单 `prudentialPurpose` 必填（8 年安全港记录地基）
  - 单号前缀 `LPP`（档案）/ `LPX`（兑换单）——T2 开工先 `grep -rn "generateReferenceNo('" src | sort` 确认不撞，撞了停下上报
  - 本波动钱+动 COA+动状态机：**T1/T2/T4/T5/T9 任务级评审升档 opus**，其余任务评审执行档；终审 Fable 不降档（项目总纲 §6 派发表）
  - jest 必须在仓库根跑且带 `DATABASE_URL`（缺则假红——判例在案）；本机 shell 默认 node18，每条命令前置 nvm20 PATH（记忆在案）
  - 前端两条永不豁免：改前端必截图；动钱必 `verify:coa`

**任务模板（照抄对象，全程有效）**：`src/modules/asset-treasury/internal-transfers/` 全目录（服务/工作流/审批 handler/控制器/迁移表常量/dto）＋ `src/modules/funds-layer/constants/swap-leg-plan.constant.ts`（跨 ledger 腿）。每个后端任务开工先读这两处。

---

### Task 1: 账本地基——FIRM_LIQ 复活 + 转账码 84-86 + 对账映射翻面

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts`
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.spec.ts`
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts`
- Modify: `src/modules/asset-treasury/assets/asset-provisioning.service.ts:5-16`
- Modify: `src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts:781-784`（F_LIQ 映射行）

**Interfaces:**
- Produces: `TB_ACCOUNT_CODES.FIRM_LIQ = 203`、`TB_CODE_TO_COA[203] = 'E.FIRM_LIQ'`、`TB_TRANSFER_CODES.LP_EXCHANGE_PAY = 84 / LP_EXCHANGE_RECEIVE = 85 / LP_EXCHANGE_ACCEPT = 86`；`systemAccountCodesFor()` 两资产均含 FIRM_LIQ——后续任务全靠这些名字

- [ ] **Step 1: 改锁死测试为新基线（先红）**——`tb-account-codes.constant.spec.ts`：`'exposes exactly the 9 codes'` 改为 10 码（加 `FIRM_LIQ`）；退役黑名单测试从 `['FIRM_FEE','FIRM_LIQ','FIRM_SEIZED']` 改为 `['FIRM_FEE','FIRM_SEIZED']`。跑 `npx jest src/modules/accounting/tigerbeetle/constants`（仓库根、带 DATABASE_URL；jest 30 勿用 --testPathPattern 单数旗标，TOOLING-DEBT 在案），预期 FAIL（FIRM_LIQ 不存在）。
- [ ] **Step 2: 科目复活**——`tb-account-codes.constant.ts`：`FIRM_LIQ: 203, // LP 在途验收户（2026-09-29 战役乙复活；原 2026-08-13 COA v2 退役，翻案见乙总纲 §2）`；`TB_CODE_TO_COA` 加 `203: 'E.FIRM_LIQ'`；文件顶部退役注释同步改（202/204 仍退役）。
- [ ] **Step 3: 转账码三枚**——`tb-transfer-codes.constant.ts` 新段：
```ts
// ── 战役乙波一（2026-09-29）：LP 兑换（84–86）。先款后货：卖出直出、买入落前厅、验收入库 ──
LP_EXCHANGE_PAY: 84,     // 卖出腿：DR FIRM_OPS / CR FIRM_ASSET（卖出币 ledger，付给 LP，外穿）
LP_EXCHANGE_RECEIVE: 85, // 买入腿：DR FIRM_ASSET / CR FIRM_LIQ（买入币 ledger，LP 打来落前厅，外穿）
LP_EXCHANGE_ACCEPT: 86,  // 验收转腿：DR FIRM_LIQ / CR FIRM_OPS（买入币 ledger，验收入库，内转）
```
- [ ] **Step 4: 科目铺设**——`asset-provisioning.service.ts` `systemAccountCodesFor()` 数组加 `TB_ACCOUNT_CODES.FIRM_LIQ`（两资产都要，不进 isFiat 分支）。
- [ ] **Step 5: 对账映射翻面**——`wallet-recon-run.service.ts:783` 的 F_LIQ 行：从「退役科目,钱包仍在,期望恒 0」注释形态改为与 F_OPS/F_SET 同款的真映射 `'E.FIRM_LIQ'`，注释改「LP 在途验收户（乙波一复活）」。
- [ ] **Step 6: 跑测试**——Step 1 的 spec 全绿；再跑 `npx tsc --noEmit -p tsconfig.json`。
- [ ] **Step 7: Commit** `feat(乙波一T1): FIRM_LIQ 203复活+转账码84-86+对账映射真直比——COA 9→10锁死基线`

---

### Task 2: LP 档案——schema + 主体服务 + 迁移表 + 审计码档案族

**Files:**
- Modify: `prisma/schema.prisma`（新 model）＋ 新迁移 `npx prisma migrate dev --name wave1_liquidity_providers`
- Create: `src/modules/asset-treasury/lp-desk/lp-profile.service.ts`
- Create: `src/modules/asset-treasury/lp-desk/constants/lp-profile-transitions.constant.ts`
- Create: `src/modules/asset-treasury/lp-desk/dto/lp-profile.dto.ts`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（动作码 + 契约表 + AuditEntityTypes + AuditBusinessWorkflowTypes）
- Test: `src/modules/asset-treasury/lp-desk/lp-profile.service.spec.ts`

**Interfaces:**
- Produces: `LpProfileService.create(input): Promise<row>`（生成 lpNo=`generateReferenceNo('LPP')`，status=PENDING_APPROVAL）；`transition(lpNo, to, patch?)`（内含 assertTransition）；`applySettlementChange(lpNo, patch)`；`findByNo(lpNo)`；`assertActiveByNo(lpNo)`（非 ACTIVE 抛 BadRequest，供兑换单开单守卫）；`toView(row)` 零 UUID 投影；档案审计动作 `writeAudit(action, row, patch)` 收在本服务（照甲波四 ResponsibleIndividualsService 先例，workflow 零审计写入）
- Produces: `LpProfileStatus` 枚举（PENDING_APPROVAL/ACTIVE/SUSPENDED/REJECTED）、`AuditEntityTypes.LIQUIDITY_PROVIDER`、`AuditBusinessWorkflowTypes.LP_PROFILE`

- [ ] **Step 1: schema**（照 `InternalTransfer` model 868-901 风格）：
```prisma
// 战役乙波一（2026-09-29）：LP 档案——流动性提供方名册。结算坐标定义卖出腿的钱打到哪，建档/改坐标走 CFO 审批。
model LiquidityProvider {
  id            String   @id @default(uuid())
  lpNo          String   @unique
  name          String
  fiatBankName  String
  fiatIban      String
  cryptoNetwork String   // TRON
  cryptoAddress String
  agreementRef  String
  status        String   @default("PENDING_APPROVAL") // PENDING_APPROVAL | ACTIVE | SUSPENDED | REJECTED
  approvalNo    String?
  createdByUserId String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@index([status])
  @@map("liquidity_providers")
}
```
（`LpExchange` model 与两侧 relation 行都在 Task 4 加；本任务只建 LiquidityProvider 本体。）
- [ ] **Step 2: 迁移表常量**（照 internal-transfer-transitions 全文件形态）：
```ts
import { LpProfileStatus as S } from '../dto/lp-profile.dto';
/** 四态四边（乙波一 spec §2.2）。改结算坐标是动作不是状态，ACTIVE 期间走审批落地。 */
export const LP_PROFILE_TRANSITIONS: Record<string, readonly string[]> = {
  [S.PENDING_APPROVAL]: [S.ACTIVE, S.REJECTED],
  [S.ACTIVE]: [S.SUSPENDED],
  [S.SUSPENDED]: [S.ACTIVE],
  [S.REJECTED]: [],
};
```
- [ ] **Step 3: dto**——`LpProfileStatus` 枚举、`CreateLpProfileDto`（name/fiatBankName/fiatIban/cryptoNetwork/cryptoAddress/agreementRef 全 `@IsNotEmpty`）、`ProposeSettlementChangeDto`（四个坐标字段可选但至少一个，`reason` 必填）、`LpProfileView`（lpNo/name/坐标/agreementRef/status/approvalNo/createdBy/createdAt——**无 id**）。
- [ ] **Step 4: 审计码档案族**——`audit-actions.constant.ts`：`AuditEntityTypes` 加 `LIQUIDITY_PROVIDER: 'LIQUIDITY_PROVIDER'`；`AuditBusinessWorkflowTypes` 加 `LP_PROFILE: 'LP_PROFILE'`；动作码八枚 `LP_PROFILE_{CREATED,APPROVED,REJECTED,CHANGE_PROPOSED,CHANGE_APPLIED,CHANGE_REJECTED,SUSPENDED,REACTIVATED}`；契约表新 `CAMPAIGN_B_LP_PROFILE_AUDIT_ACTIONS`（并入总注册，照 V7_TREASURY 表挂法）：
```ts
LP_PROFILE_CREATED:         { domain: 'TREASURY', correlationMode: N, requiredFields: ['reason'], requiresCausation: false },
LP_PROFILE_APPROVED:        { domain: 'TREASURY', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
LP_PROFILE_REJECTED:        { domain: 'TREASURY', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
LP_PROFILE_CHANGE_PROPOSED: { domain: 'TREASURY', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
LP_PROFILE_CHANGE_APPLIED:  { domain: 'TREASURY', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
LP_PROFILE_CHANGE_REJECTED: { domain: 'TREASURY', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
LP_PROFILE_SUSPENDED:       { domain: 'TREASURY', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
LP_PROFILE_REACTIVATED:     { domain: 'TREASURY', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
```
主体信封：primarySubject=LIQUIDITY_PROVIDER·lpNo，审批单 INSTRUMENT；展示级字段（name、新旧坐标摘要）镜像 metadata（甲 R5 判例）；每条带显式 `requestId`（照划转单 `${action}_${lpNo}_${randomUUID()}`）。
- [ ] **Step 5: 服务**——照 `internal-transfer.service.ts` 结构：constructor(prisma, auditLogs)；create/findByNo/transition(assertTransition 内嵌)/stampApprovalNo/applySettlementChange(只许 ACTIVE，patch 四坐标)/assertActiveByNo/list/toView。审计写入点：create→CREATED（actor 带）、transition 各边分别 APPROVED/REJECTED/SUSPENDED/REACTIVATED、applySettlementChange→CHANGE_APPLIED（由 workflow 传 approvalNo/causationId 进 patch 参数）。
- [ ] **Step 6: 失败测试先行**——spec 文件用真迁移表断言（禁扫文本）：
```ts
it('rejects PENDING_APPROVAL → SUSPENDED', async () => {
  await expect(svc.transition(row.lpNo, LpProfileStatus.SUSPENDED)).rejects.toThrow(/Illegal/);
});
it('rejects settlement change while SUSPENDED', ...);
it('REJECTED is terminal (no out-edges)', ...);
it('assertActiveByNo throws for SUSPENDED profile', ...);
```
先跑红（服务未实现/边不存在），实现后转绿。
- [ ] **Step 7: 闸**——根 tsc + `npx jest src/modules/asset-treasury/lp-desk --rootDir .` 全绿。
- [ ] **Step 8: Commit** `feat(乙波一T2): LP档案主体——四态四边+LPP单号+审计八码档案族`

---

### Task 3: LP 档案审批 + workflow + controller + RBAC 登记

**Files:**
- Create: `src/modules/asset-treasury/lp-desk/lp-profile-approval.service.ts`（两个 handler 类同文件）
- Create: `src/modules/asset-treasury/lp-desk/lp-profile-workflow.service.ts`
- Create: `src/modules/asset-treasury/lp-desk/lp-profile.controller.ts`
- Create: `src/modules/asset-treasury/lp-desk/lp-desk.module.ts`（挂 `app.module.ts`）
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`（三张表各 +2）
- Modify: `scripts/verify-rbac.ts:250` `MAKER_GROUP_BY_POLICY` +2 行
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（组联合类型 + route() + 桶 + 职务绑定）
- Test: `src/modules/asset-treasury/lp-desk/lp-profile-workflow.service.spec.ts`

**Interfaces:**
- Consumes: Task 2 的 `LpProfileService` 全部方法
- Produces: 审批类型 `LP_PROFILE_APPROVAL` / `LP_PROFILE_CHANGE`（均金库提/CFO 单步/48h/可撤，照 `INTERNAL_TRANSFER_APPROVAL` 条目参数）；decided 事件名 `workflow.lp-profile.decided`（base 类按 workflowType `LP_PROFILE` kebab 派生，一个 @OnEvent 接两类型、branch on `event.actionType`）；权限组 `LP_READ`/`LP_WRITE`；端点六条（见 Step 4）

- [ ] **Step 1: 审批注册**——`approval.constants.ts`：`ApprovalActionTypes` +2；`DEFAULT_APPROVAL_POLICIES` 各 `{ steps: [{ stepNo: 1, roles: ['CFO'] }], timeoutHours: 48, allowCancel: true }`；`V1_APPROVAL_ACTION_TYPES` +2（**漏白名单=UI 永不渲染，甲教训**）。`scripts/verify-rbac.ts` `MAKER_GROUP_BY_POLICY` 加 `LP_PROFILE_APPROVAL: 'LP_WRITE'` / `LP_PROFILE_CHANGE: 'LP_WRITE'`。
- [ ] **Step 2: 两个 approval handler**（照 internal-transfer-approval.service.ts 17 行模板）：`LpProfileApprovalService`（actionType=LP_PROFILE_APPROVAL）与 `LpProfileChangeApprovalService`（actionType=LP_PROFILE_CHANGE），workflowType 均 `AuditBusinessWorkflowTypes.LP_PROFILE`。
- [ ] **Step 3: workflow**——照 internal-transfer-workflow 骨架裁剪：
  - `initiateCreate(dto, actor)`：`profiles.create` → `approvals.createAndSubmit({actionType: LP_PROFILE_APPROVAL, entityRef: lpNo, objectSnapshot: {lpNo,name,fiatIban,cryptoAddress,agreementRef}（零 UUID）})` → `stampApprovalNo`；
  - `proposeSettlementChange(lpNo, dto, actor)`：守卫 ACTIVE + 无在途变更审批（查 `approvals` 未决同 entityRef+actionType，照 findBlocking 思路）→ createAndSubmit（objectSnapshot 带**新旧坐标对照**）→ 审计 CHANGE_PROPOSED（本动作审计在 workflow 侧不落——按 Task 2 约定审计全收档案服务：给 `LpProfileService` 加 `recordChangeProposed(row, snapshot, actor, approvalNo)`，workflow 调它）；
  - `@OnEvent('workflow.lp-profile.decided')`：branch `event.actionType`——PROFILE_APPROVAL: APPROVED→transition(ACTIVE)、DECLINED/EXPIRED→transition(REJECTED)；PROFILE_CHANGE: APPROVED→`applySettlementChange`（从审批单 objectSnapshot 读新值——照甲波四「apply 从载荷读值」判例）、DECLINED/EXPIRED→CHANGE_REJECTED 审计、坐标不动；CANCELLED→return（撤回口自己收口）；
  - `suspend/reactivate(lpNo, dto, actor)`：直接 transition + 审计，不建审批。
- [ ] **Step 4: controller + RBAC**——端点（全部 `@RequirePermissions(buildPermissionCode(...))` 照划转单 controller）：`POST /admin/lp-profiles`（建档）/ `POST /admin/lp-profiles/:lpNo/settlement-change` / `POST /admin/lp-profiles/:lpNo/suspend` / `POST /admin/lp-profiles/:lpNo/reactivate`（以上 LP_WRITE）/ `GET /admin/lp-profiles` + `GET /admin/lp-profiles/:lpNo`（LP_READ）。`rbac.catalog.ts`：联合类型加 `'LP_READ' | 'LP_WRITE'`（57 行旁）；route() 六条（470 区形态）；Treasury 域桶数组加：
```ts
{ key: 'treasury.view_lp', label: 'View LP register & exchanges',
  description: 'Browse liquidity-provider profiles and LP exchange orders with their funds-order legs', groups: ['LP_READ'] },
{ key: 'treasury.act_lp', label: 'Operate LP desk',
  description: 'Register/suspend an LP, propose settlement changes, initiate LP exchanges and accept deliveries — CFO signs off', groups: ['LP_WRITE'] },
```
职务绑定：`grep -n "INTERNAL_TRANSFER_WRITE" rbac.catalog.ts` 找到金库（持 WRITE 的那个职务）加 `LP_READ','LP_WRITE`；持 `INTERNAL_TRANSFER_READ` 的 CFO/内审行加 `LP_READ`。
- [ ] **Step 5: 行为测试**——workflow spec（mock approvals/审计照划转单 spec 模式）：建档→ACTIVE 全弧；拒→REJECTED；变更 APPROVED 落新坐标、DECLINED 坐标不动；SUSPENDED 建兑换单被 `assertActiveByNo` 拒（预告 Task 5 的守卫，此处先测服务层）。先红后绿。
- [ ] **Step 6: 闸**——根 tsc + lp-desk 目录 jest 全绿；`npm run db:base:sync` 说明写进任务交接（重启后端在 T9 实测前统一做）。
- [ ] **Step 7: Commit** `feat(乙波一T3): LP档案审批链×2+workflow+六端点+Treasury域两桶两组`

---

### Task 4: LP 兑换单——schema + 资金单第五父键 + 主体服务 + 八态迁移表

**Files:**
- Modify: `prisma/schema.prisma`（LpExchange model + LiquidityProvider relation 行 + FundsOrder 父键）＋迁移 `wave1_lp_exchanges`
- Create: `src/modules/asset-treasury/lp-desk/lp-exchange.service.ts`
- Create: `src/modules/asset-treasury/lp-desk/constants/lp-exchange-transitions.constant.ts`
- Create: `src/modules/asset-treasury/lp-desk/dto/lp-exchange.dto.ts`
- Modify: `src/modules/funds-orders/funds-order.service.ts:27-374` 八方法点 + `src/modules/funds-orders/dto/funds-order.dto.ts:25-28`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（兑换族八码 + LP_EXCHANGE 工作流码 + 实体码）
- Test: `src/modules/asset-treasury/lp-desk/lp-exchange.service.spec.ts` + `src/modules/funds-orders/funds-order.service.spec.ts`（如已存在则扩）

**Interfaces:**
- Consumes: Task 2 `LpProfileService.assertActiveByNo`
- Produces: `LpExchangeService.create(input)`（exchangeNo=`generateReferenceNo('LPX')`）；`transition(exchangeNo, to, patch?)`；`assertFirmOpsBalance(currency, amountMinor)`（本服务私有实现，形状照 internal-transfer.service.ts:76-90 ——10 行只读守卫不跨模块 import，注释注明同款）；`findByNo/getView/list`；`LpExchangeStatus` 八态枚举；FundsOrder 父键 `lpExchangeId`

- [ ] **Step 1: schema**：
```prisma
// 战役乙波一：LP 兑换单——公司卖出一种资产、向 LP 买入另一种。先款后货，买入腿落 F_LIQ 前厅验收后入库。
model LpExchange {
  id                String   @id @default(uuid())
  exchangeNo        String   @unique
  lpId              String
  lpNo              String
  sellAssetId       String
  sellAmount        Decimal  // 元
  buyAssetId        String
  buyAmount         Decimal  // 元
  prudentialPurpose String   // 审慎管理目的（8 年安全港记录，必填）
  status            String   @default("PENDING_APPROVAL")
  reason            String
  sellFromWalletId  String   // F_OPS（卖出币网络行）
  buyViaWalletId    String   // F_LIQ（买入币网络行，前厅）
  buyToWalletId     String   // F_OPS（买入币网络行）
  approvalNo        String?
  failureReasonCode String?  // INSUFFICIENT_FIRM_BALANCE | LEG_FAILED | POSTING_FAILED
  failureNote       String?
  executedAt        DateTime?
  deliveredAt       DateTime?
  settledAt         DateTime?
  traceId           String
  createdByUserId   String
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  lp         LiquidityProvider @relation("LpProviderExchanges", fields: [lpId], references: [id])
  sellAsset  Asset @relation("LpExchangeSellAsset", fields: [sellAssetId], references: [id])
  buyAsset   Asset @relation("LpExchangeBuyAsset", fields: [buyAssetId], references: [id])
  fundsOrders FundsOrder[] @relation("LpExchangeFundsOrders")
  @@index([status])
  @@index([lpNo])
  @@map("lp_exchanges")
}
```
`FundsOrder` 加：`lpExchangeId String?` + relation + `@@unique([lpExchangeId, legSeq, attempt])` + `@@index([lpExchangeId])`（947/951 行旁）。Asset 模型加两条反向 relation 名。
- [ ] **Step 2: 迁移表**（八态八边，spec §3.2 原样）：
```ts
export const LP_EXCHANGE_TRANSITIONS: Record<string, readonly string[]> = {
  [S.PENDING_APPROVAL]: [S.EXECUTING, S.FAILED, S.REJECTED, S.CANCELLED],
  [S.EXECUTING]: [S.AWAITING_DELIVERY, S.FAILED],
  [S.AWAITING_DELIVERY]: [S.DELIVERED],
  [S.DELIVERED]: [S.SUCCESS],
  [S.SUCCESS]: [], [S.FAILED]: [], [S.REJECTED]: [], [S.CANCELLED]: [],
};
```
- [ ] **Step 3: funds-order 八方法点**（体检 §3 清单逐一）：`parentOf` 加 lpExchangeId；`create` 互斥数组与 data 加键；`directionOf` 分支——`if (input.lpExchangeId) return input.legSeq === 1 ? 'OUT' : input.legSeq === 2 ? 'IN' : 'INTERNAL';`；`findByParent` parent 对象；`countNonTerminalByCustomer` **不加**（LP 单无客户）——写一条测试断言 LP 单不计入该数；`parentFkWhere`/`findAllForAdmin`(include+业务号映射 exchangeNo)/`findOneByNoForAdmin`。dto `CreateFundsOrderInput` 加 `lpExchangeId?: string`。
- [ ] **Step 4: 审计兑换族八码**——`LP_EXCHANGE_{REQUESTED,CANCELLED,REJECTED,EXECUTION_STARTED,PAY_LEG_POSTED,DELIVERED,ACCEPTED,FAILED}`，`AuditBusinessWorkflowTypes.LP_EXCHANGE`、`AuditEntityTypes.LP_EXCHANGE`，契约表（照 V7 表）：REQUESTED=N+['amount','reason']；REJECTED/EXECUTION_STARTED=I+['approvalNo']+causation；PAY_LEG_POSTED/DELIVERED=I+['amount']；ACCEPTED=I+['amount','effectiveDate']；FAILED=I+['reasonCode']；CANCELLED=I+['reason']。
- [ ] **Step 5: 服务**——create（守卫：`assertActiveByNo(lpNo)`、sellAssetId≠buyAssetId、两金额>0、prudentialPurpose 非空）/transition/assertFirmOpsBalance（卖出币）/getView（零 UUID：exchangeNo/lpNo/两边 assetCode+amount/status/legs 照划转单 toView 形态）。
- [ ] **Step 6: 变异测试先红**（spec §9.3 前半）：
```ts
it('rejects create when profile is SUSPENDED', ...);          // assertActiveByNo
it('rejects create when sellAsset equals buyAsset', ...);
it('rejects create without prudentialPurpose', ...);
it('rejects AWAITING_DELIVERY → SUCCESS (must pass DELIVERED)', ...);
it('SUCCESS is terminal — second accept rejected', ...);
it('LP exchange legs never count toward customer closure guard', ...); // countNonTerminalByCustomer
```
- [ ] **Step 7: 闸**——根 tsc + lp-desk、funds-orders 两目录 jest 全绿。
- [ ] **Step 8: Commit** `feat(乙波一T4): LP兑换单主体——八态八边+LPX单号+资金单第五父键+审计八码兑换族`

---

### Task 5: LP 兑换 workflow——审批裁决 / 三腿落账 / 验收 / ⚡到货

**Files:**
- Create: `src/modules/asset-treasury/lp-desk/lp-exchange-workflow.service.ts`
- Create: `src/modules/asset-treasury/lp-desk/lp-exchange-approval.service.ts`
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`（三张表各 +1：`LP_EXCHANGE_APPROVAL`，CFO 单步 48h 可撤）
- Modify: `scripts/verify-rbac.ts` `MAKER_GROUP_BY_POLICY` + `LP_EXCHANGE_APPROVAL: 'LP_WRITE'`
- Modify: `src/modules/asset-treasury/lp-desk/lp-desk.module.ts`（providers 补齐；imports 照 internal-transfers.module：Prisma/Audit/TigerBeetle/FundsOrders/FundsLayer/Approvals/Reconciliation）
- Test: `src/modules/asset-treasury/lp-desk/lp-exchange-workflow.service.spec.ts`

**Interfaces:**
- Consumes: T1 三码与 FIRM_LIQ；T2 `assertActiveByNo`；T4 服务全部；`SystemWalletResolver.resolve(assetId, 'F_OPS'|'F_LIQ')`；`FundsOrderService.create/stampExternalRef/resolveExternalRef/advance`；`SimulatedCustodianStatementService.recordLegMovement`；`AccountingService.executeTransfer/resolveTbAccountId`
- Produces: `initiate(dto, actor)` / `cancel(exchangeNo, dto, actor)` / `accept(exchangeNo, actor)` / `simulateDelivery(exchangeNo, actor)`；decided 事件 `workflow.lp-exchange.decided`

**三腿走法（本任务的心脏，全部动作先账后状态、落账失败停在原地不重试——照划转单 onLegConfirmed 纪律）：**

| 腿 | legSeq | 建单时机 | 资金单坐标 | 落账（executeTransfer） | eventCode |
|---|---|---|---|---|---|
| 卖出 | 1 | 批准+余额闸过 | from=sellFromWalletId(F_OPS)，to=null，toAddress/toIban=档案坐标（卖出币是 CRYPTO→cryptoAddress ｜ FIAT→fiatIban） | 确认时：DR FIRM_OPS / CR FIRM_ASSET，code 84，卖出币 ledger，isExternalCrossing | `LP_EXCHANGE_PAY` |
| 买入 | 2 | ⚡simulateDelivery | from=null+档案坐标，to=buyViaWalletId(F_LIQ) | 同一动作内：DR FIRM_ASSET / CR FIRM_LIQ，code 85，买入币 ledger，isExternalCrossing | `LP_EXCHANGE_RECEIVE` |
| 验收转 | 3 | accept | from=buyViaWalletId(F_LIQ)，to=buyToWalletId(F_OPS) | 同一动作内：**先写两侧回单再落账**——DR FIRM_LIQ / CR FIRM_OPS，code 86，买入币 ledger，**外穿**（订正 2026-09-29 T5 评审：原「内转不外穿」违反逐钱包对账模型；spec §4 已同步订正，腿 2 回单也一律先于落账） | `LP_EXCHANGE_ACCEPT` |

- [ ] **Step 1: 审批注册三件套 + MAKER 行 + handler**（同 T3 形态，actionType=`LP_EXCHANGE_APPROVAL`，workflowType=`LP_EXCHANGE`）。
- [ ] **Step 2: initiate**——守卫（assertActiveByNo/资产互异/金额>0/prudentialPurpose）→ `assertFirmOpsBalance(卖出币, sellAmountMinor)` → 解析三钱包（`systemWallets.resolve(sellAssetId,'F_OPS')`、`resolve(buyAssetId,'F_LIQ')`、`resolve(buyAssetId,'F_OPS')`）→ create → createAndSubmit（objectSnapshot：exchangeNo/lpNo/lpName/sell `${amount} ${currency}`/buy `${amount} ${currency}`/prudentialPurpose/impact 一句话——零 UUID）→ stampApprovalNo → 审计 REQUESTED。
- [ ] **Step 3: onDecided**（`@OnEvent('workflow.lp-exchange.decided')`）——照划转单 onDecided 逐支：非 PENDING_APPROVAL return；DECLINED/EXPIRED→REJECTED+审计；APPROVED→**复核卖出币余额**（不足→FAILED `INSUFFICIENT_FIRM_BALANCE`+审计，零资金单）→ createLeg(1)→EXECUTING+审计 EXECUTION_STARTED。
- [ ] **Step 4: 腿事件**——`@OnEvent(DomainEventNames.FUNDS_ORDER_STATUS_CHANGED)`：只认 `event.parent.lpExchangeId`；SUBMITTED→stampExternalRef+`custodianStatement.recordLegMovement`（照划转单 onLegSubmitted，assetCode=卖出币）；CONFIRMED→post 84（先账）→`fundsOrders.advance(leg.id, CLEAR, 'LP_EXCHANGE_WORKFLOW')`→审计 PAY_LEG_POSTED→transition(AWAITING_DELIVERY)；FAILED/TIMEOUT→transition(FAILED,'LEG_FAILED')+审计（注明「卖出腿失败，未付出资金，可重新发起」）。
- [ ] **Step 5: simulateDelivery**（⚡，照充值域模拟动作先例挂门）——守卫 status=AWAITING_DELIVERY → createLeg(2)（initialStatus 直接走到 CONFIRMED 的既有资金单模拟推进方式，照 deposit 模拟推腿先例）→ post 85 → advance CLEAR → `recordLegMovement`（buy 币，toWalletId=F_LIQ 行——**对账吃进的关键行**）→ transition(DELIVERED, {deliveredAt}) → 审计 DELIVERED（⚡也是持久动作，留痕）。
- [ ] **Step 6: accept**——守卫 status=DELIVERED（迁移表天然拒二次）→ createLeg(3) → post 86 → advance CLEAR → transition(SUCCESS, {settledAt}) → 审计 ACCEPTED（metadata 带 expected=buyAmount / received=腿2金额——验收两数）。
- [ ] **Step 7: cancel**——照划转单 cancel（仅 PENDING_APPROVAL，先撤审批单再翻状态）。
- [ ] **Step 8: 审计信封**——照 transferAudit 改写：domain TREASURY、workflowType LP_EXCHANGE、primary=LP_EXCHANGE·exchangeNo、subjects 加 LIQUIDITY_PROVIDER·lpNo(RELATED)+审批单(INSTRUMENT)+资金单(RELATED)；REQUESTED 起旅程（NONE）其余 INHERIT；显式 requestId；amount 用「`${sellAmount} ${sellCurrency} → ${buyAmount} ${buyCurrency}`」放 metadata、信封 amount 字段填卖出边（契约 requiredFields 校验用）。
- [ ] **Step 9: 行为测试先红后绿**（spec §9.3 后半）：批准→EXECUTING 建腿 1；余额不足批准→FAILED 零资金单；腿 1 确认→AWAITING_DELIVERY 且 84 落账（mock accounting 断言 code/借贷科目）；simulateDelivery→DELIVERED 且 85 落 F_LIQ；accept→SUCCESS 且 86 落账；**未到货 accept 拒**；**二次 accept 拒**；DECLINED→REJECTED。**审计探针**（spec §9.7）：断言每条状态边的审计调用含 fromStatus/toStatus、显式 requestId、审批双码带 approvalNo+causationId。
- [ ] **Step 10: 闸**——根 tsc + lp-desk 目录 jest 全绿。
- [ ] **Step 11: Commit** `feat(乙波一T5): LP兑换workflow——先款后货三腿84/85/86+前厅验收+⚡到货`

---

### Task 6: LP 兑换 controller + RBAC 路由登记

**Files:**
- Create: `src/modules/asset-treasury/lp-desk/lp-exchange.controller.ts`
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（route() 六条）
- Modify: `src/modules/asset-treasury/lp-desk/lp-desk.module.ts`（controllers 补）
- Test: 控制器薄层不单测（照划转单先例，行为已在 T5 覆盖；RBAC 由 T10 verify:rbac 判）

**Interfaces:**
- Consumes: T5 workflow 四方法 + T4 服务 list/getView
- Produces: `POST /admin/lp-exchanges`（开单）/ `POST /admin/lp-exchanges/:exchangeNo/cancel` / `POST /admin/lp-exchanges/:exchangeNo/accept` / `POST /admin/lp-exchanges/:exchangeNo/simulate-delivery`（⚡）/ `GET /admin/lp-exchanges` / `GET /admin/lp-exchanges/:exchangeNo`

- [ ] **Step 1: controller**——照划转单 controller 全形态（buildActor 原样、ValidationPipe、@RequirePermissions(buildPermissionCode)）；写动作 LP_WRITE、读 LP_READ；simulate-delivery 归 LP_WRITE（⚡演示件随经办组，照对账域 ⚡ 归组先例——**不**挂 DEMO_CLOCK_WRITE，那是拨钟组，此处是推单据）。
- [ ] **Step 2: route() 六条**（静态段先于 :exchangeNo，照 470 区注释惯例）。
- [ ] **Step 3: 闸**——根 tsc；`npm run db:base:sync` 记入交接。
- [ ] **Step 4: Commit** `feat(乙波一T6): LP兑换六端点+route登记`

---

### Task 7: admin-web——LP 档案两页

**Files:**
- Create: `admin-web/src/pages/LpProfileList.tsx` / `admin-web/src/pages/LpProfileDetail.tsx`
- Modify: `admin-web/src/App.tsx`（路由）＋ `admin-web/src/components/DashboardLayout.tsx`（Treasury 导航组两项）＋ `admin-web/src/rbac/permissions.ts`（LP 权限码常量）＋ `admin-web/src/pages/approvalEntityRoutes.ts`（LP_PROFILE_APPROVAL/LP_PROFILE_CHANGE → `/admin/lp-profiles/:ref`）＋ `admin-web/src/pages/ApprovalPoliciesPage.tsx:37-73` `ACTION_TYPE_LABELS` 两条人话标签

**Interfaces:**
- Consumes: T3 六端点；模板页 `InternalTransferList.tsx` / `InternalTransferDetail.tsx`（结构、fetch、权限门控写法照抄）
- Produces: 路由 `/admin/lp-profiles`、`/admin/lp-profiles/:lpNo`

- [ ] **Step 1: List**——列：lpNo（链详情）/name/status 徽章/agreementRef/createdAt；「Register LP」按钮（持 `treasury.act_lp` 码显示）开建档 modal（六字段+reason），提交 `POST /admin/lp-profiles` 后提示「已提交 CFO 审批」。
- [ ] **Step 2: Detail**——基本信息卡（名称/协议号/状态）+ 结算坐标卡（银行/IBAN/网络/地址）+ 动作区（**状态×持码**双维，波二判例：ACTIVE 显示 Suspend+Propose settlement change；SUSPENDED 显示 Reactivate；PENDING_APPROVAL 只读并显示 approvalNo 链接审批页）+ 审计区惯例（按 lpNo 查）。变更 modal：新坐标四字段+reason。
- [ ] **Step 3: 联动登记**——approvalEntityRoutes 两行、ACTION_TYPE_LABELS（`LP_PROFILE_APPROVAL: 'LP profile registration'` / `LP_PROFILE_CHANGE: 'LP settlement change'`）、导航项、permissions.ts 常量。
- [ ] **Step 4: 闸（两条永不豁免①）**——`cd admin-web && npx tsc -b --noEmit`；起 preview 实点：建档→审批页可见→（超管切 CFO）批→回列表 ACTIVE；**截图**存 `doc-final/superpowers/checkups/2026-09-29-campaign-b-wave1-evidence/`。
- [ ] **Step 5: Commit** `feat(乙波一T7): LP档案List/Detail+建档与变更modal+审批联动`

---

### Task 8: admin-web——LP 兑换单两页

**Files:**
- Create: `admin-web/src/pages/LpExchangeList.tsx` / `admin-web/src/pages/LpExchangeDetail.tsx`
- Modify: `App.tsx` / `DashboardLayout.tsx` / `approvalEntityRoutes.ts`（LP_EXCHANGE_APPROVAL → `/admin/lp-exchanges/:ref`）/ `ACTION_TYPE_LABELS`

**Interfaces:**
- Consumes: T6 六端点；模板 `InternalTransferDetail.tsx`（腿区）；`useSimulationMode`（⚡按钮门控，照资金单页惯例）
- Produces: 路由 `/admin/lp-exchanges`、`/admin/lp-exchanges/:exchangeNo`

- [ ] **Step 1: List**——列：exchangeNo/LP 名/卖出边 `${amount} ${assetCode}`/买入边/status 徽章/createdAt；「Initiate exchange」按钮（act_lp）开单 modal：选 ACTIVE 档案（`GET /admin/lp-profiles?status=ACTIVE`）/卖出资产+金额/买入资产+金额/**prudential purpose 必填**/reason。
- [ ] **Step 2: Detail**——两边金额卡（Sell → Buy 大字）+ 档案卡（lpNo 链接）+ 状态时间线（八态人话标签：待审批/付款中/等待 LP 发货/已到货待验收/完成/失败/已拒绝/已撤回）+ 资金单腿区（照划转单腿区：fundsOrderNo 链接/legSeq/status/externalRef）+ 动作区（状态×持码）：PENDING_APPROVAL→Cancel；AWAITING_DELIVERY→⚡`Simulate LP delivery`（useSimulationMode 门控）；DELIVERED→**Accept delivery** modal（并排展示 Expected=buyAmount vs Received=腿 2 金额，确认即 accept——裁定 5 的两数展示落在这）。
- [ ] **Step 3: 联动与导航**（同 T7 Step 3 形态）。
- [ ] **Step 4: 闸**——admin tsc；preview 实点一条全弧（开单→批→⚡推腿 1→⚡到货→验收）；**截图**（含悬空期 AWAITING_DELIVERY 态与验收两数 modal 各一张）入 evidence 目录。
- [ ] **Step 5: Commit** `feat(乙波一T8): LP兑换List/Detail+开单/验收/⚡到货+八态时间线`

---

### Task 9: 种子 + reset 登记 + baseline + 重铺闸 + verify:coa

**Files:**
- Modify: `prisma/seed.business.ts`（新 `seedLpDesk()`：两档案+一张 SUCCESS 历史单三腿三分录+回单）
- Modify: `scripts/reset-business-data.ts` `BUSINESS_DELEGATES_FK_SAFE`（`'lpExchange'` 在 `'liquidityProvider'` 之前，两者都在 `'asset'` 之前——FK 序）
- Modify: `doc-final/demo/data.md`（手写区新节：LP 名册两行+历史单）＋ `doc-final/demo/baseline.md`（F_LIQ 直比判据、期望余额、LPX 历史单）

**Interfaces:**
- Consumes: T1-T5 全部产物
- Produces: 种子 LP `Falcon Liquidity FZE`（ACTIVE）/`Dune OTC DMCC`（SUSPENDED）；历史单：卖 50,000 AED 买 13,600 USDT（示例价 3.6765 手填口径），SUCCESS 全档

- [ ] **Step 1: seedLpDesk()**——照 `seedCapitalInjection`（seed.business.ts:1922-2056）的直写形态：两档案行（ACTIVE 那家带 approvalNo 占位与建档审计一条）；历史单三腿：分录 84（DR FIRM_OPS/CR FIRM_ASSET，AED，50,000）→85（DR FIRM_ASSET/CR FIRM_LIQ，USDT，13,600）→86（DR FIRM_LIQ/CR FIRM_OPS，USDT，13,600），各配 tbTransferEvidence+accountFlow 镜像+托管回单两行（照资本注入的镜像写法），资金单三张挂 lpExchangeId。**注意**：种子后 F_LIQ 余额=0（85 进 86 出）、F_OPS AED 减 5 万 USDT 加 1.36 万——把这组期望值写进 baseline.md。
- [ ] **Step 2: reset 登记**——`BUSINESS_DELEGATES_FK_SAFE` 两行（加表必配，波二判例）。
- [ ] **Step 3: data.md/baseline.md 同步**（生成区不手改，手写区加节）。
- [ ] **Step 4: 重铺闸⑧实跑**——worktree 内：`bash scripts/stack.sh reset self` → `bash scripts/on-stack.sh self demo:all`，判据对 baseline **全绿**；再 `bash scripts/on-stack.sh self verify:coa`（两恒等式+负余额——**注资缺一笔时只有负余额断言红**，判例在档，四恒等式绿不放行）。
- [ ] **Step 5: 输出证据**——命令+退出码+关键行摘录记入任务交接（不倾倒全量输出）。
- [ ] **Step 6: Commit** `feat(乙波一T9): 种子LP两家+SUCCESS历史单三腿+reset登记+baseline判据——重铺闸⑧/verify:coa全绿`

---

### Task 10: verify:rbac 扩判据 + 词表入库

**Files:**
- Modify: `scripts/verify-rbac.ts`（新桶/组静态判据 + 行为探针：金库开单 201、无 LP_WRITE 的运营 403、CFO 只读 403 写动作；MAKER 表三行已由 T3/T5 加，此处核对）
- Run: `npm run audit:vocab`（审计词表 296→312 入库——数字以实测为准，偏差回填 spec §7 表）

- [ ] **Step 1: 静态判据**——桶数 75→77、组数 83→85、两桶四处齐（联合类型/route/桶/职务）断言。
- [ ] **Step 2: 行为探针**——照既有探针形态各写一正一反；**探针路径先故意打错核实会红**（自证绿灯判例：探针 404 也算过的坑），再改对。
- [ ] **Step 3: 全量跑**——`npx tsx scripts/verify-rbac.ts`（按脚本既有入口）全绿；**既有红集与波前基线恒等**（甲判例口径）。
- [ ] **Step 4: Commit** `feat(乙波一T10): verify:rbac两桶判据+行为探针+词表312入库`

---

### Task 11: 场景 26/27 剧本 + 全弧走查 + 文档收口 + 波二承接

**Files:**
- Modify: `doc-final/demo/script.md`（场景 26/27，暂编，幕次归属注明待战役收官定稿）
- Create: `doc-final/modules/lp-desk.md`（新篇：§0 定位/§1 叙事/§2 状态机/§3 决策点/§4 演示脚本/§5 技术节点/§6 缺口——照 v7-treasury.md 章法；v7 篇 §0 加一句互链「LP 兑换见 lp-desk.md」）
- Modify: `doc-final/modules/overview.md` §4（桶 75→77、组 83→85，Treasury 行扩写；页首计数连动——**聚合计数≠逐行，全文 grep 数字逐处核**，甲波五判例）
- Modify: `doc-final/CHANGELOG.md` 一行；`doc-final/BACKLOG.md`（如走查发现新账）
- Create: `doc-final/superpowers/specs/2026-09-XX-campaign-b-wave2-skeleton.md`（按日期定名；总纲链接/承接本波节【合并基线/实际交付/偏差/悬挂项】/已定事实【F_LIQ 已活+三码在用+看板读数端点现成】/待定岔口【看板阈值线怎么配/注资单复用码 70 还是新码——总纲岔口遗留】）

- [ ] **Step 1: 场景 26 全程实走**（spec §9.1 口径含悬空期与两数验收），十张内截图入 evidence 目录；场景 27 反向实走。
- [ ] **Step 2: 收尾闸**——项目总纲 §7 ⑥（`bash scripts/on-stack.sh self demo:all` 断言终态）；⑦⑧已在 T9，此处复核记录仍绿。
- [ ] **Step 3: 文档四件**（modules 新篇/overview 计数/script 场景/CHANGELOG）+ 波二骨架承接填写。`decisions.md` **本波不动**——F_LIQ 翻案等三条收官统一落（spec §5.6 的 plan 裁定即此行）。
- [ ] **Step 4: 收尾自查**——对 `rules/delivery-checklist.md` 逐触发行报「本任务过哪几条」；对 spec §7 数量表逐行报实测值（对不上停下回填订正，不硬报绿）。
- [ ] **Step 5: Commit** `docs(乙波一T11): 场景26/27+modules/lp-desk新篇+overview计数77桶85组+波二骨架承接`

---

## 任务依赖与派发

```
T1 → T2 → T3 → T7
      T2 → T4 → T5 → T6 → T8
T1 ─────────↗        T5 → T9 → T10 → T11
```
- 执行者一律带项目总纲 §0–§5 要点（派发惯例）；每任务先读模板两处（Global Constraints 注明）。
- **评审档位**：T1/T2/T4/T5/T9 评审升档 opus（动钱/动 COA/动状态机/动种子账），T3/T6/T7/T8/T10/T11 评审执行档；终审 Fable 不降档 + 逐条追 spec 承诺（「承诺没代码不产生 diff」判例）+ 变异测试抽查。
- 收尾对照 `rules/delivery-checklist.md`；本波命中行：审计/新码冻结/新状态/动钱/maker-checker/MAKER 表/权限组四处/admin 端点/前端入口/新字段客户面（**不涉**——LP 全在管理台，client-web 零触碰，T11 自查确认）/金额最小单位/业务键/改 schema/改种子/改前端截图/多波承接/每轮收尾。
