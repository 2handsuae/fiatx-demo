// scripts/e2e-confiscation-async.ts
//
// Live end-to-end proof of the ASYNC TWO-PHASE below-min deposit confiscation
// flow (spec §10 / plan 2026-07-17-confiscation-async-two-phase).
//
// Money-path acceptance: the double-entry mirror invariant (verify:coa) MUST hold
// in BOTH the in-transit state (CONFISCATING — pending legs locked, NOT posted)
// and the settled state (CONFISCATED — both legs posted).
//
// Drives the REAL domain/workflow services in-process (bootstraps its own Nest app
// via demo-lib) so the async @OnEvent listeners (onConfiscationDecided → startConfiscation,
// handleFundsOrderChanged → settleConfiscation) run in THIS process. Shares only the
// same DB + TB with the (idle) backend on :3120.
//
// Run:
//   DATABASE_URL="file:/tmp/exchange_js_wt_transaction_limits/dev.db" \
//   TB_ADDRESS="127.0.0.1:3123" \
//   npx ts-node -r tsconfig-paths/register scripts/e2e-confiscation-async.ts

import { execFileSync } from 'node:child_process';
import { bootstrap, ensureSetup, resolveDemoCustomers, waitFor, DemoCtx, sleep } from './demo-lib';
import { FundsOrderAction, FundsOrderStatus } from '../src/modules/funds-orders/dto/funds-order.dto';
import { ApprovalsService } from '../src/modules/governance/approvals/approvals.service';

const BELOW_MIN_AMOUNT = '5'; // < DEPOSIT SINGLE min (100 AED) → BELOW_MIN hold

// Two distinct actors — maker ≠ checker (SoD: DENY_SAME_USER_MAKER_CHECKER defaults enabled),
// both OPS_OFFICER (the DEPOSIT_CONFISCATION policy's single-step checker role).
const MAKER = { actorType: 'ADMIN' as const, userId: 'e2e-confisc-maker', userNo: 'E2E-MAKER', role: 'OPS_OFFICER', roleCodes: ['OPS_OFFICER'] };
const CHECKER = { actorType: 'ADMIN' as const, userId: 'e2e-confisc-checker', userNo: 'E2E-CHECKER', role: 'OPS_OFFICER', roleCodes: ['OPS_OFFICER'] };

// ── assertion accumulator ──────────────────────────────────────────────────────
const results: Array<{ label: string; pass: boolean; detail: string }> = [];
function assert(label: string, cond: boolean, detail = '') {
  results.push({ label, pass: !!cond, detail });
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}

// ── verify:coa checkpoint (shell out to the real invariant script) ──────────────
function verifyCoa(checkpoint: string): { pass: boolean; output: string } {
  console.log(`\n─── verify:coa @ ${checkpoint} ───`);
  try {
    const output = execFileSync(
      'npx',
      ['ts-node', '-r', 'tsconfig-paths/register', 'scripts/verify-realtime-coa.ts'],
      { env: process.env, encoding: 'utf8', cwd: process.cwd() },
    );
    process.stdout.write(output);
    const pass = /ALL INVARIANTS PASS/.test(output);
    return { pass, output: output.trim() };
  } catch (e: any) {
    const output = `${e.stdout ?? ''}${e.stderr ?? ''}\n[exit ${e.status}]`;
    process.stdout.write(output);
    return { pass: false, output: output.trim() };
  }
}

// ── drive helpers ───────────────────────────────────────────────────────────────

