# recon demo 真实数据夹具 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 造"真实卡在半路"的在途单（提现 CONFIRMING 非终态 + swap 腿 1-2 完 3-4 卡），把 recon:demo 唯一的合成壳换成真单，让完整 heal 闭环端到端可演。

**Architecture:** 新增共享夹具函数 `createStuckWithdraw()`/`createStuckSwap()`（demo-lib 风格，吃 DemoCtx，走真实 workflow+advance 停在非终态）。Command 1 `demo:in-transit` 直调；Command 2 `recon:demo:break` 场景 1 复用 `createStuckWithdraw()` 去壳。零业务代码改动，纯 demo 脚本。

**Tech Stack:** ts-node demo 脚本、NestFactory ApplicationContext、既有 FundsOrderService.advance / WithdrawWorkflowService / SwapWorkflowService。demo 脚本无单测传统 → 验证 = 跑命令 + sqlite/recon 断言（对标 recon:demo manifest 自检）。

**Spec:** `doc-final/superpowers/specs/2026-07-04-recon-demo-realdata-design.md`

**执行位置:** worktree `.claude/worktrees/demo-realdata`（分支 demo-realdata，off main）。所有命令在其 `Exchange_js/` 内。self 栈自动分端口（首次 `bash scripts/stack.sh up`）。

---

## 已核实的关键机制（执行者不用再逆向）

| 事实 | 证据 |
|---|---|
| 提现在途窗口 = 腿 CONFIRMING（POST 未做，非终态）；CONFIRM 触发 handler POST+CLEAR | `demo-lib.ts:440-448`（SUBMIT→[OBSERVE_CONFIRMING]→CONFIRM）；`withdraw-workflow.service.ts:717-724` |
| 提现造法 | `createWithdrawal(...)` → PENDING_COMPLIANCE → `updateKytStatus/updateTravelRuleStatus` PASSED → PAYOUT_PENDING → `findByParent({withdrawTransactionId},{legSeq})` 拿腿 → `fundsOrders.advance(leg.id, action, SIM)` |
| swap 逐腿推进 | `ctx.fundsOrders.advance(leg.id, action)` 或 `advanceLeg`；腿 chain via handler（`demo-lib.ts:315-326`）；4 腿 = SELL/SETTLE/BUY/FEE |
| swap 腿全 `isExternalCrossing:true` | `swap-leg-accounting.ts:99/318` |
| recon 在途匹配认领非终态单 | `findNonTerminalByWallet`（`funds-order.service.ts:175`），不排 swap |
| 唯一合成壳 = scenario-1 | `recon-demo.ts:579` 全库唯一 `fundsOrders.create`；:594 造外部行；:609 `bumpClosing` |
| 外部对账单行 schema | `external_statement_lines`（source/accountRef/subAccount/book/currency/direction/amount/externalRef/datetime/description/dedupKey）——scenario-1 :594 有完整样例 |
| on-stack 跑 demo 需 PATH | `export PATH="$PWD/node_modules/.bin:$PATH"` 后 `bash scripts/on-stack.sh self <script>` |

---

### Task 0: worktree 环境就位（一次性）

**Files:** 无（环境准备）

- [ ] **Step 1: 装依赖 + prisma client + 起 self 栈**

```bash
cd .claude/worktrees/demo-realdata/Exchange_js   # 相对仓库根
npm install >/tmp/dr-be-install.log 2>&1 && echo BE_OK
npm run prisma:generate >/tmp/dr-prisma.log 2>&1 && echo PRISMA_OK
(cd admin-web && npm install >/tmp/dr-admin-install.log 2>&1) && echo ADMIN_OK
bash scripts/stack.sh up 2>&1 | tail -4     # 自动分端口，记下 .stackports
bash scripts/stack.sh status | grep demo-realdata
```

Expected: 栈起（backend/admin/client/TB 四端口），DB `/tmp/exchange_js_wt_demo_realdata/dev.db`（注意下划线）。

- [ ] **Step 2: 播业务数据（base+business+demo:all，金闸门/夹具都要真钱包）**

```bash
export PATH="$PWD/node_modules/.bin:$PATH"
bash scripts/on-stack.sh self db:biz:init >/tmp/dr-biz.log 2>&1 && echo BIZ_OK
bash scripts/on-stack.sh self demo:all >/tmp/dr-demoall.log 2>&1 && echo DEMOALL_OK
```

