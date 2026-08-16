import { Test } from '@nestjs/testing';
import { TierUpgradeCaseService } from './tier-upgrade-case.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { CustomerRestrictionsService } from '../customers/customer-restrictions.service';
import { CustomerRestrictionWorkflowService } from '../customers/customer-restriction-workflow.service';

const mockPrisma = {
  tierUpgradeCase: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  customerMain: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  auditLogEvent: {
    create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    findUnique: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
  },
  auditLogSubjectNo: {
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  $transaction: jest.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) => fn(mockPrisma)),
};
const mockApprovals = { createAndSubmit: jest.fn() };
const mockSumsub = { moveToLevel: jest.fn() };

describe('TierUpgradeCaseService', () => {
  // Task 7：升级案的摁住/解开改走限制账
  const mockRestrictions = {
    open: jest.fn().mockResolvedValue({ restrictionNo: 'RST-1', created: true }),
    listOpen: jest.fn().mockResolvedValue([]),
    release: jest.fn(),
    findByNo: jest.fn(),
    listAll: jest.fn(),
    findOpenByCause: jest.fn(),
  };
  const mockRestrictionWorkflow = {
    openRestriction: jest.fn(),
    autoRelease: jest.fn().mockResolvedValue(undefined),
  };

  let service: TierUpgradeCaseService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        { provide: CustomerRestrictionsService, useValue: mockRestrictions },
        { provide: CustomerRestrictionWorkflowService, useValue: mockRestrictionWorkflow },
        TierUpgradeCaseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ApprovalsService, useValue: mockApprovals },
        { provide: SumsubClient, useValue: mockSumsub },
        { provide: AuditLogsService, useValue: { recordSystem: jest.fn().mockResolvedValue({}), recordByActor: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();
    service = module.get(TierUpgradeCaseService);
    jest.clearAllMocks();
    // Re-apply $transaction mock after clearAllMocks
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => fn(mockPrisma));
  });

  describe('createFromCra', () => {
    it('creates TierUpgradeCase and restricts customer', async () => {
      const cra = { id: 'cra-1', customerId: 'cust-1', traceId: 'T1' };
      const customer = { id: 'cust-1', sumsubApplicantId: 'sub-1' };
      mockPrisma.customerMain.findUnique.mockResolvedValueOnce(customer);
      mockPrisma.tierUpgradeCase.create.mockResolvedValueOnce({ id: 'tuc-1', caseNo: 'TUC-001' });

      await service.createFromCra(cra);

      expect(mockPrisma.tierUpgradeCase.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 'cust-1',
            sourceCraId: 'cra-1',
            status: 'PENDING_LEVEL2',
          }),
        }),
      );
      // Task 7：摁住改贴 TIER_UPGRADE_PENDING 便签，caseRef=本升级案 id
      expect(mockRestrictions.open).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cust-1',
          cause: 'TIER_UPGRADE_PENDING',
          caseRef: 'tuc-1',
          openedBy: 'SYSTEM',
        }),
      );
    });

    it('still works when customer has no sumsubApplicantId', async () => {
      const cra = { id: 'cra-1', customerId: 'cust-1', traceId: 'T1' };
      mockPrisma.customerMain.findUnique.mockResolvedValueOnce({ id: 'cust-1', sumsubApplicantId: null });
      mockPrisma.tierUpgradeCase.create.mockResolvedValueOnce({ id: 'tuc-1' });

      await service.createFromCra(cra);

      expect(mockSumsub.moveToLevel).not.toHaveBeenCalled();
      expect(mockPrisma.tierUpgradeCase.create).toHaveBeenCalled();
    });

    it('still creates case if moveToLevel throws', async () => {
      const cra = { id: 'cra-1', customerId: 'cust-1', traceId: 'T1' };
      const customer = { id: 'cust-1', sumsubApplicantId: 'sub-1' };
      mockPrisma.customerMain.findUnique.mockResolvedValueOnce(customer);
      mockPrisma.tierUpgradeCase.create.mockResolvedValueOnce({ id: 'tuc-1', caseNo: 'TUC-001' });
      mockSumsub.moveToLevel.mockRejectedValueOnce(new Error('Sumsub API error'));

      await expect(service.createFromCra(cra)).resolves.not.toThrow();

      expect(mockPrisma.tierUpgradeCase.create).toHaveBeenCalled();
    });
  });

  describe('handleLevel2WorkflowComplete', () => {
    it('creates Phase 2 approval and advances to PENDING_PHASE2_APPROVAL', async () => {
      const upgradeCase = {
        id: 'tuc-1', customerId: 'cust-1', traceId: 'TIER_UPGRADE:abc',
        sourceCraId: 'cra-1', caseNo: 'TUC-001',
      };
      mockPrisma.tierUpgradeCase.findFirst.mockResolvedValueOnce(upgradeCase);
      mockApprovals.createAndSubmit.mockResolvedValueOnce({ id: 'ap-1' });

      await service.handleLevel2WorkflowComplete('cust-1');

      expect(mockApprovals.createAndSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'RISK_RATING_TIER_UPGRADE_APPROVAL' }),
        expect.any(Object),
        expect.any(Object),
      );
      expect(mockPrisma.tierUpgradeCase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'PENDING_PHASE2_APPROVAL',
            phase2ApprovalCaseId: 'ap-1',
          }),
        }),
      );
    });

    it('is no-op when no PENDING_LEVEL2 case exists', async () => {
      mockPrisma.tierUpgradeCase.findFirst.mockResolvedValueOnce(null);
      await service.handleLevel2WorkflowComplete('cust-1');
      expect(mockApprovals.createAndSubmit).not.toHaveBeenCalled();
    });
  });

  describe('handleSignoffComplete', () => {
    const upgradeCase = {
      id: 'tuc-1', customerId: 'cust-1', sourceCraId: 'cra-1', phase2ApprovalCaseId: 'ap-1',
    };

    it('APPROVED → COMPLETED: sets riskRating=HIGH, clears complianceStatus', async () => {
      mockPrisma.tierUpgradeCase.findUnique.mockResolvedValueOnce(upgradeCase);

      await service.handleSignoffComplete('tuc-1', { status: 'APPROVED' });

      expect(mockPrisma.customerMain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            riskRating: 'HIGH',
          }),
        }),
      );
      expect(mockPrisma.tierUpgradeCase.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
      );
    });

    it('REJECTED → 不动 lifecycle，改贴 ADMIN_SUSPENSION 再撕 TIER_UPGRADE_PENDING', async () => {
      mockPrisma.tierUpgradeCase.findUnique.mockResolvedValueOnce(upgradeCase);

      await service.handleSignoffComplete('tuc-1', { status: 'REJECTED' });

      // INV-1：升级审批被拒 ≠ 客户被拒户，lifecycle 不动。
      // 先贴新的 ADMIN_SUSPENSION，再撕旧的 TIER_UPGRADE_PENDING（顺序反了中间会
      // 出现一个客户完全不受限的窗口）。
      expect(mockRestrictions.open).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cust-1',
          cause: 'ADMIN_SUSPENSION',
          caseRef: 'tuc-1',
        }),
      );
      expect(mockRestrictionWorkflow.autoRelease).toHaveBeenCalledWith(
        'cust-1',
        'TIER_UPGRADE_PENDING',
        'tuc-1',
        'SYSTEM',
      );
      const openOrder = mockRestrictions.open.mock.invocationCallOrder[0];
      const releaseOrder = mockRestrictionWorkflow.autoRelease.mock.invocationCallOrder[0];
      expect(openOrder).toBeLessThan(releaseOrder);
      expect(mockPrisma.tierUpgradeCase.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }),
      );
    });

    it('is no-op when case not found', async () => {
      mockPrisma.tierUpgradeCase.findUnique.mockResolvedValueOnce(null);
      await service.handleSignoffComplete('tuc-1', { status: 'APPROVED' });
      expect(mockPrisma.customerMain.update).not.toHaveBeenCalled();
    });
  });
});
