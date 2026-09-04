import { ConflictException } from '@nestjs/common';
import { SwapFeeLevelRetireWorkflowService } from './swap-fee-level-retire-workflow.service';
import { AuditOutcome } from '../../audit-logging/dto/audit-log.dto';

const RETIRED = 'SWAP_FEE_LEVEL_RETIRED';

describe('SwapFeeLevelRetireWorkflowService（波一 T11 修复轮：落地时复检）', () => {
  let svc: SwapFeeLevelRetireWorkflowService;

  const feeLevelService = {
    findByLevelCode: jest.fn(),
    assertNotLastActiveDefault: jest.fn(),
    retireLevel: jest.fn(),
    linkApprovalCase: jest.fn(),
    clearApprovalCase: jest.fn(),
  } as any;
  const approvalsService = {
    createAndSubmit: jest.fn(),
  } as any;
  const auditLogsService = {
    recordByActor: jest.fn(),
    recordSystem: jest.fn(),
  } as any;

  const recordedFor = (action: string) =>
    auditLogsService.recordSystem.mock.calls.find((c: any[]) => c[0].action === action)?.[0];

  const level = (over: Record<string, any> = {}) => ({
    id: 'lvl-1',
    levelCode: 'SFL-STD',
    isDefault: true,
    fromAssetId: 'a1',
    toAssetId: 'a2',
    ...over,
  });

  const decidedEvent = (over: Record<string, any> = {}) => ({
    decision: 'APPROVED',
    entityRef: 'SFL-STD',
    approvalId: 'ap1',
    approvalNo: 'AP-1',
    traceId: 'trace-1',
    decisionByUserNo: 'USR-1',
    ...over,
  } as any);

  beforeEach(() => {
    jest.resetAllMocks();
    svc = new SwapFeeLevelRetireWorkflowService(feeLevelService, approvalsService, auditLogsService);
  });

  it('executeRetire：落地时复检撞回最后一个 ACTIVE 默认档 → 不退，retireLevel 不调用，FAILED 审计带 LAST_ACTIVE_DEFAULT', async () => {
    feeLevelService.findByLevelCode.mockResolvedValue(level());
    feeLevelService.assertNotLastActiveDefault.mockRejectedValue(
      new ConflictException({ code: 'LAST_ACTIVE_DEFAULT', message: 'SFL-STD is the last active default level for this pair and cannot be retired' }),
    );

    await svc.onDecided(decidedEvent());

    expect(feeLevelService.retireLevel).not.toHaveBeenCalled();
    const audit = recordedFor(RETIRED);
    expect(audit).toBeTruthy();
    expect(audit.outcome).toBe(AuditOutcome.FAILED);
    expect(audit.reasonCode).toBe('LAST_ACTIVE_DEFAULT');
    expect(audit.reason).toMatch(/last active default/);
  });

  it('executeRetire：该币对还有另一个 ACTIVE 默认档 → 复检通过，正常退役，SUCCESS 审计', async () => {
    feeLevelService.findByLevelCode.mockResolvedValue(level());
    feeLevelService.assertNotLastActiveDefault.mockResolvedValue(undefined);
    feeLevelService.retireLevel.mockResolvedValue(undefined);

    await svc.onDecided(decidedEvent());

    expect(feeLevelService.assertNotLastActiveDefault).toHaveBeenCalledWith(level());
    expect(feeLevelService.retireLevel).toHaveBeenCalledWith('SFL-STD');
    const audit = recordedFor(RETIRED);
    expect(audit).toBeTruthy();
    expect(audit.outcome).toBe(AuditOutcome.SUCCESS);
  });
});
