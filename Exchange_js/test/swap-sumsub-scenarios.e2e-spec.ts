import * as path from 'path';
import * as dotenv from 'dotenv';

// Must be set before AppModule is imported — mirrors withdraw-sumsub-scenarios
// .e2e-spec.ts's identical guard (WithdrawVerificationSessionService there /
// nothing here needs it directly, but AdminSwapDemoController and
// SwapDemoScenarioService are only registered into the module tree when this
// is true — swap-sumsub.module.ts's conditional `controllers` array).
process.env.SUMSUB_MOCK_MODE = 'true';

// Loaded before any other import so PrismaService / TigerBeetleService see the
// worktree's own DATABASE_URL / TB_ADDRESS regardless of ConfigModule's internal
// load timing (belt-and-braces — mirrors swap-money-arc.e2e-spec.ts / withdraw
// -sumsub-scenarios.e2e-spec.ts).
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { SwapWorkflowService } from '../src/modules/trading/swap-transactions/swap-workflow.service';
import { SwapTransactionsService } from '../src/modules/trading/swap-transactions/swap-transactions.service';
import { SwapTransactionStatus } from '../src/modules/trading/swap-transactions/dto/swap-transaction.dto';
import { SwapQuoteService } from '../src/modules/trading/swap-fee-level/swap-quote.service';
import { FundsOrderService } from '../src/modules/funds-orders/funds-order.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';
import { CustomerRestrictionsService } from '../src/modules/identity/customers/customer-restrictions.service';
import { CustomerAccessService } from '../src/modules/identity/customers/customer-access.service';
import { MaterialRequestsService } from '../src/modules/identity/material-requests/material-requests.service';
import { SUMSUB_TXN_CLIENT } from '../src/modules/sumsub-shared/sumsub-txn-client.interface';
import { MockSumsubTxnClient } from '../src/modules/sumsub-shared/sumsub-txn-client.mock';
import { SwapDemoScenarioService } from '../src/modules/swap-sumsub/demo-scenario.service';
import { AuditActions, AuditEntityTypes } from '../src/modules/audit-logging/constants/audit-actions.constant';
import { ensureTbAccountRegistry, provisionTbAccounts } from '../prisma/seed-tb.helper';
import { buildDeterministicNo } from '../src/common/utils/no-generator.util';

