# 充值详情 · Sumsub 报文存证与展示增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Sumsub `getTxn` 报文按腿存下来并在充值 admin 详情页展示核心字段(score / 命中规则 / actionId / TR 二元 / 内部审批单),顺带清理状态文案、`kyt→finance` 改名、删大 ACTIONS 块。

**Architecture:** 后端在既有 KYT-only 管道(`deposit-sumsub` handler + `deposit-workflow` + `deposit-transactions.service`)上加两列存证 + 一次 approved 拉取 + `findOneForAdmin` 带出展示子集与审批反查;前端在 `DepositTransactionDetail.tsx` + `depositStatusMap.ts` 上改展示。不新建表、不动状态机流转。

**Tech Stack:** NestJS + Prisma(SQLite)+ Jest;React + Vite(admin-web);Sumsub KYT txn client(mock/http 双实现)。

## Global Constraints

- **改代码同步 truth**:改现状必须同步 `doc-final/reference/truth/`(funds-orders / 相关)。
- **有持久状态、operator 可见操作 → 必须 `AuditLogsService`(DI 注入,禁 `new`)**。本轮存证/展示不新增 operator 动作,但删横幅/加模块不触发新审计。
- **禁止以 `id` 作主查询合同**:审批反查用 `entityRef=deposit.id` 是审批表既有合同(非业务键场景,ApprovalCase 就是按 entityRef 存的),允许。
- **状态机流转一行不动**:本轮只加存证 + 展示,不改任何 transition。
- **客户面零泄露**:新增的 `financeTxnDetailJson`/`travelRuleTxnDetailJson` 含对手方 PII,**绝不进** `toCustomerDepositView` 白名单。
- **改名仅 deposit**:`kyt*→finance*` 只动 deposit 表与 deposit 域;withdraw 的 `preKyt/postKyt` 命名不碰。
- **每轮硬闸**:后端 `tsc` 0、admin `tsc` 0、`jest` 不回归(`asset-treasury/wallets` 4 例 pre-existing 除外)。

---

### Task 1: 存证列 + getTxn 带 raw(数据地基)

**Files:**
- Modify: `prisma/schema.prisma:967`(DepositTransaction,加两列)
- Create: `prisma/migrations/<ts>_deposit_finance_txn_detail/migration.sql`
- Modify: `src/modules/deposit-sumsub/sumsub-txn.types.ts:3-9`(`SumsubTxnDetail` 加 `raw`)
- Modify: `src/modules/deposit-sumsub/sumsub-txn-client.http.ts:62-72`(`getTxn` 填 `raw`)
- Modify: `src/modules/deposit-sumsub/sumsub-txn-client.mock.ts:14-33`(`primeTxn`/`getTxn` 透传 `raw`)
- Test: `src/modules/deposit-sumsub/sumsub-txn-client.mock.spec.ts`

**Interfaces:**
- Produces: `SumsubTxnDetail.raw: unknown`(原始报文对象,mock/http 都填);deposit 表列 `financeTxnDetailJson String?` / `travelRuleTxnDetailJson String?`。

- [ ] **Step 1: schema 加两列**

在 `model DepositTransaction` 的 sumsub 字段附近(`sumsubTravelRuleTxnId` 之后)加:
```prisma
  financeTxnDetailJson    String?
  travelRuleTxnDetailJson String?
```

- [ ] **Step 2: 生成迁移**

Run: `npx prisma migrate dev --name deposit_finance_txn_detail --create-only`
然后 `npx prisma migrate deploy` + `npx prisma generate`。
Expected: 迁移文件生成,两列 `ALTER TABLE ADD COLUMN`,client 重新生成含新字段。

- [ ] **Step 3: 类型加 raw**

`sumsub-txn.types.ts` `SumsubTxnDetail` 末尾加字段:
```ts
  raw?: unknown;                        // getTxn 原始报文,存证用(乙口径落库)
```

- [ ] **Step 4: http/mock 填 raw**

`sumsub-txn-client.http.ts` `getTxn` 的 return 加 `raw: data`(整个响应体)。
`sumsub-txn-client.mock.ts` `getTxn` 直接返回 detail(测试 prime 时把 raw 塞进 detail),无需改逻辑;确认 `primeTxn(txnId, detail)` 的 detail 可带 `raw`。

