# recon 引擎 canonical-minor + demo heal 收口 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 修 recon 引擎"元/分两世界"根因（匹配器边界按 asset.decimals 元→分）+ 展示层统一还原 + demo 夹具改真实分镜像，让完整 heal 闭环（push→delta归0→case自愈）端到端演出来。

**Architecture:** 引擎 canonical=分：run 服务从 asset 表批量查 decimals 传匹配器，匹配器读入即元→分；`:202` inTransitSigned 天然同单位，heal 通。展示层 Cases/Runs 详情改用 asset.decimals（撤硬编码）。夹具外部镜像改真实分。

**Tech Stack:** NestJS recon engine（wallet-flow-matcher / wallet-recon-run / wallet-balance-checker）、Prisma.Decimal 精确换算、jest fake-prisma 单测、ts-node demo 脚本、React admin。

**Spec:** `doc-final/superpowers/specs/2026-07-04-recon-engine-canonical-minor-design.md`（+ 上游 `2026-07-04-recon-demo-realdata-design.md`）

**执行位置:** worktree `.claude/worktrees/demo-realdata`（分支 demo-realdata）。self 栈已起（backend 3110/admin 3111/TB 3113，DB `/tmp/exchange_js_wt_demo_realdata/dev.db` 下划线）。on-stack 前 `export PATH="$PWD/node_modules/.bin:$PATH"`。

---

## 已核实的关键事实

| 事实 | 证据 |
|---|---|
| bug 唯一交汇点 | `wallet-recon-run.service.ts:202` inTransitSigned=Σ±BigInt(it.amount)，it.amount=元，delta=分 |
| 匹配器签名 | `matchFlows(input: MatcherInput)`（:152），MatcherInput（:82）有 walletRef/externalLines/cutoff/timeWindowMinutes |
| run 调匹配器 | `:190 flowMatcher.matchFlows({...})`，紧邻 `:175 balanceChecker.checkBalance` |
| decimals 查法 | `asset.findMany({where:{code:{in:currencies}}, select:{code,decimals}})`（query 层 :524-532 现成样例）|
| getCase 已返 decimals | `reconciliation-query.service.ts:575 decimals: asset?.decimals ?? 0` |
| 各表单位 | account_flows=分 ｜ external_balances.closing_balance=分 ｜ external_statement_lines.amount=元 ｜ funds_orders.amount=元 |
| 展示现状 | External Balances `fmtAmount(v,decimals)` ÷10^dec 正确；Cases 详情 `formatAmount(raw)` 用硬编码 DEFAULT_DECIMALS |
| 夹具现状 | createStuckWithdraw/Swap 设 closing=内部分−裸元(498)；有 `toAsset.decimals>2 throw` guard |

---

### Task A: 引擎匹配器 canonical-minor（核心）

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/engine/v2/wallet-flow-matcher.service.ts`（MatcherInput+decimals，读入元→分）
- Modify: `src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts`（批量查 decimals + 传参）
- Test: `src/modules/clearing-settle/reconciliation/engine/v2/wallet-flow-matcher.service.spec.ts`

- [ ] **Step 1: 匹配器换算红测**

`wallet-flow-matcher.service.spec.ts` 加：

```ts
it('converts external line + funds-order amounts to minor via decimals (in-transit amount is minor)', async () => {
  // fixture：external OUT line amount=498（元），funds order netAmount=498（元），decimals=2
  // 期望：matchFlows 返回 inTransit[0].amount === '49800'（分），非 '498'
  const result = await svc.matchFlows({ walletRef: 'w', externalLines: [extLine('OUT', 498, '0xr')],
    cutoff, decimals: 2 } as any);
  expect(result.inTransit[0].amount).toBe('49800');
});

it('fractional major amount converts to integer minor (AED 4380.56 → 438056, no BigInt crash)', async () => {
  const result = await svc.matchFlows({ walletRef: 'w', externalLines: [extLine('OUT', 4380.56, '0xr')],
    cutoff, decimals: 2 } as any);
  expect(result.inTransit[0].amount).toBe('438056');
});
```

（`extLine`/候选 fixture 照该 spec 既有工厂；候选 funds order netAmount 需与 line 匹配 amountOk。）

Run: `npx jest wallet-flow-matcher --silent` → 红（现返回元 '498'，且 decimals 参数不存在编译错）。

- [ ] **Step 2: 匹配器实现**

`MatcherInput`（:82）加 `decimals: number;`。`matchFlows`（:152）解构加 `decimals`。加换算工具（Prisma.Decimal 精确，避浮点）：

```ts
const toMinor = (d: Prisma.Decimal): bigint =>
  BigInt(d.mul(new Prisma.Decimal(10).pow(decimals)).toFixed(0));
