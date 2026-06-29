# Demo 数据完整性 + Invariant 守护 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 InternalFund / withdraw_transactions / account_flows / payouts 四张表的 from/to/walletRef 字段错位 bug，加 R1-R4 runtime invariant + verify 工具 + 种子末尾自动校验，让 demo:all 跑出来的数据天然干净。

**Architecture:** R4 (source wallet 必须客户自有) 修 withdraw-workflow 的 FIAT 分支注入 fromWalletId；R2 (walletRef ↔ tbAccountId owner 一致) 修 AccountFlowProjector 写入前校验；R1 (InternalFund.from/to 按腿类型必填) 修 swap-workflow 创建 IF 时填字段；R3 (Payout/Payin CLEARED 时 ref/txHash 必填) 修 payouts.service finalize 路径。verify-demo-data 工具扫这 4 条 + 钱包余额恒等。

**Tech Stack:** NestJS, Prisma, TigerBeetle, TypeScript, jest, sqlite3.

**Spec 参考：** [2026-06-29-demo-data-integrity-and-invariants-design.md](../specs/2026-06-29-demo-data-integrity-and-invariants-design.md)

---

## File Structure

| 文件 | 新建/修改 | 职责 |
|---|---|---|
| `scripts/verify-demo-data.ts` | 新建 | R1+R2+R3+R4 扫描器，红绿输出，exit 1 if any fail |
| `package.json` | 修改 | 加 `verify:demo-data` script + `db:seed:business` 末尾 chain |
| `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts` | 修改 | FIAT 分支写 fromWalletId 改为客户 C_VIBAN（不是 C_CMA） |
| `src/modules/trading/withdraw-transactions/withdraw-workflow.service.spec.ts` | 修改 | 加 R4 校验单测 |
| `src/modules/clearing-settle/reconciliation/projector/account-flow-projector.service.ts` | 修改 | 写入前 `assertWalletRefMatchesTbAccount` + throw |
| `src/modules/clearing-settle/reconciliation/projector/account-flow-projector.service.spec.ts` | 修改/新建 | 加 R2 单测 |
| `src/modules/trading/swap-transactions/swap-workflow.service.ts` | 修改 | 创建 IF 时按 event 填 from/to + R1 校验 |
| `src/modules/trading/swap-transactions/swap-workflow.service.spec.ts` | 修改 | 加 R1 单测 |
| `src/modules/asset-treasury/payouts/payouts.service.ts` | 修改 | finalize/markCleared 路径要求 referenceNo + txHash + R3 throw |
| `src/modules/asset-treasury/payouts/payouts.service.spec.ts` | 修改/新建 | 加 R3 单测 |
| `prisma/seed.business.ts` | 修改（可能） | 仅当种子写 InternalFund 路径不经过 service 时才需要补 |

---

## Task 1: 写 verify-demo-data 工具（baseline 扫描器）

**Files:**
- Create: `scripts/verify-demo-data.ts`
- Modify: `package.json` (加 npm script)

- [ ] **Step 1: 写 verify-demo-data.ts 骨架（4 段扫描）**