/** Create a below-min FIAT AED deposit and drive it to COMPLIANCE_PENDING + BELOW_MIN. */
async function makeBelowMinDeposit(ctx: DemoCtx, cViban: any, ref: string): Promise<any> {
  const { deposit }: any = await ctx.deposits.detected({
    assetId: ctx.aed.id,
    toWalletId: cViban.id,
    amount: BELOW_MIN_AMOUNT,
    fromIban: 'AE00SENDERX',
    referenceNo: ref,
  });
  // FIAT payin is CONFIRMED-at-birth → auto-drives onPayinConfirmed synchronously,
  // but wait to be robust against any async ordering.
  const settled = await waitFor(`${deposit.depositNo} COMPLIANCE_PENDING+BELOW_MIN`, async () => {
    const d: any = await ctx.deposits.findOne(deposit.id);
    if (['REJECTED', 'FAILED', 'SUCCESS'].includes(d.status)) {
      throw new Error(`${deposit.depositNo} unexpectedly ${d.status} (expected held at COMPLIANCE_PENDING)`);
    }
    return d.status === 'COMPLIANCE_PENDING' && d.limitHoldReason === 'BELOW_MIN' ? d : null;
  });
  return settled;
}

/** Maker requests confiscation → checker approves → wait for CONFISCATING + legSeq-2 order. */
async function confiscateApproveToConfiscating(
  ctx: DemoCtx,
  approvals: ApprovalsService,
  deposit: any,
): Promise<{ fo2: any }> {
  await ctx.depositWf.initiateConfiscation(deposit.id, { reason: 'below-min e2e confiscation' }, MAKER);

  // Locate the open approval opened by initiateConfiscation (entityRef = deposit.id).
  const open: any = await approvals.list({
    actionType: 'DEPOSIT_CONFISCATION',
    entityRef: deposit.id,
    status: 'PENDING',
    take: 1,
  } as any);
  if (!open.items?.length) throw new Error(`no PENDING confiscation approval found for ${deposit.depositNo}`);
  const approvalId = open.items[0].id;

  await approvals.approve(approvalId, {}, CHECKER);

  // APPROVED → (async) workflow.deposit-confiscation.decided → onConfiscationDecided →
  // startConfiscation → CONFISCATING + legSeq-2 funds order CREATED + 2 pending legs.
  await waitFor(`${deposit.depositNo} CONFISCATING`, async () => {
    const d: any = await ctx.deposits.findOne(deposit.id);
    return d.status === 'CONFISCATING' ? d : null;
  });
  const fo2 = await waitFor(`${deposit.depositNo} legSeq-2 funds order CREATED`, async () => {
    const [leg]: any[] = await ctx.fundsOrders.findByParent({ depositTransactionId: deposit.id }, { legSeq: 2 });
    return leg ?? null;
  });
  return { fo2 };
}

/** Advance a funds order to CONFIRMED, walking the state machine step-by-step
 *  toward CONFIRMED (mirrors the ops ⚡ advance panel: fundsOrders.advance). */
