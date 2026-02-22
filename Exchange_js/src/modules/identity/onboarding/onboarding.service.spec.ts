import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';

describe('OnboardingService', () => {
  const prismaMock: any = {
    customerMain: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    cddCase: {
      findUnique: jest.fn(),
    },
    eddCase: {
      findUnique: jest.fn(),
    },
    complianceSession: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    onboardingAuditLog: {
      create: jest.fn(),
    },
  };

  const riskEngineMock: any = {
    evaluate: jest.fn(),
  };

  const complianceAlertsMock: any = {
    triggerSystemAlert: jest.fn(),
    applyAction: jest.fn(),
  };

  let service: OnboardingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OnboardingService(prismaMock, riskEngineMock, complianceAlertsMock);
  });

  it('should allow trading when public status is ACTIVE', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU1',
      publicStatus: 'ACTIVE',
      complianceStatus: 'ACTIVE',
      cddStatus: 'APPROVED',
      eddStatus: 'NOT_REQUIRED',
      finalApprovalStatus: 'APPROVED',
    });

    await expect(service.assertTradingEligibility('c1', 'SWAP')).resolves.toBeUndefined();
  });

  it('should block trading when public status is not ACTIVE', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU1',
      publicStatus: 'REVIEW_CDD',
      complianceStatus: 'IN_PROGRESS',
      cddStatus: 'PENDING_REVIEW',
      eddStatus: 'NOT_REQUIRED',
      finalApprovalStatus: 'NOT_REQUIRED',
    });

    await expect(service.assertTradingEligibility('c1', 'WITHDRAW')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('should throw when customer does not exist for trading gate', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue(null);

    await expect(service.assertTradingEligibility('missing', 'SWAP')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('should return WAIT_REVIEW action when public status is REVIEW_CDD', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      publicStatus: 'REVIEW_CDD',
      activeCaseId: 'cdd-1',
      eddRequired: false,
    });

    const result = await service.getNextStep('c1');

    expect(result.publicStatus).toBe('REVIEW_CDD');
    expect(result.actions).toEqual([{ type: 'WAIT_REVIEW' }]);
    expect(result.blockedReason).toContain('waiting compliance handling');
    expect(result.activeCaseId).toBe('cdd-1');
    expect(result.requiresEdd).toBe(false);
  });

  it('should return REINITIATE_CDD action when public status is REJECTED', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      publicStatus: 'REJECTED',
      activeCaseId: null,
      eddRequired: false,
    });

    const result = await service.getNextStep('c1');

    expect(result.publicStatus).toBe('REJECTED');
    expect(result.actions).toEqual([{ type: 'REINITIATE_CDD' }]);
    expect(result.blockedReason).toContain('Re-initiate');
  });

  it('should reject creating session for non-created case', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
    });
    prismaMock.cddCase.findUnique.mockResolvedValue({
      id: 'case-1',
      customerId: 'c1',
      status: 'FINAL',
    });

    await expect(
      service.createCaseSession('c1', 'c1', 'case-1', { caseType: 'CDD', provider: 'MOCK' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should reject mock-complete when session is not pending', async () => {
    prismaMock.complianceSession.findFirst.mockResolvedValue({
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
    prismaMock.complianceSession.findFirst.mockResolvedValue({
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

  it('should clear expiry metadata before reinitiate', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      publicStatus: 'REJECTED',
      cddStatus: 'REJECTED',
    });
    prismaMock.customerMain.update.mockResolvedValue({});
    jest.spyOn(service, 'startCddCases').mockResolvedValue({
      journeyId: 'ONB-2',
      currentCddCaseId: 'case-2',
      session: null,
      publicStatus: 'PENDING_CDD',
      actions: [{ type: 'COMPLETE_CDD' }],
    } as any);

    await service.reinitiateCddCases('c1', 'c1');

    expect(prismaMock.customerMain.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: {
        cddDocumentExpiresAt: null,
        finalApprovalReason: null,
        finalApprovalReviewerId: null,
        finalApprovalReviewedAt: null,
      },
    });
  });

  it('should recompute NONE status into baseline legacy snapshot', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      publicStatus: 'NONE',
    });
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      publicStatus: 'NONE',
      cddStatus: 'NOT_STARTED',
      eddStatus: 'NOT_REQUIRED',
      complianceStatus: 'NONE',
      finalApprovalStatus: 'NOT_REQUIRED',
    });

    const result = await service.recomputeComplianceSnapshot('c1', 'ONB-1');

    expect(prismaMock.customerMain.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: expect.objectContaining({
        publicStatus: 'NONE',
        cddStatus: 'NOT_STARTED',
        eddStatus: 'NOT_REQUIRED',
        complianceStatus: 'NONE',
      }),
    });
    expect(result.complianceStatus).toBe('NONE');
  });
});
