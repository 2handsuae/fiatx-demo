# 波二 · 报价单收口 + 交易域单号统一 · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交易域四处单号统一为三字母前缀（WDR/FDO/WQT/SQT），报价单六问题收口（审计三码 / UUID 清屏 / 互链 / 死路由 / 取消对齐 / TTL 300）。

**Spec:** `doc-final/superpowers/specs/2026-09-09-wave2-quote-and-refno-spec.md`（业主四岔口拍板见其 §1，锚点已全部现场复现）

**Architecture:** 纯收口波——不改状态机、不动钱、不加新端点；后端改 6 个生成/分流点 + 报价服务补审计，前端换键与清屏，schema 一列转必填。数据重铺零兼容层。

**Tech Stack:** NestJS + Prisma(SQLite) ｜ React (admin-web / client-web) ｜ jest / vitest

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用
- 本轮特有：零兼容层零 backfill（改完=reset 重铺）｜ 不动兑换 30s TTL ｜ 不动 `CU`/`WA`/`AS`/`DEP`/`SWP` 前缀 ｜ 三域订单详情路由换键是波五的活，本波只动**报价**路由 ｜ 中文注释可留（清失真不清中文）｜ 审计写入必带显式 `requestId`
- 执行环境：worktree（`.claude/worktrees/` 下，树名连字符会被 stack.sh 归一为下划线）+ 自动分栈；跑 jest 前 `export DATABASE_URL="file:/tmp/exchange_js_wt_<树名>/dev.db"`（TOOLING-DEBT 在案）；jest 必须在 `Exchange_js/` 根下跑、不接管道尾
- 模型分层（项目 CLAUDE.md §6）：Task 1–9 执行与任务级评审 → `sonnet`；终审 → **Fable**（派发省略 model 字段走继承）；派 subagent 的 prompt 一律带项目总纲 §0–§5 要点
- 随手闸（每 task 收尾必跑，命令见项目 CLAUDE.md §7）：后端 task 跑 ①+相关 jest；admin-web task 加 ②；client-web task 加 ③+`npm run test:client`

---

### Task 1: 后端前缀换装（WDR / FDO / SQT + 分流 + 注释 + 夹具）

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts:677`
- Modify: `src/modules/funds-orders/funds-order.service.ts:58`
- Modify: `src/modules/trading/swap-fee-level/swap-quote.service.ts:482`
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts:795`
- Modify: `src/modules/clearing-settle/reconciliation/disposition/adjustment.service.ts:370`（注释例号）
- Modify: `scripts/demo-lib.ts:1029`、`scripts/demo-fixtures.ts:169`（注释：前缀 + 「4 位随机」失真订正为 6 位）
- Modify: `src/modules/audit-logging/audit-logs.service.spec.ts`、`src/modules/clearing-settle/reconciliation/disposition/adjustment.service.spec.ts`、`src/modules/trading/withdraw-transactions/withdraw-applicant-actions.service.spec.ts`（夹具字面）

**Interfaces:**
- Produces: 提现单号 `WDR…`、资金单号 `FDO…`、兑换报价号 `SQT…`（后续 task 与 demo 判据都吃这个格式）

- [ ] **Step 1: 执行前重扫（spec §3 判例，防脑暴后新增命中）**

```bash
grep -rEn "startsWith\('(WD|FO|QUO|WQ)|'(WD|FO|QUO)'|\b(WD|FO|QUO|WQ)2[56][0-9]{4}|WQ-" src/ scripts/ admin-web/src/ client-web/src/ prisma/ --include="*.ts" --include="*.tsx"
```

Expected: 命中集合 ⊆ 本 task Files 清单 + `withdraw-quote.service.ts:120`（Task 2 的）。多出命中 → 先回报再动手。

- [ ] **Step 2: 三个生成点换前缀**

