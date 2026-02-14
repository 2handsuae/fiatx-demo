import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';

describe('OnboardingService', () => {
  const prismaMock: any = {
    customerMain: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    cddCase: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    eddCase: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    complianceSession: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
  };

  let service: OnboardingService;
  let recomputeSpy: jest.SpyInstance;

  beforeEach(() => {
    prismaMock.customerMain.findUnique.mockReset();
    prismaMock.customerMain.update.mockReset();
    prismaMock.cddCase.findMany.mockReset();
    prismaMock.cddCase.findFirst.mockReset();
    prismaMock.eddCase.findMany.mockReset();
    prismaMock.eddCase.findFirst.mockReset();
    prismaMock.complianceSession.findFirst.mockReset();
    prismaMock.complianceSession.update.mockReset();
    prismaMock.complianceSession.updateMany.mockReset();
    prismaMock.complianceSession.create.mockReset();
    service = new OnboardingService(prismaMock);
    recomputeSpy = jest.spyOn(service, 'recomputeComplianceSnapshot').mockResolvedValue({} as any);
  });

  it('should allow swap when compliance status is ACTIVE', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      complianceStatus: 'ACTIVE',
      cddStatus: 'APPROVED',
      eddRequired: false,
      eddStatus: 'NOT_REQUIRED',
    });

    await expect(service.assertTradingEligibility('c1', 'SWAP')).resolves.toBeUndefined();
  });

  it('should block withdraw when compliance status is BLOCKED', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      complianceStatus: 'BLOCKED',
      cddStatus: 'PENDING_REVIEW',
      eddRequired: false,
      eddStatus: 'NOT_REQUIRED',
    });

    await expect(service.assertTradingEligibility('c1', 'WITHDRAW')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('should throw when customer does not exist', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue(null);

    await expect(service.assertTradingEligibility('missing', 'SWAP')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('should return reinitiate step when cdd is rejected', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      complianceStatus: 'BLOCKED',
      cddStatus: 'REJECTED',
      eddStatus: 'NOT_REQUIRED',
      eddRequired: false,
      customerType: 'INDIVIDUAL',
      corporateProfile: null,
      uboProfiles: [],
      currentCddCaseId: null,
      currentEddCaseId: null,
    });

    const reasonSpy = jest
      .spyOn(service as any, 'extractLatestRejectedReason')
      .mockResolvedValue('CDD rejected');

    const result = await service.getNextStep('c1');
    expect(result.step).toBe('REINITIATE');
    expect(result.action).toBe('REINITIATE_CDD');
    reasonSpy.mockRestore();
  });

  it('should return completed step when compliance is active', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      complianceStatus: 'ACTIVE',
      cddStatus: 'APPROVED',
      eddRequired: false,
      eddStatus: 'NOT_REQUIRED',
      customerType: 'INDIVIDUAL',
      corporateProfile: null,
      uboProfiles: [],
      currentCddCaseId: null,
      currentEddCaseId: null,
    });

    const result = await service.getNextStep('c1');
    expect(result.step).toBe('COMPLETED');
    expect(result.action).toBe('NONE');
  });

  it('should reinitiate CDD and auto-create QR session', async () => {
    jest.spyOn(service, 'getNextStep').mockResolvedValue({
      step: 'REINITIATE',
      action: 'REINITIATE_CDD',
      blockedReason: 'CDD rejected',
      activeCaseId: null,
      requiresEdd: false,
    });
    jest.spyOn(service, 'bootstrapCddCases').mockResolvedValue({
      journeyId: 'ONB-1',
      items: [{ id: 'case-1' }],
    } as any);
    jest.spyOn(service, 'createCaseSession').mockResolvedValue({
      sessionId: 'ses-1',
      providerSessionId: 'SES-1',
      caseType: 'CDD',
      caseId: 'case-1',
      qrCodeUrl: 'mock://compliance/SES-1',
      expiresAt: new Date(),
      status: 'PENDING',
    } as any);
    jest.spyOn(service as any, 'writeAudit').mockResolvedValue(undefined);

    prismaMock.customerMain.findUnique
      .mockResolvedValueOnce({
        cddStatus: 'REJECTED',
        complianceStatus: 'BLOCKED',
      })
      .mockResolvedValueOnce({
        currentCddCaseId: 'case-1',
      });
    prismaMock.complianceSession.findFirst.mockResolvedValueOnce(null);

    const result = await service.reinitiateCddCases('c1', 'c1');
    expect(result.journeyId).toBe('ONB-1');
    expect(result.currentCddCaseId).toBe('case-1');
    expect(result.session?.caseId).toBe('case-1');
    expect(prismaMock.customerMain.update).not.toHaveBeenCalled();
  });

  it('should not force EXPIRED when cdd is in progress even if old document is expired', async () => {
    recomputeSpy.mockRestore();

    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerType: 'INDIVIDUAL',
      cddDocumentExpiresAt: new Date(Date.now() - 3600 * 1000),
      riskLevel: null,
      riskScore: null,
      finalApprovalStatus: 'NOT_REQUIRED',
      finalApprovalReason: null,
      finalApprovalReviewerId: null,
      finalApprovalReviewedAt: null,
      investorClassification: 'RETAIL',
      investorClassificationSource: 'CDD',
      investorClassificationUpdatedAt: null,
      corporateProfile: null,
      uboProfiles: [],
    });
    prismaMock.cddCase.findMany.mockResolvedValue([
      {
        id: 'case-1',
        customerId: 'c1',
        subjectKind: 'INDIVIDUAL_CUSTOMER',
        subjectRefId: 'c1',
        status: 'PENDING',
        riskScore: 10,
        riskLevel: 'LOW',
        requiresEdd: false,
        reviewedAt: null,
        inputData: null,
        createdAt: new Date(),
      },
    ]);
    prismaMock.eddCase.findMany.mockResolvedValue([]);
    prismaMock.customerMain.update.mockResolvedValue({});

    const result = await service.recomputeComplianceSnapshot('c1', 'ONB-1');
    expect(result.cddStatus).toBe('IN_PROGRESS');
    expect(result.complianceStatus).toBe('IN_PROGRESS');
  });

  it('should set compliance status NONE when cdd is not started', async () => {
    recomputeSpy.mockRestore();

    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerType: 'INDIVIDUAL',
      cddDocumentExpiresAt: null,
      riskLevel: null,
      riskScore: null,
      finalApprovalStatus: 'NOT_REQUIRED',
      finalApprovalReason: null,
      finalApprovalReviewerId: null,
      finalApprovalReviewedAt: null,
      investorClassification: 'RETAIL',
      investorClassificationSource: 'CDD',
      investorClassificationUpdatedAt: null,
      corporateProfile: null,
      uboProfiles: [],
    });
    prismaMock.cddCase.findMany.mockResolvedValue([]);
    prismaMock.eddCase.findMany.mockResolvedValue([]);
    prismaMock.customerMain.update.mockResolvedValue({});

    const result = await service.recomputeComplianceSnapshot('c1', 'ONB-1');
    expect(result.cddStatus).toBe('NOT_STARTED');
    expect(result.complianceStatus).toBe('NONE');
  });

  it('should clear expired document date when reinitiating from EXPIRED state', async () => {
    jest.spyOn(service, 'getNextStep').mockResolvedValue({
      step: 'REINITIATE',
      action: 'REINITIATE_CDD',
      blockedReason: 'CDD expired',
      activeCaseId: null,
      requiresEdd: false,
    });
    jest.spyOn(service, 'bootstrapCddCases').mockResolvedValue({
      journeyId: 'ONB-2',
      items: [{ id: 'case-2' }],
    } as any);
    jest.spyOn(service, 'createCaseSession').mockResolvedValue({
      sessionId: 'ses-2',
      providerSessionId: 'SES-2',
      caseType: 'CDD',
      caseId: 'case-2',
      qrCodeUrl: 'mock://compliance/SES-2',
      expiresAt: new Date(),
      status: 'PENDING',
    } as any);
    jest.spyOn(service as any, 'writeAudit').mockResolvedValue(undefined);

    prismaMock.customerMain.findUnique
      .mockResolvedValueOnce({
        cddStatus: 'EXPIRED',
        complianceStatus: 'EXPIRED',
      })
      .mockResolvedValueOnce({
        currentCddCaseId: 'case-2',
      });
    prismaMock.complianceSession.findFirst.mockResolvedValueOnce(null);

    await service.reinitiateCddCases('c1', 'c1');
    expect(prismaMock.customerMain.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { cddDocumentExpiresAt: null },
    });
  });

  it('should reject mock-complete when session is not pending', async () => {
    prismaMock.complianceSession.findFirst.mockResolvedValueOnce({
      id: 'ses-closed',
      customerId: 'c1',
      status: 'COMPLETED',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    await expect(service.mockCompleteSession('c1', 'c1', 'ses-closed')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('should mark expired session and reject mock-complete', async () => {
    prismaMock.complianceSession.findFirst.mockResolvedValueOnce({
      id: 'ses-expired',
      customerId: 'c1',
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    prismaMock.complianceSession.update.mockResolvedValue({});

    await expect(service.mockCompleteSession('c1', 'c1', 'ses-expired')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prismaMock.complianceSession.update).toHaveBeenCalledWith({
      where: { id: 'ses-expired' },
      data: expect.objectContaining({ status: 'EXPIRED' }),
    });
  });

  it('should reject creating session for non-pending case', async () => {
    prismaMock.cddCase.findFirst.mockResolvedValue({
      id: 'case-1',
      customerId: 'c1',
      caseNo: 'CDD-1',
      subjectKind: 'INDIVIDUAL_CUSTOMER',
      subjectRefId: 'c1',
      status: 'APPROVED',
    });

    await expect(
      service.createCaseSession('c1', 'c1', 'case-1', { caseType: 'CDD', provider: 'MOCK' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