Expected: 客户/钱包/充值/提现/swap 就位（全 SUCCESS）。记录本 worktree 的 DB 路径 `<DB>`=`/tmp/exchange_js_wt_demo_realdata/dev.db` 供后续任务。

---

### Task 1: `createStuckWithdraw()` 共享夹具（真卡提现在途）

**Files:**
- Create: `scripts/demo-fixtures.ts`（共享夹具模块）
- Test: 无单测 → Step 内跑命令 + recon 断言

- [ ] **Step 1: 写夹具函数骨架**

`scripts/demo-fixtures.ts`：

```ts
// 共享 demo 夹具：造"真实卡在半路"的在途单。被 demo:in-transit（Command 1）
// 与 recon-demo scenario-1（Command 2 去壳）复用——一份逻辑两处用。
import { Prisma } from '@prisma/client';
import { FundsOrderAction } from '../src/modules/funds-orders/dto/funds-order.dto';

// 造一笔真实提现并停在 CONFIRMING（POST 未做、funds order 非终态），
// 再注入一条外部出金对账单行（银行已确认出金）→ recon 认领为 IN_TRANSIT。
// 返回 { withdrawNo, fundsOrderNo, walletRef, externalRef, amount } 供 manifest/断言。
export async function createStuckWithdraw(ctx: any, opts: { customer: any; asset: any; amount: string; cutoff: Date }) {
  const { customer: c, asset, amount, cutoff } = opts;
  // 1. 造提现 → PAYOUT_PENDING（照 demo-lib.runWithdraw 前半段）
  const wq: any = await ctx.withdrawQuote.createQuote({
    ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
    assetId: asset.id, assetCode: asset.currency, amount: new Prisma.Decimal(amount), customerId: c.id,
  } as any);
  const wd: any = await ctx.withdrawWf.createWithdrawal(
    { assetId: asset.id, amount, toIban: c.demoIban ?? undefined, toAddress: c.demoAddress ?? undefined, quoteId: wq.id } as any,
    c.id, 'CUSTOMER',
  );
  await ctx.waitFor(`${wd.withdrawNo} PENDING_COMPLIANCE`, async () => {
    const w: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
    return w.status === 'PENDING_COMPLIANCE' ? w : null;
  });
  await ctx.withdraws.updateKytStatus(wd.id, 'PASSED', null, 5, 1);
  if (asset.type === 'CRYPTO') await ctx.withdraws.updateTravelRuleStatus(wd.id, 'PASSED', null);
  await ctx.waitFor(`${wd.withdrawNo} PAYOUT_PENDING`, async () => {
    const w: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
    return w.status === 'PAYOUT_PENDING' ? w : null;
  }, 8000);

  // 2. 拿 payout 主腿（legSeq 1），推到 CONFIRMING 停住（不 CONFIRM → 不 POST/CLEAR）
  const [leg] = await ctx.fundsOrders.findByParent({ withdrawTransactionId: wd.id }, { legSeq: 1 });
  const legIsCrypto = (leg.asset?.type || '').toUpperCase() !== 'FIAT';
  // fiat 腿的中间非终态：SUBMIT 后即 SUBMITTED（无 OBSERVE 步）；crypto：SUBMIT→OBSERVE_CONFIRMING→CONFIRMING。
  // ⚠️ 确切停点要 Step 3 实测确认能落 IN_TRANSIT；先按下方推进，实测后调整。
  await ctx.fundsOrders.advance(leg.id, FundsOrderAction.SUBMIT, 'DEMO');
  if (legIsCrypto) await ctx.fundsOrders.advance(leg.id, FundsOrderAction.OBSERVE_CONFIRMING, 'DEMO');
  const stuck = await ctx.fundsOrders.findById(leg.id);

  // 3. 注入外部出金对账单行（银行已确认出金），externalRef = 腿的 referenceNo/txHash
  const walletRef = stuck.fromWalletId; // OUT：钱从客户钱包出
  const externalRef = stuck.txHash ?? stuck.referenceNo;
  await ctx.prisma.externalStatementLine.create({
    data: {
      source: asset.type === 'CRYPTO' ? 'HEXTRUST' : 'ZAND',
      accountRef: walletRef, subAccount: walletRef,
      book: 'CLIENT', currency: asset.currency, direction: 'OUT',
      amount: new Prisma.Decimal(amount), externalRef,
      datetime: cutoff, description: 'Demo stuck withdraw — bank confirmed outflow, internal POST pending',
      dedupKey: `DEMO-STUCK-WD-${wd.withdrawNo}`,
    },
  });
  return { withdrawNo: wd.withdrawNo, fundsOrderNo: stuck.fundsOrderNo, walletRef, externalRef, amount, fundsOrderId: stuck.id };
}
```

