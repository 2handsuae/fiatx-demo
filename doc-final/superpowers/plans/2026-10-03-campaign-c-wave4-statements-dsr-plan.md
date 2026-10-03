# 战役丙波四「月结单与资料请求」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 月度对账单（快照出具 + 客户端翻月 + 发出凭证）与 DSR 资料请求工单（查/改/删，DPO 独办，30 天钟上闹钟墙），连同 phone 自助改与改档案 admin 通道。

**Architecture:** 两新表（`customer_monthly_statements` 只写一次快照 / `data_subject_requests` 三态工单）；月结单由 30 秒 sweep 追赶式自动出具（周期义务样板），生成器复用 `CustomerStatementService` 读模型；DSR 的"改"经既有材料请求链重核验、合规官经新 PATCH 通道落档（填 `CUSTOMER_WRITE` 孤儿桶）。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle 证据表读模型；React admin-web / client-web。

**Spec:** `doc-final/superpowers/specs/2026-10-03-campaign-c-wave4-statements-dsr-spec.md`（§0 十五条裁定直接引用，不再论证）

## Global Constraints

- 通用交付清单见 `doc-final/rules/delivery-checklist.md`，全部适用；每个任务末尾列「本任务过哪几条」，执行者不得自判豁免。
- 本轮特有：①子代理跑 `verify:rbac` 一律显式 `API_BASE=http://localhost:<.stackports 端口>`（只跑静态段用 `API_BASE=http://127.0.0.1:1`）——骨架承接 6 的铁规；②jest 范围内 `invite-expiry.service.spec.ts` 红属既有债（监听器 52 超限），带证据交代、不得称全绿，e2e 不得援引为绿；③月份/日期一律经 `business-date.util.ts` 出口（裁定 14），禁再添取日方式；④禁"扫源码文本"型断言；⑤月结单/摘要内容受 tipping-off 白名单约束（decisions:122/65），新增客户面字段当场过白名单判断；⑥种子直插表仅限 `prisma/seed.business.ts` 层（LP 先例），业务代码禁直插；⑦派发子代理时 prompt 必须带 CLAUDE.md §0–§5 要点；⑧审批策略零新增（监听器维持 52）。
- 金额一律最小单位整数存、字符串传、展示层换算。
- 对外识别一律业务键：`statementNo` / `requestNo`（DSR-前缀，`generateReferenceNo('DSR')`，`src/common/utils/no-generator.util.ts:3`）。

---

### Task 1: 地基——两新表迁移 + reset 登记 + 业务月函数

**Files:**
- Modify: `prisma/schema.prisma`（文末两 model）
- Create: `prisma/migrations/20261003_wave4_statements_dsr/migration.sql`（`npx prisma migrate dev --name wave4_statements_dsr` 生成）
- Modify: `scripts/reset-business-data.ts:85` 附近（customerNotification 行之后）
- Modify: `src/modules/accounting/tigerbeetle/utils/business-date.util.ts`
- Test: `src/modules/accounting/tigerbeetle/utils/business-date.util.spec.ts`

**Interfaces:**
- Produces: `businessMonthOf(at: Date): string`（'YYYY-MM'）；`startOfBusinessMonth(month: string): Date`；`endOfBusinessMonth(month: string): Date`；Prisma model `CustomerMonthlyStatement` / `DataSubjectRequest`。

**本任务过清单行**：改 schema（迁移+空库能建）；（reset 登记是甲波二判例的"加表必配"）。

- [ ] **Step 1: 写业务月函数失败测试**（追加到 business-date.util.spec.ts）

```ts
describe('business month helpers', () => {
  it('businessMonthOf: 迪拜 10-01 00:30 (UTC 09-30 20:30) 归 10 月', () => {
    expect(businessMonthOf(new Date('2026-09-30T20:30:00.000Z'))).toBe('2026-10');
  });
  it('businessMonthOf: UTC 09-30 19:59 仍归 9 月', () => {
    expect(businessMonthOf(new Date('2026-09-30T19:59:59.999Z'))).toBe('2026-09');
  });
  it('start/end 闭环：9 月窗口首尾互证', () => {
    expect(startOfBusinessMonth('2026-09').toISOString()).toBe('2026-08-31T20:00:00.000Z');
    expect(endOfBusinessMonth('2026-09').toISOString()).toBe('2026-09-30T19:59:59.999Z');
    expect(businessMonthOf(startOfBusinessMonth('2026-09'))).toBe('2026-09');
    expect(businessMonthOf(endOfBusinessMonth('2026-09'))).toBe('2026-09');
  });
  it('endOfBusinessMonth 处理 2 月与 12 月卷年', () => {
    expect(endOfBusinessMonth('2026-02').toISOString()).toBe('2026-02-28T19:59:59.999Z');
    expect(endOfBusinessMonth('2026-12').toISOString()).toBe('2026-12-31T19:59:59.999Z');
  });
});
```

- [ ] **Step 2: 跑测确认红** `npx jest src/modules/accounting/tigerbeetle/utils --runTestsByPath src/modules/accounting/tigerbeetle/utils/business-date.util.spec.ts`，预期 FAIL（函数未定义）。
- [ ] **Step 3: 实现三函数**（追加到 business-date.util.ts，守头注释"唯一出口"）

```ts
/** 迪拜业务月（YYYY-MM）。月边界 = 迪拜午夜，与 toBusinessDate 同口径。 */
export function businessMonthOf(at: Date): string {
  return toBusinessDate(at).slice(0, 7);
}
export function startOfBusinessMonth(month: string): Date {
  return startOfBusinessDate(`${month}-01`);
}
export function endOfBusinessMonth(month: string): Date {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // m 为 1 基，Date.UTC(y,m,0)=该月末日
  return endOfBusinessDate(`${month}-${String(lastDay).padStart(2, '0')}`);
}
```

- [ ] **Step 4: 跑测确认绿**（同 Step 2 命令，PASS）。
- [ ] **Step 5: 加两 model**（schema.prisma 文末，紧随 CustomerAgreementConsent 之后）

