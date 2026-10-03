# 战役丙波三「客户协议」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 客户协议全生命周期——版本登记处（正文写死）、合规官提/高管批的发布链（生效日 ≥ 批准+30 天）、发布即全员通知、生效后未同意拦充值/兑换放行提现、注册同意落库、第九幕剧本。

**Architecture:** 新模块 `src/modules/identity/agreements/`：`AgreementsReadService`（正文登记处 + 懒翻生效 + 同意台账，仅依赖 Prisma/Audit，供能力闸横向读）与 `AgreementPublishWorkflowService`（照 RI 换人先例走 `ApprovalsService` 正门 + decided 事件回接）。能力闸检查加在 `CustomerAccessService` 内部（DEPOSIT/SWAP 显式拒、WITHDRAW 不查），6 个调用文件零改动。客户端：公开取文端点喂注册页与 `/agreement` 阅读页，弹窗/横幅四态走纯函数。

**Tech Stack:** NestJS + Prisma(SQLite) + jest ｜ React + vitest（纯函数）｜ 既有审批/审计/通知/RBAC 基建。

**Spec:** `doc-final/superpowers/specs/2026-10-02-campaign-c-wave3-agreement-spec.md`（§号引用均指它；spec 含 plan 期两处订正：demo:all 零协议动作、补 `AGREEMENT_PUBLISH_REJECTED`）

## Global Constraints

- 通用交付清单见 `doc-final/rules/delivery-checklist.md`，全部适用；CLAUDE.md §2 禁做清单全程有效（不做幂等/去重/重试/兼容层；同意台账 append-only 不写去重；版本"只有一张在途"是提交时业务校验，不是并发锁）。
- 本轮特有：①**动交易能力闸——任务级 review 与终审均不降档**（spec 档位行，CLAUDE.md 附录 A）；②正文只许住 `agreement-versions.constant.ts` 登记处，客户端/管理台一律取接口，禁止第二份正文副本；③拦截报错显式 `AGREEMENT_NOT_ACCEPTED`，**禁用** `NEUTRAL_DENIAL`（spec §4.3，与 tipping-off 无关）；④`$transaction` 回调内禁调横切写服务，发信在事务 resolve 后（丙波一三原则）；⑤30 天校验双锚：提交预检 + 批准复核（spec §0）；⑥demo:all 零协议动作，v2 全程 DRAFT；⑦jest 在仓库根跑且每条 node/npm 命令前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`；⑧执行在独立 worktree + self 栈。
- 任务收尾清单（对照 delivery-checklist 左列逐行扫过的命中项）：**持久状态变化→审计**（T2/T3/T9）｜**新增审计码四属性**（T2，7 码）｜**新状态/新结局→显式迁移表 + SLA 问答**（T3；SLA 答案：审批单吃 ApprovalsService 自带 48h 过期，版本本身无计时——30 天是前置校验不是钟）｜**该走 maker-checker→正门**（T3）｜**新增审批策略→MAKER_GROUP_BY_POLICY 加行**（T3，与策略同任务落）｜**新增权限组→四处**（T9）｜**新增 admin 端点→route() 登记**（T9；合并 main 后 `db:base:sync`+重启，T12 注记）｜**新业务动作前端入口**（T8/T10）｜**改交易三域→问另两域**（spec §4.3 已一次性答：DEPOSIT/SWAP 拦、WITHDRAW 放行是业务语义本体）｜**新字段到客户面→白名单当场裁**（T6，已裁：全是客户自己的协议数据，零合规信息）｜**对外识别业务键**（versionKey 破例已明示 spec §0 岔口 4）｜**新事件→domain-events 登记**（T3）｜**改 schema→迁移**（T1，不写 backfill）｜**改页面/种子→同步 data.md/script.md**（T12）｜**改前端→preview 截图**（T11，永不豁免①）｜**多波一波→承接进波四骨架**（T12）｜**每轮收尾→CHANGELOG+BACKLOG+§9 报告**（T12）。未命中行：动钱（零记账，verify:coa 不触发）｜金额（无）｜退役动作（TERMS_SECTIONS 是正文副本不是动作，无幽灵按钮）。

---

### Task 1: 两表 + 迁移 + reset 登记 + 种子

**Files:**
- Modify: `prisma/schema.prisma`（文件尾追加两 model）
- Create: `prisma/migrations/<timestamp>_wave3_customer_agreements/`（prisma 生成）
- Modify: `scripts/reset-business-data.ts:82`（`'customerNotification',` 行旁加两 delegate）
- Modify: `prisma/seed.business.ts`（新函数 `seedCustomerAgreements`，在客户铺完后调）

**Interfaces:**
- Produces: delegate `prisma.customerAgreementVersion` / `prisma.customerAgreementConsent`（T2+ 依赖）；种子态 v1=EFFECTIVE、v2=DRAFT、13 客户各一行 ACCEPTED v1（T1 执行订正，原 11 系笔误）。

- [ ] **Step 1: schema 追加**（无 FK——versionKey 是业务键，照 `CustomerNotification.relatedOrderNo` 先例）

```prisma
model CustomerAgreementVersion {
  id                String    @id @default(uuid())
  versionKey        String    @unique // 'v1'/'v2'——破例不走单号惯例（spec §0 岔口4：版本非单据）
  status            String    // DRAFT | PENDING_APPROVAL | PUBLISHED | EFFECTIVE | SUPERSEDED
  summary           String    // 一句话变更摘要，通知与弹窗引用；随种子预置，无编辑入口
  effectiveAt       DateTime? // 提交发布时填；⚡快进改写并单独审计
  publishedAt       DateTime? // = 批准时刻
  pendingApprovalNo String?   // 在途审批单（照 RI pendingApprovalNo 先例）
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@map("customer_agreement_versions")
}