（`ctx` 需带 `waitFor`；若 demo-lib 的 `waitFor` 未挂到 ctx，Step 2 里从 demo-lib import 直接用。）

- [ ] **Step 2: 建一个最小驱动脚本试跑（临时）**

`scripts/_try-stuck-wd.ts`（临时，Task 3 删）：bootstrap → ensureSetup → 取一个客户+法币资产 → `createStuckWithdraw(ctx, {...})` → console.log 返回值。跑：

```bash
export PATH="$PWD/node_modules/.bin:$PATH"
DATABASE_URL="file:/tmp/exchange_js_wt_demo_realdata/dev.db" TB_ADDRESS=127.0.0.1:<TBport> ts-node -r tsconfig-paths/register scripts/_try-stuck-wd.ts
```

Expected: 打印 `{withdrawNo, fundsOrderNo, walletRef, ...}`，无异常。sqlite 确认该 funds order 非终态：

```bash
sqlite3 <DB> "SELECT \"fundsOrderNo\", status FROM funds_orders WHERE \"fundsOrderNo\"='<打印的>';"
```

Expected: status ∈ {SUBMITTED, CONFIRMING}（非 CLEARED/FAILED）。

- [ ] **Step 3: 实测确认 recon 落 IN_TRANSIT（机制唯一不确定点）**

```bash
export PATH="$PWD/node_modules/.bin:$PATH"
bash scripts/on-stack.sh self recon:rerun >/tmp/dr-rerun1.json 2>&1
sqlite3 <DB> "SELECT rw.bucket, rw.deltaAmount, rw.inTransitAmount FROM reconciliation_run_wallets rw JOIN reconciliation_runs r ON r.id=rw.runId WHERE rw.walletRef='<walletRef>' ORDER BY r.createdAt DESC LIMIT 1;"
```

Expected: `bucket=IN_TRANSIT`（残差 0、inTransitAmount=amount）。
**若落 BREAK/其它**：调整 Step 1 的停点——试只推到 SUBMITTED（不 OBSERVE），或推到 CONFIRMING 后再看；关键是"外部有出金行、内部 POST 未做、非终态单解释差额"。逐一试直到 IN_TRANSIT，把成功的推进序列固化进 `createStuckWithdraw`，注释写明"实测 X 状态落 IN_TRANSIT"。**这是本任务的核心验收——没到 IN_TRANSIT 不算完。**

- [ ] **Step 4: Commit**

```bash
git add scripts/demo-fixtures.ts
git commit -m "feat(demo): createStuckWithdraw 夹具——真提现停 CONFIRMING+外部出金行，recon 落 IN_TRANSIT（实测确认）"
```

---

### Task 2: `createStuckSwap()` 共享夹具（真卡 swap 在途）

**Files:**
- Modify: `scripts/demo-fixtures.ts`（加 `createStuckSwap`）
- Test: 无单测 → Step 内 recon 断言

- [ ] **Step 1: 加 `createStuckSwap`**

`demo-fixtures.ts` 追加：

