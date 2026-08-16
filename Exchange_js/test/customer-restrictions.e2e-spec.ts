import { resolveE2eDatabaseUrl } from './e2e-db';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Node 18 polyfill —— @nestjs/schedule 需要 globalThis.crypto，本 harness 不加载
// main.ts，所以在 AppModule（→ ScheduleModule）之前重复一遍。
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

// ── 破坏性护栏 ①（必须在任何读 DATABASE_URL 的 import 之前）──────────────
// 本 suite 会 deleteMany fixture 客户及其便签/三域订单/钱包。指向常驻栈的验收库
// 会毁真数据（2026-07-31 已两次实证，见 BACKLOG「演示/测试环境卫生」）。
process.env.DATABASE_URL = resolveE2eDatabaseUrl('e2e-customer-restrictions.db');

// ── 破坏性护栏 ②：上面那行若被人删改回读 .env，这里兜住 ────────────────
if (!process.env.DATABASE_URL?.includes('e2e-')) {
  throw new Error(
    `[customer-restrictions e2e] 拒绝运行：本 suite 会清空 fixture 客户及其三域订单，` +
      `但 DATABASE_URL 当前指向 ${process.env.DATABASE_URL} —— 这看起来是常驻栈的验收库。\n` +
      `专用库需先 prisma migrate deploy + db:base:sync + db:biz:init；库名必须含 "e2e-"。`,
  );
}

// 本 suite 不打真实 api.sumsub.com；缺这个开关时 SumsubClient 会因无 APP_TOKEN 抛错。
// 不能靠 .env —— stack.sh 每次 up 都重写它且从不写 SUMSUB_*。
process.env.SUMSUB_MOCK_MODE = 'true';

// dotenv 不覆盖已存在的 key：DATABASE_URL 保持上面的专用库，TB_ADDRESS 走 .env。
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// ── 破坏性护栏 ③：dotenv 之后再确认一次 ────────────────────────────────
if (!process.env.DATABASE_URL?.includes('e2e-')) {
  throw new Error(
    `Refusing to run: DATABASE_URL is ${process.env.DATABASE_URL}, expected a dedicated "e2e-" database ` +
      `(e.g. file:/tmp/exchange_js_wt_customer_restrictions/e2e-customer-restrictions.db).`,
  );
}

import request from 'supertest';
import { AuditActions } from '../src/modules/audit-logging/constants/audit-actions.constant';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { CustomerAccessService } from '../src/modules/identity/customers/customer-access.service';
import { CustomerRestrictionsService } from '../src/modules/identity/customers/customer-restrictions.service';
import { CustomerRestrictionWorkflowService } from '../src/modules/identity/customers/customer-restriction-workflow.service';
import { ApprovalsService } from '../src/modules/governance/approvals/approvals.service';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../src/modules/governance/approvals/constants/approval.constants';
import { DepositTransactionStatus } from '../src/modules/trading/deposit-transactions/dto/deposit-transaction.dto';
import { WithdrawTransactionStatus } from '../src/modules/trading/withdraw-transactions/dto/withdraw-transaction.dto';
import { SwapTransactionStatus } from '../src/modules/trading/swap-transactions/dto/swap-transaction.dto';
import { buildDeterministicNo, generateReferenceNo } from '../src/common/utils/no-generator.util';

/**
 * 设计稿 §7.2 六条 e2e，逐条对应设计稿存在的理由：
 *   ① 多因并存不互相解 —— 三轴收敛的首要动机
 *   ② 零痕迹        —— tipping-off 命门（blocked / disclosedBlocked 分家）
 *   ③ 贴不审批撕审批 —— 贴便签立即生效、撕便签才走审批
 *   ④ MLRO 类缺 releaseOrderRef → 400
 *   ⑤ 贴 ALL 冻在途单（含兑换，§3.5 本轮新补）
 *   ⑥ scope < ALL 不动在途单
 *
 * harness：真 AppModule + 真 HTTP（supertest）。②/③/④ 必须走 HTTP —— 它们断言的
 * 就是"客户/操作员在网络层面看到什么"，绕过 controller 用 service 直调等于没测。
 * fixture 客户全部现建现删（前缀 e2e_restrictions_），不碰 9 个 demo 客户 ——
 * 那 9 个被别的 suite 和人工验收共用。
 */