model CustomerAgreementConsent {
  id         String   @id @default(uuid())
  customerId String
  customerNo String   // 冗余落列供审计/检索，照通知表先例
  versionKey String
  action     String   // ACCEPTED | DECLINED —— append-only，先拒后同各一行
  actedAt    DateTime @default(now())

  @@index([customerId, versionKey])
  @@map("customer_agreement_consents")
}
```

- [ ] **Step 2: 迁移**：worktree 内 `npx prisma migrate dev --name wave3_customer_agreements` + `npx prisma generate`（主树勿跑）。
- [ ] **Step 3: reset 登记**：`scripts/reset-business-data.ts` 删除清单 `'customerNotification',`（:82）旁加 `'customerAgreementConsent', 'customerAgreementVersion',`。
- [ ] **Step 4: 种子**（`seed.business.ts`，客户 upsert 循环之后调；重跑可重复执行）

```ts
async function seedCustomerAgreements(now: Date) {
  const v1EffectiveAt = new Date(now.getTime() - 365 * 24 * 3600 * 1000); // 早于一切种子客户注册日（客户 createdAt=铺数时刻）
  await prisma.customerAgreementVersion.upsert({
    where: { versionKey: 'v1' },
    update: { status: 'EFFECTIVE', effectiveAt: v1EffectiveAt, publishedAt: v1EffectiveAt, pendingApprovalNo: null },
    create: { versionKey: 'v1', status: 'EFFECTIVE', effectiveAt: v1EffectiveAt, publishedAt: v1EffectiveAt,
      summary: 'Initial customer agreement (terms of service, 7 sections).' },
  });
  await prisma.customerAgreementVersion.upsert({
    where: { versionKey: 'v2' },
    update: { status: 'DRAFT', effectiveAt: null, publishedAt: null, pendingApprovalNo: null },
    create: { versionKey: 'v2', status: 'DRAFT',
      summary: 'Adds complaint-handling commitments: acknowledgement within 7 days, resolution within 28 days (extendable once to 56 days).' },
  });
  const customers = await prisma.customerMain.findMany({ select: { id: true, customerNo: true, createdAt: true } });
  for (const c of customers) {
    await prisma.customerAgreementConsent.deleteMany({ where: { customerId: c.id } });
    await prisma.customerAgreementConsent.create({ data: {
      customerId: c.id, customerNo: c.customerNo, versionKey: 'v1', action: 'ACCEPTED', actedAt: c.createdAt,
    } }); // 同意时间=注册时间（spec §0 岔口5）；种子直接铺终态不写审计，同限制账 fixture 先例
  }
}
```

- [ ] **Step 5: 闸**：tsc① 过。
- [ ] **Step 6: Commit** `feat(丙波三T1): 协议版本/同意两表+迁移+reset登记+种子v1生效v2草稿`

### Task 2: 正文登记处 + 7 审计码 + AgreementsReadService（懒翻生效/同意台账/闸判定）

**Files:**
- Create: `src/modules/identity/agreements/agreement-versions.constant.ts` ｜ `agreements-read.service.ts` ｜ `agreements.module.ts` ｜ Test: `agreements-read.service.spec.ts`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（:37 旁 `AuditEntityTypes` 加 `AGREEMENT_VERSION: 'AGREEMENT_VERSION',`；:146 旁 `AuditBusinessWorkflowTypes` 加 `CUSTOMER_AGREEMENT: 'CUSTOMER_AGREEMENT',`；:521 平面码区加 7 码；:1288 `CAMPAIGN_C_NOTIFICATION_AUDIT_ACTIONS` 册加 7 行四属性——入触达册，三处登记点不新增，骨架承接 4③）
- Modify: `src/app.module.ts`（或 identity 聚合 module——imports 加 `AgreementsModule`，照既有模块挂法）

**Interfaces:**
- Produces（T3/T5/T6/T9 消费）:
  - `AGREEMENT_BODIES: Record<string, AgreementSection[]>`，`AgreementSection = { no: string; title: string; body: string[] }`
  - `AgreementsReadService.getCurrentEffective(): Promise<AgreementVersionView>`（含懒翻）；`getPendingPublished(): Promise<AgreementVersionView | null>`；`getVersionView(versionKey): AgreementVersionView`（`{ versionKey, status, summary, effectiveAt, publishedAt, sections }`）
  - `hasAcceptedCurrent(customerId: string): Promise<boolean>`
  - `recordConsent(c: { customerId; customerNo }, versionKey: string, action: 'ACCEPTED'|'DECLINED', source: 'REGISTER'|'MODAL'|'PAGE'): Promise<void>`
  - `consentStateFor(customerId): Promise<{ acceptedVersionKey: string|null; acceptedAt: Date|null; acceptedCurrent: boolean; acceptedPending: boolean; declinedCurrentAt: Date|null }>`

- [ ] **Step 1: 四属性登记**（7 码全列，correlationMode 照册内 `NOTIFICATION_SENT` 同款 N）

```ts
// 平面码（:521 区，NOTIFICATION_SENT 旁）
AGREEMENT_PUBLISH_SUBMITTED: 'AGREEMENT_PUBLISH_SUBMITTED',
AGREEMENT_PUBLISHED: 'AGREEMENT_PUBLISHED',
AGREEMENT_PUBLISH_REJECTED: 'AGREEMENT_PUBLISH_REJECTED',
AGREEMENT_FASTFORWARDED: 'AGREEMENT_FASTFORWARDED',
AGREEMENT_EFFECTIVE: 'AGREEMENT_EFFECTIVE',
AGREEMENT_ACCEPTED: 'AGREEMENT_ACCEPTED',
AGREEMENT_DECLINED: 'AGREEMENT_DECLINED',
// 册内（:1288 区）四属性行——含义注释各一行（提交/批准发布/驳回或30天复核退回/⚡改生效日/生效翻转含旧版退位/客户同意/客户拒绝）
AGREEMENT_PUBLISH_SUBMITTED: { domain: 'GOVERNANCE', correlationMode: N, requiredFields: ['versionKey', 'effectiveAt'], requiresCausation: false },
AGREEMENT_PUBLISHED:         { domain: 'GOVERNANCE', correlationMode: N, requiredFields: ['versionKey', 'effectiveAt'], requiresCausation: false },
AGREEMENT_PUBLISH_REJECTED:  { domain: 'GOVERNANCE', correlationMode: N, requiredFields: ['versionKey', 'decision'], requiresCausation: false },
AGREEMENT_FASTFORWARDED:     { domain: 'GOVERNANCE', correlationMode: N, requiredFields: ['versionKey', 'effectiveAt'], requiresCausation: false },
AGREEMENT_EFFECTIVE:         { domain: 'GOVERNANCE', correlationMode: N, requiredFields: ['versionKey'], requiresCausation: false },
AGREEMENT_ACCEPTED:          { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['versionKey', 'source'], requiresCausation: false },
AGREEMENT_DECLINED:          { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['versionKey', 'source'], requiresCausation: false },
```

- [ ] **Step 2: 正文登记处**：v1 七节**逐字搬** `client-web/src/pages/CustomerRegister.tsx:46-104` 的 `TERMS_SECTIONS`，仅两处订正（坑 11 基线声明入文件头注释）：第 IV 节 `updated with 14 days' written notice` → `updated with 30 days' written notice`；第 VII 节 `at least 14 days before the change takes effect` → `at least thirty (30) calendar days before the change takes effect`。v2 = v1 深拷贝 + 第 V 节 body 追加一段：

```ts
'Complaints submitted through the in-app complaints channel are acknowledged within seven (7) days and resolved within twenty-eight (28) days, extendable once to fifty-six (56) days for complex cases. You will be notified of the outcome in writing.'
```

- [ ] **Step 3: 失败测试**（行为化 mock 尊重 where，判例在案）

```ts
// agreements-read.service.spec.ts 断言清单：
// ① getCurrentEffective：库里 v1 EFFECTIVE → 返回 v1 视图且 sections=AGREEMENT_BODIES.v1（第 IV/VII 节文本含 '30'、不含 '14 days'）
// ② 懒翻：v1 EFFECTIVE + v2 PUBLISHED(effectiveAt=过去) → getCurrentEffective 返回 v2；事务内 v2→EFFECTIVE、v1→SUPERSEDED；
//    recordSystem 恰一次 action=AGREEMENT_EFFECTIVE、顶层 versionKey='v2'、metadata.supersededVersionKey='v1'
// ③ 懒翻负面：v2 PUBLISHED(effectiveAt=未来) → 不翻、零审计、返回 v1
// ④ hasAcceptedCurrent：ACCEPTED v1 行在 → true；无行 → false；只有 DECLINED 行 → false；先 DECLINED 后 ACCEPTED → true
// ⑤ recordConsent(ACCEPTED,'MODAL') → consent.create 恰一次 + recordByActor(actorType CUSTOMER) action=AGREEMENT_ACCEPTED、
//    顶层 versionKey+source、带显式 requestId；DECLINED 同理记 AGREEMENT_DECLINED
// ⑥ recordConsent 校验：versionKey 不属 {当前生效, 在途 PUBLISHED} → BadRequest；对在途版 DECLINED → BadRequest（spec §5）
// ⑦ consentStateFor：铺 v1 生效 + v2 在途，客户 ACCEPTED v1 + DECLINED v2…各组合返回五键正确
```

- [ ] **Step 4: 跑测 FAIL**：`npx jest src/modules/identity/agreements` 预期模块不存在。
- [ ] **Step 5: 实现**：服务只注入 `PrismaService` + `AuditLogsService`（**不进 ApprovalsService——保持被 CustomersModule 引用时零环**）。懒翻 `tickEffective()` 私有：`findFirst({ where: { status: 'PUBLISHED', effectiveAt: { lte: new Date() } } })` 命中则 `$transaction([旧 EFFECTIVE→SUPERSEDED, 该行→EFFECTIVE])` 后 `recordSystem(AGREEMENT_EFFECTIVE)`（审计在事务 resolve 后，约束④）。`getCurrentEffective`/`getPendingPublished`/`hasAcceptedCurrent` 开头各调 `tickEffective`。consent 审计 `recordByActor(..., { actorType: 'CUSTOMER', actorNo: customerNo, ... })` 照 `customer-auth.service.ts:64` CUSTOMER_CREATED 信封。
- [ ] **Step 6: module**：`AgreementsModule`（imports: AuditLoggingModule；providers/exports: AgreementsReadService）挂进应用模块树。
- [ ] **Step 7: 闸**：该 spec 全绿 + `npx jest src/modules/audit-logging` 全绿（词表 closure 守则吃新码）+ tsc① + `npm run audit:vocab` = **335**。
- [ ] **Step 8: Commit** `feat(丙波三T2): 正文登记处v1订正30天+7审计码(335)+AgreementsReadService懒翻/同意台账`

### Task 3: 发布链——审批策略 + 事件 + handler + workflow（30 天双锚）

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`（:87 区 `ApprovalActionTypes` 加 `AGREEMENT_PUBLISH: 'AGREEMENT_PUBLISH',`；:440 区 `DEFAULT_APPROVAL_POLICIES` 加 `[ApprovalActionTypes.AGREEMENT_PUBLISH]: { steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }], timeoutHours: 48, allowCancel: true },`——合规官提、高管单步批，照 RI_REPLACEMENT 同款档位）
- Modify: `src/common/events/domain-events.constants.ts`（:110 区加 `AGREEMENT_PUBLISH_DECIDED` 条目 + :157 区名字映射，照 `RI_REPLACEMENT_DECIDED` 同款形状）
- Modify: `scripts/verify-rbac.ts:318`（`MAKER_GROUP_BY_POLICY` 加 `AGREEMENT_PUBLISH: 'AGREEMENT_WRITE',`——与策略同任务落，防表外策略漏保护判例）
- Create: `src/modules/identity/agreements/agreement-publish-approval.service.ts`（handler，逐字照 `ri-replacement-approval.service.ts` 类形状：actionType=AGREEMENT_PUBLISH、workflowType=CUSTOMER_AGREEMENT）｜ `agreement-publish-workflow.service.ts` ｜ Test: `agreement-publish-workflow.service.spec.ts`
- Modify: `src/modules/identity/agreements/agreements.module.ts`（imports 加 ApprovalsModule；providers 加 handler+workflow）

