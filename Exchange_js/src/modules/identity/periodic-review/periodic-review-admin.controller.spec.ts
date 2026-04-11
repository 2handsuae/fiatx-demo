import { PeriodicReviewAdminController } from './periodic-review-admin.controller';
import { PeriodicReviewService } from './periodic-review.service';

describe('PeriodicReviewAdminController', () => {
  const periodicReviewServiceMock = {
    triggerPeriodicReview: jest.fn(),
  };

  let controller: PeriodicReviewAdminController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new PeriodicReviewAdminController(
      periodicReviewServiceMock as unknown as PeriodicReviewService,
    );
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });
});
