# 对账演示管线 (Reconciliation Demo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `demo:all` 产出的真实业务数据之上，加一条去锚点的 `recon:demo --mode=pass|break` 管线 + break manifest + 只读「注入 vs 检出」对比页，并退役旧的写死锚点的 `recon:gen`/`recon:redesign`。

**Architecture:** `recon:demo` 读当天真实资金单 → 合成外部对账单（pass=完美镜像 / break=注入~6笔差异+写 manifest）→ 调既有引擎 `RedesignReconRunService.run(APPLY)` 落 run/case/lineItem（break 时把 manifest 存到 `ReconciliationRun.demoManifest`）→ admin 用既有记分卡/case 页 + 新增只读对比页（服务端按 (currency,book,bucket,ref) 配对 manifest vs 检出）。crypto-pending 态对账。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle + ts-node 集成脚本 + React(admin-web) + Jest。

spec：`doc-final/superpowers/specs/2026-06-21-recon-demo-pipeline-design.md`

> 环境（branch 栈）：working dir `…/.wt/branch/Exchange_js`；`DATABASE_URL=file:/tmp/exchange_js_branch/dev.db`；`TB_ADDRESS=127.0.0.1:3503`；API 3500 / Admin 3501。集成脚本/重启遇 SQLite 写竞争时停**仅** 3500（`lsof -ti:3500|xargs kill`，保 TB 3503）。**禁用** `dev:reset`/`dev:rebuild`（main-scoped）；用 `db:reset:business`（branch）。git 分支 `branch`。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `prisma/schema.prisma` + 新迁移 | `ReconciliationRun.demoManifest String?` | 改 + 手写迁移 |
| `src/modules/clearing-settle/reconciliation/workflow/redesign-recon-run.service.ts` | `run()` 接受 + 持久化 `demoManifest` | 改 |
| `scripts/recon-demo.ts` | 去锚点合成 external（pass/break）+ 建 manifest + 跑 run + 打印对比 | 建（吸收 recon:gen 逻辑） |
| `src/modules/clearing-settle/reconciliation/controllers/reconciliation-admin.controller.ts` | `GET .../demo/compare` 端点 | 改 |
| `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts` | compare 配对 query 方法 | 改 |
| `<rbac catalog>` | 登记 compare 端点 | 改 |
| `admin-web/src/pages/<recon>/ReconciliationDemoComparePage.tsx` | 只读对比页 | 建 |
| `admin-web/src/App.tsx`（路由）+ run-detail 页 | 路由 + 条件入口链接 | 改 |
| `package.json` | +`recon:demo`，−`recon:gen`/`recon:redesign` | 改 |
| `scripts/recon-redesign-statement-gen.ts` / `scripts/recon-redesign-run-verify.ts` | 退役 | 删 |

---

## Task 1: `ReconciliationRun.demoManifest` 迁移

**Files:**
- Modify: `prisma/schema.prisma`（`model ReconciliationRun`）
- Create: `prisma/migrations/<YYYYMMDDHHMMSS>_recon_demo_manifest/migration.sql`

- [ ] **Step 1: schema 加列**

在 `model ReconciliationRun` 末尾（`createdAt` 后）加：
```prisma
  demoManifest    String?  // demo-only: JSON answer-key of injected breaks (null for real/pass runs)
```

- [ ] **Step 2: 手写迁移（项目约定，非 prisma migrate dev）**

本项目迁移是手写 SQL + `apply-local-migrations.sh`（见 `prisma/migrations/*/migration.sql`）。**不要用 `prisma migrate dev`**（会因 dev DB 漂移触发 reset，毁数据）。建 `prisma/migrations/<时间戳>_recon_demo_manifest/migration.sql`：
```sql
-- Add demo-only manifest column (JSON answer-key of injected breaks) to reconciliation_runs.
ALTER TABLE "reconciliation_runs" ADD COLUMN "demoManifest" TEXT;
```
（确认 `ReconciliationRun` 的 `@@map` 是 `reconciliation_runs`——是。列名 `demoManifest`，Prisma 字段无 `@map`。）

- [ ] **Step 3: 应用 + 生成客户端**

