# COA v2 落地（科目更新）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 [COA v2 设计 spec](../specs/2026-08-13-coa-v2-design.md) 落地科目表：202 FIRM_FEE 拆 210/211/212 三收入户、退役 202/203/204、admin 展示名多币种模板、存量余额精确重分类迁移。**本轮不含**报表层/COB 修正（业主 2026-08-13 改主意收窄，报表层 spec 留班车）。

**Architecture:** 三面处理——①**写侧切断**：三个记账点贷方换新户，四个建户注册点只造新户；②**读侧留识别**：recon 流水分类集合（FIRM_CODES/OWNED_CODES）保留 202/203，历史 account_flows 行仍被认领，F_FEE 钱包对账连续性由"迁移分录双腿同盖 F_FEE walletRef"保证（-X on 202 + +X on 210 → 钱包内部和不变）；③**验证侧倒逼**：verify:coa / demo-lib / recon 恒等预门的公司权益段只认新段 {200,201,210,211,212}——未迁移的库恒等式必破，fail-closed 逼先跑迁移。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle + React admin。硬闸：`npx tsc --noEmit` 0 错、jest 净新 0 fail、`verify:coa` PASS、`demo:all` 8/8、`recon:demo` PASS。

## Global Constraints

- 新科目：`INCOME_SWAP_FEE: 210` / `INCOME_WITHDRAW_FEE: 211` / `INCOME_OTHER: 212`（E 区，credit-normal）。
- 退役：`FIRM_FEE: 202` / `FIRM_LIQ: 203` / `FIRM_SEIZED: 204` 从常量表删除；registry 行迁移脚本置 `status='RETIRED'`；TB 户物理不可删。
- 展示名模板（admin 前端拼币种后缀，**名字里永不写死币种**）：1=Client Assets in Custody｜50=Company Own Assets｜100=Payable to Clients – Available Balance｜101=Client Deposits Held – Pending Release｜200=Company Operating Funds｜201=Settlement in Transit – Fiat｜210=Trading Fee Income｜211=Withdrawal Fee Income｜212=Other Service Income。
- 新转账类型码：`COA_V2_INCOME_RECLASS: 71`（迁移重分类专用）。
- 历史 evidence 行里的 `'E.FIRM_FEE'` 字符串是**历史事实**，永不改写；迁移脚本用字符串字面量引用，不引用已删常量。
- 净新增业务分录 0（迁移分录除外）。
- 在 worktree 里干活（`.claude/worktrees/`，`bash scripts/stack.sh up` 自动分栈），commit 频繁、具名文件 add。
- 改代码必须同步 truth（Task 8）。

---

### Task 1: 常量层——加新户（纯增量，先不删旧）

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts`
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts`

**Interfaces:**
- Produces: `TB_ACCOUNT_CODES.INCOME_SWAP_FEE/INCOME_WITHDRAW_FEE/INCOME_OTHER`（210/211/212）、`COA_TO_TB_CODE['E.INCOME_*']`、`TB_TRANSFER_CODES.COA_V2_INCOME_RECLASS`(71)——后续所有 Task 消费这些名字。

- [ ] **Step 1: 加科目常量**（`TB_ACCOUNT_CODES` 对象里 `FIRM_SEIZED: 204,` 之后追加；先共存后删）：

```ts
  // ── COA v2 收入段(210–219,2026-08-13)：202 FIRM_FEE 按业务线三分,取代之 ──
  INCOME_SWAP_FEE: 210,     // 兑换手续费收入(接类型码 36)
  INCOME_WITHDRAW_FEE: 211, // 提现手续费收入(接类型码 16)
  INCOME_OTHER: 212,        // 其他收入(below-min 没收,类型码 4;与服务费隔离)
```

同文件 `COA_TO_TB_CODE` 追加三行：

```ts
  'E.INCOME_SWAP_FEE': TB_ACCOUNT_CODES.INCOME_SWAP_FEE,
  'E.INCOME_WITHDRAW_FEE': TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE,
  'E.INCOME_OTHER': TB_ACCOUNT_CODES.INCOME_OTHER,
```

- [ ] **Step 2: 加迁移转账码**（`tb-transfer-codes.constant.ts` 的 `CAPITAL_INJECTION: 70,` 之后）：

```ts
  // ── COA v2 迁移(71,2026-08-13)──
  COA_V2_INCOME_RECLASS: 71, // 202 存量按历史类型码精确重分类:DR FIRM_FEE / CR 210|211|212
```

