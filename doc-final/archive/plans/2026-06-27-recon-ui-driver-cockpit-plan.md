# Recon UI 主驾驶台重排 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps use checkbox (`- [ ]`) syntax.

**Goal:** 按 spec `2026-06-27-recon-ui-driver-cockpit-redesign.md` 重排 Run 详情、Case 详情、Cases 列表三页 + 调整 case 模型为 (walletRef, businessDate) 幂等。Run 详情成为 ops 主入口，看到全部账户健康度；Case 详情成为只读调查台，余额 + 流水比对一目了然。

**Architecture:**
- 后端先（T1-T3）：调 Case schema 加字段 + WalletReconRunService.run 改 upsert 幂等 + 自愈检测；endpoint 返回 accountStatusTable / flowComparison / aging。
- 前端跟（T4-T6）：Run 详情 / Case 详情 / Cases 列表三页改造，按现有 admin UI 风格。
- e2e（T7）：recon:demo:break 跑 → 截图 4 页 → 同账号重跑 3 次验证幂等 → 自愈验证。

**Tech Stack:** NestJS + Prisma(SQLite) + React admin-web。

---

### Task 1: Case schema + 幂等约束

**Files:**
- Modify: `Exchange_js/prisma/schema.prisma`（`ReconciliationCase`）
- Create: `Exchange_js/prisma/migrations/<ts>_case_idempotent_fields/migration.sql`

- [ ] **Step 1: 加 4 个新字段**

```prisma
model ReconciliationCase {
  // existing...
  firstSeenRunId       String?
  lastUpdatedRunId     String?
  resolvedAt           DateTime?
  resolutionReason     String?    // 'AUTO_HEALED' | 'MANUAL_RESOLVED' | 'WAIVED'
  severity             String?    // 'HIGH' | 'MEDIUM' | 'LOW'
  @@index([walletRef, businessDate, status])
}
```

- [ ] **Step 2: db push 到 main DB + 写迁移文件**

```bash
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" npx prisma db push
```
迁移文件 `prisma/migrations/<ts>_case_idempotent_fields/migration.sql`：`ALTER TABLE reconciliation_cases ADD COLUMN ...` x4 + 1 复合索引。

- [ ] **Step 3: build + verify:coa**

```bash
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" TB_ADDRESS=127.0.0.1:3003 npm --prefix /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js run build
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" TB_ADDRESS=127.0.0.1:3003 npm --prefix /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js run verify:coa
```
Expected: build 绿；verify:coa ALL PASS。

- [ ] **Step 4: 提交**

```bash
git -C /Users/songshengwei/Documents/codex/projects/重做版 add Exchange_js/prisma/schema.prisma Exchange_js/prisma/migrations/
git -C /Users/songshengwei/Documents/codex/projects/重做版 commit -m "feat(recon): T1 case schema — firstSeenRun/lastUpdatedRun/resolvedAt/severity"
```

---

### Task 2: WalletReconRunService.run 改 (walletRef, businessDate) 幂等 upsert + 自愈

**Files:**
- Modify: `Exchange_js/src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts`
- Modify: `Exchange_js/src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.spec.ts`

判定规则（service 层兜底，DB 层未来 Phase C 加 partial unique index）：
- upsert by `(walletRef, businessDate)`：找 OPEN case；存在 → 更新 snapshot（delta/lineItems/lastUpdatedRunId/severity）；不存在 → 建（含 firstSeenRunId/lastUpdatedRunId 同设）
- 自愈：本次 Run 跑完后，扫所有 `status=OPEN AND businessDate=本日 AND walletRef NOT IN 本次异常集` 的 case → 自动 set `status=RESOLVED, resolutionReason='AUTO_HEALED', resolvedAt=NOW(), lastUpdatedRunId=本 runId`
- severity 阈值（hard-code 本版）：`abs(deltaAmount) >= 10000 → HIGH`、`>= 100 → MEDIUM`、else `LOW`

- [ ] **Step 1: 重写 openCaseForWallet → upsertCaseForWallet**

