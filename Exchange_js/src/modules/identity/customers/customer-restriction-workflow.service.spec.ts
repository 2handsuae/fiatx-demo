import { CustomerRestrictionWorkflowService } from './customer-restriction-workflow.service';

describe('CustomerRestrictionWorkflowService.autoRelease', () => {
  const buildWf = () => {
    const restrictionsService = {
      open: jest.fn(),
      release: jest.fn(),
      findOpenByCause: jest.fn(),
      findByNo: jest.fn(),
      listOpen: jest.fn(),
      listAll: jest.fn(),
    } as any;
    // Task 10：编排层追加审批侧后，构造函数从 1 参变 3 参。
    const approvalsService = { createAndSubmit: jest.fn(), list: jest.fn() } as any;
    const auditLogsService = {
      recordSystem: jest.fn().mockResolvedValue(undefined),
      recordByActor: jest.fn().mockResolvedValue(undefined),
    } as any;
    return {
      wf: new CustomerRestrictionWorkflowService(restrictionsService, approvalsService, auditLogsService),
      restrictionsService,
      approvalsService,
      auditLogsService,
    };
  };

  it('releases exactly the matching restriction, with mode AUTO', async () => {
    const { wf, restrictionsService } = buildWf();
    restrictionsService.findOpenByCause.mockResolvedValue({ restrictionNo: 'RST2608160002' });

    await wf.autoRelease('cust-1', 'MATERIAL_EXPIRED', 'MRC26073100xx', 'system');

    expect(restrictionsService.findOpenByCause).toHaveBeenCalledWith(
      'cust-1', 'MATERIAL_EXPIRED', 'MRC26073100xx',
    );
    expect(restrictionsService.release).toHaveBeenCalledWith('RST2608160002', {
      releasedBy: 'system',
      releaseMode: 'AUTO',
    });
    expect(restrictionsService.release).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when no matching OPEN restriction exists (idempotent webhook replay)', async () => {
    const { wf, restrictionsService } = buildWf();
    restrictionsService.findOpenByCause.mockResolvedValue(null);

    await wf.autoRelease('cust-1', 'KYT_REJECTED_SOFT', 'SW2608160001', 'system');

    expect(restrictionsService.release).not.toHaveBeenCalled();
  });
});
