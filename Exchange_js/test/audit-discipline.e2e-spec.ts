import request from 'supertest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { ApprovalsService } from '../src/modules/governance/approvals/approvals.service';
import {
  ApprovalActorContext,
  ApprovalStatuses,
  ApprovalStepStatuses,
} from '../src/modules/governance/approvals/constants/approval.constants';

/**
 * 法一纪律 1：审计去重钥匙 = sha256(域|码|主体类型|主体号|旅程号|请求号)
 * （audit-logs.service.ts buildIdempotencyKey/createEventWithUniqueNo）。四个裁决写
 * 入点此前不带 requestId，同案两票会拼出同一把钥匙，第二票被幂等命中悄悄吞掉。
 * DEPOSIT_SEIZE 是现役唯一两步策略（SMO→MLRO），受害最直接：MLRO 的终票此前在
 * 审计表里根本不存在。
 */
describe('审批裁决审计留痕纪律（铁律① 操作必留痕）', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let approvalsService: ApprovalsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // 见 approval-expiry.e2e-spec.ts 同款注释：AppModule 挂了大量共享事件名的
    // @OnEvent handler，超过 EventEmitter2 默认 maxListeners=10 时「possible memory
    // leak」警告会被抛成异常而不是打印警告。app.init() 之前把上限提高。
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();
    prisma = app.get(PrismaService);
    approvalsService = app.get(ApprovalsService);
  });
  afterAll(async () => { await app.close(); });

  async function actorFor(email: string, role: string): Promise<ApprovalActorContext> {
    // User.email 无唯一约束（schema 现状），只能 findFirstOrThrow。
    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    return {
      actorType: 'ADMIN',
      userId: user.id,
      userNo: user.userNo,
      role,
      roleCodes: [role],
    };
  }

  it('两步审批的两票各留一行 APPROVAL_GRANTED（第二票不被去重吞掉）', async () => {
    const approvalNo = `APR-AUDITDISC-${Date.now()}`;
    const traceId = `trace-auditdisc-${Date.now()}`;
    const created = await prisma.approvalCase.create({
      data: {
        approvalNo,
        actionType: 'DEPOSIT_SEIZE',
        entityRef: 'AUDITDISC-ENTITY-NOT-A-REAL-DEPOSIT',
        createdByUserId: 'test-maker-user',
        status: ApprovalStatuses.PENDING,
        traceId,
      },
    });
    await prisma.approvalStep.createMany({
      data: [
        {
          approvalCaseId: created.id,
          stepNo: 1,
          status: ApprovalStepStatuses.PENDING,
          checkerRoleCandidates: 'SENIOR_MANAGEMENT_OFFICER',
        },
        {
          approvalCaseId: created.id,
          stepNo: 2,
          status: ApprovalStepStatuses.PENDING,
          checkerRoleCandidates: 'MLRO',
        },
      ],
    });

    // DEPOSIT_SEIZE 现役两步策略：stepNo 1 = SENIOR_MANAGEMENT_OFFICER，stepNo 2 =
    // MLRO（approval.constants.ts DEFAULT_APPROVAL_POLICIES）。种子账号 sm@/mlro@。
    const actorSm = await actorFor('sm@fiatx.com', 'SENIOR_MANAGEMENT_OFFICER');
    const actorMlro = await actorFor('mlro@fiatx.com', 'MLRO');

    // 第一票：SMO 签第一步，案子仍 PENDING（还有第二步待签）。
    await approvalsService.approve(created.approvalNo, { reason: 'SMO first vote' }, actorSm);
    // 第二票：MLRO 签第二步（末票），案子推 APPROVED。此案 actionType=DEPOSIT_SEIZE，
    // 批准后会发 workflow.deposit-seize.decided 事件；entityRef 不对应真实存款单
    // （既不是 id 也不是 depositNo），deposit-workflow 的 handler 会 findOneByNo
    // 抛 NotFoundException 并静默吞掉（容错分支，见 deposit-workflow.service.ts
    // onSeizeDecided），不影响这里的断言。
    await approvalsService.approve(created.approvalNo, { reason: 'MLRO final vote' }, actorMlro);

    const grantedRows = await prisma.auditLogEvent.findMany({
      where: { action: 'APPROVAL_GRANTED', primarySubjectNo: approvalNo },
    });
    expect(grantedRows.length).toBe(2);
  });
});

/**
 * 法一纪律 4：权限守卫 403 留痕。SoD 拒绝（上面那组用例）早就写审计，唯独
 * admin-permission.guard.ts 的两个 deny 抛点（缺权限组 / 权限码不在 catalog）
 * 108 行零审计——管理台里最常触发的那种拒绝反而是唯一沉默的一种。业主裁定：记
 * ADMIN_ACCESS_DENIED（admin-permission.guard.ts recordDenied）。
 */