```ts
async upsertCaseForWallet(input: {
  runId: string;
  businessDate: Date;
  walletRef: string;
  ownerNo: string | null;
  coaCode: string;
  delta: bigint;
  lineItems: LineItemInput[];
  asset: string;
  book: 'CLIENT' | 'FIRM' | 'XREF';
}, tx?: Prisma.TransactionClient): Promise<{ caseId: string; created: boolean }>;
```
逻辑：findFirst { walletRef, businessDate, status: 'OPEN' }；存在则 update snapshot + lastUpdatedRunId；不存在则 create with firstSeenRunId=lastUpdatedRunId=runId。两路径都计算 severity。

- [ ] **Step 2: 加 autoHealCases(runId, businessDate, currentBreakingWallets) helper**

```ts
async autoHealCases(runId: string, businessDate: Date, currentBreakingWallets: Set<string>, tx?): Promise<number>;
```
找所有 status=OPEN AND businessDate=本日 AND walletRef NOT IN currentBreakingWallets → 标 RESOLVED + AUTO_HEALED；返回 close 数量供 Run summary。

- [ ] **Step 3: run() 末尾 update Run summary 字段**

补全 OPENED CASES / IN_PROGRESS / SCORE CASES（修上次 UI 显示 0 的 bug）。

- [ ] **Step 4: 单测**

`wallet-recon-run.service.spec.ts` 加 3 个用例：
- 同账户连续 3 次 break → 只 1 个 OPEN case，lastUpdatedRunId 跟到最新
- 异常账户在第二次 Run 平账 → 第一次的 case 自动 RESOLVED + AUTO_HEALED
- 跨 businessDate 同账户 → 两个独立 case

跑 `npm test --testPathPattern=wallet-recon-run`。

- [ ] **Step 5: smoke**

```bash
bash /tmp/exchange_js_main/start-stack.sh ; sleep 13
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && DATABASE_URL=... TB_ADDRESS=127.0.0.1:3003 npm run recon:demo:break
sqlite3 /tmp/exchange_js_main/dev.db "SELECT walletRef, COUNT(*) c FROM reconciliation_cases WHERE status='OPEN' GROUP BY walletRef HAVING c>1;"
# expected: empty (no walletRef has >1 OPEN case)
```

- [ ] **Step 6: 提交**

```bash
git -C /Users/songshengwei/Documents/codex/projects/重做版 add Exchange_js/src/modules/clearing-settle/reconciliation/workflow/
git -C /Users/songshengwei/Documents/codex/projects/重做版 commit -m "feat(recon): T2 wallet recon — (walletRef,businessDate) idempotent + auto-heal"
```

---

### Task 3: endpoint 返回 accountStatusTable / flowComparison / aging

**Files:**
- Modify: `Exchange_js/src/modules/clearing-settle/reconciliation/controllers/reconciliation-admin.controller.ts`
- Modify: `Exchange_js/src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts`
- Modify: `Exchange_js/src/modules/clearing-settle/reconciliation/dto/reconciliation.dto.ts`

- [ ] **Step 1: GET /admin/reconciliation/runs/:id 加 accountStatusTable + summary 字段**

`reconciliation-query.service.findOneRun(id)` 拉本 run 的所有 ExternalBalance + 关联 case + flow matcher 输出，组装 accountStatusTable per spec §7.1。

- [ ] **Step 2: GET /admin/reconciliation/cases/:id 加 flowComparison**

`findOneCase(id)` 拉本 case 的 lineItems（已有） + 配对计算 flowComparison：
- matched: lineItem with matched=true → externalLine + internalFlow 都填
- orphan_external: externalLine 填, internalFlow null
- orphan_internal: externalLine null, internalFlow 填
- amount_mismatch: 两栏都填 + deltaAmount

- [ ] **Step 3: GET /admin/reconciliation/cases 加 aging + 默认 status=OPEN**

aging = `DATEDIFF(NOW(), firstSeenAt) in days`。SQLite 用 julianday。默认 `status=OPEN`，按 aging desc 排（若 query 无显式 status）。

- [ ] **Step 4: 单测**

加 endpoint level 测试（mock prisma），断言三个 endpoint 返回字段齐全。

- [ ] **Step 5: build + smoke**