```prisma
model CustomerMonthlyStatement {
  id          String   @id @default(uuid())
  statementNo String   @unique            // STM-<customerNo>-<YYYYMM>，业务键
  customerId  String
  periodMonth String                      // 迪拜业务月 YYYY-MM
  issuedAt    DateTime @default(now())
  payload     String                      // JSON：逐币种分节快照，只写一次
  @@unique([customerId, periodMonth])     // 一单一张（单据三性）
  @@map("customer_monthly_statements")
}

model DataSubjectRequest {
  id                String    @id @default(uuid())
  requestNo         String    @unique     // DSR-YYMMDD-xxxxxx
  customerId        String
  type              String                // ACCESS | RECTIFICATION | ERASURE
  detail            String                // 客户自述
  status            String    @default("SUBMITTED") // SUBMITTED | IN_REVIEW | RESOLVED
  submittedAt       DateTime  @default(now())
  reviewStartedAt   DateTime?
  resolvedAt        DateTime?
  dueAt             DateTime              // submittedAt + 30 自然日，提交时一次算定
  resolutionCode    String?               // 四值，见 dsr.constants.ts
  resolutionNote    String?               // DPO 答复正文（客户可见）
  clauseRef         String?               // JSON {versionKey, section}，仅 ERASURE_REFUSED_RETENTION
  summary           String?               // JSON 资料摘要快照，仅 ACCESS，只写一次
  materialRequestNo String?               // 仅 RECTIFICATION_REVERIFY
  @@index([status])
  @@map("data_subject_requests")
}
```

- [ ] **Step 6: 生成迁移并验证空库可建** `npx prisma migrate dev --name wave4_statements_dsr`，随后 `npx prisma generate`。
- [ ] **Step 7: reset 登记**（reset-business-data.ts，customerNotification 行后加）

```ts
  // 波四两表（战役丙波四 T1 加表；互无 FK，删除顺序不敏感）
  'dataSubjectRequest',
  'customerMonthlyStatement',
```

- [ ] **Step 8: 随手闸** `npx tsc --noEmit -p tsconfig.json` + Step 2 的 jest，全绿。
- [ ] **Step 9: Commit** `git add -A && git commit -m "feat(丙波四T1): 月结单/DSR两新表迁移+reset登记+迪拜业务月函数"`

---

### Task 2: 通知管子扩展（模板 17→19，relatedOrderType 5→7）

**Files:**
- Modify: `src/core/notifications/notification-templates.constant.ts`（`:7-12` params、`:42` 后两条目）
- Modify: `src/core/notifications/notifications.service.ts`（`:177` 后两方法）
- Modify: `src/core/notifications/notifications.service.spec.ts`（`:150-151` 计数、补两用例）
- Modify: `client-web/src/pages/Messages.tsx:25-32`（ORDER_ROUTES 两行）
- Modify: `prisma/schema.prisma:1972`（注释 5 值→7 值，String 列免迁移）

**Interfaces:**
- Produces: `notifyStatementIssued(input: { customerId: string; statementNo: string; periodMonth: string }): Promise<void>`；`notifyDsrResolved(input: { customerId: string; requestNo: string }): Promise<void>`——均吞错不抛（照 `notifyAgreementPublished :151-177` 形态，内部 try/catch 单客户粒度）。
- Consumes: 无（独立于 T1）。

**本任务过清单行**：新字段到客户面（模板话术过执法词黑名单，spec `:125-131` 自动扫）。

- [ ] **Step 1: 失败测试**（notifications.service.spec.ts：模板计数 17→19 改断言；新增两用例）

```ts
it('notifyStatementIssued 落库 STATEMENT 类通知并写 NOTIFICATION_SENT 审计', async () => {
  await service.notifyStatementIssued({ customerId: 'cust-1', statementNo: 'STM-CU1-202609', periodMonth: '2026-09' });
  const row = prisma.customerNotification.create.mock.calls[0][0].data;
  expect(row.relatedOrderType).toBe('STATEMENT');
  expect(row.relatedOrderNo).toBe('STM-CU1-202609');
  expect(JSON.parse(row.channels)).toContain('EMAIL_SIMULATED');
});
it('notifyDsrResolved 落库 DSR 类通知', async () => {
  await service.notifyDsrResolved({ customerId: 'cust-1', requestNo: 'DSR-261003-000001' });
  const row = prisma.customerNotification.create.mock.calls[0][0].data;
  expect(row.relatedOrderType).toBe('DSR');
});
```

（mock 形态照该 spec 文件既有 prisma mock；断言落在落库行为上，非文本扫描。）

- [ ] **Step 2: 跑测确认红** `npx jest src/core/notifications`。
- [ ] **Step 3: 实现**——params 接口加 `periodMonth?: string`；模板两条：

```ts
  STATEMENT_ISSUED: { title: 'Your monthly statement is ready', body: (p) => `Your account statement for ${p.periodMonth} has been issued and is available in Transaction history. Reference ${p.orderNo}.`, simulateEmail: true },
  DSR_RESOLVED: { title: 'Your data request has been resolved', body: (p) => `Your personal data request ${p.orderNo} has been resolved. Open the request to view the outcome.`, simulateEmail: true },
```

两方法（照 `:151-177` 协议样板，`relatedOrderType` 分别写 `'STATEMENT'` / `'DSR'`，审计主体类型暂复用 `send()` 既有参数位，T3/T5 注册的 `AuditEntityTypes` 新值在此引用——若 T2 先行，主体类型字符串常量先写死 `'MONTHLY_STATEMENT'`/`'DSR_REQUEST'`，T3/T5 注册时保持同名）。

- [ ] **Step 4: 跑测确认绿**；执法词黑名单断言自动覆盖新模板（若红即话术违红线，改话术不改断言）。
- [ ] **Step 5: Messages.tsx ORDER_ROUTES 加两行**

```ts
  STATEMENT: (no) => `/transactions?statement=${encodeURIComponent(no)}`,
  DSR: () => '/data-requests',
```

- [ ] **Step 6: 随手闸** 闸① + `cd client-web && npx tsc -b --noEmit`；jest `src/core/notifications` 全绿。
- [ ] **Step 7: Commit** `git commit -m "feat(丙波四T2): 通知模板19条+relatedOrderType七值+两发信方法"`

---

### Task 3: 月结单生成器 + 出具 sweep + 审计码 STATEMENT_ISSUED