```

`amountOk` 改为分比分：`toMinor(ext.amount) === toMinor(c.netAmount) || toMinor(ext.amount) === toMinor(c.amount)`。`take()` 里 `amount: toMinor(ext.amount).toString()`（分）。其余（direction/datetime/window/refs）不动。

Run 同上 → 绿。

- [ ] **Step 3: run 服务批量查 decimals + 传参**

`wallet-recon-run.service.ts` run 主体：收集本批钱包涉及币种（`bal.currency`），一次 `asset.findMany({where:{code:{in:[...currencies]}}, select:{code,decimals}})` → `decimalsByCurrency: Map`。`:190` 调用加 `decimals: decimalsByCurrency.get(bal.currency) ?? 0`。`:202` inTransitSigned 一行不动（it.amount 现已是分）。

- [ ] **Step 4: 金闸门复验（改前改后九场景一致）**

```bash
export PATH="$PWD/node_modules/.bin:$PATH"
bash scripts/on-stack.sh self recon:demo:reset && bash scripts/on-stack.sh self recon:demo:break 2>&1 | grep -E "score:|identity|manifest detected|ALL 9|bucket=IN_TRANSIT"
```

Expected: `9/9 DETECTED` + 两恒等式 OK。⚠️ 场景 1（合成壳，现用 bumpClosing 裸元）在换分后可能残差不再=0（因在途金额×100 而 bumpClosing 未×100）→ 若场景 1 落 BREAK，**属预期**：它本轮由 Task D 换成真夹具（真夹具设分镜像）。本 Task 只需确认**场景 2-9 不回归**（它们是余额 delta 检测，与在途换算无关）。若 2-9 有变，是真回归，STOP 排查。

- [ ] **Step 5: tsc + jest + Commit**

```bash
npx tsc --noEmit && npx jest src/modules/clearing-settle/reconciliation --silent 2>&1 | tail -3
git add src/modules/clearing-settle/reconciliation/engine/ src/modules/clearing-settle/reconciliation/workflow/
git commit -m "feat(recon): 匹配器 canonical-minor——外部行/funds_order 金额按 asset.decimals 元→分，修在途残差元分错配"
```

---

### Task B: 展示层统一 asset.decimals 还原

**Files:**
- Modify: `admin-web/src/pages/ReconciliationCasesDetailPage.tsx`（formatAmount 用 asset.decimals）
- Modify: `admin-web/src/pages/ReconciliationRunsDetailPage.tsx`（同款排查）

- [ ] **Step 1: Cases 详情 formatAmount 改用 asset.decimals**

`ReconciliationCasesDetailPage.tsx`：getCase 响应已带 `decimals`（后端 :575）。把 `formatAmount(raw)` 改为 `formatAmount(raw, decimals)`——用传入 decimals 而非硬编码 `DEFAULT_DECIMALS`：`padded` 的补位与切分位数改用 `decimals`。所有调用点（:416/441/453/480 等）传入 `kase.decimals`（或 case 响应里的 decimals 字段；read 确认字段路径）。参照 `ReconciliationExternalBalancesPage.tsx:54 fmtAmount(v, decimals)` 的 ÷10^dec 写法对齐。

- [ ] **Step 2: Runs 详情同款排查**

`ReconciliationRunsDetailPage.tsx`：查其金额格式化是否也硬编码 decimals；若是，同 Step 1 改用 run_wallets 行的资产 decimals（run 快照表/响应是否带 decimals，read 确认；若没带，后端 getRun 补 decimals 字段——照 getCase :575 同法）。

- [ ] **Step 3: admin tsc + Commit**

```bash
(cd admin-web && npx tsc -b)
git add admin-web/src/pages/ReconciliationCasesDetailPage.tsx admin-web/src/pages/ReconciliationRunsDetailPage.tsx
# 若后端补了 getRun decimals：一并 git add src/modules/.../reconciliation-query.service.ts
git commit -m "fix(admin/recon): Cases/Runs 详情金额改用 asset.decimals 还原（撤硬编码 DEFAULT_DECIMALS）"
```

---

### Task C: demo 夹具改真实分镜像 + 撤分数限制

**Files:**
- Modify: `scripts/demo-fixtures.ts`（injectStuckExternalMirror 按分 + 撤 toAsset.decimals>2 guard）

- [ ] **Step 1: 外部镜像 closing 改真实分**

`demo-fixtures.ts` `injectStuckExternalMirror`：现设 `closing = 内部分 − 裸元amount`。引擎换分后须改 `closing = 内部分 − (amount × 10^decimals)`——即减真实分。外部 OUT line 的 amount 仍写元（引擎读入换分），但 closing 的 bump 改真实分。decimals 从 opts 传入（createStuckWithdraw/Swap 已有 asset 句柄，取 `asset.decimals`）。

- [ ] **Step 2: 撤 createStuckSwap 的 `toAsset.decimals>2` guard**

Task A 的元→整数分换算根治了分数 `BigInt` 崩溃（chip task_3d7c3fdd 根因），故 `createStuckSwap` 里 `toAsset.decimals>2 throw` guard + "整数 grossTo 搜索"绕开可撤除，docstring 收窄描述改回"两向皆可"。撤后 AED→USDT（to-asset USDT 6-8 位）也能造在途。

- [ ] **Step 3: 重验两夹具仍 IN_TRANSIT（分镜像 + 引擎换分后）**

```bash
export PATH="$PWD/node_modules/.bin:$PATH"
bash scripts/on-stack.sh self demo:in-transit >/tmp/dr-c.txt 2>&1
bash scripts/on-stack.sh self recon:rerun >/dev/null 2>&1
sqlite3 /tmp/exchange_js_wt_demo_realdata/dev.db "SELECT walletRef,bucket,deltaAmount,inTransitAmount FROM reconciliation_run_wallets rw JOIN reconciliation_runs r ON r.id=rw.runId WHERE r.id=(SELECT id FROM reconciliation_runs ORDER BY createdAt DESC LIMIT 1) AND bucket='IN_TRANSIT';"
```

Expected: ≥2 IN_TRANSIT 钱包，delta/inTransit 现在是**真实分**（如 -49800），残差 0。贴真实输出。

- [ ] **Step 4: tsc + Commit**

```bash
npx tsc --noEmit
git add scripts/demo-fixtures.ts
git commit -m "feat(demo): 夹具外部镜像改真实分（配合引擎 canonical-minor）+ 撤 swap to-asset 精度限制"
```

---

### Task D: recon:demo scenario-1 去合成壳

**Files:**
- Modify: `scripts/recon-demo.ts`（scenario-1 :568-646 换调 createStuckWithdraw）

- [ ] **Step 1: scenario-1 换真夹具（含 I1 组合修复）**

`recon-demo.ts` scenario-1 块改为调 `createStuckWithdraw`。⚠️ **I1 组合坑（T1/T2 code-review 已警）**：recon-demo 里 scenario 注入在 `writeMirror`（已给该钱包写绝对 closing=internalTotal + coaCode）**之后**跑；而夹具的 `injectStuckExternalMirror` 也写绝对 closing → 二者互踩（丢 coaCode / 写序竞争 → 场景可能变 MATCHED）。修法二选一：
  - **(a) 落未 mirror 的专用钱包**：scenario-1 用一个 `writeMirror` 没覆盖的钱包（无 crossing flow 的），夹具绝对 closing 独占；或
  - **(b) 夹具支持相对 bump 模式**：给 `injectStuckExternalMirror` 加可选 `relative` 参数——存在 ExternalBalance 时 `closing += −分amount`（保留 writeMirror 的 coaCode/其余），scenario-1 传 relative=true。
  推荐 (b)（与既有 bumpClosing 相对语义一致、不挑钱包）。read `recon-demo.ts` writeMirror 相位 + s1Plan 钱包来源后定。删该块内空壳 `fundsOrders.create` + 手造 line + bumpClosing。

- [ ] **Step 2: 金闸门九场景全绿（真在途单）**

```bash
export PATH="$PWD/node_modules/.bin:$PATH"
bash scripts/on-stack.sh self recon:demo:reset && bash scripts/on-stack.sh self recon:demo:break 2>&1 | tee /tmp/dr-golden2.txt | grep -E "score:|identity|manifest|ALL 9|#1 "
```

Expected: `9/9 DETECTED`、两恒等式、`#1 IN_TRANSIT_TIMING ... bucket=IN_TRANSIT`（背后真提现单）、`ALL 9 SCENARIOS`。新基线存档。

