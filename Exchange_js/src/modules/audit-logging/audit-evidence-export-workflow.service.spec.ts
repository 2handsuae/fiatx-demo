import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditEvidenceExportWorkflowService } from './audit-evidence-export-workflow.service';
import { ApprovalDecidedEvent } from '../governance/approvals/approval-handler.base';

describe('AuditEvidenceExportWorkflowService', () => {
  let auditLogsService: any;
  let approvalsService: any;
  let service: AuditEvidenceExportWorkflowService;

  const actor = {
    actorType: 'ADMIN' as const,
    userId: 'admin-1',
    userNo: 'USR-1',
    role: 'COMPLIANCE_OFFICER',
    roleCodes: ['COMPLIANCE_OFFICER'],
  };

  beforeEach(() => {
    auditLogsService = {
      prepareEvidenceExportSelection: jest.fn(),
      createEvidencePackageRecord: jest.fn(),
      linkEvidencePackageApproval: jest.fn().mockResolvedValue(undefined),
      findEvidencePackage: jest.fn(),
      findEvidencePackageForApproval: jest.fn(),
      downloadEvidencePackage: jest.fn(),
      buildEvidencePackageArtifacts: jest.fn(),
      finalizeEvidencePackage: jest.fn().mockResolvedValue(undefined),
      markEvidencePackageFailed: jest.fn().mockResolvedValue(undefined),
      bulkMarkEvidencePackagesStatus: jest.fn().mockResolvedValue(undefined),
      recordByActor: jest.fn().mockResolvedValue(undefined),
    };

    approvalsService = {
      createAndSubmit: jest.fn(),
      requireApproved: jest.fn().mockResolvedValue(undefined),
      markExecutionResult: jest.fn().mockResolvedValue(undefined),
    };

    service = new AuditEvidenceExportWorkflowService(auditLogsService, approvalsService);
  });

  describe('createExportRequest', () => {
    it('creates package, submits approval, links, and writes EXPORT_REQUESTED audit', async () => {
      auditLogsService.prepareEvidenceExportSelection.mockResolvedValue({
        normalizedCriteria: { mode: 'SELECTION' },
        filterSnapshot: { workflowType: 'DEPOSIT' },
        selectedEventIds: ['log-1'],
        records: [],
        itemCount: 1,
        workflowSummary: { workflowType: 'DEPOSIT', workflowNos: ['DEP-1'] },
      });
      auditLogsService.createEvidencePackageRecord.mockResolvedValue({
        id: 'pkg-1',
        packageNo: 'EVP-1',
        exportMode: 'SELECTION',
      });
      approvalsService.createAndSubmit.mockResolvedValue({
        id: 'approval-1',
        approvalNo: 'APR2603140001',
        status: 'PENDING',
        traceId: 'trace-1',
      });
      auditLogsService.findEvidencePackage.mockResolvedValue({
        id: 'pkg-1',
        packageNo: 'EVP-1',
        status: 'PENDING_APPROVAL',
        approvalCaseId: 'approval-1',
      });

      const result = await service.createExportRequest({ selectedEventIds: ['log-1'], traceId: 'trace-1' } as any, actor);

      expect(result.status).toBe('PENDING_APPROVAL');
      expect(approvalsService.createAndSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'AUDIT_EVIDENCE_EXPORT_APPROVAL',
          entityRef: 'pkg-1',
          traceId: 'trace-1',
        }),
        expect.objectContaining({ traceId: 'trace-1' }),
        actor,
      );
      expect(auditLogsService.linkEvidencePackageApproval).toHaveBeenCalledWith('pkg-1', 'approval-1', 'APR2603140001');
      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'EXPORT_REQUESTED',
          workflowType: 'AUDIT_EVIDENCE_EXPORT',
        }),
        expect.objectContaining({ actorId: 'admin-1' }),
      );
    });
  });

  describe('downloadEvidencePackage', () => {
    it('gates on approval, downloads, and writes PACKAGE_DOWNLOADED audit', async () => {
      auditLogsService.findEvidencePackage.mockResolvedValue({
        id: 'pkg-1',
        packageNo: 'EVP-1',
        approvalCaseId: 'approval-1',
        status: 'READY',
        approvalCase: { approvalNo: 'APR-1', traceId: 'trace-1' },
      });
      auditLogsService.downloadEvidencePackage.mockResolvedValue({ id: 'pkg-1', packageNo: 'EVP-1' });

      const result = await service.downloadEvidencePackage('pkg-1', actor);

      expect(approvalsService.requireApproved).toHaveBeenCalledWith(
        expect.objectContaining({ approvalCaseId: 'approval-1', entityRef: 'pkg-1' }),
      );
      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PACKAGE_DOWNLOADED' }),
        expect.any(Object),
      );
      expect(result.packageNo).toBe('EVP-1');
    });

    it('throws when package status is not READY', async () => {
      auditLogsService.findEvidencePackage.mockResolvedValue({
        id: 'pkg-1',
        packageNo: 'EVP-1',
        approvalCaseId: 'approval-1',
        status: 'PENDING_APPROVAL',
        approvalCase: { traceId: 'trace-1' },
      });

      await expect(service.downloadEvidencePackage('pkg-1', actor)).rejects.toThrow(BadRequestException);
    });
  });

  describe('handleApprovalDecided', () => {
    const baseEvent: ApprovalDecidedEvent = {
      decision: 'APPROVED',
      actionType: 'AUDIT_EVIDENCE_EXPORT_APPROVAL',
      entityRef: 'pkg-1',
      approvalId: 'approval-1',
      approvalNo: 'APR-1',
      traceId: 'trace-1',
      workflowType: 'AUDIT_EVIDENCE_EXPORT',
      decisionByUserId: 'checker-1',
      decisionByUserNo: 'USR-CHECKER',
      decisionByRole: 'DPO',
      decidedAt: '2026-03-14T10:00:00.000Z',
      metadata: {},
    };

    it('generates package on APPROVED and writes GENERATION_COMPLETED', async () => {
      auditLogsService.findEvidencePackageForApproval.mockResolvedValue({
        id: 'pkg-1',
        packageNo: 'EVP-1',
        status: 'PENDING_APPROVAL',
        exportedById: 'admin-1',
        exportedByNo: 'USR-1',
        exportedByRole: 'COMPLIANCE_OFFICER',
        filterSnapshot: JSON.stringify({ includeRecords: true }),
        selectedEventIdsSnapshot: JSON.stringify(['log-1']),
      });
      auditLogsService.buildEvidencePackageArtifacts.mockResolvedValue({
        generatedAt: '2026-03-14T10:00:00.000Z',
        itemCount: 1,
        manifest: { version: '1.0' },
        digest: 'd'.repeat(64),
        packageBody: { manifest: {}, records: [], digest: 'd'.repeat(64) },
      });

      await service.handleApprovalDecided(baseEvent);

      expect(auditLogsService.finalizeEvidencePackage).toHaveBeenCalledWith(
        'pkg-1',
        expect.objectContaining({ status: 'READY', digest: 'd'.repeat(64) }),
      );
      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'GENERATION_COMPLETED' }),
        expect.any(Object),
      );
      expect(approvalsService.markExecutionResult).not.toHaveBeenCalled();
    });

    it('marks FAILED on generation error and writes GENERATION_FAILED', async () => {
      auditLogsService.findEvidencePackageForApproval.mockResolvedValue({
        id: 'pkg-1',
        packageNo: 'EVP-1',
        status: 'PENDING_APPROVAL',
        exportedById: 'admin-1',
        exportedByRole: 'COMPLIANCE_OFFICER',
        filterSnapshot: JSON.stringify({}),
        selectedEventIdsSnapshot: JSON.stringify(['log-1']),
      });
      auditLogsService.buildEvidencePackageArtifacts.mockRejectedValue(new Error('generation failed'));

      await service.handleApprovalDecided(baseEvent);

      expect(auditLogsService.markEvidencePackageFailed).toHaveBeenCalledWith('pkg-1');
      expect(approvalsService.markExecutionResult).not.toHaveBeenCalled();
    });

    it('bulk marks REJECTED on DECLINED', async () => {
      await service.handleApprovalDecided({ ...baseEvent, decision: 'DECLINED' });
      expect(auditLogsService.bulkMarkEvidencePackagesStatus).toHaveBeenCalledWith('approval-1', 'pkg-1', 'REJECTED');
    });

    it('bulk marks CANCELLED on CANCELLED', async () => {
      await service.handleApprovalDecided({ ...baseEvent, decision: 'CANCELLED' });
      expect(auditLogsService.bulkMarkEvidencePackagesStatus).toHaveBeenCalledWith('approval-1', 'pkg-1', 'CANCELLED');
    });

    it('bulk marks EXPIRED on EXPIRED', async () => {
      await service.handleApprovalDecided({ ...baseEvent, decision: 'EXPIRED' });
      expect(auditLogsService.bulkMarkEvidencePackagesStatus).toHaveBeenCalledWith('approval-1', 'pkg-1', 'EXPIRED');
    });
  });
});