/**
 * Task 12: swap Sumsub verdict-button e2e — mirrors withdraw-sumsub-scenarios
 * .e2e-spec.ts's structure (real AppModule, only SUMSUB_TXN_CLIENT mocked),
 * driving the swap domain's 8 single-step verdict buttons
 * (`src/modules/swap-sumsub/fixtures/verdict-buttons.ts`) through the REAL
 * production entry point `SwapDemoScenarioService.runVerdict()` — the exact
 * method the admin Simulation panel's buttons call — which primes the mock
 * Sumsub client and drives the real ingest → router → handler → workflow
 * chain end to end, exactly like a genuine webhook delivery would.
 *
 * Harness notes:
 * - Uses a FRESH synthetic customer created directly via Prisma (not one of
 *   the 8 seeded DEMO_CUSTOMER_EMAILS — those are all either claimed by other
 *   e2e suites [alice/bob deposit, frank/grace withdraw] or by
 *   test/swap-money-arc.e2e-spec.ts [acme], and jest's e2e config has no
 *   maxWorkers pin so spec files may run in parallel workers against the same
 *   worktree DB/TigerBeetle cluster). CustomerMain's identity/auth columns
 *   (email/phone/passwordHash/...) are all optional — only the fields the
 *   trading gates actually read are set (mirrors seed.business.ts's own
 *   DEMO_CUSTOMERS shape for an APPROVED/ACTIVE/CLEAR individual).
 * - `sumsubApplicantId` IS set here (unlike swap-money-arc, which never sets
 *   it) — required for the webhook path specifically: `initiateSwap`'s
 *   `submitSumsubTxnOut` is awaited synchronously and only stamps
 *   `sumsubTxnIdOut` when an applicantId is on file; `SwapKytVerdictHandler`
 *   claims a webhook by matching `payload.kytTxnId` against that column
 *   (`findBySumsubTxnId`), so without it every simulated verdict would be an
 *   orphan webhook nothing claims.
 * - All 7 scenario swaps are created UP FRONT in `beforeAll`, while the
 *   customer is still unrestricted — `initiateSwap` requires SWAP not be
 *   restricted, but delivering a verdict (`SwapKytVerdictHandler` →
 *   `applyKytVerdict`) never re-checks eligibility, only the swap's own
 *   status. Creating them lazily mid-suite would deadlock the moment the
 *   first rejection lands. Delivery ORDER (not creation order) is what makes
 *   the restriction/sticky-hard-line state machine exercised below
 *   meaningful — see each `it()`'s comment for why it must run where it does.
 * - 2026-08-29 (Task A5): the old V7/V8 buttons (webhookType
 *   `applicantActionReviewed`, cleared/escalated the soft-line restriction
 *   opened below) were deleted from the swap panel — material review is a
 *   person-level webhook, not a transaction-layer one; its real demo entry
 *   point is the customer detail page's Verification Requests panel
 *   (`POST /admin/sumsub/simulate/applicant-action-result`), not this swap
 *   panel. Both remaining "soft-line" scenarios below (v3aSwap, v6Swap) now
 *   deliver the SAME button, `V2_AWAIT_USER` (both ② — the old fixture had
 *   two near-duplicate soft-line buttons, V3/V6, that the unified table
 *   correctly collapsed into one). v3aSwap's restriction is reset directly
 *   via Prisma at the end of its own `it()` (same test-hygiene idiom
 *   `beforeAll` already uses, since no swap-panel button clears it anymore)
 *   so the v6Swap scenario still observes a clean starting state.
 */