- [ ] **Step 3: 编译**：`npx tsc --noEmit` → 0 错（纯增量必绿）。
- [ ] **Step 4: Commit**：`git add src/modules/accounting/tigerbeetle/constants/ && git commit -m "feat(coa-v2): add income accounts 210/211/212 + reclass transfer code 71 (additive)"`

---

### Task 2: 三个记账点换贷方 + 钱包映射（先改测试再改实现）

**Files:**
- Modify: `src/modules/funds-layer/constants/swap-leg-plan.constant.ts:25,43`
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts:1128-1166`
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts:1218,1250-1280,1330-1345`
- Modify: `src/modules/trading/swap-transactions/swap-leg-accounting.ts:165,194-198`
- Test: `src/modules/trading/withdraw-transactions/withdraw-fee-income.service.spec.ts`、`src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts:2243,2320-2340`

**Interfaces:**
- Consumes: Task 1 的 `INCOME_SWAP_FEE/INCOME_WITHDRAW_FEE/INCOME_OTHER`。
- Produces: 类型码 36 分录贷 210、16 贷 211、4 贷 212；F_FEE 钱包角色映射对 210/211 生效（物理钱包层不动）。

- [ ] **Step 1: 改两个既有测试的期望**——`withdraw-fee-income.service.spec.ts` 中所有 `TB_ACCOUNT_CODES.FIRM_FEE`→`TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE`、`TB_CODE_TO_COA[...FIRM_FEE]` 同步；`deposit-workflow.service.spec.ts` L2243/2320-2340 区域 `FIRM_FEE`→`INCOME_OTHER`（注释一并改）。
- [ ] **Step 2: 跑测试确认红**：`npx jest withdraw-fee-income deposit-workflow --silent 2>&1 | tail -5` → 预期 FAIL（实现还在贷 202）。
- [ ] **Step 3: 改三个记账点**：
  - `swap-leg-plan.constant.ts` 两行（L25/L43，fiat/crypto 两套腿计划）：`creditCode: C.FIRM_FEE` → `creditCode: C.INCOME_SWAP_FEE`（该行其余不动）。
  - `withdraw-workflow.service.ts` 费收腿：`resolveTbAccountId({ code: TB_ACCOUNT_CODES.FIRM_FEE, ...})` → `INCOME_WITHDRAW_FEE`；evidence `creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE]`；memo 改 `'Firm-side fee collect: FIRM_ASSET → INCOME_WITHDRAW_FEE'`；L421/864/1017/1141 四处注释同步。`resolveFirmFeeWalletRef` 与 `creditWalletRef` **不动**（钱包仍是 F_FEE，科目=分类、钱包=物理位置）。
  - `deposit-workflow.service.ts` 没收 leg2：`firmFeeId` 解析处 `FIRM_FEE`→`INCOME_OTHER`（变量名顺手改 `incomeOtherId`），evidence `creditCode` 同步，L1218/1333 注释同步（`CR INCOME_OTHER — confiscation income, segregated from service fees`）。
- [ ] **Step 4: 钱包映射**——`swap-leg-accounting.ts` L197 `equityRoleMap`：`[TB_ACCOUNT_CODES.FIRM_FEE]: 'F_FEE'` → `[TB_ACCOUNT_CODES.INCOME_SWAP_FEE]: 'F_FEE'`；L165 注释同步。
- [ ] **Step 5: 跑测试确认绿**：`npx jest withdraw-fee-income deposit-workflow --silent 2>&1 | tail -5` → PASS。`npx tsc --noEmit` → 0 错。
- [ ] **Step 6: Commit**：`git add <上列具名文件> && git commit -m "feat(coa-v2): route fee/confiscation credits to 210/211/212 income accounts"`

---

### Task 3: 四个建户注册点换新户

**Files:**
- Modify: `prisma/seed.business.ts:133-142`
- Modify: `src/modules/asset-treasury/assets/asset-provisioning.service.ts:32-41`
- Modify: `src/modules/asset-treasury/assets/asset-activation-workflow.service.ts:137-145`
- Modify: `src/modules/accounting/tigerbeetle/tb-manual-account.service.ts:24-32`
- Test: `src/modules/asset-treasury/assets/asset-provisioning.service.spec.ts:27-29`