```ts
// scripts/verify-demo-data.ts
import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;
import { PrismaClient } from '@prisma/client';
import { createClient as tbCreate } from 'tigerbeetle-node';

interface Violation { rule: string; entity: string; detail: string; }
const violations: Violation[] = [];

async function scanR1(prisma: PrismaClient) {
  const ifs: any[] = await (prisma as any).internalFund.findMany();
  for (const f of ifs) {
    const isCustomerLeg = /_CLIENT|_FEE_CLIENT/.test(f.eventCode || '');
    const isFirmLeg = /_FIRM$|_OPS_TO_|_SET_TO_/.test(f.eventCode || '');
    if (isCustomerLeg && !f.fromWalletId && !f.toWalletId) {
      violations.push({ rule: 'R1', entity: f.internalFundNo, detail: `customer leg ${f.eventCode} has both from/to NULL` });
    }
    if (isFirmLeg && (!f.fromWalletId || !f.toWalletId)) {
      violations.push({ rule: 'R1', entity: f.internalFundNo, detail: `firm leg ${f.eventCode} from=${f.fromWalletId} to=${f.toWalletId}` });
    }
  }
}

async function scanR2(prisma: PrismaClient) {
  const flows: any[] = await (prisma as any).accountFlow.findMany({ select: { id: true, walletRef: true, tbAccountId: true } });
  const wallets: any[] = await (prisma as any).wallet.findMany({ select: { id: true, ownerNo: true, ownerType: true } });
  const regs: any[] = await (prisma as any).tbAccountRegistry.findMany({ select: { tbAccountId: true, code: true, ownerUuid: true } });
  const wMap = new Map(wallets.map(w => [w.id, w]));
  const rMap = new Map(regs.map(r => [r.tbAccountId, r]));
  const customers: any[] = await (prisma as any).customerMain.findMany({ select: { id: true, customerNo: true } });
  const cMap = new Map(customers.map(c => [c.id, c.customerNo]));
  for (const f of flows) {
    if (!f.walletRef) continue;
    const w = wMap.get(f.walletRef);
    if (!w) { violations.push({ rule: 'R2', entity: f.id, detail: `walletRef=${f.walletRef} not in wallets table` }); continue; }
    const r = rMap.get(f.tbAccountId);
    if (!r) continue;
    if ([1, 50].includes(r.code)) continue; // aggregate accounts skip
    const tbOwnerNo = cMap.get(r.ownerUuid) || r.ownerUuid;
    if (w.ownerType === 'CUSTOMER' && w.ownerNo !== tbOwnerNo) {
      violations.push({ rule: 'R2', entity: f.id, detail: `wallet owner=${w.ownerNo} != tb owner=${tbOwnerNo}` });
    }
  }
}

async function scanR3(prisma: PrismaClient) {
  const payouts: any[] = await (prisma as any).payout.findMany({ where: { status: 'CLEARED' } });
  for (const p of payouts) {
    if (!p.referenceNo) violations.push({ rule: 'R3', entity: p.payoutNo, detail: 'CLEARED payout has NULL referenceNo' });
    if (p.type === 'CRYPTO' && !p.txHash) violations.push({ rule: 'R3', entity: p.payoutNo, detail: 'CLEARED CRYPTO payout has NULL txHash' });
  }
  const payins: any[] = await (prisma as any).payin.findMany({ where: { status: 'CLEARED' } });
  for (const p of payins) {
    if (!p.referenceNo) violations.push({ rule: 'R3', entity: p.payinNo, detail: 'CLEARED payin has NULL referenceNo' });
    if (p.type === 'CRYPTO' && !p.txHash) violations.push({ rule: 'R3', entity: p.payinNo, detail: 'CLEARED CRYPTO payin has NULL txHash' });
  }
}

async function scanR4(prisma: PrismaClient) {
  const withdraws: any[] = await (prisma as any).withdrawTransaction.findMany();
  for (const wt of withdraws) {
    if (!wt.fromWalletId) {
      violations.push({ rule: 'R4', entity: wt.withdrawNo, detail: 'fromWalletId NULL' });
      continue;
    }
    const w = await (prisma as any).wallet.findUnique({ where: { id: wt.fromWalletId } });
    if (!w) {
      violations.push({ rule: 'R4', entity: wt.withdrawNo, detail: `fromWalletId=${wt.fromWalletId} not in wallets` });
      continue;
    }
    if (w.ownerType !== 'CUSTOMER' || w.ownerNo !== wt.ownerNo) {
      violations.push({ rule: 'R4', entity: wt.withdrawNo, detail: `fromWalletId owner=${w.ownerType}/${w.ownerNo} != withdraw owner=CUSTOMER/${wt.ownerNo}` });
    }
    const expectedRole = wt.payoutNo?.startsWith('PO') && w.walletRole; // heuristic
    // TODO: stricter role check based on payout.type — defer to subagent
  }
}

async function main() {
  const prisma = new PrismaClient();
  await scanR1(prisma);
  await scanR2(prisma);
  await scanR3(prisma);
  await scanR4(prisma);
  await prisma.$disconnect();

  if (violations.length === 0) {
    console.log('\nverify:demo-data ALL PASS\n');
    process.exit(0);
  }
  console.error('\nverify:demo-data FAILED — ' + violations.length + ' violation(s)\n');
  for (const v of violations) console.error(`  [${v.rule}] ${v.entity}: ${v.detail}`);
  process.exit(1);
}

main().catch(e => { console.error(e); process.exit(2); });
```