**Interfaces:**
- Consumes: `ApprovalsService.createAndSubmit`（签名照 `ri-replacement-workflow.service.ts:51-61`）；T2 审计码与 delegate。
- Produces: `AgreementPublishWorkflowService.submitPublish(versionKey: string, effectiveAtIso: string, actor: ApprovalActorContext): Promise<{ approvalNo: string }>`；`simulateEffective(versionKey: string, actor: ApprovalActorContext): Promise<void>`（T9 控制器消费）。

- [ ] **Step 1: 失败测试**

```ts
// agreement-publish-workflow.service.spec.ts 断言清单（NOTICE_PERIOD_DAYS=30 常量，注释引 VARA MC II.A.7）：
// ① submitPublish：v2 DRAFT + effectiveAt=now+31d → createAndSubmit 恰一次（actionType=AGREEMENT_PUBLISH、
//    entityRef='v2'、objectSnapshot 含 versionKey/effectiveAt）；版本行 update 为 PENDING_APPROVAL+pendingApprovalNo+effectiveAt；
//    recordByActor 恰一次 AGREEMENT_PUBLISH_SUBMITTED（顶层 versionKey+effectiveAt）
// ② 预检拒：effectiveAt=now+29d → BadRequest，零开单零审计（边界：now+30d 整放行）
// ③ 状态拒：v1(EFFECTIVE) 提交 → BadRequest「只有 DRAFT 可提」；已有 PENDING_APPROVAL/PUBLISHED 在途 → BadRequest（一张在途）
// ④ onDecided APPROVED 且复核过（effectiveAt ≥ decidedAt+30d）→ 版本翻 PUBLISHED+publishedAt+清 pending；
//    recordSystem AGREEMENT_PUBLISHED；随后调 notifyAgreementPublished(versionKey, effectiveAt)（次序：先持久物→审计→发信）
// ⑤ onDecided APPROVED 但复核不过（提交后拖延使 effectiveAt < decidedAt+30d）→ 版本退 DRAFT+清 pending+effectiveAt 置 null；
//    recordSystem AGREEMENT_PUBLISH_REJECTED(decision='NOTICE_PERIOD_SHORTFALL')；零发信
// ⑥ onDecided DECLINED/CANCELLED/EXPIRED → 同退 DRAFT + AGREEMENT_PUBLISH_REJECTED(decision=原值)；零发信
// ⑦ 非法跃迁显式拒：对 PUBLISHED 行再 submitPublish → 拒（迁移表语义，铁律④）
```