**Interfaces:**
- Consumes: Task 1 常量。
- Produces: 新 ledger 只 provision {1,50,200,210,211,212(+201 fiat)}；就绪校验/手动建账白名单同口径。**此后 202/203/204 在写侧不再有新户被造。**

- [ ] **Step 1: 改 provisioning spec 期望**（L27-29 三行 `FIRM_FEE/FIRM_LIQ/FIRM_SEIZED` → `INCOME_SWAP_FEE/INCOME_WITHDRAW_FEE/INCOME_OTHER`），跑 `npx jest asset-provisioning --silent 2>&1 | tail -3` → FAIL。
- [ ] **Step 2: 四处同构替换**——每处把 `FIRM_FEE`/`FIRM_LIQ`/`FIRM_SEIZED` 三行替换为（`desc` 用内部名）：

```ts
      { code: TB_ACCOUNT_CODES.INCOME_SWAP_FEE, desc: 'INCOME_SWAP_FEE' },
      { code: TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE, desc: 'INCOME_WITHDRAW_FEE' },
      { code: TB_ACCOUNT_CODES.INCOME_OTHER, desc: 'INCOME_OTHER' },
```

（`asset-activation-workflow.service.ts` 是裸 code 数组、`tb-manual-account.service.ts` 是 `SYSTEM_CODES` Set——同名三换三，结构照旧。）
- [ ] **Step 3: 验证**：`npx jest asset-provisioning --silent 2>&1 | tail -3` → PASS；`npx tsc --noEmit` → 0。
- [ ] **Step 4: Commit**：`git commit -m "feat(coa-v2): provision/readiness/seed/manual-account register income accounts, drop retired trio"`（具名 add 五个文件）。

---

### Task 4: 验证侧倒逼——恒等式改新段（verify:coa / demo-lib / recon 预门）

**Files:**
- Modify: `scripts/verify-realtime-coa.ts:34`
- Modify: `scripts/demo-lib.ts:543-554`
- Modify: `src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts:481,526-533`

**Interfaces:**
- Consumes: Task 1 常量。
- Produces: 三处公司权益段一致=`{FIRM_OPS, FIRM_SET, INCOME_SWAP_FEE, INCOME_WITHDRAW_FEE, INCOME_OTHER}`。**未迁移的库恒等式必破（202 有余额但不在段内）——这是 fail-closed 设计，不是 bug。**

- [ ] **Step 1: verify-realtime-coa.ts L34** 数组替换：

```ts
      const firmEquity = sumBal((r) => [TB_ACCOUNT_CODES.FIRM_OPS, TB_ACCOUNT_CODES.FIRM_SET, TB_ACCOUNT_CODES.INCOME_SWAP_FEE, TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE, TB_ACCOUNT_CODES.INCOME_OTHER].includes(r.code));
```

- [ ] **Step 2: demo-lib.ts L543-554**——注释与 `firmEquity` 求和四项改五项（`FIRM_FEE/FIRM_LIQ` 换三个 INCOME_*），`ok(...)` 标签文案同步 `Σ(FIRM_OPS+FIRM_SET+INCOME_×3)`。
- [ ] **Step 3: wallet-recon-run.service.ts** L481 注释同步；L526-533 `firmEquity` 的 else-if 条件从 `FIRM_OPS||FIRM_SET||FIRM_FEE||FIRM_LIQ` 改为 `FIRM_OPS||FIRM_SET||INCOME_SWAP_FEE||INCOME_WITHDRAW_FEE||INCOME_OTHER`。
- [ ] **Step 4: 编译**：`npx tsc --noEmit` → 0（scripts 不在 tsc 范围是已知盲区，`npx tsc --noEmit -p tsconfig.json` 后追加 `npx ts-node --transpile-only -e "require('./scripts/verify-realtime-coa.ts')" 2>&1 | head -2` 冒烟确认 import 名存在——预期报 TB_ADDRESS not set 即证明加载通过）。
- [ ] **Step 5: Commit**：`git commit -m "feat(coa-v2): firm-equity invariant reads new income segment (fail-closed on unmigrated DB)"`

---