Run:
```bash
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" npm run db:migrate:local
npx prisma generate
```
Expected: 迁移被记录（`_prisma_migrations`），列已加，数据无损；client 重新生成。

- [ ] **Step 4: 编译校验**

Run: `npx tsc --noEmit`
Expected: 0 新错误。

- [ ] **Step 5: Commit**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch"
git add Exchange_js/prisma/schema.prisma Exchange_js/prisma/migrations
git commit -m "feat(recon): add ReconciliationRun.demoManifest column (demo break answer-key)"
```

---

## Task 2: `RedesignReconRunService.run` 持久化 demoManifest

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/workflow/redesign-recon-run.service.ts`
- Test: `.../workflow/redesign-recon-run.service.spec.ts`（若无则建）

> 先读 `redesign-recon-run.service.ts`：`run()` 当前入参（`{ businessDate, triggerType, mode }`，见 `scripts/recon-redesign-run-verify.ts` 用法）+ 它在 `mode==='APPLY'` 分支创建 `ReconciliationRun` 行的位置。

- [ ] **Step 1: 写失败单测**

断言：`run({..., mode:'APPLY', demoManifest})` 把 manifest 持久化到创建的 run（`prisma.reconciliationRun.create` 的 data 含 `demoManifest: JSON.stringify(demoManifest)`）；不传 demoManifest 时该列为 `null`。用既有 spec 的 mock 风格（mock prisma + 引擎子服务），断言 create 调用参数。若无 spec 文件，建一个最小的，仅覆盖此行为。
```typescript
it('APPLY persists demoManifest JSON on the run when provided', async () => {
  // ...arrange mocks so run() reaches the APPLY create...
  await service.run({ businessDate: '2026-06-21', triggerType: 'MANUAL', mode: 'APPLY', demoManifest: { generatedAt: 'x', breaks: [] } } as any);
  expect(prisma.reconciliationRun.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ demoManifest: JSON.stringify({ generatedAt: 'x', breaks: [] }) }) }),
  );
});
it('APPLY without demoManifest leaves it null', async () => { /* assert data.demoManifest == null */ });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/clearing-settle/reconciliation/workflow/redesign-recon-run.service.spec.ts -t "demoManifest"`
Expected: FAIL（run 未接受/持久化该字段）。

- [ ] **Step 3: 实现**

在 `run()` 的入参类型加可选 `demoManifest?: unknown`；在 APPLY 创建 `ReconciliationRun` 的 `data` 里加 `demoManifest: input.demoManifest ? JSON.stringify(input.demoManifest) : null`。不改其它行为。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/modules/clearing-settle/reconciliation/workflow/redesign-recon-run.service.spec.ts`
Expected: PASS（新用例 + 既有不回归）。

- [ ] **Step 5: Commit**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch"
git add Exchange_js/src/modules/clearing-settle/reconciliation/workflow/redesign-recon-run.service.ts Exchange_js/src/modules/clearing-settle/reconciliation/workflow/redesign-recon-run.service.spec.ts
git commit -m "feat(recon): RedesignReconRunService.run persists optional demoManifest"
```

---

## Task 3: `recon-demo.ts`（去锚点 external 合成 + pass/break + manifest）

**Files:**
- Create: `scripts/recon-demo.ts`
- Modify: `package.json`（+`recon:demo`）

> 读 `scripts/recon-redesign-statement-gen.ts`（419 行）——它就是要吸收+去锚点的源。差异点：写死 `BUSINESS_DATE='2026-06-16'`、`AED_ASSET`/`USDT_ASSET` UUID、break 锚点 `REF-SEED5-1/5`/`0xSEED51/55`、永远注入。`recon-demo.ts` 把这套搬过来并改成动态。

- [ ] **Step 1: 写脚本骨架（bootstrap + 参数）**

`scripts/recon-demo.ts`：Node18 polyfill；`NestFactory.createApplicationContext`；解析 `--mode=pass|break`（默认 break）+ `--date=YYYY-MM-DD`（默认今天 `new Date().toISOString().slice(0,10)`）。按 `currency` 查 AED/USDT 资产（`prisma.asset.findFirst({where:{currency,status:'ACTIVE'}})`，不写死 UUID）。

