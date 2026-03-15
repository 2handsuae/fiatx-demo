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
    execute: jest.fn(),
  };

  const adminReq = {
    user: {
      type: 'ADMIN',
      userId: 'executor-1',
      userNo: 'ADM-003',
      role: 'TECH_ADMIN',
      roleCodes: ['TECH_ADMIN'],
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

  it('delegates execute with admin actor context', async () => {
    deleteRequestsService.execute.mockResolvedValue({ id: 'delete-request-1', status: 'EXECUTED' });

    await controller.execute(adminReq, 'delete-request-1', { reason: 'cleanup' } as any);

    expect(deleteRequestsService.execute).toHaveBeenCalledWith(
      'delete-request-1',
      { reason: 'cleanup' },
      {
        actorType: 'ADMIN',
        userId: 'executor-1',
        userNo: 'ADM-003',
        role: 'TECH_ADMIN',
        roleCodes: ['TECH_ADMIN'],
      },
    );
  });

  it('rejects non-admin delete request access', () => {
    expect(() => controller.list(customerReq, {} as any)).toThrow(ForbiddenException);
  });
});