- [ ] **Step 2: 跑测 FAIL → Step 3: 实现**：workflow 照 `ri-replacement-workflow.service.ts` 骨架——`@OnEvent(DOMAIN_EVENTS.AGREEMENT_PUBLISH_DECIDED.name)`，APPROVED 分支 `fetchApprovedSnapshot` 按 approvalNo 精确查（白 9 判例注释照抄）；状态翻转用 `updateMany({ where: { versionKey, status: 'PENDING_APPROVAL' } })` 断言计数=1（迁移表以出发态为 where 条件，非法跃迁自然 0 行并显式抛错）。发信调用放事务 resolve 后、吞错（约束④；`notifyAgreementPublished` T4 才有——本任务先打 `NotificationsService` 接口占位调用并在 spec mock，T4 实现）。
- [ ] **Step 4: 闸**：该 spec 全绿 + `npx jest src/modules/identity/agreements src/modules/governance/approvals` 全绿 + tsc①（verify-rbac 是 ts 文件，tsc① 覆盖）。
- [ ] **Step 5: Commit** `feat(丙波三T3): AGREEMENT_PUBLISH审批链+30天双锚+驳回退回留痕——正门+MAKER表同落`

### Task 4: 发布通知 fanout（扩 AGREEMENT 类型 + 模板 + 全员发信）

**Files:**
- Modify: `src/core/notifications/notification-templates.constant.ts`（`NotificationTemplateParams` 加 `effectiveDate?: string;`；模板表加 1 键）
- Modify: `src/core/notifications/notifications.service.ts`（新公开方法 `notifyAgreementPublished`）｜ Test: 既有 `notifications.service.spec.ts` 追加
- Modify: `prisma/schema.prisma:1972`（注释 `DEPOSIT | WITHDRAW | SWAP | COMPLAINT` → 追加 `| AGREEMENT`，无列变更不开迁移）

**Interfaces:**
- Consumes: T2 `AuditEntityTypes.AGREEMENT_VERSION`。
- Produces: `notifyAgreementPublished(versionKey: string, effectiveAt: Date): Promise<void>`（T3 workflow 调）；通知行 `relatedOrderType='AGREEMENT'`、`relatedOrderNo=versionKey`（T8 深链消费）。

- [ ] **Step 1: 模板**

```ts
AGREEMENT_PUBLISHED: { title: 'Customer agreement update', body: (p) => `Our customer agreement will be updated on ${p.effectiveDate}. Please review version ${p.orderNo} and accept it before it takes effect.`, simulateEmail: true },
```

- [ ] **Step 2: 失败测试**

```ts
// notifications.service.spec.ts 追加断言清单：
// ① notifyAgreementPublished('v2', date)：customerMain.findMany 后逐客户 customerNotification.create 一行
//    （templateCode=AGREEMENT_PUBLISHED、relatedOrderType='AGREEMENT'、relatedOrderNo='v2'、channels 含 EMAIL_SIMULATED）
//    + 每行 NOTIFICATION_SENT 审计（templateCode/channels 顶层，既有 send 信封不动）+ 每客户 emitSignal 一次
// ② 中途一个客户 create 抛错 → 方法不外抛、其余客户照发（边界吞错粒度=单客户，demo 尽力而为）
// ③ 模板键查无（防御测试禁写 default 分支——键在即可，断言查无时静默零发，照登记处头注释既有约定）
```

