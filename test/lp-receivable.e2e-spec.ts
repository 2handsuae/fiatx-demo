import * as path from 'path';
import * as dotenv from 'dotenv';

// Same Node 18 polyfill as src/main.ts (@nestjs/schedule needs globalThis.crypto,
// stable only in Node 19+) — main.ts isn't loaded in this e2e harness, so it has
// to be repeated here before AppModule (and therefore ScheduleModule) is imported.
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

// Loaded before any other import so PrismaService / TigerBeetleService see the
// worktree's own DATABASE_URL / TB_ADDRESS regardless of ConfigModule's internal
// load timing (mirrors recon-internal-transfer.e2e-spec.ts).
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TbAdminController } from '../src/modules/accounting/tigerbeetle/tb-admin.controller';
import { TB_ACCOUNT_CODES, isDebitNormalCode } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';
import { ApprovalsService } from '../src/modules/governance/approvals/approvals.service';
import { ApprovalActorContext } from '../src/modules/governance/approvals/constants/approval.constants';
import { SystemWalletResolver } from '../src/modules/funds-layer/domain/system-wallet-resolver.service';
import { FundsOrderService } from '../src/modules/funds-orders/funds-order.service';
import { FundsOrderAction } from '../src/modules/funds-orders/dto/funds-order.dto';
import { LpExchangeWorkflowService } from '../src/modules/asset-treasury/lp-desk/lp-exchange-workflow.service';
import { LpReceivableAccountService } from '../src/modules/asset-treasury/lp-desk/lp-receivable-account.service';
import { LpExchangeStatus } from '../src/modules/asset-treasury/lp-desk/dto/lp-exchange.dto';
import { generateReferenceNo } from '../src/common/utils/no-generator.util';

/**
 * 戊波二 · 应收 LP e2e（spec §8.6 / 裁定 20）：真 AppModule 零 mock，夹具用 prisma 直造一个 ACTIVE 的 LP 档案 + 一条 ACTIVE 的 AED 打款地址，
 * 再调 `LpReceivableAccountService.ensureForLp`（同「夹具直造钱包要调 ensureForWallet」的规矩——私库种子停在 LP 台之前，仓库没有现成 LP 夹具）。
 * 兑换单走真实服务入口：initiate → ApprovalsService.approve（CFO）→ 卖出腿 SUBMIT / CONFIRM（⚡ 模拟推进走的同一个 FundsOrderService.advance，
 * 事件触发 workflow 落 84 + 88）→ simulateDelivery（85 贷 51）→ accept（86）。
 * 金额 50,000 AED → 13,600 USDT，与种子 Falcon 历史单同量；断言全部取自 TigerBeetle 账户余额的前后差，不读自己写的 mock。
 * 运营户（F_OPS）不额外充值：自栈种子已给它备好 AED，余额不够会在 initiate 的余额闸当场红，不用捷径绕。
 */
