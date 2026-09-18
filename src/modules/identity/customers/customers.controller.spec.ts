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
              lifecycle: 'ACTIVE',
            }),
          ]),
        }),
      }),
    );
  });

  it('passes a canonical lifecycle value straight through', () => {
    controller.findAll(
      { user: { type: 'ADMIN' } },
      undefined,
      undefined,
      undefined,
      'PENDING_APPROVAL',
    );

    expect(customersServiceMock.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              lifecycle: 'PENDING_APPROVAL',
            }),
          ]),
        }),
      }),
    );
  });

  it('normalises case and whitespace before matching lifecycle', () => {
    controller.findAll(
      { user: { type: 'ADMIN' } },
      undefined,
      undefined,
      undefined,
      '  in_verification  ',
    );

    expect(customersServiceMock.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              lifecycle: 'IN_VERIFICATION',
            }),
          ]),
        }),
      }),
    );
  });

  it('applies no lifecycle condition when the filter is absent', () => {
    controller.findAll({ user: { type: 'ADMIN' } }, undefined, undefined, undefined, undefined);

    const [arg] = customersServiceMock.findAll.mock.calls[0];
    const conditions = arg.where?.AND ?? [];
    expect(
      conditions.some((c: Record<string, unknown>) => 'lifecycle' in c),
    ).toBe(false);
  });
});