- [ ] **Step 5: 单测**

`sumsub-txn-client.mock.spec.ts` 加一条:`primeTxn` 带 `raw` 后 `getTxn` 返回值含该 `raw`。
Run: `npx jest src/modules/deposit-sumsub/sumsub-txn-client.mock.spec.ts`
Expected: PASS。

- [ ] **Step 6: tsc + commit**

Run: `npx tsc --noEmit -p tsconfig.json` → 0
```bash
git add prisma src/modules/deposit-sumsub/sumsub-txn.types.ts src/modules/deposit-sumsub/sumsub-txn-client.http.ts src/modules/deposit-sumsub/sumsub-txn-client.mock.ts src/modules/deposit-sumsub/sumsub-txn-client.mock.spec.ts
git commit -m "feat(deposit): 存证列 financeTxnDetailJson/travelRuleTxnDetailJson + getTxn 带 raw 报文"
```

---

### Task 2: handler 存证 + approved 也拉

**Files:**
- Modify: `src/modules/deposit-sumsub/deposit-kyt-verdict.handler.ts:16-17,54-67`
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts:296-322`(`applyKytVerdict` 增参 + 写库调用)
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts:496-505`(新增按腿写报文的方法)
- Test: `src/modules/deposit-sumsub/deposit-kyt-verdict.handler.spec.ts`、`src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts`

**Interfaces:**
- Consumes: `SumsubTxnDetail.raw`(Task 1);`KytLane`。
- Produces: `applyKytVerdict(depositId, { verdict, lane, riskScore, sceneTag?, dispoTag?, detailRaw? })`;`DepositTransactionsService.saveTxnDetail(depositId, lane, json)`。

- [ ] **Step 1: 写失败测试(存证 + approved 拉)**

