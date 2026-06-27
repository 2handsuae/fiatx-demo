// scripts/verify-p6-lock-release.ts
//
// End-to-end proof for the P6 fix: when a payout FAILS after the customer's
// balance was locked at withdrawal creation, the workflow must release the lock
// (void the TB pending transfers) so the customer's balance is restored.
//
// Before the fix the orchestrator only flipped status + audited and never voided
// the pending locks → the customer's balance stayed locked forever.
//
// Run on the main stack:
//   DATABASE_URL="file:/tmp/exchange_js_main/dev.db" TB_ADDRESS=127.0.0.1:3003 \
//   npx ts-node -r tsconfig-paths/register scripts/verify-p6-lock-release.ts
import { createClient as tbCreateClient } from 'tigerbeetle-node';
import { Prisma } from '@prisma/client';
import { bootstrap, ensureSetup, resolveDemoCustomers, waitFor, sleep } from './demo-lib';
import { PayoutAction } from '../src/modules/asset-treasury/payouts/dto/payout.dto';
import { TB_ACCOUNT_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';

const AMOUNT_AED = 100; // well under the 200,000 AED large-value approval gate

async function main() {
  const tbAddress = process.env.TB_ADDRESS;
  if (!tbAddress) throw new Error('TB_ADDRESS not set');
  const tb = tbCreateClient({ cluster_id: 0n, replica_addresses: [tbAddress] });
  const ctx = await bootstrap();
  let failures = 0;
  const check = (ok: boolean, msg: string) => {
    console.log(`${ok ? '✓' : '✗'} ${msg}`);
    if (!ok) failures++;
  };

  try {
    await ensureSetup(ctx);
    const customers = await resolveDemoCustomers(ctx.prisma);
    const c = customers[0];
    const asset = ctx.aed;
    const ledger = (TB_LEDGERS as any)[asset.currency];
    const viban = await ctx.prisma.wallet.findFirst({
      where: { ownerId: c.id, walletRole: 'C_VIBAN', assetId: asset.id },
    });
    if (!viban) throw new Error(`${c.email} missing C_VIBAN — run demo:setup first`);

    // Customer's CLIENT_PAYABLE TB account (the liability that gets locked).
    const payableId: bigint = await ctx.accounting.resolveTbAccountId({
      code: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
      ledger,
      ownerType: 'CUSTOMER',
      ownerUuid: c.id,
    });
    const readPending = async (): Promise<bigint> => {
      const [a] = await tb.lookupAccounts([payableId]);
      return a ? a.debits_pending : 0n;
    };

    const pendingBaseline = await readPending();
    console.log(`\n[P6] customer ${c.customerNo}  AED CLIENT_PAYABLE debits_pending baseline = ${pendingBaseline}\n`);

    // 1) Create a withdrawal → locks net+fee as TB pending (DR CLIENT_PAYABLE).
    const wq: any = await ctx.withdrawQuote.createQuote({
      ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
      assetId: asset.id, assetCode: asset.currency,
      amount: new Prisma.Decimal(AMOUNT_AED), customerId: c.id,
    } as any);

    let wd: any;
    for (let attempt = 1; ; attempt++) {
      try {
        wd = await ctx.withdrawWf.createWithdrawal(
          { assetId: asset.id, amount: AMOUNT_AED, toIban: viban.iban, quoteId: wq.id } as any,
          c.id, 'CUSTOMER',
        );
        break;
      } catch (e: any) {
        if (e?.code === 'P2002' && attempt < 8) { await sleep(60); continue; }
        throw e;
      }
    }
    console.log(`[P6] created withdrawal ${wd.withdrawNo} (amount ${AMOUNT_AED} AED)`);

    // 2) Drive to PAYOUT_PENDING (compliance pass).
    await waitFor(`${wd.withdrawNo} PENDING_COMPLIANCE`, async () => {
      const w: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
      return w.status === 'PENDING_COMPLIANCE' ? w : null;
    }, 8000);
    await ctx.withdraws.updateKytStatus(wd.id, 'PASSED', null, 5, 1); // fiat: TR auto NOT_REQUIRED

    const wdp: any = await waitFor(`${wd.withdrawNo} PAYOUT_PENDING`, async () => {
      const w: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
      return w.status === 'PAYOUT_PENDING' && w.payoutId ? w : null;
    }, 8000);

    const pendingLocked = await readPending();
    const lockedDelta = pendingLocked - pendingBaseline;
    const expectedLock =
      BigInt(Math.round(Number(wdp.netAmount) * 10 ** asset.decimals)) +
      BigInt(Math.round(Number(wdp.feeAmount) * 10 ** asset.decimals));
    console.log(`[P6] at PAYOUT_PENDING: debits_pending = ${pendingLocked} (delta ${lockedDelta}, expected lock ${expectedLock})`);
    check(lockedDelta === expectedLock, `balance LOCKED at PAYOUT_PENDING: delta ${lockedDelta} == net+fee ${expectedLock}`);

    // 3) FAIL the payout → EVT_PAYOUT_FAILED → workflow.compensatePayout → releaseLock.
    await ctx.payouts.updateStatus(wdp.payoutId, { action: PayoutAction.SUBMIT } as any, 'P6_VERIFY');
    await sleep(80);
    await ctx.payouts.updateStatus(wdp.payoutId, { action: PayoutAction.FAIL } as any, 'P6_VERIFY');

    // 4) Withdrawal must reach FAILED.
    const wFailed: any = await waitFor(`${wd.withdrawNo} FAILED`, async () => {
      const w: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
      return w.status === 'FAILED' ? w : null;
    }, 8000).catch(() => null);
    check(!!wFailed, `withdrawal transitioned to FAILED after payout failure`);

    // 5) THE FIX: the lock must be released — debits_pending back to baseline.
    await sleep(150);
    const pendingAfter = await readPending();
    console.log(`[P6] after payout FAIL: debits_pending = ${pendingAfter} (baseline ${pendingBaseline})`);
    check(pendingAfter === pendingBaseline, `balance LOCK RELEASED: debits_pending ${pendingAfter} back to baseline ${pendingBaseline}`);

    // 6) Audit evidence WITHDRAW_LOCK_RELEASED written.
    const releaseAudit = await ctx.prisma.auditLogEvent.findFirst({
      where: { entityNo: wd.withdrawNo, action: 'WITHDRAW_LOCK_RELEASED' },
    });
    check(!!releaseAudit, `audit WITHDRAW_LOCK_RELEASED recorded for ${wd.withdrawNo}`);

    // 7) Fee InternalFund (if any) cancelled.
    const feeFund = await ctx.prisma.internalFund.findFirst({
      where: { withdrawTransactionId: wd.id },
    });
    if (feeFund) {
      check(feeFund.status === 'CANCELLED', `fee InternalFund ${feeFund.internalFundNo} → CANCELLED (was ${feeFund.status})`);
    } else {
      console.log(`  (no fee InternalFund for ${wd.withdrawNo} — fee was 0)`);
    }

    console.log('');
    if (failures > 0) {
      console.error(`P6 VERIFY FAILED: ${failures} check(s) failed`);
      process.exitCode = 1;
    } else {
      console.log('P6 VERIFY: ALL CHECKS PASS — payout failure releases the customer balance lock ✅');
    }
  } finally {
    tb.destroy();
    await ctx.app.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
