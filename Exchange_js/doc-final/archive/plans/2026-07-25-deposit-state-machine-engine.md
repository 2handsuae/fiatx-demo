# 充值单状态机 · 计划 1 引擎 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans 逐任务执行。步骤用 `- [ ]` 跟踪。

**Goal:** 让充值单能被(mock 的)Sumsub webhook 驱动跑完整状态机:提交交易 → 收 webhook → 翻译 → 状态流转;FROZEN/SUCCESS 记账到位,CONFISCATING/RETURNING 只进在途态(结算留计划 2)。

**Architecture:** 三块物理分开——①出站 `SumsubClient`(真 HTTP + mock)②入站 `deposit-sumsub/` 干净接收+强类型 handler 翻译 ③自系统 `deposit-workflow` 状态机。全 mock fixture 驱动测试,不调真 Sumsub。设计见 [`specs/2026-07-25-deposit-state-machine-impl-design.md`](../specs/2026-07-25-deposit-state-machine-impl-design.md);合规语义见 [`specs/2026-07-23-deposit-sumsub-compliance-flow-design.md`](../specs/2026-07-23-deposit-sumsub-compliance-flow-design.md)。

**Tech Stack:** NestJS + Prisma(SQLite)+ TigerBeetle 记账 + Jest。

## Global Constraints

- 记账统一走 `AccountingService`(`src/modules/accounting/tigerbeetle/accounting.service.ts`),科目 = u16 code + ledger(`tb-account-codes.constant.ts`),**无 CLIENT_BLOCKED**(冻结=钱留 `DEPOSIT_SUSPENSE=101` 不释放)。
- 审计**必须** `AuditLogsService.recordSystem(...)`(DI 注入,禁 `new`);状态迁移用 `recordStateTransitionAudit`。
- 多表状态变更**必须** `prisma.$transaction`。
- 业务键查询(`depositNo` 等),禁以 `id` 作主查询合同。
- Workflow **禁**直写 domain 表 → 经 service 方法。
- **KYT-only**:只消费 `applicantKytTxn*`,忽略 `amlCase*`。
- deposit-only:老 `sumsub-ingestion/` 的 withdraw/swap 路径一行不动。
- 状态是 **TS enum**(`dto/deposit-transaction.dto.ts:4-14`)+ String 列,非 prisma enum。

---

### Task 1: schema 加字段 + 状态值 + 转移表

**Files:**
- Modify: `prisma/schema.prisma`(`DepositTransaction` 模型 `:949-996`)
- Modify: `src/modules/trading/deposit-transactions/dto/deposit-transaction.dto.ts`(enum `:4-14`,action `:73-83`)
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`(`getNextStatus` `:283`/转移表 `:301-331`,TERMINAL 集合 `:251`/`:287`)

**Interfaces:**
- Produces:新状态 `MANUAL_CHECKING/RETURNING/RETURNED/SEIZING/SEIZED/CONFISCATING`;新 action `submit_kyt/kyt_verdict/manual_checking/return/seize`(按需);新列 `sumsubFinanceTxnId?/sumsubTravelRuleTxnId?/manualReason?/slaDeadline?/slaBreached`。

- [ ] **Step 1:** `DepositTransaction` 模型加列(schema.prisma `:995` completedAt 后):
```prisma
  sumsubFinanceTxnId    String?
  sumsubTravelRuleTxnId String?
  manualReason          String?
  slaDeadline           DateTime?
  slaBreached           Boolean   @default(false)
```
- [ ] **Step 2:** enum 加值(dto `:13` CONFISCATED 后):
```ts
  MANUAL_CHECKING = 'MANUAL_CHECKING',
  RETURNING = 'RETURNING',
  RETURNED = 'RETURNED',
  SEIZING = 'SEIZING',
  SEIZED = 'SEIZED',
  CONFISCATING = 'CONFISCATING',
