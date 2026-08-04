import * as path from 'path';
import * as dotenv from 'dotenv';

// Same Node 18 polyfill as src/main.ts (@nestjs/schedule needs globalThis.crypto,
// stable only in Node 19+) — main.ts isn't loaded in this e2e harness, so it has
// to be repeated here before AppModule (and therefore ScheduleModule) is imported.
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

// Loaded before any other import so PrismaService / TigerBeetleService see the
// worktree's own DATABASE_URL / TB_ADDRESS regardless of ConfigModule's internal
// load timing (belt-and-braces — mirrors withdraw-money-arcs.e2e-spec.ts).
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
import { FundsOrderService } from '../src/modules/funds-orders/funds-order.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';
import { SUMSUB_TXN_CLIENT } from '../src/modules/deposit-sumsub/sumsub-txn-client.interface';
import { MockSumsubTxnClient } from '../src/modules/deposit-sumsub/sumsub-txn-client.mock';
import { WithdrawDemoScenarioService } from '../src/modules/withdraw-sumsub/demo-scenario.service';
import { AuditActions, AuditEntityTypes } from '../src/modules/audit-logging/constants/audit-actions.constant';

/**
 * Task 12: withdraw Sumsub verdict-button e2e — mirrors
 * test/deposit-sumsub-verdicts.e2e-spec.ts's structure (real AppModule, only
 * SUMSUB_TXN_CLIENT mocked), but drives the withdraw domain's 9 single-step
 * verdict buttons (`src/modules/withdraw-sumsub/fixtures/verdict-buttons.ts`)
 * through the REAL production entry point `WithdrawDemoScenarioService.runVerdict()`
 * — the exact method the admin Simulation panel's buttons call — which itself
 * primes the mock Sumsub client and drives the real
 * ingest→router→handler→workflow chain end to end.
 *
 * Non-destructive by design (unlike deposit-sumsub-verdicts, which wipes the
 * whole deposit_transactions table and needs a dedicated throwaway DB): this
 * suite never truncates any table. It uses `demo_grace@example.com` (not
 * demo_alice/demo_bob/demo_frank, owned by the other e2e suites) with a fixed
 * registered destination address per asset, so parallel jest workers running
 * other spec files never race this suite's fixtures. Runs against the
 * worktree's regular self-stack DB (same `.env` as withdraw-money-arcs).
 */
