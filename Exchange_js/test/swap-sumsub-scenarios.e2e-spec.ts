import * as path from 'path';
import * as dotenv from 'dotenv';

// Same Node 18 polyfill as src/main.ts (@nestjs/schedule needs globalThis.crypto,
// stable only in Node 19+) — main.ts isn't loaded in this e2e harness, so it has
// to be repeated here before AppModule (and therefore ScheduleModule) is imported.
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

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
import { SUMSUB_TXN_CLIENT } from '../src/modules/deposit-sumsub/sumsub-txn-client.interface';
import { MockSumsubTxnClient } from '../src/modules/deposit-sumsub/sumsub-txn-client.mock';
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
 *   first rejection lands (V7's "restored capability" check aside, which
 *   intentionally creates its own swap live, after clearing restrictions).
 *   Delivery ORDER (not creation order) is what makes the restriction/
 *   sticky-hard-line state machine exercised below meaningful — see each
 *   `it()`'s comment for why it must run where it does.
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
  let v3aSwap: any; // soft-line, cleared by V7
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
    await ensureCustomerWallet({ assetId: aedAssetId, walletRole: 'C_VIBAN', type: 'FIAT_BANK', iban: `AE_SWAP_SCN_${customerNo}` });
    await ensureCustomerWallet({ assetId: usdtAssetId, walletRole: 'C_DEP', type: 'CRYPTO_ADDRESS', address: `T_SWAP_SCN_${customerNo}` });

    // Trading-start precondition gate (assertTradingReady): needs ≥1 ACTIVE
    // BANK withdrawal address on file for SWAP/WITHDRAW eligibility to even
    // reach the restrictions check this suite exercises.
    await ensureWithdrawalAddress({
      assetId: aedAssetId, addressType: 'BANK', network: 'FIAT',
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
        addressNo: `WAD-E2E-SWAPSCN-${opts.addressType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        customerId, customerNo, assetId: opts.assetId, network: opts.network,
        address: opts.address, addressType: opts.addressType, iban: opts.iban ?? null,
        ownershipDeclaredAt: new Date(), ownershipProofType: 'E2E_FIXTURE',
        status: 'ACTIVE', activatesAt: new Date(Date.now() - 1000),
        traceId: 'e2e-swap-sumsub-scenarios-address',
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
    const rows = await (prisma as any).auditLogEvent.findMany({
      where: { entityId, entityType },
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

  it('③ rejected · 软线（下发认证）: REJECTED, zero legs, restrictions SWAP+WITHDRAW, material request issued with restrictionNo attached', async () => {
    await deliver(v3aSwap.id, 'V3_REJECTED_ACTION');

    expect(await statusOf(v3aSwap.id)).toBe(SwapTransactionStatus.REJECTED);
    const legs = await fundsOrders.findByParent({ swapTransactionId: v3aSwap.id }, {});
    expect(legs).toHaveLength(0);

    expect(await openScopes(customerId)).toEqual(['SWAP', 'WITHDRAW']);

    // 2026-08-17 材料请求账：旧客户级单指针列已在 Task 12 随其专属 service 整体
    // 物理删除——软线暴露的事实现在只活在材料账里：该单上有几条活的材料请求、
    // externalActionId 是哪些。
    const live = await materialRequests.listLiveByOrder('SWAP', v3aSwap.swapNo);
    expect(live).toHaveLength(1);
    // 终审 Important #4：externalActionId 现铸（randomUUID），不再是固定字面量
    // 'demo-ext-1' —— 只断言"有值"，具体值不该也不能预测。
    expect(live[0].externalActionId).toBeTruthy();
    expect(live[0].status).toBe('PENDING_SUBMISSION');

    // 2026-08-18 修复验收（本次要修的 Critical）：register() 之前没有任何字段
    // 能把 open() 刚开好的便签接进这一行，restrictionNo 恒为 null，GREEN 复核
    // 时 autoRelease 永远读不到便签——客户交齐材料后限制原地不动、永久卡死。
    // 这里直接断言非 null，并且与刚才 open() 出来的那张便签是同一张（不是另开
    // 的第二张）。
    expect(live[0].restrictionNo).not.toBeNull();
    const openRows = await restrictionsService.listOpen(customerId);
    const softRestriction = openRows.find((r) => r.cause === 'KYT_REJECTED_SOFT' && r.caseRef === v3aSwap.swapNo);
    expect(softRestriction).toBeDefined();
    expect(live[0].restrictionNo).toBe(softRestriction!.restrictionNo);

    const actions = await auditActionsFor(v3aSwap.id, AuditEntityTypes.SWAP_TRANSACTION);
    expect(actions).toContain(AuditActions.SWAP_KYT_REJECTED_DISPOSED);
  });

  it('⑦ 认证通过（清限制）: restrictions cleared, material request approved, swap capability restored', async () => {
    // 真实客户流程：交材料（客户端 POST .../submit → markSubmitted）发生在
    // Sumsub 复核之前——V7 按钮只模拟"Sumsub 把复核结果推回来"这一步，不模拟
    // 客户在 WebSDK 里交材料的动作。这里替客户走一次提交，真实地把这行材料
    // 请求推到 SUBMITTED，否则 applyReview 会因为这一行还停在
    // PENDING_SUBMISSION 而抛 BadRequestException（真实客户不可能在没交材料
    // 的情况下先收到复核结果，这一步不能省）。
    const live = await materialRequests.listLiveByOrder('SWAP', v3aSwap.swapNo);
    expect(live).toHaveLength(1);
    await materialRequests.markSubmitted(live[0].requestNo, {
      actorType: 'CUSTOMER', actorId: customerId, actorRole: 'CUSTOMER',
    });

    await deliver(v3aSwap.id, 'V7_ACTION_GREEN');

    // 2026-08-18 修复验收：GREEN 落地后 autoRelease 真的读到了 existingRestrictionNo
    // 接进来的那个 restrictionNo，便签被真正撕掉——此前 register() 没有任何字段
    // 能把 open() 已经开好的便签接进材料请求行，restrictionNo 恒为 null，这条
    // 断言此前恒红（客户交齐材料、GREEN 到，限制原地不动、永久卡死，即本次要修
    // 的 Critical）。
    expect(await openScopes(customerId)).toEqual([]);

    const row = await materialRequests.findByNo(live[0].requestNo);
    expect(row?.status).toBe('APPROVED');
    expect(row?.reviewAnswer).toBe('GREEN');

    // SWAP_ACTION_CLEARED 是 Task 10 之前的旧写法留下的死常量——撕便签的落点
    // 已经统一搬到 CustomerRestrictionWorkflowService
    // .autoRelease()，它写的是 CUSTOMER_RESTRICTION_CLEARED，不是
    // SWAP_ACTION_CLEARED（全仓已无任何写入方）。
    const customerAudit = await auditActionsFor(customerId, AuditEntityTypes.CUSTOMER);
    expect(customerAudit).toContain(AuditActions.CUSTOMER_RESTRICTION_CLEARED);

    // Capability genuinely restored — a brand new swap can be initiated now.
    const restoredSwap = await createSwap('20');
    expect(restoredSwap.status).toBe(SwapTransactionStatus.COMPLIANCE_PENDING);
  });

  it('⑥ awaiting user（我方等同拒绝）: REJECTED, restrictions re-added, material request issued (ext-3) with restrictionNo attached', async () => {
    await deliver(v6Swap.id, 'V6_AWAIT_USER');

    expect(await statusOf(v6Swap.id)).toBe(SwapTransactionStatus.REJECTED);
    expect(await openScopes(customerId)).toEqual(['SWAP', 'WITHDRAW']);

    // 同③：软线暴露的事实只活在材料账里，旧单指针列已随 Task 12 物理删除。
    const live = await materialRequests.listLiveByOrder('SWAP', v6Swap.swapNo);
    expect(live).toHaveLength(1);
    // 终审 Important #4：externalActionId 现铸（randomUUID），不再是固定字面量
    // 'demo-ext-3' —— 只断言"有值"，具体值不该也不能预测。
    expect(live[0].externalActionId).toBeTruthy();
    expect(live[0].status).toBe('PENDING_SUBMISSION');
    expect(live[0].restrictionNo).not.toBeNull();
  });

  it('⑧ 认证不通过（升级）: restrictions remain, material request rejected, no auto-release', async () => {
    // 同⑦：先替客户走一次提交，让 RED 复核真的落得到地。
    const live = await materialRequests.listLiveByOrder('SWAP', v6Swap.swapNo);
    expect(live).toHaveLength(1);
    await materialRequests.markSubmitted(live[0].requestNo, {
      actorType: 'CUSTOMER', actorId: customerId, actorRole: 'CUSTOMER',
    });

    await deliver(v6Swap.id, 'V8_ACTION_RED');

    // RED（FINAL）不撕便签——MaterialRequestReviewService.applyReview 只在
    // outcome==='APPROVED' 才调 autoRelease，REJECTED 原地不动。
    expect(await openScopes(customerId)).toEqual(['SWAP', 'WITHDRAW']);

    const row = await materialRequests.findByNo(live[0].requestNo);
    expect(row?.status).toBe('REJECTED');
    expect(row?.reviewAnswer).toBe('RED');
    expect(row?.reviewRejectType).toBe('FINAL');

    // SWAP_ACTION_ESCALATED 同⑦：Task 10 之前的旧写法留下的死常量，全仓已无
    // 任何写入方——真实的裁决痕迹落在材料请求自己的审计上
    // （MATERIAL_REQUEST_REJECTED）。
    const requestAudit = await materialRequestAuditActionsFor(live[0].requestNo);
    expect(requestAudit).toContain(AuditActions.MATERIAL_REQUEST_REJECTED);
  });

  it('② rejected · 硬线（无 action）: REJECTED, no material request issued, no sticky hard-line', async () => {
    await deliver(v2Swap.id, 'V2_REJECTED_HARD');

    expect(await statusOf(v2Swap.id)).toBe(SwapTransactionStatus.REJECTED);
    // 硬线（无 action）：一条材料请求都不登记，客户端结构上没有入口（见
    // handleRejectDisposition 的硬线分支）。
    expect(await materialRequests.listLiveByOrder('SWAP', v2Swap.swapNo)).toHaveLength(0);

    const customer = await prisma.customerMain.findUnique({ where: { id: customerId }, select: { hardLineDispositionedAt: true } });
    expect(customer!.hardLineDispositionedAt).toBeNull(); // no-actions hard line is per-verdict, not sticky
  });

  it('④ rejected · Sanctions: FROZEN, sticky hard-line set, no material request issued (tipping-off)', async () => {
    // 2026-08-20 (Task 3)：本用例断言的是「客户本人命中制裁 → 硬线/sticky/静默」——
    // 这只在 SANCTION_APPLICANT 下成立。V4B_REJECTED_SANCTION_COUNTERPARTY
    // （对手方地址命中 OFAC）是 Task 2 批量拆按钮时按 deposit/withdraw 的语义
    // 判给这条用例的，但 deposit/withdraw 的 FROZEN 分支对 APPLICANT/COUNTERPARTY
    // 一视同仁（见 deposit-workflow.service.ts:765），swap 的 hasSanction 判定
    // 不是——只有本人命中才不给入口（对手方命中走普通软/硬线判定，见
    // swap-workflow.service.ts:872 与其配套单测「命门」组）。这条用例从设计
    // 起就是在证「本人命中」这条最危险的路径，改回 APPLICANT 才对得上断言。
    //
    // 2026-08-20（Task 9）：终态从 REJECTED 改成 FROZEN —— 迁移表里
    // COMPLIANCE_PENDING --FREEZE--> FROZEN 是本人命中制裁的唯一合法落点
    // （swap-workflow.service.ts 的 applyKytVerdict 尾部现在会在 hasSanction 时
    // 跳过 KYT_REJECTED，直接让 handleRejectDisposition 里的 FREEZE 分支落地）。
    // 下面其余断言（材料请求为空/sticky 硬线章/限制便签/能力封禁集合）与
    // FROZEN 无关，原样保留。
    await deliver(v4Swap.id, 'V4_REJECTED_SANCTION_APPLICANT');

    expect(await statusOf(v4Swap.id)).toBe(SwapTransactionStatus.FROZEN);
    // 制裁命中：同②，一条材料请求都不登记 —— 不给客户任何可探测的痕迹。
    expect(await materialRequests.listLiveByOrder('SWAP', v4Swap.swapNo)).toHaveLength(0);

    const customer = await prisma.customerMain.findUnique({ where: { id: customerId }, select: { hardLineDispositionedAt: true } });
    expect(customer!.hardLineDispositionedAt).toBeTruthy();

    // 三轴收敛前这里断言的是 ['SWAP','WITHDRAW'] —— 那是单列 restrictions 的语义：
    // 制裁裁决到来会把前面软线留下的那份**覆盖**掉，客户身上永远只有一份限制。
    // 限制账是一因一张、互不覆盖，所以这单制裁落下来之后，本 suite 前序用例
    // （③/⑥/⑧）留下的软线便签仍然在，制裁自己另起一张 scope=ALL。
    // 这正是这次改造要的行为，断言随之改成「制裁那张在 + 前序那些没被抹掉」。
    const openRows = await restrictionsService.listOpen(customerId);
    expect(openRows.some((r) => r.cause === 'SANCTION' && r.scopes.includes('ALL'))).toBe(true);
    expect(openRows.some((r) => r.cause === 'KYT_REJECTED_SOFT')).toBe(true);
    // 摁住的能力集是所有 OPEN 便签的并集，制裁的 ALL 让三样全禁。
    const access = await app.get(CustomerAccessService).resolve(customerId);
    expect([...access.blocked].sort()).toEqual(['DEPOSIT', 'SWAP', 'WITHDRAW']);
  });

  it('⑤ on hold（我方等同拒绝）: REJECTED, no material request issued', async () => {
    await deliver(v5Swap.id, 'V5_ONHOLD');

    expect(await statusOf(v5Swap.id)).toBe(SwapTransactionStatus.REJECTED);
    expect(await materialRequests.listLiveByOrder('SWAP', v5Swap.swapNo)).toHaveLength(0);
  });

  it('sticky hard-line silences a later, otherwise-soft-line verdict (V3 delivered after the V4 sanction)', async () => {
    // v3bSwap was CREATED before the sanction (customer was unrestricted at
    // the time) but the verdict is delivered here, after V4 already stamped
    // hardLineDispositionedAt — Review Fix 2's cross-order persistence: this
    // verdict alone has an attached action (would normally expose ext-1
    // again) but must stay silenced because the customer was sanctioned by a
    // DIFFERENT swap in between.
    await deliver(v3bSwap.id, 'V3_REJECTED_ACTION');

    expect(await statusOf(v3bSwap.id)).toBe(SwapTransactionStatus.REJECTED);
    // exposeToCustomer=false（alreadyHardLined）→ 材料请求登记循环整段跳过，
    // 即便这次裁决本身带着 action 也不登记 —— 这正是本用例要证明的持久沉默。
    expect(await materialRequests.listLiveByOrder('SWAP', v3bSwap.swapNo)).toHaveLength(0);
  });
});