async function advanceToConfirmed(ctx: DemoCtx, foId: string): Promise<any> {
  for (let step = 0; step < 8; step++) {
    const fo: any = await ctx.prisma.fundsOrder.findUnique({ where: { id: foId }, include: { asset: true } });
    if (fo.status === FundsOrderStatus.CONFIRMED || fo.status === FundsOrderStatus.CLEARED) return fo;
    const assetType = String(fo.asset?.type ?? 'CRYPTO').toUpperCase();
    let action: FundsOrderAction;
    if (fo.status === FundsOrderStatus.CREATED) action = FundsOrderAction.SUBMIT;
    else if (fo.status === FundsOrderStatus.SUBMITTED)
      action = assetType === 'CRYPTO' ? FundsOrderAction.OBSERVE_CONFIRMING : FundsOrderAction.CONFIRM;
    else if (fo.status === FundsOrderStatus.CONFIRMING) action = FundsOrderAction.CONFIRM;
    else throw new Error(`funds order ${fo.fundsOrderNo} stuck at ${fo.status} — cannot reach CONFIRMED`);
    await ctx.fundsOrders.advance(foId, action, 'SYSTEM');
    await sleep(40);
  }
  const fo: any = await ctx.prisma.fundsOrder.findUnique({ where: { id: foId } });
  return fo;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' e2e: async two-phase below-min confiscation — 两态 verify:coa 守恒');
  console.log('═══════════════════════════════════════════════════════════════');

  const ctx = await bootstrap();
  const approvals = ctx.app.get(ApprovalsService);
  await ensureSetup(ctx);

  const customers = await resolveDemoCustomers(ctx.prisma);
  const cA = customers[0];
  const cB = customers[1];
  const vibanA = await ctx.prisma.wallet.findFirst({ where: { ownerId: cA.id, walletRole: 'C_VIBAN', assetId: ctx.aed.id } });
  const vibanB = await ctx.prisma.wallet.findFirst({ where: { ownerId: cB.id, walletRole: 'C_VIBAN', assetId: ctx.aed.id } });
  if (!vibanA || !vibanB) throw new Error('demo C_VIBAN wallets missing — ensureSetup failed');

  const stamp = Date.now();
  let depositNoA = '(none)';
  let depositNoB = '(none)';
  let coaConfiscating = '';
  let coaConfiscated = '';

  // ════════════════════════════════════════════════════════════════════════════
  // DEPOSIT A — full flow: below-min → CONFISCATING → CONFISCATED
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n━━━ DEPOSIT A: full flow → CONFISCATED ━━━');
  const depA = await makeBelowMinDeposit(ctx, vibanA, `REF-CONF-A-${stamp}`);
  depositNoA = depA.depositNo;
  console.log(`  deposit A = ${depositNoA} (owner ${cA.customerNo})`);
  assert(
    'A: COMPLIANCE_PENDING + BELOW_MIN',
    depA.status === 'COMPLIANCE_PENDING' && depA.limitHoldReason === 'BELOW_MIN',
    `status=${depA.status}, hold=${depA.limitHoldReason}`,
  );

  const { fo2: fo2A } = await confiscateApproveToConfiscating(ctx, approvals, depA);
  const depAConf: any = await ctx.deposits.findOne(depA.id);
  assert(
    'A: CONFISCATING + legSeq-2 funds order CREATED',
    depAConf.status === 'CONFISCATING' && fo2A?.legSeq === 2 && fo2A?.status === 'CREATED',
    `deposit=${depAConf.status}, fo2=${fo2A?.fundsOrderNo}/legSeq${fo2A?.legSeq}/${fo2A?.status}`,
  );

  // Checkpoint (a): invariant MUST hold while CONFISCATING (pending legs NOT posted).
  {
    const r = verifyCoa('CONFISCATING (in-transit)');
    coaConfiscating = r.output;
    assert('verify:coa @ CONFISCATING (pending locked, unposted → identity holds)', r.pass);
  }

  // Advance the legSeq-2 confiscation funds order to CONFIRMED (ops ⚡ panel path).
  let advanceErr: string | null = null;
  let fo2AAfter: any = null;
  try {
    fo2AAfter = await advanceToConfirmed(ctx, fo2A.id);
  } catch (e: any) {
    advanceErr = e?.message ?? String(e);
    console.log(`  ⚠ advance to CONFIRMED failed: ${advanceErr}`);
  }
  assert(
    'A: legSeq-2 funds order advanced to CONFIRMED',
    !!fo2AAfter && (fo2AAfter.status === FundsOrderStatus.CONFIRMED || fo2AAfter.status === FundsOrderStatus.CLEARED),
    advanceErr ? `advance error: ${advanceErr}` : `fo2 status=${fo2AAfter?.status}`,
  );

  // CONFIRMED → (async) handleFundsOrderChanged legSeq===2 → settleConfiscation →
  // post both legs → deposit CONFISCATED.
  let depAFinal: any = depAConf;
  if (fo2AAfter && (fo2AAfter.status === 'CONFIRMED' || fo2AAfter.status === 'CLEARED')) {
    try {
      depAFinal = await waitFor(`${depositNoA} CONFISCATED`, async () => {
        const d: any = await ctx.deposits.findOne(depA.id);
        return d.status === 'CONFISCATED' ? d : null;
      });
    } catch (e: any) {
      console.log(`  ⚠ ${e.message}`);
      depAFinal = await ctx.deposits.findOne(depA.id);
    }
  }
  const fo2AFinal: any = await ctx.prisma.fundsOrder.findUnique({ where: { id: fo2A.id } });
  assert(
    'A: deposit CONFISCATED + confiscation funds order CONFIRMED',
    depAFinal.status === 'CONFISCATED' && fo2AFinal?.status === 'CONFIRMED',
    `deposit=${depAFinal.status}, fo2=${fo2AFinal?.status}`,
  );

  // Checkpoint (b): invariant MUST hold after CONFISCATED (both legs posted).
  {
    const r = verifyCoa('CONFISCATED (settled)');
    coaConfiscated = r.output;
    assert('verify:coa @ CONFISCATED (both legs posted → identity holds)', r.pass);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // DEPOSIT B — stop at CONFISCATING (leave legSeq-2 funds order CREATED)
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n━━━ DEPOSIT B: stop at CONFISCATING (in-transit for admin screenshot) ━━━');
  const depB = await makeBelowMinDeposit(ctx, vibanB, `REF-CONF-B-${stamp}`);
  depositNoB = depB.depositNo;
  const { fo2: fo2B } = await confiscateApproveToConfiscating(ctx, approvals, depB);
  const depBConf: any = await ctx.deposits.findOne(depB.id);
  assert(
    'B: CONFISCATING + legSeq-2 funds order CREATED (stopped)',
    depBConf.status === 'CONFISCATING' && fo2B?.status === 'CREATED',
    `deposit=${depBConf.status}, fo2=${fo2B?.fundsOrderNo}/${fo2B?.status}`,
  );
  console.log(`\n  >>> DEPOSIT B (CONFISCATING, in-transit): ${depositNoB} — funds order ${fo2B?.fundsOrderNo} CREATED <<<`);

  // ════════════════════════════════════════════════════════════════════════════
  // Customer-facing HIDE (D4): below-min deposits are admin-only until disposed.
  // Assert on Deposit B (still BELOW_MIN hold-pending).
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n━━━ customer-facing HIDE (D4) ━━━');
  const custList: any = await ctx.deposits.findAllForCustomer(cB.id, { take: 200 } as any);
  const hiddenFromList = !custList.items.some((d: any) => d.id === depB.id);
  let hiddenFromDetail = false;
  try {
    await ctx.deposits.findOneForCustomer(depB.id, cB.id);
  } catch (e: any) {
    hiddenFromDetail = e?.constructor?.name === 'NotFoundException' || /not found/i.test(e?.message ?? '');
  }
  assert('customer-hide: excluded from findAllForCustomer', hiddenFromList, `list size=${custList.items.length}`);
  assert('customer-hide: findOneForCustomer throws NotFound', hiddenFromDetail);

  // ════════════════════════════════════════════════════════════════════════════
  // PASS/FAIL block
  // ════════════════════════════════════════════════════════════════════════════
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(' RESULT');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Deposit A (full → CONFISCATED):     ${depositNoA}`);
  console.log(`  Deposit B (stopped → CONFISCATING): ${depositNoB}`);
  console.log('  ───────────────────────────────────────────────────────────');
  for (const r of results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.label}${r.detail ? `  (${r.detail})` : ''}`);
  console.log('  ───────────────────────────────────────────────────────────');
  console.log(`  verify:coa @ CONFISCATING:\n${coaConfiscating.split('\n').map((l) => '      ' + l).join('\n')}`);
  console.log(`  verify:coa @ CONFISCATED:\n${coaConfiscated.split('\n').map((l) => '      ' + l).join('\n')}`);
  console.log('  ───────────────────────────────────────────────────────────');
  console.log(`  ${passed}/${results.length} assertions PASS`);
  console.log(`  OVERALL: ${failed.length === 0 ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log('═══════════════════════════════════════════════════════════════');

  await ctx.app.close();
  if (failed.length > 0) {
    console.log(`FAILED: ${failed.map((f) => f.label).join('; ')}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('\nUNCAUGHT:', e);
  process.exit(1);
});