**Files:**
- Create: `src/modules/asset-treasury/treasury/monthly-statement.service.ts`
- Create: `src/modules/asset-treasury/treasury/monthly-statement-sweep.service.ts`
- Test: `src/modules/asset-treasury/treasury/monthly-statement.service.spec.ts`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（平面表 + `CAMPAIGN_C_NOTIFICATION_AUDIT_ACTIONS:1300` 册 + `AuditEntityTypes` 加 `MONTHLY_STATEMENT`）
- Modify: asset-treasury 模块声明（providers 注册两服务；imports 加 `NotificationsModule`）

**Interfaces:**
- Consumes: T1 三个业务月函数；T2 `notifyStatementIssued`；既有 `TbAccountRegistryService.findByOwner(ownerUuid)`（`tb-account-registry.service.ts:78-82`）、`TbEvidenceService.getAccountStatement(tbAccountId)`（`tb-evidence.service.ts:396`）、`CustomerStatementService.buildStatement(legs, opts)`（`customer-statement.service.ts:243`）。
- Produces: `MonthlyStatementService.listMissingMonths(c: { id: string; onboardingApprovedAt: Date }, now: Date): Promise<string[]>`（升序、查库剔除已出具月）；`issue(c: { id: string; customerNo: string }, periodMonth: string): Promise<string>`（返回 statementNo；已存在则抛——sweep 以 listMissingMonths 为准不撞）；payload 结构 `{ sections: Array<{ assetCode: string; isFiat: boolean; openingBalance: string; closingBalance: string; rows: StatementRow[] }> }`。

**本任务过清单行**：持久状态变化写审计（recordSystem+显式 requestId=statementNo）；新增审计码四属性+`assertActionSpec`；涉及金额最小单位；对外识别业务键。

- [ ] **Step 1: 失败测试**（prisma/TB 依赖全 mock，mock 必须尊重 where——波一判例）

```ts
describe('MonthlyStatementService', () => {
  it('issue: 期初=窗口前最后腿 runningBalance、期末=窗口内最后腿', async () => {
    // 夹具：8 月一腿（充值 +50000，runningBalance 50000）、9 月两腿（swap 卖出 -10000 → 40000；提现 -5000 → 35000）
    tbEvidence.getAccountStatement.mockResolvedValue({ items: [
      leg('DEPOSIT_SUSPENSE_TO_PAYABLE', 'IN', 50000, 50000, '2026-08-15T08:00:00Z'),
      leg('SWAP_SELL_CLIENT', 'OUT', 10000, 40000, '2026-09-05T08:00:00Z'),
      leg('WITHDRAW_NET_POST', 'OUT', 5000, 35000, '2026-09-20T08:00:00Z'),
    ], currentBalance: 35000 });
    const no = await service.issue({ id: 'c1', customerNo: 'CU1' }, '2026-09');
    const row = prisma.customerMonthlyStatement.create.mock.calls[0][0].data;
    const aed = JSON.parse(row.payload).sections.find((s) => s.assetCode === 'AED');
    expect(no).toBe('STM-CU1-202609');
    expect(aed.openingBalance).toBe('50000');
    expect(aed.closingBalance).toBe('35000');
    expect(aed.rows).toHaveLength(2); // swap 行 + 提现行，8 月腿不入窗口
  });
  it('listMissingMonths: 6/15 开户、now=10/3 → [2026-06,2026-07,2026-08,2026-09]，已出具月剔除', /* findMany mock 返回已有 2026-06 行，断言结果为后三月 */);
  it('issue: 零腿币种期初=期末=0，照样出节', /* 空 items，断言 opening===closing==='0' 且 rows 空 */);
  it('issue: 同客户同月二次 issue 抛（唯一约束路径），且首单 payload 不被改写', /* create 抛 P2002，断言 update 零调用——快照不可变 */);
  it('issue: 未知事件码 SEIZE_X 走 FALLBACK 标题 Balance adjustment（白名单继承行为证明）', ...);
  it('sweep: 单轮补出多月仅最新月调 notifyStatementIssued 且参数为该月', ...);
});
```

`leg()` 为本文件内夹具工厂（返回 StatementLeg 形状）；mock 必须尊重 where（波一判例：mock 无视 where 假绿）。

- [ ] **Step 2: 跑测红** `npx jest src/modules/asset-treasury/treasury`。
- [ ] **Step 3: 实现生成器**。要点：`statementNo = \`STM-${customerNo}-${periodMonth.replace('-', '')}\``；逐币种：`findByOwner` 枚举 CLIENT_PAYABLE 户 → `getAccountStatement` 取全史腿 → 期初 = createdAt < startOfBusinessMonth 的最后腿 runningBalance（无则 '0'）→ `buildStatement(legs, { isFiat, from: startOfBusinessMonth, to: endOfBusinessMonth, take: 100000 })` 得 rows → 期末 = 窗口内最后腿 runningBalance（无则=期初）；`isFiat` 查 `prisma.asset.findFirst({ where: { currency } })`（照 `customer-portfolio.controller.ts:65-70`）；落库 + `auditLogs.recordSystem(AuditActions.STATEMENT_ISSUED, { entityType: 'MONTHLY_STATEMENT', entityNo: statementNo, requestId: statementNo, metadata: { statementNo, periodMonth } })`。
- [ ] **Step 4: 实现 sweep**（照 `compliance-obligation-sweep.service.ts:29,43` 样板）

```ts
@Cron('*/30 * * * * *')
async tick() { await this.sweep(); }
async sweep(now: Date = new Date()): Promise<void> {
  const customers = await this.prisma.customerMain.findMany({
    where: { onboardingApprovedAt: { not: null } },
    select: { id: true, customerNo: true, onboardingApprovedAt: true },
  });
  for (const c of customers) {
    const missing = await this.statements.listMissingMonths(c, now); // 升序、已剔除已出具月
    const issued: { statementNo: string; periodMonth: string }[] = [];
    for (const month of missing) {
      try { issued.push({ statementNo: await this.statements.issue(c, month), periodMonth: month }); }
      catch (err) { console.error(`[MonthlyStatementSweep] issue failed ${c.customerNo}/${month}:`, err); }
    }
    if (issued.length) {
      const latest = issued[issued.length - 1]; // missing 升序，末位即最新月
      try { await this.notifications.notifyStatementIssued({ customerId: c.id, ...latest }); }
      catch (err) { console.error('[MonthlyStatementSweep] notify failed:', err); }
    }
  }
}
```