```
action enum 加(dto `:82` 附近):`KYT_VERDICT='kyt_verdict', MANUAL_CHECK='manual_check', RETURN='return', SEIZE='seize', RETURNED_DONE='returned_done', CONFISCATING_START='confiscating_start'`(命名实施时对齐 `getNextStatus` 用法)。
- [ ] **Step 3:** `getNextStatus` 转移表补边(`deposit-transactions.service.ts:301-331`)。新增:`COMPLIANCE_PENDING --KYT_VERDICT--> (由 workflow 决定目标,见 Task 7,这里放宽允许 → MANUAL_CHECKING/FROZEN/ACTION_PENDING/SUCCESS)`;`MANUAL_CHECKING --{APPROVE→SUCCESS, FREEZE→FROZEN, RETURN→RETURNING}`;`RETURNING --RETURNED_DONE--> RETURNED`;`FROZEN --{RETURN→RETURNING, SEIZE→SEIZING, RESUME→COMPLIANCE_PENDING}`。**注意:** 现表是 action 驱动;workflow 直接 `updateStatus(action)` 走这里,所以每条目标态都要在表里可达。
- [ ] **Step 4:** TERMINAL 集合(`:251`/`:287`)加 `RETURNED, SEIZED`(CONFISCATED 已在);**不加** RETURNING/SEIZING/CONFISCATING/MANUAL_CHECKING(可逆中间态)。
- [ ] **Step 5:** 迁移 + 生成 client:
```bash
cd Exchange_js && bash scripts/on-stack.sh main prisma:migrate -- --name deposit_sumsub_fields || npx prisma migrate dev --name deposit_sumsub_fields
npx prisma generate
```
Expected:迁移成功,`tsc` 对新列/新枚举无报错。
- [ ] **Step 6:** Commit `feat(deposit): 状态机新增 sumsub 字段+中间态+转移边`。

---

### Task 2: SumsubClient 接口 + 交易类型

**Files:**
- Create: `src/modules/deposit-sumsub/sumsub-txn-client.interface.ts`
- Create: `src/modules/deposit-sumsub/sumsub-txn.types.ts`

**Interfaces:**
- Produces:
```ts
export type KytVerdict = 'approved' | 'rejected' | 'awaitUser' | 'onHold';
export interface SumsubTxnDetail {
  txnId: string;
  verdict: KytVerdict;                  // 从 review.reviewResult / scoringResult.action 归一
  reviewAnswer: 'GREEN' | 'RED' | null;
  typedTags: { label: string; type: 'system' | 'userDefined' }[];
}
export interface SubmitTxnInput {
  applicantId: string; clientTxnId: string; type: 'finance' | 'travelRule';
  direction: 'in'; amount: number; currencyCode: string; currencyType: 'fiat' | 'crypto';
  counterparty?: { fullName?: string; accountId?: string };
}
export const SUMSUB_TXN_CLIENT = Symbol('SUMSUB_TXN_CLIENT');
export interface SumsubTxnClient {
  submitTxn(input: SubmitTxnInput): Promise<{ txnId: string }>;
  getTxn(txnId: string): Promise<SumsubTxnDetail>;
  rescore(txnId: string): Promise<void>;
  reviewComplete(txnId: string, answer: 'GREEN' | 'RED'): Promise<void>; // 冒烟/officer 模拟用
}
```
- Consumes:无。

- [ ] **Step 1:** 写上述两文件(纯类型/接口,无逻辑)。
- [ ] **Step 2:** `tsc` 通过。
- [ ] **Step 3:** Commit `feat(deposit-sumsub): SumsubTxnClient 接口+交易类型`。

---

### Task 3: SumsubTxnClient mock 实现(TDD)

**Files:**
- Create: `src/modules/deposit-sumsub/sumsub-txn-client.mock.ts`
- Test: `src/modules/deposit-sumsub/sumsub-txn-client.mock.spec.ts`

**Interfaces:**
- Consumes:`SumsubTxnClient`(Task 2)。
- Produces:`MockSumsubTxnClient` — 可被 fixture 预置:`primeSubmit(clientTxnId→txnId)`、`primeTxn(txnId→SumsubTxnDetail)`;`getTxn` 返回预置值,未预置抛。

- [ ] **Step 1:** 写失败测试:`primeTxn('T1', {verdict:'rejected', typedTags:[{label:'SANCTION',type:'userDefined'}]})` 后 `getTxn('T1')` 返回该对象;未预置 `getTxn('X')` 抛 `Unknown txn`。
- [ ] **Step 2:** 跑红 `npx jest sumsub-txn-client.mock -t "getTxn"`。
- [ ] **Step 3:** 实现 `MockSumsubTxnClient`(内部 `Map`;`submitTxn` 返回预置或 `MOCK-${clientTxnId}`;`getTxn` 查 Map)。
- [ ] **Step 4:** 跑绿。
- [ ] **Step 5:** Commit。

---

### Task 4: SumsubTxnClient 真实 HTTP 实现 + 沙盒冒烟

**Files:**
- Create: `src/modules/deposit-sumsub/sumsub-txn-client.http.ts`
- Reference: `src/modules/identity/onboarding/providers/sumsub/sumsub.client.ts`(`buildHeaders` `:176-208` 的 X-App-Token HMAC 签名范式)

**Interfaces:**
- Consumes:`SumsubTxnClient`;复用 env `SUMSUB_APP_TOKEN`/`SUMSUB_SECRET_KEY`。
- Produces:`HttpSumsubTxnClient`。

- [ ] **Step 1:** 实现四方法(照 bash 实测端点):
  - `submitTxn`:`POST /resources/applicants/{applicantId}/kyt/txns/-/data`(body 见 spec §3),返回 `data.id`。
  - `getTxn`:`GET /resources/kyt/txns/{id}/one`,归一 `review.reviewResult.reviewAnswer` + `scoringResult.action` → `verdict`,读 `typedTags`。
  - `rescore`:`POST /resources/kyt/txns/{id}/-/score`。
  - `reviewComplete`:`POST /resources/kyt/txns/{id}/review/status/completed` body `{reviewAnswer}`。
  - 签名复刻 `sumsub.client.ts` 的 HMAC(`ts+method+path+body`)。
- [ ] **Step 2:** 冒烟脚本 `scripts/sumsub-deposit-smoke.ts`:真 submit 一笔 → 轮询 getTxn 直到 verdict → 打印。**不进 CI**,手动 `npx ts-node`。
- [ ] **Step 3:** 手动跑冒烟,确认真 submit + getTxn 连通(happy 路径)。贴输出。
- [ ] **Step 4:** Commit `feat(deposit-sumsub): 真 SumsubTxnClient + 沙盒冒烟`。

---

### Task 5: deposit-sumsub 模块 + webhook 接收 + handler 路由(TDD)

**Files:**
- Create: `src/modules/deposit-sumsub/deposit-sumsub.module.ts`
- Create: `src/modules/deposit-sumsub/deposit-webhook.router.ts`(纯路由:按 `type` 分派到 handler)
- Test: `src/modules/deposit-sumsub/deposit-webhook.router.spec.ts`
- Reference:验签复用 `SumsubClient.verifyWebhookSignature`(`sumsub.client.ts:147`);老接收端范式 `sumsub-ingestion.controller.ts:22`。

**决策(接收端)**:**不新开** `/webhooks/sumsub`(老的已占且验签在那)。在 `SumsubIngestionService.dispatch()` 里**加一个前置分流**:`type` 以 `applicantKytTxn`/`applicantAction` 开头 → 交给 `DepositWebhookRouter`,其余走老逻辑。这样复用 durable 事件表/去重/retry/dead-letter,又不改老 withdraw/swap 分支。

**Interfaces:**
- Produces:`DepositWebhookRouter.route(payload): Promise<void>` — 按 `payload.type` 分派:
  - `applicantKytTxnApproved/Rejected/AwaitingUser/OnHold/Reviewed` → `DepositKytVerdictHandler`(Task 6)
  - `applicantActionReviewed/Pending` → `DepositActionHandler`(Task 9)
  - `applicantKytTxnCreated` → 回执(记 debug,不改状态)
  - 未知 → 记 orphan 告警。

- [ ] **Step 1:** 失败测试:投 `{type:'applicantKytTxnApproved', kytTxnId:'T1'}` → router 调 `kytVerdictHandler.handle` 一次(mock handler,jest spy)。
- [ ] **Step 2:** 跑红。
- [ ] **Step 3:** 实现 router(switch on `type` 前缀)+ module(provider:`DepositWebhookRouter`、`DepositKytVerdictHandler`、`DepositActionHandler`、`{provide:SUMSUB_TXN_CLIENT, useClass: 生产 Http/测试 Mock}`;imports:`forwardRef(DepositTransactionsModule)`)。
- [ ] **Step 4:** `SumsubIngestionService.dispatch()` 加前置分流分支(deposit txn 类型 → router);老分支不动。加 `DepositWebhookRouter` 到 ingestion module 的 imports/providers。
- [ ] **Step 5:** 跑绿 + `tsc`。
- [ ] **Step 6:** Commit。

---

### Task 6: DepositKytVerdictHandler — 翻译 + 回拨读 tag(TDD)

**Files:**
- Create: `src/modules/deposit-sumsub/deposit-kyt-verdict.handler.ts`
- Test: `src/modules/deposit-sumsub/deposit-kyt-verdict.handler.spec.ts`

**Interfaces:**
- Consumes:`SumsubTxnClient`(读 tag)、`DepositWorkflowService.applyKytVerdict`(Task 7)、映射(`payload.applicantId`+`kytTxnReference`→ deposit via `sumsubFinanceTxnId/sumsubTravelRuleTxnId`)。
- Produces:`handle(payload): Promise<void>` —
  ```
  1. 幂等去重(kytTxnId + reviewAnswer;见 §5)
  2. 映射到 deposit(找不到 → orphan 告警,return)
  3. 若 type∈{Rejected,AwaitingUser}:调 getTxn 读 typedTags
  4. 归一 verdict + 提取场景 tag(SANCTION/PEP)+ 处置 tag(FROZEN_BY_MLRO/RETURN_TO_SENDER)
  5. 调 workflow.applyKytVerdict(depositId, {verdict, sceneTag, dispoTag})
  ```

- [ ] **Step 1:** 失败测试(mock SumsubTxnClient + mock workflow):
  - Approved → 不拉 tag,调 `applyKytVerdict(id,{verdict:'approved'})`
  - Rejected + getTxn 返回 [SANCTION] → 调 `applyKytVerdict(id,{verdict:'rejected', sceneTag:'SANCTION'})`
  - Rejected + getTxn 返回 [FROZEN_BY_MLRO] → `{verdict:'rejected', dispoTag:'FROZEN_BY_MLRO'}`
  - AwaitingUser + [PEP] → `{verdict:'awaitUser', sceneTag:'PEP'}`
  - Reviewed → no-op(不调 workflow)
- [ ] **Step 2:** 跑红。
- [ ] **Step 3:** 实现 handler。
- [ ] **Step 4:** 跑绿。
- [ ] **Step 5:** Commit。

---

### Task 7: workflow.applyKytVerdict — 状态转移(TDD)

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`
- Test: `src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts`(新增用例)

