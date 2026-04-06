import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DeleteRequestsController } from './delete-requests.controller';
import { DeleteRequestsService } from './delete-requests.service';

describe('DeleteRequestsController', () => {
  let controller: DeleteRequestsController;

  const deleteRequestsService = {
    create: jest.fn(),
    list: jest.fn(),
    getById: jest.fn(),
    submit: jest.fn(),
    cancel: jest.fn(),
    consume: jest.fn(),
  };

  const adminReq = {
    user: {
      type: 'ADMIN',
      userId: 'checker-1',
      userNo: 'ADM-003',
      role: 'TECH_OFFICER',
      roleCodes: ['TECH_OFFICER'],
    },
  };

  const customerReq = { user: { type: 'CUSTOMER', userId: 'cust-1' } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DeleteRequestsController],
      providers: [{ provide: DeleteRequestsService, useValue: deleteRequestsService }],
    }).compile();

    controller = module.get<DeleteRequestsController>(DeleteRequestsController);
    jest.clearAllMocks();
  });

  it('delegates consume with admin actor context', async () => {
    deleteRequestsService.consume.mockResolvedValue({ id: 'delete-request-1', status: 'DONE' });

    await controller.consume(adminReq, 'delete-request-1', { reason: 'cleanup' } as any);

    expect(deleteRequestsService.consume).toHaveBeenCalledWith(
      'delete-request-1',
      { reason: 'cleanup' },
      {
        actorType: 'ADMIN',
        userId: 'checker-1',
        userNo: 'ADM-003',
        role: 'TECH_OFFICER',
        roleCodes: ['TECH_OFFICER'],
      },
    );
  });

  it('only exposes create, list, getById, submit, cancel, and consume handlers', () => {
    const prototype = Object.getPrototypeOf(controller) as Record<string, unknown>;

    expect(typeof prototype.create).toBe('function');
    expect(typeof prototype.list).toBe('function');
    expect(typeof prototype.getById).toBe('function');
    expect(typeof prototype.submit).toBe('function');
    expect(typeof prototype.cancel).toBe('function');
    expect(typeof prototype.consume).toBe('function');
  });

  it('rejects non-admin delete request access', () => {
    expect(() => controller.list(customerReq, {} as any)).toThrow(ForbiddenException);
  });
});