`withdraw-workflow.service.ts:677`：`generateReferenceNo('WD')` → `generateReferenceNo('WDR')`
`funds-order.service.ts:58`：`generateReferenceNo('FO')` → `generateReferenceNo('FDO')`
`swap-quote.service.ts:482`：`generateReferenceNo('QUO')` → `generateReferenceNo('SQT')`

- [ ] **Step 3: recon 分流与注释换装**

`reconciliation-query.service.ts:795`：`no.startsWith('WD')` → `no.startsWith('WDR')`（同函数 `'DEP'` 分支不动）
`adjustment.service.ts:370` 注释例号 `WD-E2E-ADJ-C2-0001` → `WDR-E2E-ADJ-C2-0001`
`scripts/demo-lib.ts:1029`、`scripts/demo-fixtures.ts:169`：`'WD'` 提法改 `'WDR'`，且两处「只用 4 位随机」说法订正为「6 位随机（2026-09-01 起）」，撞号概率描述随之删或改（只改注释不改代码）

- [ ] **Step 4: 夹具字面换新前缀**

三个 spec 文件里 `WD26…` → `WDR26…`、`QUO26…` → `SQT26…`（纯字面替换，值自洽即可，不改断言逻辑）。

- [ ] **Step 5: 闸门**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/modules/trading src/modules/funds-orders src/modules/audit-logging src/modules/clearing-settle/reconciliation
```

Expected: tsc 0 错；jest 全绿。

- [ ] **Step 6: Commit** `git commit -m "refactor(波二): 单号前缀换装 WD→WDR / FO→FDO / QUO→SQT（生成点+分流+注释+夹具）"`

**收尾过哪几条**：改 schema ✗｜前端 ✗｜其余见 Global。

---

### Task 2: 提现报价归一生成器（WQT）+ TTL 300（TDD）

**Files:**
- Modify: `src/modules/trading/withdrawal-fee-level/withdraw-quote.service.ts:120`
- Modify: `src/modules/trading/pricing-center/types/pricing.types.ts:151`
- Test: `src/modules/trading/withdrawal-fee-level/withdraw-quote.service.spec.ts`

**Interfaces:**
- Produces: `createQuote()` 返回的 `quoteNo` 匹配 `/^WQT\d{12}$/`；报价有效期 300s（Task 6 取消守卫、Task 9 审计抽查都吃它）

- [ ] **Step 1: 写失败测试**（加进现有 spec，TestBed 复用文件内既有 provider 结构）

```typescript
it('generates quoteNo via unified generator with WQT prefix', async () => {
  const quote = await service.createQuote(validInput); // validInput 复用文件内既有造数
  expect(quote.quoteNo).toMatch(/^WQT\d{12}$/); // WQT + yyMMdd + 6位随机
});