**Interfaces:**
- Consumes:现有 `approveDeposit`(SUCCESS 路,`:236`)、`deposit-transactions.service.updateStatus`、`recordStateTransitionAudit`(`:599`)、`recordSystem`。
- Produces:
```ts
async applyKytVerdict(depositId: string, v: {
  verdict: KytVerdict; sceneTag?: 'SANCTION'|'PEP'; dispoTag?: 'FROZEN_BY_MLRO'|'RETURN_TO_SENDER';
}): Promise<void>
```
逻辑(按 spec §5.1b + 校正后 FROZEN):
```
读 deposit;已终态 → no-op(幂等)
switch verdict:
  approved:
     若 status===MANUAL_CHECKING → 记 DEPOSIT_MANUAL_APPROVED(误报翻案)
     → 走运营闸(Task: 复用 checkAutoApproval / approveDeposit;below-min 判定见下)
  awaitUser:
     updateStatus(ACTION_PENDING); manualReason = sceneTag==='PEP' ? 'EDD_PEP' : 'CLIENT_ACTION'
  onHold:
     原地留 COMPLIANCE_PENDING;设 slaDeadline(now+X);记 DEPOSIT_ONHOLD
  rejected:
     若 sceneTag==='SANCTION' 或 dispoTag==='FROZEN_BY_MLRO' → 冻结:updateStatus(FREEZE) → FROZEN(钱留 suspense,零记账),记 DEPOSIT_FROZEN(reason)
     若 dispoTag==='RETURN_TO_SENDER' → updateStatus(RETURN) → RETURNING(结算留计划2),记 DEPOSIT_RETURN_INITIATED
     否则(无处置 tag)→ updateStatus(MANUAL_CHECK) → MANUAL_CHECKING,记 DEPOSIT_MANUAL_CHECKING
```
> below-min 没收:approved 后若金额 < 最小充值阈值 → updateStatus(CONFISCATING_START) → CONFISCATING(结算留计划2);否则走现成 `approveDeposit` → SUCCESS。阈值来源实施时对齐(现有 min 配置或 v4-deposit 口径)。

