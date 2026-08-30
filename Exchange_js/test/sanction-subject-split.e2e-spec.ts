import { resolveE2eDatabaseUrl } from './e2e-db';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Node 18 polyfill：@nestjs/schedule 需要 globalThis.crypto（Node 19+ 才稳定），
// 本 harness 不加载 src/main.ts，所以要在 AppModule 之前自己补。
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

// 必须在任何读 DATABASE_URL 的 import 之前执行。
process.env.DATABASE_URL = resolveE2eDatabaseUrl('e2e-sanction-subject-split.db');
process.env.SUMSUB_MOCK_MODE = 'true';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// ── 破坏性护栏（2026-07-31 起，因为真的炸过两次）────────────────────────
if (!process.env.DATABASE_URL?.includes('e2e-')) {
  throw new Error(
    `[sanction-subject-split e2e] 拒绝运行：本 suite 会写入并清理交易表，但 ` +
      `DATABASE_URL 当前指向 ${process.env.DATABASE_URL} —— 这看起来是常驻栈的验收库。`,
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
import { WithdrawWorkflowService } from '../src/modules/trading/withdraw-transactions/withdraw-workflow.service';
import { SwapWorkflowService } from '../src/modules/trading/swap-transactions/swap-workflow.service';
import { SwapTransactionsService } from '../src/modules/trading/swap-transactions/swap-transactions.service';
import { CustomerRestrictionsService } from '../src/modules/identity/customers/customer-restrictions.service';
import { DepositTransactionStatus } from '../src/modules/trading/deposit-transactions/dto/deposit-transaction.dto';
import { WithdrawTransactionStatus } from '../src/modules/trading/withdraw-transactions/dto/withdraw-transaction.dto';
import { SwapTransactionStatus } from '../src/modules/trading/swap-transactions/dto/swap-transaction.dto';
import { AuditActions } from '../src/modules/audit-logging/constants/audit-actions.constant';
import { buildDeterministicNo, generateReferenceNo } from '../src/common/utils/no-generator.util';

/**
 * Task 11：第二批「制裁命中分主体」e2e 验收。
 *
 * 覆盖范围（Task 1-10 的产出，逐条见各 it() 前的注释）：
 *   ① 充值 SANCTION_APPLICANT → 冻单 + 冻人
 *   ② 充值 SANCTION_COUNTERPARTY → 只冻单，不冻人
 *   ③ 同一客户经充值+提现两条路径命中 SANCTION → 限制便签只有一张（openWithin
 *      按 customerNo 归一 caseRef 的去重键），第二次命中留 SKIPPED 审计
 *   ④ 兑换 FROZEN 客户面三层防线：响应体收敛 / 筛选器展开 / 审计可查
 *   ⑤ FROZEN 兑换单再收裁决 → IGNORED 审计、不推状态、不抛异常（防死信）
 *
 * harness：真 AppModule，只 mock SUMSUB_TXN_CLIENT（不打真实 api.sumsub.com）。
 * 直调各域 WorkflowService.applyKytVerdict —— 与 kyt-verdict-landing.e2e-spec.ts
 * （第一批模板）同一 harness 形状：三域订单全部现建现走 COMPLIANCE_PENDING，不经
 * initiate 网关（那些前置门不是本轮要测的东西）。fixture 客户全部现建现删（前缀
 * e2e_sanction_split_），不碰 9 个 demo 客户。
 */
describe('第二批 · 制裁命中分主体 (e2e)', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let prisma: PrismaService;
  let depositWorkflow: DepositWorkflowService;
  let withdrawWorkflow: WithdrawWorkflowService;
  let swapWorkflow: SwapWorkflowService;
  let swapService: SwapTransactionsService;
  let restrictionsService: CustomerRestrictionsService;

  let fiatAssetId: string;
  let cryptoAssetId: string;

  const EMAIL_PREFIX = 'e2e_sanction_split_';
  // 8/27 审计业务键化后，per-customerNo 的审计行会跨轮累积（audit 表从不清理）。
  // 邮箱加轮次盐 → customerNo（由邮箱决定性派生）每轮独立，计数断言只见本轮。
  const RUN_TAG = Date.now().toString(36);
  let seq = 0;

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
    withdrawWorkflow = app.get(WithdrawWorkflowService);
    swapWorkflow = app.get(SwapWorkflowService);
    swapService = app.get(SwapTransactionsService);
    restrictionsService = app.get(CustomerRestrictionsService);

    // 清掉上一轮的 fixture（子表先删）。只删本 suite 前缀的客户，9 个 demo 客户不动。
    // ⚠️ 这里从不清理 auditLogEvent（它按 entityId 关联，不是 customerId 外键，
    // 没有一个天然的「本 suite 前缀」过滤条件）。今天安全，是因为 CustomerMain.id
    // 是随机 uuid——上一轮遗留的审计行 entityId 不可能撞上本轮新建客户的 id。
    // 用例⑥用的是精确行数断言 toHaveLength(2)，这条断言的正确性寄生在
    // 「客户 id 随机不重放」这个隐含前提上；如果这里的清理逻辑将来改成按可预测
    // id 建客户（或复用 id），用例⑥会开始计入跨轮残留的审计行。
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
    const email = `${EMAIL_PREFIX}${RUN_TAG}_${tag}@example.com`;
    const row = await prisma.customerMain.create({
      data: {
        email,
        customerNo: buildDeterministicNo('CU', email),
        phone: `+1555901${String(seq).padStart(4, '0')}`,
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

  /** 在途充值 fixture（COMPLIANCE_PENDING）—— 复刻 customer-restrictions.e2e-spec.ts 的同名 helper。 */
  async function makeDeposit(c: Fixture, amount: string): Promise<{ id: string; depositNo: string }> {
    const wallet = await prisma.wallet.create({
      data: {
        ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
        type: 'FIAT_BANK', assetId: fiatAssetId, iban: `AE_E2E_${c.customerNo}`, status: 'ACTIVE',
      },
    });
    const depositNo = generateReferenceNo('DEP');
    return prisma.depositTransaction.create({
      data: {
        depositNo, traceId: depositNo, correlationId: randomUUID(),
        ownerType: 'CUSTOMER', ownerId: c.id,
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        assetId: fiatAssetId, toWalletId: wallet.id,
        amount: new Prisma.Decimal(amount),
        netAmount: new Prisma.Decimal(amount),
        feeAmount: new Prisma.Decimal(0),
      },
      select: { id: true, depositNo: true },
    });
  }

  async function makeWithdraw(c: Fixture, amount: string): Promise<{ id: string; withdrawNo: string }> {
    const withdrawNo = generateReferenceNo('WD');
    return prisma.withdrawTransaction.create({
      data: {
        withdrawNo, traceId: withdrawNo, correlationId: randomUUID(),
        ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
        status: WithdrawTransactionStatus.COMPLIANCE_PENDING,
        assetId: fiatAssetId,
        amount: new Prisma.Decimal(amount),
        netAmount: new Prisma.Decimal(amount),
        feeAmount: new Prisma.Decimal(0),
        toIban: `AE_E2E_OUT_${c.customerNo}`,
      },
      select: { id: true, withdrawNo: true },
    });
  }

  async function makeSwap(c: Fixture, amount: string): Promise<{ id: string; swapNo: string | null }> {
    const swapNo = generateReferenceNo('SWP');
    return prisma.swapTransaction.create({
      data: {
        swapNo, traceId: swapNo, correlationId: randomUUID(),
        ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
        status: SwapTransactionStatus.COMPLIANCE_PENDING,
        fromAssetId: fiatAssetId, fromAssetCode: 'AED', fromAmount: new Prisma.Decimal(amount),
        toAssetId: cryptoAssetId, toAssetCode: 'USDT', toAmount: new Prisma.Decimal(amount),
        exchangeRate: new Prisma.Decimal('1'),
      },
      select: { id: true, swapNo: true },
    });
  }

  /**
   * 三处域 @OnEvent(CUSTOMER_RESTRICTION_OPENED, {async:true}) 都是 fire-and-forget
   * detached handler —— 直接断言等于跟事件循环赛跑，故轮询（同 customer-restrictions
   * .e2e-spec.ts 的同名 helper）。
   */
  async function waitUntil(
    label: string,
    check: () => Promise<boolean>,
    timeoutMs = 8000,
    intervalMs = 25,
  ): Promise<void> {
    const start = Date.now();
    for (;;) {
      if (await check()) return;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`waitUntil timed out after ${timeoutMs}ms: ${label}`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  // ── ① 充值 SANCTION_APPLICANT → 冻单 + 冻人 ─────────────────────────
  // deposit-workflow.service.ts:applyKytRejected：isApplicantSanction 分支先
  // customerRestrictionsService.open({cause:'SANCTION'})（冻人），再 updateStatus
  // (FREEZE)（冻单）—— 这是本轮「先冻人再冻单」fail-safe 顺序的落地证据。断言两件
  // 事都发生：单进 FROZEN、客户名下出现一张 OPEN 的 SANCTION 便签。
  it('① 充值 SANCTION_APPLICANT → 冻单 + 冻人', async () => {
    const c = await makeCustomer('applicant');
    const dep = await makeDeposit(c, '5000');

    await depositWorkflow.applyKytVerdict(dep.id, {
      verdict: 'rejected',
      sceneTag: 'SANCTION_APPLICANT',
    });

    const row = await prisma.depositTransaction.findUnique({ where: { id: dep.id } });
    expect(row!.status).toBe(DepositTransactionStatus.FROZEN);

    const restrictions = await prisma.customerRestriction.findMany({
      where: { customerId: c.id, cause: 'SANCTION', status: 'OPEN' },
    });
    expect(restrictions.length).toBeGreaterThan(0);
  });

  // ── ② 充值 SANCTION_COUNTERPARTY → 只冻单，不冻人 ────────────────────
  // 同一分支里 isApplicantSanction 恒 false（sceneTag 不是 SANCTION_APPLICANT），
  // 所以 customerRestrictionsService.open() 那一段被完全跳过 —— 只有单被
  // updateStatus(FREEZE)。这是「分主体」这个名字的字面含义：对手方地址命中制裁名单
  // 不该牵连我方客户本人的账户。
  it('② 充值 SANCTION_COUNTERPARTY → 只冻单，不冻人', async () => {
    const c = await makeCustomer('counterparty');
    const dep = await makeDeposit(c, '5000');

    await depositWorkflow.applyKytVerdict(dep.id, {
      verdict: 'rejected',
      sceneTag: 'SANCTION_COUNTERPARTY',
    });

    const row = await prisma.depositTransaction.findUnique({ where: { id: dep.id } });
    expect(row!.status).toBe(DepositTransactionStatus.FROZEN);

    const restrictionCount = await prisma.customerRestriction.count({
      where: { customerId: c.id, cause: 'SANCTION', status: 'OPEN' },
    });
    expect(restrictionCount).toBe(0);
  });

  // ── ③ 同一客户经充值+提现两条路径命中 → 便签只有一张 ─────────────────
  // customer-restrictions.service.ts:openWithin —— SANCTION 是 customerLevel 因由,
  // effectiveCaseRef 归一成 customerNo（不是调用方传的单号），所以第二次 open()
  // 精确查到第一次开的那张 OPEN 便签，created=false、不广播、但仍写一条
  // result=SKIPPED 的 CUSTOMER_RESTRICTION_ADDED 审计（open() 里的
  // auditShell.result = outcome.created ? SUCCESS : SKIPPED）。
  //
  // 场景构造刻意避开了"两笔单都先创建好，再依次喂裁决"这个写法：第一次裁决落地时
  // customerRestrictionsService.open() 末尾会 emit CUSTOMER_RESTRICTION_OPENED，
  // 三个交易域各自的 onCustomerRestrictionOpened（{async:true} fire-and-forget，
  // emit() 不等它跑完）会去扫这个客户名下所有非终态单——如果第二笔单在那之前就
  // 已经存在，会被广播直接冻掉（走 assertCustomerComplianceOrFreeze 的 FREEZE，
  // 不经过它自己的 applyKytVerdict/open()），根本不会再触发第二次 open() 调用，
  // 也就测不出「便签不重复贴」这件事。
  //
  // 但反过来「第二笔单在裁决落地之后才建」也不是自动安全的：emit() 之后，withdraw
  // 域自己的监听器仍是一个**独立、未被等待**的 promise 链——`await
  // depositWorkflow.applyKytVerdict(...)` 只保证 dep 自己这条链（open + 冻单）
  // 已落地，不保证 withdraw 域监听器的 findNonTerminalByOwner 查询已经跑完。若
  // 在监听器真正查询之前创建 wd2，仍有极小概率被同一轮扫描捞中。
  // 解法：先放一个「信标」提现单 wdBeacon（在 dep 裁决落地前就已存在），用
  // waitUntil 等它被广播冻成 FROZEN——这是 withdraw 域监听器确已查询并处理完
  // "当时存在的所有单"的可观察证据（emit() 本身不返回 promise，没法直接等）。
  // 等信标冻结之后再建 wd2，此时该轮监听器早已查过库、不可能再回头捞到
  // 后建的 wd2；随后直接对 wd2 喂 SANCTION_APPLICANT，必定走它自己
  // applyKytRejected 里的 open() 调用。
  it('③ 同一客户经充值+提现两条路径命中 → 便签只有一张，第二次留 DENIED(DUPLICATE_HIT) 审计', async () => {
    const c = await makeCustomer('two-paths');
    const dep = await makeDeposit(c, '5000');
    const wdBeacon = await makeWithdraw(c, '50');

    await depositWorkflow.applyKytVerdict(dep.id, { verdict: 'rejected', sceneTag: 'SANCTION_APPLICANT' });
    expect(
      (await prisma.depositTransaction.findUnique({ where: { id: dep.id } }))!.status,
    ).toBe(DepositTransactionStatus.FROZEN);

    await waitUntil(
      'withdraw 域跨域冻单广播已处理完信标单',
      async () =>
        (await prisma.withdrawTransaction.findUnique({ where: { id: wdBeacon.id } }))!.status ===
        WithdrawTransactionStatus.FROZEN,
    );

    // 严格晚于信标确认之后才建——那一轮广播扫描已经查过库，不可能回头捞到它。
    const wd2 = await makeWithdraw(c, '700');
    await withdrawWorkflow.applyKytVerdict(wd2.id, { verdict: 'rejected', sceneTag: 'SANCTION_APPLICANT' });

    // 第二笔单自己也应该被冻（走的是它自己 applyKytRejected 里的 FREEZE，不是广播）。
    expect(
      (await prisma.withdrawTransaction.findUnique({ where: { id: wd2.id } }))!.status,
    ).toBe(WithdrawTransactionStatus.FROZEN);

    const rows = await prisma.customerRestriction.findMany({
      where: { customerId: c.id, cause: 'SANCTION', status: 'OPEN' },
    });
    const distinctNos = new Set(rows.map((r) => r.restrictionNo));
    expect(distinctNos.size).toBe(1); // 只有最早的那一张，第二次命中没有另起一张

    // 2026-08-20 终审曾发现：下面这条断言当时是红的——customer-restrictions
    // .service.ts:open() 写 CUSTOMER_RESTRICTION_ADDED 审计时没有传 requestId
    // （auditShell 里根本没有这个字段），AuditLogsService 给没传 requestId 的
    // 事件算出的 idempotencyKey 退化成 entityType|entityId|action|
    // 'NO_REQUEST_ID'——这三段对同一客户的任意两次 open() 调用永远相同（不看
    // cause/reason/result/restrictionNo），同一客户身上第二条同 action 的
    // CUSTOMER_RESTRICTION_ADDED 事件（不管是这里要测的「同因重复命中变
    // SKIPPED」，还是完全不同因由的另一张便签）都被 createEventWithUniqueNo
    // 的幂等短路静默去重，第二条真正落库的 create() 根本没跑，打穿了
    // open() 自己代码注释里明写的「第 2..N 次命中仍留一条 SKIPPED 审计，可
    // 取证」的承诺。
    //
    // 已于 commit 3a9fa81c 修复：给 open() 写的 CUSTOMER_RESTRICTION_ADDED /
    // CUSTOMER_FROZEN 审计都拼上 requestId，键用的是 restrictionNo（不是
    // customerNo——同一客户名下先后开出的便签 restrictionNo 各不相同，用它才能
    // 保证每次真实事件都有独立幂等键）：
    // `CUSTOMER_RESTRICTION_ADDED_${outcome.restrictionNo}_${randomUUID()}`。
    // 下面这条断言现在的角色是那次修复的回归闸——同因第二次命中必须仍留一条
    // DENIED(DUPLICATE_HIT) 审计（地基站四值 outcome 合同下 SKIPPED 的对应译法）；
    // 不同因由两条都落库的对照见下方用例⑥。
    expect(
      await prisma.auditLogEvent.count({
        where: {
          primarySubjectNo: c.customerNo,
          action: AuditActions.CUSTOMER_RESTRICTION_ADDED,
          outcome: 'DENIED',
          reasonCode: 'DUPLICATE_HIT',
        },
      }),
    ).toBeGreaterThan(0);
  });

  // ── ④ 兑换 FROZEN 客户面三层防线 ──────────────────────────────────────
  // swap-transactions.service.ts 三层：
  //   ⅰ toCustomerSwapStatus：FROZEN 显式收敛成 REJECTED（与充值收敛成
  //      COMPLIANCE_PENDING 不同——FROZEN 是兑换域的零出边终态，收敛成"处理中"
  //      会让客户端自刷定时器永不停止）。
  //   ⅱ findAll 的 customerScope 分支：客户传的 status 先按收敛函数反推展开成
  //      「会被收敛成这个值」的原始状态集合，再拿这个集合去过滤——不是简单地
  //      忽略 status，也不是直接按字面值查。FROZEN 本身没有任何原始状态会收敛
  //      成它自己（它只会被收敛成 REJECTED），所以展开集合恒为空，
  //      `status: {in: []}` 精确返回零行；REJECTED 的展开集合是
  //      [REJECTED, FROZEN] 两个原始值都在内。
  //   ⅲ SWAP_FROZEN 审计留痕，供运营/合规取证（客户面看不到，但审计线可查）。
  //
  // ⚠️ 这条断言与 task-11-brief.md 里给的示例代码不同：brief 断言
  // 「probe(status=FROZEN).length === view.length（即 status 被完全忽略）」——
  // 那是 Task 10 早期的实现（commit e68062d2），Task 10 收尾（2be83c58）时改成了
  // 「按收敛后的值展开」，FROZEN 展开集合为空≠忽略。已用上面读到的源码逐行核实，
  // 不是盲抄 brief。
  it('④ 兑换 FROZEN 客户面三层：响应体收敛成 REJECTED、筛选器精确展开、审计可查', async () => {
    const c = await makeCustomer('swap-frozen');

    // 一笔普通硬线拒绝（无 action，非制裁）留在 REJECTED，作为「筛 REJECTED 时
    // 普通拒绝单也在」的对照组。
    const swPlain = await makeSwap(c, '400');
    await swapWorkflow.applyKytVerdict(swPlain.id, { verdict: 'rejected' });
    expect(
      (await prisma.swapTransaction.findUnique({ where: { id: swPlain.id } }))!.status,
    ).toBe(SwapTransactionStatus.REJECTED);

    // 制裁命中，落到 FROZEN。
    const sw = await makeSwap(c, '900');
    await swapWorkflow.applyKytVerdict(sw.id, {
      verdict: 'rejected',
      sceneTag: 'SANCTION_APPLICANT',
    });
    expect(
      (await prisma.swapTransaction.findUnique({ where: { id: sw.id } }))!.status,
    ).toBe(SwapTransactionStatus.FROZEN);

    // ⅰ 响应体收敛：不筛 status 时，两笔单都在，FROZEN 那笔的 status 字段被
    // 收敛成了 'REJECTED'，客户面看不到 'FROZEN' 这个字面量。
    const view = await swapService.findAllForCustomer(c.id, {} as any);
    expect(view.items).toHaveLength(2);
    const statuses = view.items.map((i: any) => i.status);
    expect(statuses).not.toContain('FROZEN');
    expect(statuses.every((s: string) => s === 'REJECTED')).toBe(true);

    // ⅱ-a 筛选器传 FROZEN：展开集合为空，精确返回零行——不是报错，也不是
    // 退化成全量（那本身就是另一种可探测信号）。
    const probeFrozen = await swapService.findAllForCustomer(c.id, { status: 'FROZEN' } as any);
    expect(probeFrozen.items).toHaveLength(0);

    // ⅱ-b 筛选器传 REJECTED：展开集合是 [REJECTED, FROZEN]，两笔单都命中。
    const probeRejected = await swapService.findAllForCustomer(c.id, { status: 'REJECTED' } as any);
    expect(probeRejected.items).toHaveLength(2);
    expect(probeRejected.items.map((i: any) => i.swapNo).sort()).toEqual(
      [swPlain.swapNo, sw.swapNo].sort(),
    );

    // ⅲ 审计留痕：客户面看不到的东西，运营/合规必须查得到。
    expect(
      await prisma.auditLogEvent.count({
        where: { primarySubjectNo: sw.swapNo!, action: AuditActions.SWAP_FROZEN },
      }),
    ).toBeGreaterThan(0);
  });

  // ── ⑤ FROZEN 兑换单再收裁决 → IGNORED 审计、不推状态、不抛异常（防死信） ──
  // swap-workflow.service.ts:applyKytVerdict 顶部的 FROZEN 幂等闸：
  // `if (status === SwapTransactionStatus.FROZEN) { ...recordVerdictIgnored...; return; }`
  // 存在的理由写在它自己的注释里——不写这一闸，Sumsub 重投同一条 rejected webhook
  // 会一路走到 markStatus(FREEZE)，打在零出边的 FROZEN 上抛 Invalid transition，
  // 异常不 catch → 事件标 FAILED → 三次重试后进死信。这里直接钉死：第二次裁决
  // 必须 resolve 不 throw，状态原地不动，且留一条 SWAP_KYT_VERDICT_IGNORED 审计
  // （"忽略 ≠ 静默"，与第一批的充值/提现同款闸门一致）。
  it('⑤ FROZEN 兑换单再收裁决 → 写 IGNORED 审计、不推状态、不抛异常（防死信）', async () => {
    const c = await makeCustomer('swap-late');
    const sw = await makeSwap(c, '900');
    await swapWorkflow.applyKytVerdict(sw.id, { verdict: 'rejected', sceneTag: 'SANCTION_APPLICANT' });
    expect(
      (await prisma.swapTransaction.findUnique({ where: { id: sw.id } }))!.status,
    ).toBe(SwapTransactionStatus.FROZEN);

    await expect(
      swapWorkflow.applyKytVerdict(sw.id, { verdict: 'rejected', sceneTag: 'SANCTION_APPLICANT' }),
    ).resolves.not.toThrow();

    expect(
      (await prisma.swapTransaction.findUnique({ where: { id: sw.id } }))!.status,
    ).toBe(SwapTransactionStatus.FROZEN);
    expect(
      await prisma.auditLogEvent.count({
        where: { primarySubjectNo: sw.swapNo!, action: AuditActions.SWAP_KYT_VERDICT_IGNORED },
      }),
    ).toBeGreaterThan(0);
  });

  // ── ⑥ 同客户先 SANCTION 后不同因由 → 两条 CUSTOMER_RESTRICTION_ADDED 都落库 ──
  // 比用例③更宽的回归：③测的是「同因重复命中」被去重成 SKIPPED 是否留痕；这里测的
  // 是两个**完全不同**的真实业务事件（先制裁、后材料过期）是否都各自落一条
  // result=SUCCESS 的 CUSTOMER_RESTRICTION_ADDED。修复前，customer-restrictions
  // .service.ts:open() 写这条审计时不传 requestId，audit-logs.service 的
  // buildIdempotencyKey 退化成 entityType|entityId|action|NO_REQUEST_ID——这三段
  // 对同一客户任意两次 CUSTOMER_RESTRICTION_ADDED 恒定，与 cause/result/
  // restrictionNo 无关，第二条会被 createEventWithUniqueNo 的幂等短路直接吞掉、
  // 一条都进不了表（已用 customer-restrictions.e2e-spec.ts 用例①的库实测确认）。
  it('⑥ 同客户先 SANCTION 后 MATERIAL_EXPIRED（不同因由）→ 两条 CUSTOMER_RESTRICTION_ADDED 都落库，不被去重成一条', async () => {
    const c = await makeCustomer('diff-cause');

    const sanction = await restrictionsService.open({
      customerId: c.id,
      cause: 'SANCTION',
      reason: 'Sanctions hit',
      caseRef: 'E2E-SPLIT-SANCTION-1',
      openedBy: 'SYSTEM',
    });
    expect(sanction.created).toBe(true);

    const material = await restrictionsService.open({
      customerId: c.id,
      cause: 'MATERIAL_EXPIRED',
      reason: 'Passport expired',
      caseRef: 'E2E-SPLIT-MATERIAL-1',
      openedBy: 'SYSTEM',
    });
    expect(material.created).toBe(true);
    expect(material.restrictionNo).not.toBe(sanction.restrictionNo);

    const addedRows = await prisma.auditLogEvent.findMany({
      where: { primarySubjectNo: c.customerNo, action: AuditActions.CUSTOMER_RESTRICTION_ADDED },
    });
    expect(addedRows).toHaveLength(2);
    expect(addedRows.every((r) => r.outcome === 'SUCCESS')).toBe(true);
  });
});