- [ ] **Step 5: 审计码注册**——平面表 + 触达册内：

```ts
  STATEMENT_ISSUED: { domain: 'GOVERNANCE', correlationMode: 'N', requiredFields: ['statementNo', 'periodMonth'], requiresCausation: false },
```

`AuditEntityTypes` 加 `MONTHLY_STATEMENT`；册头注释 `:1309`"通知+确认单+协议"改"+月结单+DSR"（DSR 码 T5 进同册）。
- [ ] **Step 6: 跑测绿**；闭合守则 `npx jest src/modules/audit-logging --testPathPattern=closure` 绿。
- [ ] **Step 7: 随手闸** 闸① + jest 两目录。
- [ ] **Step 8: Commit** `git commit -m "feat(丙波四T3): 月结单生成器+30s追赶sweep+STATEMENT_ISSUED入触达册"`

---

### Task 4: 月结单可见面（client 两端点 + 翻月 UI + admin 一端点 + 详情节）

**Files:**
- Modify: `src/modules/asset-treasury/treasury/customer-portfolio.controller.ts`（两 client 路由）
- Modify: `src/modules/identity/customers/customers.controller.ts`（admin `GET :customerNo/statements`）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（admin 路由挂既有 `CUSTOMER_READ`）
- Modify: `client-web/src/pages/TransactionHistory.tsx`（`:233-275` 日期区加月份选择）
- Modify: `admin-web/src/pages/CustomerDetail.tsx`（Transactions 节 `:1173-1200` 后加 Monthly statements 节）
- Test: integration 用例并入 `monthly-statement.service.spec.ts`（controller 投影纯转发不另立 spec，admin-web 组件无单测环境——既有事实）

**Interfaces:**
- Consumes: T3 表数据。
- Produces: `GET /client/portfolio/statements` → `{ items: { statementNo; periodMonth; issuedAt }[] }`（periodMonth 降序）；`GET /client/portfolio/statements/:statementNo` → `{ statementNo; periodMonth; issuedAt; sections: [...payload] }`（校验归属：行 customerId ≠ JWT userId 则 404）；`GET /customers/:customerNo/statements` → 同列表投影。

**本任务过清单行**：新增 admin 端点（route()+db:base:sync+重启）；新增业务动作前端要有入口；改了前端→截图（两条永不豁免①）。

- [ ] **Step 1: client 两路由**（照该 controller 既有 `ensureCustomer` 自检形态；客户面零权限码）。
- [ ] **Step 2: admin 路由 + catalog 登记** `route('GET', '/customers/:customerNo/statements', ..., ['CUSTOMER_READ'])`（挂既有组零新桶）。
- [ ] **Step 3: TransactionHistory.tsx**——资产 chips 行旁加「Statements」下拉（列表来自新端点）：选中「Current activity」走现状；选中历史月切换渲染快照 sections（页头徽标 `Statement issued <issuedAt 本地日>`；行表复用现有表格组件结构，金额沿用现有换算函数）；支持 `?statement=` 查询参数直达（T2 深链）。
- [ ] **Step 4: CustomerDetail.tsx**——Monthly statements 只读节：月份/出具时刻/statementNo，行展开显示逐币种期末余额（样板：波三协议行 `fd437465` 的加节形态）。
- [ ] **Step 5: 随手闸** 闸①②③；`npm run db:base:sync` + 重启自己栈后端。
- [ ] **Step 6: preview 截图**——client 翻月视图 + admin 节各一张，落 `doc-final/superpowers/checkups/2026-10-03-campaign-c-wave4-evidence/`（命名 `01-client-statement-*.png` 起；空库此时无历史单属预期，截“Statements 下拉含当月前月份列表”以 T11 种子后复截为准——本步先验渲染不红、控制台零错）。
- [ ] **Step 7: Commit** `git commit -m "feat(丙波四T4): 月结单读面两端——client翻月+admin详情节"`

---

### Task 5: DSR 后端全量（主体服务 + 状态机 + 6 端点 + 权限四处 + 审计五码）

**Files:**
- Create: `src/modules/identity/dsr-requests/dsr.constants.ts` / `dsr-requests.service.ts` / `dsr-requests.admin.controller.ts` / `dsr-requests.module.ts`
- Test: `src/modules/identity/dsr-requests/dsr-requests.service.spec.ts`
- Modify: `rbac.catalog.ts`（PermissionGroup `:123` 后加两成员；Compliance Office 桶 `:1201-1210` 加 `.dsr`；6 条 route()；绑定：DPO `:1315-1325` 加 `DSR_READ`+`DSR_WRITE`，合规官 `:1377` 区与内审 `:1344` 区各加 `DSR_READ`）
- Modify: `scripts/verify-rbac.ts`（S13d `:816-822`：82→83 桶、90→92 组、`:820` 加 `has('DSR_READ') && has('DSR_WRITE')`；`:898` 注释同步；行为探针加四条：DPO resolve 200 / 合规官 resolve 403 / 运营 list 403 / DPO simulate-timeout 403）
- Modify: `audit-actions.constant.ts`（五码进触达册 + `AuditEntityTypes.DSR_REQUEST`）
- Modify: `admin-web/src/rbac/permissions.ts`（两键）

**Interfaces:**
- Consumes: T1 表；T2 `notifyDsrResolved`。
- Produces: `DsrRequestsService.submit(customer: { id }, dto: { type; detail }): Promise<{ requestNo }>`；`startReview(actor, requestNo)`；`generateSummary(actor, requestNo)`；`resolve(actor, requestNo, dto: { resolutionCode; resolutionNote })`；`simulateTimeout(actor, requestNo)`；`listForCustomer(customerId)`；`listAdmin(filter)`；`detailAdmin(requestNo)`。常量：