`deposit-kyt-verdict.handler.spec.ts`:①approved 现在断言「不调 getTxn」——改为**断言调 getTxn**(决策 7),且 `applyKytVerdict` 收到 `detailRaw`;②rejected/awaitUser 断言 `detailRaw` 透传。
`deposit-workflow.service.spec.ts`(`applyKytVerdict — L2 闸门字段回写` describe 内加):断言按 `lane` 调 `saveTxnDetail` 写对列。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/deposit-sumsub/deposit-kyt-verdict.handler.spec.ts`
Expected: FAIL(approved 仍不拉 / detailRaw 未透传)。

- [ ] **Step 3: handler 把 approved 纳入拉取 + 透传 raw**

`deposit-kyt-verdict.handler.ts`:
```ts
// approved 也拉:证据对齐(score + 报文),但不读处置 tag。
const DETAIL_LOOKUP_VERDICTS = new Set<KytVerdict>(['approved', 'rejected', 'awaitUser']);
const TAG_LOOKUP_VERDICTS = new Set<KytVerdict>(['rejected', 'awaitUser']);
```
handle() 内:
```ts
let riskScore: number | null = null;
let detailRaw: unknown;
if (DETAIL_LOOKUP_VERDICTS.has(verdict)) {
  const detail = await this.sumsubTxnClient.getTxn(kytTxnId);
  riskScore = detail.riskScore ?? null;
  detailRaw = detail.raw;
  if (TAG_LOOKUP_VERDICTS.has(verdict)) {
    for (const tag of detail.typedTags) {
      if (tag.type !== 'userDefined') continue;
      if (SCENE_TAGS.has(tag.label)) sceneTag = tag.label as 'SANCTION' | 'PEP';
      if (DISPO_TAGS.has(tag.label)) dispoTag = tag.label as 'FROZEN_BY_MLRO' | 'RETURN_TO_SENDER';
    }
  }
}
await this.workflow.applyKytVerdict(deposit.id, {
  verdict, lane, riskScore,
  ...(sceneTag && { sceneTag }),
  ...(dispoTag && { dispoTag }),
  ...(detailRaw !== undefined && { detailRaw }),
});
```

- [ ] **Step 4: service 加 saveTxnDetail**

`deposit-transactions.service.ts`(挨着 `updateKytStatus`):
```ts
async saveTxnDetail(id: string, lane: 'FINANCE' | 'TRAVEL_RULE', json: string) {
  const col = lane === 'TRAVEL_RULE' ? 'travelRuleTxnDetailJson' : 'financeTxnDetailJson';
  return (this.prisma as any).depositTransaction.update({ where: { id }, data: { [col]: json } });
}
```

- [ ] **Step 5: applyKytVerdict 落库**

`deposit-workflow.service.ts` `applyKytVerdict` 签名加 `detailRaw?: unknown`;在 `writeBackGateStatus` 之后、终态 no-op 之内(终态单不覆写)加:
```ts
if (v.detailRaw !== undefined) {
  await this.depositService.saveTxnDetail(deposit.id, v.lane ?? 'FINANCE', JSON.stringify(v.detailRaw));
}
```

- [ ] **Step 6: 跑测试确认通过 + commit**

Run: `npx jest src/modules/deposit-sumsub/deposit-kyt-verdict.handler.spec.ts src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts`
Expected: PASS。tsc 0 后 commit:
```bash
git commit -am "feat(deposit): getTxn 报文按腿存库 + approved 也拉(证据对齐)"
```

---

### Task 3: `kyt*` 列改名 `finance*`(deposit 域,机械改全)

**Files:**
- Modify: `prisma/schema.prisma:968-971`(4 列改名)
- Create: `prisma/migrations/<ts>_deposit_kyt_rename_finance/migration.sql`
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts:496-505,551-553`
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts:376-379,615-616,685-687,771`
- Modify: `src/modules/trading/deposit-transactions/dto/deposit-transaction.dto.ts:69`
- Modify: `admin-web/src/pages/DepositTransactionDetail.tsx`(`data.kytStatus`/`data.kytRiskScore` 读取处)
- Test: 现有 deposit specs 引用旧字段处同步

**Interfaces:**
- Produces: deposit 列 `financeStatus`/`financeRiskScore`/`financeCheckedAt`/`financeScreeningId`;`updateFinanceStatus(id,status,riskScore?)`。
- ⚠️ **withdraw 的 `kyt*` 不动**(schema:1198-1201);`sumsub-ingestion.service.ts:134` 的 `applyKytResult(depositId, kytStatus:string, ...)` 参数名是字符串,不随列改,内部走 `updateFinanceStatus` 即可。

- [ ] **Step 1: schema 4 列改名**

`model DepositTransaction`:`kytStatus→financeStatus`、`kytScreeningId→financeScreeningId`、`kytRiskScore→financeRiskScore`、`kytCheckedAt→financeCheckedAt`(保留各自 `@default`/`?`)。**只改 968-971 段,不碰 1198-1201(withdraw)**。

- [ ] **Step 2: 迁移(RENAME COLUMN)**

Run: `npx prisma migrate dev --name deposit_kyt_rename_finance --create-only`
手工确认 migration.sql 是 4 条 `ALTER TABLE "deposit_transactions" RENAME COLUMN "kytStatus" TO "financeStatus"` 等(Prisma 对 SQLite 可能生成表重建;若是重建,确认数据保真)。
Run: `npx prisma migrate deploy && npx prisma generate`

- [ ] **Step 3: 后端引用改全**

- `deposit-transactions.service.ts`:方法 `updateKytStatus`→`updateFinanceStatus`;body 里 `kytStatus/kytRiskScore/kytCheckedAt`→`finance*`。
- `deposit-workflow.service.ts`:`updateKytStatus` 调用点(:376,:616)→`updateFinanceStatus`;`deposit.kytRiskScore`→`deposit.financeRiskScore`(:379);`deposit.kytStatus`→`deposit.financeStatus`(:685,:687);:771 metadata `kytStatus: deposit.kytStatus`→`financeStatus: deposit.financeStatus`。注释 :352-353 同步。
- `dto:69`:`kytStatus?`→`financeStatus?`(如 DTO 还有 riskScore/checkedAt 一并)。

- [ ] **Step 4: 前端读取改全**

`DepositTransactionDetail.tsx`:接口类型与渲染里 `data.kytStatus`→`data.financeStatus`、`data.kytRiskScore`→`data.financeRiskScore`(L2 Finance 行、§Task 6 会重排,此处仅改字段名)。

- [ ] **Step 5: tsc 兜底扫漏 + 测试同步**

Run: `npx tsc --noEmit -p tsconfig.json`(deposit 域漏改会在此报错)
Run: `cd admin-web && npx tsc --noEmit && cd ..`
修所有报错;deposit specs 里旧字段引用同步改。
Run: `npx jest src/modules/trading/deposit-transactions`
Expected: 全绿。

- [ ] **Step 6: commit**

```bash
git commit -am "refactor(deposit): kyt* 列/方法改名 finance*(仅 deposit 域,与 Sumsub finance type 对齐)"
```

---

### Task 4: findOneForAdmin 带出展示子集 + 审批反查

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`(`findOneForAdmin` + 构造函数注入 `ApprovalsService`)
- Test: `src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts`