describe('Customer lifecycle restrictions (e2e, Task 14)', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let access: CustomerAccessService;
  let restrictions: CustomerRestrictionsService;
  let workflow: CustomerRestrictionWorkflowService;
  let approvals: ApprovalsService;

  let adminToken: string;
  let fiatAssetId: string;
  let cryptoAssetId: string;

  const EMAIL_PREFIX = 'e2e_restrictions_';

  // Maker-checker：贴/发起用 admin JWT（SUPER_ADMIN，maker），批准用另外的 actor。
  const MLRO_CHECKER: ApprovalActorContext = {
    actorType: 'ADMIN', userId: 'E2E_RST_MLRO', userNo: 'E2E_RST_MLRO',
    role: 'MLRO', roleCodes: ['MLRO'],
  };
  const OPS_CHECKER: ApprovalActorContext = {
    actorType: 'ADMIN', userId: 'E2E_RST_OPS', userNo: 'E2E_RST_OPS',
    role: 'OPS_OFFICER', roleCodes: ['OPS_OFFICER'],
  };
  const SEED_ACTOR: ApprovalActorContext = {
    actorType: 'ADMIN', userId: 'E2E_RST_MAKER', userNo: 'E2E_RST_MAKER',
    role: 'MLRO', roleCodes: ['MLRO'],
  };

  type Fixture = {
    id: string; customerNo: string; email: string; phone: string;
    firstName: string; lastName: string; token: string;
  };

  /** 现建 fixture 客户：只写交易门真正读的列，形状对齐 seed.business.ts 的 ACTIVE 个人客户。 */
  async function makeCustomer(tag: string, seq: number): Promise<Fixture> {
    const email = `${EMAIL_PREFIX}${tag}@example.com`;
    const phone = `+1555900${String(seq).padStart(4, '0')}`;
    const row = await prisma.customerMain.create({
      data: {
        email,
        customerNo: buildDeterministicNo('CU', email),
        phone,
        // ② 要求两个客户除身份键外逐字节相同，故所有 fixture 共用同一组姓名。
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
    return {
      id: row.id, customerNo: row.customerNo, email, phone,
      firstName: 'Pat', lastName: 'Sample',
      token: jwt.sign({
        username: email, sub: row.id, role: 'CUSTOMER', type: 'CUSTOMER', userNo: row.customerNo,
      }),
    };
  }

  /** 在途充值 fixture（COMPLIANCE_PENDING）—— 复刻 deposit-money-arcs 的 createDepositAtStatus。 */
  async function makeDeposit(c: Fixture, amount: string): Promise<{ id: string; depositNo: string }> {
    const wallet = await prisma.wallet.create({
      data: {
        ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
        type: 'FIAT_BANK', assetId: fiatAssetId, iban: `AE_E2E_${c.customerNo}`, status: 'ACTIVE',
      },
    });
    const depositNo = generateReferenceNo('DEP');
    const row = await prisma.depositTransaction.create({
      data: {
        depositNo, traceId: depositNo,
        ownerType: 'CUSTOMER', ownerId: c.id,
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        assetId: fiatAssetId, toWalletId: wallet.id,
        amount: new Prisma.Decimal(amount),
        netAmount: new Prisma.Decimal(amount),
        feeAmount: new Prisma.Decimal(0),
      },
      select: { id: true, depositNo: true },
    });
    return row;
  }

  async function makeWithdraw(c: Fixture, amount: string): Promise<{ id: string; withdrawNo: string }> {
    const withdrawNo = generateReferenceNo('WD');
    return prisma.withdrawTransaction.create({
      data: {
        withdrawNo, traceId: withdrawNo,
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
        swapNo, traceId: swapNo,
        ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
        status: SwapTransactionStatus.COMPLIANCE_PENDING,
        fromAssetId: fiatAssetId, fromAssetCode: 'AED', fromAmount: new Prisma.Decimal(amount),
        toAssetId: cryptoAssetId, toAssetCode: 'USDT', toAmount: new Prisma.Decimal(amount),
        exchangeRate: new Prisma.Decimal('1'),
      },
      select: { id: true, swapNo: true },
    });
  }

  async function openApprovalCaseFor(restrictionNo: string, actionType: string) {
    return prisma.approvalCase.findFirst({
      where: { actionType, entityRef: restrictionNo },
      orderBy: { createdAt: 'desc' },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // 全量 AppModule 往同名事件挂了远超 EventEmitter2 默认 maxListeners=10 的
    // handler，不抬高会在 init 时抛 possible-memory-leak（同 Task 10/12 harness）。
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    access = app.get(CustomerAccessService);
    restrictions = app.get(CustomerRestrictionsService);
    workflow = app.get(CustomerRestrictionWorkflowService);
    approvals = app.get(ApprovalsService);

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

    // admin JWT：base seed 的 SUPER_ADMIN，AdminPermissionGuard 对其直接放行。
    const admin = await prisma.user.findFirst({
      where: { email: 'admin@fiatx.com', deletedAt: null },
      select: { id: true, userNo: true, email: true },
    });
    if (!admin) {
      throw new Error('Seeded SUPER_ADMIN admin@fiatx.com not found — run `npm run db:base:sync` on the e2e DB.');
    }
    adminToken = jwt.sign({
      username: admin.email, sub: admin.id, role: 'SUPER_ADMIN', type: 'ADMIN', userNo: admin.userNo,
    });
  });

  // ── ① 多因并存不互相解 ──────────────────────────────────────────────
  // 这是整个设计存在的首要理由：旧模型单列 complianceStatus 存因，第二个原因
  // 到来即覆盖第一个，交材料自动解冻会把制裁一起解掉。
  it('① 先 SANCTION 后 MATERIAL_EXPIRED，交材料自动撕第二张，SANCTION 仍 OPEN 且全能力仍被禁', async () => {
    const c = await makeCustomer('multicause', 1);

    const sanction = await workflow.openRestriction(
      { customerId: c.id, cause: 'SANCTION', reason: 'Sanctions hit', caseRef: 'E2E-CASE-SANCTION-1', openedBy: SEED_ACTOR.userId },
      SEED_ACTOR,
    );
    const material = await workflow.openRestriction(
      { customerId: c.id, cause: 'MATERIAL_EXPIRED', reason: 'Passport expired', caseRef: 'E2E-CASE-MATERIAL-1', openedBy: SEED_ACTOR.userId },
      SEED_ACTOR,
    );
    expect(sanction.created).toBe(true);
    expect(material.created).toBe(true);

    // 幂等键 (customerId, cause, caseRef)：同因同案重复贴 = no-op。
    const again = await workflow.openRestriction(
      { customerId: c.id, cause: 'SANCTION', reason: 'Sanctions hit (dup)', caseRef: 'E2E-CASE-SANCTION-1', openedBy: SEED_ACTOR.userId },
      SEED_ACTOR,
    );
    expect(again).toEqual({ restrictionNo: sanction.restrictionNo, created: false });

    // 客户交了材料 → 材料侧自动撕自己那张（AUTO，不开审批）。
    await workflow.autoRelease(c.id, 'MATERIAL_EXPIRED', 'E2E-CASE-MATERIAL-1', 'E2E_MATERIAL_REFRESH');

    const all = await restrictions.listAll(c.id);
    const materialRow = all.find((r) => r.restrictionNo === material.restrictionNo);
    const sanctionRow = all.find((r) => r.restrictionNo === sanction.restrictionNo);
    expect(materialRow!.status).toBe('RELEASED');
    expect(materialRow!.releaseMode).toBe('AUTO');
    expect(sanctionRow!.status).toBe('OPEN');

    const acc = await access.resolve(c.id);
    expect([...acc.blocked].sort()).toEqual(['DEPOSIT', 'SWAP', 'WITHDRAW']);
    expect([...acc.disclosedBlocked]).toEqual([]);   // SANCTION 是 SILENT
    expect(acc.disclosed).toEqual([]);
    expect(acc.openCount).toBe(1);
  });

  // ── ② 零痕迹 ────────────────────────────────────────────────────────
  // 被制裁客户与正常客户的三个客户面响应体，归一化后必须逐字节相等。
  // 归一化只剔除"两个客户天然不同"的东西：各自的 id / customerNo / email /
  // phone / 各自订单号、以及所有 UUID 与时间戳。任何跟"有没有便签"相关的差异
  // 都不在剔除范围内 —— 那正是本用例要抓的东西。
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z/g;

  function sortDeep(value: any): any {
    if (Array.isArray(value)) return value.map(sortDeep);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((acc: any, k) => { acc[k] = sortDeep(value[k]); return acc; }, {});
    }
    return value;
  }

  function normalizeBody(raw: unknown, identity: Record<string, string>): string {
    let text = JSON.stringify(sortDeep(raw));
    // 长串先替换，避免短串是长串子串时把长串切碎（customerNo ⊂ iban 等）。
    for (const [token, value] of Object.entries(identity).sort((a, b) => b[1].length - a[1].length)) {
      if (value) text = text.split(value).join(`<${token}>`);
    }
    return text.replace(UUID_RE, '<UUID>').replace(ISO_RE, '<TS>');
  }

  it('② 零痕迹：SANCTION 客户与正常客户的 /onboarding/me、/client/me/restrictions、/deposit-transactions/my 归一化后逐字节相等', async () => {
    const silent = await makeCustomer('silent', 2);
    const clean = await makeCustomer('clean', 3);

    // 两边各一笔形状完全相同的在途充值 —— 贴 ALL 便签会把被制裁那笔冻成
    // FROZEN，客户面必须仍旧脱敏成同一个字符串（这条同时压住服务端脱敏）。
    const silentDep = await makeDeposit(silent, '5000');
    const cleanDep = await makeDeposit(clean, '5000');

    await workflow.openRestriction(
      { customerId: silent.id, cause: 'SANCTION', reason: 'Sanctions hit', caseRef: 'E2E-CASE-SANCTION-2', openedBy: SEED_ACTOR.userId },
      SEED_ACTOR,
    );

    // 前提校验：后端确实已经冻了，否则"两边一样"是因为什么都没发生。
    // 冻结走的是 { async: true } 的 detached handler，必须轮询而不是直接断言。
    await waitUntil(
      '被制裁客户的在途充值单已冻结',
      async () =>
        (await prisma.depositTransaction.findUnique({ where: { id: silentDep.id } }))!.status ===
        DepositTransactionStatus.FROZEN,
    );
    const silentAccess = await access.resolve(silent.id);
    expect([...silentAccess.blocked].sort()).toEqual(['DEPOSIT', 'SWAP', 'WITHDRAW']);

    const server = app.getHttpServer();
    const paths = ['/onboarding/me', '/client/me/restrictions', '/deposit-transactions/my'];

    for (const p of paths) {
      const a = await request(server).get(p).set('Authorization', `Bearer ${silent.token}`);
      const b = await request(server).get(p).set('Authorization', `Bearer ${clean.token}`);

      expect(a.status).toBe(b.status);
      expect(a.status).toBe(200);   // 被制裁客户不得被 403/423 挡 —— 状态码本身就是信号

      const na = normalizeBody(a.body, {
        CID: silent.id, CNO: silent.customerNo, EMAIL: silent.email,
        PHONE: silent.phone, ORDER: silentDep.depositNo,
      });
      const nb = normalizeBody(b.body, {
        CID: clean.id, CNO: clean.customerNo, EMAIL: clean.email,
        PHONE: clean.phone, ORDER: cleanDep.depositNo,
      });
      expect(`${p} :: ${na}`).toEqual(`${p} :: ${nb}`);
    }

    // 结构性保证：客户面 DTO 里根本没有承载 SILENT 的字段。
    const me = await request(server).get('/onboarding/me').set('Authorization', `Bearer ${silent.token}`);
    expect(me.body).not.toHaveProperty('blocked');
    expect(me.body).not.toHaveProperty('openCount');
    expect(me.body).not.toHaveProperty('onboardingStatus');
    expect(me.body).not.toHaveProperty('adminStatus');
    expect(me.body).not.toHaveProperty('complianceStatus');
    expect(me.body).not.toHaveProperty('restrictions');
    expect(me.body.lifecycle).toBe('ACTIVE');
    expect(me.body.disclosedBlocked).toEqual([]);
    expect(me.body.disclosed).toEqual([]);
  });

  // ── ③ 贴不审批，撕才审批 ─────────────────────────────────────────────
  it('③ POST 贴便签立即生效且无审批案；POST release 建审批案且便签仍 OPEN；批准后才撕', async () => {
    const c = await makeCustomer('ops-release', 4);
    const server = app.getHttpServer();

    const opened = await request(server)
      .post(`/admin/customers/${c.customerNo}/restrictions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cause: 'ADMIN_SUSPENSION', reason: 'Ops hold pending contract review' });
    expect(opened.status).toBe(201);
    const restrictionNo: string = opened.body.restrictionNo;
    expect(restrictionNo).toMatch(/^RST\d{10}$/);
    expect(opened.body.created).toBe(true);

    // 立即生效
    const afterOpen = await access.resolve(c.id);
    expect([...afterOpen.blocked].sort()).toEqual(['DEPOSIT', 'SWAP', 'WITHDRAW']);
    expect([...afterOpen.disclosedBlocked].sort()).toEqual(['DEPOSIT', 'SWAP', 'WITHDRAW']);
    expect(afterOpen.disclosed).toHaveLength(1);
    expect(afterOpen.disclosed[0].label).toBe('Account suspended');

    // 贴的时候不开审批案
    expect(await openApprovalCaseFor(restrictionNo, ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_OPS)).toBeNull();
    expect(await openApprovalCaseFor(restrictionNo, ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_MLRO)).toBeNull();

    // visibility / releasePolicy 由 cause 查表推出，入参给了就 400
    const forged = await request(server)
      .post(`/admin/customers/${c.customerNo}/restrictions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cause: 'ADMIN_SUSPENSION', reason: 'forged', visibility: 'SILENT' });
    expect(forged.status).toBe(400);

    // scopeSelectable=false 的 cause 传 scopes 也 400
    const forgedScope = await request(server)
      .post(`/admin/customers/${c.customerNo}/restrictions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cause: 'ADMIN_SUSPENSION', reason: 'forged', scopes: ['WITHDRAW'] });
    expect(forgedScope.status).toBe(400);

    // 撕：开审批案，便签保持 OPEN
    const released = await request(server)
      .post(`/admin/customers/${c.customerNo}/restrictions/${restrictionNo}/release`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Contract review cleared' });
    expect(released.status).toBe(201);
    expect(released.body.approvalNo).toMatch(/^APR\d{10}$/);

    const pending = await openApprovalCaseFor(restrictionNo, ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_OPS);
    expect(pending).toBeTruthy();
    expect(pending!.status).toBe('PENDING');
    expect(pending!.entityRef).toBe(restrictionNo);   // entityRef 是业务号不是 uuid
    expect((await restrictions.findByNo(restrictionNo))!.status).toBe('OPEN');
    expect([...(await access.resolve(c.id)).blocked].sort()).toEqual(['DEPOSIT', 'SWAP', 'WITHDRAW']);

    // OPS 批准 → 撕
    await approvals.approve(pending!.id, { reason: 'e2e approve' }, OPS_CHECKER);
    await waitUntil(
      `${restrictionNo} 被 OPS 批准后转 RELEASED`,
      async () => (await restrictions.findByNo(restrictionNo))?.status === 'RELEASED',
    );

    const torn = await restrictions.findByNo(restrictionNo);
    expect(torn!.status).toBe('RELEASED');
    expect(torn!.releaseMode).toBe('MANUAL');
    expect(torn!.releaseApprovalNo).toBe(released.body.approvalNo);
    expect((await access.resolve(c.id)).blocked.size).toBe(0);
  });

  // ── ④ MLRO 类缺 releaseOrderRef → 400 ───────────────────────────────
  it('④ SANCTION（MLRO_APPROVAL）发起解除时缺 releaseOrderRef 直接 400，不开审批案', async () => {
    const c = await makeCustomer('mlro-release', 5);
    const server = app.getHttpServer();

    const opened = await request(server)
      .post(`/admin/customers/${c.customerNo}/restrictions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cause: 'SANCTION', reason: 'Sanctions hit', caseRef: 'E2E-CASE-SANCTION-4' });
    expect(opened.status).toBe(201);
    const restrictionNo: string = opened.body.restrictionNo;

    const bad = await request(server)
      .post(`/admin/customers/${c.customerNo}/restrictions/${restrictionNo}/release`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Investigation closed' });
    expect(bad.status).toBe(400);
    expect(await openApprovalCaseFor(restrictionNo, ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_MLRO)).toBeNull();
    expect((await restrictions.findByNo(restrictionNo))!.status).toBe('OPEN');

    // 带上 releaseOrderRef 就能开案（证明 400 是缺字段所致，不是路由/权限坏了）
    const good = await request(server)
      .post(`/admin/customers/${c.customerNo}/restrictions/${restrictionNo}/release`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Investigation closed', releaseOrderRef: 'MLRO-ORDER-2026-0042' });
    expect(good.status).toBe(201);
    const pending = await openApprovalCaseFor(restrictionNo, ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_MLRO);
    expect(pending!.status).toBe('PENDING');

    await approvals.approve(pending!.id, { reason: 'e2e approve' }, MLRO_CHECKER);
    await waitUntil(
      `${restrictionNo} 被 MLRO 批准后转 RELEASED`,
      async () => (await restrictions.findByNo(restrictionNo))?.status === 'RELEASED',
    );
    const torn = await restrictions.findByNo(restrictionNo);
    expect(torn!.status).toBe('RELEASED');
    expect(torn!.releaseOrderRef).toBe('MLRO-ORDER-2026-0042');
  });

  // ── ⑤ 贴 ALL 摁住在途单（三域 —— spec §3.5）─────────────────────────
  it('⑤ 三域各一笔在途单 → 贴 SANCTION（scope=ALL）→ 充值/提现冻结，兑换停腿留审计', async () => {
    const c = await makeCustomer('freeze-inflight', 6);
    const dep = await makeDeposit(c, '7000');
    const wd = await makeWithdraw(c, '600');
    const sw = await makeSwap(c, '900');

    await workflow.openRestriction(
      { customerId: c.id, cause: 'SANCTION', reason: 'Sanctions hit', caseRef: 'E2E-CASE-SANCTION-5', openedBy: SEED_ACTOR.userId },
      SEED_ACTOR,
    );

    await waitUntil(
      '充值单被冻结',
      async () =>
        (await prisma.depositTransaction.findUnique({ where: { id: dep.id } }))!.status ===
        DepositTransactionStatus.FROZEN,
    );
    await waitUntil(
      '提现单被冻结',
      async () =>
        (await prisma.withdrawTransaction.findUnique({ where: { id: wd.id } }))!.status ===
        WithdrawTransactionStatus.FROZEN,
    );

    // 兑换：spec §3.5 对兑换的操作性指令是「复刻提现范式，在 onLegConfirmed() 前加
    // 客户级闸」——落地成 assertSwapCustomerAccessOrHalt()：拦住推腿 + 写一条
    // SWAP_LEG_HALTED_BY_RESTRICTION 审计，**不新增 SwapTransactionStatus.FROZEN**
    // （该状态从未设计过，兑换域也没有这条状态机边）。所以这里断言实际契约：
    // 单子状态不动，但闸留下了痕迹。
    // ⚠️ 由此带来的可观测性缺口（运营在兑换列表上看不出这单已被摁住，只能翻审计）
    // 已登记 BACKLOG。
    await waitUntil(
      '兑换推腿被客户级闸拦下并留审计',
      async () =>
        (await prisma.auditLogEvent.count({
          where: {
            entityId: sw.id,
            action: AuditActions.SWAP_LEG_HALTED_BY_RESTRICTION,
          },
        })) > 0,
    );
    expect((await prisma.swapTransaction.findUnique({ where: { id: sw.id } }))!.status).not.toBe(
      'FROZEN',
    );
  });

  // ── ⑥ scope < ALL 不动在途单 ────────────────────────────────────────
  // 材料过期不该把已经在途的提现拽回来 —— 只挡新单，不动旧单。
  it('⑥ 贴 MATERIAL_EXPIRED（WITHDRAW+SWAP）→ 三笔在途单状态一律不变', async () => {
    const c = await makeCustomer('no-freeze-inflight', 7);
    const dep = await makeDeposit(c, '7000');
    const wd = await makeWithdraw(c, '600');
    const sw = await makeSwap(c, '900');

    await workflow.openRestriction(
      { customerId: c.id, cause: 'MATERIAL_EXPIRED', reason: 'Passport expired', caseRef: 'E2E-CASE-MATERIAL-6', openedBy: SEED_ACTOR.userId },
      SEED_ACTOR,
    );

    expect((await prisma.depositTransaction.findUnique({ where: { id: dep.id } }))!.status)
      .toBe(DepositTransactionStatus.COMPLIANCE_PENDING);
    expect((await prisma.withdrawTransaction.findUnique({ where: { id: wd.id } }))!.status)
      .toBe(WithdrawTransactionStatus.COMPLIANCE_PENDING);
    expect((await prisma.swapTransaction.findUnique({ where: { id: sw.id } }))!.status)
      .toBe(SwapTransactionStatus.COMPLIANCE_PENDING);

    // 但新单方向确实被挡住了（在途不动 ≠ 没生效）
    const acc = await access.resolve(c.id);
    expect([...acc.blocked].sort()).toEqual(['SWAP', 'WITHDRAW']);
    expect([...acc.disclosedBlocked].sort()).toEqual(['SWAP', 'WITHDRAW']);
    expect(acc.disclosed[0].label).toBe('Document expired');
    await expect(access.assertCapability(c.id, 'WITHDRAW')).rejects.toMatchObject({
      response: { code: 'CAPABILITY_RESTRICTED' },
    });
    await expect(access.assertCapability(c.id, 'DEPOSIT')).resolves.toBeUndefined();
  });

  /**
   * 三处 @OnEvent 都是 { async: true }（撕便签的审批回调、三域的在途单冻结），
   * emit 立即返回、handler detached 跑完。直接断言等于跟事件循环赛跑，故轮询。
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

  afterAll(async () => {
    await app?.close();
  });
});