- [ ] **Step 1:** 逐 verdict 写失败测试(mock deposit-transactions.service + audit),断言目标状态 + 审计 action。
- [ ] **Step 2:** 跑红。
- [ ] **Step 3:** 实现 `applyKytVerdict`;新审计 action 名注册到 `audit-actions.constant.ts`(`DEPOSIT_FROZEN/DEPOSIT_MANUAL_CHECKING/DEPOSIT_MANUAL_APPROVED/DEPOSIT_RETURN_INITIATED/DEPOSIT_CONFISCATING_STARTED/DEPOSIT_ONHOLD`)。
- [ ] **Step 4:** 跑绿。
- [ ] **Step 5:** Commit。

---

### Task 8: 提交入口 — payin 确认后 submit 交易存 txnId(TDD)

**Files:**
- Modify: `deposit-workflow.service.ts`(`runGate0` `:95` 或 `handleDepositStatusChanged` `:83`,COMPLIANCE_PENDING 后)

**Interfaces:**
- Consumes:`SumsubTxnClient.submitTxn`;deposit 有 `ownerId`(customerId→applicantId 映射:客户 `sumsubApplicantId`,种子已回写 Alice)。
- Produces:进 COMPLIANCE_PENDING 时:法币 submit finance ×1;虚拟币 submit finance + travelRule ×2 → 存 `sumsubFinanceTxnId`/`sumsubTravelRuleTxnId`。