it('quote expires 300 seconds after creation', async () => {
  const quote = await service.createQuote(validInput);
  expect(quote.expiresAt.getTime() - quote.createdAt.getTime()).toBe(300_000);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest src/modules/trading/withdrawal-fee-level/withdraw-quote.service.spec.ts
```

Expected: FAIL——quoteNo 是 `WQ-…` 格式、时差 30_000。

- [ ] **Step 3: 实现**

`withdraw-quote.service.ts:120`：

```typescript
// 删：const quoteNo = `WQ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const quoteNo = generateReferenceNo('WQT');
```

顶部补 `import { generateReferenceNo } from '../../../common/utils/no-generator.util';`（相对层级以 tsc 为准）。
`pricing.types.ts:151`：`WITHDRAW_QUOTE_TTL_SECONDS = 30` → `= 300`。

- [ ] **Step 4: 客户端写死 30 排查**

```bash
grep -rn "30" client-web/src/pages/Withdraw.tsx | grep -i "second\|expir\|ttl\|countdown"
```

Expected: 零命中（客户端用响应里的 `expiresAt`）。有命中则随常量改。

- [ ] **Step 5: 跑测试通过 + tsc ①** → Expected: PASS / 0 错。

- [ ] **Step 6: Commit** `git commit -m "feat(波二): 提现报价归一生成器 WQT + TTL 30→300s（业主拍板：费用快照非汇率锁）"`

**收尾过哪几条**：前端行为未变（TTL 体感变化在 Task 9 截图佐证）。

---

### Task 3: SwapQuote.quoteNo 必填 + 迁移

**Files:**
- Modify: `prisma/schema.prisma:975`
- Create: `prisma/migrations/<时间戳>_wave2_swap_quote_no_required/migration.sql`（migrate dev 自动生成）

- [ ] **Step 1: schema 改必填**：`quoteNo String? @unique` → `quoteNo String @unique`（SwapQuote 模型；`SwapTransaction.quoteId/quoteNo` 可空**不动**——spec §2-A）

- [ ] **Step 2: 生成迁移 + client**

```bash
DATABASE_URL="file:/tmp/exchange_js_wt_<树名>/dev.db" npx prisma migrate dev --name wave2_swap_quote_no_required
npm run prisma:generate
```

Expected: 迁移生成（SQLite 走表重建）；空库能建。**不写 backfill**——重铺解决。

- [ ] **Step 3: 确认唯一写入路径已带号**：`grep -n "swapQuote.create" src/ -r` → 仅 `swap-quote.service.ts` 创建处（Task 1 后恒为 `generateReferenceNo('SQT')`），必填成立。

- [ ] **Step 4: 闸门**：tsc ① + `npx jest src/modules/trading/swap-fee-level` → 全绿。

- [ ] **Step 5: Commit** `git commit -m "feat(波二): SwapQuote.quoteNo 转必填（迁移，零兼容层）"`

**收尾过哪几条**：改 schema → 新增迁移 ✓（重铺闸在 Task 9）。

---

### Task 4: 提现报价审计三码（TDD）

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（扁平键、V5 名册 `:793` 段、`AuditEntityTypes` `:60` 旁、主体路由映射 `:13` 旁）
- Modify: `src/modules/trading/withdrawal-fee-level/withdraw-quote.service.ts`（`createQuote` `:99` / `consumeQuote` `:175` / `cancelQuote` `:198` 三落点 + 构造器注入 AuditLogsService）
- Modify: `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level.module.ts`（如需 import AuditLogging 模块，照 swap-fee-level 模块写法）
- Test: `src/modules/trading/withdrawal-fee-level/withdraw-quote.service.spec.ts`

**Interfaces:**
- Consumes: Task 2 的 `WQT…` 号（入 requestId 与 subjectNo）
- Produces: `AuditActions.WITHDRAW_QUOTE_{CREATED,USED,CANCELLED}`、`AuditEntityTypes.WITHDRAW_QUOTE`、路由映射 `WITHDRAW_QUOTES: 'trading/withdraw-quotes'`（Task 9 审计抽查按此拉链）

- [ ] **Step 1: 写失败测试**（spec 现无 audit mock——TestBed 新增 `AuditLogsService` mock provider `{ recordByActor: jest.fn() }`）

```typescript
it('writes WITHDRAW_QUOTE_CREATED with explicit requestId on create', async () => {
  const quote = await service.createQuote(validInput);
  expect(auditMock.recordByActor).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'WITHDRAW_QUOTE_CREATED',
      primarySubjectNo: quote.quoteNo,
      requestId: expect.stringContaining(`WITHDRAW_QUOTE_CREATED_${quote.quoteNo}`),
    }),
    expect.anything(),
  );
});
// 同型再写两条：consumeQuote → WITHDRAW_QUOTE_USED；cancelQuote → WITHDRAW_QUOTE_CANCELLED
```

- [ ] **Step 2: 跑测试确认失败** → FAIL（构造器无此依赖 / 零调用）。

- [ ] **Step 3: 名册登记（四属性出生即冻结，assertActionSpec 校验）**

扁平对象加三键；`V5_WITHDRAW_AUDIT_ACTIONS`（`:793` 段末）加三条，逐字段照 `:875-877` SWAP_QUOTE 三条对称：

```typescript
WITHDRAW_QUOTE_CREATED:   { domain: 'WITHDRAW', correlationMode: N, requiredFields: [], requiresCausation: false },
WITHDRAW_QUOTE_USED:      { domain: 'WITHDRAW', correlationMode: N, requiredFields: [], requiresCausation: false },
WITHDRAW_QUOTE_CANCELLED: { domain: 'WITHDRAW', correlationMode: N, requiredFields: [], requiresCausation: false },
```

`AuditEntityTypes` 加 `WITHDRAW_QUOTE: 'WITHDRAW_QUOTE'`；主体路由映射在 `SWAP_QUOTES` 行旁加 `WITHDRAW_QUOTES: 'trading/withdraw-quotes'`。

- [ ] **Step 4: 三落点写入**——逐字段照 `swap-quote.service.ts:247-268`（CREATED）/`:320-`（USED）/`:368-`（CANCELLED）对称，SWAP→WITHDRAW、`actionDomain: 'WITHDRAW'`、`reason` 写 `'Withdrawal quote created/used/cancelled'`。CREATED 落 `createQuote` create 之后；USED 落 `consumeQuote` update 之后（方法有 `tx` 参数，审计用注入的 service 照常写，不进事务——与 swap 侧同律，演示系统不做事务兜底）；CANCELLED 落 `cancelQuote` update 之后。actor 块照 swap `:265-268`（ownerType 映射 actorType）。`randomUUID` 从 `'crypto'` 导入。

- [ ] **Step 5: 跑测试通过 + 全量相关闸**

```bash
npx jest src/modules/trading/withdrawal-fee-level src/modules/audit-logging
npx tsc --noEmit -p tsconfig.json
```

Expected: 全绿（audit-logging 里若有「名册键数」守则测试红了→按实数更新断言，那是名册计数断言不是行为断言）。

- [ ] **Step 6: Commit** `git commit -m "feat(波二): 提现报价审计三码 CREATED/USED/CANCELLED（对齐兑换侧，V5 名册 30→33）"`

**收尾过哪几条**：持久状态变化写审计 ✓（显式 requestId）｜新增审计码四属性冻结 ✓。

---

### Task 5: 管理台报价换键（端点 + rbac + 路由二合一 + 列表 + 详情页）

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-transactions.controller.ts:62`（`@Get('quotes/:id')`）及其 service 查询
- Modify: `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level.controller.ts:101-103`（`findOneQuote`）及其 service 查询
- Modify: `src/modules/identity/access-control/rbac.catalog.ts:377,567`
- Modify: `admin-web/src/App.tsx:211-215`
- Modify: `admin-web/src/pages/WithdrawQuoteList.tsx:247`、`admin-web/src/pages/SwapQuoteList.tsx:250`
- Modify: `admin-web/src/pages/WithdrawQuoteDetail.tsx:73,84区域`、`admin-web/src/pages/SwapQuoteDetail.tsx:83,95`