- [ ] **Step 3: tsc + Commit**

```bash
npx tsc --noEmit
git add scripts/recon-demo.ts
git commit -m "feat(demo): recon:demo scenario-1 去合成壳——复用 createStuckWithdraw 真提现在途（相对镜像不踩 writeMirror）"
```

---

### Task E: 完整 heal e2e（delta→0）+ 硬闸 + 文档收口

**Files:**
- Modify: `doc-final/reference/roadmap.md`、`doc-final/BACKLOG.md`（勾掉真实卡单 demo + BigInt 分数崩 + swap 精度限制条）

- [ ] **Step 1: 完整 heal 闭环 e2e（整件事的目标）**

```bash
export PATH="$PWD/node_modules/.bin:$PATH"
DB=/tmp/exchange_js_wt_demo_realdata/dev.db
bash scripts/on-stack.sh self demo:in-transit >/tmp/dr-e.txt 2>&1
# 取 stuck withdraw fundsOrderNo + walletRef
bash scripts/on-stack.sh self recon:rerun >/dev/null 2>&1
sqlite3 "$DB" "SELECT bucket,deltaAmount FROM reconciliation_run_wallets rw JOIN reconciliation_runs r ON r.id=rw.runId WHERE walletRef='<WD钱包>' ORDER BY r.createdAt DESC LIMIT 1;"  # IN_TRANSIT
TOKEN=$(curl -s -X POST http://localhost:3110/auth/login -H "Content-Type: application/json" -d '{"email":"admin@fiatx.com","password":"123456"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s -X POST "http://localhost:3110/admin/funds-orders/<WD_FO>/push/sync" -H "Authorization: Bearer $TOKEN"  # CLEARED
bash scripts/on-stack.sh self recon:rerun >/dev/null 2>&1
sqlite3 "$DB" "SELECT bucket,deltaAmount FROM reconciliation_run_wallets rw JOIN reconciliation_runs r ON r.id=rw.runId WHERE walletRef='<WD钱包>' ORDER BY r.createdAt DESC LIMIT 1;"
```

