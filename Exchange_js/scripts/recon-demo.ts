// scripts/recon-demo.ts
//
// V8 对账重构 — anchor-free 对账演示生成器（demo 的核心）。
// 读 `demo:all` 产出的真实内部资金单（Alice/Bob/Grace deposit/swap/withdraw；法币已结算、
// 虚拟币 pending），按其**真实业务日**，合成 ZAND(AED)+HEXTRUST(USDT) 外部对账单：
//   - --mode=pass  ：外部完美镜像内部，零 break，五公式全 PASS。
//   - --mode=break ：动态挑当日真实记录注入 ~6 处刻意差异 + 记 manifest，式4/式5 在受影响 book FAIL。
// 写完外部两表后 APPLY 跑 redesign 对账引擎，回读 getLatestRedesignRun 打印结果。
//
// 与 recon:gen（scripts/recon-redesign-statement-gen.ts）的区别 = 去锚点：
//   ① 业务日由 --date 决定（默认今天），不再硬编码 2026-06-16。
//   ② AED/USDT 资产按 currency 查（status=ACTIVE），不再硬编码 UUID。
//   ③ break 目标动态挑：每币种第 1 笔 CLEARED payin→OMIT(ORPHAN_INTERNAL)、第 2 笔→AMOUNT_MISMATCH，
//      外加 1 条合成 ORPHAN_EXTERNAL 行；某币种 CLEARED payin <2 则跳过其 payin 类 break（不抛错）。
//   ④ pass 模式无 break、无 manifest；break 模式注入 break + 建 manifest。
//
// 闭合口径（与 recon:gen 一致，供式4/式5）：
//   closingBalance(account) = TB − in-transit − Σ(break signedδ)
//   signedδ = 对 (TB − 外部) 的贡献：ORPHAN_INTERNAL +amt，ORPHAN_EXTERNAL −amt，AMOUNT_MISMATCH (internal−external)
//   pass 模式 Σbreak=0 → 式4/5 delta=0 PASS；break 模式 delta=Σbreak≠0 → 受影响 book FAIL。
//
// Run:
//   npm run recon:demo -- --mode=pass            # 五公式全 PASS、0 case、无 manifest
//   npm run recon:demo -- --mode=break           # ~6 break；式4/5 在受影响 book FAIL；case 开仓
//   npm run recon:demo -- --mode=break --date=2026-06-21

// Node 18 polyfill：@nestjs/schedule 在模块注册时调用 crypto.randomUUID()。必须在任何 import 之前。
import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { createHash } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { BalanceSnapshotService } from '../src/modules/clearing-settle/reconciliation/engine/balance-snapshot.service';
import { InTransitService } from '../src/modules/clearing-settle/reconciliation/engine/in-transit.service';
import { RedesignReconRunService } from '../src/modules/clearing-settle/reconciliation/workflow/redesign-recon-run.service';
import { ReconciliationQueryService } from '../src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service';
import { firmFiatAccountRef, isFiat } from '../src/modules/clearing-settle/reconciliation/engine/leg-projection.service';

const D = (n: any) => new Prisma.Decimal(n);

// 法币 account_ref 一律滚到 CMA（§2.5）；行表保留 sub_account=VirtualAccount/walletId。
const CMA_ACCOUNT_REF = 'C_CMA-AED-0001';
const PLACEHOLDER_VIBAN = 'AE000000000000000001'; // 未映射客户 fallback vIBAN
const VAULT_MAIN = 'vault-usdt-main'; // 归集/公司侧 pooled vault（C_MAIN/C_OUT vaultId 为空，合成）
const VAULT_OUT = 'vault-usdt-out';

// ── CLI args ───────────────────────────────────────────────────────────────────
type Mode = 'pass' | 'break';
function parseArgs(argv: string[]): { mode: Mode; date: string } {
  let mode: Mode = 'break'; // 默认 break
  let date = new Date().toISOString().slice(0, 10); // 默认今天（与 demo:all 的 stamp 对齐）
  for (const a of argv) {
    const m = a.match(/^--mode=(pass|break)$/);
    if (m) mode = m[1] as Mode;
    else if (a.startsWith('--mode=')) console.warn(`⚠ unknown --mode "${a}" — defaulting to "break"`);
    const d = a.match(/^--date=(\d{4}-\d{2}-\d{2})$/);
    if (d) date = d[1];
  }
  return { mode, date };
}

// 归一化行（写 external_statement_lines）。dedupKey = 合成 booking-id 风格稳定键（§2.4，优先 booking id）。
type Line = {
  source: string;
  accountRef: string;
  subAccount: string | null;
  book: string;
  currency: string;
  direction: 'IN' | 'OUT';
  amount: Prisma.Decimal;
  externalRef: string | null;
  channelRef: string | null;
  datetime: Date;
  balanceAfter: Prisma.Decimal | null;
  description: string;
  bookingId: string; // 合成逐条 booking id → dedupKey 主用
};

// manifest 单条 break（break 模式落 ReconciliationRun.demoManifest）。
type ManifestBreak = {
  currency: string;
  book: string;
  bucket: 'ORPHAN_INTERNAL' | 'ORPHAN_EXTERNAL' | 'AMOUNT_MISMATCH';
  targetType: 'payin' | 'synthetic';
  targetRef: string;
  internalAmount: string | null;
  externalAmount: string | null;
  signedDelta: string;
  note: string;
};
type Manifest = { generatedAt: string; breaks: ManifestBreak[] };