- [ ] **Step 3: FAIL → Step 4: 实现**：`findMany({ select: { id: true, customerNo: true } })` 全量客户（协议当事人不分 lifecycle）；循环内 try/catch 调私有 `send({ ownerCustomerNo, templateCode: 'AGREEMENT_PUBLISHED', template, params: { orderNo: versionKey, effectiveDate: effectiveAt.toISOString().slice(0, 10) }, entityType: AuditEntityTypes.AGREEMENT_VERSION, relatedOrderType: 'AGREEMENT', relatedOrderNo: versionKey })` + `emitSignal(c.id, ...)`。T3 workflow 的占位调用接到真方法，联测 ④ 复跑。
- [ ] **Step 5: 闸**：`npx jest src/core/notifications src/modules/identity/agreements` 全绿 + tsc①。
- [ ] **Step 6: Commit** `feat(丙波三T4): AGREEMENT通知类型+发布全员fanout——email模拟留痕`

### Task 5: 能力闸——未同意拦 DEPOSIT/SWAP、放行 WITHDRAW（评审升档点）

**Files:**
- Modify: `src/modules/identity/customers/customer-access.service.ts`（构造器注入 `AgreementsReadService`；`assertCapability` 与 `assertTradingIntake` 头部加协议检查）
- Modify: `src/modules/identity/customers/customers.module.ts:44`（imports 加 AgreementsModule——先 grep 确认 AgreementsModule 的 imports 链不含 CustomersModule，零环；若有环按约束改 forwardRef 并在 commit message 注明）
- Modify: 8 个引用 spec（`customer-access.service.spec.ts` 加新用例；其余 7 个构造处补 stub `{ hasAcceptedCurrent: async () => true } as any`——`customer-deposit-wallet` / `customer-restrictions.client.controller` / `jwt.strategy` / `withdraw-transactions.service` / `inbound-transfer-signals.service` / `deposit-workflow.service` / `swap-customer-view` 各 spec，grep `new CustomerAccessService` 与 TestingModule providers 两种形态都要扫）

**Interfaces:**
- Consumes: T2 `hasAcceptedCurrent`。
- Produces: 未同意客户 DEPOSIT/SWAP 动作 → `ForbiddenException { code: 'AGREEMENT_NOT_ACCEPTED', message: 'Please review and accept the current customer agreement before continuing.' }`（T8 客户端按 code 引导）。

- [ ] **Step 1: 失败测试**（customer-access.service.spec.ts 追加）

```ts
// ① hasAcceptedCurrent=false：assertCapability(id,'DEPOSIT') / ('SWAP') → ForbiddenException 且 code==='AGREEMENT_NOT_ACCEPTED'
//    （显式断言 code ≠ 'CAPABILITY_RESTRICTED'、message ≠ NEUTRAL_DENIAL——禁中性话术封条）
// ② hasAcceptedCurrent=false：assertCapability(id,'WITHDRAW') → 不因协议拒（其余检查照旧）
// ③ hasAcceptedCurrent=false：assertTradingIntake(id,'DEPOSIT') → 同 code 显式拒，不返回 ACCEPT_FREEZE（协议拦截不折叠，spec §4.3）
// ④ hasAcceptedCurrent=true：三能力全部走既有路径，既有全部用例不变绿（stub 默认 true 保证）
// ⑤ 检查次序：lifecycle≠ACTIVE 时先报 LIFECYCLE_NOT_ACTIVE（协议检查在 lifecycle 之后、restriction 之前）
```

- [ ] **Step 2: FAIL → Step 3: 实现**：私有 `assertAgreementAccepted(customerId, capability)`：`capability==='WITHDRAW'` 直接 return；否则 `hasAcceptedCurrent` false 即抛。`assertCapability` 在 lifecycle 检查后插调用；`assertTradingIntake` 在 `intakeDecision` 前插调用（`intakeDecision` 本体零改动——限制账语义不混）。
- [ ] **Step 4: 闸**：`npx jest src/modules/identity/customers src/modules/trading src/modules/asset-treasury/wallets` 全绿（8 个引用 spec 全复跑）+ tsc①。
- [ ] **Step 5: Commit** `feat(丙波三T5): 能力闸协议检查——DEPOSIT/SWAP显式拦AGREEMENT_NOT_ACCEPTED,WITHDRAW放行`

### Task 6: 客户端 API 三端点 + 注册同意落库

**Files:**
- Create: `src/modules/identity/agreements/agreements.client.controller.ts` ｜ Test: `agreements.client.controller.spec.ts`
- Modify: `src/modules/identity/agreements/agreements.module.ts`（controllers 登记）
- Modify: `src/modules/identity/auth/customer-auth.service.ts`（register 落 consent）+ `auth` 模块 imports 加 AgreementsModule
- Modify: 既有 `customer-auth` 相关 spec（构造处补 AgreementsReadService stub）

**Interfaces:**
- Consumes: T2 读/写方法。
- Produces（T7/T8 消费，客户端点照波一先例不进 rbac catalog）:
  - `GET /client/agreements/current`（**公开**，照 auth 注册端点不挂 JWT guard 先例）→ `{ versionKey, effectiveAt, summary, sections }`
  - `GET /client/agreements/me`（JWT，guard 与 customer 提取照 `notifications.client.controller.ts` 先例）→ `{ current, pending: {...}|null, consent: consentStateFor 五键 }`
  - `POST /client/agreements/:versionKey/consent` body `{ action: 'ACCEPTED'|'DECLINED' }` → 204；校验透传 T2 ⑥