```bash
npm run build
bash /tmp/exchange_js_main/start-stack.sh ; sleep 13
TOK=$(curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{"email":"admin@fiatx.com","password":"123456"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
RUN_ID=$(sqlite3 /tmp/exchange_js_main/dev.db "SELECT id FROM reconciliation_runs WHERE engineVersion='WALLET_V1' ORDER BY createdAt DESC LIMIT 1;")
curl -s "http://localhost:3000/admin/reconciliation/runs/$RUN_ID" -H "Authorization: Bearer $TOK" | python3 -m json.tool | head -40
# expected: accountStatusTable 数组存在，含 walletRef/internal/external/delta/flowMatched/flowTotal/status 字段
```

- [ ] **Step 6: 提交**

```bash
git -C /Users/songshengwei/Documents/codex/projects/重做版 commit -m "feat(recon): T3 endpoints add accountStatusTable + flowComparison + aging"
```

---

### Task 4: ReconciliationRunsDetailPage 重写

**Files:**
- Modify: `Exchange_js/admin-web/src/pages/ReconciliationRunsDetailPage.tsx`

- [ ] **Step 1: 删 INVARIANT ATTESTATION 块**（V8 五公式专用，新引擎不用）

- [ ] **Step 2: 加 5 数字总览卡**

显示 `accountsChecked` / `matchCount` / `breakCount` + 三类异常分项（来自 Run summary 字段）。

- [ ] **Step 3: 加账户状态表**

读 `accountStatusTable`，渲染表：
- 列：Account / Owner / Asset / Internal / External / Δ / Flows / Status
- ⚠ 行 click → `navigate('/admin/reconciliation/cases/' + caseId)`（需要 endpoint 返回 caseId per account）
- ✅ 行 click → 弹只读 modal（或 inline 展开）
- 顶部 toggle：「只看 Break / 全部」
- 列排序：Δ desc / Asset / Status

- [ ] **Step 4: 底部 "View All Cases" 链接 + 自愈历史 chip**

- [ ] **Step 5: 渲染验证**

`bash /tmp/exchange_js_main/start-stack.sh` → preview admin → 跑 `npm run recon:demo:break` → 导航到 run 详情 → 截图验证 9 行账户、5 ✅ + 4 ⚠ 分类、点 ⚠ 跳 case。

- [ ] **Step 6: 提交**

```bash
git -C /Users/songshengwei/Documents/codex/projects/重做版 commit -m "feat(recon): T4 Run detail = driver cockpit (account status table)"
```

---

### Task 5: ReconciliationCasesDetailPage 重写

**Files:**
- Modify: `Exchange_js/admin-web/src/pages/ReconciliationCasesDetailPage.tsx`

- [ ] **Step 1: 删 V8 风格的 book/asset/vintage 头块**

- [ ] **Step 2: 加账户身份卡**

Wallet / Owner / Asset / COA / 关联 Run（点跳回）/ Business Date / Status + Phase C banner。

- [ ] **Step 3: 加余额对比卡（3 数字）**

Internal / External / Δ。Δ≠0 高亮 red。

- [ ] **Step 4: 加异常摘要 chips**

3 个 chip：ORPHAN_INTERNAL / ORPHAN_EXTERNAL / AMOUNT_MISMATCH，各显示数量；点 chip 滚到流水表对应行。

- [ ] **Step 5: 加流水比对单表双栏**

读 `flowComparison`，渲染单表：
- 列：EXTERNAL / INTERNAL / Match-Diff
- matched: 两栏都填，Match-Diff = "✓ matched"
- orphan_external: 仅左栏，右栏 "–", Match-Diff = "⚠ ORPHAN_EXTERNAL"
- orphan_internal: 反之
- amount_mismatch: 两栏都填，差额高亮，Match-Diff = "⚠ MISMATCH (±delta)"

- [ ] **Step 6: 底部「在 Account Statement 看」深链接**

跳 `/admin/ledger/account-statement?mode=wallet&wallet=<walletRef>&crossingOnly=true`。

- [ ] **Step 7: 渲染验证**

