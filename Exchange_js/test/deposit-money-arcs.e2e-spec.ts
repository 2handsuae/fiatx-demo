import * as path from 'path';
import * as dotenv from 'dotenv';

// Same Node 18 polyfill as src/main.ts (@nestjs/schedule needs globalThis.crypto,
// stable only in Node 19+) — main.ts isn't loaded in this e2e harness, so it has
// to be repeated here before AppModule (and therefore ScheduleModule) is imported.
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

// Loaded before any other import so PrismaService / TigerBeetleService see the
// worktree's own DATABASE_URL / TB_ADDRESS regardless of ConfigModule's internal
// load timing (belt-and-braces — mirrors deposit-sumsub-scenarios.e2e-spec.ts).
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { DepositWorkflowService } from '../src/modules/trading/deposit-transactions/deposit-workflow.service';
import { DepositTransactionStatus } from '../src/modules/trading/deposit-transactions/dto/deposit-transaction.dto';
import { FundsOrderService } from '../src/modules/funds-orders/funds-order.service';
import { FundsOrderStatus } from '../src/modules/funds-orders/dto/funds-order.dto';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TbEvidenceService } from '../src/modules/accounting/tigerbeetle/tb-evidence.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { ApprovalsService } from '../src/modules/governance/approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext } from '../src/modules/governance/approvals/constants/approval.constants';
import { SUMSUB_TXN_CLIENT } from '../src/modules/deposit-sumsub/sumsub-txn-client.interface';
import { MockSumsubTxnClient } from '../src/modules/deposit-sumsub/sumsub-txn-client.mock';
import { AuditActions, AuditEntityTypes } from '../src/modules/audit-logging/constants/audit-actions.constant';
import { fakeBankRef, fakeChainTxHash } from '../src/common/utils/fake-external-refs.util';

/**
 * Task A6: money-arcs e2e — proves the four deposit money-arcs (没收/退回/上缴/解冻,
 * 计划2 A1-A5) actually work end to end against a real AppModule + real ApprovalsService
 * + real TigerBeetle. Only SUMSUB_TXN_CLIENT is mocked (harness parity with
 * deposit-sumsub-scenarios.e2e-spec.ts — Task 12's template).
 *
 * Harness notes:
 * - Uses `demo_bob@example.com` (NOT Alice/CU2601019430, the customer the sumsub-scenarios
 *   suite owns) so this file's fixtures never touch the SAME customer-scoped TB accounts
 *   (DEPOSIT_SUSPENSE/CLIENT_PAYABLE) that suite mutates — jest's e2e config has no
 *   maxWorkers pin, so both spec files may run in parallel workers against the same
 *   worktree DB/TigerBeetle cluster; using a different customer avoids a balance-delta race.
 * - Deposits are created directly at the state each arc starts from (MANUAL_CHECKING /
 *   FROZEN) via Prisma, exactly like deposit-sumsub-scenarios's
 *   `createDepositAtCompliancePending` bypasses the full lifecycle — the earlier lifecycle
 *   stages (Gate 0, KYT dispatch, MANUAL_CHECKING entry) are already covered by Task 12's
 *   suite; this file's job is the four arcs themselves.
 * - The return/seize arcs assume money is already resting in DEPOSIT_SUSPENSE (the real
 *   precondition — Step 1 already ran before compliance review). `preBookSuspense()`
 *   reproduces that Step 1 posting (CLIENT_ASSET→DEPOSIT_SUSPENSE) via the real
 *   AccountingService so the arc's own pending/post accounting has real money to move
 *   (not a synthetic negative-balance debit).
 * - `funds_order.status.changed` is fire-and-forget `emit()` (not `emitAsync`) inside
 *   FundsOrderService.advance()/create() — same race the sumsub-scenarios file's header
 *   comment documents for `deposit.status.changed`. `driveLegTransition()` below bypasses
 *   it: mutates the funds_order row directly via Prisma (mirroring advance()'s own write,
 *   including CONFIRMED referenceNo/txHash stamping) then calls
 *   `workflow.handleFundsOrderChanged()` directly, fully awaited — no real event emitted,
 *   so there is no background/foreground double-invocation race.
 * - The approval decision cascade (ApprovalsService.approve/reject → ApprovalEvents.APPROVED
 *   → ApprovalHandlerBase.handleApproved → workflow.deposit-*.decided →
 *   DepositWorkflowService.on*Decided → on*Approved) is written as nested `await ...
 *   emitAsync(...)` end to end, but empirically does NOT block the caller until the whole
 *   cascade settles (nested/re-entrant emitAsync on the same EventEmitter2 instance — see
 *   `waitUntil()` below for the full explanation). `approve()`/`reject()` calls below are
 *   followed by `waitUntil()` polling for the expected downstream effect, not an immediate
 *   assertion.
 */