**Interfaces:**
- Produces: 管理台报价详情路由终态 `trading/withdraw-quotes/:quoteNo`、`trading/swap-quotes/:quoteNo`；端点 `GET admin/swap-transactions/quotes/:quoteNo`、`GET admin/withdrawal-fee-levels/quotes/:quoteNo`（Task 7 互链吃这个路由形）

- [ ] **Step 1: 后端两端点换键**——路由参数 `:id`→`:quoteNo`，service 查询 `where: { id }` → `where: { quoteNo }`（Prisma unique 直查；找不到照旧 NotFound）。
- [ ] **Step 2: rbac.catalog `:377,567` 路径串 `quotes/:id` → `quotes/:quoteNo`**（描述不动）。
- [ ] **Step 3: 前端路由二合一**

```tsx
<Route path="trading/withdraw-quotes/:quoteNo" element={withPermission(<WithdrawQuoteDetail />, [PERMISSIONS.WITHDRAW_QUOTES_DETAIL_READ])} />
<Route path="trading/swap-quotes/:quoteNo" element={withPermission(<SwapQuoteDetail />, [PERMISSIONS.SWAP_QUOTES_DETAIL_READ])} />
```

（`:214` 与 `:215` 两条并一条；`:business/:id` 死参数路由删除。）

- [ ] **Step 4: 列表跳转与详情页取参**——`WithdrawQuoteList.tsx:247` navigate `` `/admin/trading/withdraw-quotes/${item.quoteNo}` ``；`SwapQuoteList.tsx:250` navigate `` `/admin/trading/swap-quotes/${item.quoteNo}` ``；两详情页 `useParams<{ quoteNo: string }>()`，fetch URL 里 `${id}`→`${quoteNo}`。
- [ ] **Step 5: 判据脚本排查**