- [ ] **Step 1: 失败测试**（controller spec：三端点响应形状 Object.keys 全等断言——白名单封条；consent 对在途版 DECLINED → 400 透传）
- [ ] **Step 2: FAIL → Step 3: 实现**（薄壳：全部转调 AgreementsReadService；`me` 的 current/pending 各带 sections——阅读页两版对照一次取齐）。
- [ ] **Step 4: 注册落库**：`customer-auth.service.ts` register 在 CUSTOMER_CREATED 审计后追加：`const cur = await this.agreementsRead.getCurrentEffective(); await this.agreementsRead.recordConsent({ customerId: customer.id, customerNo: customer.customerNo }, cur.versionKey, 'ACCEPTED', 'REGISTER');`（spec 已定事实 8；注册时有在途 v2 不特殊处理，登录后 T8 正常弹）。追加测试：register → consent.create 一行 versionKey=当时生效版 + AGREEMENT_ACCEPTED(source=REGISTER) 审计。
- [ ] **Step 5: 闸**：`npx jest src/modules/identity` 全绿 + tsc①。
- [ ] **Step 6: Commit** `feat(丙波三T6): 客户端协议三端点+注册同意落库source=REGISTER`

### Task 7: 客户端——正文组件抽取 + 注册页取接口 + `/agreement` 阅读页 + 打印

**Files:**
- Create: `client-web/src/components/AgreementSections.tsx`（分节渲染组件，markup 逐字搬 `CustomerRegister.tsx:253-278` 的 section 循环）
- Modify: `client-web/src/pages/CustomerRegister.tsx`（删 :46-104 `TERMS_SECTIONS`；TermsDrawer 打开时 fetch `/client/agreements/current` 入 state，渲染换 `<AgreementSections sections={...} />`；滚动到底闸与交互零变化）
- Create: `client-web/src/pages/AgreementPage.tsx` ｜ Modify: `client-web/src/App.tsx:65`（`/messages` 路由旁加 `<Route path="/agreement" element={<AuthGuard><AgreementPage /></AuthGuard>} />`）
- Modify: `client-web/src/index.css`（尾部加 `.print-agreement` 打印样式，**逐字沿用**波二 `@media print` 判例版式：`position: fixed` + `html { color-scheme: light }` + `html, body` 翻白——骨架承接 3，证据 `checkups/2026-10-02-campaign-c-wave2-evidence/03*`）

**Interfaces:**
- Consumes: T6 `current`/`me` 端点。
- Produces: `/agreement` 页（T8 深链/横幅落点）；`AgreementSections` 组件。

- [ ] **Step 1: 组件抽取 + 注册页改造**（闸：注册页抽屉渲染与改造前像素级同构——走查时对照截图；`grep -rn "About FIATX" client-web/src` 仅登记处取数路径命中，client-web 零正文硬编码——改一处找齐同款，spec §1.1）。
- [ ] **Step 2: 阅读页**：取 `me`；版本状态头三态（已同意 vX 于某时 / 新版将于某日生效 / 待表态+同意按钮）；v-current/v-pending 切换钮两版对照（pending 为 null 时隐藏）；同意按钮调 consent 端点后刷新；容器挂 `print-agreement` 类 + `window.print` 按钮。
- [ ] **Step 3: 闸**：tsc③ + `npm run test:client` 全绿。
- [ ] **Step 4: Commit** `feat(丙波三T7): 正文单一来源取接口+/agreement阅读页两版对照+打印`

### Task 8: 客户端——弹窗/横幅四态 + 深链 + 拦截引导

**Files:**
- Create: `client-web/src/utils/agreementGate.ts` ｜ Test: `agreementGate.spec.ts`
- Create: `client-web/src/components/AgreementGate.tsx`（弹窗+横幅一体组件）
- Modify: `client-web/src/components/CustomerDashboardLayout.tsx`（挂载：登录壳层 mount 时 fetch `me`，表态/关闭用 React state，"稍后再说"不落库不进 storage——本次挂载内不再弹）
- Modify: `client-web/src/pages/Messages.tsx:73` 区 `ORDER_ROUTES`（加 `AGREEMENT: () => '/agreement',`）
- Modify: `client-web/src/pages/Deposit.tsx` / `Swap.tsx`（提交错误处理：`code==='AGREEMENT_NOT_ACCEPTED'` 时错误条内附 `Link to="/agreement"`「Review & accept」；其余错误显示不变）

**Interfaces:**
- Consumes: T6 `me`、T5 错误 code。
- Produces: `agreementGateState(me): 'NONE' | 'PENDING_DISMISSIBLE' | 'EFFECTIVE_BLOCKING' | 'DECLINED_BANNER'`。

- [ ] **Step 1: 失败测试**（vitest 四态表驱动）

```ts
// ① acceptedCurrent=true, pending=null → NONE
// ② acceptedCurrent=true, pending 在、acceptedPending=false → PENDING_DISMISSIBLE
// ③ acceptedCurrent=true, pending 在、acceptedPending=true → NONE（提前同意静默）
// ④ acceptedCurrent=false, declinedCurrentAt=null → EFFECTIVE_BLOCKING（强制弹窗，不可关）
// ⑤ acceptedCurrent=false, declinedCurrentAt 非空 → DECLINED_BANNER（横幅常驻）
```

- [ ] **Step 2: FAIL → Step 3: 实现**：纯函数 + 组件。强制弹窗无关闭钮、无遮罩点击关闭，两钮「Accept」/「Not now」（Not now→落 DECLINED→收弹窗、横幅起）；可关弹窗三钮「Accept」「View full terms」(→`/agreement`)「Remind me later」。横幅文案与「查看并同意」链进组件（固定文案，照登记处纪律集中在组件头常量）。
- [ ] **Step 4: 闸**：vitest 全绿 + tsc③。
- [ ] **Step 5: Commit** `feat(丙波三T8): 协议弹窗/横幅四态+AGREEMENT深链+拦截错误引导`

### Task 9: 管理台后端——admin 四端点 + RBAC 四处 + ⚡快进 + 客户详情行

**Files:**
- Create: `src/modules/identity/agreements/agreements.admin.controller.ts` ｜ Test: `agreements.admin.controller.spec.ts`
- Modify: `src/modules/identity/agreements/agreement-publish-workflow.service.ts`（加 `simulateEffective`）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（四处：:106 区联合类型加 `| 'AGREEMENT_WRITE'`；:614 区路由四条；:1196 旁 compliance-office 域加桶；:1345 `COMPLIANCE_OFFICER` 绑定数组加 `'AGREEMENT_WRITE'`）
- Modify: `src/modules/identity/customers/customers.controller.ts`（admin 客户详情响应加 `agreement` 子对象——`consentStateFor` 五键直通）+ 对应 service/spec