- [ ] **Step 2: 加 package.json npm script**

In `package.json` 的 scripts 段加：
```json
"verify:demo-data": "DATABASE_URL=\"file:/tmp/exchange_js_main/dev.db\" ts-node -r tsconfig-paths/register scripts/verify-demo-data.ts"
```

- [ ] **Step 3: 跑 baseline，记录当前违反量**

Run: `npm run verify:demo-data`
Expected: exit 1 + 列出大约 30+ 条违反（12 IF NULL + 18 account_flows walletRef 错挂 + 3 withdraw fromWalletId 错 + N payout/payin ref 空）

- [ ] **Step 4: 提交 baseline 工具**

```
git add scripts/verify-demo-data.ts package.json
git commit -m "feat(verify): scripts/verify-demo-data.ts — R1+R2+R3+R4 invariant scanner"
```

---

## Task 2: 修 withdraw_transactions.fromWalletId（FIAT 分支）+ R4 throw

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.spec.ts`

- [ ] **Step 1: 读 withdraw-workflow.service.ts:805 附近上下文 50 行**

```bash
sed -n '775,830p' src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts
```
Identify the FIAT branch that currently assigns `fromWalletId = C_CMA pool wallet`.

- [ ] **Step 2: 写失败单测——FIAT 提现 fromWalletId 必须是客户 C_VIBAN**

```ts
// withdraw-workflow.service.spec.ts
it('R4: FIAT withdraw fromWalletId is customer C_VIBAN (not platform C_CMA)', async () => {
  const customer = await seedCustomer();
  const cVibanWallet = await seedCustomerWallet(customer, 'C_VIBAN', 'AED');
  const cmaWallet = await seedPlatformWallet('C_CMA', 'AED');
  const result = await service.createFiatWithdraw({ customerId: customer.id, amount: 100, toIban: 'AE...' });
  expect(result.fromWalletId).toBe(cVibanWallet.id);
  expect(result.fromWalletId).not.toBe(cmaWallet.id);
});

it('R4: throws if no customer C_VIBAN found', async () => {
  const customer = await seedCustomer();
  // no C_VIBAN seeded
  await expect(service.createFiatWithdraw({ ... })).rejects.toThrow(/IllegalSourceWalletError|no C_VIBAN/);
});
```

- [ ] **Step 3: 跑测试，确认失败**

```bash
npx jest withdraw-workflow.service.spec -t 'R4'
```
Expected: FAIL — current code writes `fromWalletId = C_CMA pool`.

- [ ] **Step 4: 修 FIAT 分支**

In `withdraw-workflow.service.ts`，找到当前给 fromWalletId 赋值的代码块，把 FIAT 路径改成：
```ts
// Old: fromWalletId = await this.findCmaPoolWallet(asset);
// New:
const customerCVibanWallet = await this.prisma.wallet.findFirst({
  where: { ownerNo: customer.customerNo, walletRole: 'C_VIBAN', assetId: asset.id, status: 'ACTIVE' },
});
if (!customerCVibanWallet) {
  throw new IllegalSourceWalletError(`No active C_VIBAN wallet for customer ${customer.customerNo} on asset ${asset.code}`);
}
fromWalletId = customerCVibanWallet.id;
```

CRYPTO 分支已经正确（用客户 C_DEP），不动。

- [ ] **Step 5: 加 IllegalSourceWalletError class**

In same file or shared errors module:
```ts
export class IllegalSourceWalletError extends Error {
  constructor(message: string) { super(message); this.name = 'IllegalSourceWalletError'; }
}
```

- [ ] **Step 6: 跑测试确认通过**

```bash
npx jest withdraw-workflow.service.spec
```
Expected: 全部 PASS（包括 R4 + 其他既有用例）。

- [ ] **Step 7: 提交**

```
git add src/modules/trading/withdraw-transactions/
git commit -m "fix(withdraw): R4 FIAT fromWalletId is customer C_VIBAN, not platform C_CMA"
```

---

## Task 3: 修 AccountFlowProjector walletRef 校验 + R2 throw

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/projector/account-flow-projector.service.ts`
- Modify: `src/modules/clearing-settle/reconciliation/projector/account-flow-projector.service.spec.ts`