### Task 5: 读侧留识别 + 删旧常量 + 断言退役户恒零

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/engine/v2/wallet-balance-checker.service.ts:42-47`
- Modify: `src/modules/clearing-settle/reconciliation/engine/v2/wallet-flow-matcher.service.ts:65-72`
- Modify: `src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts:627-634`
- Modify: `src/modules/clearing-settle/reconciliation/dto/reconciliation.dto.ts:45`
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts`（删 202/203/204）
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts:2309,2354-2376`（过时注释）
- Modify: `scripts/verify-realtime-coa.ts`（退役户恒零断言）
- Test: `src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.spec.ts`

**Interfaces:**
- Consumes: Task 2/3/4 已把全部写侧/验证侧引用切走（本 task 删常量后 `npx tsc --noEmit` 是"再无引用"的机器证明）。
- Produces: 常量表=9 户终盘；`RETIRED_TB_CODES = [202, 203, 204] as const` 导出（读侧与迁移/验证用**数字字面量**语义，不再有名字）。

- [ ] **Step 1: 改常量 spec**——"exposes exactly the 9 codes" 期望对象改为终盘 9 户（1/50/100/101/200/201/210/211/212）；"drops all legacy codes" 数组追加 `'FIRM_FEE','FIRM_LIQ','FIRM_SEIZED'`；round-trip 断言改 `COA_TO_TB_CODE['E.INCOME_SWAP_FEE']===210` / `TB_CODE_TO_COA[212]==='E.INCOME_OTHER'`。跑 `npx jest tb-account-codes --silent 2>&1 | tail -3` → FAIL。
- [ ] **Step 2: 删常量**——`tb-account-codes.constant.ts` 删 `FIRM_FEE/FIRM_LIQ/FIRM_SEIZED` 三行及 `COA_TO_TB_CODE` 对应三行；文件头注释"编码段"补一句收入段说明；并导出：

```ts
/** 退役户(2026-08-13 COA v2):202 FIRM_FEE(由 210/211/212 接班)/203 FIRM_LIQ/204 FIRM_SEIZED。
 *  TB 物理不可删;registry 置 RETIRED;历史 evidence 的 'E.FIRM_FEE' 字符串是历史事实不改写。 */
export const RETIRED_TB_CODES: readonly number[] = [202, 203, 204];
```

- [ ] **Step 3: 读侧集合改字面量**——`wallet-balance-checker.service.ts` `FIRM_CODES`：

```ts
const FIRM_CODES: ReadonlySet<number> = new Set<number>([
  TB_ACCOUNT_CODES.FIRM_OPS,          // 200
  TB_ACCOUNT_CODES.FIRM_SET,          // 201
  TB_ACCOUNT_CODES.INCOME_SWAP_FEE,   // 210
  TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE, // 211
  TB_ACCOUNT_CODES.INCOME_OTHER,      // 212
  202, // FIRM_FEE(退役)——历史 account_flows 行仍须被认领,保 F_FEE 钱包对账连续性
  203, // FIRM_LIQ(退役)——同上
]);
```

`wallet-flow-matcher.service.ts` `OWNED_CODES` 同构（100/101/200/201/210/211/212 + 202/203 字面量同注释）。
- [ ] **Step 4: COA_BY_ROLE**（wallet-recon-run L627-634）：`F_FEE` 值改 `'E.INCOME_SWAP_FEE+E.INCOME_WITHDRAW_FEE+E.INCOME_OTHER'`（镜像 C_* 复合写法）；`F_LIQ` 行保留字面量 `'E.FIRM_LIQ'` 并注释 `// 退役科目,钱包仍在,期望恒 0`。dto L45 注释示例同步。deposit-workflow L2374 一带注释改为"FIRM_SEIZED (COA 204) retired 2026-08-13 COA v2 — registry RETIRED, constant removed"。
- [ ] **Step 5: verify 脚本加恒零断言**（`verify-realtime-coa.ts` main 内、恒等式循环后）：

```ts
    // 退役户(202/203/204)恒零断言:任何状态的 registry 行都查,余额非零即 FAIL
    const retired = await (prisma as any).tbAccountRegistry.findMany({ where: { code: { in: [202, 203, 204] } } });
    if (retired.length > 0) {
      const rAccounts = await tb.lookupAccounts(retired.map((r: any) => BigInt('0x' + r.tbAccountId)));
      for (const a of rAccounts) {
        const bal = a.credits_posted - a.debits_posted;
        if (bal !== 0n) { failures++; console.log(`✗ retired code ${a.code} balance=${bal} (must be 0)`); }
      }
      const active = retired.filter((r: any) => r.status === 'ACTIVE');
      if (active.length > 0) { failures++; console.log(`✗ ${active.length} retired-code registry rows still ACTIVE (run migrate:coa-v2)`); }
    }
```

