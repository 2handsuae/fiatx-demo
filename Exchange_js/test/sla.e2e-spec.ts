import { resolveE2eDatabaseUrl } from './e2e-db';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Node 18 polyfill：@nestjs/schedule 需要 globalThis.crypto（Node 19+ 才稳定），
// 本 harness 不加载 src/main.ts，所以要在 AppModule 之前自己补。
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

// 必须在任何读 DATABASE_URL 的 import 之前执行。
process.env.DATABASE_URL = resolveE2eDatabaseUrl('e2e-sla.db');
process.env.SUMSUB_MOCK_MODE = 'true';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// ── 破坏性护栏（2026-07-31 起，因为真的炸过两次）────────────────────────
if (!process.env.DATABASE_URL?.includes('e2e-')) {
  throw new Error(
    `[sla e2e] 拒绝运行：本 suite 会写入交易表，但 DATABASE_URL 当前指向 ` +
      `${process.env.DATABASE_URL} —— 这看起来是常驻栈的验收库。`,
  );
}

import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { SUMSUB_TXN_CLIENT } from '../src/modules/sumsub-shared/sumsub-txn-client.interface';
import { MockSumsubTxnClient } from '../src/modules/sumsub-shared/sumsub-txn-client.mock';
import { DepositWorkflowService } from '../src/modules/trading/deposit-transactions/deposit-workflow.service';
import { DepositTransactionsService } from '../src/modules/trading/deposit-transactions/deposit-transactions.service';
import { WithdrawTransactionsService } from '../src/modules/trading/withdraw-transactions/withdraw-transactions.service';
import { SwapTransactionsService } from '../src/modules/trading/swap-transactions/swap-transactions.service';
import { DepositSlaService } from '../src/modules/deposit-sumsub/deposit-sla.service';
import { WithdrawSlaService } from '../src/modules/withdraw-sumsub/withdraw-sla.service';
import { SwapSlaService } from '../src/modules/swap-sumsub/swap-sla.service';
import { DepositTransactionStatus } from '../src/modules/trading/deposit-transactions/dto/deposit-transaction.dto';
import { WithdrawTransactionStatus } from '../src/modules/trading/withdraw-transactions/dto/withdraw-transaction.dto';
import { SwapTransactionStatus } from '../src/modules/trading/swap-transactions/dto/swap-transaction.dto';
import { buildDeterministicNo, generateReferenceNo } from '../src/common/utils/no-generator.util';

/**
 * Task 9：第三批「三域 SLA」e2e 验收。
 *
 * 覆盖范围（Task 1-8 的产出，逐条见各 it() 前的注释）：
 *   ① 三域进入 COMPLIANCE_PENDING 起 5 分钟硬计时
 *   ② 充值硬 SLA 破线 → MANUAL_CHECKING，且落地时起一个新的软计时器
 *   ③ 充值软 SLA 破线（MANUAL_CHECKING）→ 只标记，状态不动
 *   ④ 兑换硬 SLA 破线 → REJECTED（兑换没有软 SLA）
 *   ⑤ FROZEN 单永不破线（两层：进入时 deadline 清空 + 扫描器不碰它）
 *   ⑥ onHold 回调不影响计时（本批修的核心 bug：此前挂在 onHold 上导致
 *      「没收到 onHold 的单永远不计时」）
 *   ⑦ 提现硬 SLA 破线 → MANUAL_CHECKING（②的镜像；withdrawSlaService 此前
 *      注入了却从未被任何用例调用过，这条路径之前完全没有 e2e 覆盖）
 *
 * harness：真 AppModule，只 mock SUMSUB_TXN_CLIENT（不打真实 api.sumsub.com）。
 * fixture 直接现建现落在目标状态（不经 initiate 网关），SLA 字段用各域
 * *真正*的 resolveSlaFields()/config 表算出来 —— 不是测试自己手抄一份 5 分钟
 * 常量，抄错了测试也会跟着错，看不出生产代码的偏差。fixture 客户全部现建现删
 * （前缀 e2e_sla_），不碰 9 个 demo 客户。
 */
