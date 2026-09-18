import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppModule } from '../../../app.module';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { InviteExpiryService } from './invite-expiry.service';

describe('邀请过期清扫（ADMIN_INVITE_EXPIRED 从死码活过来）', () => {
  let app: INestApplication;
  let prisma: PrismaService & Record<string, any>;
  let expiry: InviteExpiryService;

  beforeAll(async () => {
    // 结构照抄 test/approval-expiry.e2e-spec.ts（同批治愈计划 Task 1）：用完整
    // AppModule 而非手拼子集。已查证：AuditLogsModule 自身 imports 是空数组，
    // 但它的 provider AuditEvidenceExportWorkflowService 要注入 ApprovalsService，
    // 只有在 AppModule 整图里才解得出来——手拼 [UsersModule, AuditLogsModule]
    // 会在 compile() 报 DI 解析失败。这是既有代码的模块声明缺口，与本任务无关，不在此修。
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // 同 approval-expiry e2e-spec 的注释：本模块图里挂了不少共享事件名的
    // @OnEvent handler，超过 EventEmitter2 默认 maxListeners=10 会被这套
    // Jest/Node 组合抛成异常而非警告。app.init() 前把上限提高。
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();
    prisma = app.get(PrismaService);
    expiry = app.get(InviteExpiryService);
  });

  afterAll(async () => {
    await app.close();
  });

  const mkUser = async (suffix: string) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return prisma.user.create({
      data: {
        userNo: `ADM-INVEXP-${suffix}-${unique}`,
        email: `invite-expiry-${suffix}-${unique}@test.local`,
        password: 'test-hash',
        role: 'CISO',
        status: 'PENDING_INVITE_APPROVAL',
      },
    });
  };

  // 字段集照 admin-invitations.service.ts:151-169 createInvitationRecord。
  // traceId 必须给真值：ADMIN_INVITE_EXPIRED 是 INHERIT 型审计动作，
  // sweepExpiredInvites() 靠它读回 correlationId，读到 null 会直接拒绝
  // （见 admin-invite-workflow.service.ts 注释：不允许静默生成新值）。
  const mkInvitation = (userId: string, suffix: string, expiresAt: Date) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return prisma.adminUserInvitation.create({
      data: {
        userId,
        token: `token-${suffix}-${unique}`,
        tokenHash: `hash-${suffix}-${unique}`,
        expiresAt,
        traceId: `trace-${suffix}-${unique}`,
      },
    });
  };

  it('expiresAt 已过的 PENDING 邀请行，扫一轮后打 expiredAt（不碰 revokedAt）并留痕 ADMIN_INVITE_EXPIRED', async () => {
    const user = await mkUser('DUE');
    const invitation = await mkInvitation(user.id, 'DUE', new Date(Date.now() - 60_000));

    await expiry.sweep();

    const after = await prisma.adminUserInvitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });
    expect(after.expiredAt).not.toBeNull();
    // 自然过期与管理员人工撤销分列两根柱子：sweep 只能盖 expiredAt，revokedAt 永远
    // 留给人工撤销专用，两者不许共用一列（否则派生态会把自然过期误判成 REVOKED）。
    expect(after.revokedAt).toBeNull();
    expect(after.consumedAt).toBeNull();

    const auditRow = await prisma.auditLogEvent.findFirst({
      where: { action: 'ADMIN_INVITE_EXPIRED', primarySubjectNo: user.userNo },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.outcome).toBe('SUCCESS');
    // INHERIT 约定：correlationId 必须原样继承邀请行自己的 traceId，不能是新生成的值。
    expect(auditRow?.correlationId).toBe(invitation.traceId);
  });

  it('expiresAt 未到的 PENDING 邀请行，扫描器不碰', async () => {
    const user = await mkUser('FUTURE');
    const invitation = await mkInvitation(user.id, 'FUTURE', new Date(Date.now() + 3_600_000));

    await expiry.sweep();

    const after = await prisma.adminUserInvitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });
    expect(after.revokedAt).toBeNull();
    expect(after.expiredAt).toBeNull();

    const auditRow = await prisma.auditLogEvent.findFirst({
      where: { action: 'ADMIN_INVITE_EXPIRED', primarySubjectNo: user.userNo },
    });
    expect(auditRow).toBeNull();
  });
});