**Interfaces:**
- Consumes: T2/T3 服务。
- Produces（T10 消费）: `GET /admin/customer-agreements`（列表：versionKey/status/summary/effectiveAt/publishedAt/pendingApprovalNo）｜ `GET /admin/customer-agreements/:versionKey`（+sections）｜ `POST /admin/customer-agreements/:versionKey/submit-publish` body `{ effectiveAt }` ｜ `POST /admin/customer-agreements/:versionKey/simulate-effective`；客户详情新键 `agreement`。

- [ ] **Step 1: RBAC 四处登记**（新组四件套齐：联合类型/route()/桶/职务持有——缺一演示点不到判例）

```ts
route('GET', '/admin/customer-agreements', 'List customer agreement versions', ['COMPLIANCE_OFFICE_VIEW']),
route('GET', '/admin/customer-agreements/:versionKey', 'Customer agreement version detail (read-only body)', ['COMPLIANCE_OFFICE_VIEW']),
route('POST', '/admin/customer-agreements/:versionKey/submit-publish', 'Submit an agreement version for publication (senior management approves; effective date >= +30d)', ['AGREEMENT_WRITE']),
route('POST', '/admin/customer-agreements/:versionKey/simulate-effective', 'Fast-forward an announced agreement version to effective (demo only)', ['DEMO_CLOCK_WRITE']),
// 桶（compliance-office 域 :1196 旁）：
{ key: 'compliance-office.agreements', label: 'Manage customer agreements', description: 'Submit agreement versions for publication (senior management approves); body is code-registered and read-only', groups: ['AGREEMENT_WRITE'] },
```

- [ ] **Step 2: simulateEffective 实现 + 失败测试**：仅 PUBLISHED 可快进（updateMany where status='PUBLISHED' 计数=1，否则显式拒）；`effectiveAt` 改写为 now → 记 `AGREEMENT_FASTFORWARDED`（recordByActor，顶层 versionKey+effectiveAt）→ 调 `tickEffective` 立即翻转（顺带产 AGREEMENT_EFFECTIVE，actor=system——⚡是模拟器动作、生效是业务事实分记，spec §3）。controller spec：四端点转调 + 响应形状 + submit-publish 透传 400。
- [ ] **Step 3: 客户详情行**：admin 详情响应加 `agreement: await agreementsRead.consentStateFor(customer.id)`；spec 断言键形状。
- [ ] **Step 4: 闸**：`npx jest src/modules/identity` 全绿 + tsc①。
- [ ] **Step 5: Commit** `feat(丙波三T9): admin四端点+RBAC四处(82桶90组)+⚡快进分记两码+客户详情协议行`

### Task 10: 管理台前端——Customer Agreements 页 + 导航 + 客户详情行

**Files:**
- Create: `admin-web/src/pages/CustomerAgreementsPage.tsx`
- Modify: `admin-web/src/App.tsx:315` 旁（compliance-office 路由区加 `<Route path="governance/compliance-office/agreements" element={withPermission(<CustomerAgreementsPage />, [PERMISSIONS.COMPLIANCE_OFFICE_VIEW])} />`，lazy import 照 :81 同款）
- Modify: `admin-web/src/components/DashboardLayout.tsx:467` 区（Compliance Office 导航组加「Customer Agreements」项）
- Modify: `admin-web/src/pages/CustomerDetail.tsx`（档案区加一行 Agreement：`已同意 vX（时刻）`，`acceptedCurrent=false` 时旁标 `pending response` / `declined`——读 T9 新键）
- Modify: `admin-web/src/utils/`（若 PERMISSIONS 常量表需加 `AGREEMENT_WRITE`/沿用——照 `COMPLIANCE_OFFICE_VIEW` 现有登记方式补齐）

**Interfaces:**
- Consumes: T9 四端点与 `agreement` 键；`useSimulationMode`（照 `ComplianceObligationListPage.tsx:13,217` 用法）。

- [ ] **Step 1: 页面**：版本卡列表（versionKey/status 徽章/summary/生效日/发布时刻）+ 选中版详情（正文只读分节渲染 + pendingApprovalNo 链到审批单）；DRAFT 版「Submit for publication」钮（`AGREEMENT_WRITE` 持有才显，照 obligations 页写钮门控先例）弹窗填生效日、前端提示 ≥ 今天+30（真校验在后端）；PUBLISHED 版 ⚡「Fast-forward to effective」钮（`DEMO_CLOCK_WRITE` && `simEnabled` 双门，照投诉拨钟先例——合规官看得见页面点不动 ⚡，RBAC 交叉是产物非缺陷，spec §3）。
- [ ] **Step 2: 导航 + 客户详情行**。
- [ ] **Step 3: 闸**：tsc② + `cd admin-web && npx tsc -b --noEmit`。
- [ ] **Step 4: Commit** `feat(丙波三T10): 管理台Customer Agreements页+⚡双门+客户详情Agreement行`

### Task 11: 走查——self 栈第九幕全线手驱 + 截图 ≥10

**Files:**
- Create: `doc-final/superpowers/checkups/2026-10-02-campaign-c-wave3-evidence/`（截图落盘）

