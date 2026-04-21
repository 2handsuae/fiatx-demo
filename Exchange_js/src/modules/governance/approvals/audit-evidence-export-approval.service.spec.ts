import { BadRequestException } from '@nestjs/common';
import { AuditEvidenceExportApprovalService } from './audit-evidence-export-approval.service';

describe('AuditEvidenceExportApprovalService', () => {
  let prisma: any;
  let auditLogsService: any;
  let approvalsService: any;
  let service: AuditEvidenceExportApprovalService;

  const actor = {
    actorType: 'ADMIN' as const,
    userId: 'admin-1',
    userNo: 'USR-1',
    role: 'COMPLIANCE_OFFICER',
    roleCodes: ['COMPLIANCE_OFFICER'],
  };

  beforeEach(() => {
    prisma = {
      auditEvidencePackage: {
        update: jest.fn().mockResolvedValue(undefined),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn(),
      },
    };

    auditLogsService = {
      prepareEvidenceExportSelection: jest.fn(),
      createEvidencePackageRecord: jest.fn(),
      findEvidencePackage: jest.fn(),
      buildEvidencePackageArtifacts: jest.fn(),
      recordByActor: jest.fn().mockResolvedValue(undefined),
      downloadEvidencePackage: jest.fn(),
    };

    approvalsService = {
      create: jest.fn(),
      submit: jest.fn(),
      requireApproved: jest.fn().mockResolvedValue(undefined),
      markExecutionResult: jest.fn().mockResolvedValue(undefined),
    };

    service = new AuditEvidenceExportApprovalService(
      prisma,
      auditLogsService,
      approvalsService,
    );
  });

  it('creates export request and links it to a pending approval case', async () => {
    auditLogsService.prepareEvidenceExportSelection.mockResolvedValue({
      normalizedCriteria: {
        mode: 'SELECTION',
      },
      filterSnapshot: {
        workflowType: 'DEPOSIT',
      },
      selectedEventIds: ['log-1'],
      records: [],
      itemCount: 1,
      workflowSummary: {
        workflowType: 'DEPOSIT',
        workflowNos: ['DEP-1'],
      },
    });
    auditLogsService.createEvidencePackageRecord.mockResolvedValue({
      id: 'pkg-1',
      packageNo: 'EVP-1',
      exportMode: 'SELECTION',
    });
    approvalsService.create.mockResolvedValue({
      id: 'approval-1',
      approvalNo: 'APR2603140001',
      status: 'DRAFT',
      traceId: 'trace-export-1',
    });
    approvalsService.submit.mockResolvedValue({
      id: 'approval-1',
      approvalNo: 'APR2603140001',
      status: 'PENDING',
      traceId: 'trace-export-1',
    });
    auditLogsService.findEvidencePackage.mockResolvedValue({
      id: 'pkg-1',
      packageNo: 'EVP-1',
      status: 'PENDING_APPROVAL',
      approvalCaseId: 'approval-1',
    });

    const result = await service.createExportRequest(
      {
        selectedEventIds: ['log-1'],
        traceId: 'trace-export-1',
      } as any,
      actor,
    );

    expect(result.status).toBe('PENDING_APPROVAL');
    expect(approvalsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'AUDIT_EVIDENCE_EXPORT_APPROVAL',
        entityRef: 'pkg-1',
        traceId: 'trace-export-1',
        workflowType: 'AUDIT_EVIDENCE_EXPORT',
        workflowId: 'pkg-1',
        workflowNo: 'EVP-1',
      }),
      actor,
    );
    expect(prisma.auditEvidencePackage.update).toHaveBeenCalledWith({
      where: { id: 'pkg-1' },
      data: {
        approvalCaseId: 'approval-1',
        approvalCaseNo: 'APR2603140001',
      },
    });
    expect(auditLogsService.createEvidencePackageRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        exportedByNo: actor.userNo,
      }),
    );
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AUDIT_EVIDENCE_EXPORT_REQUESTED',
        workflowType: 'AUDIT_EVIDENCE_EXPORT',
        traceId: 'trace-export-1',
        subjectNos: expect.arrayContaining([
          expect.objectContaining({
            subjectRole: 'RELATED',
            subjectType: 'APPROVAL_CASE',
            subjectNo: 'APR2603140001',
          }),
        ]),
      }),
      expect.objectContaining({
        actorId: actor.userId,
      }),
    );
  });

  it('creates swap export request and preserves swap workflow summary in approval metadata', async () => {
    auditLogsService.prepareEvidenceExportSelection.mockResolvedValue({
      normalizedCriteria: {
        mode: 'SELECTION',
        workflowType: 'SWAP',
      },
      filterSnapshot: {
        workflowType: 'SWAP',
      },
      selectedEventIds: ['log-swap-1'],
      records: [],
      itemCount: 1,
      workflowSummary: {
        workflowType: 'SWAP',
        workflowNos: ['SWP2603260001'],
      },
    });
    auditLogsService.createEvidencePackageRecord.mockResolvedValue({
      id: 'pkg-swap-1',
      packageNo: 'EVP-SWAP-1',
      exportMode: 'SELECTION',
    });
    approvalsService.create.mockResolvedValue({
      id: 'approval-swap-1',
      approvalNo: 'APR2603260001',
      status: 'DRAFT',
      traceId: 'trace-export-swap-1',
    });
    approvalsService.submit.mockResolvedValue({
      id: 'approval-swap-1',
      approvalNo: 'APR2603260001',
      status: 'PENDING',
      traceId: 'trace-export-swap-1',
    });
    auditLogsService.findEvidencePackage.mockResolvedValue({
      id: 'pkg-swap-1',
      packageNo: 'EVP-SWAP-1',
      status: 'PENDING_APPROVAL',
      approvalCaseId: 'approval-swap-1',
    });

    await service.createExportRequest(
      {
        selectedEventIds: ['log-swap-1'],
        workflowType: 'SWAP',
        traceId: 'trace-export-swap-1',
      } as any,
      actor,
    );

    expect(approvalsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'AUDIT_EVIDENCE_EXPORT_APPROVAL',
        entityRef: 'pkg-swap-1',
        traceId: 'trace-export-swap-1',
        workflowType: 'AUDIT_EVIDENCE_EXPORT',
        workflowId: 'pkg-swap-1',
        workflowNo: 'EVP-SWAP-1',
        metadata: expect.objectContaining({
          packageNo: 'EVP-SWAP-1',
          workflowSummary: {
            workflowType: 'SWAP',
            workflowNos: ['SWP2603260001'],
          },
        }),
      }),
      actor,
    );
  });

  it('finalizes approved export successfully and marks approval execution success', async () => {
    prisma.auditEvidencePackage.findFirst.mockResolvedValue({
      id: 'pkg-1',
      packageNo: 'EVP-1',
      status: 'PENDING_APPROVAL',
      exportMode: 'SELECTION',
      selectedEventIdsSnapshot: JSON.stringify(['log-1']),
      filterSnapshot: JSON.stringify({ workflowType: 'DEPOSIT', includeRecords: true }),
      exportedById: 'admin-1',
      exportedByRole: 'COMPLIANCE_OFFICER',
    });
    auditLogsService.buildEvidencePackageArtifacts.mockResolvedValue({
      generatedAt: '2026-03-14T10:00:00.000Z',
      itemCount: 1,
      manifest: { version: '1.0' },
      digest: 'd'.repeat(64),
      packageBody: {
        manifest: { version: '1.0' },
        records: [],
        snapshots: {},
        digest: 'd'.repeat(64),
      },
    });

    await service.handleApprovedApproval({
      approvalId: 'approval-1',
      approvalNo: 'APR2603140001',
      actionType: 'AUDIT_EVIDENCE_EXPORT_APPROVAL',
      entityRef: 'pkg-1',
      traceId: 'trace-1',
      status: 'APPROVED',
      decisionByUserId: 'checker-1',
      decisionByRole: 'DPO',
      decidedAt: '2026-03-14T10:00:00.000Z',
    });

    expect(prisma.auditEvidencePackage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pkg-1' },
        data: expect.objectContaining({
          status: 'READY',
          digest: 'd'.repeat(64),
        }),
      }),
    );
    expect(approvalsService.markExecutionResult).toHaveBeenCalledWith(
      'approval-1',
      true,
      expect.objectContaining({
        userId: 'checker-1',
      }),
      'Evidence export package generated successfully',
    );
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AUDIT_EVIDENCE_PACKAGE_EXPORTED',
        workflowType: 'AUDIT_EVIDENCE_EXPORT',
        traceId: 'trace-1',
      }),
      expect.any(Object),
    );
  });

  it('finalizes approved swap export and preserves swap workflow summary in package manifest', async () => {
    prisma.auditEvidencePackage.findFirst.mockResolvedValue({
      id: 'pkg-swap-1',
      packageNo: 'EVP-SWAP-1',
      status: 'PENDING_APPROVAL',
      exportMode: 'SELECTION',
      selectedEventIdsSnapshot: JSON.stringify(['log-swap-1']),
      filterSnapshot: JSON.stringify({ workflowType: 'SWAP', includeRecords: true }),
      exportedById: 'admin-1',
      exportedByRole: 'COMPLIANCE_OFFICER',
    });
    auditLogsService.buildEvidencePackageArtifacts.mockResolvedValue({
      generatedAt: '2026-03-26T10:00:00.000Z',
      itemCount: 1,
      manifest: {
        version: '1.0',
        workflowSummary: {
          workflowType: 'SWAP',
          workflowNos: ['SWP2603260001'],
        },
      },
      digest: 'e'.repeat(64),
      packageBody: {
        manifest: {
          version: '1.0',
          workflowSummary: {
            workflowType: 'SWAP',
            workflowNos: ['SWP2603260001'],
          },
        },
        records: [],
        snapshots: {
          swapEvidenceChain: [{ swapId: 'swap-1', quoteId: 'quote-1' }],
        },
        digest: 'e'.repeat(64),
      },
    });

    await service.handleApprovedApproval({
      approvalId: 'approval-swap-1',
      approvalNo: 'APR2603260001',
      actionType: 'AUDIT_EVIDENCE_EXPORT_APPROVAL',
      entityRef: 'pkg-swap-1',
      traceId: 'trace-swap-1',
      status: 'APPROVED',
      decisionByUserId: 'checker-1',
      decisionByRole: 'DPO',
      decidedAt: '2026-03-26T10:00:00.000Z',
    });

    expect(auditLogsService.buildEvidencePackageArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowType: 'SWAP',
      }),
      expect.any(Object),
      expect.objectContaining({
        approvalStatus: 'APPROVED',
      }),
    );
    expect(prisma.auditEvidencePackage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pkg-swap-1' },
        data: expect.objectContaining({
          status: 'READY',
          digest: 'e'.repeat(64),
          manifest: expect.stringContaining('"workflowType":"SWAP"'),
        }),
      }),
    );
  });

  it('marks package failed when approved export finalization throws', async () => {
    prisma.auditEvidencePackage.findFirst.mockResolvedValue({
      id: 'pkg-1',
      packageNo: 'EVP-1',
      status: 'PENDING_APPROVAL',
      exportMode: 'SELECTION',
      selectedEventIdsSnapshot: JSON.stringify(['log-1']),
      filterSnapshot: JSON.stringify({ workflowType: 'DEPOSIT' }),
      exportedById: 'admin-1',
      exportedByRole: 'COMPLIANCE_OFFICER',
    });
    auditLogsService.buildEvidencePackageArtifacts.mockRejectedValue(
      new Error('generation failed'),
    );

    await service.handleApprovedApproval({
      approvalId: 'approval-1',
      approvalNo: 'APR2603140001',
      actionType: 'AUDIT_EVIDENCE_EXPORT_APPROVAL',
      entityRef: 'pkg-1',
      traceId: 'trace-1',
      status: 'APPROVED',
      decisionByUserId: 'checker-1',
      decisionByRole: 'DPO',
      decidedAt: '2026-03-14T10:00:00.000Z',
    });

    expect(prisma.auditEvidencePackage.update).toHaveBeenCalledWith({
      where: { id: 'pkg-1' },
      data: {
        status: 'FAILED',
      },
    });
    expect(approvalsService.markExecutionResult).toHaveBeenCalledWith(
      'approval-1',
      false,
      expect.objectContaining({
        userId: 'checker-1',
      }),
      'generation failed',
    );
  });

  it('checks approval gate before downloading non-legacy package content', async () => {
    auditLogsService.findEvidencePackage.mockResolvedValue({
      id: 'pkg-1',
      packageNo: 'EVP-1',
      approvalCaseId: 'approval-1',
      status: 'READY',
      exportedById: actor.userId,
      exportedByNo: actor.userNo,
      exportedByRole: actor.role,
      workflowType: 'AUDIT_EVIDENCE_EXPORT',
      workflowId: 'pkg-1',
      workflowNo: 'EVP-1',
      approvalCase: {
        approvalNo: 'APR2603140001',
        traceId: 'trace-1',
      },
    });
    auditLogsService.downloadEvidencePackage.mockResolvedValue({
      id: 'pkg-1',
      packageNo: 'EVP-1',
    });

    const result = await service.downloadEvidencePackage('pkg-1', actor);

    expect(approvalsService.requireApproved).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalCaseId: 'approval-1',
        entityRef: 'pkg-1',
      }),
    );
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AUDIT_EVIDENCE_PACKAGE_DOWNLOADED',
        workflowType: 'AUDIT_EVIDENCE_EXPORT',
        traceId: 'trace-1',
        subjectNos: expect.arrayContaining([
          expect.objectContaining({
            subjectRole: 'RELATED',
            subjectType: 'APPROVAL_CASE',
            subjectNo: 'APR2603140001',
          }),
        ]),
      }),
      expect.objectContaining({
        actorId: actor.userId,
      }),
    );
    expect(result.packageNo).toBe('EVP-1');
  });

  it('rejects download when package is approved but not ready', async () => {
    auditLogsService.findEvidencePackage.mockResolvedValue({
      id: 'pkg-1',
      packageNo: 'EVP-1',
      approvalCaseId: 'approval-1',
      status: 'PENDING_APPROVAL',
      approvalCase: {
        traceId: 'trace-1',
      },
    });

    await expect(service.downloadEvidencePackage('pkg-1', actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