- [ ] **Step 6: 验证**：`npx jest tb-account-codes --silent 2>&1 | tail -3` → PASS；`npx tsc --noEmit` → 0（**这就是"全仓再无旧名引用"的证明**——凡漏改处必编译爆）。
- [ ] **Step 7: Commit**：`git commit -m "feat(coa-v2): remove retired constants 202/203/204, keep read-side literals, assert retired-zero in verify:coa"`

---

### Task 6: 迁移脚本 migrate:coa-v2

**Files:**
- Create: `scripts/migrate-coa-v2.ts`
- Modify: `package.json`（scripts 加 `"migrate:coa-v2": "ts-node --transpile-only scripts/migrate-coa-v2.ts"`）

**Interfaces:**
- Consumes: `AccountingService.createAccounts/resolveTbAccountId/executeTransfer`（`accounting.service.ts`）、`TB_TRANSFER_CODES.COA_V2_INCOME_RECLASS`、字面量 202/203/204。
- Produces: 幂等迁移——重跑安全（202 已零则跳过重分类，RETIRED 已置则跳过）。

- [ ] **Step 1: 写脚本**（完整逻辑，bootstrap 真实 Nest 上下文，模式照 `scripts/e2e-confiscation-async.ts`）：

```ts
// scripts/migrate-coa-v2.ts — 202 存量按历史类型码精确重分类 → 210/211/212,然后退役 202/203/204。
// 幂等:202 余额已 0 → 跳过重分类;registry 已 RETIRED → 跳过。经 on-stack.sh 指向目标栈跑。
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { TigerBeetleService } from '../src/modules/accounting/tigerbeetle/tigerbeetle.service';
import { TB_ACCOUNT_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';

const SPLIT: Array<{ txnCode: number; toCode: number; toCoa: string }> = [
  { txnCode: 36, toCode: TB_ACCOUNT_CODES.INCOME_SWAP_FEE, toCoa: 'E.INCOME_SWAP_FEE' },
  { txnCode: 16, toCode: TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE, toCoa: 'E.INCOME_WITHDRAW_FEE' },
  { txnCode: 4, toCode: TB_ACCOUNT_CODES.INCOME_OTHER, toCoa: 'E.INCOME_OTHER' },
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const prisma = app.get(PrismaService);
  const accounting = app.get(AccountingService);
  const tb = app.get(TigerBeetleService);
  try {
    const oldFeeRows = await (prisma as any).tbAccountRegistry.findMany({ where: { code: 202 } });
    for (const row of oldFeeRows) {
      const ledger: number = row.ledger;
      // 1) 202 当前 TB 余额(credit-normal)
      const [acct] = (await tb.lookupAccounts([BigInt('0x' + row.tbAccountId)])) as any[];
      const bal202: bigint = acct.credits_posted - acct.debits_posted;
      if (bal202 < 0n) throw new Error(`ledger ${ledger}: 202 balance negative (${bal202}) — investigate before migrating`);
      if (bal202 === 0n) { console.log(`ledger ${ledger}: 202 already zero, skip reclass`); continue; }
      // 2) evidence 按类型码求历史贷方和(单位与 TB 一致:最小单位整数)
      const sums = new Map<number, bigint>();
      for (const s of SPLIT) {
        const agg = await (prisma as any).tbTransferEvidence.aggregate({
          where: { code: s.txnCode, ledger, creditCode: 'E.FIRM_FEE' },
          _sum: { amount: true },
        });
        sums.set(s.txnCode, BigInt(agg._sum.amount?.toString() ?? '0'));
      }
      const total = [...sums.values()].reduce((a, b) => a + b, 0n);
      if (total !== bal202) throw new Error(`ledger ${ledger}: evidence split Σ=${total} != 202 balance ${bal202} — refuse to guess, investigate`);
      // 3) 确保 210/211/212 已存在(新栈由 provisioning 造;老栈这里补)
      for (const s of SPLIT) {
        await accounting.resolveTbAccountId({ code: s.toCode, ledger, ownerType: 'SYSTEM' }).catch(async () => {
          await accounting.createAccounts([{ code: s.toCode, ledger, ownerType: 'SYSTEM', assetCurrency: row.assetCode, description: `${s.toCoa} for ${row.assetCode} (COA v2 migration)` } as any]);
        });
      }
      // 4) 三笔重分类:DR 202 / CR 新户;双腿同盖 F_FEE walletRef 保钱包对账连续性
      const feeWallet = await (prisma as any).wallet.findFirst({ where: { assetId: row.assetId ?? undefined, role: 'F_FEE' } });
      const from202 = await tbAccountIdOf(prisma, 202, ledger);
      for (const s of SPLIT) {
        const amt = sums.get(s.txnCode)!;
        if (amt === 0n) continue;
        await accounting.executeTransfer({
          debitAccountId: from202,
          creditAccountId: await tbAccountIdOf(prisma, s.toCode, ledger),
          amount: amt, ledger, code: TB_TRANSFER_CODES.COA_V2_INCOME_RECLASS,
          evidence: {
            sourceType: 'SYSTEM', sourceNo: `COA-V2-${ledger}`, eventCode: 'COA_V2_RECLASS',
            debitCode: 'E.FIRM_FEE', creditCode: s.toCoa, assetCurrency: row.assetCode,
            traceId: `coa-v2-${ledger}-${s.txnCode}`, actorType: 'SYSTEM', actorId: 'COA_V2_MIGRATION',
            memo: `COA v2 reclass: FIRM_FEE → ${s.toCoa} (historical txn code ${s.txnCode})`,
            debitWalletRef: feeWallet?.walletRef ?? null, creditWalletRef: feeWallet?.walletRef ?? null,
            isExternalCrossing: false,
          },
        });
        console.log(`ledger ${ledger}: reclassed ${amt} → ${s.toCoa}`);
      }
      // 5) 断言 202 清零
      const [after] = (await tb.lookupAccounts([BigInt('0x' + row.tbAccountId)])) as any[];
      const balAfter = after.credits_posted - after.debits_posted;
      if (balAfter !== 0n) throw new Error(`ledger ${ledger}: 202 not zero after reclass (${balAfter})`);
      console.log(`ledger ${ledger}: 202 → 0 ✓`);
    }
    // 6) 退役 registry 行(幂等)
    const r = await (prisma as any).tbAccountRegistry.updateMany({ where: { code: { in: [202, 203, 204] }, status: 'ACTIVE' }, data: { status: 'RETIRED' } });
    console.log(`retired ${r.count} registry rows (202/203/204)`);
    console.log('COA v2 migration DONE');
  } finally { await app.close(); }
}
async function tbAccountIdOf(prisma: any, code: number, ledger: number): Promise<string> {
  const row = await prisma.tbAccountRegistry.findFirst({ where: { code, ledger, ownerType: 'SYSTEM' } });
  if (!row) throw new Error(`registry miss code=${code} ledger=${ledger}`);
  return row.tbAccountId;
}
main().catch((e) => { console.error(e); process.exit(1); });
```

