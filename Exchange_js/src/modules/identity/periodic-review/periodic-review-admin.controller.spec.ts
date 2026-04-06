import { ForbiddenException } from '@nestjs/common';
import { PeriodicReviewAdminController } from './periodic-review-admin.controller';
import { PeriodicReviewService } from './periodic-review.service';

describe('PeriodicReviewAdminController', () => {
  const periodicReviewServiceMock = {
    triggerPeriodicReview: jest.fn(),
    applyDecisionFromAlert: jest.fn(),
    applyDecisionFromIncident: jest.fn(),
  };

  let controller: PeriodicReviewAdminController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new PeriodicReviewAdminController(
      periodicReviewServiceMock as unknown as PeriodicReviewService,
    );
  });

  it('rejects customer token for case decision route', async () => {
    await expect(
      controller.applyPeriodicReviewDecisionFromCase(
        { user: { type: 'CUSTOMER' } },
        'case-1',
        { decision: 'CLEAR' } as any,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('delegates canonical case decision route with case-only payload', async () => {
    periodicReviewServiceMock.applyDecisionFromIncident.mockResolvedValue({
      case: { id: 'case-1', caseNo: 'CAS2603220001' },
      alert: { id: 'alert-1' },
      proposal: { workflowDecision: 'CLEAR' },
    });

    const result = await controller.applyPeriodicReviewDecisionFromCase(
      {
        user: {
          type: 'ADMIN',
          userId: 'admin-1',
          role: 'COMPLIANCE_OFFICER',
        },
      },
      'case-1',
      { decision: 'CLEAR' } as any,
    );

    expect(periodicReviewServiceMock.applyDecisionFromIncident).toHaveBeenCalledWith(
      'case-1',
      'admin-1',
      'COMPLIANCE_OFFICER',
      { decision: 'CLEAR' },
    );
    expect(result.case).toEqual({ id: 'case-1', caseNo: 'CAS2603220001' });
    expect(result).not.toHaveProperty('incident');
  });
});