```ts
// 造一笔真实 swap，推腿 1-2 到 CLEARED、腿 3-4 留非终态（fiat settled / crypto pending）。
// swap 腿 isExternalCrossing 全 true → 非终态腿在其钱包上被 recon 认领为 IN_TRANSIT。
// 注：push 现不接 swap（BACKLOG），本夹具当前只演检测。
export async function createStuckSwap(ctx: any, opts: { customer: any; fromAsset: any; toAsset: any; amount: string }) {
  const { customer: c } = opts;
  // 1. 造 swap（照 demo-lib.runSwap 造法：createQuote + createSwap → PROCESSING，leg1 CREATED）
  //    具体 createSwap 入参照 demo-lib.ts runSwaps/ensureSetup 里的样例抄。
  const swap: any = await ctx.swapWf.createSwap(/* ...照 demo-lib... */);
  // 2. 逐腿推进：leg1、leg2 推到 CLEARED（每腿 SUBMIT→[OBSERVE]→CONFIRM→handler CLEAR），
  //    leg3、leg4 不推（留 CREATED/非终态）。用 findByParent 拿腿、按 legSeq 排序。
  const legs: any[] = (await ctx.fundsOrders.findByParent({ swapTransactionId: swap.id }, {})).sort((a: any, b: any) => a.legSeq - b.legSeq);
  for (const leg of legs.filter((l: any) => l.legSeq <= 2)) {
    const seq = (leg.asset?.type || '').toUpperCase() !== 'FIAT'
      ? [FundsOrderAction.SUBMIT, FundsOrderAction.OBSERVE_CONFIRMING, FundsOrderAction.CONFIRM]
      : [FundsOrderAction.SUBMIT, FundsOrderAction.CONFIRM];
    for (const a of seq) { await ctx.fundsOrders.advance(leg.id, a, 'DEMO'); await ctx.sleep(60); }
  }
  const stuckLeg = (await ctx.fundsOrders.findByParent({ swapTransactionId: swap.id }, { legSeq: 3 }))[0];
  return { swapNo: swap.swapNo, stuckLegNo: stuckLeg?.fundsOrderNo, walletRef: stuckLeg?.fromWalletId ?? stuckLeg?.toWalletId };
}
```

⚠️ `createSwap` 确切入参 + leg 推进细节以 `demo-lib.ts` `runSwaps`/`ensureSetup` 实际代码为准（read 后照抄），本骨架给结构。

- [ ] **Step 2: 临时驱动试跑 + 非终态确认**

同 Task 1 Step 2 模式，`scripts/_try-stuck-swap.ts`（临时）跑 `createStuckSwap`。sqlite 确认 leg1-2 CLEARED、leg3-4 非终态：

```bash
sqlite3 <DB> "SELECT \"legSeq\", status FROM funds_orders WHERE \"swapTransactionId\"=(SELECT id FROM swap_transactions WHERE \"swapNo\"='<swapNo>') ORDER BY \"legSeq\";"
```

Expected: legSeq 1,2 = CLEARED；3,4 ∈ 非终态。

- [ ] **Step 3: recon 断言 swap 钱包 IN_TRANSIT**

```bash
export PATH="$PWD/node_modules/.bin:$PATH"
bash scripts/on-stack.sh self recon:rerun >/dev/null 2>&1
sqlite3 <DB> "SELECT rw.bucket FROM reconciliation_run_wallets rw JOIN reconciliation_runs r ON r.id=rw.runId WHERE rw.walletRef='<swap walletRef>' ORDER BY r.createdAt DESC LIMIT 1;"
```

Expected: `IN_TRANSIT`（非终态 swap 腿被认领）。若非，按 Task1 Step3 同法调停点。

- [ ] **Step 4: Commit**

```bash
git add scripts/demo-fixtures.ts
git commit -m "feat(demo): createStuckSwap 夹具——腿1-2完/3-4卡，recon 落 IN_TRANSIT（实测确认）"
```

---

### Task 3: `demo:in-transit` 命令（Command 1 入口）

**Files:**
- Create: `scripts/demo-in-transit.ts`
- Modify: `package.json`（加 `demo:in-transit` 脚本）
- Delete: `scripts/_try-stuck-wd.ts`、`scripts/_try-stuck-swap.ts`（临时驱动）

- [ ] **Step 1: 写命令入口**

`scripts/demo-in-transit.ts`（照 recon-demo.ts 的 bootstrap 前言：webcrypto polyfill + NestFactory.createApplicationContext(AppModule) + app.get 各 service 组 ctx）：