- [ ] **Step 2: 搬入外部合成逻辑（去锚点）**

从 `recon-redesign-statement-gen.ts` 搬：读当天 CLEARED payin/payout + CLEAR internal_fund；用 `BalanceSnapshotService`+`InTransitService` 算 TB/in-transit；合成 ZAND(AED)+HEXTRUST(USDT) 行 + FIRM treasury backfill；写 `external_statement_lines`+`external_balances`（upsert，先清当天）。**去掉** 2026-06-16/UUID/REF-SEED5 写死，全部用 Step1 的 date/asset。

- [ ] **Step 3: pass/break 分叉 + 动态 break + manifest**

- `pass`：不注入任何 break（external 完美镜像内部）；`manifest = null`。
- `break`：每币种动态挑 3 笔真实记录注入 3 桶，并记 manifest：
  - `ORPHAN_INTERNAL`：跳过（不写）当天某真实 payin 的外部行（挑该币种第 1 笔 CLEARED payin）。
  - `ORPHAN_EXTERNAL`：额外加一笔无内部对应的进账（合成 ref `REF-EXT-ORPHAN-<ccy>` / `0xEXTORPHAN<ccy>`，固定小额）。
  - `AMOUNT_MISMATCH`：把当天另一笔真实 payin（挑第 2 笔）的外部金额改掉（−0.08 之类）。
  - closing 口径沿用 gen：`closing = TB − in-transit − Σ(break signedδ)`。
  - 每注入一笔 push 到 `manifest.breaks`：`{ currency, book, bucket, targetType, targetRef, internalAmount, externalAmount, signedDelta, note }`。
  - 覆盖 AED(CLIENT) + USDT（orphan-external 落 FIRM vault-main、其余 CLIENT）。

- [ ] **Step 4: 跑引擎 + 打印对比**

`const run = await app.get(RedesignReconRunService).run({ businessDate: date, triggerType:'MANUAL', mode:'APPLY', demoManifest: mode==='break'? manifest : undefined })`。回读 `ReconciliationQueryService.getLatestRedesignRun(date)`，控制台打印：注入的 breaks（manifest）+ 检出的 cases/lineItems 摘要 + 每币种五公式 PASS/FAIL。

- [ ] **Step 5: package.json**

加：`"recon:demo": "DATABASE_URL=\"file:/tmp/exchange_js_branch/dev.db\" TB_ADDRESS=127.0.0.1:3503 ts-node -r tsconfig-paths/register scripts/recon-demo.ts"`

- [ ] **Step 6: 跑通（先备数据；停 3500 避免竞争）**

Run（干净基线 → 数据 → 对账）：
```bash
npm run db:reset:business
npm run demo:all
lsof -ti:3500 | xargs kill 2>/dev/null   # 避免 SQLite 写竞争（保 TB 3503）
npm run recon:demo -- --mode=pass
npm run recon:demo -- --mode=break
```
Expected：`pass` 打印五公式全 PASS / 0 case；`break` 打印注入 6 笔 + 检出 cases，五公式式4/式5 出现 FAIL。迭代脚本到稳定。

- [ ] **Step 7: Commit**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch"
git add Exchange_js/scripts/recon-demo.ts Exchange_js/package.json
git commit -m "feat(recon): recon:demo — anchor-free external gen (pass/break) + break manifest"
```

---

## Task 4: compare 端点 + 配对 query

**Files:**
- Modify: `.../reconciliation/domain/reconciliation-query.service.ts`
- Modify: `.../reconciliation/controllers/reconciliation-admin.controller.ts`
- Modify: `<rbac catalog>`（`grep -rln "rbac.catalog\|RBAC_PERMISSION_DEFINITIONS" src`）
- Test: `.../domain/reconciliation-query.service.spec.ts`（若无则建，仅测配对纯函数）

- [ ] **Step 1: 写失败单测（配对逻辑）**

把「manifest.breaks vs case lineItems 配对」抽成一个**纯函数**（输入 manifest breaks[] + lineItems[]，输出 `{matched, missed, extra}`，键= `(currency,book,bucket,ref)`），便于单测：
```typescript
it('pairs injected breaks against detected line items by (currency,book,bucket,ref)', () => {
  const breaks = [{ currency:'AED', book:'CLIENT', bucket:'ORPHAN_INTERNAL', targetRef:'REF-DEMO-1-AED' }];
  const items = [{ /* currency AED, book CLIENT, matchStatus ORPHAN_INTERNAL, ref REF-DEMO-1-AED */ }];
  const r = pairManifest(breaks as any, items as any);
  expect(r.matched).toHaveLength(1); expect(r.missed).toHaveLength(0); expect(r.extra).toHaveLength(0);
});
it('reports missed (injected, not detected) and extra (detected, not injected)', () => { /* ... */ });
```
（`ref` 取 line-item 的 internalSourceNo / externalRef / externalTxHash 之一——读 `ReconciliationLineItem` 字段对齐。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts -t "pairs"`
Expected: FAIL（`pairManifest` 未定义）。