⚠️ 执行者须核对四处签名后再定稿（**发现不符改脚本适配现状，不改服务**）：`executeTransfer`/`createAccounts` 的实参形状（`accounting.service.ts`）、`tbTransferEvidence` 字段名（`amount` 单位与 `ledger` 列名以 schema 为准）、registry 是否有 `assetId`/`assetCode` 列（`prisma/schema.prisma`）、`resolveTbAccountId` 未命中是 throw 还是返 null（catch 分支据此改写）。
- [ ] **Step 2: package.json 加脚本行**（`"verify:coa"` 邻位）。
- [ ] **Step 3: 在本 worktree 栈实跑**：`bash scripts/stack.sh up` 起栈 → 先 `bash scripts/on-stack.sh self demo:all` 造齐历史数据（此时库是旧口径？——**不是**：本分支代码已是新口径，fresh 栈直接造出新科目数据，202 恒零、迁移走"skip"路径。为验证真迁移路径，先 `git stash` 不可行——改用顺序：**先在 main 代码的旧栈快照上跑**不现实，故接受两条验证路径：(a) fresh 栈=覆盖幂等/skip 路径；(b) 单测不覆盖、由 Task 7 的 main 栈实跑覆盖真迁移路径）。本 step 跑 (a)：`bash scripts/on-stack.sh self migrate:coa-v2` → 预期各 ledger `skip` + `retired 0 registry rows`（fresh 栈无 202 行）→ 再 `bash scripts/on-stack.sh self verify:coa` → `ALL INVARIANTS PASS`。
- [ ] **Step 4: Commit**：`git commit -m "feat(coa-v2): idempotent migration script — evidence-split reclass 202 → 210/211/212, retire registry rows"`