```bash
grep -n "quotes/:id\|swap-quotes/SWAP\|quotes/" scripts/verify-rbac.ts scripts/verify-act1.ts
```

Expected: 零命中旧路径形态；有则同步改。

- [ ] **Step 6: 闸门**：tsc ①② + `npx jest src/modules/trading/swap-transactions src/modules/trading/withdrawal-fee-level` → 全绿。
- [ ] **Step 7: Commit** `git commit -m "refactor(波二): 报价详情全量换业务号（端点+rbac+死路由二合一+列表+详情页）"`

**收尾过哪几条**：对外识别用业务键 ✓｜admin 端点路径变更 → 合并后 `db:base:sync`+重启（记入收尾清单）｜前端改动 → 截图在 Task 9。

---

### Task 6: 客户端收口（取消对齐 + 两页 quoteNo 显示 + 兑换响应补字段）

**Files:**
- Modify: `client-web/src/pages/Withdraw.tsx`（确认框关闭 `:1065` 区域 + `:841`）
- Modify: `client-web/src/pages/Swap.tsx:1049`（+ `FirmQuoteResult` 接口 `:84`）
- Modify: `src/modules/trading/swap-fee-level/swap-quote.service.ts`（firm 报价响应映射补 `quoteNo`——客户接口现无此字段，grep 响应构造处确认后补 `quoteNo: created.quoteNo`）

**Interfaces:**
- Consumes: Task 2 的 300s TTL 与 `WQT…` 号；已有端点 `POST withdraw-transactions/quotes/:id/cancel`（`withdraw-quote-customer.controller.ts:82`，载荷继续用 quoteId——铁律⑥管屏与链接，不管载荷）

- [ ] **Step 1: Withdraw 确认框关闭改走取消**——新增 handler 照 `Swap.tsx:470-486` `handleCloseConfirm`：

```typescript
const handleCloseConfirm = async () => {
  if (quote && new Date(quote.expiresAt).getTime() > Date.now()) {
    try {
      await customerFetch(`${import.meta.env.VITE_API_URL}/withdraw-transactions/quotes/${quote.quoteId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
    } catch (error) {
      if (error instanceof CustomerSessionError) return;
      console.error('Quote cancel failed', error);
    }
  }
  clearQuoteState();
};
```

确认框 Cancel 按钮（`:1065` `onClick={clearQuoteState}`）与遮罩关闭改指 `handleCloseConfirm`；提交成功路径继续走 `clearQuoteState`（已消费的报价不能取消）。

- [ ] **Step 2: 两页 UUID 显示换号**——`Withdraw.tsx:841` `Quote: {quote.quoteId}` → `{quote.quoteNo}`；`Swap.tsx:1049` 标签 `Quote ID`→`Quote No`、值 `{firmQuote.quoteId}`→`{firmQuote.quoteNo}`；`FirmQuoteResult` 接口加 `quoteNo: string;`；后端 firm 响应映射补 `quoteNo`。
- [ ] **Step 3: 闸门**

```bash
npx tsc --noEmit -p tsconfig.json
cd client-web && npx tsc -b --noEmit && cd ..
npm run test:client
```

Expected: 全绿。

- [ ] **Step 4: Commit** `git commit -m "feat(波二): 提现确认框关闭即取消报价（对齐兑换）+ 客户端两页报价号换 UUID"`

**收尾过哪几条**：新增业务动作前端有入口 ✓（关闭即取消）｜客户面新展示 = 客户自己的报价号，无 tipping-off 面 ✓｜截图在 Task 9。

---

### Task 7: 订单↔报价互链（管理台两订单详情）

**Files:**
- Modify: `admin-web/src/pages/SwapTransactionDetail.tsx:441-442`
- Modify: `admin-web/src/pages/WithdrawTransactionDetail.tsx`（新增 Pricing Quote 卡 + 数据接口）
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts:566-573`（`findOne` include）

