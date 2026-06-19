// scripts/recon-statement-demo.ts
//
// V8 STATEMENT-DRIVEN RECONCILIATION DEMO.
// 从内部 payin/payout 数据反向生成 Zand(AED) + HexTrust(USDT) 对账单（真实 shape，含刻意 break），
// 持久化为外部证据，经 file adapter 摄入，跑 recon APPLY，产出闭合成立的真实 run。
//
// 闭合公式（必须成立：I5 delta == Σ unmatched signedDelta）：
//   closingBalance = TB − in-transit − Σ(break signedDelta)
//   signedDelta = 对 (TB − 外部) 的贡献：ORPHAN_INTERNAL +amt，ORPHAN_EXTERNAL −amt，AMOUNT_MISMATCH (internal−external)
//
// 单位口径：BalanceSnapshotService 现已按 asset.decimals 把 TB 最小单位缩放回 human-decimal，
//   故 TB / in-transit / 对账单金额 / break delta 全部 human 口径，I5 单位自洽。
//
// Run:
//   DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" npm run recon:demo

// Node 18 polyfill：@nestjs/schedule 在模块注册时调用 crypto.randomUUID()。必须在任何 import 之前。
import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import * as fs from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { ReconciliationRunWorkflowService } from '../src/modules/clearing-settle/reconciliation/workflow/reconciliation-run-workflow.service';
import { BalanceSnapshotService } from '../src/modules/clearing-settle/reconciliation/engine/balance-snapshot.service';
import { InvariantCheckerService } from '../src/modules/clearing-settle/reconciliation/engine/invariant-checker.service';
import { InTransitService } from '../src/modules/clearing-settle/reconciliation/engine/in-transit.service';
import { BalanceReconService } from '../src/modules/clearing-settle/reconciliation/engine/balance-recon.service';
import { MatchEngineService } from '../src/modules/clearing-settle/reconciliation/engine/match-engine.service';
import { ClassifierService } from '../src/modules/clearing-settle/reconciliation/engine/classifier.service';
import { InternalActionsService } from '../src/modules/clearing-settle/reconciliation/engine/internal-actions.service';
import { ReconciliationRunService } from '../src/modules/clearing-settle/reconciliation/domain/reconciliation-run.service';
import { ReconciliationCaseService } from '../src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service';
import { ReconciliationRecordService } from '../src/modules/clearing-settle/reconciliation/domain/reconciliation-record.service';
import { AuditLogsService } from '../src/modules/audit-logging/audit-logs.service';
import { ZandFileAdapter } from '../src/modules/clearing-settle/reconciliation/adapters/zand-file.adapter';
import { HexTrustFileAdapter } from '../src/modules/clearing-settle/reconciliation/adapters/hextrust-file.adapter';

const BUSINESS_DATE = '2026-06-16';
const AED_ASSET = '6fa06be7-d746-474b-a39d-2350ae189e6e';
const USDT_ASSET = 'fefb1492-6b23-42a8-b9a9-530bd3f2f08f';
const OUT_DIR = '/tmp/recon-statements';
const D = (n: any) => new Prisma.Decimal(n);

