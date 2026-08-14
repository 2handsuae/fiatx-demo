// scripts/verify-swap-redesign-happy.ts
//
// End-to-end proof for the V6 swap happy path — now COMPLIANCE_PENDING-first
// (Task 4's split of executeSwap into initiateSwap + Task 6's webhook-driven
// applyKytVerdict): initiateSwap books NOTHING; an approving KYT verdict is
// what books leg1 and flips the swap to PROCESSING; each leg then chains the
// next on CLEAR. Asserts the structural invariants:
//   - swap created COMPLIANCE_PENDING with zero legs (the headline property —
//     see test/swap-money-arc.e2e-spec.ts for the rejected-side proof)
//   - approving verdict → PROCESSING + leg1 booked (attempt 1)
//   - exactly 4 funds_order rows for legSeq 1..4, each attempt=1, status CLEARED
//   - swap.status === 'SUCCESS', currentStage === null, needsReview === false
//   - SWAP_SUCCEEDED audited
//
// Task 12 rework: the old script called executeSwap() (deleted by Task 4,
// split into initiateSwap/applyKytVerdict) and asserted leg1 existed
// immediately after creation — behaviour this feature deliberately removed
// (see doc-final/reference/truth/v6-swap.md). It also drove the retired
// InternalFund table/InternalFundAction vocabulary (SIGN/BROADCAST/
// CONFIRMING/CLEAR) — long gone, replaced by the funds_order table +
// FundsOrderAction/FundsOrderStatus (Round 2 rename).
//
// Run:
//   DATABASE_URL="file:/tmp/exchange_js_main/dev.db" TB_ADDRESS=127.0.0.1:3003 \
//   npx ts-node -r tsconfig-paths/register scripts/verify-swap-redesign-happy.ts
import { Prisma } from '@prisma/client';
import { bootstrap, ensureSetup, resolveDemoCustomers, sleep, waitFor } from './demo-lib';
import { FundsOrderAction, FundsOrderStatus } from '../src/modules/funds-orders/dto/funds-order.dto';

