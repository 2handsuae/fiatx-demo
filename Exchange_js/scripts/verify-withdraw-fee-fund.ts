// One-off verification for the withdrawal fund-order redesign.
// Forces a FRESH crypto withdrawal (bypassing demo idempotency), drives it to
// SUCCESS, and asserts the new invariants:
//   - exactly 1 fee InternalFund hung on the withdrawal (status CLEAR)
//   - ZERO FUND_OUT (C_MAIN→C_OUT) InternalTransaction for the withdrawal
//   - a Payout (principal) exists
//   - COA invariants still hold
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  bootstrap,
  ensureSetup,
  resolveDemoCustomers,
  waitFor,
  sleep,
} from './demo-lib';
import { PayoutAction } from '../src/modules/asset-treasury/payouts/dto/payout.dto';

async function main() {
  const ctx = await bootstrap();
  const out: string[] = [];
  try {
    await ensureSetup(ctx);
    const customers = await resolveDemoCustomers(ctx.prisma);
    const c = customers[0];
    const asset = ctx.usdt; // crypto

    const amount = 37; // fresh amount; quote computes the fee
    const wq: any = await ctx.withdrawQuote.createQuote({
      ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
      assetId: asset.id, assetCode: asset.currency,
      amount: new Prisma.Decimal(amount), customerId: c.id,
    } as any);

    const toAddr = `T${createHash('sha256').update(`verifyfee-${c.id}`).digest('hex').slice(0, 33)}`;
    let wd: any;
    for (let attempt = 1; ; attempt++) {
      try {
        wd = await ctx.withdrawWf.createWithdrawal(
          { assetId: asset.id, amount, toAddress: toAddr, quoteId: wq.id } as any,
          c.id, 'CUSTOMER',
        );
        break;
      } catch (e: any) {
        if (e?.code === 'P2002' && attempt < 8) { await sleep(60); continue; }
        throw e;
      }
    }
    out.push(`created ${wd.withdrawNo} (crypto, amount ${amount})`);

    // ── assert at REQUEST time: NO fund orders yet (they appear at PAYOUT_PENDING) ──
    const feeFundsAtRequest = await ctx.prisma.internalFund.findMany({ where: { withdrawTransactionId: wd.id } });
    out.push(`fee funds at request: ${feeFundsAtRequest.length} (expect 0)`);

    // drive compliance → payout pending
    await waitFor(`${wd.withdrawNo} PENDING_COMPLIANCE`, async () => {
      const w: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
      return w.status === 'PENDING_COMPLIANCE' ? w : null;
    });
    await ctx.withdraws.updateKytStatus(wd.id, 'PASSED', null, 5, 1);
    await ctx.withdraws.updateTravelRuleStatus(wd.id, 'PASSED', null);

    const wdp: any = await waitFor(`${wd.withdrawNo} PAYOUT_PENDING`, async () => {
      const w: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
      return w.status === 'PAYOUT_PENDING' && w.payoutId ? w : null;
    }, 8000);

    // ── assert at PAYOUT_PENDING: now BOTH fund orders exist (payout + fee fund) ──
    await sleep(150); // fee fund created right after linkPayout
    const feeFundsAtPP = await ctx.prisma.internalFund.findMany({ where: { withdrawTransactionId: wd.id } });
    out.push(`fee funds at PAYOUT_PENDING: ${feeFundsAtPP.length} (expect 1, status=${feeFundsAtPP.map((f: any) => f.status).join(',') || '—'})`);

    // drive payout to CLEARED → withdrawal SUCCESS
    const seq = [PayoutAction.SIGN, PayoutAction.BROADCAST, PayoutAction.SEEN_IN_MEMPOOL, PayoutAction.CONFIRM, PayoutAction.CLEAR];
    for (const action of seq) {
      const op = action === PayoutAction.CLEAR ? 'SYSTEM' : 'DEMO';
      try { await ctx.payouts.updateStatus(wdp.payoutId, { action } as any, op); } catch { /* auto-closeout race */ }
      await sleep(80);
    }
    const final: any = await waitFor(`${wd.withdrawNo} SUCCESS`, async () => {
      const w: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
      return w.status === 'SUCCESS' ? w : null;
    }, 8000).catch(() => null);

    // ── assert FINAL state ──
    const w: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
    const feeFunds = await ctx.prisma.internalFund.findMany({ where: { withdrawTransactionId: wd.id } });
    const fundOut = await ctx.prisma.internalTransaction.count({ where: { sourceType: 'WITHDRAW', sourceId: wd.id } });
    const payout = await ctx.prisma.payout.findFirst({ where: { withdrawId: wd.id } });

    out.push(`withdrawal status: ${w.status}`);
    out.push(`payout: ${payout?.payoutNo ?? 'NONE'} (${payout?.status ?? '—'})`);
    out.push(`fee funds (final): ${feeFunds.length} → ${feeFunds.map((f: any) => `${f.internalFundNo}:${f.status}`).join(', ') || '—'}`);
    out.push(`FUND_OUT internal_transactions: ${fundOut}`);

    const pass =
      feeFundsAtRequest.length === 0 &&   // no fund order at request
      feeFundsAtPP.length === 1 &&        // both fund orders appear at PAYOUT_PENDING
      w.status === 'SUCCESS' &&
      feeFunds.length === 1 &&
      feeFunds[0].status === 'CLEAR' &&
      fundOut === 0 &&                     // no C_MAIN→C_OUT FUND_OUT
      !!payout;

    console.log('\n──────── VERIFY: fee fund created at PAYOUT_PENDING (not request) ────────');
    out.forEach((l) => console.log('  ' + l));
    console.log(`\n  RESULT: ${pass ? '✅ ALL PASS' : '❌ FAIL'}  (run verify:coa separately for ledger invariants)`);
    console.log('────────────────────────────────────────────────────────\n');
    process.exitCode = pass ? 0 : 1;
  } finally {
    await ctx.app.close();
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
