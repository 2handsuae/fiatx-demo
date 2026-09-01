import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { ApprovalExpiryService } from '../src/modules/governance/approvals/approval-expiry.service';
import { ApprovalsService } from '../src/modules/governance/approvals/approvals.service';
import { ApprovalStatuses } from '../src/modules/governance/approvals/constants/approval.constants';

describe('审批超时门（⑥ 门不可绕）', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let expiry: ApprovalExpiryService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // 见 sla.e2e-spec.ts 同款注释：AppModule 挂了大量共享事件名的 @OnEvent handler，
    // 超过 EventEmitter2 默认 maxListeners=10 时，这套 Jest/Node 组合下「possible
    // memory leak」警告会被抛成异常而不是打印警告。app.init() 之前把上限提高。
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();
    prisma = app.get(PrismaService);
    expiry = app.get(ApprovalExpiryService);
  });
  afterAll(async () => { await app.close(); });

  const mk = (suffix: string, timeoutAt: Date) =>
    prisma.approvalCase.create({
      data: {
        approvalNo: `APR-EXPIRY-${suffix}-${Date.now()}`,
        actionType: 'SWAP_FEE_LEVEL_CHANGE', entityRef: 'TEST', createdByUserId: 'test-user',
        status: ApprovalStatuses.PENDING, traceId: `trace-${suffix}-${Date.now()}`, timeoutAt,
      },
    });

  it('timeoutAt 已过的 PENDING 单，扫一轮后变 EXPIRED', async () => {
    const c = await mk('DUE', new Date(Date.now() - 60_000));
    await expiry.sweep();
    const after = await prisma.approvalCase.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.status).toBe(ApprovalStatuses.EXPIRED);
  });

  it('timeoutAt 未到的 PENDING 单，扫描器不碰', async () => {
    const c = await mk('FUTURE', new Date(Date.now() + 3_600_000));
    await expiry.sweep();
    const after = await prisma.approvalCase.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.status).toBe(ApprovalStatuses.PENDING);
  });

  it('⚡ 拨到过去后，下一轮扫描该单即过期', async () => {
    const approvalsService = app.get(ApprovalsService);
    const c = await mk('SIM', new Date(Date.now() + 48 * 3_600_000));
    await approvalsService.simulateTimeoutByNo(c.approvalNo);
    await expiry.sweep();
    const after = await prisma.approvalCase.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.status).toBe(ApprovalStatuses.EXPIRED);
  });
});