preview → 跑 break → 进任一 case → 截图验证：
- 余额对比正确
- 4 类异常都能在单表双栏看出
- 异常 chips 计数正确
- 深链接跳转 ok

- [ ] **Step 8: 提交**

```bash
git -C /Users/songshengwei/Documents/codex/projects/重做版 commit -m "feat(recon): T5 Case detail = investigation cockpit (balance + dual-column flow comparison)"
```

---

### Task 6: ReconciliationCasesListPage 简化

**Files:**
- Modify: `Exchange_js/admin-web/src/pages/ReconciliationCasesListPage.tsx`

- [ ] **Step 1: 默认过滤 status=OPEN，按 Aging desc 排**

URL 默认带 `?status=OPEN`，sort=aging.desc。

- [ ] **Step 2: 列改为：Case ID / Account / Owner / Asset / Aging / Δ / First Run / Last Run / Status**

Aging 显示 "N days"（>3 天高亮 amber，>7 天 red）。

- [ ] **Step 3: 渲染验证**

preview → cases 列表 → 截图验证默认显示 Open + aging 排序。

- [ ] **Step 4: 提交**

```bash
git -C /Users/songshengwei/Documents/codex/projects/重做版 commit -m "feat(recon): T6 Cases list — default OPEN + aging-sorted tracking view"
```

---

### Task 7: e2e + 幂等 + 自愈 + 截图

- [ ] **Step 1: 全栈起 + recon:demo:break**

```bash
bash /tmp/exchange_js_main/start-stack.sh ; sleep 13
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && DATABASE_URL=... TB_ADDRESS=127.0.0.1:3003 npm run recon:demo:break
```

- [ ] **Step 2: 幂等验证 — 连跑 3 次 break，确认同账号只 1 OPEN case**

```bash
for i in 1 2 3; do npm run recon:demo:break; done
sqlite3 /tmp/exchange_js_main/dev.db "SELECT walletRef, COUNT(*) c FROM reconciliation_cases WHERE status='OPEN' GROUP BY walletRef HAVING c>1;"
# expected: empty
sqlite3 /tmp/exchange_js_main/dev.db "SELECT walletRef, firstSeenRunId, lastUpdatedRunId FROM reconciliation_cases WHERE status='OPEN' LIMIT 5;"
# expected: firstSeenRunId 是第一次跑的 run，lastUpdatedRunId 是最近一次
```

- [ ] **Step 3: 自愈验证 — recon:demo:pass 跑一次后，原 OPEN cases 应自动 RESOLVED**

```bash
npm run recon:demo:pass
sqlite3 /tmp/exchange_js_main/dev.db "SELECT status, resolutionReason, COUNT(*) FROM reconciliation_cases GROUP BY status, resolutionReason;"
# expected: 大部分 OPEN → RESOLVED + AUTO_HEALED
```

- [ ] **Step 4: 截图 4 页**

preview admin → 登录 → 截图：
- Run 详情主驾驶台（账户状态表）
- Case 详情（余额对比 + 单表双栏流水）
- Cases 列表（aging 视图）
- Account Statement 深链接（验证从 Case 跳过去）

存到 `/tmp/exchange_js_main/t7-{name}.png`。

- [ ] **Step 5: verify:coa**

```bash
npm run verify:coa
# expected: ALL INVARIANTS PASS
```

- [ ] **Step 6: 更新记忆**

在 `funds-model-realtime-1to1-redesign.md` 加 T1-T7 done 段。

- [ ] **Step 7: 提交（如有 e2e 期间 fixup）**

```bash
git -C /Users/songshengwei/Documents/codex/projects/重做版 commit -m "test(recon): T7 e2e cockpit redesign — idempotent + auto-heal + render-verify"
```

---

## Deferred（写记忆里）
- Case 处置工作流：Close/Waive/Assignee/SLA → Phase C
- DB-level partial unique index `(walletRef, businessDate, status=OPEN)` → SQLite 表达式索引兼容性需查；本版用 service 层 upsert 兜底
- severity 阈值可配置 → 本版 hard-code（HIGH ≥10000, MEDIUM ≥100, else LOW）
- 跨日 Case 关联（同一账户多日反复异常的趋势图）→ Phase C
