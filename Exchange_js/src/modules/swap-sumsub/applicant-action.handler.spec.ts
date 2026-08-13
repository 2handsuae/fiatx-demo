import { SwapApplicantActionHandler } from './applicant-action.handler';
import { CustomerPendingActionService } from '../identity/customers/customer-pending-action.service';
import { CustomerRestrictionsService } from '../identity/customers/customer-restrictions.service';
import { AuditLogsService } from '../audit-logging/audit-logs.service';
import { AuditActions } from '../audit-logging/constants/audit-actions.constant';

/**
 * Task 13: 人级 applicantActionReviewed 闭环 —— mirror of
 * swap-kyt-verdict.handler.spec.ts 的手搓 mock 风格（绕过 Nest DI）。四条用例
 * 取自 task-13-brief.md Step 1：GREEN 清限制 / GREEN 但硬线不解锁 / RED 升级 /
 * 认领不到返回 false。
 *
 * 与 brief 里的 pseudocode 的一处出入：`auditLogsService.recordSystem` 在本
 * handler 里只传一个参数（不带事务 client）——这里没有本地开的
 * `prisma.$transaction`：CustomerMain 的两次写入（clear限制 / set pendingAction）
 * 都经由已存在的 identity/customers 服务方法完成（架构规则禁止 handler 直碰
 * CustomerMain 表），这两个方法都不接受外部 tx client，因此没有可传的事务
 * 句柄。故断言只匹配第一个参数。
 *
 * 终审补测（Finding 1/2/3）：真实字段名 externalApplicantActionId 认领 /
 * 空 id 不查库不认领 / 审计先于"消费认领"落地（GREEN 两条分支各一个用例）。
 */