describe('Swap Sumsub verdict buttons (e2e, Task 12)', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let prisma: PrismaService;
  let workflow: SwapWorkflowService;
  let swapService: SwapTransactionsService;
  let swapQuote: SwapQuoteService;
  let fundsOrders: FundsOrderService;
  let accounting: AccountingService;
  let restrictionsService: CustomerRestrictionsService;
  let materialRequests: MaterialRequestsService;
  let demoService: SwapDemoScenarioService;

  let customerId: string;
  let customerNo: string;

  let aedAssetId: string;
  let usdtAssetId: string;

  const HARNESS_ACTOR = { actorId: 'E2E_HARNESS', actorRole: 'OPS_OFFICER' };

  // Pre-created (beforeAll) COMPLIANCE_PENDING swaps, one per scenario.
  let v1Swap: any;
  let v2Swap: any;
  let v3aSwap: any; // soft-line — restriction reset via Prisma at the end of its own test (V7 that used to clear it is gone, see class comment)
  let v3bSwap: any; // soft-line again, but delivered AFTER sticky hard-line — proves persistence
  let v4Swap: any;
  let v5Swap: any;
  let v6Swap: any;

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
    workflow = app.get(SwapWorkflowService);
    swapService = app.get(SwapTransactionsService);
    swapQuote = app.get(SwapQuoteService);
    fundsOrders = app.get(FundsOrderService);
    accounting = app.get(AccountingService);
    restrictionsService = app.get(CustomerRestrictionsService);
    materialRequests = app.get(MaterialRequestsService);
    demoService = app.get(SwapDemoScenarioService);

    customerNo = buildDeterministicNo('CU', 'e2e-swap-sumsub-scenarios');
    const customer = await prisma.customerMain.upsert({
      where: { customerNo },
      update: {
        lifecycle: 'ACTIVE',
        hardLineDispositionedAt: null, sumsubApplicantId: 'e2e0swapsumsubscenarios01',
      },
      create: {
        customerNo, customerType: 'INDIVIDUAL', riskRating: 'LOW', tradingTier: 'BASIC',
        lifecycle: 'ACTIVE',
        eddRequired: false, sumsubApplicantId: 'e2e0swapsumsubscenarios01',
      },
    });
    customerId = customer.id;

    // 三轴收敛：便签搬进了 customer_restrictions 独立表，旧写法靠给客户列写
    // restrictions:'[]' 复位，那条列已删。这里显式清场 —— 不清的话上一支/上一轮
    // 留下的 OPEN 便签会被新的 L1 能力门拦住建单，用例之间不再独立。
    await prisma.customerRestriction.deleteMany({ where: { customerId } });
    // 2026-08-17 材料请求账：同款清场，另一张表。customerNo 是确定性的
    // （buildDeterministicNo），不清的话对一个持久化 worktree DB 重跑本 suite
    // 第二次，上一轮留下的行会堆积在 listLiveByOrder 里干扰断言。
    //
    // 终审 Important #4（2026-08-18 二次修订）：③/⑥ 用的 externalActionId
    // 此前是 fixture 里的固定字面量（demo-ext-1/demo-ext-3），不清场会在重跑
    // 时撞 P2002；已改成按调用现铸（见
    // src/modules/swap-sumsub/fixtures/verdict-buttons.ts），这里的清场不再
    // 是绕过 P2002 的必要条件，但仍保留作测试卫生。
    await prisma.materialRequest.deleteMany({ where: { customerId } });

    const aedAsset = await prisma.asset.findFirst({ where: { currency: 'AED' } });
    const usdtAsset = await prisma.asset.findFirst({ where: { currency: 'USDT' } });
    if (!aedAsset || !aedAsset.tbLedgerId || !usdtAsset || !usdtAsset.tbLedgerId) {
      throw new Error('Fixture assets AED/USDT not seeded (or missing tbLedgerId) — run `npm run db:biz:init` first.');
    }
    aedAssetId = aedAsset.id;
    usdtAssetId = usdtAsset.id;

    // Fresh customer → no TB account registry rows exist yet (unlike the 8
    // seeded DEMO_CUSTOMERS, which seed.business.ts provisions unconditionally
    // for every active asset) — provision CLIENT_PAYABLE + DEPOSIT_SUSPENSE for
    // both assets ourselves, mirroring that same seed step exactly.
    for (const asset of [aedAsset, usdtAsset]) {
      const ledger = TB_LEDGERS[asset.currency as keyof typeof TB_LEDGERS];
      for (const code of [TB_ACCOUNT_CODES.CLIENT_PAYABLE, TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE]) {
        await ensureTbAccountRegistry(prisma as any, {
          code, ledger, ownerType: 'CUSTOMER', ownerUuid: customerId, ownerNo: customerNo,
          assetCode: asset.code, description: `e2e swap-sumsub-scenarios ${code}/${asset.code}`,
        });
      }
    }
    await provisionTbAccounts(prisma as any);

    // Customer receiving wallets (R4: initiateSwap's receiving-account gate).
    await ensureCustomerWallet({ network: 'AED_ZAND', walletRole: 'C_VIBAN', iban: `AE_SWAP_SCN_${customerNo}` });
    await ensureCustomerWallet({ network: 'TRON', walletRole: 'C_DEP', address: `T_SWAP_SCN_${customerNo}` });

    // Trading-start precondition gate (assertTradingReady): needs ≥1 ACTIVE
    // BANK withdrawal address on file for SWAP/WITHDRAW eligibility to even
    // reach the restrictions check this suite exercises.
    await ensureWithdrawalAddress({
      addressType: 'BANK', network: 'AED_ZAND',
      address: 'AE070331234567890177777', iban: 'AE070331234567890177777',
    });

    await fundCustomer(aedAssetId, 'AED', '1000000');
    await fundCustomer(usdtAssetId, 'USDT', '1000000');

    // All 7 scenario swaps, created while the customer is still unrestricted —
    // see class comment for why creation must happen up front.
    v1Swap = await createSwap('40');
    v2Swap = await createSwap('41');
    v3aSwap = await createSwap('42');
    v3bSwap = await createSwap('43');
    v4Swap = await createSwap('44');
    v5Swap = await createSwap('45');
    v6Swap = await createSwap('46');
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

  /** Find-or-create — customerNo (and therefore customerId) is deterministic
   *  across suite runs, so a repeated run against a persistent worktree DB
   *  must not collide on wallet/address unique constraints (mirrors
   *  swap-money-arc.e2e-spec.ts / withdraw-money-arcs.e2e-spec.ts's identical
   *  idempotent helpers). */
  async function ensureCustomerWallet(opts: {
    walletRole: 'C_VIBAN' | 'C_DEP'; network: string; iban?: string; address?: string;
  }): Promise<string> {
    const existing = await (prisma as any).wallet.findFirst({
      where: { ownerType: 'CUSTOMER', ownerId: customerId, network: opts.network, walletRole: opts.walletRole, status: 'ACTIVE' },
    });
    if (existing) return existing.id;
    const created = await (prisma as any).wallet.create({
      data: {
        walletNo: `WA-E2E-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ownerType: 'CUSTOMER', ownerId: customerId, ownerNo: customerNo,
        vaultCode: 'CLIENT_DEPOSIT', walletRole: opts.walletRole, network: opts.network,
        address: opts.address ?? null, iban: opts.iban ?? null, status: 'ACTIVE',
      },
    });
    return created.id;
  }

  async function ensureWithdrawalAddress(opts: {
    addressType: string; network: string; address: string; iban?: string;
  }): Promise<void> {
    const existing = await (prisma as any).withdrawalAddress.findFirst({
      where: { customerId, network: opts.network, address: opts.address, status: 'ACTIVE' },
    });
    if (existing) return;
    await (prisma as any).withdrawalAddress.create({
      data: {
        addressNo: `WAD-E2E-${opts.addressType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        customerId, customerNo, network: opts.network,
        address: opts.address, addressType: opts.addressType, iban: opts.iban ?? null,
        ownershipDeclaredAt: new Date(), ownershipProofType: 'E2E_FIXTURE',
        status: 'ACTIVE', activatesAt: new Date(Date.now() - 1000),
        traceId: `e2e-address-${opts.addressType}`,
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
        sourceNo: `E2E-SWAP-SCN-FUND-${currency}`,
        eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
        creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE],
        assetCurrency: currency,
        traceId: `e2e-swap-scn-fund-${currency}`,
        actorType: 'SYSTEM',
        actorId: 'E2E_HARNESS',
        memo: 'e2e fixture: pre-fund customer balance for swap sumsub-scenario tests',
        isExternalCrossing: false,
      },
    });
  }

  /** Real production birth: SwapWorkflowService.initiateSwap() via a real
   *  USDT→AED quote, then confirms the (awaited, not fire-and-forget)
   *  submitSumsubTxnOut actually stamped sumsubTxnIdOut — required for the
   *  webhook path this file exercises to claim any delivered verdict. */
  async function createSwap(amount: string): Promise<any> {
    const quote = await swapQuote.createQuote({
      ownerType: 'CUSTOMER', ownerId: customerId, ownerNo: customerNo,
      fromAssetId: usdtAssetId, fromAssetCode: 'USDT', toAssetId: aedAssetId, toAssetCode: 'AED',
      amount: new Prisma.Decimal(amount), customerId,
    });
    const swap = await workflow.initiateSwap(customerId, quote.id);
    const internal = await swapService.findByIdInternal(swap.id);
    if (!internal.sumsubTxnIdOut) {
      throw new Error(`swap ${swap.swapNo} has no sumsubTxnIdOut — submitSumsubTxnOut did not stamp it`);
    }
    return swap;
  }

  /** Delivers one verdict button through the REAL production entry point
   *  (SwapDemoScenarioService.runVerdict) — same code the admin simulation
   *  button calls. */
  async function deliver(swapId: string, buttonKey: string) {
    return demoService.runVerdict(swapId, buttonKey, HARNESS_ACTOR);
  }

  /**
   * 三轴收敛后 CustomerRestrictionsService.list() 已不存在，取而代之是
   * listOpen() —— 返回聚合视图（一个 restrictionNo 一行，能力收在 scopes 数组里），
   * 不再是「一个 capability 一行」。这个 helper 把 OPEN 便签摊平回能力列表，
   * 让下面的断言保持原本的语义。
   */
  async function openScopes(id: string): Promise<string[]> {
    const rows = await restrictionsService.listOpen(id);
    return rows.flatMap((r) => r.scopes).sort();
  }

  async function statusOf(id: string): Promise<string> {
    const row = await swapService.findByIdInternal(id);
    return row.status;
  }

  async function auditActionsFor(entityId: string, entityType: string): Promise<string[]> {
    // 8/25 审计改表后按业务键查（primarySubjectNo/Type）；先按类型解出对应单号。
    let subjectNo: string | null = null;
    if (entityType === AuditEntityTypes.SWAP_TRANSACTION) {
      subjectNo = (await (prisma as any).swapTransaction.findUnique({ where: { id: entityId }, select: { swapNo: true } }))?.swapNo ?? null;
    } else if (entityType === AuditEntityTypes.MATERIAL_REQUEST) {
      subjectNo = (await (prisma as any).materialRequest.findUnique({ where: { id: entityId }, select: { requestNo: true } }))?.requestNo ?? null;
    } else if (entityType === AuditEntityTypes.CUSTOMER) {
      // 站6 起 V2 已换新合同——客户审计主对象号是 customerNo,按 id 解号。
      subjectNo = (await (prisma as any).customerMain.findUnique({ where: { id: entityId }, select: { customerNo: true } }))?.customerNo ?? null;
    }
    if (!subjectNo) return [];
    const rows = await (prisma as any).auditLogEvent.findMany({
      where: { primarySubjectNo: subjectNo, primarySubjectType: entityType },
      select: { action: true },
    });
    return rows.map((r: any) => r.action);
  }

  /** Material request rows are audited by their internal `id`, not `requestNo`
   *  (MaterialRequestRow doesn't expose `id`) — look it up via prisma first. */
  async function materialRequestAuditActionsFor(requestNo: string): Promise<string[]> {
    const row = await (prisma as any).materialRequest.findUnique({ where: { requestNo } });
    if (!row) return [];
    return auditActionsFor(row.id, AuditEntityTypes.MATERIAL_REQUEST);
  }

  // ── matrix (8 single-step verdict buttons + sticky-hard-line persistence) ──

  it('① approved: COMPLIANCE_PENDING → PROCESSING, leg1 booked', async () => {
    await deliver(v1Swap.id, 'V1_APPROVED');

    expect(await statusOf(v1Swap.id)).toBe(SwapTransactionStatus.PROCESSING);
    const legs = await fundsOrders.findByParent({ swapTransactionId: v1Swap.id }, {});
    expect(legs).toHaveLength(1);
    expect(legs[0].legSeq).toBe(1);
    const actions = await auditActionsFor(v1Swap.id, AuditEntityTypes.SWAP_TRANSACTION);
    expect(actions).toContain(AuditActions.SWAP_KYT_APPROVED);
  });

  it('② awaiting user（下发认证）: REJECTED, zero legs, no restriction opened, material request issued (2026-09-14: soft line no longer stamps a 便签)', async () => {
    await deliver(v3aSwap.id, 'V2_AWAIT_USER');

    expect(await statusOf(v3aSwap.id)).toBe(SwapTransactionStatus.REJECTED);
    const legs = await fundsOrders.findByParent({ swapTransactionId: v3aSwap.id }, {});
    expect(legs).toHaveLength(0);

    // 2026-09-14 裁定：三域对同一套裁决按钮统一为"只有制裁·客户本人动
    // 人"——软线不再顺手开限制便签，open() 零调用。
    expect(await openScopes(customerId)).toEqual([]);

    // 2026-08-17 材料请求账：旧客户级单指针列已在 Task 12 随其专属 service 整体
    // 物理删除——软线暴露的事实现在只活在材料账里：该单上有几条活的材料请求、
    // externalActionId 是哪些。
    const live = await materialRequests.listLiveByOrder('SWAP', v3aSwap.swapNo);
    expect(live).toHaveLength(1);
    // 终审 Important #4：externalActionId 现铸（randomUUID），不再是固定字面量
    // 'demo-ext-1' —— 只断言"有值"，具体值不该也不能预测。
    expect(live[0].externalActionId).toBeTruthy();
    expect(live[0].status).toBe('PENDING_SUBMISSION');

    // 2026-09-14 收敛：软线不再顺手开便签，这一行材料请求不挂在任何限制便签
    // 下面——restrictionNo 恒为 null。
    expect(live[0].restrictionNo).toBeNull();

    const actions = await auditActionsFor(v3aSwap.id, AuditEntityTypes.SWAP_TRANSACTION);
    expect(actions).toContain(AuditActions.SWAP_KYT_REJECTED_DISPOSED);
  });

  it('② awaiting user（我方等同拒绝）: REJECTED, no restriction opened, material request issued (ext-3, 2026-09-14: soft line no longer stamps a 便签)', async () => {
    await deliver(v6Swap.id, 'V2_AWAIT_USER');

    expect(await statusOf(v6Swap.id)).toBe(SwapTransactionStatus.REJECTED);
    expect(await openScopes(customerId)).toEqual([]);

    // 同上一条 ②：软线暴露的事实只活在材料账里，旧单指针列已随 Task 12 物理删除。
    const live = await materialRequests.listLiveByOrder('SWAP', v6Swap.swapNo);
    expect(live).toHaveLength(1);
    // 终审 Important #4：externalActionId 现铸（randomUUID），不再是固定字面量
    // 'demo-ext-3' —— 只断言"有值"，具体值不该也不能预测。
    expect(live[0].externalActionId).toBeTruthy();
    expect(live[0].status).toBe('PENDING_SUBMISSION');
    // 2026-09-14 收敛：软线不再顺手开便签，restrictionNo 恒为 null。
    expect(live[0].restrictionNo).toBeNull();
  });

  it('⑪ rejected · no disposition tag: REJECTED, no material request issued, no sticky hard-line', async () => {
    await deliver(v2Swap.id, 'V11_REJECTED_NO_TAG');

    expect(await statusOf(v2Swap.id)).toBe(SwapTransactionStatus.REJECTED);
    // 硬线（无 action）：一条材料请求都不登记，客户端结构上没有入口（见
    // handleRejectDisposition 的硬线分支）。
    expect(await materialRequests.listLiveByOrder('SWAP', v2Swap.swapNo)).toHaveLength(0);

    const customer = await prisma.customerMain.findUnique({ where: { id: customerId }, select: { hardLineDispositionedAt: true } });
    expect(customer!.hardLineDispositionedAt).toBeNull(); // no-actions hard line is per-verdict, not sticky
  });

  it('⑦ rejected · Sanctions: FROZEN, sticky hard-line set, no material request issued (tipping-off)', async () => {
    // 2026-08-20 (Task 3)：本用例断言的是「客户本人命中制裁 → 硬线/sticky/静默」——
    // 这只在 SANCTION_APPLICANT 下成立。V4B_REJECTED_SANCTION_COUNTERPARTY
    // （对手方地址命中 OFAC）是 Task 2 批量拆按钮时按 deposit/withdraw 的语义
    // 判给这条用例的，但 deposit/withdraw 的 FROZEN 分支对 APPLICANT/COUNTERPARTY
    // 一视同仁（见 deposit-workflow.service.ts:765），swap 的 hasSanction 判定
    // 不是——只有本人命中才不给入口（对手方命中走普通软/硬线判定，见
    // swap-workflow.service.ts:872 与其配套单测「命门」组）。这条用例从设计
    // 起就是在证「本人命中」这条最危险的路径，改回 APPLICANT 才对得上断言。
    //
    // 2026-08-20（终审收口）：`V4B_REJECTED_SANCTION_COUNTERPARTY` 已不只是
    // "这条用例不用它"——业主裁定兑换没有第三方对手方，Sumsub 不会对 swap
    // 回传该标签，整个按钮已从 SWAP_VERDICT_BUTTONS 物理删除（充值/提现两个
    // fixture 保留，场景成立）。上面这段历史说明原样保留，只是它现在解释的
    // 是"从未存在过的键为何不会出现在这里"，而不是"存在但没被选中"。
    //
    // 2026-08-20（Task 9）：终态从 REJECTED 改成 FROZEN —— 迁移表里
    // COMPLIANCE_PENDING --FREEZE--> FROZEN 是本人命中制裁的唯一合法落点
    // （swap-workflow.service.ts 的 applyKytVerdict 尾部现在会在 hasSanction 时
    // 跳过 KYT_REJECTED，直接让 handleRejectDisposition 里的 FREEZE 分支落地）。
    // 下面其余断言（材料请求为空/sticky 硬线章/限制便签/能力封禁集合）与
    // FROZEN 无关，原样保留。
    await deliver(v4Swap.id, 'V7_REJECTED_SANCTION_APPLICANT');

    expect(await statusOf(v4Swap.id)).toBe(SwapTransactionStatus.FROZEN);
    // 制裁命中：同⑪，一条材料请求都不登记 —— 不给客户任何可探测的痕迹。
    expect(await materialRequests.listLiveByOrder('SWAP', v4Swap.swapNo)).toHaveLength(0);

    const customer = await prisma.customerMain.findUnique({ where: { id: customerId }, select: { hardLineDispositionedAt: true } });
    expect(customer!.hardLineDispositionedAt).toBeTruthy();

    // 2026-09-14 裁定：软线不再顺手开便签——前面 v3aSwap/v6Swap 的两条 ② 场景
    // 都没留下 KYT_REJECTED_SOFT 那张，这里只有制裁自己开的这一张 scope=ALL。
    const openRows = await restrictionsService.listOpen(customerId);
    expect(openRows.some((r) => r.cause === 'SANCTION' && r.scopes.includes('ALL'))).toBe(true);
    // 摁住的能力集就是这一张 scope=ALL 的便签本身，三样全禁。
    const access = await app.get(CustomerAccessService).resolve(customerId);
    expect([...access.blocked].sort()).toEqual(['DEPOSIT', 'SWAP', 'WITHDRAW']);
  });

  it('⑥ on hold（我方等同拒绝）: REJECTED, no material request issued', async () => {
    await deliver(v5Swap.id, 'V6_ONHOLD');

    expect(await statusOf(v5Swap.id)).toBe(SwapTransactionStatus.REJECTED);
    expect(await materialRequests.listLiveByOrder('SWAP', v5Swap.swapNo)).toHaveLength(0);
  });

  it('sticky hard-line silences a later, otherwise-soft-line verdict（V7 制裁后送达的 V2：单已被客户级冻结广播冻住,裁决被幂等闸吞,沉默依旧零材料请求）', async () => {
    // v3bSwap was CREATED before the sanction (customer was unrestricted at
    // the time) but the verdict is delivered here, after V7 already stamped
    // hardLineDispositionedAt — Review Fix 2's cross-order persistence: this
    // verdict alone has an attached action (would normally expose ext-1
    // again) but must stay silenced because the customer was sanctioned by a
    // DIFFERENT swap in between.
    await deliver(v3bSwap.id, 'V2_AWAIT_USER');

    // 2026-08-20 制裁分主体批之后的现行裁定（业主 2026-08-27 复述确认：人冻了，
    // 他的在途单全冻）：v4 的制裁开出客户限制那一刻，广播就把当时还在
    // COMPLIANCE_PENDING 的 v3b 一并冻成 FROZEN；随后这份迟到的软线裁决撞上
    // FROZEN 幂等闸被 IGNORE。持久沉默的性质不变——零材料请求（本用例的本体断言）。
    expect(await statusOf(v3bSwap.id)).toBe(SwapTransactionStatus.FROZEN);
    expect(await materialRequests.listLiveByOrder('SWAP', v3bSwap.swapNo)).toHaveLength(0);
  });
});