**Interfaces:**
- Consumes: Task 5 的路由形 `/admin/trading/{withdraw,swap}-quotes/:quoteNo`

- [ ] **Step 1: 兑换详情**——`:442` "Quote ID" 行整删；`:441` Quote No 改链接（照列表页 `rowKeyLink` 按钮模式）：

```tsx
<InfoField label="Quote No" value={
  data.quoteNo ? (
    <button type="button" className={adminButtonClass('rowKeyLink')}
      onClick={() => navigate(`/admin/trading/swap-quotes/${data.quoteNo}`)}>
      {data.quoteNo}
    </button>
  ) : '—'
} mono />
```

（`InfoField` 若只收 string，按该文件既有的链接式字段先例处理；无先例则值区直接渲染按钮——与 frontend-admin 规约一致即可。）

- [ ] **Step 2: 后端提现详情带出报价**——`findOne` include 加 `pricingQuote: true`。
- [ ] **Step 3: 提现详情新增卡**——数据接口加 `pricingQuote: { quoteNo: string; matchedTierName: string; feeLevelCode: string | null; totalsJson: string; createdAt: string } | null`；模块区新增：

```tsx
{data.pricingQuote && (
  <DetailCard title="Pricing Quote" columns={2}>
    <InfoField label="Quote No" value={/* 同 Step 1 链接模式 → /admin/trading/withdraw-quotes/${...quoteNo} */} mono />
    <InfoField label="Fee Level / Tier" value={`${data.pricingQuote.feeLevelCode ?? '—'} / ${data.pricingQuote.matchedTierName}`} />
    <InfoField label="Fee Total" value={Object.entries(JSON.parse(data.pricingQuote.totalsJson || '{}')).map(([c, v]) => `${v} ${c}`).join(' + ') || '—'} />
    <InfoField label="Quoted At" value={data.pricingQuote.createdAt} />
  </DetailCard>
)}
```

（时间格式与卡位次序照该页既有卡的写法；只放摘要四样，不铺 feeBreakdown——业主拍板 §1-4。）

- [ ] **Step 4: 闸门**：tsc ①②。
- [ ] **Step 5: Commit** `git commit -m "feat(波二): 订单↔报价互链——提现详情报价摘要卡 + 兑换详情报价号链接、删 UUID 行"`

**收尾过哪几条**：对外识别业务键 ✓｜前端改动 → 截图在 Task 9。

---

### Task 8: 文档同步 + 收尾账目

**Files:**
- Modify: `doc-final/modules/v5-withdraw.md`（`:64` 码数 30→33 + 新增报价生命周期段）
- Modify: `doc-final/modules/v6-swap.md`（§5 锚点如提及 QUO 随 SQT 更新，执行时 grep）
- Modify: `doc-final/demo/script.md:108,139`、`doc-final/demo/data.md:75`
- Modify: `doc-final/BACKLOG.md`、`doc-final/decisions.md`