Expected（**本轮核心验收**）：推后 `deltaAmount=0` 且 bucket 离开 IN_TRANSIT（MATCHED / case AUTO_HEALED）——这就是从 T5 到现在一直演不出、canonical-minor 修完终于通的**完整 heal 闭环**。贴每步真实输出。case 状态查：`SELECT status FROM reconciliation_cases WHERE walletRef='<WD钱包>' ORDER BY updatedAt DESC LIMIT 1;` → RESOLVED/自愈。

- [ ] **Step 2: 前端渲染验证**

preview（self 栈 admin 3111）：真实在途 case → 去处理 → 侧栏推单 → 待重对账徽记 → 重新对账 → case RESOLVED。**顺带验展示**：Cases 详情页 delta/金额在 AED（2 位）与 USDT（6-8 位）资产上都显示正确小数（Task B）。截图 2-3 帧。够不到 preview 诚实说明 + 数据契约验。

- [ ] **Step 3: 全局硬闸**

```bash
npx tsc --noEmit && (cd admin-web && npx tsc -b) && npx jest --silent 2>&1 | tail -3
```

Expected: 双 tsc 0；jest 净新增失败 0（基线 asset-treasury/wallets）。匹配器 spec 换算断言已在 Task A 跟进。

- [ ] **Step 4: 文档收口 + Commit**

BACKLOG 勾掉三条：「缺真实卡单 demo 场景」「recon 在途 BigInt 分数崩(task_3d7c3fdd)」「swap to-asset 精度限制」。roadmap 加交付记录（canonical-minor 引擎单位契约统一 + demo 真实 heal 闭环 + 展示层还原一致）。

```bash
git add doc-final/
git commit -m "docs: canonical-minor + demo 真实 heal 闭环交付记录 + BACKLOG 三条收口"
```

---

## 自审记录

- **Spec 覆盖**：§2.1 decimals 供给→Task A Step3；§2.2 匹配器换算→Task A Step1-2；§2.3 :202 零改→Task A（it.amount 现分）；§2.4 展示一致→Task B；§3 夹具改分→Task C；§4 验收（单测/e2e/金闸门/展示/tsc）→Task A/E 各步。
- **占位符**：`<WD钱包>`/`<WD_FO>` 是 Task E 运行时代入的真实值（demo:in-transit 输出），非占位设计；I1 修法 (a)/(b) 给了两条明路 + read 后定，非含糊。
- **类型一致**：`toMinor(Prisma.Decimal): bigint` Task A/C 一致；`decimals` 参数贯穿 MatcherInput→run 调用→夹具 opts→展示。
- **已知边界**：场景 1 在 Task A 后、Task D 前会短暂 BREAK（预期，Task D 换真夹具修复）；金闸门在 Task A 只验 2-9 不回归、Task D 验全 9 绿。demo 脚本无单测传统 → e2e/sqlite/金闸门断言当验证。