- [ ] **Step 3: 实现 query + 端点**

- query 加 `getDemoCompare(runNo)`：取 run（含 `demoManifest`，JSON.parse）+ 它的 cases→lineItems；用 `pairManifest` 配对；返回 `{ run:{runNo,businessDate,status}, manifest, detected, reconciliation:{matched,missed,extra} }`。run 无 `demoManifest` → manifest=[]、reconciliation 全空。
- controller 加 `@Get('demo/compare')`（query `runNo`），照搬同 controller 其它 GET 的守卫/装饰器；调 `getDemoCompare`。
- RBAC catalog 用与其它 reconciliation GET 相同的 permission 登记 `GET /admin/reconciliation/demo/compare`。

- [ ] **Step 4: 跑测试 + sync RBAC**

Run:
```bash
npx jest src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" npm run db:base:sync
```
Expected: 单测 PASS；sync 成功。（端点的活体 200 验证留 Task 7，需重启后端 + JWT。）

- [ ] **Step 5: Commit**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch"
git add Exchange_js/src/modules/clearing-settle/reconciliation Exchange_js/src/<rbac-catalog-file>
git commit -m "feat(recon): GET /admin/reconciliation/demo/compare (injected-vs-detected pairing) + RBAC"
```

---

## Task 5: 只读对比页 + run-detail 条件入口

**Files:**
- Create: `admin-web/src/pages/<recon dir>/ReconciliationDemoComparePage.tsx`（用 `grep -rl "ReconciliationRunsDetailPage" admin-web/src` 定位 recon 页目录 + 路由文件）
- Modify: `admin-web/src/App.tsx`（路由）、`ReconciliationRunsDetailPage.tsx`（条件入口）

- [ ] **Step 1: 对比页**

照既有 recon 页风格（同目录、同 api client、暗色主题）建只读页：读 `GET /admin/reconciliation/demo/compare?runNo=<route param>`；左列 = `manifest.breaks`（注入项），右列 = `detected`（line-items），中间/标记按 `reconciliation`（✓ matched / ✗ missed / ⚠ extra）；空 manifest → 显示「perfect tie（pass run）」。

- [ ] **Step 2: 路由 + 条件入口**

`App.tsx` 加路由 `recon/demo-compare/:runNo`（沿用既有 recon 路由 + 权限 wrapper，权限同 reconciliation read）。在 `ReconciliationRunsDetailPage` 当 `run.demoManifest` 非空时显示「Demo 对比」链接 → 该路由（否则不显示）。

- [ ] **Step 3: 构建校验**

Run（admin-web 目录）：`npm run build`
Expected: 干净（无新类型错）。

- [ ] **Step 4: 渲染验收（截图）**

启动 admin（3501，VITE_API_URL=3500，后端需含 Task4 端点——见 Task7 重启），登录后打开一个 break demo run 的详情页 → 点「Demo 对比」→ 截图确认左右两列 + ✓/✗/⚠ 标记正确（6 注入 1:1 对上）。
> 用户偏好：前端「完成」必须 preview 渲染+截图，不能只 build/curl。

- [ ] **Step 5: Commit**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch"
git add Exchange_js/admin-web/src
git commit -m "feat(admin): read-only recon Demo compare page + conditional run-detail link"
```

---

## Task 6: 退役 `recon:gen` / `recon:redesign`