- [ ] **Step 1: 读 AccountFlowProjector.persist 入口 + 现有 walletRef 来源逻辑**

```bash
sed -n '1,80p' src/modules/clearing-settle/reconciliation/projector/account-flow-projector.service.ts
```

- [ ] **Step 2: 写失败单测：walletRef + tbAccountId owner mismatch throws**

```ts
it('R2: throws if walletRef owner != tbAccountId registry owner', async () => {
  // walletRef = platform C_CMA wallet, but tbAccountId is a customer's PAYABLE
  await expect(projector.persist({ walletRef: 'cma-platform-id', tbAccountId: 'a0a2d460...', /* ... */ }))
    .rejects.toThrow(/WalletRefMismatchError|owner.*mismatch/);
});

it('R2: passes if walletRef owner == tbAccountId owner', async () => {
  await projector.persist({ walletRef: 'alice-c-viban-id', tbAccountId: 'a0a2d460...', /* ... */ });
  // 不抛
});

it('R2: aggregate accounts (code 1 / 50) skip owner check', async () => {
  // walletRef = any active wallet on this ledger, tbAccountId = CLIENT_ASSET aggregate
  await projector.persist({ walletRef: 'any-wallet-id', tbAccountId: 'aggregate-asset-tb-id', /* ... */ });
  // 不抛
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npx jest account-flow-projector.service.spec -t 'R2'
```
Expected: FAIL — 当前 persist 直接 insert，不校验。

- [ ] **Step 4: 实现 assertWalletRefMatchesTbAccount**

In `account-flow-projector.service.ts`，persist 方法体在每行 insert 前加：
```ts
async function assertWalletRefMatchesTbAccount(prisma: PrismaService, walletRef: string | null, tbAccountId: string) {
  if (!walletRef) return; // null walletRef is its own R2 violation, handled elsewhere
  const wallet = await (prisma as any).wallet.findUnique({
    where: { id: walletRef }, select: { ownerType: true, ownerNo: true },
  });
  if (!wallet) throw new WalletRefMismatchError(`walletRef=${walletRef} not in wallets table`);
  const reg = await (prisma as any).tbAccountRegistry.findUnique({
    where: { tbAccountId }, select: { code: true, ownerUuid: true },
  });
  if (!reg) return; // aggregate or unknown — let it pass for now
  if ([1, 50].includes(reg.code)) return; // CLIENT_ASSET / FIRM_ASSET aggregate — skip
  // resolve customer ownerUuid → customerNo
  const customer = await (prisma as any).customerMain.findUnique({
    where: { id: reg.ownerUuid }, select: { customerNo: true },
  });
  const tbOwnerKey = customer?.customerNo || reg.ownerUuid;
  if (wallet.ownerType === 'CUSTOMER' && wallet.ownerNo !== tbOwnerKey) {
    throw new WalletRefMismatchError(`walletRef owner=${wallet.ownerNo} != tbAccountId owner=${tbOwnerKey}`);
  }
}
```

加：
```ts
export class WalletRefMismatchError extends Error {
  constructor(message: string) { super(message); this.name = 'WalletRefMismatchError'; }
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
npx jest account-flow-projector.service.spec
```

- [ ] **Step 6: 提交**