```ts
export const DSR_STATUS_TRANSITIONS: Record<string, string[]> = {
  SUBMITTED: ['IN_REVIEW'], IN_REVIEW: ['RESOLVED'], RESOLVED: [],
};
export const DSR_RESOLUTION_BY_TYPE: Record<string, string[]> = {
  ACCESS: ['ACCESS_SUMMARY_PROVIDED'],
  RECTIFICATION: ['RECTIFICATION_REVERIFY', 'RECTIFICATION_SELF_SERVICE'],
  ERASURE: ['ERASURE_REFUSED_RETENTION'],
};
export const DSR_DUE_DAYS = 30; // 自然日，锚提交时刻（裁定 13）
export const DSR_SUMMARY_PROFILE_FIELDS = ['customerNo','firstName','lastName','companyName','email','phone','dateOfBirth','nationality','idDocType','idDocNumber','residentialAddress','tradingTier','lifecycle','onboardingApprovedAt'] as const; // 白名单显式枚举；riskRating/eddRequired/hardLine/限制/标签一律不入（decisions:65）
```

**本任务过清单行**：新状态/新结局（显式迁移表+SLA 单钟）；新增权限组四处同时；新增 admin 端点；新增审计码四属性；持久动作写审计（人为 recordByActor、⚡照 `COMPLAINT_DEADLINE_FASTFORWARDED` 形态）；对外业务键。

- [ ] **Step 1: 失败测试**

```ts
it('submit: dueAt = submittedAt + 30 天，requestNo DSR- 前缀', ...);
it('迁移表：SUBMITTED→RESOLVED 直跳显式拒绝（400 带码 INVALID_TRANSITION）', ...);
it('resolve: resolutionCode 与 type 不匹配 400；RESOLVED 后一切写动作 400', ...);
it('resolve ACCESS 要求 summary 已生成，否则 400', ...);
it('generateSummary: 仅白名单字段入快照——断言 riskRating/eddRequired 不出现（反向断言）', ...);
it('resolve ERASURE_REFUSED_RETENTION: clauseRef 自动取该客户最新 consents.versionKey + section VI', ...);
it('simulateTimeout: dueAt→now−1h；终态 400', ...);
it('resolve 后调 notifyDsrResolved（吞错：notify 抛异常 resolve 仍成功）', ...);
```

- [ ] **Step 2: 跑测红** `npx jest src/modules/identity/dsr-requests`。
- [ ] **Step 3: 实现 service**。要点：`requestNo: generateReferenceNo('DSR')`；迁移经 `DSR_STATUS_TRANSITIONS` 显式校验；`generateSummary` 组装三块（白名单字段 / `customerAgreementConsent.findMany` 全量 `{versionKey, actedAt, decision}` / `materialRequest.findMany` 投影 `{materialType, status, issuedAt}`），只写一次（已有 summary 则 400）；`resolve` 在 `$transaction` 外先写库+审计、resolve 落库后 try/catch 调 `notifyDsrResolved`（持久物先于信号）；RECTIFICATION_REVERIFY 的连带开单在 T8 接（本任务先留 `materialRequestNo` 空写入路径，resolve 不因缺字段失败）。审计五码全走 `recordByActor`（⚡与 resolve 带 `requestId: requestNo`）。
- [ ] **Step 4: 审计五码注册**（触达册内，四属性照表）：

```ts
  DSR_SUBMITTED:              { domain: 'GOVERNANCE', correlationMode: 'N', requiredFields: ['requestNo', 'type'], requiresCausation: false },
  DSR_REVIEW_STARTED:         { domain: 'GOVERNANCE', correlationMode: 'N', requiredFields: ['requestNo'], requiresCausation: false },
  DSR_SUMMARY_GENERATED:      { domain: 'GOVERNANCE', correlationMode: 'N', requiredFields: ['requestNo'], requiresCausation: false },
  DSR_RESOLVED:               { domain: 'GOVERNANCE', correlationMode: 'N', requiredFields: ['requestNo', 'resolutionCode'], requiresCausation: false },
  DSR_DEADLINE_FASTFORWARDED: { domain: 'GOVERNANCE', correlationMode: 'N', requiredFields: ['requestNo'], requiresCausation: false },
```

- [ ] **Step 5: 6 条 admin 路由 + RBAC 四处**。路由：list/detail 挂 `['DSR_READ']`；start-review/generate-summary/resolve 挂 `['DSR_WRITE']`；simulate-timeout 挂 `['DEMO_CLOCK_WRITE']`。桶：

```ts
  { key: 'compliance-office.dsr', title: 'Handle data subject requests', groups: ['DSR_READ', 'DSR_WRITE'] },
```

- [ ] **Step 6: verify-rbac 同步**（S13d 三数 + has 两条 + 四探针；S16 系静态条目按新 admin 页补——形态照 `scripts/verify-rbac.ts:946-992` 既有条目与 `:2394` 投诉 ⚡ 样板，DSR ⚡端点一并登记）。
- [ ] **Step 7: 跑测绿 + 闭合守则绿 + 静态段** `API_BASE=http://127.0.0.1:1 npx ts-node scripts/verify-rbac.ts` 预期静态段绿、行为段跳过。
- [ ] **Step 8: 随手闸** 闸①；`npm run db:base:sync` + 重启自己栈。
- [ ] **Step 9: Commit** `git commit -m "feat(丙波四T5): DSR主体三态工单+6端点+DSR_READ/WRITE两组一桶+审计五码"`

---

### Task 6: DSR 管理台（列表 + 详情 + 侧栏）

**Files:**
- Create: `admin-web/src/pages/DsrRequestListPage.tsx` / `DsrRequestDetailPage.tsx`
- Modify: `admin-web/src/App.tsx`（两路由，样板 `:314` 义务页行）、`admin-web/src/layouts/DashboardLayout.tsx`（侧栏「Data Requests」，`DSR_READ` 门控，位置随 Compliance Office 组）

**Interfaces:**
- Consumes: T5 端点。列表列：requestNo / 客户（customerNo 链到客户详情）/ type / status / dueAt 倒计时（逾期红字，照投诉列表 `activeComplaintClock` 的展示法）/ resolvedAt。详情：状态轴、自述、动作区（Start review / Generate summary〔仅 ACCESS·IN_REVIEW〕/ Resolve 带 code 下拉〔按 type 过滤——前端本地镜像 `DSR_RESOLUTION_BY_TYPE` 映射与文案，照 `admin-web/src/utils/complaintMap.ts` 先例建 `dsrMap.ts`，不 import 后端常量〕+note）、⚡Simulate timeout（`DEMO_CLOCK_WRITE`+Simulation 开关双门控，照投诉详情页）、摘要卡（JSON 三块分区展示）、clauseRef 卡、审计跳转按钮（`ViewAuditTrailButton` 既有组件）。