describe('LP receivable e2e (戊波二, 应收 LP)', () => {
  jest.setTimeout(120000);
  let app: INestApplication; let prisma: PrismaService;
  let accounting: AccountingService; let approvals: ApprovalsService; let wf: LpExchangeWorkflowService;
  let fundsOrders: FundsOrderService; let systemWallets: SystemWalletResolver; let receivables: LpReceivableAccountService;
  let tbAdmin: TbAdminController;

  const treasury = makeActor('E2E_LPR_TREASURY', 'TREASURY_OFFICER');
  const cfo = makeActor('E2E_LPR_CFO', 'CFO');

  let aed: any; let usdt: any;
  let lp: any; let payoutAddress: any;
  let receivableUsdtId: bigint; let receivableAedId: bigint;
  let equityAedId: bigint; let equityUsdtId: bigint;
  let opsAedCashId: bigint; let liqUsdtCashId: bigint; let opsUsdtCashId: bigint;
  /** 各账户在 initiate 之前的 posted 净余额（按账户类别取正：借方户 = 借 − 贷，贷方户 = 贷 − 借）。 */
  const before: Record<string, bigint> = {};
  let exchangeNo: string;

  const SELL_AED = '50000'; const BUY_USDT = '13600';
  const SELL_AED_MINOR = 5_000_000n; // 50,000.00 AED（2 位小数）
  const BUY_USDT_MINOR = 13_600_000_000n; // 13,600.000000 USDT（6 位小数）

  function makeActor(userNo: string, role: string): ApprovalActorContext {
    return { actorType: 'ADMIN', userId: `uuid-${userNo}`, userNo, role, roleCodes: [role] };
  }

  async function waitUntil(predicate: () => Promise<boolean>, what: string, timeoutMs = 30000, intervalMs = 50): Promise<void> {
    const start = Date.now();
    for (;;) {
      if (await predicate()) return;
      if (Date.now() - start > timeoutMs) throw new Error(`waitUntil: ${what} not met within ${timeoutMs}ms`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  /** posted 净余额，按科目码的借贷性质取正（与注册表列表 / verify:coa 同口径）。 */
  async function posted(accountId: bigint, code: number): Promise<bigint> {
    const b = await accounting.lookupBalance(accountId);
    return isDebitNormalCode(code) ? b.debitsPosted - b.creditsPosted : b.creditsPosted - b.debitsPosted;
  }

  async function snapshot(): Promise<Record<string, bigint>> {
    return {
      receivableUsdt: await posted(receivableUsdtId, TB_ACCOUNT_CODES.LP_RECEIVABLE),
      receivableAed: await posted(receivableAedId, TB_ACCOUNT_CODES.LP_RECEIVABLE),
      equityAed: await posted(equityAedId, TB_ACCOUNT_CODES.FIRM_EQUITY),
      equityUsdt: await posted(equityUsdtId, TB_ACCOUNT_CODES.FIRM_EQUITY),
      opsAed: await posted(opsAedCashId, TB_ACCOUNT_CODES.FIRM_CASH),
      liqUsdt: await posted(liqUsdtCashId, TB_ACCOUNT_CODES.FIRM_CASH),
      opsUsdt: await posted(opsUsdtCashId, TB_ACCOUNT_CODES.FIRM_CASH),
    };
  }

  const exchangeEvents = async () => (await (prisma as any).tbTransferEvidence.findMany({ where: { sourceType: 'LP_EXCHANGE', sourceNo: exchangeNo } }))
    .map((e: any) => `${e.eventCode}:${e.debitCode}>${e.creditCode}`).sort();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(0);
    await app.init();
    prisma = app.get(PrismaService); accounting = app.get(AccountingService); approvals = app.get(ApprovalsService);
    wf = app.get(LpExchangeWorkflowService); fundsOrders = app.get(FundsOrderService); systemWallets = app.get(SystemWalletResolver);
    receivables = app.get(LpReceivableAccountService); tbAdmin = app.get(TbAdminController);

    aed = await (prisma as any).asset.findFirst({ where: { currency: 'AED' } });
    usdt = await (prisma as any).asset.findFirst({ where: { currency: 'USDT' } });
    if (!aed?.tbLedgerId || !usdt?.tbLedgerId) throw new Error('Fixture assets AED/USDT not seeded — run `bash scripts/stack.sh reset self` first.');

    // ── 夹具：一个全新的 ACTIVE LP 档案 + 一条 ACTIVE 的 AED 打款地址（卖出 AED，法币坐标 = IBAN）──
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    lp = await (prisma as any).liquidityProvider.create({
      data: {
        lpNo: generateReferenceNo('LPP'), name: `E2E Receivable LP ${suffix}`,
        registeredIn: 'United Arab Emirates', registrationNo: `E2E-REG-${suffix}`, licensingAuthority: 'E2E Authority', licenceNo: `E2E-LIC-${suffix}`,
        tradingTypes: 'FX_SPOT', expectedMonthlyVolume: '1000000', volumeCurrency: 'AED',
        applicationReason: 'e2e fixture for the receivable ledger', agreementRef: `E2E-AGR-${suffix}`,
        contactName: 'E2E Contact', contactEmail: `e2e-${suffix.toLowerCase()}@example.com`,
        status: 'ACTIVE', createdByUserId: 'E2E_LPR_TREASURY',
      },
    });
    payoutAddress = await (prisma as any).lpPayoutAddress.create({
      data: {
        addressNo: generateReferenceNo('LPA'), lpId: lp.id, lpNo: lp.lpNo, assetId: aed.id,
        iban: `AE00E2E${suffix}000000000`, bankName: 'E2E Bank', evidenceRef: `E2E-LPA-${suffix}`, label: 'E2E AED settlement account',
        screeningAnswer: 'GREEN', screenedAt: new Date(), status: 'ACTIVE', traceId: `E2E_LPR_${suffix}`,
      },
    });
    await receivables.ensureForLp(lp.id);

    // ── 账户（全部走生产解析入口）──
    const [opsAed, liqUsdt, opsUsdt] = await Promise.all([
      systemWallets.resolve(aed.id, 'F_OPS'), systemWallets.resolve(usdt.id, 'F_LIQ'), systemWallets.resolve(usdt.id, 'F_OPS'),
    ]);
    const lpAccount = (ledger: number) => accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.LP_RECEIVABLE, ledger, ownerType: 'LP', ownerUuid: lp.id });
    const equity = (ledger: number) => accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FIRM_EQUITY, ledger, ownerType: 'SYSTEM' });
    receivableUsdtId = await lpAccount(TB_LEDGERS.USDT); receivableAedId = await lpAccount(TB_LEDGERS.AED);
    equityAedId = await equity(TB_LEDGERS.AED); equityUsdtId = await equity(TB_LEDGERS.USDT);
    opsAedCashId = await accounting.resolveCashAccountId(opsAed.id, TB_LEDGERS.AED);
    liqUsdtCashId = await accounting.resolveCashAccountId(liqUsdt.id, TB_LEDGERS.USDT);
    opsUsdtCashId = await accounting.resolveCashAccountId(opsUsdt.id, TB_LEDGERS.USDT);
    Object.assign(before, await snapshot());
  });
  afterAll(async () => { if (app) await app.close(); });

  it('fixture: ensureForLp opened one code-51 account per ledger (AED + USDT) for the fixture LP, both at zero', async () => {
    const rows = await (prisma as any).tbAccountRegistry.findMany({ where: { code: TB_ACCOUNT_CODES.LP_RECEIVABLE, ownerType: 'LP', ownerUuid: lp.id } });
    expect(rows.map((r: any) => r.ledger).sort()).toEqual([TB_LEDGERS.AED, TB_LEDGERS.USDT].sort());
    expect(rows.every((r: any) => r.ownerNo === lp.lpNo)).toBe(true);
    expect(before.receivableUsdt).toBe(0n);
    expect(before.receivableAed).toBe(0n);
  });

  it('CFO approval + sell leg confirmed: 84 pays out 50,000 AED, 88 books 13,600 USDT receivable on 51·this LP (200 USDT +13,600, 200 AED −50,000)', async () => {
    const opened = await wf.initiate({
      lpNo: lp.lpNo, sellAssetId: aed.id, sellAmount: SELL_AED, buyAssetId: usdt.id, buyAmount: BUY_USDT,
      payoutAddressNo: payoutAddress.addressNo, prudentialPurpose: 'Liquidity management', reason: 'e2e: receivable ledger arc',
    }, treasury);
    exchangeNo = opened.exchangeNo;
    // 批准之前不记账：51 仍为 0
    expect((await snapshot()).receivableUsdt).toBe(before.receivableUsdt);

    await approvals.approve(opened.approvalNo, { reason: 'e2e CFO approves the LP exchange' }, cfo);
    await waitUntil(async () => (await (prisma as any).lpExchange.findUnique({ where: { exchangeNo } })).status === LpExchangeStatus.EXECUTING, 'exchange EXECUTING');

    // 卖出腿：⚡模拟推进 = FundsOrderService.advance（SUBMIT 写托管回单，CONFIRM 触发 84 + 88）
    const row = await (prisma as any).lpExchange.findUnique({ where: { exchangeNo } });
    const [sellLeg] = await fundsOrders.findByParent({ lpExchangeId: row.id }, { legSeq: 1 });
    await fundsOrders.advance(sellLeg.id, FundsOrderAction.SUBMIT, 'E2E_LPR');
    await fundsOrders.advance(sellLeg.id, FundsOrderAction.CONFIRM, 'E2E_LPR');
    await waitUntil(async () => (await (prisma as any).lpExchange.findUnique({ where: { exchangeNo } })).status === LpExchangeStatus.AWAITING_DELIVERY, 'exchange AWAITING_DELIVERY');

    const after = await snapshot();
    expect(after.receivableUsdt - before.receivableUsdt).toBe(BUY_USDT_MINOR); // 51·该 LP USDT = 13,600
    expect(after.receivableUsdt).toBe(BUY_USDT_MINOR);
    expect(after.equityUsdt - before.equityUsdt).toBe(BUY_USDT_MINOR); // 200 USDT +13,600（88 的贷方）
    expect(after.equityAed - before.equityAed).toBe(-SELL_AED_MINOR); // 200 AED −50,000（84 的借方，权益减少）
    expect(after.opsAed - before.opsAed).toBe(-SELL_AED_MINOR); // 运营户 AED 付出 50,000
    expect(after.receivableAed).toBe(0n); // AED 那一户不动
    expect(after.liqUsdt).toBe(before.liqUsdt); // 货还没到，前厅不动
    expect(await exchangeEvents()).toEqual([
      'LP_EXCHANGE_PAY:E.FIRM_EQUITY>A.FIRM_CASH',
      'LP_EXCHANGE_RECEIVABLE:A.LP_RECEIVABLE>E.FIRM_EQUITY',
    ]);
  });

  it('LP delivers: 85 credits 51 instead of equity — receivable back to 0, F_LIQ USDT +13,600, 200 USDT stays at +13,600', async () => {
    const delivered = await wf.simulateDelivery(exchangeNo, treasury);
    expect(delivered.status).toBe('DELIVERED');

    const after = await snapshot();
    expect(after.receivableUsdt).toBe(0n); // 交货消应收
    expect(after.liqUsdt - before.liqUsdt).toBe(BUY_USDT_MINOR); // 前厅 +13,600
    expect(after.equityUsdt - before.equityUsdt).toBe(BUY_USDT_MINOR); // 85 不再碰权益：200 USDT 仍是 88 留下的 +13,600
    expect(await exchangeEvents()).toEqual([
      'LP_EXCHANGE_PAY:E.FIRM_EQUITY>A.FIRM_CASH',
      'LP_EXCHANGE_RECEIVABLE:A.LP_RECEIVABLE>E.FIRM_EQUITY',
      'LP_EXCHANGE_RECEIVE:A.FIRM_CASH>A.LP_RECEIVABLE',
    ]);
  });

  it('acceptance (86): F_LIQ → F_OPS, operating USDT +13,600, front desk back to where it started, 51 still 0', async () => {
    const accepted = await wf.accept(exchangeNo, treasury);
    expect(accepted.status).toBe('SUCCESS');

    const after = await snapshot();
    expect(after.opsUsdt - before.opsUsdt).toBe(BUY_USDT_MINOR);
    expect(after.liqUsdt).toBe(before.liqUsdt);
    expect(after.receivableUsdt).toBe(0n);
    expect(await exchangeEvents()).toHaveLength(4);
  });

  it('GET /admin/tb/accounts?ownerType=LP&code=51 returns this LP\'s two rows with ownerName = the LP name (and balance 0 after delivery)', async () => {
    // 与路由同入口：控制器的 query 映射 → TbAccountRegistryService.findAll
    const { items, total } = await tbAdmin.findAccounts('0', '100', undefined, 'LP', String(TB_ACCOUNT_CODES.LP_RECEIVABLE));
    expect(total).toBeGreaterThanOrEqual(2);
    expect(items.every((r: any) => r.ownerType === 'LP' && r.code === TB_ACCOUNT_CODES.LP_RECEIVABLE)).toBe(true);
    const mine = items.filter((r: any) => r.ownerUuid === lp.id);
    expect(mine).toHaveLength(2);
    expect(mine.map((r: any) => r.ownerName)).toEqual([lp.name, lp.name]);
    expect(mine.map((r: any) => r.assetCode).sort()).toEqual(['AED', 'USDT']);
    expect(mine.map((r: any) => r.balance)).toEqual(['0', '0']);
    // 其它 LP（种子的 Falcon / Dune）同样带上自己的名字
    const named = items.filter((r: any) => r.ownerUuid !== lp.id);
    expect(named.length).toBeGreaterThan(0);
    expect(named.every((r: any) => typeof r.ownerName === 'string' && r.ownerName.length > 0)).toBe(true);
  });
});