- [ ] **Step 1:** 失败测试:deposit 进 COMPLIANCE_PENDING(法币)→ `submitTxn(type:'finance')` 调一次,`sumsubFinanceTxnId` 落库。虚拟币 → 两次。
- [ ] **Step 2:** 跑红。
- [ ] **Step 3:** 实现(注入 `@Inject(SUMSUB_TXN_CLIENT)`;客户 applicantId 查 `customer.sumsubApplicantId`;资产类型判 fiat/crypto)。**注意 DI 循环**:deposit-workflow 依赖 SumsubTxnClient,client 在 deposit-sumsub module → 用 forwardRef 或把 client provider 提到共享 module。
- [ ] **Step 4:** 跑绿。
- [ ] **Step 5:** Commit。

---

### Task 9: DepositActionHandler + 客户补料重算(TDD)

**Files:**
- Create: `src/modules/deposit-sumsub/deposit-action.handler.ts`
- Test: 同名 spec

**Interfaces:**
- Consumes:`SumsubTxnClient`、`DepositWorkflowService`。
- Produces:`handle(payload)` — `applicantActionReviewed` → 找 deposit → 拉交易重算结果(getTxn)→ 若 verdict 非 awaitUser 走 `applyKytVerdict`(客户补完料,自动重算,spec §5.4);仍 awaitUser → no-op(留 ACTION_PENDING)。

- [ ] **Step 1:** 失败测试:ActionReviewed + getTxn 返回 approved → 调 `applyKytVerdict(approved)`;返回 awaitUser → 不调。
- [ ] **Step 2-4:** 跑红→实现→跑绿。
- [ ] **Step 5:** Commit。

---

### Task 10: onHold / ACTION SLA 定时器(TDD)

**Files:**
- Create: `src/modules/deposit-sumsub/deposit-sla.service.ts`(`@Cron`,仿 `sumsub-ingestion-retry.service.ts:19`)
- Test: 同名 spec(注入假时钟)

**Interfaces:**
- Produces:定时扫 `status∈{COMPLIANCE_PENDING(onHold),ACTION_PENDING} 且 slaDeadline < now` → `updateStatus(MANUAL_CHECK)` → MANUAL_CHECKING,`slaBreached=true`,记 `DEPOSIT_SLA_BREACHED`。

- [ ] **Step 1-4:** 假时钟测试:slaDeadline 过 → 转 MANUAL_CHECKING;未过 → 不动。跑红→实现→跑绿。
- [ ] **Step 5:** Commit。

---

### Task 11: 9 场景 fixture + scenario-runner

