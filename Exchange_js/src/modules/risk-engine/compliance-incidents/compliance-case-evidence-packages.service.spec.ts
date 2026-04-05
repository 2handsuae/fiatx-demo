import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import {
  ApprovalActionTypes,
  ApprovalStatuses,
} from '../../governance/approvals/constants/approval.constants';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditEvidencePackageStatus } from '../audit-logs/dto/audit-log.dto';
import { ComplianceIncidentsService } from './compliance-incidents.service';
import { ComplianceCaseEvidencePackagesService } from './compliance-case-evidence-packages.service';

describe('ComplianceCaseEvidencePackagesService', () => {
  const prismaMock: any = {
    complianceIncident: {
      findMany: jest.fn(),
    },
    complianceCaseEvidencePackage: {
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const approvalsServiceMock: any = {
    create: jest.fn(),
    submit: jest.fn(),
    requireApproved: jest.fn(),
    markExecutionResult: jest.fn(),
  };

  const auditLogsServiceMock: any = {
    recordByActor: jest.fn(),
  };

  const complianceIncidentsServiceMock: any = {
    findOne: jest.fn(),
  };

  let service: ComplianceCaseEvidencePackagesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ComplianceCaseEvidencePackagesService(
      prismaMock,
      approvalsServiceMock as unknown as ApprovalsService,
      auditLogsServiceMock as unknown as AuditLogsService,
      complianceIncidentsServiceMock as unknown as ComplianceIncidentsService,
    );
  });

  it('should build export filters with canonical assignee semantics', () => {
    const result = (service as any).buildWhere({
      caseType: 'ONBOARDING',
      assigneeUserId: 'admin-canonical',
    });

    expect(result).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceType: 'ONBOARDING_JOURNEY',
          caseType: 'ONBOARDING',
          ownerUserId: 'admin-canonical',
        }),
      }),
    );
  });

  it('should create a pending approval case evidence export request', async () => {
    jest.spyOn<any, any>(service as any, 'prepareSelection').mockResolvedValue({
      normalizedCriteria: {
        caseType: 'TRANSACTION',
        status: 'ASSIGNED',
        assigneeUserId: null,
        periodFrom: null,
        periodTo: null,
        selectedCaseIds: ['inc-1'],
        includeRecords: true,
      },
      caseIds: ['inc-1'],
      caseNos: ['CAS2602010001'],
      itemCount: 1,
    });
    prismaMock.complianceCaseEvidencePackage.create.mockResolvedValue({
      id: 'pkg-1',
      packageNo: 'CEP2602010001',
      status: AuditEvidencePackageStatus.PENDING_APPROVAL,
    });
    approvalsServiceMock.create.mockResolvedValue({
      id: 'appr-1',
      status: 'DRAFT',
      traceId: 'CASE_EXPORT_CEP2602010001',
    });
    approvalsServiceMock.submit.mockResolvedValue({
      id: 'appr-1',
      approvalNo: 'APR2602010001',
      status: ApprovalStatuses.PENDING,
    });
    prismaMock.complianceCaseEvidencePackage.update.mockResolvedValue({
      id: 'pkg-1',
      approvalCaseId: 'appr-1',
    });
    jest.spyOn(service, 'findEvidencePackage').mockResolvedValue({
      id: 'pkg-1',
      packageNo: 'CEP2602010001',
      approvalCaseId: 'appr-1',
      status: AuditEvidencePackageStatus.PENDING_APPROVAL,
    } as any);

    const result = await service.createExportRequest(
      {
        selectedCaseIds: ['inc-1'],
      },
      {
        actorType: 'ADMIN',
        userId: 'admin-1',
        userNo: 'US0001',
        role: 'MLRO',
        roleCodes: ['MLRO'],
      },
    );

    expect(prismaMock.complianceCaseEvidencePackage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AuditEvidencePackageStatus.PENDING_APPROVAL,
          exportMode: 'CASE_SELECTION',
          itemCount: 1,
          exportedByNo: 'US0001',
        }),
      }),
    );
    expect(approvalsServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: ApprovalActionTypes.CASE_EVIDENCE_EXPORT_APPROVAL,
        entityRef: 'pkg-1',
      }),
      expect.objectContaining({ userId: 'admin-1' }),
    );
    expect(approvalsServiceMock.submit).toHaveBeenCalledWith(
      'appr-1',
      expect.objectContaining({
        reason: expect.stringContaining('CEP2602010001'),
      }),
      expect.objectContaining({ userId: 'admin-1' }),
    );
    expect(prismaMock.complianceCaseEvidencePackage.update).toHaveBeenCalledWith({
      where: { id: 'pkg-1' },
      data: {
        approvalCaseId: 'appr-1',
        approvalCaseNo: 'APR2602010001',
      },
    });
    expect(result.packageNo).toBe('CEP2602010001');
  });

  it('should reject download before package becomes READY even after approval check', async () => {
    jest.spyOn(service, 'findEvidencePackage').mockResolvedValue({
      id: 'pkg-1',
      packageNo: 'CEP2602010001',
      approvalCaseId: 'appr-1',
      status: AuditEvidencePackageStatus.PENDING_APPROVAL,
      approvalCase: {
        traceId: 'CASE_EXPORT_CEP2602010001',
      },
    } as any);
    approvalsServiceMock.requireApproved.mockResolvedValue(undefined);

    await expect(
      service.downloadEvidencePackage('pkg-1', {
        actorType: 'ADMIN',
        userId: 'admin-2',
        userNo: 'US0002',
        role: 'MLRO',
        roleCodes: ['MLRO'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(approvalsServiceMock.requireApproved).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: ApprovalActionTypes.CASE_EVIDENCE_EXPORT_APPROVAL,
        entityRef: 'pkg-1',
        approvalCaseId: 'appr-1',
      }),
    );
  });

  it('should mark package READY after approval event and persist package body', async () => {
    prismaMock.complianceCaseEvidencePackage.findFirst.mockResolvedValue({
      id: 'pkg-1',
      packageNo: 'CEP2602010001',
      status: AuditEvidencePackageStatus.PENDING_APPROVAL,
      exportMode: 'CASE_SELECTION',
      exportedById: 'admin-1',
      exportedByRole: 'MLRO',
      filterSnapshot: JSON.stringify({
        caseType: 'TRANSACTION',
        selectedCaseIds: ['inc-1'],
      }),
      selectedCaseIdsSnapshot: JSON.stringify(['inc-1']),
    });
    prismaMock.complianceCaseEvidencePackage.update.mockResolvedValue({ id: 'pkg-1' });
    approvalsServiceMock.markExecutionResult.mockResolvedValue(undefined);
    auditLogsServiceMock.recordByActor.mockResolvedValue(undefined);
    jest.spyOn<any, any>(service as any, 'buildEvidencePackageArtifacts').mockResolvedValue({
      manifest: {
        generatedAt: '2026-03-16T00:00:00.000Z',
        itemCount: 1,
      },
      packageBody: {
        manifest: {
          generatedAt: '2026-03-16T00:00:00.000Z',
        },
        cases: [{ id: 'inc-1', caseNo: 'CAS2602010001' }],
        decisionRecords: [],
        providerResponseReferences: [],
        providerResponseSnapshots: [],
        digest: 'digest-1',
      },
      digest: 'digest-1',
      itemCount: 1,
    });

    await service.handleApprovedApproval({
      actionType: ApprovalActionTypes.CASE_EVIDENCE_EXPORT_APPROVAL,
      approvalId: 'appr-1',
      approvalNo: 'APR2602010001',
      entityRef: 'pkg-1',
      traceId: 'CASE_EXPORT_CEP2602010001',
      decisionByUserId: 'admin-9',
      decisionByRole: 'MLRO',
      decidedAt: '2026-03-16T00:00:00.000Z',
    } as any);

    expect(prismaMock.complianceCaseEvidencePackage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pkg-1' },
        data: expect.objectContaining({
          status: AuditEvidencePackageStatus.READY,
          digest: 'digest-1',
          fileName: 'CEP2602010001.json',
          packageBody: expect.any(String),
        }),
      }),
    );
    expect(auditLogsServiceMock.recordByActor).toHaveBeenCalled();
    expect(approvalsServiceMock.markExecutionResult).toHaveBeenCalledWith(
      'appr-1',
      true,
      expect.any(Object),
      expect.stringContaining('generated successfully'),
    );
  });

  it('should include currentCaseReport and caseReportHistorySummary in package body', async () => {
    jest.spyOn<any, any>(service as any, 'prepareSelection').mockResolvedValue({
      normalizedCriteria: {
        workflow: 'ONBOARDING',
        caseType: 'ONBOARDING',
        status: null,
        assigneeUserId: null,
        periodFrom: null,
        periodTo: null,
        selectedCaseIds: ['inc-1'],
        includeRecords: true,
      },
      cases: [
        {
          id: 'inc-1',
          caseNo: 'CAS2602010001',
          currentReport: {
            id: 'report-1',
            version: 1,
            status: 'FINALIZED',
            finalDispositionCode: 'RESTRICT',
          },
          reportHistory: [
            {
              id: 'report-1',
              version: 1,
              status: 'FINALIZED',
              finalizedAt: '2026-03-17T00:00:00.000Z',
              finalizedByUserNo: 'US0001',
              finalDispositionCode: 'RESTRICT',
              updatedAt: '2026-03-17T00:00:00.000Z',
            },
          ],
        },
      ],
      caseIds: ['inc-1'],
      caseNos: ['CAS2602010001'],
      itemCount: 1,
      decisionRecords: [],
      providerArtifacts: {
        references: [],
        snapshots: [],
      },
    });

    const artifacts = await (service as any).buildEvidencePackageArtifacts(
      { selectedCaseIds: ['inc-1'] },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'MLRO',
      },
    );

    expect(artifacts.packageBody.cases[0]).toEqual(
      expect.objectContaining({
        currentCaseReport: expect.objectContaining({
          id: 'report-1',
          status: 'FINALIZED',
        }),
        caseReportHistorySummary: [
          expect.objectContaining({
            id: 'report-1',
            version: 1,
            status: 'FINALIZED',
            finalDispositionCode: 'RESTRICT',
          }),
        ],
      }),
    );
  });

  it('should exclude soft-deleted case evidence packages from list queries', async () => {
    prismaMock.complianceCaseEvidencePackage.count.mockResolvedValue(1);
    prismaMock.complianceCaseEvidencePackage.findMany.mockResolvedValue([
      {
        id: 'pkg-1',
        packageNo: 'CEP2602010001',
        status: AuditEvidencePackageStatus.READY,
        approvalCase: null,
      },
    ]);

    const result = await service.findEvidencePackages({ take: 10 } as any);

    expect(prismaMock.complianceCaseEvidencePackage.count).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
      },
    });
    expect(prismaMock.complianceCaseEvidencePackage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
        },
      }),
    );
    expect(result.items).toHaveLength(1);
  });

  it('should hide soft-deleted case evidence packages from detail reads', async () => {
    prismaMock.complianceCaseEvidencePackage.findFirst.mockResolvedValue({
      id: 'pkg-1',
      packageNo: 'CEP2602010001',
      deletedAt: new Date('2026-03-22T10:00:00.000Z'),
    });

    await expect(service.findEvidencePackage('pkg-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('should return not found when download is requested for hidden package detail', async () => {
    jest
      .spyOn(service, 'findEvidencePackage')
      .mockRejectedValue(new NotFoundException('Case evidence package not found: pkg-1'));

    await expect(
      service.downloadEvidencePackage('pkg-1', {
        actorType: 'ADMIN',
        userId: 'admin-1',
        userNo: 'US0001',
        role: 'MLRO',
        roleCodes: ['MLRO'],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