**Interfaces:**
- Consumes: `financeTxnDetailJson`/`travelRuleTxnDetailJson`(Task 2 落库);`ApprovalsService.list`(`approvals.service.ts:873`,已支持 `entityRef` 过滤,module 已 import `ApprovalsModule`)。
- Produces: `findOneForAdmin` 返回追加 `financeDetail`/`travelRuleDetail`(解析子集)+ `approvals[]`(仅单头)。

- [ ] **Step 1: 写失败测试**

`deposit-transactions.service.spec.ts`:mock `financeTxnDetailJson` = 一段含 `scoringResult.{score,matchedRules,applicantActions}` 的 JSON,断言 `findOneForAdmin` 返回 `financeDetail.score`/`matchedRules`/`applicantActionIds`;mock `approvalsService.list` 返回两条,断言 `approvals` 为**仅单头**数组(无 `steps`/`step` 字段)。

- [ ] **Step 2: 注入 ApprovalsService + 解析子集**

构造函数加 `private readonly approvalsService: ApprovalsService`(import from `../../governance/approvals/approvals.service`)。
`findOneForAdmin` 内加解析 helper:
```ts
const parseDetail = (json?: string | null) => {
  if (!json) return null;
  let d: any; try { d = JSON.parse(json); } catch { return null; }
  const sr = d.scoringResult ?? {};
  return {
    verdict: d.verdict ?? null,
    reviewAnswer: d.review?.reviewResult?.reviewAnswer ?? d.reviewAnswer ?? null,
    score: sr.score ?? null,
    matchedRules: (sr.matchedRules ?? []).map((r: any) => ({ id: r.id, name: r.name, action: r.action, score: r.score })),
    applicantActionIds: (sr.applicantActions ?? []).map((a: any) => a.applicantActionId).filter(Boolean),
    tags: (d.typedTags ?? []).map((t: any) => t.label),
    raw: d,                                     // 供订单下方原文折叠
  };
};
```
返回对象追加:
```ts
financeDetail: parseDetail(item.financeTxnDetailJson),
travelRuleDetail: parseDetail(item.travelRuleTxnDetailJson),
```

- [ ] **Step 3: 审批反查(仅单头)**

`findOneForAdmin` 内:
```ts
const approvalPage = await this.approvalsService.list({ entityRef: item.id } as any);
const approvals = (approvalPage.items ?? []).map((a: any) => ({
  approvalNo: a.approvalNo, actionType: a.actionType, status: a.status, createdAt: a.createdAt,
}));
```
返回追加 `approvals`。**只 pick 四字段,丢弃 steps/step**(业主定:不含 step)。

- [ ] **Step 4: 跑测试 + tsc + commit**

Run: `npx jest src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts` → PASS
tsc 0 后:
```bash
git commit -am "feat(deposit): findOneForAdmin 带 Sumsub 报文展示子集 + 内部审批单反查(仅单头)"
```

---

### Task 5: fixtures 补全报文

**Files:**
- Modify: `src/modules/deposit-sumsub/fixtures/scenarios.ts`
- Modify: `src/modules/deposit-sumsub/demo-scenario.service.ts`(若 primeTxn 透传需带 raw)
- Test: `src/modules/deposit-sumsub/demo-scenario.service.spec.ts`

**Interfaces:**
- Consumes: `SumsubTxnDetail.raw`(Task 1)。
- Produces: 每个 `primeTxn.detail` 带近真 `getTxn` 报文,存证/展示可演。

