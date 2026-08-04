import * as path from 'path';
import * as dotenv from 'dotenv';

// Same Node 18 polyfill as src/main.ts (@nestjs/schedule needs globalThis.crypto,
// stable only in Node 19+) — main.ts isn't loaded in this e2e harness, so it has
// to be repeated here before AppModule (and therefore ScheduleModule) is imported.
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

// Loaded before any other import so PrismaService / TigerBeetleService see the
// worktree's own DATABASE_URL / TB_ADDRESS regardless of ConfigModule's internal
// load timing (belt-and-braces — mirrors deposit-money-arcs.e2e-spec.ts, Task 12's
// template for this file).
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { WithdrawWorkflowService } from '../src/modules/trading/withdraw-transactions/withdraw-workflow.service';
import { WithdrawTransactionsService } from '../src/modules/trading/withdraw-transactions/withdraw-transactions.service';
import { WithdrawTransactionStatus } from '../src/modules/trading/withdraw-transactions/dto/withdraw-transaction.dto';
import { WithdrawQuoteService } from '../src/modules/trading/withdrawal-fee-level/withdraw-quote.service';
import { WithdrawalAddressService } from '../src/modules/asset-treasury/withdrawal-addresses/withdrawal-address.service';
import { FundsOrderService } from '../src/modules/funds-orders/funds-order.service';
import { FundsOrderStatus } from '../src/modules/funds-orders/dto/funds-order.dto';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TbEvidenceService } from '../src/modules/accounting/tigerbeetle/tb-evidence.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';
import { hexToBigint } from '../src/modules/accounting/tigerbeetle/utils/tb-id.util';
import { ApprovalsService } from '../src/modules/governance/approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext } from '../src/modules/governance/approvals/constants/approval.constants';
import { SUMSUB_TXN_CLIENT } from '../src/modules/deposit-sumsub/sumsub-txn-client.interface';
import { MockSumsubTxnClient } from '../src/modules/deposit-sumsub/sumsub-txn-client.mock';
import { AuditActions, AuditEntityTypes } from '../src/modules/audit-logging/constants/audit-actions.constant';
import { fakeBankRef, fakeChainTxHash } from '../src/common/utils/fake-external-refs.util';

/**
 * Task 12: withdraw money-arcs e2e — proves the 10-state/20-edge withdraw state
 * machine's money-moving arcs (payout success, principal failure, fee-leg STUCK
 * ladder + repair, FROZEN unfreeze/refund, bounce) actually work end to end
 * against a real AppModule + real ApprovalsService + real TigerBeetle. Only
 * SUMSUB_TXN_CLIENT is mocked. Mirrors test/deposit-money-arcs.e2e-spec.ts
 * exactly (harness shape, driveLegTransition, waitUntil rationale).
 *
 * Harness notes:
 * - Uses `demo_frank@example.com` — NOT demo_alice/demo_bob (owned by the
 *   deposit e2e suites) — so this file's fixtures never race those suites'
 *   customer-scoped TB accounts. jest's e2e config has no maxWorkers pin, so
 *   multiple spec files may run in parallel workers against the same worktree
 *   DB/TigerBeetle cluster.
 * - Unlike deposit (whose money-arcs fixtures start mid-flow, money already in
 *   DEPOSIT_SUSPENSE from an earlier Step 1), a withdrawal's TB pending lock is
 *   created AT REQUEST TIME (createWithdrawal's own $transaction) — so the most
 *   faithful, least-synthetic fixture is to call the REAL production entry point
 *   `WithdrawWorkflowService.createWithdrawal()` (via a real quote) for every
 *   scenario's birth, then drive forward with `applyKytVerdict` / `initiateUnfreeze`
 *   / `initiateRefund` / `onBounce` — all real production entry points, exactly
 *   like deposit-money-arcs calls `applyKytVerdict`/`initiateSeize`/`initiateUnfreeze`
 *   directly rather than reimplementing money movement by hand.
 * - `funds_order.status.changed` is fire-and-forget `emit()` (not `emitAsync()`)
 *   inside FundsOrderService.create()/advance() — same race the deposit suite's
 *   header comment documents. `driveLegTransition()` below bypasses it exactly
 *   like deposit's: mutates the funds_order row directly (mirroring advance()'s
 *   own write, including CONFIRMED externalRef stamping) then calls
 *   `workflow.handleFundsOrderChanged()` directly, fully awaited — no real event
 *   emitted for THIS leg's own transition, so there is no double-invocation race
 *   for it. However the WORKFLOW'S OWN internal reaction (e.g. onPayoutLegConfirmed
 *   calling `fundsOrders.advance(..., CLEAR)`) is real production code that DOES
 *   emit a real cascading event (the leg's CLEARED transition) — that cascade
 *   (onLegCleared's SUCCESS flip) is genuinely fire-and-forget, so scenarios that
 *   depend on it poll with `waitUntil()` rather than asserting synchronously.
 * - The approval decided-cascade (ApprovalsService.approve/reject → …) is the
 *   same eventually-consistent chain deposit-money-arcs documents — `waitUntil()`
 *   polls after every approve()/reject() call.
 */