**Files:**
- Create: `src/modules/deposit-sumsub/fixtures/scenarios.ts`(S1-S9,每个 = {submit 预置, getTxn 预置, webhook 序列})
- Create: `test/helpers/deposit-scenario-runner.ts`(把 fixture 喂进 MockSumsubTxnClient + 逐条投 webhook 进 router)

**Interfaces:**
- Consumes:`MockSumsubTxnClient`、`DepositWebhookRouter`。
- Produces:`runScenario(app, scenarioKey, depositId): Promise<void>`;fixture 形状按 spec §3 表 + 实捕 webhook JSON(payload 字段 `type/applicantId/kytTxnId/reviewResult`)。

- [ ] **Step 1:** 写 S1-S9 fixture(webhook payload 用实捕字段;S3/S4/S5/S6 的 tag 走 getTxn 预置)。
- [ ] **Step 2:** 写 runner。
- [ ] **Step 3:** `tsc` 通过(此任务无独立断言,断言在 Task 12)。
- [ ] **Step 4:** Commit。

---

### Task 12: 9 场景 e2e + 幂等/乱序(TDD)

**Files:**
- Test: `test/deposit-sumsub-scenarios.e2e-spec.ts`

**Interfaces:**
- Consumes:scenario-runner、真实 Nest app(mock 仅 SumsubTxnClient,记账用真 TigerBeetle 或测试替身按现有 e2e 惯例)。

- [ ] **Step 1:** 每场景一用例,断言终态(见 spec §3 表,计划1 版:S6→RETURNING、S8→CONFISCATING)+ 关键审计 action 有写。
- [ ] **Step 2:** S1(happy)额外断言 STEP_2 记账两腿守恒(客户 CLIENT_PAYABLE +X;`verify:coa` 口径)。
- [ ] **Step 3:** 幂等:同一 Approved 投两次 → 状态只变一次(第二次 no-op)。乱序:先投 Approved 再投 Created → 终态正确。
- [ ] **Step 4:** 跑绿 `npx jest deposit-sumsub-scenarios`。
- [ ] **Step 5:** Commit。

---

### Task 13: 文档同步 + 硬闸

**Files:**
- Modify: `doc-final/reference/truth/sumsub-ingestion.md`(加 deposit txn webhook 分流 + DepositWebhookRouter)
- Modify: `doc-final/reference/truth/v4-deposit.md`(新状态 + KYT-only 驱动 + FROZEN 语义)
- Modify: `doc-final/BACKLOG.md`(登记计划 2 待做 + "慢 case 自动重算未端到端验")

- [ ] **Step 1:** 同步两 truth 文档到新现状。
- [ ] **Step 2:** BACKLOG 登记:计划 2(RETURNING/SEIZING/CONFISCATING 两腿结算 + 解冻)、慢 case 验证欠账、退回/上缴 COA 科目待建。
- [ ] **Step 3:** 硬闸全绿:
```bash
cd Exchange_js && npx tsc --noEmit && npx jest && bash scripts/on-stack.sh main verify:coa
```
- [ ] **Step 4:** Commit `docs(deposit): 计划1 引擎落地,truth 同步`。

---

## Self-Review 检查(执行前作者自查)

- **Spec 覆盖**:spec §1-3/§5-7 对应 Task 1-13;§4 动钱弧结算(RETURNED/SEIZED/CONFISCATED)= 计划 2,本计划止于进在途态 ✅。
- **类型一致**:`KytVerdict`/`SumsubTxnDetail`/`applyKytVerdict` 签名 Task 2/6/7 一致 ✅。
- **占位扫描**:below-min 阈值来源、customer→applicantId 映射字段(`sumsubApplicantId`)= 已指明来源,非占位 ✅。
- **风险**:DI 循环(workflow↔SumsubTxnClient)Task 8 标注,用 forwardRef/共享 provider 解。

## 与计划 2 的边界

计划 2 承接:CONFISCATING→CONFISCATED / RETURNING→RETURNED / FROZEN→SEIZING→SEIZED 的**两腿 pending→post 结算(复刻 SWAP `swap-leg-accounting.ts`)+ 审批管道 + 解冻回炉 + 3 重试 self-heal**。新增科目(外部出金账、政府账)+ transfer code。
