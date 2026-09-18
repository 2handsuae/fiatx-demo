import { ConflictException } from '@nestjs/common';
import { AssetSuspensionWorkflowService } from './asset-suspension-workflow.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';

describe('AssetSuspensionWorkflowService', () => {
  let prisma: any;
  let assetsService: any;
  let approvalsService: any;
  let auditLogsService: any;
  let service: AssetSuspensionWorkflowService;
  let lastObjectSnapshot: any;

  const actor = {
    actorType: 'ADMIN' as const,
    userId: 'ops-1',
    userNo: 'ADM-OPS01',
    role: 'OPS_OFFICER',
    roleCodes: ['OPS_OFFICER'],
  };

  const asset = {
    id: 'asset-1',
    assetNo: 'AS2601012024',
    currency: 'USDT',
    type: 'CRYPTO',
    network: 'TRON',
    status: 'ACTIVE',
  };

  const buildApprovedEvent = (approvalNo: string, traceId: string): ApprovalDecidedEvent => ({
    decision: 'APPROVED',
    actionType: 'ASSET_SUSPENSION',
    entityRef: asset.assetNo,
    approvalId: 'apr-1',
    approvalNo,
    traceId,
    workflowType: 'ASSET_SUSPENSION',
    decisionByUserId: 'ciso-1',
    decisionByUserNo: 'ADM-CISO01',
    decisionByRole: 'CISO',
    decisionReason: null,
    decidedAt: new Date().toISOString(),
    // 生产环境里 emitDecidedEvent（approval-handler.base.ts）硬编码 metadata: {}，
    // 如实还原这一点——理由必须从别处取得，不能指望它躺在 event.metadata 里。
    metadata: {},
  });

  beforeEach(() => {
    lastObjectSnapshot = null;
    prisma = {
      asset: { findFirst: jest.fn().mockResolvedValue(asset) },
      approvalCase: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    assetsService = {
      linkApprovalCase: jest.fn().mockResolvedValue(undefined),
      clearApprovalCase: jest.fn().mockResolvedValue(undefined),
      suspendAsset: jest.fn().mockResolvedValue({
        id: asset.id,
        assetNo: asset.assetNo,
        status: 'SUSPENDED',
      }),
    };
    approvalsService = {
      // 镜像生产 createAndSubmit 的真实效果：请求侧传入的 objectSnapshot（含 reason）
      // 落在案子上，getById 能读回——与 approvals.service.ts 的 mapApproval 行为一致。
      createAndSubmit: jest.fn(async (createDto: any) => {
        lastObjectSnapshot = createDto.objectSnapshot;
        return { approvalNo: 'APR2609060001' };
      }),
      getById: jest.fn(async () => ({ objectSnapshot: lastObjectSnapshot })),
    };
    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue(undefined),
      recordSystem: jest.fn().mockResolvedValue(undefined),
    };
    service = new AssetSuspensionWorkflowService(
      prisma,
      assetsService,
      approvalsService,
      auditLogsService,
    );
  });

  it('批准落地时 suspendAsset 收到提交时填写的 reason，而非通用文案', async () => {
    const submittedReason = 'POLISH-REPRO-20260906011719';
    const { approvalNo } = await service.requestSuspension(asset.assetNo, submittedReason, actor);

    await service.handleApprovalDecided(buildApprovedEvent(approvalNo, 'trace-1'));

    expect(approvalsService.getById).toHaveBeenCalledWith(approvalNo);
    expect(assetsService.suspendAsset).toHaveBeenCalledWith(asset.id, submittedReason);
    expect(assetsService.suspendAsset).not.toHaveBeenCalledWith(asset.id, 'Approved suspension');
  });

  it('拒绝时不落地，只清挂号，不动资产状态', async () => {
    const submittedReason = 'reject-me';
    const { approvalNo } = await service.requestSuspension(asset.assetNo, submittedReason, actor);

    await service.handleApprovalDecided({
      ...buildApprovedEvent(approvalNo, 'trace-2'),
      decision: 'DECLINED',
    });

    expect(assetsService.suspendAsset).not.toHaveBeenCalled();
    expect(assetsService.clearApprovalCase).toHaveBeenCalledWith(asset.assetNo);
  });

  it('执行失败时仍写 ASSET_SUSPENSION_FAILED 审计并向上抛错（既有行为，未受本轮改动影响）', async () => {
    assetsService.suspendAsset.mockRejectedValue(new ConflictException('boom'));
    lastObjectSnapshot = { reason: 'whatever' };

    await expect(
      service.handleApprovalDecided(buildApprovedEvent('APR2609060002', 'trace-3')),
    ).rejects.toThrow(ConflictException);

    const failed = auditLogsService.recordSystem.mock.calls.find(
      (c: any[]) => c[0].action === 'ASSET_SUSPENSION_FAILED',
    );
    expect(failed).toBeDefined();
    expect(failed[0].outcome).toBe('FAILED');
  });
});