**本任务过清单行**：新增业务动作前端有入口；改了前端→截图。

- [ ] **Step 1: 两页面 + 路由 + 侧栏**（权限键用 T5 的 permissions.ts 两键）。
- [ ] **Step 2: 随手闸** 闸②。
- [ ] **Step 3: preview 截图**——DPO 账号（`dpo@fiatx.com`）登录见侧栏入口、列表倒计时列、详情动作区三张；合规官登录**无** Resolve 按钮一张（独占反证）。证据落 T4 同目录。
- [ ] **Step 4: Commit** `git commit -m "feat(丙波四T6): DSR管理台列表/详情+DPO侧栏入口"`

---

### Task 7: DSR 客户端（提交 + 列表详情 + profile 入口）

**Files:**
- Create: `src/modules/identity/dsr-requests/dsr-requests.client.controller.ts`（`client/me/dsr-requests`：POST 提交 / GET 列表 / GET :requestNo 详情，样板 `complaints.client.controller.ts:15-40`）
- Create: `client-web/src/pages/DataRequests.tsx`（路由 `/data-requests`）
- Modify: `client-web/src/App.tsx`、`client-web/src/pages/CustomerProfile.tsx`（Audit & retention 节 `:467-484` 加「Submit a data request」入口链接）

**Interfaces:**
- Consumes: T5 service（client 投影：requestNo/type/status/submittedAt/dueAt 不下发/resolutionCode/resolutionNote/clauseRef/summary——**dueAt 是内部办理时限不下发客户面**，客户面显示"within 30 days"文案即可；summary 与 clauseRef 原样下发）。
- Produces: 客户面投影类型 `ClientDsrRow`，字段如上（显式投影，禁 `select *`）。

**本任务过清单行**：新字段到客户面当场过白名单（dueAt 不下发裁定在此钉死）；前端入口；截图。

- [ ] **Step 1: client controller 三路由**（JWT + ensureCustomer；提交 DTO `{ type: 'ACCESS'|'RECTIFICATION'|'ERASURE'; detail: string }` class-validator 枚举校验）。
- [ ] **Step 2: DataRequests 页**——顶部三选一提交表单（提交后刷新列表）；列表卡片：状态徽章、办结答复、ACCESS 摘要三区折叠、ERASURE 条款引用卡（展示 `versionKey` + §VI + 固定摘录"erasure (subject to retention obligations)"，链接 `/agreement`）。
- [ ] **Step 3: 随手闸** 闸①③。
- [ ] **Step 4: preview 截图**——提交表单、办结后的拒绝信卡两张。
- [ ] **Step 5: Commit** `git commit -m "feat(丙波四T7): DSR客户端提交/列表/条款引用卡+profile入口"`

---

### Task 8: 「改」的全链——REVERIFY 连带开材料请求 + 改档案通道（填孤儿桶）

**Files:**
- Modify: `src/modules/identity/dsr-requests/dsr-requests.service.ts`（resolve REVERIFY 分支）+ `dsr-requests.module.ts`（imports 材料请求模块）
- Modify: `src/modules/identity/customers/customers.service.ts`（新方法 `updateProfileFields`）、`customers.controller.ts`（PATCH 路由）
- Modify: `rbac.catalog.ts`（PATCH 路由挂既有 `['CUSTOMER_WRITE']`——孤儿桶 `customer.manage_profile:1073` 自此有路由）
- Modify: `audit-actions.constant.ts`（`CUSTOMER_PROFILE_UPDATED` 入 `V2_CUSTOMER_AUDIT_ACTIONS:1021` 册）
- Modify: `admin-web/src/pages/CustomerDetail.tsx`（Profile 节 `:1085` 加 Edit profile 弹窗，`CUSTOMER_WRITE` 门控）
- Modify: `doc-final/BACKLOG.md:236`（销账行）
- Test: 追加 `dsr-requests.service.spec.ts` 两用例 + `customers` 目录用例

**Interfaces:**
- Consumes: 既有 `MaterialRequestIssuerService.issue({ customerNo, materialType: 'EMIRATES_ID', origin: 'OPERATOR_ISSUED', orderDomain: null, reason, restrict: false })`（签名以 `material-request-issuer.service.ts:84` 实参为准，样板=制裁 PARTIAL `sanction-disposition-workflow.service.ts:367-398` 的调用形态）。
- Produces: `CustomersService.updateProfileFields(actor, customerNo, patch: Partial<Record<'firstName'|'lastName'|'dateOfBirth'|'nationality'|'idDocType'|'idDocNumber'|'residentialAddress', string>>): Promise<void>`——白名单外键显式 400；逐字段 diff 进审计 metadata（掩码经 `audit-mask.util.ts` 既有规则）。

**本任务过清单行**：新增审计码；持久动作写审计；该走的不是 maker-checker（DPO 独办已裁定 4，不触发）；每轮收尾 BACKLOG 销账（:236 提前在此销，收尾核对）。

- [ ] **Step 1: 失败测试**——`resolve REVERIFY: 调 issuer.issue 一次并回写 materialRequestNo；客户无 sumsubApplicantId 则 400 且不落 resolve`；`updateProfileFields: 白名单外键 400；成功写 CUSTOMER_PROFILE_UPDATED 审计含 changedFields`。
- [ ] **Step 2: 跑测红。**
- [ ] **Step 3: 实现两处**（REVERIFY 分支：先 issue 拿 requestNo、再落 resolve——开单失败则整个 resolve 失败，顺序保证 materialRequestNo 非悬空；审计码四属性 `{ domain: 'CUSTOMER', correlationMode: 'N', requiredFields: ['customerNo', 'changedFields'], requiresCausation: false }`）。
- [ ] **Step 4: catalog 挂路由** `route('PATCH', '/customers/:customerNo/profile', ..., ['CUSTOMER_WRITE'])`；verify-rbac 探针补两条（合规官 PATCH 200 形态探针、DPO PATCH 403）。
- [ ] **Step 5: CustomerDetail Edit profile 弹窗**（七字段表单，保存后刷新详情）。
- [ ] **Step 6: 跑测绿 + 闸①② + db:base:sync + 重启。**
- [ ] **Step 7: preview 截图**——合规官见 Edit profile 按钮、保存后审计中心 `CUSTOMER_PROFILE_UPDATED` 一条，两张。
- [ ] **Step 8: Commit** `git commit -m "feat(丙波四T8): REVERIFY连带开材料单+改档案PATCH填CUSTOMER_WRITE孤儿桶(销BACKLOG:236)"`