type PayinRow = { referenceNo: string | null; txHash: string | null; amount: Prisma.Decimal; ownerId: string | null };
type PayoutRow = { payoutNo: string; referenceNo: string | null; txHash: string | null; amount: Prisma.Decimal };
// 合成的 pooled / hot-out vault accountRef（DB 中 C_MAIN/C_OUT 钱包 vaultId 为空，demo 内合成；spec §4 范围外不落库）
const VAULT_MAIN = 'vault-usdt-main';
const VAULT_OUT = 'vault-usdt-out';
const CMA_ACCOUNT_REF = 'C_CMA-AED-0001';
const PLACEHOLDER_VIBAN = 'AE000000000000000001'; // 未映射客户的 fallback vIBAN

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);

  // ─── 0. 读内部数据（payin CLEARED 当日 / payout CLEARED）──────────────────────
  const dayStart = new Date(`${BUSINESS_DATE}T00:00:00.000Z`);
  const cutoff = new Date(dayStart.getTime() + 86400000);

  const aedPayins = await prisma.payin.findMany({
    where: { assetId: AED_ASSET, status: 'CLEARED', createdAt: { gte: dayStart, lt: cutoff } },
    select: { referenceNo: true, txHash: true, amount: true, ownerId: true }, orderBy: { referenceNo: 'asc' },
  });
  const aedPayouts = await prisma.payout.findMany({
    where: { assetId: AED_ASSET, status: 'CLEARED' },
    select: { payoutNo: true, referenceNo: true, txHash: true, amount: true }, orderBy: { payoutNo: 'asc' },
  });
  const usdtPayins = await prisma.payin.findMany({
    where: { assetId: USDT_ASSET, status: 'CLEARED', createdAt: { gte: dayStart, lt: cutoff } },
    select: { referenceNo: true, txHash: true, amount: true, ownerId: true }, orderBy: { txHash: 'asc' },
  });
  const usdtPayouts = await prisma.payout.findMany({
    where: { assetId: USDT_ASSET, status: 'CLEARED' },
    select: { payoutNo: true, referenceNo: true, txHash: true, amount: true }, orderBy: { payoutNo: 'asc' },
  });
  // CLEAR internal_funds with on-chain txHash（USDT 链上内转，已结算）→ 必须在 HexTrust 对账单出现以匹配（IN/DEPOSIT），否则成 ORPHAN。
  const usdtFunds = await prisma.internalFund.findMany({
    where: { assetId: USDT_ASSET, status: 'CLEAR', txHash: { not: null }, createdAt: { gte: dayStart, lt: cutoff } },
    select: { internalFundNo: true, txHash: true, amount: true }, orderBy: { internalFundNo: 'asc' },
  });
  // CLEAR fiat internal_funds keyed by bank referenceNo（AED 内部转账，已结算）→ collect() 现按
  // (txHash || referenceNo) 收集为 IN，故必须在 Zand 对账单出现匹配的 Credit，否则成 ORPHAN_INTERNAL。
  // 与 usdtFunds 同理：匹配腿对闭合贡献为 0。
  const aedFunds = await prisma.internalFund.findMany({
    where: { assetId: AED_ASSET, status: 'CLEAR', referenceNo: { not: null }, createdAt: { gte: dayStart, lt: cutoff } },
    select: { internalFundNo: true, referenceNo: true, amount: true }, orderBy: { internalFundNo: 'asc' },
  });

  // ─── 0b. payin.ownerId → 客户物理账户映射（对账单按物理账户隔离）───────────────
  //   USDT: ownerId → C_DEP wallet.vaultId（每客户充值 vault = 一张 HexTrust 单）
  //   AED : ownerId → C_VIBAN wallet.iban（虚拟子账户 = CMA 单内 VirtualAccount 行标签）
  const depWallets = await prisma.wallet.findMany({
    where: { assetId: USDT_ASSET, walletRole: 'C_DEP', status: 'ACTIVE' },
    select: { ownerId: true, vaultId: true },
  });
  const ownerToVault = new Map<string, string>(
    depWallets.filter(w => w.ownerId && w.vaultId).map(w => [w.ownerId!, w.vaultId!]),
  );
  const vibanWallets = await prisma.wallet.findMany({
    where: { assetId: AED_ASSET, walletRole: 'C_VIBAN', status: 'ACTIVE' },
    select: { ownerId: true, iban: true },
  });
  const ownerToViban = new Map<string, string>(
    vibanWallets.filter(w => w.ownerId && w.iban).map(w => [w.ownerId!, w.iban!]),
  );

  // ─── 1. 回填 crypto payout txHash（当前为空）：0xWDR<payoutNo>，写回 payouts 行 ───
  for (const po of usdtPayouts) {
    if (!po.txHash) {
      const tx = `0xWDR${po.payoutNo}`;
      await prisma.payout.updateMany({ where: { payoutNo: po.payoutNo }, data: { txHash: tx } });
      po.txHash = tx;
    }
  }

  // ─── 2. 读 in-transit 真实值 + TB（用真实 engine，已缩放 human）──────────────────
  const snap = app.get(BalanceSnapshotService);
  const it = app.get(InTransitService);
  const balAED = await snap.balancesAtCutoff('AED', cutoff);
  const balUSDT = await snap.balancesAtCutoff('USDT', cutoff);
  const tbAED = D(balAED['A.CLIENT_BANK'] ?? 0);
  const tbUSDT = D(balUSDT['A.CLIENT_CUSTODY'] ?? 0);
  const inTransitAED = await it.computeFiat('AED', AED_ASSET, cutoff);
  const inTransitUSDT = await it.computeCrypto('USDT', USDT_ASSET, cutoff);

  console.log('─── REAL inputs (engine, human-decimal) ───');
  console.log(`AED  TB=${tbAED}  in-transit=${inTransitAED}`);
  console.log(`USDT TB=${tbUSDT}  in-transit=${inTransitUSDT}`);

  // ─── 3. 生成 Zand AED 对账单（real shape）+ breaks ──────────────────────────────
  // Breaks (AED): ① OMIT REF-SEED5-5-AED(2865.5) ② ADD orphan REF-EXT-ORPHAN-AED 500 ③ mismatch REF-SEED5-1-AED → 2391.50
  const OMIT_AED = 'REF-SEED5-5-AED';
  const MISMATCH_AED = 'REF-SEED5-1-AED';
  const MISMATCH_AED_STMT = 2391.5; // 内部 2391.58 → +0.08
  const ORPHAN_EXT_AED = { ref: 'REF-EXT-ORPHAN-AED', amount: 500.0 };

  const sdOrphanInternalAED = D(aedPayins.find(p => p.referenceNo === OMIT_AED)!.amount); // +2865.5
  const sdOrphanExternalAED = D(ORPHAN_EXT_AED.amount).negated();                          // −500
  const sdMismatchAED = D(aedPayins.find(p => p.referenceNo === MISMATCH_AED)!.amount).minus(D(MISMATCH_AED_STMT)); // +0.08
  const sumBreakAED = sdOrphanInternalAED.plus(sdOrphanExternalAED).plus(sdMismatchAED);
  const closingAED = tbAED.minus(inTransitAED).minus(sumBreakAED);

  const zandRecords: any[] = [];
  // top record's Balance = closingBalance（spec）。后续 record 的 running Balance 仅展示用，按累加倒推。
  // Credits = payins（除 omit），加 mismatch 调整 + orphan external。
  // VirtualAccount = 付款客户真实 vIBAN（payin.ownerId→C_VIBAN.iban）：一张物理 CMA 单内，
  //   各客户 vIBAN 是行标签，体现「虚拟子账户=单内标签，物理账户=隔离单位」。
  for (const p of aedPayins) {
    if (p.referenceNo === OMIT_AED) continue; // ① ORPHAN_INTERNAL：跳过
    const amt = p.referenceNo === MISMATCH_AED ? MISMATCH_AED_STMT : Number(p.amount); // ③ AMOUNT_MISMATCH
    const viban = (p.ownerId && ownerToViban.get(p.ownerId)) || PLACEHOLDER_VIBAN;
    zandRecords.push(zandRec(p.referenceNo!, amt, 'Credit', 'Incoming AED Remittance', viban));
  }
  // ② ORPHAN_EXTERNAL：无内部匹配的 Credit（无对应客户，用占位 vIBAN）
  zandRecords.push(zandRec(ORPHAN_EXT_AED.ref, ORPHAN_EXT_AED.amount, 'Credit', 'Unmatched incoming credit', PLACEHOLDER_VIBAN));
  // internal_fund 银行腿（Credit，IN）→ 与 collect() 的 internal_fund(IN, key=referenceNo) 匹配，0 闭合影响
  for (const f of aedFunds) {
    zandRecords.push(zandRec(f.referenceNo!, Number(f.amount), 'Credit', 'Internal fund settlement transfer', PLACEHOLDER_VIBAN));
  }
  // Debits = payouts（全部 MATCH，不影响闭合）
  for (const po of aedPayouts) {
    zandRecords.push(zandRec(po.referenceNo!, Number(po.amount), 'Debit', 'Outgoing AED Payout', PLACEHOLDER_VIBAN));
  }
  // running Balance：从 closingBalance 倒推（top = closing）
  applyRunningBalance(zandRecords, Number(closingAED));

  const zandDoc = {
    StatementInfo: { FromDate: `${BUSINESS_DATE} 00:00:00`, ToDate: `${BUSINESS_DATE} 23:59:59`, AccountId: 'C_CMA-AED-0001' },
    StatementRecords: zandRecords,
    Page: { CurrentPage: 1, PageSize: 100, TotalPages: 1, SortOrder: 'DESC', IsLastPage: true },
  };

  // ─── 4. 生成 HexTrust USDT 对账单（real shape）+ breaks ─────────────────────────
  // Breaks (USDT): ① OMIT 0xSEED55USDT...772(481.75) ② ADD orphan DEPOSIT 0xEXTORPHANUSDT 10 ③ mismatch 0xSEED51USDT...656 → 315.05
  const OMIT_USDT = usdtPayins.find(p => p.txHash?.startsWith('0xSEED55USDT'))!.txHash!;
  const MISMATCH_USDT = usdtPayins.find(p => p.txHash?.startsWith('0xSEED51USDT'))!.txHash!;
  const MISMATCH_USDT_STMT = '315.05'; // 内部 315.11 → +0.06
  const ORPHAN_EXT_USDT = { txHash: '0xEXTORPHANUSDT', amount: '10.00' };

  const sdOrphanInternalUSDT = D(usdtPayins.find(p => p.txHash === OMIT_USDT)!.amount);   // +481.75
  const sdOrphanExternalUSDT = D(ORPHAN_EXT_USDT.amount).negated();                        // −10
  const sdMismatchUSDT = D(usdtPayins.find(p => p.txHash === MISMATCH_USDT)!.amount).minus(D(MISMATCH_USDT_STMT)); // +0.06
  const sumBreakUSDT = sdOrphanInternalUSDT.plus(sdOrphanExternalUSDT).plus(sdMismatchUSDT);
  const closingUSDT = tbUSDT.minus(inTransitUSDT).minus(sumBreakUSDT);

  // 按物理 vault 隔离：每客户 C_DEP vault 一张单 + C_OUT 一张 + C_MAIN 归集（pooled plug）。
  // file adapter 对所有 HEXTRUST 行 Σ closingBalance / concat tx —— 聚合外部数 == 单张时旧值，
  // 故 I5 delta 与闭合恒等式 (Σunmatched == I5delta) 完全不变，仅分区存储。
  type HexStatement = { accountRef: string; txs: any[]; closing: Prisma.Decimal };
  const hexStatements: HexStatement[] = [];
  let seq = 0;

  // (a) 每客户 C_DEP vault 单：该客户 payin 作 DEPOSIT。
  //   OMIT 客户的 vault → 无 DEPOSIT 记录（其内部腿成 ORPHAN_INTERNAL）；MISMATCH 客户改外部金额。
  //   每 vault closing = 自身 DEPOSIT 记录运行余额（含该 vault 上 break 的影响）。
  const usdtByVault = new Map<string, typeof usdtPayins>();
  for (const p of usdtPayins) {
    const vault = (p.ownerId && ownerToVault.get(p.ownerId)) || 'vault-usdt-unmapped';
    if (!usdtByVault.has(vault)) usdtByVault.set(vault, []);
    usdtByVault.get(vault)!.push(p);
  }
  for (const [vault, payins] of [...usdtByVault.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const txs: any[] = [];
    let closing = D(0);
    for (const p of payins) {
      if (p.txHash === OMIT_USDT) continue; // ① ORPHAN_INTERNAL：此客户 vault 缺这笔 DEPOSIT
      const amt = p.txHash === MISMATCH_USDT ? MISMATCH_USDT_STMT : String(p.amount); // ③ AMOUNT_MISMATCH
      txs.push(hexTx(p.txHash!, amt, 'DEPOSIT', seq++, vault));
      closing = closing.plus(D(amt)); // DEPOSIT 增加该 vault 余额
    }
    hexStatements.push({ accountRef: vault, txs, closing });
  }

  // (b) C_OUT 出金 vault 单：payouts 作 WITHDRAWAL（全部 MATCH）。closing = −Σ payouts。
  {
    const txs: any[] = [];
    let closing = D(0);
    for (const po of usdtPayouts) {
      txs.push(hexTx(po.txHash!, String(po.amount), 'WITHDRAWAL', seq++, VAULT_OUT));
      closing = closing.minus(D(po.amount)); // WITHDRAWAL 减少 vault 余额
    }
    hexStatements.push({ accountRef: VAULT_OUT, txs, closing });
  }

  // (c) C_MAIN 归集 vault 单：internal_fund 链上腿（DEPOSIT，0 闭合影响）+ ② ORPHAN_EXTERNAL DEPOSIT。
  //   作 pooled plug：closing_main = 聚合 closingUSDT − Σ(其他单 closing)，保证 Σ全部单 == closingUSDT。
  const mainTxs: any[] = [];
  for (const f of usdtFunds) {
    mainTxs.push(hexTx(f.txHash!, String(f.amount), 'DEPOSIT', seq++, VAULT_MAIN));
  }
  mainTxs.push(hexTx(ORPHAN_EXT_USDT.txHash, ORPHAN_EXT_USDT.amount, 'DEPOSIT', seq++, VAULT_MAIN));
  const sumOthers = hexStatements.reduce((s, st) => s.plus(st.closing), D(0));
  const closingMain = closingUSDT.minus(sumOthers);
  hexStatements.push({ accountRef: VAULT_MAIN, txs: mainTxs, closing: closingMain });

  // ─── 5. 写 JSON artifacts ────────────────────────────────────────────────────
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(`${OUT_DIR}/zand-aed.json`, JSON.stringify(zandDoc, null, 2));
  for (const st of hexStatements) {
    fs.writeFileSync(`${OUT_DIR}/hextrust-${st.accountRef}.json`, JSON.stringify(st.txs, null, 2));
  }
  console.log(`\n─── artifacts written ───\n${OUT_DIR}/zand-aed.json\n${OUT_DIR}/hextrust-*.json (${hexStatements.length} vault statements)`);

  // ─── 6. 持久化为 reconciliation_external_statements（按物理账户隔离，多行）──────────
  // 先清当日旧行：上轮单张拍扁的 vault-usdt-0001 等若残留，会被 adapter Σ 进去破坏闭合。
  await prisma.reconciliationExternalStatement.deleteMany({ where: { businessDate: BUSINESS_DATE } });
  await upsertStatement(prisma, 'ZAND', BUSINESS_DATE, 'AED', CMA_ACCOUNT_REF, closingAED, JSON.stringify(zandDoc));
  for (const st of hexStatements) {
    await upsertStatement(prisma, 'HEXTRUST', BUSINESS_DATE, 'USDT', st.accountRef, st.closing, JSON.stringify(st.txs));
  }
  const sumHex = hexStatements.reduce((s, st) => s.plus(st.closing), D(0));
  console.log(`\n─── statements stored ───`);
  console.log(`ZAND     AED  ${CMA_ACCOUNT_REF}  closingBalance=${closingAED}  (TB ${tbAED} − in-transit ${inTransitAED} − Σbreak ${sumBreakAED})`);
  console.log(`HEXTRUST USDT  ${hexStatements.length} vault statements:`);
  for (const st of hexStatements) console.log(`     ${st.accountRef.padEnd(20)} closingBalance=${st.closing}`);
  console.log(`  Σ HEXTRUST closingBalance=${sumHex}  vs aggregate closingUSDT=${closingUSDT}  → ${sumHex.equals(closingUSDT) ? 'TIE ✓' : 'MISMATCH ✗'}`);
  console.log(`  (aggregate closingUSDT = TB ${tbUSDT} − in-transit ${inTransitUSDT} − Σbreak ${sumBreakUSDT})`);

  // ─── 7. 确保 COMPLETED SettlementBatch 存在（CRYPTO EOD 门）──────────────────────
  const completed = await prisma.settlementBatch.findFirst({ where: { status: 'COMPLETED' } });
  if (!completed) {
    const batchNo = `EOD-${BUSINESS_DATE.replace(/-/g, '')}-DEMO`;
    await prisma.settlementBatch.upsert({
      where: { batchNo },
      update: { status: 'COMPLETED', completedAt: new Date() },
      create: {
        batchNo, settlementType: 'EOD', status: 'COMPLETED', category: 'PRINCIPAL',
        cutoffAt: cutoff, completedAt: new Date(),
      },
    });
    console.log(`\n─── created COMPLETED SettlementBatch ${batchNo} (CRYPTO EOD gate) ───`);
  } else {
    console.log(`\n─── COMPLETED SettlementBatch already present (${completed.batchNo}) ───`);
  }

  // ─── 8. 构造 workflow（file adapter 替换 balance/tx provider，同 unit test 位置构造）──
  const buildWf = (balanceProvider: any, txProvider: any) => new ReconciliationRunWorkflowService(
    prisma,
    app.get(BalanceSnapshotService),
    app.get(InvariantCheckerService),
    app.get(InTransitService),
    balanceProvider,
    txProvider,
    app.get(BalanceReconService),
    app.get(MatchEngineService),
    app.get(ClassifierService),
    app.get(InternalActionsService),
    app.get(ReconciliationRunService),
    app.get(ReconciliationCaseService),
    app.get(ReconciliationRecordService),
    app.get(AuditLogsService),
  );
  const zandAdapter = new ZandFileAdapter(prisma);
  const hexAdapter = new HexTrustFileAdapter(prisma);
  const fiatWf = buildWf(zandAdapter, zandAdapter);
  const cryptoWf = buildWf(hexAdapter, hexAdapter);

  // ─── 9. 跑 APPLY ──────────────────────────────────────────────────────────────
  const fiatRes: any = await fiatWf.run({ businessDate: BUSINESS_DATE, layer: 'FIAT', triggerType: 'MANUAL', mode: 'APPLY' });
  const cryptoRes: any = await cryptoWf.run({ businessDate: BUSINESS_DATE, layer: 'CRYPTO', triggerType: 'MANUAL', mode: 'APPLY' });

  // ─── 10. 打印每层结果 + 闭合 + line item 明细（从 DB 读回，证明已落库）────────────
  let allPass = true;
  for (const [layer, res] of [['FIAT', fiatRes], ['CRYPTO', cryptoRes]] as const) {
    console.log(`\n════════ ${layer}  runNo=${res.runNo} mode=${res.mode} ════════`);
    if (res.skipped) { console.log('  SKIPPED (EOD gate)'); allPass = false; continue; }
    for (const c of res.cases) {
      const pass = c.closes === true;
      allPass = allPass && pass;
      console.log(`  ${c.ccy}: I5 delta=${String(c.delta)}  lineItems=${c.lineItems}  closure=${pass ? 'PASS ✓' : 'FAIL ✗'}`);
    }
    // 读回 DB line items（证明 APPLY 落库）
    const run = await prisma.reconciliationRun.findFirst({ where: { runNo: res.runNo } });
    if (run) {
      const items = await prisma.reconciliationLineItem.findMany({
        where: { foundByRunId: run.id }, orderBy: { lineNo: 'asc' },
      });
      console.log(`  ── persisted line items (${items.length}) ──`);
      for (const li of items) {
        const who = li.matchStatus === 'ORPHAN_EXTERNAL'
          ? `${li.externalSource} ${li.externalTxHash ?? li.externalTxId}`
          : `${li.internalSourceType} ${li.internalSourceNo}`;
        const amt = li.matchStatus === 'ORPHAN_EXTERNAL'
          ? String(li.externalAmount)
          : li.matchStatus === 'AMOUNT_MISMATCH'
            ? `int=${li.internalAmount} ext=${li.externalAmount}`
            : String(li.internalAmount);
        console.log(`     #${li.lineNo} ${li.matchStatus.padEnd(16)} ${who.padEnd(34)} ${amt}`);
      }
    }
  }

  console.log(`\n════════ DEMO ${allPass ? 'PASS ✓ (both layers closure holds)' : 'FAIL ✗'} ════════`);
  await app.close();
  if (!allPass) process.exit(1);
}

