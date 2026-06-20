// scripts/recon-redesign-statement-gen.ts
//
// V8 对账重构 — 假对账单生成器（写归一化两表）。
// 以真实内部资金单（payin/payout/internal_fund）为基底，合成 Zand(AED)+HexTrust(USDT)
// 外部对账单行，写入 NEW 归一化 schema：external_statement_lines（每笔一行）+ external_balances（每账户每 cutoff 一行）。
// 替代旧的单 blob 表 reconciliation_external_statements（见 recon-statement-demo.ts）。
//
// spec：doc-final/superpowers/specs/2026-06-20-reconciliation-redesign-design.md
//   §0.5（外部=假/合成、内部=真）、§2.1（external_balances）、§2.2（external_statement_lines）、
//   §2.3（Zand/HexTrust 字段映射）、§2.4（dedup_key）、§2.5（法币滚 CMA、保留 sub_account）。
//
// 闭合口径（供下游 G5 匹配/五公式）：
//   closingBalance(account) = TB − in-transit − Σ(break signedδ)
//   signedδ = 对 (TB − 外部) 的贡献：ORPHAN_INTERNAL +amt，ORPHAN_EXTERNAL −amt，AMOUNT_MISMATCH (internal−external)
//   （金额全 human-decimal，与 BalanceSnapshotService 已缩放口径一致。）
//
// 注入 3 个 break/币种供 G5：① orphan-external（外部有内部无）② missing line（内部有外部无）③ amount-mismatch。
//
// Run:
//   DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" npm run recon:gen

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

const BUSINESS_DATE = '2026-06-16';
const AED_ASSET = '6fa06be7-d746-474b-a39d-2350ae189e6e';
const USDT_ASSET = 'fefb1492-6b23-42a8-b9a9-530bd3f2f08f';
const D = (n: any) => new Prisma.Decimal(n);

