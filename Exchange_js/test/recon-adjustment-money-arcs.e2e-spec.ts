import * as path from 'path';
import * as dotenv from 'dotenv';

// Same Node 18 polyfill as src/main.ts (@nestjs/schedule needs globalThis.crypto,
// stable only in Node 19+) — main.ts isn't loaded in this e2e harness, so it has
// to be repeated here before AppModule (and therefore ScheduleModule) is imported.
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

// Loaded before any other import so PrismaService / TigerBeetleService see the
// worktree's own DATABASE_URL / TB_ADDRESS regardless of ConfigModule's internal
// load timing (mirrors withdraw-money-arcs.e2e-spec.ts / deposit-money-arcs.e2e-spec.ts).
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AdjustmentService } from '../src/modules/clearing-settle/reconciliation/disposition/adjustment.service';
import { AdjustmentStatus } from '../src/modules/clearing-settle/reconciliation/constants/adjustment-transitions.constant';
import { WalletReconRunService } from '../src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TbEvidenceService } from '../src/modules/accounting/tigerbeetle/tb-evidence.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { ApprovalsService } from '../src/modules/governance/approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext } from '../src/modules/governance/approvals/constants/approval.constants';
import { AuditActions, AuditEntityTypes } from '../src/modules/audit-logging/constants/audit-actions.constant';
import { generateReferenceNo } from '../src/common/utils/no-generator.util';
import { WithdrawTransactionStatus } from '../src/modules/trading/withdraw-transactions/dto/withdraw-transaction.dto';

/**
 * Task 8: recon-adjustment (调账单) e2e — proves the whole 平账一期 chain works
 * end to end against a real AppModule: 开单 → 提交 → 审批中心
 * （RECON_ADJUSTMENT_POST，单步 OPS_OFFICER）→ 真的批准 → AdjustmentApprovalService's
 * real @OnEvent(APPROVED) handler → AdjustmentService.onApproved →
 * AccountingService.executeTransfer (real TigerBeetle transfer) →
 * AccountFlowProjectorService projects into account_flows (real DI, not mocked) →
 * WalletReconRunService.run() (real recon rerun) sees the corrected ledger and
 * auto-heals the case. NOTHING is mocked: no SUMSUB_TXN_CLIENT override is even
 * needed here (the adjustment flow never touches Sumsub), Prisma/Accounting/
 * Approvals/Audit are all the real production singletons, exactly like
 * withdraw-money-arcs.e2e-spec.ts.
 *
 * Fixture strategy (per Task 8 instructions — do NOT run scripts/recon-demo.ts,
 * build the minimal fixture directly):
 *   - Every scenario mints a BRAND NEW `wallets` row (fresh uuid) so this file's
 *     flows can never collide with another spec file's concurrent Jest worker
 *     touching the same physical wallet (jest e2e has no maxWorkers pin — see
 *     withdraw-money-arcs.e2e-spec.ts's header comment for the same rationale).
 *     For the FIRM scenario this matters doubly: the real seeded F_FEE wallet is
 *     a SHARED aggregate that withdraw/swap suites post real fee income to
 *     concurrently, so a dedicated wallet is the only race-free way to reason
 *     about "this wallet's total".
 *   - A customer wallet is "funded" with the exact same two real TB transfers
 *     deposit-workflow.service.ts's own Step 1 (CLIENT_ASSET→DEPOSIT_SUSPENSE,
 *     isExternalCrossing:true) + Step 2 (DEPOSIT_SUSPENSE→CLIENT_PAYABLE,
 *     isExternalCrossing:false) post, walletRef stamped on both legs — this is
 *     the real production evidence shape, not an invented shortcut.
 *   - The "break" is a real `external_balances` row whose closingBalance
 *     deliberately disagrees with the wallet's real internal total (computed via
 *     the funding transfers above) — exactly what an external bank/chain
 *     statement disagreeing with our books looks like. `WalletReconRunService
 *     .run()` is called for real to discover it (not hand-inserted as an
 *     already-OPEN case) — this is what "重跑对账" in the task means, run TWICE:
 *     once to open the case, once after the adjustment posts to auto-heal it.
 *   - `external_balances.currency` (and therefore `reconciliation_cases
 *     .assetCode` / `reconciliation_adjustments.assetCode`) must hold
 *     `asset.code` ('USDT-TRON'), NOT `asset.currency` ('USDT') —
 *     WalletReconRunService.resolveAssetId() looks up `asset.findFirst({where:
 *     {code: currency}})`, and scripts/recon-demo.ts's own WalletPlan.currency
 *     confirms this convention (`w.asset?.code ?? w.asset?.currency`). AED's
 *     code and currency happen to be identical, which is exactly why this file
 *     sticks to AED for the 6 required scenarios — see the report for a crypto
 *     ("USDT-TRON") side-investigation kept OUT of this file.
 *   - cutoff dates are pinned to "a few days in the future" relative to wall-clock
 *     `now`, and every write in this file leaves `effectiveDate` at its default
 *     (today's business date, `effectiveCutoffFilter`'s own convention). Since
 *     `effectiveDate < businessDate(cutoff)` is unconditionally true under that
 *     scheme, flow-inclusion never depends on the precise millisecond ordering
 *     of `createdAt` vs `cutoff` — no waitUntil-style timing race for the recon
 *     runs themselves (the approval-decided cascade still needs waitUntil, same
 *     as every other e2e suite in this repo — see below).
 *   - The `ApprovalEvents.APPROVED` → `AdjustmentApprovalService.handleApproved`
 *     → `AdjustmentService.onApproved` chain is the same fire-and-forget
 *     eventually-consistent cascade withdraw-money-arcs.e2e-spec.ts documents
 *     (PRODUCTION-NOTES 2026-08-28: handler exceptions here are not surfaced to
 *     the approve() caller) — every assertion that depends on it polls with
 *     `waitUntil()` rather than asserting synchronously right after `.approve()`.
 */
