// scripts/verify-swap-self-heal.ts
//
// End-to-end proof for the V6 swap self-heal path:
//   create swap → drive leg1 to CLEAR → fail leg2 attempt 1 (asserts void +
//   attempt 2 + SWAP_LEG_RETRIED) → fail leg2 attempt 2 (RETRIED again) → fail
//   leg2 attempt 3 (asserts NEEDS_REVIEW + SWAP_LEG_STUCK + needsReview=true)
//   → resume leg2 (asserts SWAP_LEG_RESUMED + new attempt) → drive remaining
//   legs to CLEAR → SUCCESS. Asserts swap stays PROCESSING throughout failures.
//
// Run:
//   DATABASE_URL="file:/tmp/exchange_js_main/dev.db" TB_ADDRESS=127.0.0.1:3003 \
//   npx ts-node -r tsconfig-paths/register scripts/verify-swap-self-heal.ts
import { Prisma } from '@prisma/client';
import { bootstrap, ensureSetup, resolveDemoCustomers, sleep } from './demo-lib';
import { InternalFundAction } from '../src/modules/funds-layer/dto/internal-fund.dto';

const SWAP_AMOUNT_AED = 25;

async function main() {
  const ctx = await bootstrap();
  let failures = 0;
  const check = (ok: boolean, msg: string) => {
    console.log(`${ok ? '✓' : '✗'} ${msg}`);
    if (!ok) failures++;
  };

  try {
    await ensureSetup(ctx);
    const customers = await resolveDemoCustomers(ctx.prisma);
    const c = customers[1]; // use Bob to avoid the SUCCESS swap from happy-path verify
    console.log(`\n[self-heal] customer=${c.customerNo} AED→USDT amount=${SWAP_AMOUNT_AED}\n`);

    // 1) Create swap + drive leg1 to CLEAR (so we can attack leg2).
    const quote: any = await ctx.swapQuote.createQuote({
      ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
      fromAssetId: ctx.aed.id, fromAssetCode: ctx.aed.currency,
      toAssetId: ctx.usdt.id, toAssetCode: ctx.usdt.currency,
      amount: new Prisma.Decimal(SWAP_AMOUNT_AED), customerId: c.id,
    } as any);
    const swap: any = await ctx.swapWf.executeSwap(c.id, quote.id);
    console.log(`[self-heal] created ${swap.swapNo} (PROCESSING)`);

    const driveLegToClear = async (legSeq: number) => {
      const active: any = await (ctx.prisma as any).internalFund.findFirst({
        where: { swapTransactionId: swap.id, legSeq },
        orderBy: { attempt: 'desc' },
      });
      if (!active) throw new Error(`leg ${legSeq} not found`);
      const fiatPath = legSeq <= 2; // AED→USDT: legs 1,2 are fiat side
      const sequence = fiatPath
        ? [InternalFundAction.SUBMIT, InternalFundAction.CONFIRM, InternalFundAction.CLEAR]
        : [InternalFundAction.SIGN, InternalFundAction.BROADCAST, InternalFundAction.SEEN_IN_MEMPOOL, InternalFundAction.CONFIRM, InternalFundAction.CLEAR];
      for (const action of sequence) {
        const cur: any = await (ctx.prisma as any).internalFund.findUnique({ where: { id: active.id } });
        if (cur.status === 'CLEAR') break;
        try {
          await ctx.swapWf.advanceLeg(swap.swapNo, legSeq, action, 'VERIFY');
          await sleep(40);
        } catch (e: any) {
          if (!String(e?.message ?? e).includes('Invalid action')) throw e;
        }
      }
    };

    // wait for leg2 to be chained-created
    await driveLegToClear(1);
    await sleep(100);

    // 2) Fail leg2 attempt 1 → expect SWAP_LEG_RETRIED + attempt 2 row.
    const failLegOnce = async (legSeq: number, expectAttemptAfter: number | 'STUCK') => {
      const active: any = await (ctx.prisma as any).internalFund.findFirst({
        where: { swapTransactionId: swap.id, legSeq },
        orderBy: { attempt: 'desc' },
      });
      const failedAttempt = active.attempt;
      // FIAT path needs to be in CONFIRMING for FAIL to work — push SUBMIT first if CREATED.
      if (active.status === 'CREATED') {
        await ctx.swapWf.advanceLeg(swap.swapNo, legSeq, InternalFundAction.SUBMIT, 'VERIFY');
        await sleep(40);
      }
      // Now apply FAIL — this should trigger self-heal in workflow.
      try {
        await ctx.swapWf.advanceLeg(swap.swapNo, legSeq, InternalFundAction.FAIL, 'VERIFY');
      } catch (e: any) {
        if (!String(e?.message ?? e).includes('Invalid action')) throw e;
      }
      await sleep(80);

      // Inspect: the failed attempt row should be FAILED; expect a new attempt row
      // (unless this was the STUCK trigger).
      const rows: any[] = await (ctx.prisma as any).internalFund.findMany({
        where: { swapTransactionId: swap.id, legSeq },
        orderBy: { attempt: 'asc' },
      });
      const failedRow = rows.find((r) => r.attempt === failedAttempt);

      if (expectAttemptAfter === 'STUCK') {
        check(failedRow?.status === 'NEEDS_REVIEW',
          `leg${legSeq} attempt ${failedAttempt} now NEEDS_REVIEW (got ${failedRow?.status})`);
        // No new attempt row created
        check(rows.length === failedAttempt,
          `no new attempt created at STUCK (have ${rows.length} rows for attempts 1..${failedAttempt})`);
      } else {
        check(failedRow?.status === 'FAILED',
          `leg${legSeq} attempt ${failedAttempt} now FAILED (got ${failedRow?.status})`);
        const newRow = rows.find((r) => r.attempt === expectAttemptAfter);
        check(!!newRow,
          `leg${legSeq} attempt ${expectAttemptAfter} created (have ${rows.length} rows)`);
        check(newRow?.status === 'CONFIRMING' || newRow?.status === 'SIGNING',
          `leg${legSeq} attempt ${expectAttemptAfter} is in-flight (got ${newRow?.status})`);
      }
    };

    console.log('[self-heal] forcing leg2 attempt 1 to FAIL');
    await failLegOnce(2, 2);
    let retriedAudits = await (ctx.prisma as any).auditLogEvent.findMany({
      where: { entityNo: swap.swapNo, action: 'SWAP_LEG_RETRIED' },
    });
    check(retriedAudits.length === 1, `SWAP_LEG_RETRIED audited (1 expected, got ${retriedAudits.length})`);

    console.log('[self-heal] forcing leg2 attempt 2 to FAIL');
    await failLegOnce(2, 3);
    retriedAudits = await (ctx.prisma as any).auditLogEvent.findMany({
      where: { entityNo: swap.swapNo, action: 'SWAP_LEG_RETRIED' },
    });
    check(retriedAudits.length === 2, `SWAP_LEG_RETRIED audited again (2 expected, got ${retriedAudits.length})`);

    console.log('[self-heal] forcing leg2 attempt 3 to FAIL (expect NEEDS_REVIEW)');
    await failLegOnce(2, 'STUCK');
    const stuckAudit = await (ctx.prisma as any).auditLogEvent.findFirst({
      where: { entityNo: swap.swapNo, action: 'SWAP_LEG_STUCK' },
    });
    check(!!stuckAudit, `SWAP_LEG_STUCK audited at attempt 3`);

    // 3) Assert swap still PROCESSING + needsReview=true projection.
    const stuckSwap: any = await (ctx.prisma as any).swapTransaction.findUnique({ where: { id: swap.id } });
    check(stuckSwap.status === 'PROCESSING',
      `swap stays PROCESSING through 3 attempts (got ${stuckSwap.status})`);
    check(stuckSwap.needsReview === true, `projection needsReview=true at STUCK`);
    check(stuckSwap.currentStage === 'SETTLE', `currentStage=SETTLE (stuck at leg2)`);

    // 4) Resume leg2 → expect SWAP_LEG_RESUMED + attempt 4 row.
    console.log('[self-heal] manually resuming leg2 (operator recovery)');
    await ctx.swapWf.resumeLeg(swap.swapNo, 2, 'OPS_RESUMER');
    await sleep(80);
    const resumeAudit = await (ctx.prisma as any).auditLogEvent.findFirst({
      where: { entityNo: swap.swapNo, action: 'SWAP_LEG_RESUMED' },
    });
    check(!!resumeAudit, `SWAP_LEG_RESUMED audited`);
    const rowsAfterResume: any[] = await (ctx.prisma as any).internalFund.findMany({
      where: { swapTransactionId: swap.id, legSeq: 2 },
      orderBy: { attempt: 'asc' },
    });
    check(rowsAfterResume.some((r) => r.attempt === 4 && r.status !== 'NEEDS_REVIEW'),
      `leg2 attempt 4 created and in-flight after resume`);

    const afterResumeSwap: any = await (ctx.prisma as any).swapTransaction.findUnique({ where: { id: swap.id } });
    check(afterResumeSwap.needsReview === false, `projection needsReview cleared after resume`);

    // 5) Drive remaining work to SUCCESS.
    console.log('[self-heal] driving leg2 → CLEAR (resumed attempt)');
    await driveLegToClear(2);
    console.log('[self-heal] driving leg3 → CLEAR');
    await driveLegToClear(3);
    console.log('[self-heal] driving leg4 → CLEAR');
    await driveLegToClear(4);
    await sleep(100);

    const finalSwap: any = await (ctx.prisma as any).swapTransaction.findUnique({ where: { id: swap.id } });
    check(finalSwap.status === 'SUCCESS', `swap → SUCCESS after self-heal (got ${finalSwap.status})`);
    check(finalSwap.currentStage === null, `currentStage cleared at SUCCESS`);
    check(finalSwap.needsReview === false, `needsReview=false at SUCCESS`);

    const allLegs: any[] = await (ctx.prisma as any).internalFund.findMany({
      where: { swapTransactionId: swap.id },
      orderBy: [{ legSeq: 'asc' }, { attempt: 'asc' }],
    });
    const leg2Rows = allLegs.filter((l) => l.legSeq === 2);
    check(leg2Rows.length === 4,
      `leg2 history preserved: 4 rows (3 FAILED+1 CLEAR or 1 FAILED+1 NEEDS_REVIEW+attempts as expected; got ${leg2Rows.length})`);
    const leg2Cleared = leg2Rows.find((r) => r.status === 'CLEAR');
    check(!!leg2Cleared && leg2Cleared.attempt === 4, `leg2 attempt 4 is CLEAR (resumed attempt won)`);

    console.log('');
    if (failures > 0) {
      console.error(`SWAP SELF-HEAL VERIFY FAILED: ${failures} check(s) failed`);
      process.exitCode = 1;
    } else {
      console.log('SWAP SELF-HEAL VERIFY: ALL CHECKS PASS ✅ — self-heal + STUCK + resume works end-to-end');
    }
  } finally {
    await ctx.app.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