// ── helpers ──────────────────────────────────────────────────────────────────
function zandRec(channelRefId: string, amount: number, type: 'Credit' | 'Debit', desc: string, virtualAccount: string) {
  return {
    ChannelRefId: channelRefId, InstructionIdentification: channelRefId,
    ValueDate: BUSINESS_DATE, PostedDate: `${BUSINESS_DATE}T10:00:00`,
    InstructedAmount: { Amount: amount, Currency: 'AED' }, TransactionAmount: { Amount: amount, Currency: 'AED' },
    TransactionType: type, Remarks: '', BeneficiaryDetails: '', Description: desc,
    PartType: 'Main', Balance: 0, VirtualAccount: virtualAccount,
  };
}
function applyRunningBalance(records: any[], closing: number) {
  // top record Balance = closing；向后每条按其对账面净额回推 running balance（展示用）。
  let bal = closing;
  for (const r of records) {
    r.Balance = Number(bal.toFixed(2));
    const signed = r.TransactionType === 'Credit' ? r.TransactionAmount.Amount : -r.TransactionAmount.Amount;
    bal = bal - signed;
  }
}
function hexTx(txHash: string, amountDecimal: string, type: 'DEPOSIT' | 'WITHDRAWAL', i: number, vaultId: string) {
  return {
    id: `htx-${i}-${txHash.slice(0, 10)}`, traceId: `trace-${i}`, txHash,
    amountDecimal, assetKey: 'USDT', transactionType: type, primaryTransactionStatus: 'COMPLETED',
    vaultId, from: '0xFROM', to: '0xTO', confirmationCount: 12,
    blockTimestamp: `${BUSINESS_DATE}T10:00:00Z`, createdAt: `${BUSINESS_DATE}T10:00:05Z`,
  };
}
/** accountRef → 可读且唯一的 slug：非字母数字折成单个 '-'，去首尾 '-'。 */
function slug(accountRef: string): string {
  return accountRef.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
async function upsertStatement(
  prisma: PrismaService, source: string, businessDate: string, currency: string,
  accountRef: string, closingBalance: Prisma.Decimal, rawJson: string,
) {
  // statementNo 按物理账户：STMT-{date}-{source}-{accountRefSlug}。唯一键现为 (source,businessDate,accountRef)。
  const statementNo = `STMT-${businessDate.replace(/-/g, '')}-${source}-${slug(accountRef)}`;
  await prisma.reconciliationExternalStatement.upsert({
    where: { source_businessDate_accountRef: { source, businessDate, accountRef } },
    update: { statementNo, currency, closingBalance, rawJson, fetchedAt: new Date() },
    create: { statementNo, source, businessDate, currency, accountRef, closingBalance, rawJson, fetchedAt: new Date() },
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