---

### Task 7: admin 前端展示名模板 + 渲染截图验收

**Files:**
- Modify: `admin-web/src/pages/ledger-account.constants.ts`（全文件重写，见下）
- Modify: `admin-web/src/pages/LedgerAccountList.tsx:404`（Name 列换显示名模板）
- 只读确认: `LedgerAccountDetail.tsx:150` / `AccountFlowList.tsx:210` / `TransferEvidenceList.tsx:260`（吃常量自动跟新，无需改）

**Interfaces:**
- Consumes: 无后端接口变化（registry 返回 code/assetCode 照旧）。
- Produces: `TB_CODE_LABELS`（内部名）、`TB_CODE_DISPLAY`（展示名模板）、`SYSTEM_TB_CODES=[1,50,200,201,210,211,212]`。

- [ ] **Step 1: 重写 `ledger-account.constants.ts`**：

```ts
// admin-web/src/pages/ledger-account.constants.ts
/** TB account code → COA 内部名。与后端 tb-account-codes.constant.ts 同步(COA v2, 2026-08-13)。 */
export const TB_CODE_LABELS: Record<number, string> = {
  1: 'CLIENT_ASSET', 50: 'FIRM_ASSET',
  100: 'CLIENT_PAYABLE', 101: 'DEPOSIT_SUSPENSE',
  200: 'FIRM_OPS', 201: 'FIRM_SET',
  210: 'INCOME_SWAP_FEE', 211: 'INCOME_WITHDRAW_FEE', 212: 'INCOME_OTHER',
  // 退役户(只读识别,历史行仍会出现):
  202: 'FIRM_FEE (retired)', 203: 'FIRM_LIQ (retired)', 204: 'FIRM_SEIZED (retired)',
};

/** 展示名模板——币种由调用方拼后缀(`${TB_CODE_DISPLAY[code]} – ${assetCode}`),名字永不写死币种。 */
export const TB_CODE_DISPLAY: Record<number, string> = {
  1: 'Client Assets in Custody', 50: 'Company Own Assets',
  100: 'Payable to Clients – Available Balance', 101: 'Client Deposits Held – Pending Release',
  200: 'Company Operating Funds', 201: 'Settlement in Transit – Fiat',
  210: 'Trading Fee Income', 211: 'Withdrawal Fee Income', 212: 'Other Service Income',
};

const ACTIVE_CODES = [1, 50, 100, 101, 200, 201, 210, 211, 212];
const labelOf = (code: number) => `${code} · ${TB_CODE_LABELS[code] ?? `CODE_${code}`}`;

export const TB_CODE_OPTIONS = [
  { value: '', label: 'All codes' },
  ...ACTIVE_CODES.map((c) => ({ value: String(c), label: labelOf(c) })),
];

/** SYSTEM-owner codes (1/ledger). */
export const SYSTEM_TB_CODES = [1, 50, 200, 201, 210, 211, 212];
/** Per-customer codes. */
export const CUSTOMER_TB_CODES = [100, 101];

export const SYSTEM_CODE_OPTIONS = SYSTEM_TB_CODES.map((c) => ({ value: c, label: labelOf(c) }));
export const CUSTOMER_CODE_OPTIONS = CUSTOMER_TB_CODES.map((c) => ({ value: c, label: labelOf(c) }));

const CLASS_PREFIX: Record<number, string> = {
  1: 'A', 50: 'A', 100: 'L', 101: 'L',
  200: 'E', 201: 'E', 210: 'E', 211: 'E', 212: 'E',
};

export const COA_OPTIONS = ACTIVE_CODES.map((c) => ({
  value: `${CLASS_PREFIX[c]}.${TB_CODE_LABELS[c]}`,
  label: `${CLASS_PREFIX[c]}.${TB_CODE_LABELS[c]}`,
}));
```

- [ ] **Step 2: LedgerAccountList.tsx L404** Name 单元格改为展示名主行+内部名副行：

```tsx
                    {(TB_CODE_DISPLAY[row.code] ?? TB_CODE_LABELS[row.code] ?? 'CODE_' + row.code)} – {row.assetCode}
```