const SWAP_AMOUNT_AED = 50; // small enough that any customer has the balance

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
    const c = customers[0];
    console.log(`\n[swap-happy] customer=${c.customerNo} AED→USDT amount=${SWAP_AMOUNT_AED} (new swap to exercise the redesign)\n`);

    // 1) Create a new quote (AED→USDT to differ from the baseline USDT→AED swaps).
    const quote: any = await ctx.swapQuote.createQuote({
      ownerType: 'CUSTOMER',
      ownerId: c.id,
      ownerNo: c.customerNo,
      fromAssetId: ctx.aed.id,
      fromAssetCode: ctx.aed.currency,
      toAssetId: ctx.usdt.id,
      toAssetCode: ctx.usdt.currency,
      amount: new Prisma.Decimal(SWAP_AMOUNT_AED),
      customerId: c.id,
    } as any);

    // 2) initiateSwap must book NOTHING — the swap sits COMPLIANCE_PENDING
    //    until a Sumsub KYT verdict lands (Task 6).
    const swap: any = await ctx.swapWf.initiateSwap(c.id, quote.id);
    console.log(`[swap-happy] created ${swap.swapNo}, status=${swap.status}`);
    check(swap.status === 'COMPLIANCE_PENDING', `swap created in COMPLIANCE_PENDING`);

    const legsAtBirth = await ctx.prisma.fundsOrder.findMany({ where: { swapTransactionId: swap.id } });
    check(legsAtBirth.length === 0, `zero legs booked at creation (got ${legsAtBirth.length}) — the headline design property`);

    // 3) Feed an approving KYT verdict directly (no real Sumsub webhook in
    //    demo/local) — this is what books leg1 and flips PROCESSING.
    await ctx.swapWf.applyKytVerdict(swap.id, { verdict: 'approved' });
    const afterVerdict: any = await ctx.prisma.swapTransaction.findUnique({ where: { id: swap.id } });
    check(afterVerdict.status === 'PROCESSING', `approving verdict → PROCESSING (got ${afterVerdict.status})`);

    const legsAfterVerdict = await ctx.prisma.fundsOrder.findMany({
      where: { swapTransactionId: swap.id },
      orderBy: [{ legSeq: 'asc' }, { attempt: 'asc' }],
    });
    check(legsAfterVerdict.length === 1 && legsAfterVerdict[0].legSeq === 1,
      `only leg1 exists after the verdict (got ${legsAfterVerdict.length} legs)`);
    check(legsAfterVerdict[0]?.attempt === 1, `leg1 attempt = 1`);
    check(afterVerdict.needsReview === false, `needsReview=false after verdict`);

    // 4) Drive legSeq 1..4 CREATED → … → CONFIRMED (funds_order state machine,
    //    spec §5.3). CONFIRMED is the finalize trigger — the swap workflow's
    //    async @OnEvent handler POSTs TB, auto-CLEARs the leg, and chains the
    //    next leg's CREATED row.
    const driveLegToClear = async (legSeq: number) => {
      await waitFor(`${swap.swapNo} leg ${legSeq} created`, async () => {
        const leg = await ctx.prisma.fundsOrder.findFirst({ where: { swapTransactionId: swap.id, legSeq } });
        return leg ?? null;
      }, 8000);
      for (let step = 0; step < 8; step++) {
        const leg: any = await ctx.prisma.fundsOrder.findFirst({
          where: { swapTransactionId: swap.id, legSeq },
          include: { asset: true },
        });
        if (!leg) throw new Error(`leg ${legSeq} not found`);
        if (leg.status === FundsOrderStatus.CLEARED || leg.status === FundsOrderStatus.CONFIRMED) break;
        const isFiat = (leg.asset?.type || '').toUpperCase() === 'FIAT';
        let action: FundsOrderAction;
        if (isFiat) {
          if (leg.status === FundsOrderStatus.CREATED) action = FundsOrderAction.SUBMIT;
          else if (leg.status === FundsOrderStatus.SUBMITTED) action = FundsOrderAction.CONFIRM;
          else throw new Error(`leg ${legSeq} unexpected fiat status ${leg.status}`);
        } else {
          if (leg.status === FundsOrderStatus.CREATED) action = FundsOrderAction.SUBMIT;
          else if (leg.status === FundsOrderStatus.SUBMITTED) action = FundsOrderAction.OBSERVE_CONFIRMING;
          else if (leg.status === FundsOrderStatus.CONFIRMING) action = FundsOrderAction.CONFIRM;
          else throw new Error(`leg ${legSeq} unexpected crypto status ${leg.status}`);
        }
        await ctx.fundsOrders.advance(leg.id, action, 'SWAP_VERIFY');
        await sleep(40);
      }
      await waitFor(`${swap.swapNo} leg ${legSeq} CLEARED`, async () => {
        const leg = await ctx.prisma.fundsOrder.findFirst({ where: { swapTransactionId: swap.id, legSeq } });
        return leg?.status === FundsOrderStatus.CLEARED ? leg : null;
      }, 8000);
    };

    for (const legSeq of [1, 2, 3, 4]) {
      console.log(`[swap-happy] driving leg ${legSeq} → CLEARED`);
      await driveLegToClear(legSeq);
    }

    // 5) Final assertions.
    await sleep(100);
    const finalSwap: any = await ctx.prisma.swapTransaction.findUnique({ where: { id: swap.id } });
    console.log(`[swap-happy] final swap.status=${finalSwap.status} currentStage=${finalSwap.currentStage} needsReview=${finalSwap.needsReview}`);
    check(finalSwap.status === 'SUCCESS', `swap → SUCCESS`);
    check(finalSwap.currentStage === null, `currentStage cleared to null at SUCCESS`);
    check(finalSwap.needsReview === false, `needsReview=false at SUCCESS`);

    const finalLegs: any[] = await ctx.prisma.fundsOrder.findMany({
      where: { swapTransactionId: swap.id },
      orderBy: [{ legSeq: 'asc' }, { attempt: 'asc' }],
    });
    check(finalLegs.length === 4, `exactly 4 legs (got ${finalLegs.length})`);
    const legSeqs = finalLegs.map((l) => l.legSeq).sort();
    check(JSON.stringify(legSeqs) === '[1,2,3,4]', `legs are legSeq 1..4`);
    const allAttemptOne = finalLegs.every((l) => l.attempt === 1);
    check(allAttemptOne, `every leg attempt = 1 (no retries in happy path)`);
    const allClear = finalLegs.every((l) => l.status === FundsOrderStatus.CLEARED);
    check(allClear, `every leg status = CLEARED`);

    // 6) SWAP_SUCCEEDED audit was recorded.
    const successAudit = await ctx.prisma.auditLogEvent.findFirst({
      where: { entityNo: swap.swapNo, action: 'SWAP_SUCCEEDED' },
    });
    check(!!successAudit, `audit SWAP_SUCCEEDED recorded`);

    console.log('');
    if (failures > 0) {
      console.error(`SWAP HAPPY-PATH VERIFY FAILED: ${failures} check(s) failed`);
      process.exitCode = 1;
    } else {
      console.log('SWAP HAPPY-PATH VERIFY: ALL CHECKS PASS ✅ — COMPLIANCE_PENDING → webhook verdict → 4-leg settlement works end-to-end');
    }
  } finally {
    await ctx.app.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