- [ ] **Step 1: v5 真相补录**——报价生命周期一段（创建→消费/取消/300s 懒过期；三码 `WITHDRAW_QUOTE_{CREATED,USED,CANCELLED}`；锚点 `withdrawal-fee-level/withdraw-quote.service.ts`；客户端确认框关闭即取消），§5 实现锚点同步；`:64` 码数 25→30 处已是 30，本波改 33（以名册实数为准）。
- [ ] **Step 2: 剧本与数据**——`script.md:108` 徽标 `WD…`→`WDR…`；`:139` 码数 47/30/22→47/33/22；`data.md:75` 单号例 `WD…`→`WDR…`（`DEP…`/`SWP…` 不动）。
- [ ] **Step 3: 账目**——BACKLOG 销 F3（提现报价零审计）+ 零消费端点第 3 条（取消端点已接消费方），移「本轮销账」节附证据；decisions.md 登记 spec §1 五条拍板；三域对称答卷已在 spec §2-C，不另立。改到的文档 Last Verified 更新。
- [ ] **Step 4: Commit** `git commit -m "docs(波二): v5 报价真相补录+码数 33+剧本前缀同步+BACKLOG 销 2+decisions 五拍板"`

**收尾过哪几条**：改页面同步 demo 文档 ✓｜每轮收尾文档分层 ✓（CHANGELOG 留合并后）。

---

### Task 9: 收尾闸——重铺 + demo:all + 第七幕审计抽查 + 六组截图

**Files:** 无代码改动（发现问题回改则从相应 task 闸门重跑）

- [ ] **Step 1: 重铺闸（worktree 内 self 栈）**

```bash
bash scripts/stack.sh reset self
bash scripts/stack.sh up
bash scripts/on-stack.sh self demo:all
```

Expected: 判据对照 `demo/baseline.md` **全绿**；花名册单号可见 `WDR…`/`FDO…`。**判红先按总纲 §4 取证姿势抓现场再 reset**（swap 腿自愈悬案在案）。

- [ ] **Step 2: 第七幕审计抽查（新号拉链）**——客户端造两条路：① 发起提现拿报价→确认框点 Cancel（→ CANCELLED）；② 正常提交一笔提现（→ USED；demo:all 已天然覆盖 CREATED/USED）。管理台审计页按 `WQT…` 号查：三码齐、主体链接可点进报价详情。
- [ ] **Step 3: 六组 preview 截图**（tsc 不算数——两条永不豁免①）：两报价列表（跳转走业务号）｜两报价详情（URL 是 quoteNo）｜提现订单详情（Pricing Quote 卡）｜兑换订单详情（Quote No 链接、无 Quote ID 行）｜客户端 Withdraw 确认框（Quote 行显示 WQT 号）｜客户端 Swap 确认框（Quote No 显示 SQT 号）。截图落盘用 `scripts/demo-shot.js` 惯例。
- [ ] **Step 4: 全量相关 jest 终跑**（Exchange_js 根下、带 DATABASE_URL、不接管道）：Task 1-5 涉及目录一次跑齐 → 全绿。

**收尾过哪几条**：重铺闸 ✓（schema+号规）｜前端截图 ✓｜verify:coa 不触发（未动钱）。

---

## 终审与合并（主会话执行，不入 task 派发）

1. **终审 → Fable（省略 model 字段）**：按「每条承诺找代码」判例——spec §2 A–F 逐条问代码在哪，特别盯：三码 requestId 显式性、名册四属性、旧前缀残留（重跑 spec §3 三形态 grep 于最终 HEAD）、`swap-quotes/:business` 零残留
2. 合并（照 `superpowers:finishing-a-development-branch`）：main 快进，清 worktree+分支
3. **合并后必做**：重启后端 + `npm run db:base:sync`（rbac 路径变更）→ `rm -f /tmp/exchange_js_main/dev.db` + `bash scripts/stack.sh reset main`（schema+号规变更）→ `bash scripts/on-stack.sh main demo:all` 复绿
4. **立波三骨架 + 写承接**：`specs/2026-09-09-wave3-red-fixes-skeleton.md`（总纲链接/空承接节/已定事实/待定岔口），把本波实际偏差与新事实写进承接节；**不展开波三 spec**
5. CHANGELOG 一行；`Documentation updated:` 汇报行