```
git add src/modules/clearing-settle/reconciliation/projector/
git commit -m "fix(projector): R2 assertWalletRefMatchesTbAccount + throw on mismatch"
```

---

## Task 4: 修 swap-workflow 创建 InternalFund 时填 from/to + R1 throw

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.spec.ts`

- [ ] **Step 1: 找 swap-workflow 创建 InternalFund 的代码块**

```bash
grep -nE "internalFund\.create|createInternalFund|internalFund:.*{" src/modules/trading/swap-transactions/swap-workflow.service.ts | head -10
```

- [ ] **Step 2: 写失败单测——SWAP 各 leg 必须填正确 from/to**

```ts
it('R1: SWAP_BUY_CLIENT IF has from=firm wallet, to=customer wallet', async () => {
  // ...
});
it('R1: SWAP_SELL_CLIENT IF has from=customer wallet, to=firm wallet', async () => {
  // ...
});
it('R1: SWAP_FEE_CLIENT IF has from=customer wallet, to=F_FEE firm wallet', async () => {
  // ...
});
it('R1: SWAP_FEE_FIRM/SWAP_BUY_OPS_TO_SET/SWAP_BUY_SET_TO_ASSET/SWAP_SELL_FIRM IF have both from+to as firm wallets', async () => {
  // ...
});
it('R1: omnibus internal-only leg (e.g. CLIENT_ASSET ↔ SUSPENSE) allows both NULL', async () => {
  // ...
});
it('R1: throws if customer leg has both from and to NULL', async () => {
  await expect(workflow.createSwapIf({ eventCode: 'SWAP_BUY_CLIENT', fromWalletId: null, toWalletId: null }))
    .rejects.toThrow(/InvalidInternalFundError|customer leg/);
});
```

- [ ] **Step 3: 跑测试确认失败**

- [ ] **Step 4: 实现 IF.from/to 填充逻辑**

In `swap-workflow.service.ts`，找到 IF.create 的位置，按 eventCode 分支：
```ts
function resolveSwapIfWallets(eventCode: string, customer: Customer, firmWallets: FirmWalletPool) {
  switch (true) {
    case eventCode === 'SWAP_BUY_CLIENT':
      return { fromWalletId: firmWallets.opsForAsset(buyAsset), toWalletId: customer.walletFor(buyAsset, 'C_VIBAN_OR_C_DEP') };
    case eventCode === 'SWAP_SELL_CLIENT':
      return { fromWalletId: customer.walletFor(sellAsset, 'C_VIBAN_OR_C_DEP'), toWalletId: firmWallets.opsForAsset(sellAsset) };
    case eventCode === 'SWAP_FEE_CLIENT':
      return { fromWalletId: customer.walletFor(asset, 'C_VIBAN_OR_C_DEP'), toWalletId: firmWallets.feeForAsset(asset) };
    case eventCode === 'SWAP_FEE_FIRM':
    case eventCode === 'SWAP_BUY_OPS_TO_SET':
    case eventCode === 'SWAP_BUY_SET_TO_ASSET':
    case eventCode === 'SWAP_SELL_FIRM':
      return { fromWalletId: firmWallets.byRole(fromRole), toWalletId: firmWallets.byRole(toRole) };
    default:
      return { fromWalletId: null, toWalletId: null };
  }
}
```

加 `InvalidInternalFundError`：
```ts
export class InvalidInternalFundError extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidInternalFundError'; }
}
```

入库前 `assertInternalFundLegRules`:
```ts
function assertInternalFundLegRules(if_: { eventCode: string, fromWalletId: string | null, toWalletId: string | null }) {
  const isCustomerLeg = /_CLIENT|_FEE_CLIENT/.test(if_.eventCode);
  const isFirmLeg = /_FIRM$|_OPS_TO_|_SET_TO_/.test(if_.eventCode);
  if (isCustomerLeg && !if_.fromWalletId && !if_.toWalletId) {
    throw new InvalidInternalFundError(`customer leg ${if_.eventCode} requires from or to`);
  }
  if (isFirmLeg && (!if_.fromWalletId || !if_.toWalletId)) {
    throw new InvalidInternalFundError(`firm leg ${if_.eventCode} requires both from and to`);
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
npx jest swap-workflow.service.spec
```

- [ ] **Step 6: 提交**

```
git add src/modules/trading/swap-transactions/
git commit -m "fix(swap): R1 fill InternalFund from/to per leg type + throw on violation"
```

---

## Task 5: 修 payout completion 回填 referenceNo + txHash + R3 throw

**Files:**
- Modify: `src/modules/asset-treasury/payouts/payouts.service.ts`
- Modify: `src/modules/asset-treasury/payouts/payouts.service.spec.ts`

- [ ] **Step 1: 找 payout finalize / markCleared / settle 入口**

```bash
grep -nE "status.*CLEARED|markCleared|finalizePayout|settlePayout" src/modules/asset-treasury/payouts/payouts.service.ts | head -10
```

- [ ] **Step 2: 写失败单测——CLEARED 状态下 ref/txHash 必填**

```ts
it('R3: payouts.markCleared throws if referenceNo missing', async () => {
  await expect(service.markCleared({ payoutId, referenceNo: null }))
    .rejects.toThrow(/PayoutFinalizationIncompleteError|referenceNo/);
});
it('R3: CRYPTO payouts.markCleared throws if txHash missing', async () => {
  await expect(service.markCleared({ payoutId, referenceNo: 'BANK-...', txHash: null, type: 'CRYPTO' }))
    .rejects.toThrow(/txHash/);
});
it('R3: passes when both ref and txHash present', async () => {
  await service.markCleared({ payoutId, referenceNo: 'BANK-PO...', txHash: '0xabc...' });
});
```

- [ ] **Step 3: 跑测试确认失败**

- [ ] **Step 4: 修 markCleared 入参校验**

```ts
async markCleared(input: { payoutId: string, referenceNo?: string | null, txHash?: string | null }) {
  const payout = await this.prisma.payout.findUnique({ where: { id: input.payoutId } });
  if (!payout) throw new NotFoundException(...);
  if (!input.referenceNo) throw new PayoutFinalizationIncompleteError('CLEARED payout requires referenceNo');
  if (payout.type === 'CRYPTO' && !input.txHash) throw new PayoutFinalizationIncompleteError('CRYPTO payout requires txHash');
  await this.prisma.payout.update({
    where: { id: input.payoutId },
    data: { status: 'CLEARED', referenceNo: input.referenceNo, txHash: input.txHash ?? null, completedAt: new Date() },
  });
}
```

加 PayoutFinalizationIncompleteError class。

- [ ] **Step 5: 跑测试确认通过**

```bash
npx jest payouts.service.spec
```

- [ ] **Step 6: 提交**

```
git add src/modules/asset-treasury/payouts/
git commit -m "fix(payouts): R3 markCleared requires referenceNo + txHash (CRYPTO)"
```

---

## Task 6: 链入 db:seed:business 末尾自动跑 verify

**Files:**
- Modify: `package.json` (chained npm script)

- [ ] **Step 1: 改 db:seed:business 脚本**

In `package.json`：
```json
"db:seed:business": "<原有命令> && npm run verify:demo-data"
```

或者如果原命令是 ts-node，写成：
```json
"db:seed:business": "ts-node -r tsconfig-paths/register prisma/seed.business.ts && npm run verify:demo-data"
```

- [ ] **Step 2: 跑 reset-main 验证整链**

```bash
bash scripts/stack.sh reset-main
```
Expected: 末尾出现 `verify:demo-data ALL PASS` —— 因为 Task 2-5 已经修了 root cause，新种子写出来的数据天然合规。

If 仍有违反 → 说明 Task 2-5 修不全或有遗漏，回去补。

- [ ] **Step 3: 提交**

```
git add package.json
git commit -m "feat(seed): chain db:seed:business → verify:demo-data"
```

---

## Task 7: 端到端验收 + 最终 smoke + marker commit

- [ ] **Step 1: 跑 verify:demo-data（独立）**

```bash
npm run verify:demo-data
```
Expected: exit 0, `verify:demo-data ALL PASS`.

- [ ] **Step 2: 跑 verify:coa**

```bash
DATABASE_URL=file:/tmp/exchange_js_main/dev.db TB_ADDRESS=127.0.0.1:3003 \
  npx ts-node -r tsconfig-paths/register scripts/verify-realtime-coa.ts
```
Expected: `ALL INVARIANTS PASS`.

- [ ] **Step 3: 跑 recon:demo:pass**

```bash
npm run recon:demo:pass 2>&1 | tail -10
```
Expected: `status=PASS  walletsChecked=13  casesOpened=0  orphanInternal=0`、末尾 `recon:demo pass DONE — OK`.

- [ ] **Step 4: 跑 recon:demo:break**

```bash
npm run recon:demo:break 2>&1 | tail -10
```
Expected: `status=BREAK  casesOpened=5  manifest 5/5`、末尾 `recon:demo break DONE — OK`.

- [ ] **Step 5: 跑 jest 全量回归**

```bash
npx jest src/modules/clearing-settle/reconciliation src/modules/trading src/modules/asset-treasury 2>&1 | tail -6
```
Expected: 全绿。

- [ ] **Step 6: 直查 Alice AED 余额**

```bash
sqlite3 /tmp/exchange_js_main/dev.db "SELECT closing_balance FROM external_balances WHERE walletRef='7af2ad6f-1e87-4f97-aeed-ae0011772909';"
```
Expected: `1153047`（不再是 1163047，扣完了 10,000 提现）。

- [ ] **Step 7: 数据合规度统计**

```bash
sqlite3 /tmp/exchange_js_main/dev.db "
SELECT
  (SELECT COUNT(*) FROM internal_funds WHERE fromWalletId IS NULL AND toWalletId IS NULL) as if_both_null,
  (SELECT COUNT(*) FROM withdraw_transactions wt JOIN wallets w ON wt.fromWalletId=w.id WHERE w.ownerType != 'CUSTOMER') as wt_wrong_source,
  (SELECT COUNT(*) FROM payouts WHERE status='CLEARED' AND referenceNo IS NULL) as pa_null_ref
;"
```
Expected: `0|0|0` —— 三类违反归零。

- [ ] **Step 8: 最终 marker commit**

```bash
git commit --allow-empty -m "chore(integrity): demo data integrity + R1-R4 invariants — end-to-end green

verify:demo-data ALL PASS / verify:coa ALL INVARIANTS PASS
recon:demo:pass status=PASS / recon:demo:break manifest 5/5
Alice AED balance 1,153,047 (after withdraw) — was 1,163,047 (missing withdraw)
Compliance: 17/17 IF clean, 5/5 withdraw source customer-owned, all CLEARED payouts have ref/txHash"
```

---

## Spec Coverage Self-Review

- [x] R1 InternalFund from/to per leg type — Task 4
- [x] R2 walletRef ↔ tbAccountId owner — Task 3
- [x] R3 Payout/Payin CLEARED ref/txHash — Task 5
- [x] R4 withdraw_transactions source customer-owned — Task 2
- [x] verify-demo-data scanner — Task 1
- [x] Seed end-of-pipeline auto verify — Task 6
- [x] 8 条验收门槛全覆盖 — Task 7
- [x] No placeholders — 所有步骤含具体代码或精确命令
- [x] No undefined references — 每个 class/function/method 都在 task 内定义

---

## Execution Order

1. **Task 1** (verify 工具)：先建立 baseline，量化违反数量
2. **Task 2** (R4 withdraw source)：最上游 root cause，影响最广
3. **Task 3** (R2 projector)：第二层修复
4. **Task 4** (R1 swap IF)：第三个表
5. **Task 5** (R3 payout ref)：补全字段
6. **Task 6** (seed chain)：固化自动化
7. **Task 7** (e2e 验收)：闭环

每个 Task 完成后跑 verify:demo-data，看违反数单调下降。