- [ ] **Step 1: 起栈喂数**：worktree 内 `bash scripts/stack.sh reset self`（含 base sync，admin 端点权限字典就位）→ `bash scripts/stack.sh up` → `bash scripts/on-stack.sh self demo:all` 全 PASS（协议零动作前提下既有断言不受影响——本步同时就是 spec §7 判据的实证）。
- [ ] **Step 2: 第九幕手驱**（照 spec §7 幕流；演员=种子表中干净/有余额/非主角客户，开演前先核三条件，口径记进 script.md T12）：合规官登录提交发布 v2（生效日=今天+31）→ 高管批准 → 客户端铃铛/消息/email 徽章 → 演员登录见可关弹窗（点 Remind me later）→ 超管 ⚡快进 → 演员再登录强制弹窗 → Not now → 充值模拟到账提交显式报错+横幅+Swap 同拦 → 提现页照常可进 → 管理台客户详情 declined 行 → 审计中心按客户号搜 AGREEMENT_DECLINED → `/agreement` 两版对照（指第 V 节新段）→ Accept → 再提交兑换成功。
- [ ] **Step 3: 截图清单**（≥10，缺一不算过）：`01-admin-submit.png`（提交弹窗含生效日）/ `02-approval-approve.png` / `03-client-bell-message.png`（含 EMAIL_SIMULATED 徽章）/ `04-dismissible-modal.png` / `05-fastforward.png`（⚡钮+Simulation 开）/ `06-blocking-modal.png` / `07-declined-blocked.png`（充值报错引导+横幅同屏）/ `07b-withdraw-open.png`（提现页可进）/ `08-admin-detail-audit.png`（客户详情 declined 行或审计 DECLINED 行，可两张）/ `09-agreement-compare.png`（两版对照指第 V 节）/ `10-print-preview.png`（**真实打印预览**，背景图形开/关两态各看、浅色可读——骨架承接 3 判例）。另：注册页抽屉改造后对照截图入档（T7 Step 1 的同构验证）。
- [ ] **Step 4: Commit** `feat(丙波三T11): 第九幕全线走查证据入档`

### Task 12: 收尾——重铺闸 + 文档剧本 + 波四骨架 + 承接

**Files:**
- Modify: `doc-final/modules/v2-customer-compliance.md`（客户协议一节：两表/状态机/发布链/能力闸/30 天依据）+ `doc-final/modules/overview.md`（§4 82 桶 90 组；§5 审计 335、通知类型 5 值、agreements 模块行）
- Modify: `doc-final/demo/script.md`（第九幕整幕+演员点名）+ `doc-final/demo/baseline.md`（版本 2 行/consents 13 行/v2 DRAFT 断言；data.md 生成区由 demo:all 自写不手改）
- Modify: `doc-final/decisions.md`（+2：费率与协议零联动；30 天锚定批准时刻）＋ `doc-final/BACKLOG.md`（+1：同意率计数/名单缓做）＋ `doc-final/PRODUCTION-NOTES.md`（+1 行：正文整版哈希留存/真定时器生效/未读催告）＋ `doc-final/CHANGELOG.md` 一行
- Create: `doc-final/superpowers/specs/2026-10-02-campaign-c-wave4-statements-dsr-skeleton.md`（波四骨架：总纲链接/空「承接上一波」节/总纲 §3 波四已定事实搬运）——随后把本波承接记录（实际偏差/新事实/前提变化）写进该骨架
- Modify: 总纲 `2026-09-30-campaign-c-outreach-disclosure-charter.md`（状态行与 §3 波三行更新）

**收尾闸（判据全绿才算完）：**
- [ ] **Step 1: 随手闸**：tsc×3 全 0 ｜ `npx jest src/modules/identity src/modules/trading src/core/notifications src/modules/governance/approvals src/modules/audit-logging` 全绿 ｜ `npm run test:client` 全绿 ｜ `npm run audit:vocab` = 335。
- [ ] **Step 2: 重铺闸⑧**（动 schema+seed 必触发；手驱过审计表，先清库防孤行——TOOLING-DEBT:89）：`rm` self 栈 dev.db → `bash scripts/stack.sh reset self` → `bash scripts/on-stack.sh self demo:all` 全 PASS 零 diff，判据对照 baseline.md（含协议种子态三断言）。`verify:rbac` 全绿（S1/S2 吃新组新桶，MAKER 表吃新策略）。不动钱 → `verify:coa` 不触发。
- [ ] **Step 3: 文档全件 + 波四骨架 + 承接**（上列 Files；§9 报告行按实动层报）。合并 main 后必做注记：重启后端 + `npm run db:base:sync`（新 admin 端点权限字典，否则 403）。
- [ ] **Step 4: Commit** `docs(丙波三T12): 文档剧本收口+重铺闸全绿+波四骨架与承接`

---

## Self-Review 记录（写完即查）

- **Spec 覆盖**：§1.1→T2（登记处+退役硬编码 T7）；§1.2/1.3→T1；§1.4→T3（状态机+驳回边）/T2（懒翻）/T9（⚡翻转）；§2→T3（审批链）/T9（RBAC+页面端点）/T10（UI）；§3→T9/T10（⚡双门）；§4.1→T4；§4.2→T8；§4.3→T5；§4.4→T7；§5→T6；§6→T2（7 码）；§7→T11（第九幕）+T12（demo:all 零动作实证+baseline）；§8→各任务闸+T12；§9→T12；§10 数量表=T1 两表/T2 335/T9 82 桶 90 组+策略/T4 模板/T7/T8/T10 前端件；§11→T11+T12。无缺口。
- **占位扫描**：无 TBD；测试以断言清单给出（mock 形状依赖执行时真实行结构，逐条可判红绿，照波二 plan 同式）；T10 PERMISSIONS 常量表写明「照 COMPLIANCE_OFFICE_VIEW 现有登记方式」非占位——登记方式唯一。
- **类型一致**：`hasAcceptedCurrent(customerId)` T2 定义=T5 stub=T5 调用；`recordConsent(c, versionKey, action, source)` T2 定义=T6 两调用点（MODAL/PAGE 走 controller、REGISTER 走 auth）；`submitPublish(versionKey, effectiveAtIso, actor)`/`simulateEffective` T3/T9 一致；`agreementGateState(me)` 输入=T6 `me.consent` 五键；`notifyAgreementPublished(versionKey, effectiveAt)` T3 占位=T4 实现。
- **依赖环检查已前置**：T5 Step 前置 grep 零环断言；AgreementsReadService 不进 ApprovalsService（T2 Step 5 约束）正是为此。