---

### Task 9: phone 自助改

**Files:**
- Modify: `src/modules/identity/customers/customer-profile.controller.ts`（`PATCH client/me/phone`）、`customers.service.ts`（`updatePhoneSelf`）
- Modify: `audit-actions.constant.ts`（`CUSTOMER_PHONE_UPDATED` 入 V2 客户册，`{ domain: 'CUSTOMER', correlationMode: 'N', requiredFields: ['customerNo'], requiresCausation: false }`，actor=customer 走 `recordByActor`）
- Modify: `client-web/src/pages/CustomerProfile.tsx:308`（phone 行行内编辑，保存调 PATCH 后 `refreshProfile()`）
- Test: customers 目录用例

**Interfaces:**
- Produces: `updatePhoneSelf(customerId: string, phone: string): Promise<void>`——`@unique` 冲突捕获后显式 409 带码 `PHONE_ALREADY_IN_USE`（业务规则非防御校验）；空串 400。

**本任务过清单行**：持久动作写审计（actor=customer）；新增审计码；前端入口；截图。

- [ ] **Step 1: 失败测试**（成功改+审计；占用 409；审计 metadata 经掩码——断言落库值含掩码后形态）。
- [ ] **Step 2: 红 → Step 3: 实现 → Step 4: 绿。**
- [ ] **Step 5: 前端行内编辑 + 闸③ + preview 截图**（编辑态与保存后各一张）。
- [ ] **Step 6: Commit** `git commit -m "feat(丙波四T9): phone客户自助改+CUSTOMER_PHONE_UPDATED"`

---

### Task 10: 闹钟墙 DSR 第四类灯

**Files:**
- Modify: `src/modules/governance/compliance-office/compliance-clock-wall.service.ts`（`:9` kind 联合加 `'DSR'`、`:38-55` 查询、`:98` 拼接）
- Modify: `compliance-clock-wall.service.spec.ts`（**fixture `:51-75` 必须加 `dsrRequest.findMany` mock，否则既有 getWall 用例全炸**——实扫预警；另加 DSR 分支用例照 `:172-260` COMPLAINT 形态）
- Modify: `admin-web/src/pages/ComplianceClockWallPage.tsx`（`:18` 类型、`:73-83` 徽章/标签、`:122-130` 行点击**显式加 DSR 分支跳 `/dsr-requests/:requestNo`——else 兜底会错跳义务页**、`:134-158` ⚡走 `/admin/dsr-requests/:requestNo/simulate-timeout`、`:194` canFastForward 加 DSR）

**Interfaces:**
- Consumes: T5 表与 ⚡端点。行映射：`{ kind: 'DSR', refNo: requestNo, title: \`Data request · ${type}\`, authority: 'DPO', deadlineAt: dueAt, overdue: dueAt < now（读时现算，投诉同款）, status, linkKey: requestNo, clockLabel: 'RESPOND (30d)' }`，查询条件 `status != 'RESOLVED'`。

**本任务过清单行**：改了前端→截图。

- [ ] **Step 1: 失败测试**（fixture 补表后：未办结 DSR 入墙带 clockLabel；已办结不入；过期 overdue=true）。
- [ ] **Step 2: 红 → Step 3: 实现（后端+前端五处）→ Step 4: 绿。**
- [ ] **Step 5: 闸①② + preview 截图**——⚡拨快后合规官看墙上 DSR 红灯一张；合规官点⚡不动（不持 `DEMO_CLOCK_WRITE`）据实截或改用金库/超管演示并在剧本注明（与投诉同款交叉）。
- [ ] **Step 6: Commit** `git commit -m "feat(丙波四T10): 闹钟墙DSR第四类灯+fixture补表"`

---

### Task 11: 种子——Henry 历史腿三件套 + Grace 已办结 ACCESS 单 + baseline 判据

**Files:**
- Modify: `prisma/seed.business.ts`（LP 先例 `:2425-2487` 同款三件套；新节放 LP 腿之后）
- Modify: `doc-final/demo/baseline.md`（重铺判据新增一节）
- 核查（只读）: `test/swap-money-arc.e2e-spec.ts:118` 起——其断言是否依赖 acme 期初零余额；若依赖，该文件断言改为相对差值（此为必需配套，非顺手改）

**Interfaces:**
- Consumes: T1 表（Grace DSR 行直插）；T3 sweep（起栈后自动补出历史月结单——种子不直插 statements 表，**出具一律走 sweep**，保证快照由真实生成器产出）。
- Produces: Henry（`demo_acme`）历史腿：上上月 15 日一笔 AED 充值 50,000.00（`DEPOSIT_SUSPENSE_TO_PAYABLE`）；上月 5 日 AED→USDT 兑换（`SWAP_SELL_CLIENT`/`SWAP_BUY_CLIENT`/`SWAP_FEE_CLIENT` 三腿，卖 10,000.00 AED）；上月 20 日 AED 提现 5,000.00 两腿（`WITHDRAW_NET_POST`/`WITHDRAW_FEE_POST`）。月份用 `businessMonthOf(now)` 推相对值；TB 真写 + `tbTransferEvidence` 回拨 `createdAt` + `accountFlow` 镜像，事件码/科目严格照各真实 workflow 的 post 形态抄（执行时以对应 workflow 的 `AccountingService` 调用为准逐腿核对借贷两侧，不得只贷客户侧——verify:coa 恒等式与负余额断言是本任务的红绿灯）。
- Grace 一行 `data_subject_requests`：type=ACCESS、RESOLVED、`summary` 按 T5 白名单三块手工构造、resolvedAt=submittedAt+3 天、不补审计（投诉种子同口径）。