// 法币 account_ref 一律滚到 CMA（§2.5）；行表保留 sub_account=VirtualAccount/walletId。
const CMA_ACCOUNT_REF = 'C_CMA-AED-0001';
const PLACEHOLDER_VIBAN = 'AE000000000000000001'; // 未映射客户 fallback vIBAN
const VAULT_MAIN = 'vault-usdt-main'; // 归集/公司侧 pooled vault（C_MAIN/C_OUT vaultId 为空，合成）
const VAULT_OUT = 'vault-usdt-out';
const DT = `${BUSINESS_DATE}T10:00:00.000Z`; // 合成入账时刻（缺字段即合成，§0.5）

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

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);

  // ─── 0. 读真实内部数据（payin/payout CLEARED 当日；internal_fund CLEAR 终态）────────
  const dayStart = new Date(`${BUSINESS_DATE}T00:00:00.000Z`);
  const cutoff = new Date(dayStart.getTime() + 86400000); // D 结束 = 次日 00:00

  const aedPayins = await prisma.payin.findMany({
    where: { assetId: AED_ASSET, status: 'CLEARED', createdAt: { gte: dayStart, lt: cutoff } },
    select: { referenceNo: true, amount: true, ownerId: true }, orderBy: { referenceNo: 'asc' },
  });
  const aedPayouts = await prisma.payout.findMany({
    where: { assetId: AED_ASSET, status: 'CLEARED' },
    select: { payoutNo: true, referenceNo: true, amount: true, ownerId: true }, orderBy: { payoutNo: 'asc' },
  });
  const usdtPayins = await prisma.payin.findMany({
    where: { assetId: USDT_ASSET, status: 'CLEARED', createdAt: { gte: dayStart, lt: cutoff } },
    select: { txHash: true, amount: true, ownerId: true }, orderBy: { txHash: 'asc' },
  });
  const usdtPayouts = await prisma.payout.findMany({
    where: { assetId: USDT_ASSET, status: 'CLEARED' },
    select: { payoutNo: true, txHash: true, amount: true, ownerId: true }, orderBy: { payoutNo: 'asc' },
  });
  // CLEAR internal_fund：USDT 链上腿 keyed by txHash、AED 银行腿 keyed by referenceNo。
  // 它们投影为 IN/DEPOSIT，必须在外部对账单出现匹配行，否则成 ORPHAN_INTERNAL（对闭合贡献 0）。
  const usdtFunds = await prisma.internalFund.findMany({
    where: { assetId: USDT_ASSET, status: 'CLEAR', txHash: { not: null }, createdAt: { gte: dayStart, lt: cutoff } },
    select: { internalFundNo: true, txHash: true, amount: true }, orderBy: { internalFundNo: 'asc' },
  });
  const aedFunds = await prisma.internalFund.findMany({
    where: { assetId: AED_ASSET, status: 'CLEAR', referenceNo: { not: null }, createdAt: { gte: dayStart, lt: cutoff } },
    select: { internalFundNo: true, referenceNo: true, amount: true }, orderBy: { internalFundNo: 'asc' },
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
    select: { ownerId: true, vaultId: true },
  });
  const ownerToVault = new Map<string, string>(
    depWallets.filter((w) => w.ownerId && w.vaultId).map((w) => [w.ownerId!, w.vaultId!]),
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

  // ─── 2. break 锚点（基于真实记录）──────────────────────────────────────────────────
  // AED：① OMIT REF-SEED5-5-AED(missing line) ② orphan-external REF-EXT-ORPHAN-AED 500 ③ mismatch REF-SEED5-1-AED 2391.58→2391.50(+0.08)
  const OMIT_AED = 'REF-SEED5-5-AED';
  const MISMATCH_AED = 'REF-SEED5-1-AED';
  const MISMATCH_AED_STMT = 2391.5;
  const ORPHAN_EXT_AED = { ref: 'REF-EXT-ORPHAN-AED', amount: 500.0 };
  const omitAedRow = aedPayins.find((p) => p.referenceNo === OMIT_AED);
  const mismatchAedRow = aedPayins.find((p) => p.referenceNo === MISMATCH_AED);
  if (!omitAedRow || !mismatchAedRow) throw new Error('AED break anchors missing — seed data drift; expected REF-SEED5-1/5-AED');

  const sdOrphanInternalAED = D(omitAedRow.amount); // +2865.5
  const sdOrphanExternalAED = D(ORPHAN_EXT_AED.amount).negated(); // −500
  const sdMismatchAED = D(mismatchAedRow.amount).minus(D(MISMATCH_AED_STMT)); // +0.08
  const sumBreakAED = sdOrphanInternalAED.plus(sdOrphanExternalAED).plus(sdMismatchAED);
  const closingAED = tbAED.minus(inTransitAED).minus(sumBreakAED);

  // USDT：① OMIT 0xSEED55..(missing line) ② orphan-external DEPOSIT 0xEXTORPHANUSDT 10 ③ mismatch 0xSEED51.. 315.11→315.05(+0.06)
  const OMIT_USDT = usdtPayins.find((p) => p.txHash?.startsWith('0xSEED55USDT'))?.txHash;
  const MISMATCH_USDT = usdtPayins.find((p) => p.txHash?.startsWith('0xSEED51USDT'))?.txHash;
  const MISMATCH_USDT_STMT = '315.05';
  const ORPHAN_EXT_USDT = { txHash: '0xEXTORPHANUSDT', amount: '10.00' };
  if (!OMIT_USDT || !MISMATCH_USDT) throw new Error('USDT break anchors missing — seed data drift; expected 0xSEED51/55USDT');

  const sdOrphanInternalUSDT = D(usdtPayins.find((p) => p.txHash === OMIT_USDT)!.amount); // +481.75
  const sdOrphanExternalUSDT = D(ORPHAN_EXT_USDT.amount).negated(); // −10
  const sdMismatchUSDT = D(usdtPayins.find((p) => p.txHash === MISMATCH_USDT)!.amount).minus(D(MISMATCH_USDT_STMT)); // +0.06
  const sumBreakUSDT = sdOrphanInternalUSDT.plus(sdOrphanExternalUSDT).plus(sdMismatchUSDT);
  const closingUSDT = tbUSDT.minus(inTransitUSDT).minus(sumBreakUSDT);

  // ─── 3. 合成 ZAND(AED) 行（§2.3 映射；direction=IN/OUT；account_ref 滚 CMA；sub_account=VIBAN）──
  const lines: Line[] = [];
  let seq = 0;
  const bk = (src: string) => `BK-${BUSINESS_DATE.replace(/-/g, '')}-${src}-${String(++seq).padStart(4, '0')}`; // 合成 booking id

  // 入金 payin = Credit/IN：external_ref=null（法币入金，§2.3）；channel_ref=合成；sub_account=客户 vIBAN。
  for (const p of aedPayins) {
    if (p.referenceNo === OMIT_AED) continue; // ② missing line：内部有外部无 → ORPHAN_INTERNAL
    const amt = p.referenceNo === MISMATCH_AED ? MISMATCH_AED_STMT : Number(p.amount); // ③ amount-mismatch
    const viban = (p.ownerId && ownerToViban.get(p.ownerId)) || PLACEHOLDER_VIBAN;
    lines.push({
      source: 'ZAND', accountRef: CMA_ACCOUNT_REF, subAccount: viban, book: 'CLIENT', currency: 'AED',
      direction: 'IN', amount: D(amt), externalRef: null, channelRef: `CHN-${p.referenceNo}`,
      datetime: new Date(DT), balanceAfter: null, description: 'Incoming AED Remittance', bookingId: bk('ZAND'),
    });
  }
  // ① orphan-external：外部有内部无 Credit（无对应客户，占位 vIBAN）→ ORPHAN_EXTERNAL
  lines.push({
    source: 'ZAND', accountRef: CMA_ACCOUNT_REF, subAccount: PLACEHOLDER_VIBAN, book: 'CLIENT', currency: 'AED',
    direction: 'IN', amount: D(ORPHAN_EXT_AED.amount), externalRef: null, channelRef: `CHN-${ORPHAN_EXT_AED.ref}`,
    datetime: new Date(DT), balanceAfter: null, description: 'Unmatched incoming credit', bookingId: bk('ZAND'),
  });
  // internal_fund 银行腿（Credit/IN，key=referenceNo）→ 匹配，0 闭合影响
  for (const f of aedFunds) {
    lines.push({
      source: 'ZAND', accountRef: CMA_ACCOUNT_REF, subAccount: PLACEHOLDER_VIBAN, book: 'CLIENT', currency: 'AED',
      direction: 'IN', amount: D(f.amount), externalRef: null, channelRef: `CHN-${f.referenceNo}`,
      datetime: new Date(DT), balanceAfter: null, description: 'Internal fund settlement transfer', bookingId: bk('ZAND'),
    });
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
    if (p.txHash === OMIT_USDT) continue; // ② missing line → ORPHAN_INTERNAL
    const amt = p.txHash === MISMATCH_USDT ? MISMATCH_USDT_STMT : String(p.amount); // ③ amount-mismatch
    const vault = (p.ownerId && ownerToVault.get(p.ownerId)) || 'vault-usdt-unmapped';
    lines.push({
      source: 'HEXTRUST', accountRef: vault, subAccount: vault, book: 'CLIENT', currency: 'USDT',
      direction: 'IN', amount: D(amt), externalRef: p.txHash, channelRef: null,
      datetime: new Date(DT), balanceAfter: null, description: 'Crypto deposit', bookingId: bk('HEXTRUST'),
    });
  }
  // ① orphan-external：无内部匹配的 DEPOSIT → ORPHAN_EXTERNAL（落归集 vault）
  lines.push({
    source: 'HEXTRUST', accountRef: VAULT_MAIN, subAccount: VAULT_MAIN, book: 'FIRM', currency: 'USDT',
    direction: 'IN', amount: D(ORPHAN_EXT_USDT.amount), externalRef: ORPHAN_EXT_USDT.txHash, channelRef: null,
    datetime: new Date(DT), balanceAfter: null, description: 'Unmatched crypto deposit', bookingId: bk('HEXTRUST'),
  });
  // internal_fund 链上腿（deposit/IN，key=txHash）→ 匹配，0 闭合影响（落归集 vault）
  for (const f of usdtFunds) {
    lines.push({
      source: 'HEXTRUST', accountRef: VAULT_MAIN, subAccount: VAULT_MAIN, book: 'FIRM', currency: 'USDT',
      direction: 'IN', amount: D(f.amount), externalRef: f.txHash, channelRef: null,
      datetime: new Date(DT), balanceAfter: null, description: 'Internal fund on-chain leg', bookingId: bk('HEXTRUST'),
    });
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
  // ZAND CMA closing = closingAED；倒推 running balance（IN +, OUT −）。
  applyRunning(lines.filter((l) => l.source === 'ZAND' && l.accountRef === CMA_ACCOUNT_REF), closingAED);

  // HEXTRUST 按 accountRef(vault) 分组：每 vault 的 closing 由其行净额决定（DEPOSIT +, WITHDRAWAL −），
  // 归集 vault 作 pooled plug 吸收差额，使 Σ vault closing == closingUSDT。先算非 plug vault，再补 plug。
  const hexVaults = [...new Set(lines.filter((l) => l.source === 'HEXTRUST').map((l) => l.accountRef))].sort();
  const vaultClosing = new Map<string, Prisma.Decimal>();
  for (const v of hexVaults) {
    if (v === VAULT_MAIN) continue;
    const net = lines.filter((l) => l.source === 'HEXTRUST' && l.accountRef === v)
      .reduce((s, l) => s.plus(l.direction === 'IN' ? l.amount : l.amount.negated()), D(0));
    vaultClosing.set(v, net);
  }
  const sumOthers = [...vaultClosing.values()].reduce((s, c) => s.plus(c), D(0));
  vaultClosing.set(VAULT_MAIN, closingUSDT.minus(sumOthers)); // plug
  for (const v of hexVaults) {
    applyRunning(lines.filter((l) => l.source === 'HEXTRUST' && l.accountRef === v), vaultClosing.get(v)!);
  }

  // ─── 6. 写 external_statement_lines（upsert by dedupKey，幂等）────────────────────────
  // dedupKey 主用合成 booking id（§2.4 优先 booking id）；内容 hash 作兜底注释保留。
  // 先清当日旧行（按 datetime 落在业务日），避免重跑残留（dedupKey 已稳定，理论幂等，但 break 移动需清）。
  const dayLo = new Date(`${BUSINESS_DATE}T00:00:00.000Z`);
  const dayHi = new Date(`${BUSINESS_DATE}T23:59:59.999Z`);
  await prisma.externalStatementLine.deleteMany({ where: { datetime: { gte: dayLo, lte: dayHi } } });
  await prisma.externalBalance.deleteMany({ where: { cutoffDate: BUSINESS_DATE } });

  for (const l of lines) {
    const contentHash = createHash('sha1')
      .update([l.source, l.subAccount, l.datetime.toISOString(), l.direction, l.amount.toString(), l.channelRef, l.externalRef].join('|'))
      .digest('hex').slice(0, 16);
    await prisma.externalStatementLine.upsert({
      where: { dedupKey: l.bookingId },
      update: {
        source: l.source, accountRef: l.accountRef, subAccount: l.subAccount, book: l.book, currency: l.currency,
        direction: l.direction, amount: l.amount, externalRef: l.externalRef, channelRef: l.channelRef,
        datetime: l.datetime, balanceAfter: l.balanceAfter, description: l.description,
        statementId: `STMT-${BUSINESS_DATE.replace(/-/g, '')}-${l.source}-${slug(l.accountRef)}`,
        raw: JSON.stringify({ bookingId: l.bookingId, contentHash }),
      },
      create: {
        source: l.source, accountRef: l.accountRef, subAccount: l.subAccount, book: l.book, currency: l.currency,
        direction: l.direction, amount: l.amount, externalRef: l.externalRef, channelRef: l.channelRef,
        datetime: l.datetime, balanceAfter: l.balanceAfter, description: l.description,
        statementId: `STMT-${BUSINESS_DATE.replace(/-/g, '')}-${l.source}-${slug(l.accountRef)}`,
        raw: JSON.stringify({ bookingId: l.bookingId, contentHash }), dedupKey: l.bookingId,
      },
    });
  }

  // ─── 7. 写 external_balances（每 (source, accountRef, cutoffDate) 一行；§2.1）─────────────
  // ZAND：CMA 单行，closing=closingAED。opening = closing − Σ(行净额)（roll-forward 自检）。
  const aedLines = lines.filter((l) => l.source === 'ZAND' && l.accountRef === CMA_ACCOUNT_REF);
  const aedNet = aedLines.reduce((s, l) => s.plus(l.direction === 'IN' ? l.amount : l.amount.negated()), D(0));
  await upsertBalance(prisma, {
    source: 'ZAND', accountRef: CMA_ACCOUNT_REF, currency: 'AED', book: 'CLIENT',
    closing: closingAED, opening: closingAED.minus(aedNet), lineCount: aedLines.length,
  });
  // HEXTRUST：每 vault 一行。book 跟账户：C_DEP/C_OUT=CLIENT，归集 main=FIRM。
  for (const v of hexVaults) {
    const vLines = lines.filter((l) => l.source === 'HEXTRUST' && l.accountRef === v);
    const vNet = vLines.reduce((s, l) => s.plus(l.direction === 'IN' ? l.amount : l.amount.negated()), D(0));
    await upsertBalance(prisma, {
      source: 'HEXTRUST', accountRef: v, currency: 'USDT', book: v === VAULT_MAIN ? 'FIRM' : 'CLIENT',
      closing: vaultClosing.get(v)!, opening: vaultClosing.get(v)!.minus(vNet), lineCount: vLines.length,
    });
  }

  // ─── 7b. FIRM treasury 账户补齐（每真实 F_* 钱包一张余额 + 一行；spec 2026-06-20 §5）──────
  // 用户口径："每个 custodian 账号一个流水，VIBAN 除外"。F_* 钱包就是公司账本，其 mockBalance
  // Σ 恰等于内部 A.FIRM_TREASURY TB。closing 锚到 firmTB，使 Σ FIRM external == firmTB → 式5 干净对平。
  // vault-usdt-main（§4，USDT firm pooled）保留不动；F_OPS 作 plug 吸收差额使该币种 FIRM 总和=firmTB。
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
    // 已写入的 FIRM 余额（该币种，§7）—— USDT 含 vault-usdt-main。
    const existing = await prisma.externalBalance.aggregate({
      where: { book: 'FIRM', currency: ccy, cutoffDate: BUSINESS_DATE },
      _sum: { closingBalance: true },
    });
    const target = firmTB.minus(D(existing._sum.closingBalance ?? 0)); // Σ(F_* of ccy).closing 应等于此
    const plugRole = 'F_OPS';
    const sumOthers = fw
      .filter((w) => w.walletRole !== plugRole)
      .reduce((s, w) => s.plus(D(w.mockBalance)), D(0));
    const source = ccy === 'AED' ? 'ZAND' : 'HEXTRUST';
    for (const w of fw) {
      const closing = w.walletRole === plugRole ? target.minus(sumOthers) : D(w.mockBalance);
      const accountRef = `${w.walletRole}-${ccy}-0001`;
      const dir: 'IN' | 'OUT' = closing.greaterThanOrEqualTo(0) ? 'IN' : 'OUT';
      const bookingId = bk(source);
      await prisma.externalStatementLine.upsert({
        where: { dedupKey: bookingId },
        update: {},
        create: {
          source, accountRef, subAccount: w.walletNo, book: 'FIRM', currency: ccy,
          direction: dir, amount: closing.abs(), externalRef: null, channelRef: null,
          datetime: new Date(DT), balanceAfter: closing, description: 'Treasury position snapshot',
          statementId: `STMT-${BUSINESS_DATE.replace(/-/g, '')}-${source}-${slug(accountRef)}`,
          raw: JSON.stringify({ bookingId, walletNo: w.walletNo, role: w.walletRole }), dedupKey: bookingId,
        },
      });
      await upsertBalance(prisma, {
        source, accountRef, currency: ccy, book: 'FIRM', closing, opening: D(0), lineCount: 1,
      });
      firmAcctCount += 1;
    }
  }
  console.log(`FIRM treasury accounts backfilled: ${firmAcctCount} (firmTB-anchored, 式5 ties ~0)`);

  // ─── 8. summary ──────────────────────────────────────────────────────────────────
  const balCount = await prisma.externalBalance.count({ where: { cutoffDate: BUSINESS_DATE } });
  const lineCount = await prisma.externalStatementLine.count({ where: { datetime: { gte: dayLo, lte: dayHi } } });
  const sumHex = [...vaultClosing.values()].reduce((s, c) => s.plus(c), D(0));

  console.log(`\n─── written ───`);
  console.log(`external_statement_lines: ${lineCount}  |  external_balances: ${balCount}`);
  console.log(`ZAND     AED  ${CMA_ACCOUNT_REF}  closing=${closingAED}  (TB ${tbAED} − in-transit ${inTransitAED} − Σbreak ${sumBreakAED})`);
  console.log(`HEXTRUST USDT  ${hexVaults.length} vault balances:`);
  for (const v of hexVaults) console.log(`     ${v.padEnd(24)} closing=${vaultClosing.get(v)}  book=${v === VAULT_MAIN ? 'FIRM' : 'CLIENT'}`);
  console.log(`  Σ HEXTRUST closing=${sumHex}  vs aggregate closingUSDT=${closingUSDT}  → ${sumHex.equals(closingUSDT) ? 'TIE ✓' : 'MISMATCH ✗'}`);

  console.log(`\n─── breaks injected (per currency) ───`);
  console.log(`AED   ① missing line   : OMIT payin ${OMIT_AED} (${omitAedRow.amount})  → internal-only (ORPHAN_INTERNAL)`);
  console.log(`AED   ② orphan-external: ${ORPHAN_EXT_AED.ref} Credit ${ORPHAN_EXT_AED.amount}  → external-only (ORPHAN_EXTERNAL)`);
  console.log(`AED   ③ amount-mismatch: ${MISMATCH_AED} internal ${mismatchAedRow.amount} vs external ${MISMATCH_AED_STMT}  (+0.08)`);
  console.log(`USDT  ① missing line   : OMIT deposit ${OMIT_USDT.slice(0, 18)}.. (481.75)  → internal-only`);
  console.log(`USDT  ② orphan-external: ${ORPHAN_EXT_USDT.txHash} DEPOSIT ${ORPHAN_EXT_USDT.amount}  → external-only`);
  console.log(`USDT  ③ amount-mismatch: ${MISMATCH_USDT.slice(0, 18)}.. internal 315.11 vs external ${MISMATCH_USDT_STMT}  (+0.06)`);

  console.log(`\n════════ recon:gen DONE ✓  ${lineCount} lines, ${balCount} balances, 6 breaks (3/ccy) ════════`);
  await app.close();
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
  b: { source: string; accountRef: string; currency: string; book: string; closing: Prisma.Decimal; opening: Prisma.Decimal; lineCount: number },
) {
  await prisma.externalBalance.upsert({
    where: { source_accountRef_cutoffDate: { source: b.source, accountRef: b.accountRef, cutoffDate: BUSINESS_DATE } },
    update: {
      currency: b.currency, book: b.book, closingBalance: b.closing, openingBalance: b.opening,
      asOfAt: new Date(DT), lineCount: b.lineCount, status: 'INGESTED',
      statementId: `STMT-${BUSINESS_DATE.replace(/-/g, '')}-${b.source}-${slug(b.accountRef)}`,
    },
    create: {
      source: b.source, accountRef: b.accountRef, currency: b.currency, book: b.book, cutoffDate: BUSINESS_DATE,
      closingBalance: b.closing, openingBalance: b.opening, asOfAt: new Date(DT), lineCount: b.lineCount,
      status: 'INGESTED', statementId: `STMT-${BUSINESS_DATE.replace(/-/g, '')}-${b.source}-${slug(b.accountRef)}`,
    },
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