- [ ] **Step 1: detail 补全报文字段**

`scenarios.ts` 每个 `primeTxn.detail` 补:
```ts
scoringResult: {
  score: <与 riskScore 一致>,
  matchedRules: [{ id: 'AML1', name: 'Sanctions match', action: 'reject', score: <n> }],
  applicantActions: [],
},
review: { reviewResult: { reviewAnswer: 'RED', moderationComment: '...' } },
raw: { /* 同上字段拼成的整体报文对象,含 typedTags/scoringResult/review;crypto 场景加 travelRuleInfo:{status:'completed'} */ },
```
PEP(S4 awaitUser)`matchedRules[].name='PEP match'`、`action:'awaitUser'`。

- [ ] **Step 2: runner 透传 raw(如需)**

`demo-scenario.service.ts` `mockClient.primeTxn(mintedId, { ...step.primeTxn.detail, txnId: mintedId })` 已 spread 全字段,`raw` 自动带上。确认无需额外改;若 raw 里也有 txnId 需同步 mint,补 `raw: {...detail.raw, id: mintedId}`。

- [ ] **Step 3: 单测不回归 + commit**

Run: `npx jest src/modules/deposit-sumsub`
Expected: 全绿(37+ 例)。commit:
```bash
git commit -am "test(deposit): fixtures 补近真 getTxn 全报文(scoringResult/review/raw),存证可演"
```

---

### Task 6: 详情页展示改造(状态文案 / L2 / References / Transaction Detail / Internal Approvals / 删 ACTIONS / 删横幅)

**Files:**
- Modify: `admin-web/src/utils/depositStatusMap.ts:49-50,111-112`
- Modify: `admin-web/src/pages/DepositTransactionDetail.tsx`(多处)
- (可选)`admin-web/src/utils/depositActionMap.ts`(若 `getDepositActionsForStatus` 随 ACTIONS 删而不再引用)

**Interfaces:**
- Consumes: `findOneForAdmin` 的 `financeDetail`/`travelRuleDetail`/`approvals`(Task 4);`financeStatus`/`financeRiskScore`(Task 3)。

- [ ] **Step 1: 状态文案改名**

`depositStatusMap.ts`:
```ts
PAYIN_PENDING:      { label: 'PAYIN PENDING',      group: 'IN_PROGRESS', badgeClass: NEUTRAL },
COMPLIANCE_PENDING: { label: 'COMPLIANCE PENDING', group: 'IN_PROGRESS', badgeClass: NEUTRAL },
```
筛选(:111-112):`'Payin pending'` / `'Compliance pending'`。

- [ ] **Step 2: L2 Finance/TR 行**

L2 卡:Finance 行显示 `financeStatus` + `Risk: {financeRiskScore ?? '—'}`;TR 行**二元**——`travelRuleRequired ? travelRuleStatus : 'NOT REQUIRED'`,只映射 PASSED/PENDING/FAILED/NOT REQUIRED,不显 13 值(现状已是二元,确认不引 `travelRuleInfo`)。

- [ ] **Step 3: References 三件套 + 删 Manual Reason / Latest Webhook 卡**

Sumsub References 卡改为:`Applicant ID` 单列 + 两组三件套(Finance Txn ID / status / Received At、TR Txn ID / status / Received At)。status/ReceivedAt 取自 `latestSumsubWebhook`(G4)按腿。**删** Manual Reason 字段、**删** G4 的 "Latest Sumsub Webhook" 独立卡。

- [ ] **Step 4: Transaction Detail 块(订单下方)**

新增 DetailCard「Sumsub Transaction Detail」,渲染 `data.financeDetail`(+ crypto 时 `travelRuleDetail`):Score / Verdict / reviewAnswer / Matched rules 列表(name·action·score)/ Applicant Action IDs / `<details>` 折叠原文(`JSON.stringify(financeDetail.raw, null, 2)`)。

- [ ] **Step 5: Internal Approvals 块(订单下方)**

新增 DetailCard「Internal Approvals」,遍历 `data.approvals`:一行 = 动作名(`ACTION_LABELS[actionType]`:上缴/退回/解冻/没收 → 英文 Seize/Return/Unfreeze/Confiscate)+ `approvalNo` + 状态徽章 + `createdAt`,可点进审批中心。空态 `No internal approvals`。