describe('第三批 · 三域 SLA (e2e)', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let prisma: PrismaService;
  let depositWorkflow: DepositWorkflowService;
  let depositService: DepositTransactionsService;
  let withdrawService: WithdrawTransactionsService;
  let swapService: SwapTransactionsService;
  let depositSlaService: DepositSlaService;
  let withdrawSlaService: WithdrawSlaService;
  let swapSlaService: SwapSlaService;

  let fiatAssetId: string;
  let cryptoAssetId: string;

  const EMAIL_PREFIX = 'e2e_sla_';
  let seq = 0;
  let fixtureSeq = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SUMSUB_TXN_CLIENT)
      .useClass(MockSumsubTxnClient)
      .compile();
    app = moduleRef.createNestApplication();
    // 见 kyt-verdict-landing.e2e-spec.ts 的同款注释：AppModule 挂了大量共享事件名的
    // @OnEvent handler，超过 EventEmitter2 默认 maxListeners=10 时，这套 Jest/Node 组合下
    // 「possible memory leak」警告会被抛成异常而不是打印警告。app.init() 之前把上限提高。
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();

    prisma = app.get(PrismaService);
    depositWorkflow = app.get(DepositWorkflowService);
    depositService = app.get(DepositTransactionsService);
    withdrawService = app.get(WithdrawTransactionsService);
    swapService = app.get(SwapTransactionsService);
    depositSlaService = app.get(DepositSlaService);
    withdrawSlaService = app.get(WithdrawSlaService);
    swapSlaService = app.get(SwapSlaService);

    // 清掉上一轮的 fixture（子表先删）。只删本 suite 前缀的客户，9 个 demo 客户不动。
    const stale = await prisma.customerMain.findMany({
      where: { email: { startsWith: EMAIL_PREFIX } },
      select: { id: true },
    });
    const staleIds = stale.map((s) => s.id);
    if (staleIds.length) {
      await prisma.customerRestriction.deleteMany({ where: { customerId: { in: staleIds } } });
      await prisma.depositTransaction.deleteMany({ where: { ownerId: { in: staleIds } } });
      await prisma.withdrawTransaction.deleteMany({ where: { ownerId: { in: staleIds } } });
      await prisma.swapTransaction.deleteMany({ where: { ownerId: { in: staleIds } } });
      await prisma.wallet.deleteMany({ where: { ownerId: { in: staleIds } } });
      await prisma.customerMain.deleteMany({ where: { id: { in: staleIds } } });
    }

    const fiat = await prisma.asset.findFirst({ where: { currency: 'AED' } });
    const crypto = await prisma.asset.findFirst({ where: { currency: 'USDT' } });
    if (!fiat || !crypto) {
      throw new Error('Fixture assets AED/USDT not seeded — run `npm run db:biz:init` on the e2e DB first.');
    }
    fiatAssetId = fiat.id;
    cryptoAssetId = crypto.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  type Fixture = { id: string; customerNo: string };

  /** 现建 fixture 客户：只写交易门真正读的列，形状对齐 seed.business.ts 的 ACTIVE 个人客户。 */
  async function makeCustomer(tag: string): Promise<Fixture> {
    seq += 1;
    const email = `${EMAIL_PREFIX}${tag}@example.com`;
    const row = await prisma.customerMain.create({
      data: {
        email,
        customerNo: buildDeterministicNo('CU', email),
        phone: `+1555902${String(seq).padStart(4, '0')}`,
        firstName: 'Pat',
        lastName: 'Sample',
        customerType: 'INDIVIDUAL',
        lifecycle: 'ACTIVE',
        riskRating: 'LOW',
        tradingTier: 'BASIC',
        eddRequired: false,
      },
      select: { id: true, customerNo: true },
    });
    return row;
  }

  /**
   * 建一笔充值，直接落在目标状态。SLA 字段不是测试手抄的常量 ——
   * 调用 DepositTransactionsService.resolveSlaFields()（生产代码里状态机
   * 收口处用的同一个函数，public 就是为了这种"建单不经过 updateStatus，
   * 但仍要按同一张配置表补 SLA 字段"的场景），配置表改了这里自动跟着变。
   */
  async function makeDeposit(
    c: Fixture,
    amount: string,
    status: DepositTransactionStatus,
  ): Promise<{ id: string; depositNo: string }> {
    const wallet = await prisma.wallet.create({
      data: {
        ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
        type: 'FIAT_BANK', assetId: fiatAssetId, iban: `AE_E2E_SLA_${c.customerNo}`, status: 'ACTIVE',
      },
    });
    const depositNo = generateReferenceNo('DEP');
    return prisma.depositTransaction.create({
      data: {
        depositNo, traceId: depositNo,
        correlationId: depositNo, // 审计主线根——INHERIT 闸要求主单必携(生产由 detected() 铸)
        ownerType: 'CUSTOMER', ownerId: c.id,
        status,
        assetId: fiatAssetId, toWalletId: wallet.id,
        amount: new Prisma.Decimal(amount),
        netAmount: new Prisma.Decimal(amount),
        feeAmount: new Prisma.Decimal(0),
        ...depositService.resolveSlaFields(status),
      },
      select: { id: true, depositNo: true },
    });
  }

  async function makeDepositInCompliancePending(): Promise<{ id: string; depositNo: string }> {
    const c = await makeCustomer(`dep-cp-${++fixtureSeq}`);
    return makeDeposit(c, '5000', DepositTransactionStatus.COMPLIANCE_PENDING);
  }

  async function makeDepositInManualChecking(): Promise<{ id: string; depositNo: string }> {
    const c = await makeCustomer(`dep-mc-${++fixtureSeq}`);
    return makeDeposit(c, '5000', DepositTransactionStatus.MANUAL_CHECKING);
  }

  /**
   * 先落在真实的 COMPLIANCE_PENDING（带真计时器），再走生产的
   * DepositWorkflowService.applyKytVerdict(SANCTION_APPLICANT) 把它冻结 ——
   * 不是直接用 raw create 在 FROZEN 落地。这样"进 FROZEN 时 deadline 被清空"
   * 测的才是收口处 resolveSlaFields(FROZEN) 真的把已有计时器清掉了，而不是
   * fixture 从来没设过、看着像清空了而已。
   *
   * 顺带把冻结前那一刻的 slaDeadline 也带出去（preFreezeSlaDeadline）——
   * 用例⑤自己拿它断言"冻结前确实非空"，不再只靠用例①间接证明。
   */
  async function makeFrozenDeposit(): Promise<{
    id: string;
    depositNo: string;
    preFreezeSlaDeadline: Date | null;
  }> {
    const c = await makeCustomer(`dep-frz-${++fixtureSeq}`);
    const dep = await makeDeposit(c, '5000', DepositTransactionStatus.COMPLIANCE_PENDING);
    const preFreeze = await prisma.depositTransaction.findUnique({
      where: { id: dep.id },
      select: { slaDeadline: true },
    });
    await depositWorkflow.applyKytVerdict(dep.id, { verdict: 'rejected', sceneTag: 'SANCTION_APPLICANT' });
    return { ...dep, preFreezeSlaDeadline: preFreeze!.slaDeadline };
  }

  /**
   * 建一笔提现，走 WithdrawTransactionsService.insertRecord()（生产建单口，
   * withdraw-workflow.service.ts:385 落 COMPLIANCE_PENDING 时用的同一个 public
   * 方法）而不是裸写 prisma.withdrawTransaction.create —— insertRecord 内部
   * 自己按 resolveSlaFields(data.status) 补 SLA 字段（见其实现），测试不再
   * 自己算一份塞进去，这样「建单这条路真的会去设 SLA」也在验证范围内。
   */
  async function makeWithdraw(
    c: Fixture,
    amount: string,
    status: WithdrawTransactionStatus,
  ): Promise<{ id: string; withdrawNo: string }> {
    const withdrawNo = generateReferenceNo('WD');
    return prisma.$transaction((tx) =>
      withdrawService.insertRecord(tx, {
        withdrawNo, traceId: withdrawNo,
        correlationId: withdrawNo, // 审计主线根——INHERIT 闸要求主单必携(生产由 createWithdrawal 铸)
        ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
        status,
        assetId: fiatAssetId,
        amount: new Prisma.Decimal(amount),
        netAmount: new Prisma.Decimal(amount),
        feeAmount: new Prisma.Decimal(0),
        toIban: `AE_E2E_SLA_OUT_${c.customerNo}`,
      }),
    );
  }

  async function makeWithdrawInCompliancePending(): Promise<{ id: string; withdrawNo: string }> {
    const c = await makeCustomer(`wd-cp-${++fixtureSeq}`);
    return makeWithdraw(c, '5000', WithdrawTransactionStatus.COMPLIANCE_PENDING);
  }

  /**
   * 建一笔兑换，走 SwapTransactionsService.create()（swap-workflow.service.ts:306
   * initiateSwap 落 COMPLIANCE_PENDING 用的同一个 public 方法）而不是裸写
   * prisma.swapTransaction.create —— create() 内部自己按
   * resolveSlaFields(input.status) 补 SLA 字段（见其实现里的注释），测试不再
   * 自己越过可见性去调一份"手抄"的算法，这样「建单这条路真的会去设 SLA」
   * 也在验证范围内，摘掉生产代码这一行断言就该翻红。
   *
   * 不建真实 SwapQuote：quoteId 传 null——DB 里是可空外键（`quote_id TEXT`，
   * 关联 SwapQuote?），已实测 null 值天然放行 FK 校验，不需要 initiateSwap
   * 全流程那一套 quote/TigerBeetle 账户。
   *
   * sumsubTxnIdOut 不是 create() 的入参（它属于"提交去 Sumsub"这个动作，由
   * SwapWorkflowService.submitSumsubTxnOut 在建单后同一条链路里回填，见
   * swap-workflow.service.ts:426），这里在同一个事务里补一笔，贴合真实形状：
   * SwapSlaService.sweep() 按它分岔——为空判"漏提交"走重试分支，不会拒单；
   * 只有非空("已提交、等裁决")才会走"超时判死"分支。
   */
  async function makeSwap(): Promise<{ id: string; swapNo: string | null }> {
    const c = await makeCustomer(`swap-${++fixtureSeq}`);
    const swapNo = generateReferenceNo('SWP');
    return prisma.$transaction(async (tx) => {
      const swap = await swapService.create(
        {
          swapNo,
          correlationId: randomUUID(),
          quoteId: null as unknown as string, // 无真实 quote；可空外键，null 对 FK 校验放行（已实测）
          quoteNo: null,
          ownerType: 'CUSTOMER',
          ownerId: c.id,
          ownerNo: c.customerNo,
          fromAssetId: fiatAssetId,
          fromAssetCode: 'AED',
          fromAmount: new Prisma.Decimal('500'),
          toAssetId: cryptoAssetId,
          toAssetCode: 'USDT',
          toAmount: new Prisma.Decimal('500'),
          netToAmount: new Prisma.Decimal('500'),
          feeAmount: new Prisma.Decimal('0'),
          feeCurrency: null,
          feeBreakdown: null,
          spreadAmount: new Prisma.Decimal('0'),
          exchangeRate: new Prisma.Decimal('1'),
          traceId: swapNo,
          status: SwapTransactionStatus.COMPLIANCE_PENDING,
        },
        tx,
      );
      return tx.swapTransaction.update({
        where: { id: swap.id },
        data: { sumsubTxnIdOut: `e2e-sla-txn-${swapNo}` },
        select: { id: true, swapNo: true },
      });
    });
  }

  // ── ① 三域进入 COMPLIANCE_PENDING 起 5 分钟硬计时 ──────────────────────
  // deposit-transactions.service.ts:DEPOSIT_SLA_MINUTES_BY_STATUS /
  // withdraw-transactions.service.ts:WITHDRAW_SLA_MINUTES_BY_STATUS /
  // swap-transactions.service.ts:SWAP_SLA_MINUTES_BY_STATUS 三张配置表都把
  // COMPLIANCE_PENDING 记成 5（分钟）。断言直接读回三张表各自的 slaDeadline，
  // 窗口取 (4min, 6min) 留一点执行耗时的余量，不掐着 5.000 分钟死等。
  it('① 进入 COMPLIANCE_PENDING 就起 5 分钟计时（三域）', async () => {
    const dep = await makeDepositInCompliancePending();
    const wd = await makeWithdrawInCompliancePending();
    const sw = await makeSwap();

    for (const [table, id] of [
      ['depositTransaction', dep.id],
      ['withdrawTransaction', wd.id],
      ['swapTransaction', sw.id],
    ] as const) {
      const row: any = await (prisma as any)[table].findUnique({ where: { id } });
      expect(row.slaDeadline).not.toBeNull();
      const delta = new Date(row.slaDeadline).getTime() - Date.now();
      expect(delta).toBeGreaterThan(4 * 60_000);
      expect(delta).toBeLessThan(6 * 60_000);
    }
  });

  // ── ② 硬 SLA 破线：充值 COMPLIANCE_PENDING → MANUAL_CHECKING ──────────
  // deposit-sla.service.ts:hardBreach 把 slaDeadline 拨到过去后调用
  // checkSlaBreaches()（真正的扫描入口，不是"某方法被调用过"的假断言），推状态
  // 到 MANUAL_CHECKING。落地时 updateStatus 收口处会按同一张配置表给
  // MANUAL_CHECKING 起一个新的软计时器（3 天）——断言 slaBreached 归 false、
  // 且新计时器落在未来的 3 天档窗口内，这是 hardBreach 自己代码注释里明写的
  // "刻意不传 slaBreached"那条防重复扫逻辑的落地证据。
  //
  // ⚠️ 只断言 not.toBeNull() 抓不住"收口处忘了补 SLA、单子带着已过期的旧
  // deadline 进 MANUAL_CHECKING"这种残局——非空同样成立，但 slaDeadline < now
  // 且 slaBreached = false 会被 findSlaBreachCandidates 每一轮反复捞出来无限
  // 重扫。必须钉住"确实在未来、确实是 3 天档"，不是随便一个非空时刻。
  it('② 硬 SLA 破线：充值 COMPLIANCE_PENDING → MANUAL_CHECKING', async () => {
    const dep = await makeDepositInCompliancePending();
    await prisma.depositTransaction.update({
      where: { id: dep.id },
      data: { slaDeadline: new Date(Date.now() - 1000) },
    });
    await depositSlaService.checkSlaBreaches();
    const row = await prisma.depositTransaction.findUnique({ where: { id: dep.id } });
    expect(row!.status).toBe(DepositTransactionStatus.MANUAL_CHECKING);
    expect(row!.slaBreached).toBe(false);
    const remaining = new Date(row!.slaDeadline!).getTime() - Date.now();
    expect(remaining).toBeGreaterThan(2 * 24 * 60 * 60_000); // 明确在未来，不是残留的过期钟
    expect(remaining).toBeLessThan(4 * 24 * 60 * 60_000); // 且确实是 3 天档，不是别的状态的钟
  });

  // ── ③ 软 SLA 破线：MANUAL_CHECKING 只置标记，状态逐字不变 ──────────────
  // deposit-sla.service.ts:softBreach —— DEPOSIT_SLA_SOFT_STATUSES 里的状态
  // （等自己人）破线时只调 markSlaBreached，不碰 status。业主裁定：超时的是
  // 我们自己人，不能把怠工转嫁给客户，单子该怎么判还得人判。
  it('③ 软 SLA 破线：MANUAL_CHECKING 只置标记，状态逐字不变', async () => {
    const dep = await makeDepositInManualChecking();
    const before = await prisma.depositTransaction.findUnique({ where: { id: dep.id } });
    await prisma.depositTransaction.update({
      where: { id: dep.id },
      data: { slaDeadline: new Date(Date.now() - 1000) },
    });
    await depositSlaService.checkSlaBreaches();
    const after = await prisma.depositTransaction.findUnique({ where: { id: dep.id } });
    expect(after!.status).toBe(before!.status);
    expect(after!.slaBreached).toBe(true);
  });

  // ── ④ 兑换硬破线 → REJECTED ──────────────────────────────────────────
  // 兑换没有软 SLA（没有"等自己人"的状态），破线只有一种下场：REJECTED。
  // swap-sla.service.ts:sweep() 的 fail-closed 判死——兑换拒绝成本低（零记账、
  // 没有要冲正的东西），没理由为了等一个可能永远不来的 verdict 冒放行的风险。
  it('④ 兑换硬破线 → REJECTED', async () => {
    const sw = await makeSwap();
    await prisma.swapTransaction.update({
      where: { id: sw.id },
      data: { slaDeadline: new Date(Date.now() - 1000) },
    });
    await swapSlaService.sweep();
    const row = await prisma.swapTransaction.findUnique({ where: { id: sw.id } });
    expect(row!.status).toBe(SwapTransactionStatus.REJECTED);
  });

  // ── ⑤ FROZEN 单永不破线 ─────────────────────────────────────────────
  // 三层保险都要断言，这是本批业务上最不能出错的一条（自动解冻被制裁调查的
  // 客户是合规灾难）：
  //   ⅰ 冻结前：这笔单确实带着真计时器落地在 COMPLIANCE_PENDING——不是
  //      "fixture 从没设过、看着像清空了而已"。此前只靠用例①间接保证，
  //      makeFrozenDeposit() 现在把冻结前那一刻的 slaDeadline 也带出来
  //      （preFreezeSlaDeadline），这里自己断言一次，让它自证。
  //   ⅱ 进 FROZEN 时 slaDeadline 被置 null —— FROZEN 不在任何域的
  //      *_SLA_MINUTES_BY_STATUS 配置表里，resolveSlaFields(FROZEN) 落到
  //      undefined 分支，返回 { slaDeadline: null, slaBreached: false }，
  //      updateStatus 收口处原样落库。先让它带着真计时器落 COMPLIANCE_PENDING，
  //      再走生产的 applyKytVerdict 真正冻结它——测的是"收口处清掉了已有计时
  //      器"，不是"fixture 从没设过看着像清空"。
  //   ⅲ 扫描器跑一轮之后，该单状态仍是 FROZEN、slaBreached 仍是 false ——
  //      findSlaBreachCandidates 的 WHERE 子句里，充值/提现只认
  //      COMPLIANCE_PENDING/ACTION_PENDING/MANUAL_CHECKING/OPERATION_PENDING
  //      四个状态，FROZEN 不在其中，天然不会被捞进候选集合。
  it('⑤ FROZEN 单永不破线', async () => {
    const dep = await makeFrozenDeposit();
    expect(dep.preFreezeSlaDeadline).not.toBeNull(); // 冻结前：确实带着真计时器落地，不是从没设过

    const row0 = await prisma.depositTransaction.findUnique({ where: { id: dep.id } });
    expect(row0!.status).toBe(DepositTransactionStatus.FROZEN);
    expect(row0!.slaDeadline).toBeNull(); // FROZEN 无 SLA 配置 → 进入时被清空
    await depositSlaService.checkSlaBreaches();
    const row1 = await prisma.depositTransaction.findUnique({ where: { id: dep.id } });
    expect(row1!.status).toBe(DepositTransactionStatus.FROZEN);
    expect(row1!.slaBreached).toBe(false);
  });

  // ── ⑥ onHold 不影响计时 ─────────────────────────────────────────────
  // 本批修的核心 bug：此前 SLA 挂在 onHold 回调上，导致"没收到 onHold 的单
  // 永远不计时"。现在 SLA 完全由"进入状态"驱动（resolveSlaFields 只在
  // updateStatus 等状态机收口处调用），与 webhook 无关 ——
  // DepositWorkflowService.applyKytOnHold 已经不碰 slaDeadline（见其 JSDoc）。
  // 断言投一条 onHold 前后，slaDeadline 逐字未变（用 toEqual 精确比较时刻，
  // 不是"仍非空"这种粗断言）。
  it('⑥ onHold 不影响计时', async () => {
    const dep = await makeDepositInCompliancePending();
    const before = await prisma.depositTransaction.findUnique({ where: { id: dep.id } });
    await depositWorkflow.applyKytVerdict(dep.id, { verdict: 'onHold' });
    const after = await prisma.depositTransaction.findUnique({ where: { id: dep.id } });
    expect(after!.slaDeadline).toEqual(before!.slaDeadline);
  });

  // ── ⑦ 提现硬 SLA 破线：COMPLIANCE_PENDING → MANUAL_CHECKING ────────────
  // withdraw-sla.service.ts:hardBreach 是 deposit-sla.service.ts 的镜像实现
  // （同一套硬/软分流、同一条"刻意不传 slaBreached"防重复扫注释）。
  // withdrawSlaService 此前注入了却从没在任何用例里被调用过——是一处死绑定，
  // 提现这条硬破线路径完全没有 e2e 覆盖。补这一条，断言口径照抄用例②修完的
  // 版本（钉未来 + 3 天档），不用弱化的 not.toBeNull()。
  it('⑦ 硬 SLA 破线：提现 COMPLIANCE_PENDING → MANUAL_CHECKING', async () => {
    const wd = await makeWithdrawInCompliancePending();
    await prisma.withdrawTransaction.update({
      where: { id: wd.id },
      data: { slaDeadline: new Date(Date.now() - 1000) },
    });
    await withdrawSlaService.checkSlaBreaches();
    const row = await prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
    expect(row!.status).toBe(WithdrawTransactionStatus.MANUAL_CHECKING);
    expect(row!.slaBreached).toBe(false);
    const remaining = new Date(row!.slaDeadline!).getTime() - Date.now();
    expect(remaining).toBeGreaterThan(2 * 24 * 60 * 60_000); // 明确在未来，不是残留的过期钟
    expect(remaining).toBeLessThan(4 * 24 * 60 * 60_000); // 且确实是 3 天档，不是别的状态的钟
  });
});
