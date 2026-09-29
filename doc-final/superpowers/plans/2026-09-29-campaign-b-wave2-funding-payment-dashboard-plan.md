# 战役乙波二 · 注资单 + 供应商付款单 + 公司资金全景看板 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建注资单（运行时资本注入，复用码 70）与供应商付款单（收款方从外包商登记册选，新码 87），加 admin 公司资金全景看板（水位+阈值线+在途+利润格），全程单据+审批+账本+对账可见。

**Architecture:** 两个新主体照 LP 兑换单/划转单模板（显式迁移表 / CFO 单步审批 / workflow 编排 / 资金单腿 / 审计信封）；注资=进项单腿（照 LP 买入腿形态，落账挪到确认边）、付款=出项单腿（照 LP 卖出腿 84 同形）；看板纯前端组装读既有 TB 端点，零新后端聚合。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle ｜ admin-web React ｜ jest

**Spec:** `doc-final/superpowers/specs/2026-09-29-campaign-b-wave2-funding-payment-dashboard-spec.md`（§0 七裁定、§4 两腿两码、§7 预期终态数量表、§9 验收判据）

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用
- 本轮特有：
  - **COA 十码零增删**（总纲 §2「COA 内做完」）——本波**无**波一那样的科目例外，任何新科目=停下上报
  - 转账码**只许 87 一枚**（spec §4 定死）；注资**必须复用 70**，不许新开；执行中发现不够 = 停下上报
  - 两张新单据 `prudentialPurpose` 必填（8 年安全港记录地基）
  - 单号前缀 `CIN`（注资）/ `PAY`（付款）——T1 开工先 `grep -rn "generateReferenceNo('" src | sort` 确认不撞（spec 起草日已核不撞，防执行期间新占），撞了停下上报
  - 本波动钱+动状态机+动种子账：**T1/T2/T3/T4/T5/T9 任务级评审升档 opus**，T6/T7/T8/T10/T11 评审执行档；终审 Fable 不降档（项目总纲 §6 派发表）
  - jest 必须在仓库根跑且带 `DATABASE_URL`（缺则假红——判例在案）；本机 shell 默认 node18，每条命令前置 nvm20 PATH（记忆在案）
  - 前端两条永不豁免：改前端必截图；动钱必 `verify:coa`
  - 看板阈值常量唯一取值判据：**基线在线上方、且一笔演示级动作能可见地拉近水位与线的距离**（spec §5）；候选 AED 900,000 / USDT 100,000（基线 F_OPS AED 950,000 / USDT 113,600，`demo/baseline.md:240` 实测在案）
  - **SLA 判定（交付清单第 3 行的回答，写死在此）**：两张新单据所有中间态（AWAITING_FUNDS/RECEIVED/EXECUTING）**均不计时**——唯一的钟是审批层 48h timeout（照 LP AWAITING_DELIVERY 无计时先例；⚡驱动的演示态挂着是常态不是事故）；执行者不得自加 SLA 字段或扫钟

**任务模板（照抄对象，全程有效）**：`src/modules/asset-treasury/lp-desk/` 全目录（乙波一刚交付：服务/工作流/审批 handler/控制器/迁移表常量/dto——最近先例优先）＋ `src/modules/asset-treasury/internal-transfers/`（六态骨架与 onDecided/onLeg 纪律）。每个后端任务开工先读这两处。

---

### Task 1: 地基——转账码 87 + 两表 schema + 资金单第六/第七父键 + reset 登记

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts`
- Modify: `prisma/schema.prisma`（两 model + FundsOrder 两父键 + Asset/OutsourcingVendor 反向 relation）＋迁移 `npx prisma migrate dev --name wave2_company_funding`
- Modify: `src/modules/funds-orders/funds-order.service.ts`（八方法点，照乙波一 T4 同款清单）+ `src/modules/funds-orders/dto/funds-order.dto.ts`
- Modify: `scripts/reset-business-data.ts` `BUSINESS_DELEGATES_FK_SAFE`
- Test: `src/modules/funds-orders/funds-order.service.spec.ts`（扩）

**Interfaces:**
- Produces: `TB_TRANSFER_CODES.VENDOR_PAYMENT = 87`；`CapitalInjection`/`VendorPayment` 两 model；FundsOrder 父键 `capitalInjectionId`/`vendorPaymentId`；`directionOf`：注资腿='IN'、付款腿='OUT'——后续任务全靠这些名字

- [ ] **Step 1: 转账码**——`tb-transfer-codes.constant.ts` 新段（87 后**不留** TODO 空位）：
```ts
// ── 战役乙波二（2026-09-29）：供应商付款（87）。单腿出：运营户直出到收款坐标；注资复用 70 ──
VENDOR_PAYMENT: 87, // 付款腿：DR FIRM_OPS / CR FIRM_ASSET（付款币 ledger，付给在册外包商，外穿）
```
- [ ] **Step 2: schema 两 model**（照 `LpExchange` model 风格；金额 Decimal 存元、换算展示层）：
```prisma
// 战役乙波二（2026-09-29）：注资单——运行时资本注入。进项单腿，钱到运营户不过前厅（F_LIQ 是 LP 专用），落账复用码 70。
model CapitalInjection {
  id                String    @id @default(uuid())
  cinNo             String    @unique
  contributorName   String    // 出资方名称（一行文本，不立主体）
  assetId           String
  amount            Decimal   // 元
  prudentialPurpose String    // 审慎管理目的（8 年安全港记录，必填）
  status            String    @default("PENDING_APPROVAL") // PENDING_APPROVAL | AWAITING_FUNDS | RECEIVED | SUCCESS | REJECTED | CANCELLED
  reason            String
  toWalletId        String    // F_OPS（注入币网络行）
  approvalNo        String?
  receivedAt        DateTime?
  settledAt         DateTime?
  traceId           String
  createdByUserId   String
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  asset       Asset @relation("CapitalInjectionAsset", fields: [assetId], references: [id])
  fundsOrders FundsOrder[] @relation("CapitalInjectionFundsOrders")
  @@index([status])
  @@map("capital_injections")
}