describe('Withdraw Sumsub verdict buttons (e2e, Task 12)', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let prisma: PrismaService;
  let workflow: WithdrawWorkflowService;
  let withdrawService: WithdrawTransactionsService;
  let withdrawQuoteService: WithdrawQuoteService;
  let fundsOrders: FundsOrderService;
  let accounting: AccountingService;
  let demoService: WithdrawDemoScenarioService;
  let mockSumsubTxnClient: MockSumsubTxnClient;

  let customerId: string;
  let customerNo: string;

  let fiatAssetId: string;
  let fiatCode: string;
  let registeredIban: string;

  const HARNESS_ACTOR = { actorId: 'E2E_HARNESS', actorRole: 'OPS_OFFICER' };

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
    demoService = app.get(WithdrawDemoScenarioService);
    mockSumsubTxnClient = app.get(SUMSUB_TXN_CLIENT) as unknown as MockSumsubTxnClient;

    const customer = await prisma.customerMain.findUnique({
      where: { email: 'demo_grace@example.com' },
    });
    if (!customer) {
      throw new Error(
        "Fixture customer demo_grace@example.com not found — this worktree's self-stack DB " +
          'needs business seed data first: `DATABASE_URL=... TB_ADDRESS=... npm run db:biz:init`.',
      );
    }
    customerId = customer.id;
    customerNo = customer.customerNo;

    // submitSumsubTxn (birth-time Gate 0 equivalent) needs an applicantId on file
    // to actually stamp a real sumsubTxnId — without it, WithdrawDemoScenarioService's
    // verdict delivery would mint a txnId no withdraw row actually carries, and the
    // handler would treat every delivery as an orphan webhook (see that service's
    // header comment).
    await prisma.customerMain.update({
      where: { id: customerId },
      data: { sumsubApplicantId: 'e2e0withdrawscenariosgrace1' },
    });

    const fiatAsset = await prisma.asset.findFirst({ where: { currency: 'AED' } });
    if (!fiatAsset || !fiatAsset.tbLedgerId) {
      throw new Error('Fixture asset AED not seeded (or missing tbLedgerId) — run `npm run db:biz:init` first.');
    }
    fiatAssetId = fiatAsset.id;
    fiatCode = fiatAsset.code;

    await ensureCustomerWallet({ assetId: fiatAssetId, walletRole: 'C_VIBAN', type: 'FIAT_BANK', iban: `AE_WD_SCN_${customerNo}` });

    registeredIban = 'AE070331234567890198765';
    await ensureWithdrawalAddress({
      assetId: fiatAssetId, addressType: 'BANK', network: 'FIAT',
      address: registeredIban, iban: registeredIban,
    });

    await fundCustomer(fiatAssetId, 'AED', '1000000');
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
        addressNo: `WAD-E2E-SCN-${opts.addressType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        customerId, customerNo, assetId: opts.assetId, network: opts.network,
        address: opts.address, addressType: opts.addressType, iban: opts.iban ?? null,
        ownershipDeclaredAt: new Date(), ownershipProofType: 'E2E_FIXTURE',
        status: 'ACTIVE', activatesAt: new Date(Date.now() - 1000),
        traceId: `e2e-withdraw-sumsub-scenarios-address-${opts.addressType}`,
      },
    });
  }

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
        sourceNo: `E2E-WITHDRAW-SCN-FUND-${currency}`,
        eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
        creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE],
        assetCurrency: currency,
        traceId: `e2e-withdraw-scn-fund-${currency}`,
        actorType: 'SYSTEM',
        actorId: 'E2E_HARNESS',
        memo: 'e2e fixture: pre-fund customer balance for withdraw sumsub-scenario tests',
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
   *  real quote, then polls for the fire-and-forget birth-time submitSumsubTxn
   *  to stamp a real sumsubTxnId before the caller delivers any verdict. */
  async function createWithdrawal(opts: { assetId: string; assetCode: string; amount: string; toIban: string }) {
    const quote = await createQuote(opts.assetId, opts.assetCode, opts.amount);
    const dto: any = { assetId: opts.assetId, amount: Number(opts.amount), toIban: opts.toIban, quoteId: quote.id };
    const w = await workflow.createWithdrawal(dto, customerId, 'CUSTOMER');
    await waitUntil(async () => {
      const row = await withdrawService.findOneInternal(w.id);
      return !!row.sumsubTxnId;
    });
    return w;
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
   * Delivers one verdict button through the REAL production entry point
   * (WithdrawDemoScenarioService.runVerdict) — same code the admin simulation
   * button calls.
   */
  async function deliver(withdrawId: string, buttonKey: string) {
    return demoService.runVerdict(withdrawId, buttonKey, HARNESS_ACTOR);
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

  // ── matrix (9 single-step verdict buttons) ──────────────────────────────

  it('① approved: COMPLIANCE_PENDING → PAYOUT_PENDING, payout + fee legs created', async () => {
    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount: '200', toIban: registeredIban });

    await deliver(w.id, 'V1_APPROVED');

    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.PAYOUT_PENDING);
    const actions = await auditActionsFor(w.id);
    expect(actions).toContain(AuditActions.WITHDRAW_SUMSUB_SUBMITTED);
    expect(actions).toContain(AuditActions.WITHDRAW_COMPLIANCE_PASSED);
    expect(actions).toContain(AuditActions.WITHDRAW_PAYOUT_INITIATED);

    const legs = await fundsOrders.findByParent({ withdrawTransactionId: w.id }, {});
    expect(legs.map((l: any) => l.legSeq).sort()).toEqual([1, 2]);
  });

  it('② awaiting user: ACTION_PENDING, manualReason=CLIENT_ACTION', async () => {
    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount: '150', toIban: registeredIban });

    await deliver(w.id, 'V2_AWAIT_USER');

    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.ACTION_PENDING);
    const refreshed = await withdrawService.findOne(w.id);
    expect((refreshed as any).manualReason).toBe('CLIENT_ACTION');
    const detail = await withdrawService.findOneForAdmin(w.id);
    expect((detail as any).sumsubDetail.applicantActionIds.length).toBeGreaterThan(0);
  });

  it('③ awaiting user · PEP: ACTION_PENDING, manualReason=EDD_PEP, 报文含 PEP tag', async () => {
    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount: '150', toIban: registeredIban });

    await deliver(w.id, 'V3_AWAIT_USER_PEP');

    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.ACTION_PENDING);
    const refreshed = await withdrawService.findOne(w.id);
    expect((refreshed as any).manualReason).toBe('EDD_PEP');
    const detail = await withdrawService.findOneForAdmin(w.id);
    expect((detail as any).sumsubDetail.tags).toContain('PEP');
  });

  it('④ rejected · sanctions: FROZEN, 零记账', async () => {
    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount: '250', toIban: registeredIban });

    await deliver(w.id, 'V4_REJECTED_SANCTION');

    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.FROZEN);
    const actions = await auditActionsFor(w.id);
    expect(actions).toContain(AuditActions.WITHDRAW_FROZEN);
    expect(actions).not.toContain(AuditActions.WITHDRAW_PAYOUT_INITIATED);
    const legs = await fundsOrders.findByParent({ withdrawTransactionId: w.id }, {});
    expect(legs).toHaveLength(0);
  });

  it('⑤ rejected · MLRO freeze: FROZEN', async () => {
    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount: '300', toIban: registeredIban });

    await deliver(w.id, 'V5_REJECTED_FROZEN_MLRO');

    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.FROZEN);
    const actions = await auditActionsFor(w.id);
    expect(actions).toContain(AuditActions.WITHDRAW_FROZEN);
  });

  it('⑦ then ⑥ rejected · refund tag: MANUAL_CHECKING → REJECTED + locks released (refund tag only executes from MANUAL_CHECKING)', async () => {
    const amount = '350';
    const before = await accounting.getCustomerAvailableBalance(customerId, 'AED');

    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount, toIban: registeredIban });

    await deliver(w.id, 'V7_REJECTED_NO_TAG');
    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.MANUAL_CHECKING);

    await deliver(w.id, 'V6_REJECTED_REFUND_TAG');
    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.REJECTED);

    const actions = await auditActionsFor(w.id);
    expect(actions).toContain(AuditActions.WITHDRAW_REFUNDED_BY_TAG);
    expect(actions).toContain(AuditActions.WITHDRAW_LOCK_RELEASED);

    const after = await accounting.getCustomerAvailableBalance(customerId, 'AED');
    expect(after.available).toBe(before.available); // fully restored
  });

  it('⑦ rejected · no disposition tag: MANUAL_CHECKING', async () => {
    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount: '220', toIban: registeredIban });

    await deliver(w.id, 'V7_REJECTED_NO_TAG');

    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.MANUAL_CHECKING);
    const actions = await auditActionsFor(w.id);
    expect(actions).not.toContain(AuditActions.WITHDRAW_FROZEN);
  });

  it('⑧ on hold: 状态不变 (COMPLIANCE_PENDING) + slaDeadline set', async () => {
    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount: '90', toIban: registeredIban });

    await deliver(w.id, 'V8_ONHOLD');

    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.COMPLIANCE_PENDING);
    const refreshed = await withdrawService.findOne(w.id);
    expect((refreshed as any).slaDeadline).toBeTruthy();
    const actions = await auditActionsFor(w.id);
    expect(actions).toContain(AuditActions.WITHDRAW_ONHOLD);
  });

  it('⑧ then ⑨ SLA breach: MANUAL_CHECKING + 报文含 SLA_BREACH tag', async () => {
    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount: '95', toIban: registeredIban });

    await deliver(w.id, 'V8_ONHOLD');
    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.COMPLIANCE_PENDING);

    await deliver(w.id, 'V9_REJECTED_SLA');

    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.MANUAL_CHECKING);
    const detail = await withdrawService.findOneForAdmin(w.id);
    expect((detail as any).sumsubDetail.tags).toContain('SLA_BREACH');
  });
});