describe('Deposit money arcs (e2e, Task A6)', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let prisma: PrismaService;
  let workflow: DepositWorkflowService;
  let fundsOrders: FundsOrderService;
  let accounting: AccountingService;
  let tbEvidence: TbEvidenceService;
  let approvalsService: ApprovalsService;

  let customerId: string;
  let fiatAssetId: string;
  let fiatDecimals: number;
  let ledger: number;
  let fiatWalletId: string;

  let depositNoSeq = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SUMSUB_TXN_CLIENT)
      .useClass(MockSumsubTxnClient)
      .compile();

    app = moduleRef.createNestApplication();
    // See deposit-sumsub-scenarios.e2e-spec.ts for why this cap is raised before app.init().
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();

    prisma = app.get(PrismaService);
    workflow = app.get(DepositWorkflowService);
    fundsOrders = app.get(FundsOrderService);
    accounting = app.get(AccountingService);
    tbEvidence = app.get(TbEvidenceService);
    approvalsService = app.get(ApprovalsService);

    const customer = await prisma.customerMain.findUnique({
      where: { email: 'demo_bob@example.com' },
    });
    if (!customer) {
      throw new Error(
        "Fixture customer demo_bob@example.com not found — this worktree's self-stack DB " +
          'needs business seed data first: `DATABASE_URL=... TB_ADDRESS=... npm run db:biz:init`.',
      );
    }
    customerId = customer.id;

    const fiatAsset = await prisma.asset.findFirst({ where: { currency: 'AED' } });
    if (!fiatAsset || !fiatAsset.tbLedgerId) {
      throw new Error('Fixture asset AED not seeded (or missing tbLedgerId) — run `npm run db:biz:init` first.');
    }
    fiatAssetId = fiatAsset.id;
    fiatDecimals = fiatAsset.decimals;
    ledger = fiatAsset.tbLedgerId;

    const fiatWallet = await prisma.wallet.create({
      data: {
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        ownerNo: customer.customerNo,
        type: 'FIAT_BANK',
        assetId: fiatAssetId,
        iban: `AE_A6_E2E_${Date.now()}`,
        status: 'ACTIVE',
      },
    });
    fiatWalletId = fiatWallet.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  function uniqueDepositNo(scenarioKey: string): string {
    depositNoSeq += 1;
    return `DEPA6${scenarioKey}${Date.now()}${depositNoSeq}`;
  }

  function decimalToBigint(decimalValue: string, decimals: number): bigint {
    const [whole, frac = ''] = decimalValue.split('.');
    const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + paddedFrac);
  }

  function makeActor(userId: string, role: string): ApprovalActorContext {
    return { actorType: 'ADMIN', userId, userNo: userId, role, roleCodes: [role] };
  }

  async function createDepositAtStatus(
    scenarioKey: string,
    status: DepositTransactionStatus,
    opts: { amount: string; fromIban?: string },
  ): Promise<{ id: string; depositNo: string }> {
    const depositNo = uniqueDepositNo(scenarioKey);
    const created = await prisma.depositTransaction.create({
      data: {
        depositNo,
        traceId: depositNo,
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        status,
        statusHistory: JSON.stringify([
          {
            status,
            timestamp: new Date().toISOString(),
            operatorId: 'E2E_HARNESS',
            reason: `Task A6 e2e fixture: created directly at ${status}`,
          },
        ]),
        assetId: fiatAssetId,
        toWalletId: fiatWalletId,
        amount: new Prisma.Decimal(opts.amount),
        netAmount: new Prisma.Decimal(opts.amount),
        feeAmount: new Prisma.Decimal(0),
        fromIban: opts.fromIban ?? null,
      },
    });
    return { id: created.id, depositNo: created.depositNo };
  }

  /** Reproduces the real Step 1 posting (CLIENT_ASSET→DEPOSIT_SUSPENSE) so the arc under
   *  test has real money resting in DEPOSIT_SUSPENSE to move — matches the real precondition
   *  (compliance review only ever starts after Step 1 already ran). */
  async function preBookSuspense(depositRow: { id: string; depositNo: string }, amountBigint: bigint): Promise<void> {
    const clientAssetId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_ASSET, ledger, ownerType: 'SYSTEM' });
    const suspenseId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger, ownerType: 'CUSTOMER', ownerUuid: customerId });
    await accounting.executeTransfer({
      debitAccountId: clientAssetId,
      creditAccountId: suspenseId,
      amount: amountBigint,
      ledger,
      code: TB_TRANSFER_CODES.DEPOSIT_ASSET_TO_SUSPENSE,
      evidence: {
        sourceType: 'DEPOSIT',
        sourceNo: depositRow.depositNo,
        eventCode: 'DEPOSIT_ASSET_TO_SUSPENSE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
        creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
        assetCurrency: 'AED',
        traceId: depositRow.depositNo,
        actorType: 'SYSTEM',
        actorId: 'E2E_HARNESS',
        memo: 'Task A6 e2e fixture: simulate Step 1 (money already in suspense before the arc under test starts)',
        isExternalCrossing: false,
      },
    });
  }

  async function suspenseTotal(): Promise<bigint> {
    const suspenseId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger, ownerType: 'CUSTOMER', ownerUuid: customerId });
    const balance = await accounting.lookupBalance(suspenseId);
    return balance.creditsPosted - balance.debitsPosted; // L-normal: credit increases
  }

  /** Final-review fix: SEIZE reverted to a single leg — the A6 COA break was traced to
   *  the leg's credit account being wrong (CR FIRM_SEIZED instead of CR CLIENT_ASSET),
   *  not to a missing second leg. This helper lets the SEIZE scenario prove the client
   *  bucket (CLIENT_ASSET shrinks by the same amount as the suspense reversal) stays
   *  self-balanced on its own, exactly like the return arc. */
  async function clientAssetTotal(): Promise<bigint> {
    const id = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_ASSET, ledger, ownerType: 'SYSTEM' });
    const balance = await accounting.lookupBalance(id);
    return balance.debitsPosted - balance.creditsPosted; // asset-normal: debit increases
  }

  /**
   * Drives a legSeq 3/4 funds order to a terminal-relevant status (CONFIRMED/FAILED/
   * TIMEOUT) WITHOUT going through FundsOrderService.advance()'s real fire-and-forget
   * `emit()` (see file header) — mutates the row directly (mirroring advance()'s own
   * write, including CONFIRMED externalRef stamping) then calls the real routing entry
   * point directly, fully awaited exactly once.
   */
  async function driveLegTransition(fundsOrderId: string, toStatus: FundsOrderStatus, depositId: string): Promise<void> {
    const row: any = await fundsOrders.findById(fundsOrderId);
    if (!row) throw new Error(`funds order ${fundsOrderId} not found`);
    const oldStatus = row.status;
    const history = row.statusHistory ? JSON.parse(row.statusHistory) : [];
    history.push({ fromStatus: oldStatus, toStatus, action: 'E2E_HARNESS_DRIVE', at: new Date().toISOString() });
    const patch: any = { status: toStatus, statusHistory: JSON.stringify(history) };
    if (toStatus === FundsOrderStatus.CONFIRMED) {
      const assetType = (row.asset?.type ?? 'CRYPTO').toUpperCase();
      if (assetType === 'CRYPTO') {
        if (!row.txHash) patch.txHash = fakeChainTxHash(row.fundsOrderNo);
      } else if (!row.referenceNo) {
        patch.referenceNo = fakeBankRef(row.fundsOrderNo, row.createdAt ?? new Date());
      }
    }
    await prisma.fundsOrder.update({ where: { id: fundsOrderId }, data: patch });

    await workflow.handleFundsOrderChanged({
      fundsOrderId,
      fundsOrderNo: row.fundsOrderNo,
      parent: { depositTransactionId: depositId },
      legSeq: row.legSeq,
      attempt: row.attempt,
      oldStatus,
      newStatus: toStatus,
    });
  }

  /**
   * The approval-decided cascade (ApprovalsService.approve/reject → ApprovalEvents.APPROVED
   * → ApprovalHandlerBase.handleApproved → workflow.deposit-*.decided →
   * DepositWorkflowService.on*Decided → on*Approved) is a NESTED emitAsync call — a
   * listener registered on the OUTER event itself emits a SECOND event on the SAME
   * EventEmitter2 instance while the outer emitAsync's Promise.all is still collecting.
   * Empirically (confirmed via a standalone repro script against this real stack), that
   * inner emitAsync's completion is NOT actually awaited by the outer call — `approve()`'s
   * own returned promise resolves before the nested on*Decided/on*Approved handler settles,
   * even though every hop in the chain is written as `await ... emitAsync(...)`. So the
   * settlement is eventually-consistent, not synchronous, despite the code's appearance.
   * Poll for the expected downstream effect instead of asserting immediately after
   * approve()/reject() resolves. (`driveLegTransition()` above doesn't need this — it calls
   * `workflow.handleFundsOrderChanged()` directly, a single non-reentrant await chain.)
   */
  async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 5000, intervalMs = 50): Promise<void> {
    const start = Date.now();
    for (;;) {
      if (await predicate()) return;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  async function auditActionsFor(depositId: string): Promise<string[]> {
    const rows = await prisma.auditLogEvent.findMany({
      where: { primarySubjectNo: depositId, primarySubjectType: AuditEntityTypes.DEPOSIT_TRANSACTION },
      select: { action: true },
    });
    return rows.map((r) => r.action);
  }

  async function auditRowsFor(depositId: string, action: string): Promise<any[]> {
    return prisma.auditLogEvent.findMany({
      where: { primarySubjectNo: depositId, primarySubjectType: AuditEntityTypes.DEPOSIT_TRANSACTION, action },
    });
  }

  async function finalStatusOf(depositId: string): Promise<string | undefined> {
    const row = await prisma.depositTransaction.findUnique({ where: { id: depositId } });
    return row?.status;
  }

  async function latestApprovalCase(actionType: string, entityRef: string) {
    return prisma.approvalCase.findFirst({
      where: { actionType, entityRef },
      orderBy: { createdAt: 'desc' },
      include: { steps: true },
    });
  }

  // ── scenarios ────────────────────────────────────────────────────────────

  it('1. RETURN full arc: MANUAL_CHECKING(RETURN_TO_SENDER) → approval PENDING → approve → RETURNING + legSeq=3 pending-locked → leg CONFIRMED → RETURNED + posted, DEPOSIT_SUSPENSE debited', async () => {
    const amount = '100.00';
    const amountBigint = decimalToBigint(amount, fiatDecimals);
    const deposit = await createDepositAtStatus('RET1', DepositTransactionStatus.MANUAL_CHECKING, {
      amount,
      fromIban: 'SENDER_IBAN_RETURN_1',
    });

    await preBookSuspense(deposit, amountBigint);
    const before = await suspenseTotal();

    // Real production entry point: applyKytRejected's RETURN_TO_SENDER branch calls
    // initiateReturn() internally — exercised via applyKytVerdict, not by calling
    // initiateReturn() directly.
    await workflow.applyKytVerdict(deposit.id, { verdict: 'rejected', dispoTag: 'RETURN_TO_SENDER' });

    expect(await finalStatusOf(deposit.id)).toBe(DepositTransactionStatus.MANUAL_CHECKING);
    let actions = await auditActionsFor(deposit.id);
    expect(actions).toContain(AuditActions.DEPOSIT_RETURN_APPROVAL_REQUESTED);

    const approvalCase = await latestApprovalCase(ApprovalActionTypes.DEPOSIT_RETURN, deposit.id);
    expect(approvalCase).toBeTruthy();
    expect(approvalCase!.status).toBe('PENDING');

    await approvalsService.approve(approvalCase!.id, { reason: 'e2e approve' }, makeActor('E2E_MLRO_RETURN_1', 'MLRO'));
    await waitUntil(async () => (await finalStatusOf(deposit.id)) === DepositTransactionStatus.RETURNING);

    expect(await finalStatusOf(deposit.id)).toBe(DepositTransactionStatus.RETURNING);
    actions = await auditActionsFor(deposit.id);
    expect(actions).toContain(AuditActions.DEPOSIT_RETURN_STARTED);

    const [returnLeg] = await fundsOrders.findByParent({ depositTransactionId: deposit.id }, { legSeq: 3 });
    expect(returnLeg).toBeTruthy();
    expect(returnLeg.status).toBe(FundsOrderStatus.CREATED);
    expect(returnLeg.toWalletId).toBeNull();
    expect(returnLeg.toIban).toBe('SENDER_IBAN_RETURN_1');

    await driveLegTransition(returnLeg.id, FundsOrderStatus.CONFIRMED, deposit.id);

    expect(await finalStatusOf(deposit.id)).toBe(DepositTransactionStatus.RETURNED);
    actions = await auditActionsFor(deposit.id);
    expect(actions).toContain(AuditActions.DEPOSIT_RETURNED);

    const after = await suspenseTotal();
    expect(after - before).toBe(-amountBigint);
  });

  it('2. SEIZE full arc: FROZEN → initiateSeize(orderRef) → two-step approval (SENIOR_MANAGEMENT_OFFICER → MLRO, distinct actors) → SEIZING + legSeq=4 pending-locked (single TB leg) → leg CONFIRMED → SEIZED, evidence.memo carries orderRef, COA identity holds (final-review fix: single-leg seize, credit CLIENT_ASSET)', async () => {
    const amount = '50.00';
    const amountBigint = decimalToBigint(amount, fiatDecimals);
    const orderRef = `GOV-ORDER-${Date.now()}`;
    const deposit = await createDepositAtStatus('SEZ1', DepositTransactionStatus.FROZEN, { amount });

    await preBookSuspense(deposit, amountBigint);
    const suspenseBefore = await suspenseTotal();
    const clientAssetBefore = await clientAssetTotal();

    await workflow.initiateSeize(
      deposit.id,
      { reason: 'e2e seize', orderRef },
      makeActor('E2E_SEIZE_MAKER_1', 'OPS_OFFICER'),
    );

    const approvalCase = await latestApprovalCase(ApprovalActionTypes.DEPOSIT_SEIZE, deposit.id);
    expect(approvalCase).toBeTruthy();
    expect(approvalCase!.status).toBe('PENDING');
    expect(approvalCase!.steps).toHaveLength(2);

    // Step 1: SENIOR_MANAGEMENT_OFFICER — SoD requires a DIFFERENT actor from step 2.
    await approvalsService.approve(
      approvalCase!.id,
      { reason: 'e2e step1' },
      makeActor('E2E_SMO_1', 'SENIOR_MANAGEMENT_OFFICER'),
    );
    expect(await finalStatusOf(deposit.id)).toBe(DepositTransactionStatus.FROZEN); // mid-flight, not yet APPROVED

    const midCase = await prisma.approvalCase.findUnique({ where: { id: approvalCase!.id } });
    expect(midCase!.status).toBe('PENDING');

    // Step 2: MLRO — distinct actor from step 1.
    await approvalsService.approve(
      approvalCase!.id,
      { reason: 'e2e step2' },
      makeActor('E2E_MLRO_SEIZE_1', 'MLRO'),
    );
    await waitUntil(async () => (await finalStatusOf(deposit.id)) === DepositTransactionStatus.SEIZING);

    expect(await finalStatusOf(deposit.id)).toBe(DepositTransactionStatus.SEIZING);
    let actions = await auditActionsFor(deposit.id);
    expect(actions).toContain(AuditActions.DEPOSIT_SEIZE_STARTED);
    const startedAudit = await auditRowsFor(deposit.id, AuditActions.DEPOSIT_SEIZE_STARTED);
    expect(JSON.parse(startedAudit[0].metadata || '{}').orderRef).toBe(orderRef);

    const [seizeLeg] = await fundsOrders.findByParent({ depositTransactionId: deposit.id }, { legSeq: 4 });
    expect(seizeLeg).toBeTruthy();
    expect(seizeLeg.status).toBe(FundsOrderStatus.CREATED);
    expect(seizeLeg.toWalletId).toBeNull();
    expect(seizeLeg.toIban).toBeNull();
    expect(seizeLeg.toAddress).toBeNull();

    await driveLegTransition(seizeLeg.id, FundsOrderStatus.CONFIRMED, deposit.id);

    expect(await finalStatusOf(deposit.id)).toBe(DepositTransactionStatus.SEIZED);
    actions = await auditActionsFor(deposit.id);
    expect(actions).toContain(AuditActions.DEPOSIT_SEIZED);

    // Single-leg seize evidence — the one leg reverses suspense into CLIENT_ASSET.
    // Its memo carries orderRef (the sole 8-year retention anchor since the
    // destination account is never modeled).
    const evidenceRows = await tbEvidence.findBySource('DEPOSIT', deposit.depositNo);
    const legRow = evidenceRows.find((r: any) => r.eventCode === 'SEIZE_REVERSE_SUSPENSE');
    expect(legRow).toBeTruthy();
    expect(legRow.memo).toContain(orderRef);

    // Final-review fix: prove the single leg (credit CLIENT_ASSET, not FIRM_SEIZED)
    // is self-balancing on its own — DEPOSIT_SUSPENSE and CLIENT_ASSET both shrink
    // by the seized amount, no COA break (see BACKLOG.md / v4-deposit.md §6.3).
    const suspenseAfter = await suspenseTotal();
    const clientAssetAfter = await clientAssetTotal();
    expect(suspenseAfter - suspenseBefore).toBe(-amountBigint);
    expect(clientAssetAfter - clientAssetBefore).toBe(-amountBigint);
  });

  it('3. UNFREEZE full arc: FROZEN → initiateUnfreeze(orderRef) → approve → COMPLIANCE_PENDING + DEPOSIT_UNFROZEN audit, zero new accounting', async () => {
    const amount = '30.00';
    const orderRef = `UNFREEZE-ORDER-${Date.now()}`;
    const deposit = await createDepositAtStatus('UNF1', DepositTransactionStatus.FROZEN, { amount });

    const evidenceBefore = await tbEvidence.findBySource('DEPOSIT', deposit.depositNo);
    expect(evidenceBefore).toHaveLength(0);

    await workflow.initiateUnfreeze(
      deposit.id,
      { reason: 'e2e unfreeze', orderRef },
      makeActor('E2E_UNFREEZE_MAKER_1', 'OPS_OFFICER'),
    );

    const approvalCase = await latestApprovalCase(ApprovalActionTypes.DEPOSIT_UNFREEZE, deposit.id);
    expect(approvalCase).toBeTruthy();
    expect(approvalCase!.status).toBe('PENDING');

    await approvalsService.approve(
      approvalCase!.id,
      { reason: 'e2e approve' },
      makeActor('E2E_MLRO_UNFREEZE_1', 'MLRO'),
    );
    await waitUntil(async () => (await finalStatusOf(deposit.id)) === DepositTransactionStatus.COMPLIANCE_PENDING);

    expect(await finalStatusOf(deposit.id)).toBe(DepositTransactionStatus.COMPLIANCE_PENDING);
    const actions = await auditActionsFor(deposit.id);
    expect(actions).toContain(AuditActions.DEPOSIT_UNFROZEN);
    const unfrozenAudit = await auditRowsFor(deposit.id, AuditActions.DEPOSIT_UNFROZEN);
    expect(unfrozenAudit[0].reason).toContain(orderRef);

    const evidenceAfter = await tbEvidence.findBySource('DEPOSIT', deposit.depositNo);
    expect(evidenceAfter).toHaveLength(0); // 零记账 — no TB postings at all for this arc
  });

  it('4. Approval REJECTED: return approval reject → deposit stays MANUAL_CHECKING, zero accounting, no funds order', async () => {
    const amount = '75.00';
    const amountBigint = decimalToBigint(amount, fiatDecimals);
    const deposit = await createDepositAtStatus('RETREJ1', DepositTransactionStatus.MANUAL_CHECKING, {
      amount,
      fromIban: 'SENDER_IBAN_REJECT_1',
    });

    await preBookSuspense(deposit, amountBigint);
    const before = await suspenseTotal();

    await workflow.applyKytVerdict(deposit.id, { verdict: 'rejected', dispoTag: 'RETURN_TO_SENDER' });
    const approvalCase = await latestApprovalCase(ApprovalActionTypes.DEPOSIT_RETURN, deposit.id);
    expect(approvalCase).toBeTruthy();
    expect(approvalCase!.status).toBe('PENDING');

    await approvalsService.reject(approvalCase!.id, { reason: 'e2e reject' }, makeActor('E2E_MLRO_REJECT_1', 'MLRO'));

    expect(await finalStatusOf(deposit.id)).toBe(DepositTransactionStatus.MANUAL_CHECKING);
    const actions = await auditActionsFor(deposit.id);
    expect(actions).not.toContain(AuditActions.DEPOSIT_RETURN_STARTED);
    expect(actions).not.toContain(AuditActions.DEPOSIT_RETURNED);

    const returnLegs = await fundsOrders.findByParent({ depositTransactionId: deposit.id }, { legSeq: 3 });
    expect(returnLegs).toHaveLength(0);

    const after = await suspenseTotal();
    expect(after).toBe(before); // zero accounting — nothing moved
  });

  it('5. RETURN retry on leg failure: legSeq=3 leg FAILED → void + rebuild attempt 2, deposit stays RETURNING (no terminal jump)', async () => {
    const amount = '60.00';
    const amountBigint = decimalToBigint(amount, fiatDecimals);
    const deposit = await createDepositAtStatus('RETRY1', DepositTransactionStatus.MANUAL_CHECKING, {
      amount,
      fromIban: 'SENDER_IBAN_RETRY_1',
    });

    await preBookSuspense(deposit, amountBigint);

    await workflow.applyKytVerdict(deposit.id, { verdict: 'rejected', dispoTag: 'RETURN_TO_SENDER' });
    const approvalCase = await latestApprovalCase(ApprovalActionTypes.DEPOSIT_RETURN, deposit.id);
    await approvalsService.approve(approvalCase!.id, { reason: 'e2e approve' }, makeActor('E2E_MLRO_RETRY_1', 'MLRO'));
    await waitUntil(async () => (await finalStatusOf(deposit.id)) === DepositTransactionStatus.RETURNING);
    expect(await finalStatusOf(deposit.id)).toBe(DepositTransactionStatus.RETURNING);

    const [attempt1] = await fundsOrders.findByParent({ depositTransactionId: deposit.id }, { legSeq: 3, attempt: 1 });
    expect(attempt1).toBeTruthy();

    await driveLegTransition(attempt1.id, FundsOrderStatus.FAILED, deposit.id);

    // Never jumps to a terminal status — stays RETURNING either way.
    expect(await finalStatusOf(deposit.id)).toBe(DepositTransactionStatus.RETURNING);
    const actions = await auditActionsFor(deposit.id);
    expect(actions).toContain(AuditActions.DEPOSIT_RETURN_RETRIED);
    expect(actions).not.toContain(AuditActions.DEPOSIT_RETURN_STUCK);

    const [attempt2] = await fundsOrders.findByParent({ depositTransactionId: deposit.id }, { legSeq: 3, attempt: 2 });
    expect(attempt2).toBeTruthy();
    expect(attempt2.status).toBe(FundsOrderStatus.CREATED);

    const attempt1Reloaded = await fundsOrders.findById(attempt1.id);
    expect(attempt1Reloaded!.status).toBe(FundsOrderStatus.FAILED); // unchanged, left as history
  });
});