describe('权限守卫拒绝留痕纪律（法一纪律4 ADMIN_ACCESS_DENIED）', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });

  it('auditor@（INTERNAL_AUDITOR，只读）打 POST /admin/reconciliation/runs/wallet → 403 且留一行 ADMIN_ACCESS_DENIED', async () => {
    // INTERNAL_AUDITOR 只有 RECON_RUN_READ，没有本端点要求的 RECON_RUN_WRITE
    // （rbac.catalog.ts route('POST', '/admin/reconciliation/runs/wallet', ...,
    // ['RECON_RUN_WRITE'])）——注定落进 missing 分支，不是 catalog 外分支。
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'auditor@fiatx.com', password: '123456' });
    expect(loginRes.status).toBe(200);
    const token = loginRes.body?.access_token;
    expect(typeof token).toBe('string');

    const auditor = await prisma.user.findFirstOrThrow({ where: { email: 'auditor@fiatx.com' } });

    const before = new Date();
    const res = await request(app.getHttpServer())
      .post('/admin/reconciliation/runs/wallet')
      .set('Authorization', `Bearer ${token}`)
      .send({ cutoff: new Date().toISOString() });
    expect(res.status).toBe(403);

    // 三断言：留痕的码、留痕的人（ADM 业务号，不是 UUID）、留痕的机器可读原因。
    const row = await prisma.auditLogEvent.findFirst({
      where: { action: 'ADMIN_ACCESS_DENIED', actorNo: auditor.userNo, recordedAt: { gte: before } },
      orderBy: { recordedAt: 'desc' },
    });
    expect(row).not.toBeNull();
    expect(row?.actorNo).toBe(auditor.userNo);
    expect(row?.reasonCode).toBe('MISSING_PERMISSION');
  });
});

/**
 * 铁律⑥ 对外用业务键：审批详情端点已从 `:id`（内部 UUID）改为 `:approvalNo`
 * （业务号，Task 17）——approve/reject/cancel/getById 四个对外方法同批切换，
 * 这里挑最容易走查的 GET 详情端点做行为断言：拿业务号打得通，拿内部 UUID
 * 打不通（404），不是「顺便也认」的兼容读法。
 */
describe('审批端点对外识别（铁律⑥ 对外用业务键）', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });

  async function loginAs(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: '123456' });
    expect(res.status).toBe(200);
    return res.body?.access_token;
  }

  async function req(path: string, token: string) {
    return request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`);
  }

  it('审批端点收业务号；拿 UUID 打 → 404', async () => {
    const c = await prisma.approvalCase.create({
      data: {
        approvalNo: `APR-KEY-${Date.now()}`,
        actionType: 'SWAP_FEE_LEVEL_CHANGE',
        entityRef: 'E',
        createdByUserId: 'u',
        status: 'PENDING',
        traceId: `t-${Date.now()}`,
      },
    });
    const token = await loginAs('ciso@fiatx.com');
    expect((await req(`/admin/control-gates/approvals/${c.approvalNo}`, token)).status).toBe(200);
    expect((await req(`/admin/control-gates/approvals/${c.id}`, token)).status).toBe(404);
  });
});

/**
 * 铁律⑥ 对外用业务键：成员详情端点已从 `:id`（内部 UUID）改为 `:userNo`，
 * 钱包详情端点已从 `:id` 改为 `:walletNo`（业务号，Task 18）——同 Task 17 审批
 * 端点的验证方式：拿业务号打得通，拿内部 UUID 打不通（404）。treasury@ 是唯一
 * 同时持有 IAM_MEMBER_READ 与 WALLET_READ 的职务（rbac.catalog.ts
 * TREASURY_OFFICER 绑定），两条断言共用一次登录。
 */
describe('成员 / 钱包端点对外识别（铁律⑥ 对外用业务键）', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });

  async function loginAs(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: '123456' });
    expect(res.status).toBe(200);
    return res.body?.access_token;
  }

  async function req(path: string, token: string) {
    return request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`);
  }

  it('成员详情端点收 userNo；拿 UUID 打 → 404', async () => {
    const member = await prisma.user.create({
      data: {
        userNo: `ADM-KEY-${Date.now()}`,
        email: `audit-disc-key-${Date.now()}@fiatx.com`,
        password: 'not-a-real-hash',
        role: 'CISO',
        status: 'ACTIVE',
      },
    });
    const token = await loginAs('treasury@fiatx.com');
    expect((await req(`/users/${member.userNo}`, token)).status).toBe(200);
    expect((await req(`/users/${member.id}`, token)).status).toBe(404);
  });

  it('钱包详情端点收 walletNo；拿 UUID 打 → 404', async () => {
    const asset = await prisma.asset.findFirstOrThrow();
    const wallet = await prisma.wallet.create({
      data: {
        walletNo: `WA-KEY-${Date.now()}`,
        ownerType: 'PLATFORM',
        type: 'FIAT_BANK',
        assetId: asset.id,
      },
    });
    const token = await loginAs('treasury@fiatx.com');
    expect((await req(`/wallets/${wallet.walletNo}`, token)).status).toBe(200);
    expect((await req(`/wallets/${wallet.id}`, token)).status).toBe(404);
  });
});