**本任务过清单行**：动了钱→`verify:coa`（两条永不豁免②）；改种子→同步 `data.md`（T12 统一收口，本任务先改 baseline 判据）；改 schema 无。

- [ ] **Step 1: 写 Henry 腿与 Grace 单**（种子层例外，直插合法）。
- [ ] **Step 2: 重铺实证** `bash scripts/stack.sh reset self && bash scripts/stack.sh up`，起稳后 ≤60 秒：
  - `customer_monthly_statements` 行数 = 11 × 各自 2026-06 起已完整月数（按当日算出具体值记入 baseline）；
  - Henry 上月单 payload AED 节 rows ≥ 3、期末余额 = 35,000.00 − 费（具体值按费率算定后钉进 baseline）；
  - 通知表 STATEMENT 类 = 11（仅最新月规则）；`data_subject_requests` = 1。
- [ ] **Step 3: `bash scripts/on-stack.sh self verify:coa`** 恒等式 + 负余额全绿。
- [ ] **Step 4: 对账不受扰实证** `bash scripts/on-stack.sh self recon:demo` 按 `baseline.md` 既有场景数比对零新破口。
- [ ] **Step 5: swap-money-arc e2e 核查**（上述只读核查；受影响则改断言并单跑该文件证绿）。
- [ ] **Step 6: baseline.md 落判据（公式+当日快照值）。**
- [ ] **Step 7: T4 的 client 翻月截图此时补真数据版**（Henry 上月账单有行有费有期末）。
- [ ] **Step 8: Commit** `git commit -m "feat(丙波四T11): Henry历史腿三件套+Grace已办结ACCESS单+重铺判据"`

---

### Task 12: 剧本重排 + 文档收口 + 收尾闸

**Files:**
- Modify: `doc-final/demo/script.md`（新第十幕场景 33/34；协议幕顺延第十一幕、场景 33→35；头部"十幕主线"→十一幕；`:3,652` 两处"最后+reset"总则随迁；`:676` 审计引用改场景号；`:14,24` 陈旧"14 域 68 桶"改现值；`:7,52` "11 位"按 13 订正）
- Modify: `doc-final/demo/data.md`（Henry 历史腿、Grace DSR 单、月结单节——生成区不手改）
- Modify: `doc-final/modules/v2-customer-compliance.md`（新 §8 DSR+phone 自助改+改档案通道）、`doc-final/modules/v7-treasury.md`（月结单主体节）、`doc-final/modules/overview.md`（§4 计数 83/92 与历史段、§5 技术节点、§1 表 V2/V7 行）、`doc-final/modules/v1-governance.md`（发信点 17→19）
- Modify: `doc-final/decisions.md`（+3：无全局钟判死 / 月结单记账月口径+快照只写一次 / DSR 不走审批链 DPO 独办）
- Modify: `doc-final/BACKLOG.md`（核对 :236 已销）、`doc-final/CHANGELOG.md`（一行）、总纲 `2026-09-30-campaign-c-outreach-disclosure-charter.md`（状态行+§3 波四行）
- Modify: `delivery/` 触碰检查命中三项（状态机/审计集/业务键）→ decision-log 补 D-28（月结单三性+DSR 独办），语义合同指针式条目核对
- Modify: lark 审计词表种子文档（八码说明行+头部计数手改）+ `npm run audit:vocab` 重导

**本任务过清单行**：多波承接（丙末波→承接写进战役收官同步，不立新骨架）；每轮收尾（§9 报告行+CHANGELOG+BACKLOG）；改页面/种子同步 data/script。

- [ ] **Step 1: 幕序重排**，然后 grep 清点（判例：多处复述必漏改）：`grep -rn "第十幕\|场景 33\|十幕主线" doc-final/ --include="*.md" | grep -v archive` 逐条核改。
- [ ] **Step 2: 按剧本走查新第十幕**——场景 33（Henry 翻月+通知徽章+admin 节+审计）、场景 34（改链六步+删拒绝信+闹钟墙灯+Grace 摘要对照+Carol/Frank 账单 tipping-off 反面步），全程截图落证据目录。
- [ ] **Step 3: 文档全量收口 + `npm run audit:vocab`**（导出器 fail-fast 即对账闸；现役码预期 343 以机器数为准回填 overview/spec 数量表）。
- [ ] **Step 4: 收尾闸**——
  - `bash scripts/on-stack.sh self demo:all` 走通+终态断言（demo:all 零改动是判据之一：零 diff）；
  - `bash scripts/on-stack.sh self verify:coa`；
  - `bash scripts/stack.sh reset self` 重铺 → 按 baseline 新判据全绿；
  - `API_BASE=http://localhost:<.stackports> npx ts-node scripts/verify-rbac.ts` 全段（S13d 新值 83/92 + 新探针）；
  - jest：`src/core/notifications`、`src/modules/asset-treasury/treasury`、`src/modules/identity/dsr-requests`、`src/modules/identity/customers`、`src/modules/governance/compliance-office`、`src/modules/audit-logging` 全绿（`invite-expiry` 红按 Global Constraints ② 口径交代）；
  - 闸①②③全绿。
- [ ] **Step 5: 战役收官承接**——总纲状态行更新；spec/plan/骨架待合并后归档（归档动作留给合并会话，本任务只在总纲 §5 记一行）。
- [ ] **Step 6: Commit** `git commit -m "docs(丙波四T12): 幕序重排十一幕+四桶文档收口+收尾闸全绿"`

---

## 执行与评审档位（CLAUDE.md §6 映射）

- 任务执行（含随码测试）/任务级 code review/走查截图/文档收口 → **执行档 sonnet**（派发省略 model 字段走继承时须显式注明用 sonnet 别名）；纯机械批量无。
- spec 评审、终审、变异测试 → **Fable 不降档**；本波默认档（裁定 15），plan 不点名升档。
- 每个子代理 prompt 带 CLAUDE.md §0–§5 要点 + 本 plan Global Constraints。

## 依赖序

T1 → T2 → T3 → T4；T5 →（T6 ∥ T7）→ T8 → T9；T10 依赖 T5；T11 依赖 T3（sweep 出具）与 T5（DSR 表）；T12 收口依赖全部。T4 与 T5 可并行（不同 worktree 不共享文件时才并行；默认顺序流水）。