describe('Withdraw money arcs (e2e, Task 12)', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let prisma: PrismaService;
  let workflow: WithdrawWorkflowService;
  let withdrawService: WithdrawTransactionsService;
  let withdrawQuoteService: WithdrawQuoteService;
  let fundsOrders: FundsOrderService;
  let accounting: AccountingService;
  let tbEvidence: TbEvidenceService;
  let approvalsService: ApprovalsService;
  let mockSumsubTxnClient: MockSumsubTxnClient;

  let customerId: string;
  let customerNo: string;

  let fiatAssetId: string;
  let fiatDecimals: number;
  let fiatCode: string;
  let registeredIban: string;

  let cryptoAssetId: string;
  let cryptoDecimals: number;
  let cryptoCode: string;
  let registeredCryptoAddress: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SUMSUB_TXN_CLIENT)
      .useClass(MockSumsubTxnClient)
      .compile();

    app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();

    prisma = app.get(PrismaService);
    workflow = app.get(WithdrawWorkflowService);
    withdrawService = app.get(WithdrawTransactionsService);
    withdrawQuoteService = app.get(WithdrawQuoteService);
    fundsOrders = app.get(FundsOrderService);
    accounting = app.get(AccountingService);
    tbEvidence = app.get(TbEvidenceService);
    approvalsService = app.get(ApprovalsService);
    mockSumsubTxnClient = app.get(SUMSUB_TXN_CLIENT) as unknown as MockSumsubTxnClient;

    const customer = await prisma.customerMain.findUnique({
      where: { email: 'demo_frank@example.com' },
    });
    if (!customer) {
      throw new Error(
        "Fixture customer demo_frank@example.com not found — this worktree's self-stack DB " +
          'needs business seed data first: `DATABASE_URL=... TB_ADDRESS=... npm run db:biz:init`.',
      );
    }
    customerId = customer.id;
    customerNo = customer.customerNo;

    // Task 8's unfreeze rescore (scenario 4) needs a sumsubApplicantId on file so
    // birth-time submitSumsubTxn actually stamps a real sumsubTxnId (mirrors
    // deposit-sumsub-verdicts's fixture customer patch).
    await prisma.customerMain.update({
      where: { id: customerId },
      data: { sumsubApplicantId: 'e2e0withdrawarcsfrank01' },
    });

    const fiatAsset = await prisma.asset.findFirst({ where: { currency: 'AED' } });
    const cryptoAsset = await prisma.asset.findFirst({ where: { currency: 'USDT' } });
    if (!fiatAsset || !fiatAsset.tbLedgerId || !cryptoAsset || !cryptoAsset.tbLedgerId) {
      throw new Error('Fixture assets AED/USDT not seeded (or missing tbLedgerId) — run `npm run db:biz:init` first.');
    }
    fiatAssetId = fiatAsset.id;
    fiatDecimals = fiatAsset.decimals;
    fiatCode = fiatAsset.code;
    cryptoAssetId = cryptoAsset.id;
    cryptoDecimals = cryptoAsset.decimals;
    cryptoCode = cryptoAsset.code;

    // Customer source wallets (R4: ensureSourceWalletBound requires C_VIBAN/C_DEP,
    // CUSTOMER-owned, ACTIVE) — find-or-create so repeated suite runs are idempotent.
    await ensureCustomerWallet({ assetId: fiatAssetId, walletRole: 'C_VIBAN', type: 'FIAT_BANK', iban: `AE_WD_ARCS_${customerNo}` });
    await ensureCustomerWallet({ assetId: cryptoAssetId, walletRole: 'C_DEP', type: 'CRYPTO_ADDRESS', address: `T_WD_ARCS_${customerNo}` });

    // Registered withdrawal destinations (Task 3 hard guard: createWithdrawal
    // requires an ACTIVE registered address). Direct prisma insert (status ACTIVE,
    // activatesAt in the past) — bypasses the 24h cooling period / bank-account
    // auto-activation-once-only quirk so repeated suite runs stay deterministic.
    registeredIban = 'AE070331234567890123456';
    await ensureWithdrawalAddress({
      assetId: fiatAssetId, addressType: 'BANK', network: 'FIAT',
      address: registeredIban, iban: registeredIban,
    });
    registeredCryptoAddress = `TWDARCS${customerNo}FIXEDADDR`;
    await ensureWithdrawalAddress({
      assetId: cryptoAssetId, addressType: 'SELF_CUSTODY', network: cryptoAsset.network || 'TRON',
      address: registeredCryptoAddress,
    });

    // Pre-fund the customer's CLIENT_PAYABLE balance (real TB transfer, DEPOSIT_SUSPENSE
    // → CLIENT_PAYABLE — same leg a real deposit's Step 2 posts). Deterministic
    // sourceNo → idempotent across repeated suite runs (TB transfer id collision
    // is treated as success, not double-funded).
    await fundCustomer(fiatAssetId, 'AED', '1000000');
    await fundCustomer(cryptoAssetId, 'USDT', '1000000');
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  function decimalToBigint(decimalValue: string, decimals: number): bigint {
    const [whole, frac = ''] = decimalValue.split('.');
    const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + paddedFrac);
  }

  function makeActor(userId: string, role: string): ApprovalActorContext {
    return { actorType: 'ADMIN', userId, userNo: userId, role, roleCodes: [role] };
  }

  async function ensureCustomerWallet(opts: {
    assetId: string; walletRole: 'C_VIBAN' | 'C_DEP'; type: string; iban?: string; address?: string;
  }): Promise<string> {
    const existing = await (prisma as any).wallet.findFirst({
      where: { ownerType: 'CUSTOMER', ownerId: customerId, assetId: opts.assetId, walletRole: opts.walletRole, status: 'ACTIVE' },
    });
    if (existing) return existing.id;
    const created = await (prisma as any).wallet.create({
      data: {
        ownerType: 'CUSTOMER', ownerId: customerId, ownerNo: customerNo,
        type: opts.type, walletRole: opts.walletRole, assetId: opts.assetId,
        address: opts.address ?? null, iban: opts.iban ?? null, status: 'ACTIVE',
      },
    });
    return created.id;
  }

  async function ensureWithdrawalAddress(opts: {
    assetId: string; addressType: string; network: string; address: string; iban?: string;
  }): Promise<void> {
    const existing = await (prisma as any).withdrawalAddress.findFirst({
      where: { customerId, assetId: opts.assetId, address: opts.address, status: 'ACTIVE' },
    });
    if (existing) return;
    await (prisma as any).withdrawalAddress.create({
      data: {
        addressNo: `WAD-E2E-ARCS-${opts.addressType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        customerId, customerNo, assetId: opts.assetId, network: opts.network,
        address: opts.address, addressType: opts.addressType, iban: opts.iban ?? null,
        ownershipDeclaredAt: new Date(), ownershipProofType: 'E2E_FIXTURE',
        status: 'ACTIVE', activatesAt: new Date(Date.now() - 1000),
        traceId: `e2e-withdraw-money-arcs-address-${opts.addressType}`,
      },
    });
  }

  /** Real TB transfer (DEPOSIT_SUSPENSE → CLIENT_PAYABLE) — same leg a real
   *  deposit's Step 2 posts. Deterministic sourceNo (fixed per currency) makes
   *  this idempotent across repeated suite runs. */
  async function fundCustomer(assetId: string, currency: string, amount: string): Promise<void> {
    const asset = await (prisma as any).asset.findUnique({ where: { id: assetId } });
    const ledger = TB_LEDGERS[currency as keyof typeof TB_LEDGERS];
    const amountBigint = decimalToBigint(amount, asset.decimals);
    const suspenseId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger, ownerType: 'CUSTOMER', ownerUuid: customerId });
    const payableId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger, ownerType: 'CUSTOMER', ownerUuid: customerId });
    await accounting.executeTransfer({
      debitAccountId: suspenseId,
      creditAccountId: payableId,
      amount: amountBigint,
      ledger,
      code: TB_TRANSFER_CODES.DEPOSIT_SUSPENSE_TO_PAYABLE,
      evidence: {
        sourceType: 'DEPOSIT',
        sourceNo: `E2E-WITHDRAW-ARCS-FUND-${currency}`,
        eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
        creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE],
        assetCurrency: currency,
        traceId: `e2e-withdraw-arcs-fund-${currency}`,
        actorType: 'SYSTEM',
        actorId: 'E2E_HARNESS',
        memo: 'e2e fixture: pre-fund customer balance for withdraw money-arc tests',
        isExternalCrossing: false,
      },
    });
  }

  async function createQuote(assetId: string, assetCode: string, amount: string) {
    return withdrawQuoteService.createQuote({
      ownerType: 'CUSTOMER', ownerId: customerId, ownerNo: customerNo,
      assetId, assetCode, amount: new Prisma.Decimal(amount), customerId,
    });
  }

  /** Real production birth: WithdrawWorkflowService.createWithdrawal() via a
   *  real quote — every scenario's fixture starts here, on COMPLIANCE_PENDING. */
  async function createWithdrawal(opts: {
    assetId: string; assetCode: string; amount: string; toAddress?: string; toIban?: string;
  }) {
    const quote = await createQuote(opts.assetId, opts.assetCode, opts.amount);
    const dto: any = {
      assetId: opts.assetId,
      amount: Number(opts.amount),
      toAddress: opts.toAddress,
      toIban: opts.toIban,
      quoteId: quote.id,
    };
    return workflow.createWithdrawal(dto, customerId, 'CUSTOMER');
  }

  async function statusOf(id: string): Promise<string | undefined> {
    const row = await withdrawService.findOneInternal(id);
    return row?.status;
  }

  async function auditActionsFor(id: string): Promise<string[]> {
    const rows = await (prisma as any).auditLogEvent.findMany({
      where: { entityId: id, entityType: AuditEntityTypes.WITHDRAW_TRANSACTION },
      select: { action: true },
    });
    return rows.map((r: any) => r.action);
  }

  async function auditRowsFor(id: string, action: string): Promise<any[]> {
    return (prisma as any).auditLogEvent.findMany({
      where: { entityId: id, entityType: AuditEntityTypes.WITHDRAW_TRANSACTION, action },
    });
  }

  async function availableBalance(currency: string) {
    return accounting.getCustomerAvailableBalance(customerId, currency);
  }

  async function latestApprovalCase(actionType: string, entityRef: string) {
    return (prisma as any).approvalCase.findFirst({
      where: { actionType, entityRef },
      orderBy: { createdAt: 'desc' },
      include: { steps: true },
    });
  }

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

  /**
   * Drives a legSeq 1/2 funds order to a terminal-relevant status (CONFIRMED/
   * FAILED) WITHOUT going through FundsOrderService's real fire-and-forget
   * `emit()` — mutates the row directly (mirroring advance()'s own write,
   * including CONFIRMED externalRef stamping) then calls the real routing entry
   * point directly, fully awaited exactly once. Mirrors deposit-money-arcs's
   * driveLegTransition exactly (see file header for the fire-and-forget rationale).
   */
  async function driveLegTransition(fundsOrderId: string, toStatus: FundsOrderStatus, withdrawId: string): Promise<void> {
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
    await (prisma as any).fundsOrder.update({ where: { id: fundsOrderId }, data: patch });

    await workflow.handleFundsOrderChanged({
      fundsOrderId,
      fundsOrderNo: row.fundsOrderNo,
      parent: { withdrawTransactionId: withdrawId },
      legSeq: row.legSeq,
      attempt: row.attempt,
      oldStatus,
      newStatus: toStatus,
    });
  }

  /**
   * e2e-only fixture for scenario 6b (bounce, fee already POSTed): reproduces
   * exactly the two accounting calls WithdrawWorkflowService#onFeeLegConfirmed
   * makes for the client-side fee leg (postPendingTransfer + enrichForPost with
   * eventCode WITHDRAW_FEE_POST) WITHOUT the firm-fee collect or the advance()-
   * to-CLEAR call that would otherwise cascade the withdrawal straight to SUCCESS
   * before the bounce guard (status===PAYOUT_PENDING) can be exercised. Marks the
   * fee funds_order CONFIRMED via direct prisma write (no event emitted).
   */
  async function manuallyPostFeeLeg(w: any, feeLeg: any): Promise<void> {
    const feeBigint = decimalToBigint(String(w.feeAmount), w.asset.decimals);
    const walletRef = w.fromWalletId ?? null;
    await accounting.postPendingTransfer({
      pendingTransferId: hexToBigint(w.tbPendingFeeId),
      amount: feeBigint,
      evidence: {
        sourceType: 'WITHDRAWAL',
        sourceNo: w.withdrawNo,
        eventCode: 'WITHDRAW_FEE_POST',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE],
        creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
        assetCurrency: w.asset.currency,
        traceId: w.traceId || w.id,
        actorType: 'SYSTEM',
        actorId: 'E2E_HARNESS',
      },
    });
    await tbEvidence.enrichForPost(w.tbPendingFeeId, {
      eventCode: 'WITHDRAW_FEE_POST',
      memo: 'e2e fixture: manual fee post to exercise bounce fee-retained branch',
      debitWalletRef: walletRef,
      creditWalletRef: walletRef,
      externalRef: null,
      isExternalCrossing: true,
    });
    await (prisma as any).fundsOrder.update({ where: { id: feeLeg.id }, data: { status: FundsOrderStatus.CONFIRMED } });
  }

  // ── scenarios ────────────────────────────────────────────────────────────

  it('1. happy crypto: approved → PAYOUT_PENDING → both legs post → SUCCESS (fee leg CLEARED, settlement invariant holds)', async () => {
    const amount = '500';
    const w = await createWithdrawal({ assetId: cryptoAssetId, assetCode: cryptoCode, amount, toAddress: registeredCryptoAddress });
    expect(w.status).toBe(WithdrawTransactionStatus.COMPLIANCE_PENDING);

    await workflow.applyKytVerdict(w.id, { verdict: 'approved' });
    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.PAYOUT_PENDING);

    const [payoutLeg] = await fundsOrders.findByParent({ withdrawTransactionId: w.id }, { legSeq: 1 });
    const [feeLeg] = await fundsOrders.findByParent({ withdrawTransactionId: w.id }, { legSeq: 2 });
    expect(payoutLeg.status).toBe(FundsOrderStatus.CREATED);
    expect(feeLeg.status).toBe(FundsOrderStatus.CREATED);

    await driveLegTransition(payoutLeg.id, FundsOrderStatus.CONFIRMED, w.id);
    await driveLegTransition(feeLeg.id, FundsOrderStatus.CONFIRMED, w.id);

    await waitUntil(async () => (await statusOf(w.id)) === WithdrawTransactionStatus.SUCCESS);

    const feeLegReloaded = await fundsOrders.findById(feeLeg.id);
    const payoutLegReloaded = await fundsOrders.findById(payoutLeg.id);
    expect(feeLegReloaded!.status).toBe(FundsOrderStatus.CLEARED);
    expect(payoutLegReloaded!.status).toBe(FundsOrderStatus.CLEARED);

    const evidence = await tbEvidence.findBySource('WITHDRAWAL', w.withdrawNo);
    const codes = evidence.map((e: any) => e.eventCode);
    expect(codes).toContain('WITHDRAW_NET_POST');
    expect(codes).toContain('WITHDRAW_FEE_POST');
    expect(codes).toContain('WITHDRAW_FEE_FIRM');

    const actions = await auditActionsFor(w.id);
    expect(actions).toContain(AuditActions.WITHDRAW_ACCOUNTING_POSTED);
    expect(actions).toContain(AuditActions.WITHDRAW_SUCCESS);
  });

  it('2. principal leg FAILED → withdraw FAILED + both TB locks voided (available balance restored)', async () => {
    const amount = '300';
    const before = await availableBalance('AED');

    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount, toIban: registeredIban });
    await workflow.applyKytVerdict(w.id, { verdict: 'approved' });
    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.PAYOUT_PENDING);

    const [payoutLeg] = await fundsOrders.findByParent({ withdrawTransactionId: w.id }, { legSeq: 1 });
    await driveLegTransition(payoutLeg.id, FundsOrderStatus.FAILED, w.id);

    // onPayoutLegFailed is a single, direct, fully-awaited call chain (no funds_order
    // CLEAR/cascade involved) — deterministic, no waitUntil needed.
    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.FAILED);

    const actions = await auditActionsFor(w.id);
    expect(actions).toContain(AuditActions.WITHDRAW_PAYOUT_FAILED);
    expect(actions).toContain(AuditActions.WITHDRAW_LOCK_RELEASED);

    const after = await availableBalance('AED');
    expect(after.available).toBe(before.available); // fully restored — net+fee both released
  });

  it('3. fee leg FAILED×3 → STUCK flag + still PAYOUT_PENDING → repair (fresh attempt) → SUCCESS', async () => {
    const amount = '500';
    const w = await createWithdrawal({ assetId: cryptoAssetId, assetCode: cryptoCode, amount, toAddress: registeredCryptoAddress });
    await workflow.applyKytVerdict(w.id, { verdict: 'approved' });
    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.PAYOUT_PENDING);

    const [payoutLeg] = await fundsOrders.findByParent({ withdrawTransactionId: w.id }, { legSeq: 1 });
    await driveLegTransition(payoutLeg.id, FundsOrderStatus.CONFIRMED, w.id);
    const payoutLegReloaded = await fundsOrders.findById(payoutLeg.id);
    expect(payoutLegReloaded!.status).toBe(FundsOrderStatus.CLEARED); // principal posted+cleared, fee still pending

    let currentFeeLeg = (await fundsOrders.findByParent({ withdrawTransactionId: w.id }, { legSeq: 2 }))[0];
    expect(currentFeeLeg.attempt).toBe(1);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await driveLegTransition(currentFeeLeg.id, FundsOrderStatus.FAILED, w.id);
      const actions = await auditActionsFor(w.id);
      if (attempt < 3) {
        expect(actions).toContain(AuditActions.WITHDRAW_FEE_LEG_REBUILT);
        const legs = await fundsOrders.findByParent({ withdrawTransactionId: w.id }, { legSeq: 2 });
        currentFeeLeg = legs[legs.length - 1];
        expect(currentFeeLeg.attempt).toBe(attempt + 1);
        expect(currentFeeLeg.status).toBe(FundsOrderStatus.CREATED);
      } else {
        expect(actions).toContain(AuditActions.WITHDRAW_FEE_SETTLE_STUCK);
      }
    }

    const wStuck = await withdrawService.findOneInternal(w.id);
    expect(wStuck.status).toBe(WithdrawTransactionStatus.PAYOUT_PENDING);
    expect(wStuck.needsReview).toBe(true);
    const stuckFeeLegs = await fundsOrders.findByParent({ withdrawTransactionId: w.id }, { legSeq: 2 });
    expect(stuckFeeLegs).toHaveLength(3); // no 4th attempt auto-created past the ladder

    // Repair: an operator manually rebuilds a fresh fee-leg attempt (same shape
    // onFeeLegFailed's own rebuild would have produced) and drives it to CONFIRMED.
    const lastFailed = stuckFeeLegs[stuckFeeLegs.length - 1];
    const repairedLeg = await fundsOrders.create({
      withdrawTransactionId: w.id,
      legSeq: 2,
      attempt: 4,
      initialStatus: FundsOrderStatus.CREATED,
      assetId: w.assetId,
      amount: String(w.feeAmount),
      netAmount: String(w.feeAmount),
      fromWalletId: lastFailed.fromWalletId,
      fromAddress: lastFailed.fromAddress,
      fromIban: lastFailed.fromIban,
      toWalletId: lastFailed.toWalletId,
      toAddress: lastFailed.toAddress,
      toIban: lastFailed.toIban,
      traceId: w.traceId || undefined,
    });

    await driveLegTransition(repairedLeg.id, FundsOrderStatus.CONFIRMED, w.id);
    await waitUntil(async () => (await statusOf(w.id)) === WithdrawTransactionStatus.SUCCESS);

    const repairedLegReloaded = await fundsOrders.findById(repairedLeg.id);
    expect(repairedLegReloaded!.status).toBe(FundsOrderStatus.CLEARED);

    // Verify needsReview flag was cleared on SUCCESS
    const wSuccess = await withdrawService.findOneInternal(w.id);
    expect(wSuccess.needsReview).toBe(false);
  });

  it('4. sanctions → FROZEN → unfreeze approval (MLRO) → COMPLIANCE_PENDING + rescore invoked → re-approved → SUCCESS', async () => {
    const amount = '400';
    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount, toIban: registeredIban });

    // Birth-time submitSumsubTxn is fire-and-forget off WITHDRAWAL_CREATED — poll
    // for the real sumsubTxnId to land before freezing.
    let sumsubTxnId: string | null = null;
    await waitUntil(async () => {
      const row = await withdrawService.findOneInternal(w.id);
      sumsubTxnId = row.sumsubTxnId;
      return !!sumsubTxnId;
    });

    const rescoreSpy = jest.spyOn(mockSumsubTxnClient, 'rescore');

    await workflow.applyKytVerdict(w.id, { verdict: 'rejected', sceneTag: 'SANCTION' });
    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.FROZEN);
    let actions = await auditActionsFor(w.id);
    expect(actions).toContain(AuditActions.WITHDRAW_FROZEN);

    const orderRef = `UNFREEZE-ORDER-${Date.now()}`;
    await workflow.initiateUnfreeze(w.id, { orderRef, reason: 'e2e unfreeze' }, makeActor('E2E_UNFREEZE_MAKER_WD1', 'OPS_OFFICER'));

    const approvalCase = await latestApprovalCase(ApprovalActionTypes.WITHDRAW_UNFREEZE, w.id);
    expect(approvalCase).toBeTruthy();
    expect(approvalCase!.status).toBe('PENDING');

    await approvalsService.approve(approvalCase!.id, { reason: 'e2e approve' }, makeActor('E2E_MLRO_UNFREEZE_WD1', 'MLRO'));
    await waitUntil(async () => (await statusOf(w.id)) === WithdrawTransactionStatus.COMPLIANCE_PENDING);

    actions = await auditActionsFor(w.id);
    expect(actions).toContain(AuditActions.WITHDRAW_UNFROZEN);
    expect(rescoreSpy).toHaveBeenCalledWith(sumsubTxnId);

    await workflow.applyKytVerdict(w.id, { verdict: 'approved' });
    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.PAYOUT_PENDING);

    const [payoutLeg] = await fundsOrders.findByParent({ withdrawTransactionId: w.id }, { legSeq: 1 });
    const [feeLeg] = await fundsOrders.findByParent({ withdrawTransactionId: w.id }, { legSeq: 2 });
    await driveLegTransition(payoutLeg.id, FundsOrderStatus.CONFIRMED, w.id);
    await driveLegTransition(feeLeg.id, FundsOrderStatus.CONFIRMED, w.id);
    await waitUntil(async () => (await statusOf(w.id)) === WithdrawTransactionStatus.SUCCESS);

    rescoreSpy.mockRestore();
  });

  it('5. sanctions → FROZEN → refund approval (MLRO) → REJECTED + locks released (available balance restored)', async () => {
    const amount = '400';
    const before = await availableBalance('AED');

    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount, toIban: registeredIban });
    await workflow.applyKytVerdict(w.id, { verdict: 'rejected', sceneTag: 'SANCTION' });
    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.FROZEN);

    await workflow.initiateRefund(w.id, { reason: 'e2e sanction refund' }, makeActor('E2E_REFUND_MAKER_WD1', 'OPS_OFFICER'));

    const approvalCase = await latestApprovalCase(ApprovalActionTypes.WITHDRAW_SANCTION_REFUND, w.id);
    expect(approvalCase).toBeTruthy();
    expect(approvalCase!.status).toBe('PENDING');

    await approvalsService.approve(approvalCase!.id, { reason: 'e2e approve' }, makeActor('E2E_MLRO_REFUND_WD1', 'MLRO'));
    await waitUntil(async () => (await statusOf(w.id)) === WithdrawTransactionStatus.REJECTED);

    const actions = await auditActionsFor(w.id);
    expect(actions).toContain(AuditActions.WITHDRAW_SANCTION_REFUNDED);
    expect(actions).toContain(AuditActions.WITHDRAW_LOCK_RELEASED);

    const after = await availableBalance('AED');
    expect(after.available).toBe(before.available); // fully restored — net+fee both released
  });

  it('6a. bounce (fee NOT yet posted): payout POSTed → RETURNED + reverse entry, fee lock voided (fully restored)', async () => {
    const amount = '300';
    const before = await availableBalance('AED');

    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount, toIban: registeredIban });
    await workflow.applyKytVerdict(w.id, { verdict: 'approved' });
    const [payoutLeg] = await fundsOrders.findByParent({ withdrawTransactionId: w.id }, { legSeq: 1 });
    const [feeLeg] = await fundsOrders.findByParent({ withdrawTransactionId: w.id }, { legSeq: 2 });

    await driveLegTransition(payoutLeg.id, FundsOrderStatus.CONFIRMED, w.id);
    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.PAYOUT_PENDING); // fee leg still CREATED — not all legs cleared

    await workflow.onBounce(w.id, 'bank returned: dead IBAN', { actorType: 'ADMIN', actorId: 'E2E_BOUNCE_1', actorRole: 'OPS_OFFICER' });
    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.RETURNED);

    const evidence = await tbEvidence.findBySource('WITHDRAWAL', w.withdrawNo);
    expect(evidence.map((e: any) => e.eventCode)).toContain('WITHDRAW_BOUNCE_REENTRY');

    const bouncedAudit = await auditRowsFor(w.id, AuditActions.WITHDRAW_BOUNCED);
    expect(bouncedAudit).toHaveLength(1);
    expect(bouncedAudit[0].reason).toContain('uncollected fee lock voided');

    const feeLegReloaded = await fundsOrders.findById(feeLeg.id);
    expect(feeLegReloaded!.status).toBe(FundsOrderStatus.FAILED); // best-effort view-consistency FAIL

    const after = await availableBalance('AED');
    expect(after.available).toBe(before.available); // net (reverse entry) + fee (voided lock) both restored
  });

  it('6b. bounce (fee already POSTed/retained): payout POSTed → RETURNED + reverse entry, fee stays with the firm', async () => {
    const amount = '300';
    const before = await availableBalance('AED');

    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount, toIban: registeredIban });
    await workflow.applyKytVerdict(w.id, { verdict: 'approved' });
    const [payoutLeg] = await fundsOrders.findByParent({ withdrawTransactionId: w.id }, { legSeq: 1 });
    const [feeLeg] = await fundsOrders.findByParent({ withdrawTransactionId: w.id }, { legSeq: 2 });

    await driveLegTransition(payoutLeg.id, FundsOrderStatus.CONFIRMED, w.id);
    const wMidFlight = await withdrawService.findOneInternal(w.id);
    await manuallyPostFeeLeg(wMidFlight, feeLeg);
    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.PAYOUT_PENDING); // fee leg CONFIRMED (not CLEARED) — not all legs cleared

    await workflow.onBounce(w.id, 'bank returned: closed account', { actorType: 'ADMIN', actorId: 'E2E_BOUNCE_2', actorRole: 'OPS_OFFICER' });
    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.RETURNED);

    const bouncedAudit = await auditRowsFor(w.id, AuditActions.WITHDRAW_BOUNCED);
    expect(bouncedAudit).toHaveLength(1);
    expect(bouncedAudit[0].reason).toContain('fee retained (collected)');

    const after = await availableBalance('AED');
    const feeBigint = decimalToBigint(String(wMidFlight.feeAmount), fiatDecimals);
    expect(after.available).toBe(before.available - feeBigint); // net restored, fee permanently gone
  });
});