**Files:**
- Delete: `scripts/recon-redesign-statement-gen.ts`, `scripts/recon-redesign-run-verify.ts`
- Modify: `package.json`

- [ ] **Step 1: 确认无引用**

Run: `grep -rn "recon-redesign-statement-gen\|recon-redesign-run-verify\|recon:gen\|recon:redesign" Exchange_js --include=*.ts --include=*.json --include=*.md | grep -v doc-final/superpowers`
Expected: 仅 `package.json` 两条命令 + 可能 spec/plan 文档引用（文档不算活引用）。若有活代码引用 → STOP 报告。

- [ ] **Step 2: 删除 + 去命令**

删两个脚本文件；从 `package.json` 删 `recon:gen` 与 `recon:redesign` 两行。（`recon:drilldown` 保留不动。）

- [ ] **Step 3: 校验**

Run: `npx tsc --noEmit` （从 Exchange_js）
Expected: 0 错误（无悬空引用）。

- [ ] **Step 4: Commit**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch"
git add -A Exchange_js/scripts Exchange_js/package.json
git commit -m "chore(recon): retire anchored recon:gen + recon:redesign (superseded by recon:demo)"
```

---

## Task 7: 集成验收 + 回归

**Files:** （无新文件；活体验证）

- [ ] **Step 1: rebuild + restart 后端（含 Task2/4 改动）**

Run:
```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js"
npm run build
lsof -ti:3500 | xargs kill -9 2>/dev/null; sleep 2
node dist/main > /tmp/exchange_js_branch_api.log 2>&1 &   # 后台；或控制器用 run_in_background
sleep 16
```
Expected: 3500 起；`curl -s -o /dev/null -w "%{http_code}\n" "localhost:3500/admin/reconciliation/demo/compare?runNo=x"` → 401（端点已挂、需鉴权），非 404。

- [ ] **Step 2: 端到端 pass**

Run: `npm run db:reset:business && npm run demo:all && (lsof -ti:3500|xargs kill 2>/dev/null) && npm run recon:demo -- --mode=pass`
Expected: 五公式全 PASS、0 case、manifest 空。

- [ ] **Step 3: 端到端 break + 断言 1:1**

Run: `npm run recon:demo -- --mode=break`
Expected 打印：注入 6 笔；回读检出的 cases/lineItems；式4/式5 在被注入 currency×book FAIL、式1–3 PASS。脚本末尾自检：检出桶数与注入 1:1（matched=6, missed=0, extra=0）—— 不符则非零退出。

- [ ] **Step 4: 渲染验收**（重启后端后）见 Task5 Step4：记分卡红格 + Demo 对比页左右对上，截图。

- [ ] **Step 5: jest 回归**

Run: `npx jest src/modules/clearing-settle/reconciliation`
Expected: 全绿。

- [ ] **Step 6: Commit**（若 Step3 自检逻辑写进了 recon-demo.ts 之外的小工具）

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch"
git add -A Exchange_js
git commit -m "test(recon): e2e verify recon:demo pass/break (injected==detected 1:1)"
```

---

## Self-Review（作者自查）

- **Spec 覆盖**：§3.1 recon:demo→Task3；§3.2 manifest→Task1+Task2；§3.3 compare 端点+页→Task4+Task5；§3.4 退役→Task6；§4 验收→Task7。✅ 全覆盖。
- **占位符**：无 TBD；代码块/命令具体。少数「读 X 对齐签名」处是执行时具体动作（run service create 点、recon 页目录、rbac 文件、lineItem ref 字段），非占位——这些是确凿需读源的集成点，给了 grep/定位指引。
- **类型一致**：`demoManifest`（列名 + run() 入参 + JSON 形状）、`pairManifest`/`getDemoCompare`、`(currency,book,bucket,ref)` 配对键 全程一致。
- **风险**：① 迁移用手写 SQL（非 prisma migrate dev，防 reset 毁数据）；② 集成脚本与运行中 API 的 SQLite 写竞争（停 3500、保 TB 3503）；③ 端点活体验证依赖 rebuild+restart（Task7 Step1）；④ break 动态挑记录需保证当天确有≥2 笔/币种真实 payin（demo:all 保证 3 客户×each → 满足）。