```ts
// Command 1：造一批真实在途单（提现 + swap），供推单/处置演示 + Command 2 复用。
// Run: npm run demo:in-transit   [--verify]
import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
// import 各 service + demo-lib bootstrap/ensureSetup/resolveDemoCustomers + demo-fixtures
import { createStuckWithdraw, createStuckSwap } from './demo-fixtures';

async function main() {
  const verify = process.argv.includes('--verify');
  // bootstrap ctx（照 demo-lib.bootstrap 或直接 createApplicationContext + app.get）
  // ensureSetup(ctx); 取客户 + 法币/加密资产
  const cutoff = new Date();
  const wd = await createStuckWithdraw(ctx, { customer, asset: fiatAsset, amount: '500', cutoff });
  const sw = await createStuckSwap(ctx, { customer, fromAsset, toAsset, amount: '1000' });
  console.log('stuck withdraw:', wd);
  console.log('stuck swap:', sw);
  if (verify) {
    // 触发 recon + 断言两钱包 IN_TRANSIT；推提现单 heal + 断言 delta→0（见 Task 5 e2e 逻辑内联）
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

`package.json` scripts 加（紧挨 recon:rerun）：

```json
    "demo:in-transit": "DATABASE_URL=\"file:/tmp/exchange_js_main/dev.db\" TB_ADDRESS=127.0.0.1:3003 ts-node -r tsconfig-paths/register scripts/demo-in-transit.ts",
```

（on-stack 包装器会覆盖 DB/TB 到 self 栈。）

- [ ] **Step 2: 删临时脚本 + 跑命令**

```bash
rm -f scripts/_try-stuck-wd.ts scripts/_try-stuck-swap.ts
export PATH="$PWD/node_modules/.bin:$PATH"
bash scripts/on-stack.sh self demo:in-transit 2>&1 | tail -8
```

Expected: 打印 stuck withdraw + stuck swap 摘要，无异常。

- [ ] **Step 3: tsc + Commit**

```bash
npx tsc --noEmit
git add scripts/demo-in-transit.ts package.json
git rm --cached scripts/_try-stuck-wd.ts scripts/_try-stuck-swap.ts 2>/dev/null || true
git commit -m "feat(demo): demo:in-transit 命令（Command 1）——一键造真实提现/swap 在途夹具"
```

---

### Task 4: `recon:demo:break` 场景 1 去壳（Command 2）

**Files:**
- Modify: `scripts/recon-demo.ts`（scenario-1 块 :568-646 换成调 `createStuckWithdraw`）

- [ ] **Step 1: 替换 scenario-1 造法**

`recon-demo.ts` scenario-1 块（现 :576-646 空心单+bumpClosing）改为：调 `createStuckWithdraw(ctx, {customer=s1Plan 对应客户, asset, amount:'101', cutoff})`，用返回的 `{walletRef, fundsOrderNo, externalRef, amount}` 填 `injections.push({scenarioId:1, rootCause:'IN_TRANSIT_TIMING', walletRef, expectedBucket:'IN_TRANSIT', ...})`。删除该块内的 `fundsOrders.create` 空壳 + `externalStatementLine.create`（夹具内已注入）+ `bumpClosing`（真单+真外部行天然形成差额，不需手调）。

⚠️ recon-demo 的 walletPlan 挑钱包逻辑（:471-527）要能提供 `createStuckWithdraw` 需要的客户+资产；若 s1Plan 只有 walletRef 没有 customer/asset 句柄，加一步用 walletRef 反查 wallet→owner→customer + asset。read :471-527 后对齐。

- [ ] **Step 2: 重捕金闸门基线（去壳后是新基线）**

```bash
export PATH="$PWD/node_modules/.bin:$PATH"
bash scripts/on-stack.sh self recon:demo:reset && bash scripts/on-stack.sh self recon:demo:break 2>&1 | tee /tmp/dr-golden.txt | grep -E "score:|identity|manifest detected|ALL 9|#1 "
```

Expected: `score: 9/9 DETECTED`、两恒等式 OK、`#1 IN_TRANSIT_TIMING ... bucket=IN_TRANSIT`（现在背后是真提现单，非壳）、`ALL 9 SCENARIOS DETECTED`。存 `/tmp/dr-golden.txt` 当新基线。

- [ ] **Step 3: tsc + Commit**

```bash
npx tsc --noEmit
git add scripts/recon-demo.ts
git commit -m "feat(demo): recon:demo scenario-1 去合成壳——复用 createStuckWithdraw 真提现在途（金闸门跑真单）"
```

---

### Task 5: heal e2e 闭环 + 硬闸 + 文档收口

**Files:**
- Modify: `doc-final/reference/roadmap.md`、`doc-final/BACKLOG.md`（勾掉「缺真实卡单 demo 场景」）

- [ ] **Step 1: 完整 heal e2e（补齐 T5 演不出的那一环）**

