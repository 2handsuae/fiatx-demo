import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccessControlController } from './access-control.controller';
import { AccessControlService } from './access-control.service';

describe('AccessControlController', () => {
  let controller: AccessControlController;
  const accessControlService = {
    listRoles: jest.fn(),
    listPermissions: jest.fn(),
    getUserRoles: jest.fn(),
    replaceUserRoles: jest.fn(),
  };

  const adminReq = {
    user: {
      type: 'ADMIN',
      userId: 'admin-1',
      userNo: 'ADMIN-001',
      role: 'SUPER_ADMIN',
    },
  };
  const customerReq = { user: { type: 'CUSTOMER', userId: 'cust-1' } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccessControlController],
      providers: [{ provide: AccessControlService, useValue: accessControlService }],
    }).compile();

    controller = module.get<AccessControlController>(AccessControlController);
    jest.clearAllMocks();
  });

  it('delegates role replacement with actor metadata', async () => {
    accessControlService.replaceUserRoles.mockResolvedValue({
      userId: 'user-1',
      roles: ['DPO'],
    });

    await controller.replaceUserRoles(
      adminReq,
      'user-1',
      { roleCodes: ['DPO'] } as any,
    );

    expect(accessControlService.replaceUserRoles).toHaveBeenCalledWith(
      'user-1',
      ['DPO'],
      {
        actorId: 'admin-1',
        actorRole: 'SUPER_ADMIN',
        actorNo: 'ADMIN-001',
      },
    );
  });

  it('rejects non-admin IAM access', () => {
    expect(() => controller.listRoles(customerReq)).toThrow(ForbiddenException);
  });
});
