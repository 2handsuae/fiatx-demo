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
    await approvalsService.approve(created.id, { reason: 'SMO first vote' }, actorSm);
    // 第二票：MLRO 签第二步（末票），案子推 APPROVED。此案 actionType=DEPOSIT_SEIZE，
    // 批准后会发 workflow.deposit-seize.decided 事件；entityRef 不对应真实存款单，
    // deposit-workflow 的 handler 会 findOne 抛 NotFoundException 并静默吞掉（容错
    // 分支，见 deposit-workflow.service.ts onSeizeDecided），不影响这里的断言。
    await approvalsService.approve(created.id, { reason: 'MLRO final vote' }, actorMlro);

    const grantedRows = await prisma.auditLogEvent.findMany({
      where: { action: 'APPROVAL_GRANTED', primarySubjectNo: approvalNo },
    });
    expect(grantedRows.length).toBe(2);
  });
});