```bash
export PATH="$PWD/node_modules/.bin:$PATH"
# 1. 造真实在途
bash scripts/on-stack.sh self demo:in-transit >/tmp/dr-fixture.txt 2>&1
# 记下 stuck withdraw 的 fundsOrderNo + walletRef
# 2. recon → 该钱包 IN_TRANSIT
bash scripts/on-stack.sh self recon:rerun >/dev/null 2>&1
sqlite3 <DB> "SELECT bucket,deltaAmount FROM reconciliation_run_wallets rw JOIN reconciliation_runs r ON r.id=rw.runId WHERE rw.walletRef='<walletRef>' ORDER BY r.createdAt DESC LIMIT 1;"  # IN_TRANSIT
# 3. push sync（自愈）：需 admin token（种子 admin@fiatx.com/123456），POST self 栈 backend
TOKEN=$(curl -s -X POST http://localhost:<beport>/auth/login -H "Content-Type: application/json" -d '{"email":"admin@fiatx.com","password":"123456"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s -X POST "http://localhost:<beport>/admin/funds-orders/<fundsOrderNo>/push/sync" -H "Authorization: Bearer $TOKEN"   # finalStatus=CLEARED
# 4. 重对账 → delta 归 0、case 自愈
bash scripts/on-stack.sh self recon:rerun >/dev/null 2>&1
sqlite3 <DB> "SELECT bucket,deltaAmount FROM reconciliation_run_wallets rw JOIN reconciliation_runs r ON r.id=rw.runId WHERE rw.walletRef='<walletRef>' ORDER BY r.createdAt DESC LIMIT 1;"  # deltaAmount=0, bucket≠IN_TRANSIT
```

Expected: 第 4 步 `deltaAmount=0` 且桶从 IN_TRANSIT 变走（MATCHED 或 case AUTO_HEALED）——**这就是 T5 在合成壳上演不出、本轮补齐的完整 heal 闭环**。贴每步真实输出。

- [ ] **Step 2: 前端渲染验证**

preview（self 栈 admin 端口）：case 详情真实在途行 → 去处理 → 侧栏推单 → 回 case 看"已推进·待重对账" → 重新对账 → case RESOLVED。截图 2-3 帧。够不到 preview 就诚实说明 + 数据契约层验证。

- [ ] **Step 3: 全局硬闸**

```bash
npx tsc --noEmit && (cd admin-web && npx tsc -b) && npx jest --silent 2>&1 | tail -3
```

Expected: 双 tsc 0；jest 净新增失败 0（基线 asset-treasury/wallets）。demo 脚本改动不碰业务代码，jest 应无新失败。

- [ ] **Step 4: 文档收口 + Commit**

BACKLOG 勾掉「缺真实卡单 demo 场景」条（改 `[x] ~~...~~ 已交付：demo:in-transit + scenario-1 去壳，heal 闭环端到端演证`）。roadmap 加交付记录（两命令、真卡单机制、heal 闭环）。

```bash
git add doc-final/
git commit -m "docs(demo): 真实数据夹具交付记录 + BACKLOG 缺真实卡单场景收口"
```

---

## 自审记录

- **Spec 覆盖**：§2.1 提现在途→T1；§2.2 swap 在途→T2；§2.3 复用形态→demo-fixtures 共享模块（T1-2）；§3 Command 2 去壳→T4；§4 咬合→T3+T4 复用同函数；§5 heal 叙事→T3 --verify + T5 e2e；§6 验收→T5 硬闸/e2e/前端。
- **占位符**：机制唯一不确定点（提现确切停点落 IN_TRANSIT）显式设为 T1 Step3 实测验收，不假装知道确切 advance 次数——这是对复杂状态机的诚实规划，非占位。swap createSwap 入参标注"照 demo-lib 抄"（真实来源明确）。
- **类型一致**：`createStuckWithdraw`/`createStuckSwap` 签名两处引用一致；返回 `{walletRef, fundsOrderNo, externalRef, amount}` 贯穿 T1/T3/T4/T5。
- **已知边界**：demo 脚本无单测传统 → 验证靠跑命令+sqlite+recon 断言（对标 recon:demo manifest）；self 栈端口/DB 下划线路径逐任务用 `<DB>`/`<beport>` 占位，Task0 拿到后代入。