describe('SwapApplicantActionHandler', () => {
  let pendingActionService: jest.Mocked<CustomerPendingActionService>;
  let restrictionsService: jest.Mocked<CustomerRestrictionsService>;
  let auditLogsService: jest.Mocked<AuditLogsService>;
  let handler: SwapApplicantActionHandler;

  beforeEach(() => {
    pendingActionService = {
      findByExternalActionId: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CustomerPendingActionService>;

    restrictionsService = {
      clear: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CustomerRestrictionsService>;

    auditLogsService = {
      recordSystem: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditLogsService>;

    handler = new SwapApplicantActionHandler(
      pendingActionService,
      restrictionsService,
      auditLogsService,
    );
  });

  it('GREEN + 非硬线 → 清 SWAP/WITHDRAW 限制 + 清 pendingAction', async () => {
    pendingActionService.findByExternalActionId.mockResolvedValue({
      id: 'c1',
      customerNo: 'C-001',
      hardLineDispositionedAt: null,
    } as any);

    const hit = await handler.handle({
      type: 'applicantActionReviewed',
      externalActionId: 'EA1',
      reviewResult: { reviewAnswer: 'GREEN' },
    });

    expect(hit).toBe(true);
    expect(restrictionsService.clear).toHaveBeenCalledWith(
      'c1',
      ['SWAP', 'WITHDRAW'],
      'system',
    );
    expect(pendingActionService.set).toHaveBeenCalledWith('c1', null, expect.anything());
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditActions.SWAP_ACTION_CLEARED }),
    );
  });

  it('GREEN + 硬线客户 → 【不】清限制，只清 pendingAction，并审计说明', async () => {
    pendingActionService.findByExternalActionId.mockResolvedValue({
      id: 'c1',
      customerNo: 'C-001',
      hardLineDispositionedAt: new Date(),
    } as any);

    const hit = await handler.handle({
      type: 'applicantActionReviewed',
      externalActionId: 'EA1',
      reviewResult: { reviewAnswer: 'GREEN' },
    });

    expect(hit).toBe(true);
    expect(restrictionsService.clear).not.toHaveBeenCalled();
    expect(pendingActionService.set).toHaveBeenCalledWith('c1', null, expect.anything());
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditActions.SWAP_ACTION_GREEN_HARDLINE_HELD }),
    );
  });

  it('RED → 限制保持 + needsReview 升级审计', async () => {
    pendingActionService.findByExternalActionId.mockResolvedValue({
      id: 'c1',
      customerNo: 'C-001',
      hardLineDispositionedAt: null,
    } as any);

    const hit = await handler.handle({
      type: 'applicantActionReviewed',
      externalActionId: 'EA1',
      reviewResult: { reviewAnswer: 'RED' },
    });

    expect(hit).toBe(true);
    expect(restrictionsService.clear).not.toHaveBeenCalled();
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditActions.SWAP_ACTION_ESCALATED }),
    );
  });

  it('认领不到客户 → 返回 false 让级联继续', async () => {
    pendingActionService.findByExternalActionId.mockResolvedValue(null);

    const hit = await handler.handle({
      type: 'applicantActionReviewed',
      externalActionId: 'ZZZ',
      reviewResult: { reviewAnswer: 'GREEN' },
    });

    expect(hit).toBe(false);
    expect(restrictionsService.clear).not.toHaveBeenCalled();
    expect(pendingActionService.set).not.toHaveBeenCalled();
    expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
  });

  // ── Finding 1（终审 Critical）：真实 webhook 字段是 externalApplicantActionId ──
  it('只带 externalApplicantActionId（真实 Sumsub webhook 字段，不带 externalActionId）→ 仍能认领客户', async () => {
    pendingActionService.findByExternalActionId.mockResolvedValue({
      id: 'c1',
      customerNo: 'C-001',
      hardLineDispositionedAt: null,
    } as any);

    const hit = await handler.handle({
      type: 'applicantActionReviewed',
      externalApplicantActionId: 'EA1',
      reviewResult: { reviewAnswer: 'GREEN' },
    });

    expect(hit).toBe(true);
    expect(pendingActionService.findByExternalActionId).toHaveBeenCalledWith('EA1');
    expect(restrictionsService.clear).toHaveBeenCalledWith(
      'c1',
      ['SWAP', 'WITHDRAW'],
      'system',
    );
  });

  // ── Finding 2（终审 Important）：空 id 不得拿去查库、不得认领任何客户 ──
  it('externalApplicantActionId 与 externalActionId 都缺失（解析出空串）→ 返回 false，不查库', async () => {
    const hit = await handler.handle({
      type: 'applicantActionReviewed',
      reviewResult: { reviewAnswer: 'GREEN' },
    });

    expect(hit).toBe(false);
    expect(pendingActionService.findByExternalActionId).not.toHaveBeenCalled();
    expect(restrictionsService.clear).not.toHaveBeenCalled();
    expect(pendingActionService.set).not.toHaveBeenCalled();
    expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
  });

  // ── Finding 3（终审 Important）：审计必须先于"消费认领"（清 pendingAction 指针）落地 ──
  it('GREEN + 硬线：审计写在清 pendingAction 指针（消费认领）之前', async () => {
    pendingActionService.findByExternalActionId.mockResolvedValue({
      id: 'c1',
      customerNo: 'C-001',
      hardLineDispositionedAt: new Date(),
    } as any);
    const callOrder: string[] = [];
    auditLogsService.recordSystem.mockImplementation(async () => {
      callOrder.push('audit');
      return undefined as any;
    });
    pendingActionService.set.mockImplementation(async () => {
      callOrder.push('set');
    });

    await handler.handle({
      type: 'applicantActionReviewed',
      externalActionId: 'EA1',
      reviewResult: { reviewAnswer: 'GREEN' },
    });

    expect(callOrder).toEqual(['audit', 'set']);
  });

  it('GREEN + 非硬线：审计写在清 pendingAction 指针（消费认领）之前', async () => {
    pendingActionService.findByExternalActionId.mockResolvedValue({
      id: 'c1',
      customerNo: 'C-001',
      hardLineDispositionedAt: null,
    } as any);
    const callOrder: string[] = [];
    auditLogsService.recordSystem.mockImplementation(async () => {
      callOrder.push('audit');
      return undefined as any;
    });
    pendingActionService.set.mockImplementation(async () => {
      callOrder.push('set');
    });

    await handler.handle({
      type: 'applicantActionReviewed',
      externalActionId: 'EA1',
      reviewResult: { reviewAnswer: 'GREEN' },
    });

    expect(callOrder.indexOf('audit')).toBeLessThan(callOrder.indexOf('set'));
  });
});