// 单币种动态挑出的 break 计划（去锚点核心）。
type BreakPlan = {
  omitRef: string | null; // 第 1 笔 CLEARED payin → OMIT（ORPHAN_INTERNAL）
  omitAmount: Prisma.Decimal; // 被 omit 的内部金额（→ +signedδ）
  mismatchRef: string | null; // 第 2 笔 CLEARED payin → AMOUNT_MISMATCH
  mismatchInternal: Prisma.Decimal; // 内部真实金额
  mismatchExternal: Prisma.Decimal; // 改写后的外部金额
  orphanExtRef: string; // 合成 ORPHAN_EXTERNAL 行的 ref/txHash
  orphanExtAmount: Prisma.Decimal; // 合成外部行金额（→ −signedδ）
  orphanExtBook: 'CLIENT' | 'FIRM';
};

async function main() {
  const { mode, date } = parseArgs(process.argv.slice(2));
  const BUSINESS_DATE = date;
  const ymd = BUSINESS_DATE.replace(/-/g, '');
  const DT = `${BUSINESS_DATE}T10:00:00.000Z`; // 合成入账时刻（缺字段即合成，§0.5）
  console.log(`════════ recon:demo  mode=${mode}  businessDate=${BUSINESS_DATE} ════════`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);

  // ── 资产按 currency 查（去锚点②）──────────────────────────────────────────────
  const aedAsset = await prisma.asset.findFirst({ where: { currency: 'AED', status: 'ACTIVE' }, select: { id: true } });
  const usdtAsset = await prisma.asset.findFirst({ where: { currency: 'USDT', status: 'ACTIVE' }, select: { id: true } });
  if (!aedAsset || !usdtAsset) throw new Error('AED/USDT active assets not found — run the business seed first');
  const AED_ASSET = aedAsset.id;
  const USDT_ASSET = usdtAsset.id;

  // ─── 0. 读真实内部数据（payin/payout CLEARED 当日；internal_fund CLEAR 终态）────────
  const dayStart = new Date(`${BUSINESS_DATE}T00:00:00.000Z`);
  const cutoff = new Date(dayStart.getTime() + 86400000); // D 结束 = 次日 00:00

  const aedPayins = await prisma.payin.findMany({
    where: { assetId: AED_ASSET, status: 'CLEARED', createdAt: { gte: dayStart, lt: cutoff } },
    select: { referenceNo: true, amount: true, ownerId: true }, orderBy: { referenceNo: 'asc' },
  });
  const aedPayouts = await prisma.payout.findMany({
    where: { assetId: AED_ASSET, status: 'CLEARED', createdAt: { gte: dayStart, lt: cutoff } },
    select: { payoutNo: true, referenceNo: true, amount: true, ownerId: true }, orderBy: { payoutNo: 'asc' },
  });
  const usdtPayins = await prisma.payin.findMany({
    where: { assetId: USDT_ASSET, status: 'CLEARED', createdAt: { gte: dayStart, lt: cutoff } },
    select: { txHash: true, amount: true, ownerId: true }, orderBy: { txHash: 'asc' },
  });
  const usdtPayouts = await prisma.payout.findMany({
    where: { assetId: USDT_ASSET, status: 'CLEARED', createdAt: { gte: dayStart, lt: cutoff } },
    select: { payoutNo: true, txHash: true, amount: true, ownerId: true }, orderBy: { payoutNo: 'asc' },
  });
  // CLEAR internal_fund：USDT 链上腿 keyed by txHash、AED 银行腿 keyed by referenceNo。
  // 它们投影为 IN/DEPOSIT，必须在外部对账单出现匹配行，否则成 ORPHAN_INTERNAL（对闭合贡献 0）。
  const fundWalletSelect = { select: { walletRole: true, iban: true, vaultId: true, id: true } };
  const usdtFunds = await prisma.internalFund.findMany({
    where: { assetId: USDT_ASSET, status: 'CLEAR', txHash: { not: null }, createdAt: { gte: dayStart, lt: cutoff } },
    select: { internalFundNo: true, txHash: true, amount: true, fromWallet: fundWalletSelect, toWallet: fundWalletSelect },
    orderBy: { internalFundNo: 'asc' },
  });
  const aedFunds = await prisma.internalFund.findMany({
    where: { assetId: AED_ASSET, status: 'CLEAR', referenceNo: { not: null }, createdAt: { gte: dayStart, lt: cutoff } },
    select: { internalFundNo: true, referenceNo: true, amount: true, fromWallet: fundWalletSelect, toWallet: fundWalletSelect },
    orderBy: { internalFundNo: 'asc' },
  });

  // 补全 crypto payout txHash（DB 中为空）：0xWDR<payoutNo>，回填并回显到外部 WITHDRAWAL 行的 external_ref。
  for (const po of usdtPayouts) {
    if (!po.txHash) {
      const tx = `0xWDR${po.payoutNo}`;
      await prisma.payout.updateMany({ where: { payoutNo: po.payoutNo }, data: { txHash: tx } });
      po.txHash = tx;
    }
  }

  // ─── 0b. ownerId → 物理账户映射（sub_account）。USDT→C_DEP vaultId / AED→C_VIBAN iban ────
  const depWallets = await prisma.wallet.findMany({
    where: { assetId: USDT_ASSET, walletRole: 'C_DEP', status: 'ACTIVE' },
    select: { ownerId: true, vaultId: true, address: true },
  });
  // demo:all 的 C_DEP 钱包 vaultId 为空、地址在 address；用 walletId 占位也行，这里取 vaultId||address。
  const ownerToVault = new Map<string, string>(
    depWallets
      .filter((w) => w.ownerId && (w.vaultId || w.address))
      .map((w) => [w.ownerId!, (w.vaultId || w.address)!]),
  );
  const vibanWallets = await prisma.wallet.findMany({
    where: { assetId: AED_ASSET, walletRole: 'C_VIBAN', status: 'ACTIVE' },
    select: { ownerId: true, iban: true },
  });
  const ownerToViban = new Map<string, string>(
    vibanWallets.filter((w) => w.ownerId && w.iban).map((w) => [w.ownerId!, w.iban!]),
  );

  // ─── 1. 真实 TB + in-transit（用真实 engine，已缩放 human-decimal）───────────────────
  const snap = app.get(BalanceSnapshotService);
  const it = app.get(InTransitService);
  const balAED = await snap.balancesAtCutoff('AED', cutoff);
  const balUSDT = await snap.balancesAtCutoff('USDT', cutoff);
  const tbAED = D(balAED['A.CLIENT_BANK'] ?? 0);
  const tbUSDT = D(balUSDT['A.CLIENT_CUSTODY'] ?? 0);
  const inTransitAED = await it.computeFiat('AED', AED_ASSET, cutoff);
  const inTransitUSDT = await it.computeCrypto('USDT', USDT_ASSET, cutoff);

  console.log('─── REAL internal inputs (engine, human-decimal) ───');
  console.log(`AED  TB=${tbAED}  in-transit=${inTransitAED}  payins=${aedPayins.length} payouts=${aedPayouts.length} funds=${aedFunds.length}`);
  console.log(`USDT TB=${tbUSDT}  in-transit=${inTransitUSDT}  payins=${usdtPayins.length} payouts=${usdtPayouts.length} funds=${usdtFunds.length}`);

  // ─── 2. 动态 break 计划（去锚点③）──────────────────────────────────────────────────
  // 每币种：第 1 笔 CLEARED payin → OMIT(ORPHAN_INTERNAL)；第 2 笔 → AMOUNT_MISMATCH（外部少 0.08/0.06）；
  // 外加 1 条合成 ORPHAN_EXTERNAL 行（CLIENT 用 AED，FIRM vault 用 USDT，覆盖 CLIENT+FIRM）。
  // pass 模式：plan=null（不挑、不注入）。CLEARED payin <2：跳过该币种 payin 类 break（不抛错）。
  const manifest: Manifest = { generatedAt: new Date(DT).toISOString(), breaks: [] };

  function planFor(
    ccy: string,
    payins: { amount: any; ref: string | null }[],
    orphanExtRef: string,
    orphanExtAmount: number,
    orphanExtBook: 'CLIENT' | 'FIRM',
    mismatchExternal: (internal: Prisma.Decimal) => Prisma.Decimal,
  ): BreakPlan | null {
    if (mode !== 'break') return null;
    const valid = payins.filter((p) => p.ref);
    const omit = valid[0] ?? null;
    const mismatch = valid[1] ?? null;
    if (!omit || !mismatch) {
      console.log(`⚠ ${ccy}: only ${valid.length} CLEARED payin(s) — skipping payin-based breaks (need ≥2). Orphan-external still injected.`);
    }
    const mismatchInternal = mismatch ? D(mismatch.amount) : D(0);
    return {
      omitRef: omit?.ref ?? null,
      omitAmount: omit ? D(omit.amount) : D(0),
      mismatchRef: mismatch?.ref ?? null,
      mismatchInternal,
      mismatchExternal: mismatch ? mismatchExternal(mismatchInternal) : D(0),
      orphanExtRef,
      orphanExtAmount: D(orphanExtAmount),
      orphanExtBook,
    };
  }

  const aedPlan = planFor(
    'AED',
    aedPayins.map((p) => ({ amount: p.amount, ref: p.referenceNo })),
    'REF-EXT-ORPHAN-AED', 500.0, 'CLIENT',
    (internal) => internal.minus(D('0.08')), // 外部少 0.08 → signedδ = +0.08
  );
  const usdtPlan = planFor(
    'USDT',
    usdtPayins.map((p) => ({ amount: p.amount, ref: p.txHash })),
    '0xEXTORPHANUSDT', 10.0, 'FIRM',
    (internal) => internal.minus(D('0.06')), // 外部少 0.06 → signedδ = +0.06
  );

  // signedδ（仅 break 模式非 0）。orphan-external 落 FIRM(USDT) 时不影响客户池闭合，只影响 FIRM 闭合。
  function sumBreak(plan: BreakPlan | null, scope: 'CLIENT' | 'FIRM'): Prisma.Decimal {
    if (!plan) return D(0);
    let s = D(0);
    if (scope === 'CLIENT') {
      if (plan.omitRef) s = s.plus(plan.omitAmount); // ORPHAN_INTERNAL +amt
      if (plan.mismatchRef) s = s.plus(plan.mismatchInternal.minus(plan.mismatchExternal)); // (internal−external)
      if (plan.orphanExtBook === 'CLIENT') s = s.minus(plan.orphanExtAmount); // ORPHAN_EXTERNAL −amt
    } else {
      if (plan.orphanExtBook === 'FIRM') s = s.minus(plan.orphanExtAmount);
    }
    return s;
  }

  const sumBreakAED = sumBreak(aedPlan, 'CLIENT'); // AED orphan-external 落 CLIENT
  const sumBreakUSDT = sumBreak(usdtPlan, 'CLIENT'); // USDT orphan-external 落 FIRM → 不进客户池
  const closingAED = tbAED.minus(inTransitAED).minus(sumBreakAED);
  const closingUSDT = tbUSDT.minus(inTransitUSDT).minus(sumBreakUSDT);

  // 填 manifest（break 模式）。
  if (aedPlan) {
    if (aedPlan.omitRef)
      manifest.breaks.push({ currency: 'AED', book: 'CLIENT', bucket: 'ORPHAN_INTERNAL', targetType: 'payin', targetRef: aedPlan.omitRef, internalAmount: aedPlan.omitAmount.toString(), externalAmount: null, signedDelta: aedPlan.omitAmount.toString(), note: 'External statement omits this internal payin (internal-only)' });
    manifest.breaks.push({ currency: 'AED', book: aedPlan.orphanExtBook, bucket: 'ORPHAN_EXTERNAL', targetType: 'synthetic', targetRef: aedPlan.orphanExtRef, internalAmount: null, externalAmount: aedPlan.orphanExtAmount.toString(), signedDelta: aedPlan.orphanExtAmount.negated().toString(), note: 'Synthetic external credit with no internal match (external-only)' });
    if (aedPlan.mismatchRef)
      manifest.breaks.push({ currency: 'AED', book: 'CLIENT', bucket: 'AMOUNT_MISMATCH', targetType: 'payin', targetRef: aedPlan.mismatchRef, internalAmount: aedPlan.mismatchInternal.toString(), externalAmount: aedPlan.mismatchExternal.toString(), signedDelta: aedPlan.mismatchInternal.minus(aedPlan.mismatchExternal).toString(), note: 'External amount altered vs internal payin' });
  }
  if (usdtPlan) {
    if (usdtPlan.omitRef)
      manifest.breaks.push({ currency: 'USDT', book: 'CLIENT', bucket: 'ORPHAN_INTERNAL', targetType: 'payin', targetRef: usdtPlan.omitRef, internalAmount: usdtPlan.omitAmount.toString(), externalAmount: null, signedDelta: usdtPlan.omitAmount.toString(), note: 'External statement omits this internal deposit (internal-only)' });
    manifest.breaks.push({ currency: 'USDT', book: usdtPlan.orphanExtBook, bucket: 'ORPHAN_EXTERNAL', targetType: 'synthetic', targetRef: usdtPlan.orphanExtRef, internalAmount: null, externalAmount: usdtPlan.orphanExtAmount.toString(), signedDelta: usdtPlan.orphanExtAmount.negated().toString(), note: 'Synthetic external deposit (FIRM vault) with no internal match (external-only)' });
    if (usdtPlan.mismatchRef)
      manifest.breaks.push({ currency: 'USDT', book: 'CLIENT', bucket: 'AMOUNT_MISMATCH', targetType: 'payin', targetRef: usdtPlan.mismatchRef, internalAmount: usdtPlan.mismatchInternal.toString(), externalAmount: usdtPlan.mismatchExternal.toString(), signedDelta: usdtPlan.mismatchInternal.minus(usdtPlan.mismatchExternal).toString(), note: 'External amount altered vs internal deposit' });
  }

  // ─── 3. 合成 ZAND(AED) 行（§2.3 映射；direction=IN/OUT；account_ref 滚 CMA；sub_account=VIBAN）──
  const lines: Line[] = [];
  let seq = 0;
  const bk = (src: string) => `BK-${ymd}-${src}-${String(++seq).padStart(4, '0')}`; // 合成 booking id

  // internal_fund 单腿 → 归一化行。账户规则与 leg-projection.resolveAccount 同源（保证内外账户键对齐、能匹配）：
  //   公司法币(F_*) → 各自独立账户(不滚 CMA)；客户法币(C_VIBAN) → 滚 CMA(留 VIBAN sub)；虚拟币 → 逐 vault。
  //   external_ref：虚拟币=txHash；法币出=referenceNo(银行回显)、法币入=null(走账户级等额回退)。
  type FundWallet = { walletRole?: string | null; iban?: string | null; vaultId?: string | null; id?: string } | null;
  const fundLegLine = (
    source: 'ZAND' | 'HEXTRUST',
    f: { amount: any; referenceNo?: string | null; txHash?: string | null },
    wallet: FundWallet,
    direction: 'IN' | 'OUT',
    ccy: string,
  ): Line => {
    const role = wallet?.walletRole ?? null;
    const book = role?.startsWith('F_') ? 'FIRM' : 'CLIENT';
    let accountRef: string;
    let subAccount: string | null;
    if (isFiat(ccy)) {
      if (book === 'FIRM') {
        accountRef = firmFiatAccountRef(role!, ccy);
        subAccount = null;
      } else {
        accountRef = CMA_ACCOUNT_REF;
        subAccount = wallet?.iban ?? PLACEHOLDER_VIBAN;
      }
    } else {
      const vault = wallet?.vaultId ?? wallet?.id ?? VAULT_MAIN;
      accountRef = vault;
      subAccount = vault;
    }
    const externalRef = isFiat(ccy)
      ? direction === 'OUT'
        ? f.referenceNo ?? null
        : null
      : f.txHash ?? null;
    return {
      source, accountRef, subAccount, book, currency: ccy, direction,
      amount: D(f.amount), externalRef,
      channelRef: isFiat(ccy) ? `CHN-${f.referenceNo}` : null,
      datetime: new Date(DT), balanceAfter: null,
      description: 'Internal fund transfer', bookingId: bk(source),
    };
  };

  // 入金 payin = Credit/IN：external_ref=null（法币入金，§2.3）；channel_ref=合成；sub_account=客户 vIBAN。
  for (const p of aedPayins) {
    if (aedPlan?.omitRef && p.referenceNo === aedPlan.omitRef) continue; // OMIT → ORPHAN_INTERNAL
    const amt = aedPlan?.mismatchRef && p.referenceNo === aedPlan.mismatchRef ? aedPlan.mismatchExternal : D(p.amount); // AMOUNT_MISMATCH
    const viban = (p.ownerId && ownerToViban.get(p.ownerId)) || PLACEHOLDER_VIBAN;
    lines.push({
      source: 'ZAND', accountRef: CMA_ACCOUNT_REF, subAccount: viban, book: 'CLIENT', currency: 'AED',
      direction: 'IN', amount: amt, externalRef: null, channelRef: `CHN-${p.referenceNo}`,
      datetime: new Date(DT), balanceAfter: null, description: 'Incoming AED Remittance', bookingId: bk('ZAND'),
    });
  }
  // ORPHAN_EXTERNAL（AED 落 CLIENT）：外部有内部无 Credit（无对应客户，占位 vIBAN）。
  if (aedPlan && aedPlan.orphanExtBook === 'CLIENT') {
    lines.push({
      source: 'ZAND', accountRef: CMA_ACCOUNT_REF, subAccount: PLACEHOLDER_VIBAN, book: 'CLIENT', currency: 'AED',
      direction: 'IN', amount: aedPlan.orphanExtAmount, externalRef: null, channelRef: `CHN-${aedPlan.orphanExtRef}`,
      datetime: new Date(DT), balanceAfter: null, description: 'Unmatched incoming credit', bookingId: bk('ZAND'),
    });
  }
  // internal_fund 两腿（from OUT + to IN，各落真实账户：F_* 各自独立 / C_VIBAN 滚 CMA）。
  for (const f of aedFunds) {
    lines.push(fundLegLine('ZAND', f, f.fromWallet, 'OUT', 'AED'));
    lines.push(fundLegLine('ZAND', f, f.toWallet, 'IN', 'AED'));
  }
  // 出金 payout = Debit/OUT：external_ref=你的内部号回显（InstructionIdentification=referenceNo），全 MATCH。
  for (const po of aedPayouts) {
    const viban = (po.ownerId && ownerToViban.get(po.ownerId)) || PLACEHOLDER_VIBAN;
    lines.push({
      source: 'ZAND', accountRef: CMA_ACCOUNT_REF, subAccount: viban, book: 'CLIENT', currency: 'AED',
      direction: 'OUT', amount: D(po.amount), externalRef: po.referenceNo, channelRef: `CHN-${po.referenceNo}`,
      datetime: new Date(DT), balanceAfter: null, description: 'Outgoing AED Payout', bookingId: bk('ZAND'),
    });
  }

  // ─── 4. 合成 HEXTRUST(USDT) 行（§2.3；account_ref=vault；sub_account=walletId；external_ref=txHash）──
  // 入金 payin = deposit/IN：sub_account=客户 C_DEP vault（也作 account_ref，逐钱包保留）。
  for (const p of usdtPayins) {
    if (usdtPlan?.omitRef && p.txHash === usdtPlan.omitRef) continue; // OMIT → ORPHAN_INTERNAL
    const amt = usdtPlan?.mismatchRef && p.txHash === usdtPlan.mismatchRef ? usdtPlan.mismatchExternal : D(p.amount); // AMOUNT_MISMATCH
    const vault = (p.ownerId && ownerToVault.get(p.ownerId)) || 'vault-usdt-unmapped';
    lines.push({
      source: 'HEXTRUST', accountRef: vault, subAccount: vault, book: 'CLIENT', currency: 'USDT',
      direction: 'IN', amount: amt, externalRef: p.txHash, channelRef: null,
      datetime: new Date(DT), balanceAfter: null, description: 'Crypto deposit', bookingId: bk('HEXTRUST'),
    });
  }
  // ORPHAN_EXTERNAL（USDT 落 FIRM vault）：无内部匹配的 DEPOSIT。
  if (usdtPlan && usdtPlan.orphanExtBook === 'FIRM') {
    lines.push({
      source: 'HEXTRUST', accountRef: VAULT_MAIN, subAccount: VAULT_MAIN, book: 'FIRM', currency: 'USDT',
      direction: 'IN', amount: usdtPlan.orphanExtAmount, externalRef: usdtPlan.orphanExtRef, channelRef: null,
      datetime: new Date(DT), balanceAfter: null, description: 'Unmatched crypto deposit', bookingId: bk('HEXTRUST'),
    });
  }
  // internal_fund 两腿（from OUT + to IN，各落真实账户/vault）。
  for (const f of usdtFunds) {
    lines.push(fundLegLine('HEXTRUST', f, f.fromWallet, 'OUT', 'USDT'));
    lines.push(fundLegLine('HEXTRUST', f, f.toWallet, 'IN', 'USDT'));
  }
  // 出金 payout = withdrawal/OUT：external_ref=txHash（回填 0xWDR<no>），全 MATCH（落出金 vault）。
  for (const po of usdtPayouts) {
    lines.push({
      source: 'HEXTRUST', accountRef: VAULT_OUT, subAccount: VAULT_OUT, book: 'CLIENT', currency: 'USDT',
      direction: 'OUT', amount: D(po.amount), externalRef: po.txHash, channelRef: null,
      datetime: new Date(DT), balanceAfter: null, description: 'Crypto withdrawal', bookingId: bk('HEXTRUST'),
    });
  }

  // ─── 5. balanceAfter（行后余额，展示用）：按 source+accountRef 分组从各账户 closing 倒推 ─────
  // 法币 balance_after = 主账户(CMA)级；crypto 按 vault 级。closing 头表才是核账依据（§2.1）。
  applyRunning(lines.filter((l) => l.source === 'ZAND' && l.accountRef === CMA_ACCOUNT_REF), closingAED);

  // HEXTRUST 按 book 分账（关键：式4 客户池 vs 式5 公司库分开闭合）：
  //   CLIENT vault（C_DEP 入金 vault + vault-usdt-out 出金 vault）的 Σclosing == closingUSDT（= 客户池外部目标）。
  //   FIRM vault（vault-usdt-main 归集）独立锚到 firmTB（在 §7b 随 F_* 一起 backfill），不参与 CLIENT 闭合。
  // closingUSDT 是「客户外部目标」，不能用 FIRM 归集 vault 作 plug（否则差额漏进 FIRM，式4 漂）。
  // 改用一个 CLIENT vault 作 plug：vault-usdt-out（pooled 出金 vault，非逐笔锚定）吸收差额，
  // 各 C_DEP 入金 vault 保持自身行净额（逐 vault 自洽）。
  const hexVaults = [...new Set(lines.filter((l) => l.source === 'HEXTRUST').map((l) => l.accountRef))].sort();
  const clientVaults = hexVaults.filter((v) => v !== VAULT_MAIN);
  const CLIENT_PLUG_VAULT = clientVaults.includes(VAULT_OUT) ? VAULT_OUT : clientVaults[clientVaults.length - 1];
  const vaultClosing = new Map<string, Prisma.Decimal>();
  // ① 非 plug CLIENT vault：取自身行净额（IN +, OUT −）。
  for (const v of clientVaults) {
    if (v === CLIENT_PLUG_VAULT) continue;
    const net = lines.filter((l) => l.source === 'HEXTRUST' && l.accountRef === v)
      .reduce((s, l) => s.plus(l.direction === 'IN' ? l.amount : l.amount.negated()), D(0));
    vaultClosing.set(v, net);
  }
  // ② CLIENT plug vault：吸收差额，使 Σ(CLIENT vault) == closingUSDT。
  if (CLIENT_PLUG_VAULT) {
    const sumNonPlug = [...vaultClosing.values()].reduce((s, c) => s.plus(c), D(0));
    vaultClosing.set(CLIENT_PLUG_VAULT, closingUSDT.minus(sumNonPlug));
  }
  // ③ FIRM 归集 vault：仅取自身行净额（orphan-external + funds 腿）；其 external_balance 在 §7b 锚 firmTB。
  if (hexVaults.includes(VAULT_MAIN)) {
    const net = lines.filter((l) => l.source === 'HEXTRUST' && l.accountRef === VAULT_MAIN)
      .reduce((s, l) => s.plus(l.direction === 'IN' ? l.amount : l.amount.negated()), D(0));
    vaultClosing.set(VAULT_MAIN, net);
  }
  for (const v of hexVaults) {
    applyRunning(lines.filter((l) => l.source === 'HEXTRUST' && l.accountRef === v), vaultClosing.get(v) ?? D(0));
  }

  // ─── 6. 幂等：先清当日旧行 + 当日 external_balances（去锚点⑦，recon:gen 已有）──────────
  const dayLo = new Date(`${BUSINESS_DATE}T00:00:00.000Z`);
  const dayHi = new Date(`${BUSINESS_DATE}T23:59:59.999Z`);
  await prisma.externalStatementLine.deleteMany({ where: { datetime: { gte: dayLo, lte: dayHi } } });
  await prisma.externalBalance.deleteMany({ where: { cutoffDate: BUSINESS_DATE } });

  // 写 external_statement_lines（upsert by dedupKey，幂等）。
  for (const l of lines) {
    const contentHash = createHash('sha1')
      .update([l.source, l.subAccount, l.datetime.toISOString(), l.direction, l.amount.toString(), l.channelRef, l.externalRef].join('|'))
      .digest('hex').slice(0, 16);
    const statementId = `STMT-${ymd}-${l.source}-${slug(l.accountRef)}`;
    await prisma.externalStatementLine.upsert({
      where: { dedupKey: l.bookingId },
      update: {
        source: l.source, accountRef: l.accountRef, subAccount: l.subAccount, book: l.book, currency: l.currency,
        direction: l.direction, amount: l.amount, externalRef: l.externalRef, channelRef: l.channelRef,
        datetime: l.datetime, balanceAfter: l.balanceAfter, description: l.description, statementId,
        raw: JSON.stringify({ bookingId: l.bookingId, contentHash }),
      },
      create: {
        source: l.source, accountRef: l.accountRef, subAccount: l.subAccount, book: l.book, currency: l.currency,
        direction: l.direction, amount: l.amount, externalRef: l.externalRef, channelRef: l.channelRef,
        datetime: l.datetime, balanceAfter: l.balanceAfter, description: l.description, statementId,
        raw: JSON.stringify({ bookingId: l.bookingId, contentHash }), dedupKey: l.bookingId,
      },
    });
  }

  // ─── 7. 写 external_balances（每 (source, accountRef, cutoffDate) 一行；§2.1）─────────────
  const aedLines = lines.filter((l) => l.source === 'ZAND' && l.accountRef === CMA_ACCOUNT_REF);
  const aedNet = aedLines.reduce((s, l) => s.plus(l.direction === 'IN' ? l.amount : l.amount.negated()), D(0));
  await upsertBalance(prisma, BUSINESS_DATE, DT, {
    source: 'ZAND', accountRef: CMA_ACCOUNT_REF, currency: 'AED', book: 'CLIENT',
    closing: closingAED, opening: closingAED.minus(aedNet), lineCount: aedLines.length,
  });
  for (const v of hexVaults) {
    const vLines = lines.filter((l) => l.source === 'HEXTRUST' && l.accountRef === v);
    const vNet = vLines.reduce((s, l) => s.plus(l.direction === 'IN' ? l.amount : l.amount.negated()), D(0));
    const vClose = vaultClosing.get(v) ?? D(0);
    await upsertBalance(prisma, BUSINESS_DATE, DT, {
      source: 'HEXTRUST', accountRef: v, currency: 'USDT', book: v === VAULT_MAIN ? 'FIRM' : 'CLIENT',
      closing: vClose, opening: vClose.minus(vNet), lineCount: vLines.length,
    });
  }

  // ─── 7b. FIRM treasury 账户补齐（每真实 F_* 钱包一张余额；spec 2026-06-20 §5）──────────────
  // F_* 钱包 mockBalance Σ 恰等于内部 A.FIRM_TREASURY TB。closing 锚到 firmTB 使 Σ FIRM external == firmTB
  // → 式5 干净对平。F_OPS 作 plug 吸收差额（含 USDT orphan-external 引入的 FIRM 侧 Σbreak）。
  //
  // ★ closing 仍锚 firmTB（式5 读 external_balances 头）；但 F_* 账户**现在带 internal_fund 流水**——§3/§4 两腿
  //   生成时，公司腿落到这些账户。这些行与内部 F_* 腿（leg-projection 不再滚 CMA）逐笔匹配 → pass 不冒假孤儿。
  //   opening = closing − Σ(该账户行净额) 使 roll-forward 自洽；lineCount = 实际行数。
  const firmWallets = await prisma.wallet.findMany({
    where: { walletRole: { startsWith: 'F_' }, status: 'ACTIVE' },
    select: { walletRole: true, walletNo: true, mockBalance: true, assetId: true },
    orderBy: { walletRole: 'asc' },
  });
  let firmAcctCount = 0;
  for (const [ccy, assetId, srcBal] of [
    ['AED', AED_ASSET, balAED] as const,
    ['USDT', USDT_ASSET, balUSDT] as const,
  ]) {
    const fw = firmWallets.filter((w) => w.assetId === assetId);
    if (!fw.length) continue;
    const firmTB = D(srcBal['A.FIRM_TREASURY'] ?? 0);
    // 该币种 FIRM 侧 Σbreak（USDT orphan-external 落 FIRM 时为 −amt；AED 为 0）。式5 PASS 要求
    // Σ(FIRM external) = firmTB − sumBreakFirm（与式4 同构）。把它从 F_OPS plug 目标里扣除。
    const sumBreakFirm = ccy === 'AED' ? sumBreak(aedPlan, 'FIRM') : sumBreak(usdtPlan, 'FIRM');
    // 已写入的 FIRM 余额（该币种，§7）—— USDT 含 vault-usdt-main（已含 orphan-external 行净额）。
    const existing = await prisma.externalBalance.aggregate({
      where: { book: 'FIRM', currency: ccy, cutoffDate: BUSINESS_DATE },
      _sum: { closingBalance: true },
    });
    const target = firmTB.minus(sumBreakFirm).minus(D(existing._sum.closingBalance ?? 0)); // Σ(F_* of ccy).closing 应等于此
    const plugRole = 'F_OPS';
    const sumOthersFirm = fw
      .filter((w) => w.walletRole !== plugRole)
      .reduce((s, w) => s.plus(D(w.mockBalance)), D(0));
    const source = ccy === 'AED' ? 'ZAND' : 'HEXTRUST';
    for (const w of fw) {
      const closing = w.walletRole === plugRole ? target.minus(sumOthersFirm) : D(w.mockBalance);
      const accountRef = `${w.walletRole}-${ccy}-0001`;
      const acctLines = lines.filter((l) => l.accountRef === accountRef);
      const net = acctLines.reduce((s, l) => s.plus(l.direction === 'IN' ? l.amount : l.amount.negated()), D(0));
      applyRunning(acctLines, closing); // balanceAfter（展示用，从 closing 倒推）
      await upsertBalance(prisma, BUSINESS_DATE, DT, {
        source, accountRef, currency: ccy, book: 'FIRM', closing, opening: closing.minus(net), lineCount: acctLines.length,
      });
      firmAcctCount += 1;
    }
  }
  console.log(`FIRM treasury accounts backfilled: ${firmAcctCount} (firmTB-anchored, 式5 ties ~0)`);

  // ─── 8. 写库 summary ──────────────────────────────────────────────────────────────
  const balCount = await prisma.externalBalance.count({ where: { cutoffDate: BUSINESS_DATE } });
  const lineCount = await prisma.externalStatementLine.count({ where: { datetime: { gte: dayLo, lte: dayHi } } });
  // CLIENT vault Σclosing 才是式4 目标（FIRM 归集 vault 独立锚 firmTB，不进此校验）。
  const sumHexClient = clientVaults.reduce((s, v) => s.plus(vaultClosing.get(v) ?? D(0)), D(0));

  console.log(`\n─── external written ───`);
  console.log(`external_statement_lines: ${lineCount}  |  external_balances: ${balCount}`);
  console.log(`ZAND     AED  ${CMA_ACCOUNT_REF}  closing=${closingAED}  (TB ${tbAED} − in-transit ${inTransitAED} − Σbreak ${sumBreakAED})`);
  console.log(`HEXTRUST USDT  ${hexVaults.length} vault balances:`);
  for (const v of hexVaults) console.log(`     ${v.padEnd(36)} closing=${vaultClosing.get(v) ?? D(0)}  book=${v === VAULT_MAIN ? 'FIRM' : 'CLIENT'}${v === CLIENT_PLUG_VAULT ? ' [CLIENT plug]' : ''}`);
  console.log(`  Σ CLIENT vault closing=${sumHexClient}  vs closingUSDT=${closingUSDT}  → ${sumHexClient.equals(closingUSDT) ? 'TIE ✓' : 'MISMATCH ✗'}`);

  // ─── 9. injected breaks（manifest，仅 break 模式）───────────────────────────────────
  if (mode === 'break') {
    console.log(`\n─── breaks injected (manifest, ${manifest.breaks.length} total) ───`);
    for (const b of manifest.breaks) {
      console.log(`  ${b.currency.padEnd(4)} ${b.book.padEnd(6)} ${b.bucket.padEnd(16)} ${b.targetRef.padEnd(22)} internal=${b.internalAmount ?? '—'} external=${b.externalAmount ?? '—'} signedδ=${b.signedDelta}  (${b.note})`);
    }
  } else {
    console.log(`\n─── mode=pass: no breaks, no manifest (external mirrors internal) ───`);
  }

  // ─── 10. 跑 redesign 对账引擎（APPLY；break 模式带 manifest）─────────────────────────
  console.log(`\n════════════════ RECON ENGINE (APPLY) ════════════════`);
  const orchestrator = app.get(RedesignReconRunService);
  const query = app.get(ReconciliationQueryService);
  const applied = await orchestrator.run({
    businessDate: BUSINESS_DATE,
    triggerType: 'MANUAL',
    mode: 'APPLY',
    demoManifest: mode === 'break' ? manifest : undefined,
  });
  console.log(`runNo=${applied.runNo} mode=${applied.mode} openedCount=${applied.openedCount}`);

  // ─── 11. 回读 getLatestRedesignRun 打印结果 ─────────────────────────────────────────
  const latest = await query.getLatestRedesignRun(BUSINESS_DATE);
  if (!latest) {
    console.error('✗ getLatestRedesignRun returned null after APPLY');
    await app.close();
    process.exit(1);
  }
  const caseCount = latest.cases.length;
  const lineItemCount = latest.cases.reduce((n, k) => n + k.lineItems.length, 0);
  console.log(`\n─── READ-BACK (getLatestRedesignRun) ───`);
  console.log(`run=${latest.run.runNo} status=${latest.run.status} invariantStatus=${latest.run.invariantStatus} demoManifest=${latest.run.demoManifest ? 'present' : 'null'}`);

  // 五公式分两类：
  //   内部账（式1 试算平衡 / 式2 客户勾稽 / 式3 桥勾稽）— 只读内部 TB/Outstanding/swap 桥，与外部对账单无关。
  //     ⚠ 式2(USDT) 在 demo:all 的「虚拟币 pending」末态下结构性 FAIL（CLIENT_PAYABLE 已扣的虚拟币费用其
  //       Outstanding 仍 OPEN 待跳过的 EOD 结算；Δ≈−4），这是真实内部待结算状态，外部生成器无法也不应消除它。
  //   外部账（式4 客户账外 / 式5 公司账外）— 读 external_balances，是本生成器的产物。pass 必 PASS、break 在受
  //     影响 book 必 FAIL。recon:demo 的成功判据落在这两式 + case/manifest 上（内部账三式只如实展示）。
  const codeStatus = (ccy: string, code: string): 'PASS' | 'FAIL' | undefined =>
    latest!.formulasByCurrency[ccy]?.find((c) => c.invariantCode === code)?.status as any;
  const offBookCodes = ['式4', '式5'] as const;
  const offBookAllPass = Object.keys(latest.formulasByCurrency).every((ccy) =>
    offBookCodes.every((code) => codeStatus(ccy, code) === 'PASS'),
  );
  const offBookAnyFail = Object.keys(latest.formulasByCurrency).some((ccy) =>
    offBookCodes.some((code) => codeStatus(ccy, code) === 'FAIL'),
  );

  console.log(`\n─── per-currency 5-formula PASS/FAIL ───`);
  console.log(`  (式1/式2/式3 = internal-ledger checks, generator-independent; 式4/式5 = external-driven = generator's job)`);
  for (const [ccy, checks] of Object.entries(latest.formulasByCurrency)) {
    const sorted = [...checks].sort((a, b) => a.invariantCode.localeCompare(b.invariantCode));
    const line = sorted.map((c) => `${c.invariantCode}:${c.status === 'PASS' ? '✓' : '✗'}`).join('  ');
    console.log(`  ${ccy.padEnd(5)} ${line}`);
  }
  if (codeStatus('USDT', '式2') === 'FAIL') {
    console.log(`  note: 式2(USDT) FAIL is the demo's inherent crypto-pending internal imbalance (out of external-generator scope).`);
  }

  console.log(`\n─── detected cases / line items ───`);
  console.log(`cases=${caseCount}  line_items=${lineItemCount}`);
  for (const k of latest.cases) {
    console.log(`  case ${k.caseNo} ${k.assetCode} book=${k.book ?? '—'} delta=${k.deltaAmount} status=${k.status} lineItems=${k.lineItems.length}`);
  }

  // ─── 12. final assert（落在外部账式4/式5 + case/manifest）─────────────────────────────
  if (mode === 'pass') {
    const ok = offBookAllPass && caseCount === 0 && !latest.run.demoManifest;
    console.log(`\n════════ recon:demo pass DONE — 式4/式5 allPASS=${offBookAllPass} cases=${caseCount} manifest=${latest.run.demoManifest ? 'present' : 'none'}  ${ok ? '✓' : '✗'} ════════`);
    await app.close();
    process.exit(ok ? 0 : 1);
  } else {
    const ok = offBookAnyFail && caseCount > 0 && !!latest.run.demoManifest;
    console.log(`\n════════ recon:demo break DONE — 式4/式5 anyFAIL=${offBookAnyFail}(expect true) cases=${caseCount} manifest=${latest.run.demoManifest ? 'present' : 'none'}  ${ok ? '✓' : '✗'} ════════`);
    await app.close();
    process.exit(ok ? 0 : 1);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────────
/** 从 closing 倒推每行 balance_after（top=closing；IN +, OUT −）。展示用，核账靠头表 closing。 */
function applyRunning(group: Line[], closing: Prisma.Decimal) {
  let bal = closing;
  for (const l of group) {
    l.balanceAfter = bal;
    bal = bal.minus(l.direction === 'IN' ? l.amount : l.amount.negated());
  }
}
/** accountRef → slug：非字母数字折成单个 '-'，去首尾 '-'。 */
function slug(accountRef: string): string {
  return accountRef.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
async function upsertBalance(
  prisma: PrismaService,
  businessDate: string,
  dt: string,
  b: { source: string; accountRef: string; currency: string; book: string; closing: Prisma.Decimal; opening: Prisma.Decimal; lineCount: number },
) {
  const ymd = businessDate.replace(/-/g, '');
  const statementId = `STMT-${ymd}-${b.source}-${slug(b.accountRef)}`;
  await prisma.externalBalance.upsert({
    where: { source_accountRef_cutoffDate: { source: b.source, accountRef: b.accountRef, cutoffDate: businessDate } },
    update: {
      currency: b.currency, book: b.book, closingBalance: b.closing, openingBalance: b.opening,
      asOfAt: new Date(dt), lineCount: b.lineCount, status: 'INGESTED', statementId,
    },
    create: {
      source: b.source, accountRef: b.accountRef, currency: b.currency, book: b.book, cutoffDate: businessDate,
      closingBalance: b.closing, openingBalance: b.opening, asOfAt: new Date(dt), lineCount: b.lineCount,
      status: 'INGESTED', statementId,
    },
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