// 战役乙波二：供应商付款单——公司→在册外包商，出项单腿（码 87）。收款方存 vendorNo 业务键引用（登记册无坐标，收款坐标金库手填）。
model VendorPayment {
  id                String    @id @default(uuid())
  payNo             String    @unique
  vendorId          String
  vendorNo          String
  vendorName        String    // 快照，列表零联查
  payeeAccountRef   String    // 收款账户坐标（一行文本，资金单 to 侧记录）
  assetId           String
  amount            Decimal   // 元
  purposeNote       String    // 付款事由（如「HexTrust 2026-09 月费」）
  prudentialPurpose String
  status            String    @default("PENDING_APPROVAL") // PENDING_APPROVAL | EXECUTING | SUCCESS | FAILED | REJECTED | CANCELLED
  reason            String
  fromWalletId      String    // F_OPS（付款币网络行）
  approvalNo        String?
  failureReasonCode String?   // INSUFFICIENT_FIRM_BALANCE | LEG_FAILED
  failureNote       String?
  executedAt        DateTime?
  settledAt         DateTime?
  traceId           String
  createdByUserId   String
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  vendor      OutsourcingVendor @relation("VendorPayments", fields: [vendorId], references: [id])
  asset       Asset @relation("VendorPaymentAsset", fields: [assetId], references: [id])
  fundsOrders FundsOrder[] @relation("VendorPaymentFundsOrders")
  @@index([status])
  @@index([vendorNo])
  @@map("vendor_payments")
}
```
`FundsOrder` 加：`capitalInjectionId String?` / `vendorPaymentId String?` + 两 relation + `@@unique([capitalInjectionId, legSeq, attempt])` / `@@unique([vendorPaymentId, legSeq, attempt])` + 两 `@@index`（照 `lpExchangeId` 模板行旁）。`Asset` 加 `CapitalInjectionAsset`/`VendorPaymentAsset` 反向 relation，`OutsourcingVendor` 加 `VendorPayments` 反向 relation。
- [ ] **Step 3: funds-order 八方法点先写失败测试**（扩既有 spec 文件）：
```ts
it('directionOf: capital-injection leg is IN', ...);   // { capitalInjectionId, legSeq: 1 } → 'IN'
it('directionOf: vendor-payment leg is OUT', ...);     // { vendorPaymentId, legSeq: 1 } → 'OUT'
it('funding legs never count toward customer closure guard', ...); // countNonTerminalByCustomer
```
跑红（分支不存在）。
- [ ] **Step 4: 八方法点实现**（乙波一 T4 Step 3 同款清单逐一）：`parentOf` 加两键；`create` 互斥数组与 data 加键；`directionOf` 两分支；`findByParent`；`countNonTerminalByCustomer` **不加**（两单无客户）；`parentFkWhere`；`findAllForAdmin`（include+业务号映射 cinNo/payNo）；`findOneByNoForAdmin`。dto `CreateFundsOrderInput` 加两可选键。
- [ ] **Step 5: reset 登记**——`BUSINESS_DELEGATES_FK_SAFE` 加 `'capitalInjection'`/`'vendorPayment'` 两行（加表必配，波二判例）：均在 `'asset'` 之前；`'vendorPayment'` 必须在外包商 delegate（grep 该文件现名，甲波四加的）之前——FK 序。
- [ ] **Step 6: 闸**——`npx prisma migrate dev` 空库能建；Step 3 测试转绿；根 tsc + `npx jest src/modules/funds-orders --rootDir .` 全绿。
- [ ] **Step 7: Commit** `feat(乙波二T1): 转账码87+注资/付款两表+资金单第六第七父键+reset登记`

---

### Task 2: 注资单主体——service + 六态迁移表 + 审计 CIN 族

**Files:**
- Create: `src/modules/asset-treasury/company-funding/capital-injection.service.ts`
- Create: `src/modules/asset-treasury/company-funding/constants/capital-injection-transitions.constant.ts`
- Create: `src/modules/asset-treasury/company-funding/dto/capital-injection.dto.ts`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Test: `src/modules/asset-treasury/company-funding/capital-injection.service.spec.ts`

**Interfaces:**
- Consumes: T1 schema
- Produces: `CapitalInjectionService.create(input)`（cinNo=`generateReferenceNo('CIN')`，status=PENDING_APPROVAL；钱包 id 由 workflow 解析传入，本服务不解析——照 lp-exchange.service 头注释纪律）；`transition(cinNo, to, patch?)`（内含 assertTransition）；`stampApprovalNo`；`findByNo/getView/list`（零 UUID 投影）；`CapitalInjectionStatus` 六态枚举；`AuditEntityTypes.CAPITAL_INJECTION`、`AuditBusinessWorkflowTypes.CAPITAL_INJECTION`

- [ ] **Step 1: 迁移表**（六态五边，spec §2.2 原样）：
```ts
import { CapitalInjectionStatus as S } from '../dto/capital-injection.dto';
/** 六态五边（乙波二 spec §2.2）。RECEIVED 必经——确认入账（核数）只能从「已到款」走，
 *  AWAITING_FUNDS 不能直接跳 SUCCESS。无 FAILED 态：进项 ⚡到款在演示里不会失败，审批过期归 REJECTED。 */