- [ ] **Step 6: 删大 ACTIONS 块 + 删横幅**

删 `DepositTransactionDetail.tsx:707` 与 :733 的 `<SidebarGroup title="Actions">` 两处通用组 + `getDepositActionsForStatus`/`actions` 引用(:417)。删 `lastApprovalNo` 横幅(:166 state + :470 渲染)。逐状态核对:FROZEN 的 Seize/Unfreeze、below-min 的 PASS/Confiscate、Simulation 面板仍在,无动作失去唯一入口。

- [ ] **Step 7: admin tsc + commit**

Run: `cd admin-web && npx tsc --noEmit && cd ..` → 0
```bash
git commit -am "feat(admin): 充值详情 Sumsub 报文展示 + 内部审批单 + 状态文案/References 重排 + 删大 ACTIONS 与刷新即丢横幅"
```

---

### Task 7: 端到端渲染验证 + 客户面回归 + 文档同步

**Files:**
- Modify: `doc-final/reference/truth/funds-orders.md`(或 deposit 相关 truth 段:存证列 + 详情页字段)
- Modify: `doc-final/BACKLOG.md`(结清「approval banner lost on refresh」+「客户面下发原始状态枚举」若相关)

- [ ] **Step 1: 全量硬闸**

Run: `npx tsc --noEmit -p tsconfig.json` → 0
Run: `cd admin-web && npx tsc --noEmit && cd ..` → 0
Run: `npx jest` → 仅 `asset-treasury/wallets` 4 例 pre-existing 失败,净新增 0。

- [ ] **Step 2: 起服务 + mock 喂场景 + 截图**

Run: `bash scripts/stack.sh up`(worktree self 栈)
建两笔单(客户端 inbound-signal + scan → COMPLIANCE_PENDING),分别喂 `S1_HAPPY_FIAT` / `S3_SANCTIONS`(demo 端点),截图比对:
- 状态徽章 `PAYIN PENDING` / `COMPLIANCE PENDING`
- L2 Finance(score)+ TR 二元
- References 三件套(无 Manual Reason、无独立 webhook 卡)
- 订单下方 Transaction Detail(score + matchedRules + 折叠原文)
- **Internal Approvals**:对 S3 单发起一次 seize 或 unfreeze 审批 → 该块列出审批单头;刷新页面仍在(非 local state)
- 大 ACTIONS 块已消失

- [ ] **Step 3: 客户面不泄露断言**

`curl` Alice 的 `GET /deposit-transactions/my` → 断言响应无 `financeTxnDetailJson`/`travelRuleTxnDetailJson`/对手方 PII(F9 白名单回归)。

- [ ] **Step 4: 文档同步 + commit**

同步 truth(存证列 + 详情页展示子集 + 审批反查现状);BACKLOG 结清「approval banner lost on refresh」。
```bash
git commit -am "docs(truth+backlog): 同步 Sumsub 报文存证/详情展示/审批反查现状,结清审批横幅债"
```

---

## 自查(写完计划回看 spec)

- **spec 覆盖**:§1.1 存证列→Task1;§1.2 改名→Task3;§2.1/2.2 存证+approved→Task2;§2.3 findOneForAdmin→Task4;§3.1~3.5 前端→Task6;§3.4b 审批→Task4(后端)+Task6(前端);§4 fixtures→Task5;§5 验证→Task7。**全覆盖**。
- **类型一致**:`saveTxnDetail(id,lane,json)`、`applyKytVerdict(...,detailRaw)`、`updateFinanceStatus`、`findOneForAdmin` 追加 `financeDetail/travelRuleDetail/approvals` — 各 task 命名一致。
- **顺序依赖**:Task1(列+raw)→ Task2(存库)→ Task4(读库);Task3(改名)可与 Task2 并,但 Task4/6 读 `financeStatus` 依赖 Task3 → Task3 应在 Task4 前。Task5 依赖 Task1 的 raw。Task6 依赖 Task3+Task4。Task7 收尾。**建议顺序:1 → 3 → 2 → 4 → 5 → 6 → 7**(改名先落,避免 Task2/4 写旧名再改)。
