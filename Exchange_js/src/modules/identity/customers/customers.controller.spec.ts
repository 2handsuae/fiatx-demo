import { Test, TestingModule } from '@nestjs/testing';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

describe('CustomersController', () => {
  let controller: CustomersController;
  const customersServiceMock = {
    findAll: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CustomersController],
      providers: [
        {
          provide: CustomersService,
          useValue: customersServiceMock,
        },
      ],
    }).compile();

    controller = module.get<CustomersController>(CustomersController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should map legacy ACTIVE filter to canonical active conditions', () => {
    controller.findAll({ user: { type: 'ADMIN' } }, undefined, undefined, undefined, 'ACTIVE');

    expect(customersServiceMock.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              onboardingStatus: 'APPROVED',
              adminStatus: 'ACTIVE',
            }),
          ]),
        }),
      }),
    );
  });

  it('maps legacy PENDING_CDD filter to canonical PENDING_VERIFICATION', () => {
    controller.findAll({ user: { type: 'ADMIN' } }, undefined, undefined, undefined, 'PENDING_CDD');

    expect(customersServiceMock.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              onboardingStatus: 'PENDING_VERIFICATION',
            }),
          ]),
        }),
      }),
    );
  });

  it('maps legacy REVIEW_CDD filter to canonical PENDING_VERIFICATION', () => {
    controller.findAll(
      { user: { type: 'ADMIN' } },
      undefined,
      undefined,
      undefined,
      'REVIEW_CDD',
    );

    expect(customersServiceMock.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              onboardingStatus: 'PENDING_VERIFICATION',
            }),
          ]),
        }),
      }),
    );
  });

  it('maps legacy REVIEW_EDD filter to canonical PENDING_VERIFICATION', () => {
    controller.findAll({ user: { type: 'ADMIN' } }, undefined, undefined, undefined, 'REVIEW_EDD');

    expect(customersServiceMock.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              onboardingStatus: 'PENDING_VERIFICATION',
            }),
          ]),
        }),
      }),
    );
  });

  it('maps legacy PENDING_EDD filter to canonical PENDING_VERIFICATION', () => {
    controller.findAll({ user: { type: 'ADMIN' } }, undefined, undefined, undefined, 'PENDING_EDD');

    expect(customersServiceMock.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              onboardingStatus: 'PENDING_VERIFICATION',
            }),
          ]),
        }),
      }),
    );
  });

  it('maps stored PENDING_EDD_INPUT status to canonical PENDING_VERIFICATION', () => {
    controller.findAll(
      { user: { type: 'ADMIN' } },
      undefined,
      undefined,
      undefined,
      'PENDING_EDD_INPUT',
    );

    expect(customersServiceMock.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              onboardingStatus: 'PENDING_VERIFICATION',
            }),
          ]),
        }),
      }),
    );
  });

  it('should accept canonical onboarding status directly', () => {
    controller.findAll(
      { user: { type: 'ADMIN' } },
      undefined,
      undefined,
      undefined,
      'FINAL_APPROVAL',
    );

    expect(customersServiceMock.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              onboardingStatus: 'FINAL_APPROVAL',
            }),
          ]),
        }),
      }),
    );
  });
});