describe('Recon adjustment money arcs (e2e, Task 8)', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let prisma: PrismaService;
  let adjustments: AdjustmentService;
  let walletRecon: WalletReconRunService;
  let accounting: AccountingService;
  let tbEvidence: TbEvidenceService;
  let approvalsService: ApprovalsService;

  let aedAssetId: string;
  let aedCode: string; // 'AED' — equals asset.currency for fiat, unlike crypto

  let carolId: string;
  let carolNo: string;
  let daveId: string;
  let daveNo: string;

  // Cutoff pinned a few days ahead of wall-clock `now` so every fixture write
  // in this file (effectiveDate defaults to today) is unconditionally included
  // via effectiveCutoffFilter's `effectiveDate < businessDate(cutoff)` branch —
  // no dependency on exact test-execution timing.
  let CUTOFF: Date;
  let TODAY: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();

    prisma = app.get(PrismaService);
    adjustments = app.get(AdjustmentService);
    walletRecon = app.get(WalletReconRunService);
    accounting = app.get(AccountingService);
    tbEvidence = app.get(TbEvidenceService);
    approvalsService = app.get(ApprovalsService);

    CUTOFF = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    TODAY = new Date().toISOString().slice(0, 10);

    const aed = await (prisma as any).asset.findFirst({ where: { currency: 'AED' } });
    if (!aed || !aed.tbLedgerId) {
      throw new Error('Fixture asset AED not seeded (or missing tbLedgerId) — run `npm run db:biz:init` first.');
    }
    aedAssetId = aed.id;
    aedCode = aed.code;

    const carol = await (prisma as any).customerMain.findUnique({ where: { email: 'demo_carol@example.com' } });
    const dave = await (prisma as any).customerMain.findUnique({ where: { email: 'demo_dave@example.com' } });
    if (!carol || !dave) {
      throw new Error(
        "Fixture customers demo_carol@example.com / demo_dave@example.com not found — this worktree's " +
          'self-stack DB needs business seed data first: `DATABASE_URL=... TB_ADDRESS=... npm run db:biz:init`.',
      );
    }
    carolId = carol.id;
    carolNo = carol.customerNo;
    daveId = dave.id;
    daveNo = dave.customerNo;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  function makeActor(userId: string, role: string): ApprovalActorContext {
    return { actorType: 'ADMIN', userId, userNo: userId, role, roleCodes: [role] };
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

  /** Fresh customer wallet row (mirrors withdraw-money-arcs.e2e-spec.ts's
   *  ensureCustomerWallet, but always creates — never reused across scenarios
   *  so each scenario's account_flows are provably exclusive to it). */
  async function createCustomerWallet(opts: {
    ownerId: string; ownerNo: string; assetId: string; walletRole: 'C_VIBAN' | 'C_DEP'; type: string; iban?: string; address?: string;
  }): Promise<{ id: string }> {
    return (prisma as any).wallet.create({
      data: {
        walletNo: `WA-E2E-ADJ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ownerType: 'CUSTOMER', ownerId: opts.ownerId, ownerNo: opts.ownerNo,
        type: opts.type, walletRole: opts.walletRole, assetId: opts.assetId,
        address: opts.address ?? null, iban: opts.iban ?? null, status: 'ACTIVE',
      },
      select: { id: true },
    });
  }

  /** Fresh firm (PLATFORM) wallet row — deliberately NOT the seeded F_FEE wallet,
   *  which is a shared aggregate other e2e suites post real fee income to
   *  concurrently (see file header). ownerType:'PLATFORM' matches the seeded
   *  convention so the R2 walletRef/registry-owner check in
   *  AccountFlowProjectorService exempts it (FIRM_SIDE = {PLATFORM, SYSTEM}). */
  async function createFirmWallet(opts: { assetId: string; walletRole: string; type: string }): Promise<{ id: string }> {
    return (prisma as any).wallet.create({
      data: {
        walletNo: `WA-E2E-ADJ-FIRM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ownerType: 'PLATFORM', ownerId: null, ownerNo: 'PLATFORM',
        type: opts.type, walletRole: opts.walletRole, assetId: opts.assetId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
  }

  /** Real production evidence shape — mirrors deposit-workflow.service.ts's own
   *  Step 1 (CLIENT_ASSET→DEPOSIT_SUSPENSE, external crossing) + Step 2
   *  (DEPOSIT_SUSPENSE→CLIENT_PAYABLE, pure reclass) exactly, walletRef stamped
   *  on both legs of both steps. Net effect on the wallet's own
   *  (PAYABLE+SUSPENSE) total, per WalletBalanceCheckerService's accounting, is
   *  +amount (SUSPENSE nets to 0 across the two steps; PAYABLE ends at +amount). */
  async function fundCustomerWallet(opts: {
    walletId: string; ownerId: string; assetId: string; ledger: number; currency: string; amount: bigint; tag: string;
  }): Promise<void> {
    // Random suffix (not just Date.now()) so repeated test runs never reuse a
    // prior run's (sourceType, sourceNo, eventCode) — TigerBeetle's transfer id
    // is a deterministic hash of exactly those fields and persists across runs
    // (this worktree's TB file survives jest re-invocations); a collision makes
    // executeTransfer() treat the transfer as "already exists" and SILENTLY SKIP
    // the evidence/account_flow write for THIS run's (fresh) walletRef, leaving
    // the wallet's internal total at 0 with no error raised anywhere.
    const sourceNo = `E2E-RECON-ADJ-FUND-${opts.tag}-${randomUUID().slice(0, 8)}`;

    const clientAssetId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_ASSET, ledger: opts.ledger, ownerType: 'SYSTEM' });
    const suspenseId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger: opts.ledger, ownerType: 'CUSTOMER', ownerUuid: opts.ownerId });
    const payableId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger: opts.ledger, ownerType: 'CUSTOMER', ownerUuid: opts.ownerId });

    await accounting.executeTransfer({
      debitAccountId: clientAssetId,
      creditAccountId: suspenseId,
      amount: opts.amount,
      ledger: opts.ledger,
      code: TB_TRANSFER_CODES.DEPOSIT_ASSET_TO_SUSPENSE,
      evidence: {
        sourceType: 'DEPOSIT',
        sourceNo,
        eventCode: 'DEPOSIT_ASSET_TO_SUSPENSE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
        creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
        assetCurrency: opts.currency,
        traceId: sourceNo,
        actorType: 'SYSTEM',
        actorId: 'E2E_HARNESS',
        memo: 'e2e fixture: pre-fund customer balance for recon-adjustment money-arc tests (Step 1)',
        debitWalletRef: opts.walletId,
        creditWalletRef: opts.walletId,
        // Deliberately false, UNLIKE deposit-workflow.service.ts's own Step 1
        // (which is a real external crossing). This is backstory setup, not the
        // thing under test: WalletFlowMatcherService treats every
        // isExternalCrossing:true / OWNED_CODES flow as needing a matching
        // external_statement_line, and this fixture doesn't create any — a
        // "true" here would leave the wallet stuck at bucket=SOFT_FLAG
        // (orphan-internal > 0) forever, even after the balance delta hits
        // zero, and WalletReconRunService.autoHealCases() only heals wallets
        // that reach bucket=MATCHED. WalletBalanceCheckerService (the delta
        // computation this test's break/heal cycle actually exercises) sums
        // POSTED flows regardless of this flag, so the choice has zero effect
        // on the behavior under test.
        isExternalCrossing: false,
      },
    });

    await accounting.executeTransfer({
      debitAccountId: suspenseId,
      creditAccountId: payableId,
      amount: opts.amount,
      ledger: opts.ledger,
      code: TB_TRANSFER_CODES.DEPOSIT_SUSPENSE_TO_PAYABLE,
      evidence: {
        sourceType: 'DEPOSIT',
        sourceNo,
        eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
        creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE],
        assetCurrency: opts.currency,
        traceId: sourceNo,
        actorType: 'SYSTEM',
        actorId: 'E2E_HARNESS',
        memo: 'e2e fixture: pre-fund customer balance for recon-adjustment money-arc tests (Step 2)',
        debitWalletRef: opts.walletId,
        creditWalletRef: opts.walletId,
        isExternalCrossing: false,
      },
    });
  }

  /** Give a FIRM wallet a real internal balance in the firm-equity codes
   *  WalletBalanceCheckerService actually sums for a firm wallet (200/201/210/
   *  211/212 — the aggregate FIRM_ASSET leg is deliberately dropped by the
   *  checker, so only the INCOME_OTHER side moves this wallet's total).
   *  Same deterministic-transfer-id caution as fundCustomerWallet. */
  async function fundFirmWallet(opts: {
    walletId: string; ledger: number; currency: string; amount: bigint; tag: string;
  }): Promise<void> {
    const sourceNo = `E2E-RECON-ADJ-FIRMFUND-${opts.tag}-${randomUUID().slice(0, 8)}`;
    const firmAssetId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FIRM_ASSET, ledger: opts.ledger, ownerType: 'SYSTEM' });
    const incomeOtherId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.INCOME_OTHER, ledger: opts.ledger, ownerType: 'SYSTEM' });

    await accounting.executeTransfer({
      debitAccountId: firmAssetId,
      creditAccountId: incomeOtherId,
      amount: opts.amount,
      ledger: opts.ledger,
      code: TB_TRANSFER_CODES.RECON_ADJUSTMENT,
      evidence: {
        sourceType: 'DEPOSIT',
        sourceNo,
        eventCode: 'E2E_FIRM_FIXTURE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_ASSET],
        creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.INCOME_OTHER],
        assetCurrency: opts.currency,
        traceId: sourceNo,
        actorType: 'SYSTEM',
        actorId: 'E2E_HARNESS',
        memo: 'e2e fixture: pre-fund firm wallet income balance',
        debitWalletRef: opts.walletId,
        creditWalletRef: opts.walletId,
        isExternalCrossing: false,
      },
    });
  }

  async function upsertExternalBalance(opts: {
    walletId: string; currency: string; book: 'CLIENT' | 'FIRM'; closingBalance: bigint;
  }): Promise<void> {
    const cutoffDate = CUTOFF.toISOString().slice(0, 10);
    await (prisma as any).externalBalance.upsert({
      where: { source_accountRef_cutoffDate: { source: 'ZAND', accountRef: opts.walletId, cutoffDate } },
      create: {
        source: 'ZAND', accountRef: opts.walletId, currency: opts.currency, book: opts.book,
        cutoffDate, closingBalance: opts.closingBalance.toString(), walletRef: opts.walletId,
      },
      update: { closingBalance: opts.closingBalance.toString() },
    });
  }

  async function openCaseFor(walletId: string): Promise<{ id: string; caseNo: string; deltaAmount: string; book: string; ownerNo: string | null }> {
    const kase = await (prisma as any).reconciliationCase.findFirst({
      where: { walletRef: walletId, status: 'OPEN' },
    });
    return kase;
  }

  async function latestApprovalCase(actionType: string, entityRef: string) {
    return (prisma as any).approvalCase.findFirst({
      where: { actionType, entityRef },
      orderBy: { createdAt: 'desc' },
    });
  }

  async function adjustmentRow(adjustmentNo: string) {
    return (prisma as any).reconciliationAdjustment.findUnique({ where: { adjustmentNo } });
  }

  async function flowsFor(adjustmentNo: string) {
    return (prisma as any).accountFlow.findMany({ where: { sourceType: 'RECON_ADJUSTMENT', sourceNo: adjustmentNo } });
  }

  /** Fixture ReconciliationRun row — only for scenarios that need a valid
   *  openedByRunId FK without running the real engine (gate tests / reverse
   *  assertion, which are testing the service's own input gates and the
   *  approve/reject boundary, not recon economics). */
  async function createFixtureRun(): Promise<string> {
    const row = await (prisma as any).reconciliationRun.create({
      data: {
        runNo: `RUN-E2E-ADJ-FIXTURE-${randomUUID()}`,
        businessDate: TODAY,
        layer: 'WALLET',
        triggerType: 'MANUAL',
      },
      select: { id: true },
    });
    return row.id;
  }

  async function createFixtureCase(opts: {
    walletRef: string; book: 'CLIENT' | 'FIRM'; ownerNo: string | null;
  }): Promise<{ id: string; caseNo: string }> {
    const runId = await createFixtureRun();
    const caseNo = `REC-E2E-ADJ-FIXTURE-${randomUUID()}`;
    const row = await (prisma as any).reconciliationCase.create({
      data: {
        caseNo, businessDate: TODAY, assetId: aedAssetId, assetCode: aedCode, layer: 'WALLET',
        book: opts.book, status: 'OPEN', openedByRunId: runId, walletRef: opts.walletRef, ownerNo: opts.ownerNo,
        deltaAmount: '1000', actualExternal: '1000',
      },
      select: { id: true, caseNo: true },
    });
    return row;
  }

  /** Fixture 提现单——Fix 3（边界线守卫从"查非空"升级成"查存在"）之后，
   *  createDraft 会真的按 relatedOrderNo 查这张表；场景 2 需要一个真实存在的
   *  原单号才能通过闸二，不能再像 Fix 3 之前那样传一个编造的字符串。字段照抄
   *  test/customer-restrictions.e2e-spec.ts 的 makeWithdraw 最小集。 */
  async function createFixtureWithdraw(opts: {
    ownerId: string; ownerNo: string; assetId: string; amount: string;
  }): Promise<{ withdrawNo: string }> {
    const withdrawNo = generateReferenceNo('WD');
    await (prisma as any).withdrawTransaction.create({
      data: {
        withdrawNo,
        ownerType: 'CUSTOMER', ownerId: opts.ownerId, ownerNo: opts.ownerNo,
        status: WithdrawTransactionStatus.RETURNED, // 叙事上与"提现已撤销退回"一致；闸二只查存在性，不查 status
        assetId: opts.assetId,
        amount: opts.amount,
        netAmount: opts.amount,
      },
    });
    return { withdrawNo };
  }

  // ── scenarios ────────────────────────────────────────────────────────────

  it('1. 客户账簿·减（重复入账撤销）：BREAK case → 开单 → 提交 → 真的批准 → account_flows 落账 + 审计留痕 → 重跑对账 → case AUTO_HEALED', async () => {
    const ledger = 1; // AED
    const wallet = await createCustomerWallet({
      ownerId: carolId, ownerNo: carolNo, assetId: aedAssetId, walletRole: 'C_VIBAN', type: 'FIAT_BANK',
      iban: `AE_E2E_ADJ_C1_${Date.now()}`,
    });

    const X1 = 20000n; // AED 200.00, posted TWICE below (simulated duplicate deposit entry)
    await fundCustomerWallet({ walletId: wallet.id, ownerId: carolId, assetId: aedAssetId, ledger, currency: aedCode, amount: X1, tag: 'C1-A' });
    await fundCustomerWallet({ walletId: wallet.id, ownerId: carolId, assetId: aedAssetId, ledger, currency: aedCode, amount: X1, tag: 'C1-B' });
    // internal.total for this wallet is now 2×X1 = 40000 (two "deposits" landed).

    // External bank statement only ever saw ONE legitimate deposit — X1.
    await upsertExternalBalance({ walletId: wallet.id, currency: aedCode, book: 'CLIENT', closingBalance: X1 });

    const run1 = await walletRecon.run({ cutoff: CUTOFF });
    expect(run1.status).toBe('BREAK');

    const kase = await openCaseFor(wallet.id);
    expect(kase).toBeTruthy();
    expect(kase.book).toBe('CUSTOMER'); // recon-engine vocabulary (WalletKind) — AdjustmentService.createDraft() converts this to Book='CLIENT'
    expect(kase.ownerNo).toBe(carolNo);
    expect(String(kase.deltaAmount)).toBe('-20000'); // external(20000) − internal(40000); Decimal, not a plain string

    const { adjustmentNo } = await adjustments.createDraft(
      {
        caseNo: kase.caseNo,
        reasonCode: 'DEPOSIT_DUPLICATE_REVERSAL',
        direction: 'REDUCE',
        amount: '20000',
        effectiveDate: TODAY,
        reasonInternal: 'e2e: 重复入账撤销 fixture',
        reasonCustomer: '充值重复入账已撤销',
      } as any,
      makeActor('E2E_OPS_CREATOR_C1', 'OPS_OFFICER'),
    );
    expect(adjustmentNo).toMatch(/^ADJ/);
    expect((await adjustmentRow(adjustmentNo)).status).toBe(AdjustmentStatus.DRAFT);

    await adjustments.submit(adjustmentNo, makeActor('E2E_OPS_CREATOR_C1', 'OPS_OFFICER'));
    const draftRow = await adjustmentRow(adjustmentNo);
    expect(draftRow.status).toBe(AdjustmentStatus.PENDING_APPROVAL);

    const approvalCase = await latestApprovalCase(ApprovalActionTypes.RECON_ADJUSTMENT_POST, adjustmentNo);
    expect(approvalCase).toBeTruthy();
    expect(approvalCase.status).toBe('PENDING');

    // Bonus check on the submit-time audit trail (APPROVAL_SUBMITTED, written by
    // ApprovalsService.recordSubmitted — NOT by AdjustmentService, which itself
    // never audits createDraft()/submit()). Proves 开单/提交 leave SOME
    // discoverable trail even though AdjustmentService's own onApproved() is the
    // only step that writes a RECON_ADJUSTMENT-primary audit event.
    const submitSubjectRows = await (prisma as any).auditLogSubject.findMany({ where: { subjectNo: adjustmentNo } });
    expect(submitSubjectRows.length).toBeGreaterThanOrEqual(1);

    const approverActor = makeActor('E2E_OPS_APPROVER_C1', 'OPS_OFFICER');
    await approvalsService.approve(approvalCase.id, { reason: 'e2e approve scenario 1' }, approverActor);

    await waitUntil(async () => (await adjustmentRow(adjustmentNo)).status === AdjustmentStatus.POSTED);
    const postedRow = await adjustmentRow(adjustmentNo);
    expect(postedRow.decidedByUserId).toBe('E2E_OPS_APPROVER_C1'); // NOT 'SYSTEM' — proves the decider event field wires correctly

    const flows = await flowsFor(adjustmentNo);
    expect(flows).toHaveLength(2);
    const payableLeg = flows.find((f: any) => f.tbAccountId && f.direction === 'OUT');
    expect(payableLeg).toBeTruthy();
    expect(payableLeg.walletRef).toBe(wallet.id);
    expect(payableLeg.isExternalCrossing).toBe(false);
    expect(String(payableLeg.amount)).toBe('20000');
    for (const f of flows) {
      expect(f.walletRef).toBe(wallet.id); // ⚠ must land on the wallet the case is about, or delta never zeros
    }

    const evidence = await tbEvidence.findBySource('RECON_ADJUSTMENT', adjustmentNo);
    expect(evidence.map((e: any) => e.eventCode)).toContain('RECON_ADJUSTMENT_POSTED');

    const auditRows = await (prisma as any).auditLogEvent.findMany({
      where: {
        primarySubjectType: AuditEntityTypes.RECON_ADJUSTMENT,
        primarySubjectNo: adjustmentNo,
        action: AuditActions.RECON_ADJUSTMENT_POSTED,
      },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actorNo).toBe('E2E_OPS_APPROVER_C1'); // real approver, not SYSTEM

    // ── 重跑对账：内部余额已经等于外部真值 → 自愈 ──
    const run2 = await walletRecon.run({ cutoff: CUTOFF });
    expect(run2.casesAutoHealed).toBeGreaterThanOrEqual(1);

    const healedCase = await (prisma as any).reconciliationCase.findUnique({ where: { id: kase.id } });
    expect(healedCase.status).toBe('RESOLVED');
    expect(healedCase.resolutionReason).toBe('AUTO_HEALED');
  });

  it('2. 客户账簿·加（提现撤销退回，带关联原单）：闭环 + 分录方向为 借客户托管/贷客户应付', async () => {
    const ledger = 1; // AED
    const wallet = await createCustomerWallet({
      ownerId: daveId, ownerNo: daveNo, assetId: aedAssetId, walletRole: 'C_VIBAN', type: 'FIAT_BANK',
      iban: `AE_E2E_ADJ_C2_${Date.now()}`,
    });

    const FUNDED = 30000n;   // 我们账上记着的
    const REALLY = 45000n;   // 外部实际有的 —— 我们少记了 15000（一笔提现扣了客户的钱但实际没出去）
    await fundCustomerWallet({ walletId: wallet.id, ownerId: daveId, assetId: aedAssetId, ledger, currency: aedCode, amount: FUNDED, tag: 'C2' });
    await upsertExternalBalance({ walletId: wallet.id, currency: aedCode, book: 'CLIENT', closingBalance: REALLY });

    expect((await walletRecon.run({ cutoff: CUTOFF })).status).toBe('BREAK');

    const kase = await openCaseFor(wallet.id);
    expect(kase).toBeTruthy();
    expect(String(kase.deltaAmount)).toBe('15000'); // external − internal，正数 = 内部记少了

    // Fix 3：relatedOrderNo 现在真的会被查——必须是一张已存在的提现单，不能再
    // 编一个字符串（这行改动本身就是 Fix 3 那条评审发现的实证：改之前这里写死
    // 'WD-E2E-ADJ-C2-0001'，一张不存在的单号，createDraft 照样放行并成功过账）。
    const originalWithdraw = await createFixtureWithdraw({
      ownerId: daveId, ownerNo: daveNo, assetId: aedAssetId, amount: '15000',
    });

    const { adjustmentNo } = await adjustments.createDraft(
      {
        caseNo: kase.caseNo,
        reasonCode: 'WITHDRAW_VOID_REFUND',
        direction: 'INCREASE',
        amount: '15000',
        effectiveDate: TODAY,
        reasonInternal: 'e2e: 提现已撤销但账没冲，钱还在钱包里',
        reasonCustomer: '提现已撤销，款项退回',
        relatedOrderNo: originalWithdraw.withdrawNo, // 客户账簿加钱必须指明一张真实存在的原单（边界线守卫）
      } as any,
      makeActor('E2E_OPS_CREATOR_C2', 'OPS_OFFICER'),
    );

    await adjustments.submit(adjustmentNo, makeActor('E2E_OPS_CREATOR_C2', 'OPS_OFFICER'));
    const approvalCase = await latestApprovalCase(ApprovalActionTypes.RECON_ADJUSTMENT_POST, adjustmentNo);
    await approvalsService.approve(approvalCase.id, { reason: 'e2e approve scenario 2' }, makeActor('E2E_OPS_APPROVER_C2', 'OPS_OFFICER'));

    await waitUntil(async () => (await adjustmentRow(adjustmentNo)).status === AdjustmentStatus.POSTED);

    // 分录方向：客户账簿 + 加钱 → 借 客户托管资产 / 贷 客户应付（与场景 1 恰好相反）
    const evidence = await tbEvidence.findBySource('RECON_ADJUSTMENT', adjustmentNo);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].debitCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET]);
    expect(evidence[0].creditCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE]);

    for (const f of await flowsFor(adjustmentNo)) {
      expect(f.walletRef).toBe(wallet.id);
      expect(f.isExternalCrossing).toBe(false);
    }

    await walletRecon.run({ cutoff: CUTOFF });
    const healed = await (prisma as any).reconciliationCase.findUnique({ where: { id: kase.id } });
    expect(healed.status).toBe('RESOLVED');
    expect(healed.resolutionReason).toBe('AUTO_HEALED');
  });

  it('3. 公司账簿·加（银行利息）：闭环 + 分录方向为 借公司资产/贷其他收入', async () => {
    const ledger = 1; // AED
    const wallet = await createFirmWallet({ assetId: aedAssetId, walletRole: 'F_FEE', type: 'FIAT_BANK' });

    const FUNDED = 5000n;
    const REALLY = 7000n; // 银行多给了 2000 —— 利息，归公司（decisions.md 2026-08-28）
    await fundFirmWallet({ walletId: wallet.id, ledger, currency: aedCode, amount: FUNDED, tag: 'F3' });
    await upsertExternalBalance({ walletId: wallet.id, currency: aedCode, book: 'FIRM', closingBalance: REALLY });

    expect((await walletRecon.run({ cutoff: CUTOFF })).status).toBe('BREAK');

    const kase = await openCaseFor(wallet.id);
    expect(kase).toBeTruthy();
    expect(kase.book).toBe('FIRM');
    expect(kase.ownerNo).toBeNull(); // 公司钱包没有客户

    const { adjustmentNo } = await adjustments.createDraft(
      {
        caseNo: kase.caseNo,
        reasonCode: 'BANK_INTEREST',
        direction: 'INCREASE',
        amount: '2000',
        effectiveDate: TODAY,
        reasonInternal: 'e2e: 银行付息，我方未记',
        reasonCustomer: '（公司侧，客户不可见）',
      } as any,
      makeActor('E2E_OPS_CREATOR_F3', 'OPS_OFFICER'),
    );

    await adjustments.submit(adjustmentNo, makeActor('E2E_OPS_CREATOR_F3', 'OPS_OFFICER'));
    const approvalCase = await latestApprovalCase(ApprovalActionTypes.RECON_ADJUSTMENT_POST, adjustmentNo);
    await approvalsService.approve(approvalCase.id, { reason: 'e2e approve scenario 3' }, makeActor('E2E_OPS_APPROVER_F3', 'OPS_OFFICER'));

    await waitUntil(async () => (await adjustmentRow(adjustmentNo)).status === AdjustmentStatus.POSTED);

    const evidence = await tbEvidence.findBySource('RECON_ADJUSTMENT', adjustmentNo);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].debitCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_ASSET]);
    expect(evidence[0].creditCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.INCOME_OTHER]);

    const postedRow = await adjustmentRow(adjustmentNo);
    expect(postedRow.book).toBe('FIRM');
    expect(postedRow.ownerNo).toBeNull();

    await walletRecon.run({ cutoff: CUTOFF });
    const healed = await (prisma as any).reconciliationCase.findUnique({ where: { id: kase.id } });
    expect(healed.status).toBe('RESOLVED');
    expect(healed.resolutionReason).toBe('AUTO_HEALED');
  });

  it('4. 反向断言：审批未通过 → 账本零动静、单仍待审批；驳回后仍零动静且落终态 REJECTED', async () => {
    const wallet = await createCustomerWallet({
      ownerId: carolId, ownerNo: carolNo, assetId: aedAssetId, walletRole: 'C_VIBAN', type: 'FIAT_BANK',
      iban: `AE_E2E_ADJ_C4_${Date.now()}`,
    });
    const kase = await createFixtureCase({ walletRef: wallet.id, book: 'CLIENT', ownerNo: carolNo });

    const { adjustmentNo } = await adjustments.createDraft(
      {
        caseNo: kase.caseNo,
        reasonCode: 'DEPOSIT_DUPLICATE_REVERSAL',
        direction: 'REDUCE',
        amount: '1000',
        effectiveDate: TODAY,
        reasonInternal: 'e2e: 反向断言，这单不会被批',
        reasonCustomer: '（不会发生）',
      } as any,
      makeActor('E2E_OPS_CREATOR_C4', 'OPS_OFFICER'),
    );
    await adjustments.submit(adjustmentNo, makeActor('E2E_OPS_CREATOR_C4', 'OPS_OFFICER'));

    // 仅提交、未裁决 —— 账本必须一动不动
    expect(await flowsFor(adjustmentNo)).toHaveLength(0);
    expect((await adjustmentRow(adjustmentNo)).status).toBe(AdjustmentStatus.PENDING_APPROVAL);
    expect(await tbEvidence.findBySource('RECON_ADJUSTMENT', adjustmentNo)).toHaveLength(0);

    // 驳回 —— 落终态，账本依然零动静
    const approvalCase = await latestApprovalCase(ApprovalActionTypes.RECON_ADJUSTMENT_POST, adjustmentNo);
    await approvalsService.reject(approvalCase.id, { reason: 'e2e reject scenario 4' }, makeActor('E2E_OPS_APPROVER_C4', 'OPS_OFFICER'));

    await waitUntil(async () => (await adjustmentRow(adjustmentNo)).status === AdjustmentStatus.REJECTED);
    expect(await flowsFor(adjustmentNo)).toHaveLength(0);
    expect((await adjustmentRow(adjustmentNo)).decidedByUserId).toBe('E2E_OPS_APPROVER_C4');
  });

  it('5. 边界线守卫：客户账簿 + 加钱 + 无关联原单 → 拒（凭空给客户加钱等于绕过 KYT 与合规闸）', async () => {
    const wallet = await createCustomerWallet({
      ownerId: carolId, ownerNo: carolNo, assetId: aedAssetId, walletRole: 'C_VIBAN', type: 'FIAT_BANK',
      iban: `AE_E2E_ADJ_C5_${Date.now()}`,
    });
    const kase = await createFixtureCase({ walletRef: wallet.id, book: 'CLIENT', ownerNo: carolNo });

    await expect(
      adjustments.createDraft(
        {
          caseNo: kase.caseNo,
          reasonCode: 'WITHDRAW_VOID_REFUND',
          direction: 'INCREASE',
          amount: '1000',
          effectiveDate: TODAY,
          reasonInternal: 'e2e: 无原单，应被守卫拦下',
          reasonCustomer: '（不会发生）',
          // relatedOrderNo 故意不传
        } as any,
        makeActor('E2E_OPS_CREATOR_C5', 'OPS_OFFICER'),
      ),
    ).rejects.toThrow(BadRequestException);

    // 拒得干净：没有留下任何半成品单
    const leftovers = await (prisma as any).reconciliationAdjustment.findMany({ where: { caseNo: kase.caseNo } });
    expect(leftovers).toHaveLength(0);
  });

  it('6. 成因闸：公司侧成因（银行利息）落到客户账簿的案件 → 拒', async () => {
    const wallet = await createCustomerWallet({
      ownerId: carolId, ownerNo: carolNo, assetId: aedAssetId, walletRole: 'C_VIBAN', type: 'FIAT_BANK',
      iban: `AE_E2E_ADJ_C6_${Date.now()}`,
    });
    const kase = await createFixtureCase({ walletRef: wallet.id, book: 'CLIENT', ownerNo: carolNo });

    await expect(
      adjustments.createDraft(
        {
          caseNo: kase.caseNo,
          reasonCode: 'BANK_INTEREST', // 只允许 FIRM 账簿
          direction: 'INCREASE',
          amount: '1000',
          effectiveDate: TODAY,
          reasonInternal: 'e2e: 成因与账簿不符，应被成因闸拦下',
          reasonCustomer: '（不会发生）',
          relatedOrderNo: 'WD-E2E-ADJ-C6-0001', // 带上原单，确保拒绝来自成因闸而不是边界线守卫（反遮蔽）
        } as any,
        makeActor('E2E_OPS_CREATOR_C6', 'OPS_OFFICER'),
      ),
    ).rejects.toThrow(BadRequestException);

    const leftovers = await (prisma as any).reconciliationAdjustment.findMany({ where: { caseNo: kase.caseNo } });
    expect(leftovers).toHaveLength(0);
  });

  it('7. 公司账簿·减（银行杂费）：闭环 + 分录方向为 借公司运营/贷公司资产（V2 补口——四种分录组合里此前从未真落过账的最后一种）', async () => {
    const ledger = 1; // AED
    const wallet = await createFirmWallet({ assetId: aedAssetId, walletRole: 'F_FEE', type: 'FIAT_BANK' });

    const FUNDED = 7000n;
    const REALLY = 5000n; // 银行扣了 2000 账管费/电汇费 —— 外部实际比我们记的少，公司承担（decisions.md 2026-08-28）
    await fundFirmWallet({ walletId: wallet.id, ledger, currency: aedCode, amount: FUNDED, tag: 'F7' });
    await upsertExternalBalance({ walletId: wallet.id, currency: aedCode, book: 'FIRM', closingBalance: REALLY });

    expect((await walletRecon.run({ cutoff: CUTOFF })).status).toBe('BREAK');

    const kase = await openCaseFor(wallet.id);
    expect(kase).toBeTruthy();
    expect(kase.book).toBe('FIRM');
    expect(kase.ownerNo).toBeNull(); // 公司钱包没有客户
    expect(String(kase.deltaAmount)).toBe('-2000'); // external(5000) − internal(7000)，负数 = 内部记多了，要减

    const { adjustmentNo } = await adjustments.createDraft(
      {
        caseNo: kase.caseNo,
        reasonCode: 'BANK_CHARGE',
        direction: 'REDUCE',
        amount: '2000',
        effectiveDate: TODAY,
        reasonInternal: 'e2e V2: 银行账管费/电汇费，公司承担',
        reasonCustomer: '（公司侧，客户不可见）',
      } as any,
      makeActor('E2E_OPS_CREATOR_F7', 'OPS_OFFICER'),
    );

    await adjustments.submit(adjustmentNo, makeActor('E2E_OPS_CREATOR_F7', 'OPS_OFFICER'));
    const approvalCase = await latestApprovalCase(ApprovalActionTypes.RECON_ADJUSTMENT_POST, adjustmentNo);
    await approvalsService.approve(approvalCase.id, { reason: 'e2e approve scenario 7' }, makeActor('E2E_OPS_APPROVER_F7', 'OPS_OFFICER'));

    await waitUntil(async () => (await adjustmentRow(adjustmentNo)).status === AdjustmentStatus.POSTED);

    // 分录方向：公司账簿 + 减钱 → 借 公司运营权益 / 贷 公司资产（与场景 3 恰好相反）
    const evidence = await tbEvidence.findBySource('RECON_ADJUSTMENT', adjustmentNo);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].debitCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_OPS]);
    expect(evidence[0].creditCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_ASSET]);

    const postedRow = await adjustmentRow(adjustmentNo);
    expect(postedRow.book).toBe('FIRM');
    expect(postedRow.ownerNo).toBeNull();

    await walletRecon.run({ cutoff: CUTOFF });
    const healed = await (prisma as any).reconciliationCase.findUnique({ where: { id: kase.id } });
    expect(healed.status).toBe('RESOLVED');
    expect(healed.resolutionReason).toBe('AUTO_HEALED');
  });

  // ── verification gaps closed at final review (V1/V2/V3) ────────────────────

  it('V1 · maker≡checker：同一个人开单+提交后又想批自己的单 → SoD 拒绝（Fix 2 回归锁——maker 侧的 actor 身份不能被塌缩成一个字符串，否则自审批检测悄悄失效）', async () => {
    const wallet = await createCustomerWallet({
      ownerId: carolId, ownerNo: carolNo, assetId: aedAssetId, walletRole: 'C_VIBAN', type: 'FIAT_BANK',
      iban: `AE_E2E_ADJ_V1_${Date.now()}`,
    });
    const kase = await createFixtureCase({ walletRef: wallet.id, book: 'CLIENT', ownerNo: carolNo });

    // 刻意让 userId 与 userNo 不同（真实生产里两者本就不同：JWT 的 UUID vs
    // 业务号）——makeActor() 把两者设成同一个字符串，若照抄它，"maker 端把
    // actor.userId 悄悄换成 actor.userNo" 这类回归会因为两者恰好相等而测不出来
    // （同一个反遮蔽陷阱这批已经踩过三次：断言为真的原因与被测规则无关）。
    const soloActor: ApprovalActorContext = {
      actorType: 'ADMIN', userId: 'e2e-uuid-solo-v1', userNo: 'OPS-SOLO-V1',
      role: 'OPS_OFFICER', roleCodes: ['OPS_OFFICER'],
    };

    const { adjustmentNo } = await adjustments.createDraft(
      {
        caseNo: kase.caseNo,
        reasonCode: 'DEPOSIT_DUPLICATE_REVERSAL',
        direction: 'REDUCE',
        amount: '1000',
        effectiveDate: TODAY,
        reasonInternal: 'e2e V1: maker==checker 必须被拒',
        reasonCustomer: '（不会发生）',
      } as any,
      soloActor,
    );
    await adjustments.submit(adjustmentNo, soloActor);

    const approvalCase = await latestApprovalCase(ApprovalActionTypes.RECON_ADJUSTMENT_POST, adjustmentNo);
    // Fix 2 的确切落点：ApprovalCase.createdByUserId 必须落的是 actor.userId
    // （真实 UUID 口径），不是 userNo 或别的什么塌缩值——否则下面 approve() 用
    // 同一个 actor 去比对时永远比不上，自审批检测形同虚设（这正是 Fix 2 之前的
    // 真实故障：submit() 曾经自己拼一个 { userId: operatorId, userNo:
    // operatorId, roleCodes: ['ADMIN'] }）。
    expect(approvalCase.createdByUserId).toBe('e2e-uuid-solo-v1');

    await expect(
      approvalsService.approve(approvalCase.id, { reason: 'e2e V1: 尝试自批' }, soloActor),
    ).rejects.toThrow('Maker and checker must be different users');

    // 拒得干净：账本零动静，单仍卡在 PENDING_APPROVAL（不是被批准也不是被驳回）。
    expect(await flowsFor(adjustmentNo)).toHaveLength(0);
    expect((await adjustmentRow(adjustmentNo)).status).toBe(AdjustmentStatus.PENDING_APPROVAL);
  });
});