（保持既有单行结构最小改——如该单元格原是 `{TB_CODE_LABELS[row.code] ?? 'CODE_' + row.code} · {row.assetCode}`，仅换 label 源与连接符。）
- [ ] **Step 3: 前端编译**：`cd admin-web && npx tsc --noEmit` → 0。
- [ ] **Step 4: 渲染验收**（铁律：截图才算数）：worktree 栈 `bash scripts/stack.sh up` → seed admin 登录注入 token → 打开 账本→账户 列表页与详情页，确认：新户名如 `Trading Fee Income – AED` 出现、退役户不在（fresh 栈）/标 retired（老栈）、筛选器只列 9 活跃码。截图存证。
- [ ] **Step 5: Commit**：`git commit -m "feat(coa-v2): admin display-name templates with currency suffix, active-code filters"`

---

### Task 8: 全量硬闸 + main 栈迁移实跑 + truth/BACKLOG 同步

**Files:**
- Modify: `doc-final/reference/truth/accounting-coa.md`（§1 表/§4 恒等式/§5 缺口/§6 锚点）
- Modify: `doc-final/reference/truth/v4-deposit.md`、`v5-withdraw.md`、`v6-swap.md`（费/没收贷方名同步，grep `FIRM_FEE` 逐处）
- Modify: `doc-final/BACKLOG.md`（COA v2 行转 `[x]` 附落地纪要；COB 行保持 open）

**Interfaces:**
- Consumes: Task 1–7 全部产物。

- [ ] **Step 1: 分支栈全量硬闸**：`npx tsc --noEmit`→0；`npx jest --silent 2>&1 | tail -5`→净新 0 fail（9 个 pre-existing wallets fail 除外）；`bash scripts/on-stack.sh self demo:all`→8/8 PASS；`bash scripts/on-stack.sh self verify:coa`→ALL PASS；`bash scripts/on-stack.sh self recon:demo`→PASS。任一红即修完再过闸。
- [ ] **Step 2: 真迁移路径实跑（关键验收）**：合并 main 前，在 **main 栈**（有旧口径历史数据的库）上：先 `bash scripts/on-stack.sh main verify:coa` → 预期 **FAIL**（fail-closed 生效：202 有余额不在新段）→ `bash scripts/on-stack.sh main migrate:coa-v2` → 逐 ledger `reclassed ... → 0 ✓` → 再 `verify:coa` → **ALL INVARIANTS PASS** + 退役户恒零断言过 → `recon:demo` PASS（F_FEE 钱包连续性证明）。⚠️ 此步在 main 工作树执行、动 main 栈 DB——先与业主确认 main 栈当下无人验收。
- [ ] **Step 3: truth 同步**——`accounting-coa.md`：§1 表换 9 户终盘（含展示名列）、§3 提"COA_V2_INCOME_RECLASS=71"、§4 恒等式改 `Σ FIRM_ASSET == Σ(FIRM_OPS+FIRM_SET+INCOME_×3)` + 退役户恒零、§6 锚点补 `migrate-coa-v2.ts`、Last Verified 换日期与核对方式；v4/v5/v6 truth 中 `FIRM_FEE` 出现处逐一替换为对应新户名。BACKLOG COA v2 行打勾附一行纪要（迁移已在 main 栈实跑）。
- [ ] **Step 4: Commit + 收尾**：`git commit -m "docs(coa-v2): truth sync — 9-account final COA, invariant new segment, BACKLOG tick"`；随后走 superpowers:finishing-a-development-branch（合 main、清 worktree/分支）。

---

## Self-Review 记录

1. **Spec 覆盖**：spec §2 终盘 9 户=Task 1/5/7；§6 迁移四点=Task 6（重分类）/Task 5（退役语义+恒零断言）/Task 2·3（记账点+注册点）/Task 4（恒等式）/Task 7（展示名）；净新增分录 0=只有迁移分录（spec 允许）。§7 验收 1/2/6=Task 8，3/4/5 属报表层已出圈。无缺口。
2. **占位扫描**：Task 6 Step 1 的"executor 核对四处签名"是**核对指令**（给了确切文件与判据）非 TBD；Task 7 Step 2 给了回退写法。通过。
3. **类型一致性**：`INCOME_SWAP_FEE/INCOME_WITHDRAW_FEE/INCOME_OTHER/COA_V2_INCOME_RECLASS/RETIRED_TB_CODES` 各 task 拼写一致；`'E.INCOME_*'` COA 串三处（常量/迁移/COA_BY_ROLE）一致。通过。