export const CAPITAL_INJECTION_TRANSITIONS: Record<string, readonly string[]> = {
  [S.PENDING_APPROVAL]: [S.AWAITING_FUNDS, S.REJECTED, S.CANCELLED],
  [S.AWAITING_FUNDS]: [S.RECEIVED],
  [S.RECEIVED]: [S.SUCCESS],
  [S.SUCCESS]: [], [S.REJECTED]: [], [S.CANCELLED]: [],
};
```
- [ ] **Step 2: dto**——`CapitalInjectionStatus` 枚举；`CreateCapitalInjectionDto`（contributorName/assetId/amount/prudentialPurpose/reason 全必填，amount>0 校验）；`CapitalInjectionView`（cinNo/contributorName/assetCode/amount/status/approvalNo/legs/各时间戳——**无 id**）。
- [ ] **Step 3: 审计 CIN 族六码**——`AuditEntityTypes` 加 `CAPITAL_INJECTION`；`AuditBusinessWorkflowTypes` 加 `CAPITAL_INJECTION`；契约表新 `CAMPAIGN_B_CAPITAL_INJECTION_AUDIT_ACTIONS`（并入总注册，照 CAMPAIGN_B_LP_PROFILE 表挂法）：
```ts
CAPITAL_INJECTION_REQUESTED:      { domain: 'TREASURY', correlationMode: N, requiredFields: ['amount','reason'], requiresCausation: false },
CAPITAL_INJECTION_APPROVED:       { domain: 'TREASURY', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
CAPITAL_INJECTION_REJECTED:       { domain: 'TREASURY', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
CAPITAL_INJECTION_CANCELLED:      { domain: 'TREASURY', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
CAPITAL_INJECTION_FUNDS_RECEIVED: { domain: 'TREASURY', correlationMode: I, requiredFields: ['amount'], requiresCausation: false },
CAPITAL_INJECTION_CONFIRMED:      { domain: 'TREASURY', correlationMode: I, requiredFields: ['amount','effectiveDate'], requiresCausation: false },
```
主体信封：primarySubject=CAPITAL_INJECTION·cinNo，审批单 INSTRUMENT、资金单 RELATED；展示级字段（contributorName、金额）镜像 metadata（甲 R5 判例）；显式 `requestId`（`${action}_${cinNo}_${randomUUID()}`）。
- [ ] **Step 4: 服务**——照 lp-exchange.service 结构：create（守卫全在 dto+服务双层：amount>0、prudentialPurpose/contributorName 非空）/transition/stampApprovalNo/findByNo/getView/list；audit 写入收在 workflow 侧统一信封（照 lp-exchange 先例，transferAudit 形态）。
- [ ] **Step 5: 变异测试先红**（spec §9.3 注资半）：
```ts
it('rejects create without prudentialPurpose', ...);
it('rejects create with zero amount', ...);
it('rejects PENDING_APPROVAL → RECEIVED (must pass AWAITING_FUNDS)', ...);
it('rejects AWAITING_FUNDS → SUCCESS (must pass RECEIVED)', ...);
it('SUCCESS is terminal — second confirm rejected', ...);
```
- [ ] **Step 6: 闸**——根 tsc + `npx jest src/modules/asset-treasury/company-funding --rootDir .` 全绿。
- [ ] **Step 7: Commit** `feat(乙波二T2): 注资单主体——六态五边+CIN单号+审计六码注资族`

---

### Task 3: 注资审批 + workflow + controller + RBAC 两组两桶

**Files:**
- Create: `src/modules/asset-treasury/company-funding/capital-injection-approval.service.ts`
- Create: `src/modules/asset-treasury/company-funding/capital-injection-workflow.service.ts`
- Create: `src/modules/asset-treasury/company-funding/capital-injection.controller.ts`
- Create: `src/modules/asset-treasury/company-funding/company-funding.module.ts`（挂 `app.module.ts`；imports 照 lp-desk.module：Prisma/Audit/TigerBeetle/FundsOrders/FundsLayer/Approvals/Reconciliation）
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`（三张表各 +1）
- Modify: `scripts/verify-rbac.ts` `MAKER_GROUP_BY_POLICY` +1 行
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（组联合类型 + route() 六条 + Treasury 桶两只 + 职务绑定）
- Test: `src/modules/asset-treasury/company-funding/capital-injection-workflow.service.spec.ts`

**Interfaces:**
- Consumes: T1/T2 全部；`SystemWalletResolver.resolve(assetId, 'F_OPS')`；`FundsOrderService.create/advance`；`SimulatedCustodianStatementService.recordLegMovement`；`AccountingService.executeTransfer`
- Produces: 审批类型 `CAPITAL_INJECTION_APPROVAL`（金库提/CFO 单步/48h/可撤，照 `INTERNAL_TRANSFER_APPROVAL` 条目参数）；decided 事件 `workflow.capital-injection.decided`；权限组 `FUNDING_READ`/`FUNDING_WRITE`；桶 `treasury.view_funding`/`treasury.act_funding`；端点六条（Step 4）——T5/T6 全靠这些名字

- [ ] **Step 1: 审批注册**——`approval.constants.ts`：`ApprovalActionTypes` +`CAPITAL_INJECTION_APPROVAL`；`DEFAULT_APPROVAL_POLICIES` 加 `{ steps: [{ stepNo: 1, roles: ['CFO'] }], timeoutHours: 48, allowCancel: true }`；`V1_APPROVAL_ACTION_TYPES` +1（**漏白名单=UI 永不渲染，甲教训**）。`verify-rbac.ts` `MAKER_GROUP_BY_POLICY` 加 `CAPITAL_INJECTION_APPROVAL: 'FUNDING_WRITE'`。
- [ ] **Step 2: approval handler**（照 lp-exchange-approval.service 17 行模板）：actionType=`CAPITAL_INJECTION_APPROVAL`，workflowType=`AuditBusinessWorkflowTypes.CAPITAL_INJECTION`。
- [ ] **Step 3: workflow 四方法**：
  - `initiate(dto, actor)`：守卫（Step 5 测的三条）→ `systemWallets.resolve(assetId,'F_OPS')` 得 toWalletId → `injections.create` → `approvals.createAndSubmit({actionType, entityRef: cinNo, objectSnapshot: {cinNo, contributorName, amount: '${amount} ${currency}', prudentialPurpose, impact 一句话}（零 UUID）})` → `stampApprovalNo` → 审计 REQUESTED；
  - `@OnEvent('workflow.capital-injection.decided')`：非 PENDING_APPROVAL return；APPROVED→transition(AWAITING_FUNDS)+审计 APPROVED；DECLINED/EXPIRED→transition(REJECTED)+审计 REJECTED；CANCELLED→return（撤回口自己收口）；
  - `simulateContribution(cinNo, actor)`（⚡）：守卫 status=AWAITING_FUNDS → createLeg（legSeq=1，from=null+外部侧填 contributorName、to=toWalletId，eventCode `CAPITAL_INJECTION`，用既有资金单模拟推进方式直接走到 CONFIRMED——照 lp simulateDelivery 先例）→ `custodianStatement.recordLegMovement`（IN，F_OPS 行——**回单先于落账**，此处只写回单**不落账**）→ transition(RECEIVED, {receivedAt}) → 审计 FUNDS_RECEIVED（⚡也留痕，铁律①）；
  - `confirm(cinNo, actor)`：守卫 status=RECEIVED（迁移表天然拒二次）→ post 码 70（DR FIRM_ASSET / CR FIRM_OPS，注入币 ledger，isExternalCrossing——**落账在确认边，先账后状态**）→ `fundsOrders.advance(leg.id, CLEAR, 'CAPITAL_INJECTION_WORKFLOW')` → transition(SUCCESS, {settledAt}) → 审计 CONFIRMED（metadata 带 expected=amount / received=腿金额——两数并排的后端源）；
  - `cancel(cinNo, dto, actor)`：照划转单（仅 PENDING_APPROVAL，先撤审批单再翻状态）。
- [ ] **Step 4: controller + RBAC**——端点（`@RequirePermissions(buildPermissionCode(...))` 照 lp-exchange.controller）：`POST /admin/capital-injections`（开单）/ `POST /admin/capital-injections/:cinNo/cancel` / `POST /admin/capital-injections/:cinNo/simulate-contribution`（⚡随经办组，照 LP simulate-delivery 归组先例）/ `POST /admin/capital-injections/:cinNo/confirm`（以上 FUNDING_WRITE）/ `GET /admin/capital-injections` + `GET /admin/capital-injections/:cinNo`（FUNDING_READ）。`rbac.catalog.ts`：联合类型加 `'FUNDING_READ' | 'FUNDING_WRITE'`；route() 六条（静态段先于 :cinNo）；Treasury 域桶数组加：
```ts
{ key: 'treasury.view_funding', label: 'View capital injections & vendor payments',
  description: 'Browse capital-injection and vendor-payment orders with their funds-order legs', groups: ['FUNDING_READ'] },
{ key: 'treasury.act_funding', label: 'Operate company funding',
  description: 'Initiate capital injections and vendor payments, confirm receipts — CFO signs off', groups: ['FUNDING_WRITE'] },
```
职务绑定：金库（持 LP_WRITE 那行）加 `'FUNDING_READ','FUNDING_WRITE'`；CFO/内审（持 LP_READ 两行）各加 `'FUNDING_READ'`。
- [ ] **Step 5: 行为测试先红后绿**（mock approvals/accounting/fundsOrders 照 lp-exchange-workflow.spec 模式）：批准→AWAITING_FUNDS；⚡打款→RECEIVED **且 accounting.executeTransfer 未被调**（落账不在此边——本 plan 与 LP 腿 2 的关键差异，写成显式断言）；confirm→SUCCESS 且断言 code 70、DR FIRM_ASSET/CR FIRM_OPS；未批 ⚡拒；未到款 confirm 拒；二次 confirm 拒；DECLINED→REJECTED；审计探针：每边 fromStatus/toStatus、审批双码带 approvalNo+causationId。
- [ ] **Step 6: 闸**——根 tsc + company-funding 目录 jest 全绿；`npm run db:base:sync` 记入交接。
- [ ] **Step 7: Commit** `feat(乙波二T3): 注资审批+workflow+六端点+Treasury域funding两桶两组`

---

### Task 4: 付款单主体——service + 六态迁移表 + 审计 PAY 族 + 外包商守卫

**Files:**
- Create: `src/modules/asset-treasury/company-funding/vendor-payment.service.ts`
- Create: `src/modules/asset-treasury/company-funding/constants/vendor-payment-transitions.constant.ts`
- Create: `src/modules/asset-treasury/company-funding/dto/vendor-payment.dto.ts`
- Modify: `src/modules/governance/compliance-office/outsourcing-vendors.service.ts`（如无则加 `assertActiveByNo(vendorNo)`：查行、`status!=='ACTIVE'` 抛 BadRequest——5 行只读，照 LpProfileService.assertActiveByNo 形态；已有同义方法则复用不加）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Test: `src/modules/asset-treasury/company-funding/vendor-payment.service.spec.ts`

**Interfaces:**
- Consumes: T1 schema；`OutsourcingVendorsService.assertActiveByNo`（横向读，铁律③放行；company-funding.module imports ComplianceOffice 模块或其导出的 service）
- Produces: `VendorPaymentService.create(input)`（payNo=`generateReferenceNo('PAY')`，vendorName 落快照）；`transition(payNo, to, patch?)`；`assertFirmOpsBalance(currency, amountMinor)`（私有 10 行只读守卫，照 internal-transfer.service.ts:76-90 同款注释）；`stampApprovalNo/findByNo/getView/list`；`VendorPaymentStatus` 六态枚举；`AuditEntityTypes.VENDOR_PAYMENT`、`AuditBusinessWorkflowTypes.VENDOR_PAYMENT`

- [ ] **Step 1: 迁移表**（六态六边，spec §3.2 原样，照划转单骨架）：
```ts
import { VendorPaymentStatus as S } from '../dto/vendor-payment.dto';
/** 六态六边（乙波二 spec §3.2）。批准即复核余额：不足落 FAILED 零资金单（照 LP/划转单先例）。 */
export const VENDOR_PAYMENT_TRANSITIONS: Record<string, readonly string[]> = {
  [S.PENDING_APPROVAL]: [S.EXECUTING, S.FAILED, S.REJECTED, S.CANCELLED],
  [S.EXECUTING]: [S.SUCCESS, S.FAILED],
  [S.SUCCESS]: [], [S.FAILED]: [], [S.REJECTED]: [], [S.CANCELLED]: [],
};
```
- [ ] **Step 2: dto**——`VendorPaymentStatus` 枚举；`CreateVendorPaymentDto`（vendorNo/payeeAccountRef/assetId/amount/purposeNote/prudentialPurpose/reason 全必填，amount>0）；`VendorPaymentView`（payNo/vendorNo/vendorName/payeeAccountRef/assetCode/amount/purposeNote/status/approvalNo/legs/时间戳——**无 id**）。
- [ ] **Step 3: 审计 PAY 族六码**——契约表新 `CAMPAIGN_B_VENDOR_PAYMENT_AUDIT_ACTIONS`：
```ts
VENDOR_PAYMENT_REQUESTED:         { domain: 'TREASURY', correlationMode: N, requiredFields: ['amount','reason'], requiresCausation: false },
VENDOR_PAYMENT_EXECUTION_STARTED: { domain: 'TREASURY', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
VENDOR_PAYMENT_EXECUTED:          { domain: 'TREASURY', correlationMode: I, requiredFields: ['amount'], requiresCausation: false },
VENDOR_PAYMENT_FAILED:            { domain: 'TREASURY', correlationMode: I, requiredFields: ['reasonCode'], requiresCausation: false },
VENDOR_PAYMENT_REJECTED:          { domain: 'TREASURY', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
VENDOR_PAYMENT_CANCELLED:         { domain: 'TREASURY', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
```
信封：primary=VENDOR_PAYMENT·payNo，subjects 加外包商（OUTSOURCING_VENDOR 实体码已存在则引用、不存在则以 metadata 记 vendorNo——**开工 grep `AuditEntityTypes` 实测再定**，不臆断）+审批单 INSTRUMENT+资金单 RELATED；vendorName/payeeAccountRef 镜像 metadata；**每条带显式 `requestId`**（`${action}_${payNo}_${randomUUID()}`，漏了被静默去重——交付清单第 1 行）。
- [ ] **Step 4: 服务**——create（守卫：`vendors.assertActiveByNo(vendorNo)`、amount>0、三个文本字段非空；vendorId/vendorName 从档案行落快照）/assertFirmOpsBalance/transition/stampApprovalNo/getView/list。
- [ ] **Step 5: 变异测试先红**（spec §9.3 付款半）：
```ts
it('rejects create when vendor is TERMINATED', ...);
it('rejects create with zero amount', ...);
it('rejects create without prudentialPurpose', ...);
it('rejects EXECUTING → CANCELLED (not in table)', ...);
it('SUCCESS is terminal — no further transitions', ...);
```
- [ ] **Step 6: 闸**——根 tsc + company-funding、compliance-office 两目录 jest 全绿。
- [ ] **Step 7: Commit** `feat(乙波二T4): 付款单主体——六态六边+PAY单号+审计六码付款族+外包商ACTIVE守卫`

---

### Task 5: 付款 workflow + 审批 + controller + 名册路由 OR 粗门

**Files:**
- Create: `src/modules/asset-treasury/company-funding/vendor-payment-workflow.service.ts`
- Create: `src/modules/asset-treasury/company-funding/vendor-payment-approval.service.ts`
- Create: `src/modules/asset-treasury/company-funding/vendor-payment.controller.ts`
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`（三张表各 +1：`VENDOR_PAYMENT_APPROVAL`，CFO 单步 48h 可撤）
- Modify: `scripts/verify-rbac.ts` `MAKER_GROUP_BY_POLICY` + `VENDOR_PAYMENT_APPROVAL: 'FUNDING_WRITE'`
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（route() 四条 + **名册两条 GET 路由 groups 加 `'FUNDING_WRITE'`**）
- Modify: `src/modules/asset-treasury/company-funding/company-funding.module.ts`（providers/controllers 补齐）
- Test: `src/modules/asset-treasury/company-funding/vendor-payment-workflow.service.spec.ts`

**Interfaces:**
- Consumes: T4 服务全部；T1 码 87；`FundsOrderService.create/stampExternalRef/advance`；`SimulatedCustodianStatementService.recordLegMovement`；`AccountingService.executeTransfer`
- Produces: `initiate(dto, actor)` / `cancel(payNo, dto, actor)`；decided 事件 `workflow.vendor-payment.decided`；端点 `POST /admin/vendor-payments` / `POST /admin/vendor-payments/:payNo/cancel` / `GET /admin/vendor-payments` / `GET /admin/vendor-payments/:payNo`

**付款腿走法（照 LP 卖出腿 84 全套纪律：先账后状态、落账失败停在原地不重试；腿 1 推进走资金单页 ⚡，付款详情页不设推单按钮）：**

| 腿 | legSeq | 建单时机 | 资金单坐标 | 落账 | eventCode |
|---|---|---|---|---|---|
| 付款 | 1 | 批准+余额复核过 | from=fromWalletId(F_OPS)，to=null，外部侧=payeeAccountRef | 确认时：DR FIRM_OPS / CR FIRM_ASSET，code 87，付款币 ledger，isExternalCrossing | `VENDOR_PAYMENT` |

- [ ] **Step 1: 审批注册三件套 + MAKER 行 + handler**（同 T3 形态，actionType=`VENDOR_PAYMENT_APPROVAL`，workflowType=`VENDOR_PAYMENT`）。
- [ ] **Step 2: initiate**——守卫（vendor ACTIVE/金额>0/三文本非空）→ `assertFirmOpsBalance(付款币, amountMinor)` → `systemWallets.resolve(assetId,'F_OPS')` → create → createAndSubmit（objectSnapshot：payNo/vendorNo/vendorName/`${amount} ${currency}`/purposeNote/prudentialPurpose——零 UUID）→ stampApprovalNo → 审计 REQUESTED。
- [ ] **Step 3: onDecided**——非 PENDING_APPROVAL return；DECLINED/EXPIRED→REJECTED+审计；APPROVED→**复核余额**（不足→FAILED `INSUFFICIENT_FIRM_BALANCE`+审计，零资金单）→ createLeg(1)→EXECUTING+审计 EXECUTION_STARTED。
- [ ] **Step 4: 腿事件**——`@OnEvent(DomainEventNames.FUNDS_ORDER_STATUS_CHANGED)` 只认 `event.parent.vendorPaymentId`：SUBMITTED→stampExternalRef+`recordLegMovement`（**回单先于落账**）；CONFIRMED→post 87（先账）→`advance(leg.id, CLEAR, 'VENDOR_PAYMENT_WORKFLOW')`→transition(SUCCESS, {settledAt})→审计 EXECUTED；FAILED/TIMEOUT→transition(FAILED,'LEG_FAILED')+审计（注明「付款腿失败，可重新发起」）。
- [ ] **Step 5: cancel**（仅 PENDING_APPROVAL，先撤审批单再翻状态）。
- [ ] **Step 6: controller + 路由**——四条 route()（写 FUNDING_WRITE、读 FUNDING_READ）；**名册 OR 粗门**：`GET /admin/outsourcing-vendors` 与 `GET /admin/outsourcing-vendors/:vendorNo`（rbac.catalog.ts:573-574）groups 数组各加 `'FUNDING_WRITE'`——金库开单要选在册外包商（裁定 5），零权限扩张（只读名册；写路由三条不动）；照 filings 两族 OR 粗门先例，判据交 T10。
- [ ] **Step 7: 行为测试先红后绿**：批准→EXECUTING 建腿 1（断言资金单 create 参数含 vendorPaymentId/legSeq 1/payeeAccountRef）；余额不足批准→FAILED 零资金单；腿 CONFIRMED→SUCCESS 且断言 code 87、DR FIRM_OPS/CR FIRM_ASSET；腿 FAILED→FAILED；未批无腿；DECLINED→REJECTED；审计探针 from/to+approvalNo+causationId。
- [ ] **Step 8: 闸**——根 tsc + company-funding 目录 jest 全绿；`npm run db:base:sync` 记入交接。
- [ ] **Step 9: Commit** `feat(乙波二T5): 付款workflow——单腿87+余额闸+四端点+名册路由OR粗门`

---

### Task 6: admin-web——注资单两页

**Files:**
- Create: `admin-web/src/pages/CapitalInjectionList.tsx` / `admin-web/src/pages/CapitalInjectionDetail.tsx`
- Modify: `admin-web/src/App.tsx`（路由）＋ `admin-web/src/components/DashboardLayout.tsx`（Treasury 导航组）＋ `admin-web/src/rbac/permissions.ts`（FUNDING 权限码常量）＋ `admin-web/src/pages/approvalEntityRoutes.ts`（CAPITAL_INJECTION_APPROVAL → `/admin/capital-injections/:ref`）＋ `ApprovalPoliciesPage.tsx` `ACTION_TYPE_LABELS`（`CAPITAL_INJECTION_APPROVAL: 'Capital injection'`）

**Interfaces:**
- Consumes: T3 六端点；模板页 `LpExchangeList.tsx` / `LpExchangeDetail.tsx`（结构、fetch、权限门控、⚡门控写法照抄）；`useSimulationMode`
- Produces: 路由 `/admin/capital-injections`、`/admin/capital-injections/:cinNo`

- [ ] **Step 1: List**——列：cinNo（链详情）/出资方/`${amount} ${assetCode}`/status 徽章/createdAt；「Initiate injection」按钮（持 `treasury.act_funding` 码显示）开单 modal（出资方/资产/金额/审慎目的必填/reason），提交后提示「已提交 CFO 审批」。
- [ ] **Step 2: Detail**——金额卡（大字）+ 出资方卡 + 状态时间线（六态人话标签：待审批/等出资方打款/已到款待确认/完成/已拒绝/已撤回）+ 资金单腿区（fundsOrderNo 链接/status/externalRef）+ 动作区（**状态×持码**双维，禁加第三维）：PENDING_APPROVAL→Cancel（+approvalNo 链接审批页）；AWAITING_FUNDS→⚡`Simulate contributor payment`（useSimulationMode 门控）；RECEIVED→**Confirm receipt** modal（并排 Expected=amount vs Received=腿金额，确认即 confirm——两数展示落在这）+ 审计区惯例（按 cinNo 查）。
- [ ] **Step 3: 联动登记**——approvalEntityRoutes/ACTION_TYPE_LABELS/导航项/permissions.ts 常量。
- [ ] **Step 3.5: 资金单读面接两个新父键**（T1 评审收口，两族一次接齐）——后端 `src/modules/funds-orders/dto/funds-orders-admin-query.dto.ts` `@IsIn` 白名单加 `'capital-injection'`/`'vendor-payment'` 两值；`admin-web/src/pages/FundsOrderList.tsx`（父单号列映射 + 筛选页签两枚）与 `FundsOrderDetail.tsx`（父单区）加 cinNo/payNo 两族——全部照既有 `lp-exchange`/`exchangeNo` 的接法逐处复制（漏接=注资/付款腿在资金单页父单号空列，铁律⑥）。
- [ ] **Step 4: 闸（两条永不豁免①）**——`cd admin-web && npx tsc -b --noEmit`；起 self 栈实测前先 `stack.sh reset self`（含 db:base:sync 效果，保证后端加载 T3 新路由——只 seed 不重启=403，清单第 8 行）；preview 实点全弧（开单→批→⚡打款→确认，金额铁律：确认后对账本科目页核 F_OPS 同涨）；**截图**存 `doc-final/superpowers/checkups/2026-09-XX-campaign-b-wave2-evidence/`（按实际日期定名，T11 沿用）。
- [ ] **Step 5: Commit** `feat(乙波二T6): 注资List/Detail+开单/确认/⚡打款+六态时间线`

---

### Task 7: admin-web——付款单两页

**Files:**
- Create: `admin-web/src/pages/VendorPaymentList.tsx` / `admin-web/src/pages/VendorPaymentDetail.tsx`
- Modify: `App.tsx` / `DashboardLayout.tsx` / `approvalEntityRoutes.ts`（VENDOR_PAYMENT_APPROVAL → `/admin/vendor-payments/:ref`）/ `ACTION_TYPE_LABELS`（`VENDOR_PAYMENT_APPROVAL: 'Vendor payment'`）/ `permissions.ts`

**Interfaces:**
- Consumes: T5 四端点 + `GET /admin/outsourcing-vendors`（金库经 T5 OR 粗门可读）；模板 `LpExchangeDetail.tsx`（腿区）
- Produces: 路由 `/admin/vendor-payments`、`/admin/vendor-payments/:payNo`

- [ ] **Step 1: List**——列：payNo/收款方（vendorName）/`${amount} ${assetCode}`/事由/status 徽章/createdAt；「Initiate payment」按钮（act_funding）开单 modal：**收款方下拉**（fetch `GET /admin/outsourcing-vendors`，前端过滤 `status==='ACTIVE'`，显示 `name (vendorNo)`）/收款账户坐标/资产+金额/事由/审慎目的必填/reason。
- [ ] **Step 2: Detail**——金额卡 + 收款方卡（vendorNo+vendorName+payeeAccountRef；**持 `COMPLIANCE_OFFICE_VIEW` 码才渲染链接**到 `/admin/outsourcing-vendors/:vendorNo`，其余职务纯文本——状态×持码纪律在跨域链接上的应用，金库/CFO 看文本、内审/高管点得动）+ 状态时间线（六态人话标签：待审批/付款中/完成/失败/已拒绝/已撤回）+ 资金单腿区（腿 1 推进在资金单页 ⚡，本页只展示与跳转）+ 动作区：PENDING_APPROVAL→Cancel。
- [ ] **Step 3: 联动登记**（同 T6 Step 3 形态）。
- [ ] **Step 4: 闸**——admin tsc；preview 实点全弧（开单选 HexTrust→批→资金单页⚡推腿→SUCCESS）；**截图**（含下拉选名册帧、SUCCESS 详情帧）入 evidence 目录。
- [ ] **Step 5: Commit** `feat(乙波二T7): 付款List/Detail+名册下拉开单+持码门控回链`

---

### Task 8: 公司资金全景看板 + FUNDING_DASHBOARD_VIEW 组桶 + 路由锚

**Files:**
- Create: `admin-web/src/pages/CompanyFundsDashboard.tsx`
- Create: `admin-web/src/pages/companyFundsThresholds.ts`
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（联合类型 +`'FUNDING_DASHBOARD_VIEW'`；Treasury 桶 +1；职务绑定四行；`GET /admin/tb/accounts` 两条 route groups 各加 `'FUNDING_DASHBOARD_VIEW'`）
- Modify: `App.tsx` / `DashboardLayout.tsx` / `permissions.ts`

**Interfaces:**
- Consumes: 既有 `GET /admin/tb/accounts`（rows 含 `balance`(最小单位 string)/`assetCode`/COA 码）与 `GET /admin/tb/account-flows`（最近流水）——字段形状照 `LedgerAccountList.tsx:33` 读法；**不建任何新后端聚合端点**
- Produces: 路由 `/admin/company-funds`；桶 `treasury.view_dashboard`；组 `FUNDING_DASHBOARD_VIEW`（金库/CFO/高管/内审恰四职务）

- [ ] **Step 1: RBAC**——联合类型 +1；桶：
```ts
{ key: 'treasury.view_dashboard', label: 'View company funds dashboard',
  description: 'One-screen view of firm liquidity: operating balances vs low-water thresholds, in-transit, settlement and income accounts', groups: ['FUNDING_DASHBOARD_VIEW'] },
```
职务绑定：金库/CFO/高管/内审四行各加 `'FUNDING_DASHBOARD_VIEW'`（**恰四职务**，运营/技术官/合规官等不加——T10 判据）；`GET /admin/tb/accounts` + `GET /admin/tb/accounts/:tbAccountId` 两条 route 的 groups 数组各加 `'FUNDING_DASHBOARD_VIEW'`（OR 路由锚——四职务本就持 `LEDGER_ACCOUNT_READ` 可达，零权限扩张，spec §7 注明）。`npm run db:base:sync` 记入交接。
- [ ] **Step 2: 阈值常量**：
```ts
/** 见底阈值（元）——业主裁定写死常量（乙波二 spec §0 裁定 1），不建配置面。
 *  取值判据：种子基线在线上方（AED 950,000 / USDT 113,600，baseline.md:240），
 *  且一笔演示级动作（LP 卖出腿 5 万 AED / 大额客户兑换）能可见地拉近水位与线。 */
export const COMPANY_FUNDS_THRESHOLDS: Record<string, number> = { AED: 900_000, USDT: 100_000 };
```
- [ ] **Step 3: 页面五区**——① 运营户水位：F_OPS（COA `E.FIRM_OPS`）每币种一张水位卡——余额大字 + 横向水位条 + 阈值刻线 + 低于线时红字「Below threshold」；② F_LIQ 在途待验收格；③ F_SET 结算在途格；④ 三收入格（码 210/211/212 三科目按币种小卡，区题「Income (profit)」——COA 名**开工 grep `TB_CODE_TO_COA` 实名取用，勿臆写前缀**）；⑤ 最近资金动态：`/admin/tb/account-flows` 最近 10 条（时间/方向/金额/eventCode 人话标签）。**换算自写并自测**：最小单位→元用资产 decimals（照 `LedgerAccountList.tsx` 的 decimalsOf 机制取数但独立实现换算函数并配一条单测样例断言 `113600000000 → '113,600.000000'`——该页 decimals 显示错是 BACKLOG §M 已知缺口，本页禁复发，spec §9.2）。
- [ ] **Step 4: 阈值实测校准**——self 栈 `reset`→`up`→`demo:all` 后打开看板：若某币种实际水位已低于候选线，下调该线保持「开局绿」口径，改动回填 Step 2 常量注释与 T11 文档；两币种均在线上方则候选值即终值。
- [ ] **Step 5: 闸**——admin tsc；preview 分别以金库与高管快速登录各截一张（区块齐全、阈值线可见）、以运营登录截「导航无入口」负例一张；截图入 evidence 目录。
- [ ] **Step 6: Commit** `feat(乙波二T8): 公司资金全景看板五区+阈值常量+view_dashboard桶+四职务组`

---

### Task 9: 种子——CIN 壳两张 + PAY 历史单 + baseline + 重铺闸 + verify:coa

**Files:**
- Modify: `prisma/seed.business.ts`（新 `seedCompanyFunding()`，跑在 `seedCapitalInjection` 与 LP 种子之后）
- Modify: `doc-final/demo/baseline.md`（F_OPS AED 新判据 + 新增种子断言节）＋ `doc-final/demo/data.md`（手写区加节；生成区由 reset 重生成）

**Interfaces:**
- Consumes: T1-T5 全部产物；种子既有 `SEED_CAPITAL` 分录/凭证/流水（seed.business.ts:1988-2057——**只有 TB 转账+evidence+accountFlow，无资金单行**，spec §8 的「plan 实测」在此定案：壳单资金单需补建）
- Produces: 两张 SUCCESS 注资单壳（AED 1,000,000 / USDT 100,000，出资方 `FiatX Holdings Ltd (founding shareholder)`）+ 各一张 APPROVED 审批单 + 各一张 SUCCESS 资金单；一张 SUCCESS 付款单（HexTrust，AED 2,500，事由 `HexTrust 2026-08 custody fee`）+ APPROVED 审批单 + SUCCESS 资金单 + 一条 code 87 分录

- [ ] **Step 1: CIN 壳两张**——per SEED_FIRM_CAPITAL 币种：`capitalInjection` 行（status SUCCESS、receivedAt/settledAt=种子时刻、prudentialPurpose=`Initial operating capital under prudential capital plan`）；**APPROVED 审批单**（照乙波一 T9 评审订正先例——种子单据必须配 APPROVED 审批单去死链，approval_cases+approval_steps 直写形态照 LP 种子）；**SUCCESS 资金单一张/币种**（legSeq 1、direction IN、capitalInjectionId 挂、externalRef 复用 `SEED-CAPITAL-<CUR>`、terminal 态照资金单终态枚举现名 grep 定）；**账本零新增**——不再写 TB 转账/evidence/flow（1988-2057 既有行就是这两张单的账，`sourceType='SEED_CAPITAL'` 保持原样不改写，壳单与账的关联靠 externalRef 与 metadata，注释注明）。
- [ ] **Step 2: PAY 历史单**——`vendorPayment` 行（vendor=seed 里 `vendor-hextrust` 行、status SUCCESS、payeeAccountRef=`AE07 0331 2345 6789 0123 456 (HexTrust AED settlement)`）+ APPROVED 审批单 + SUCCESS 资金单（direction OUT）+ **账本一条**：code 87、DR FIRM_OPS/CR FIRM_ASSET、AED ledger、2,500 元（=250000 分）+ tbTransferEvidence + accountFlow 两行 + effectiveDate 上月末（照 LP 历史单三腿的直写形态裁一腿；`deterministicTransferId('SEED_VENDOR_PAYMENT', 'AED', 'VENDOR_PAYMENT', 0)`）。
- [ ] **Step 3: baseline.md 同步**——F_OPS(AED) 判据 `95000000` 分改 **`94750000`** 分（= 950,000 − 2,500 = 947,500.00 AED，波一判据行原文连注释一起改）；F_OPS(USDT)/F_LIQ 两行不动；新增「乙波二种子断言」节：`capital_injections=2(SUCCESS)`/`vendor_payments=1(SUCCESS)`/`approval_cases +3(APPROVED)`/资金单 +3；recon 判据注明 F_OPS(AED) 新增一行 OUT 流水由 recon:demo 重铸回单吃进、仍 MATCHED。data.md 手写区加「公司资金」节。
- [ ] **Step 4: 重铺闸⑧实跑全序**（baseline.md:251 既有口径）——`bash scripts/stack.sh reset self` → `bash scripts/stack.sh up self` → `bash scripts/on-stack.sh self demo:all` → `bash scripts/on-stack.sh self recon:demo:pass`（PASS、casesOpened=0、F_OPS(AED) MATCHED）→ `bash scripts/on-stack.sh self recon:demo:break`（18/18、LP/公司资金流水不干扰）→ `bash scripts/on-stack.sh self verify:coa`（两恒等式+负余额全绿——**注资/期初缺一笔时恒等式照样全过、只有负余额断言红**，它是种子新加分录接错的唯一探针，不能因恒等式绿放行，交付清单尾注读法）。⚠️ demo:all 必须全新库+栈已起（判例在案）。另跑一遍 `scripts/recon-demo.ts` 场景⑩候选钱包检查（spec §4 承诺）：确认「查无果」候选逻辑不会选中本波新增流水所在钱包语义（本波零新钱包、F_OPS 本就在检，预期零改动，红了停下上报）。
- [ ] **Step 5: 输出证据**——命令+退出码+关键行摘录记入任务交接（不倾倒全量输出）。
- [ ] **Step 6: Commit** `feat(乙波二T9): 种子CIN壳两张+PAY历史单+三张APPROVED审批单+baseline新判据——重铺闸⑧/verify:coa全绿`

---

### Task 10: verify:rbac 扩判据 + 词表入库

**Files:**
- Modify: `scripts/verify-rbac.ts`（静态判据 + 行为探针；MAKER 表两行已由 T3/T5 加，此处核对）
- Run: `npm run audit:vocab`（审计词表 312→324 入库——数字以实测为准，偏差回填 spec §7 表）＋ lark 词表目录 TREASURY 域两个新分组 + 重导全量册（照波一惯例）

- [ ] **Step 1: 静态判据**——桶数 77→**80**、组数 85→**88**、三桶四处齐（联合类型/route/桶/职务）断言；**`FUNDING_DASHBOARD_VIEW` 恰金库/CFO/高管/内审四职务**；**`FUNDING_WRITE` 唯金库**；名册两条 GET 的 groups 含 `COMPLIANCE_OFFICE_VIEW`+`FUNDING_WRITE` 两组（OR 粗门判据）。
- [ ] **Step 2: 行为探针**——照既有形态各一正一反：金库 `POST /admin/capital-injections` 201 ｜ 运营同端点 403 ｜ CFO `POST /admin/vendor-payments` 403（只读）｜ 高管 `GET /admin/tb/accounts` 200（dashboard 锚正例）｜ 金库 `GET /admin/outsourcing-vendors` 200（OR 粗门正例）。**探针路径先故意打错核实会红**（自证绿灯判例），再改对。
- [ ] **Step 3: 全量跑**——verify:rbac 全绿；**既有红集与波前基线恒等**（甲判例口径）。
- [ ] **Step 4: Commit** `feat(乙波二T10): verify:rbac三桶判据+五探针+词表324入库`

---

### Task 11: 场景 28/29/30 剧本 + 全弧走查 + 文档收口 + 波三骨架

**Files:**
- Modify: `doc-final/demo/script.md`（场景 28/29/30，暂编，幕次归属注明待战役收官定稿）
- Create: `doc-final/modules/company-funds.md`（新篇：§0 定位/§1 叙事/§2 状态机×2/§3 决策点/§4 演示脚本/§5 技术节点/§6 缺口——照 lp-desk.md 章法；`v7-treasury.md` 与 `lp-desk.md` 各加一句互链「注资/付款/看板见 company-funds.md」）
- Modify: `doc-final/modules/overview.md` §4（桶 77→80、组 85→88，Treasury 行扩写；页首计数连动——**聚合计数≠逐行，全文 grep 数字逐处核**，甲波五判例）
- Modify: `doc-final/CHANGELOG.md` 一行；`doc-final/BACKLOG.md`（如走查发现新账）
- Create: `doc-final/superpowers/specs/2026-09-XX-campaign-b-wave3-skeleton.md`（按日期定名；总纲链接/承接本波节【合并基线/实际交付/偏差/悬挂项】/已定事实【看板数据源与阈值常量位置（NLA 红线接线处）/注资单即穿底补救道具/87 已占用、波三新码 88 起】/待定岔口【NLA 事前算术门做不做=总纲岔口④待业主/新幕编号=总纲岔口⑤收官定】）

- [ ] **Step 1: 场景 28/29 全程实走**（spec §9.1 口径），28 含「确认前后看板 F_OPS 对照帧」、29 含「付款后看板下降帧」；场景 30 实走：四区巡览 + **看板每格与账本三列表同源同值对照一帧**（spec §9.2 走查判据）+ 做一笔客户兑换 → 三收入格前后对照帧（验收口径「利润体现」正戏）。截图入 evidence 目录。
- [ ] **Step 2: 收尾闸**——项目总纲 §7 ⑥（`bash scripts/on-stack.sh self demo:all` 断言终态）；⑦⑧已在 T9，此处复核记录仍绿。
- [ ] **Step 3: 文档四件**（modules 新篇/overview 计数/script 场景/CHANGELOG）+ 波三骨架承接填写。`decisions.md` **本波不动**——收官统一落（总纲 §7 第 5 条）。
- [ ] **Step 4: 收尾自查**——对 `rules/delivery-checklist.md` 逐触发行报「本任务过哪几条」；对 spec §7 数量表逐行报实测值（对不上停下回填订正，不硬报绿）；对 spec 逐条承诺问「代码在哪」（「承诺没代码不产生 diff」判例）。
- [ ] **Step 5: Commit** `docs(乙波二T11): 场景28/29/30+modules/company-funds新篇+overview计数80桶88组+波三骨架承接`

---

## 任务依赖与派发

```
T1 → T2 → T3 → T6
T1 → T4 → T5 → T7
      T3,T5 → T8
      T5 → T9 → T10 → T11
```
- 执行者一律带项目总纲 §0–§5 要点（派发惯例）；每任务先读模板两处（Global Constraints 注明）。
- **评审档位**：T1/T2/T3/T4/T5/T9 评审升档 opus（动钱/动状态机/动种子账），T6/T7/T8/T10/T11 评审执行档；终审 Fable 不降档 + 逐条追 spec 承诺 + 变异测试抽查。
- T3/T5 都动 `approval.constants.ts`/`rbac.catalog.ts`/`verify-rbac.ts`，T8 再动 `rbac.catalog.ts`——顺序执行不并行，避免同文件冲突。
- 收尾对照 `rules/delivery-checklist.md`；本波命中行：审计/新码冻结/新状态/动钱/maker-checker/MAKER 表/权限组四处/admin 端点/前端入口/新字段客户面（**不涉**——全在管理台，client-web 零触碰，T11 自查确认）/金额最小单位/业务键/改 schema/改种子/改前端截图/多波承接/每轮收尾。
