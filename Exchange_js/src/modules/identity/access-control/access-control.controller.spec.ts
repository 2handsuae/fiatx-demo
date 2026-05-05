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
  };

  const customerReq = { user: { type: 'CUSTOMER', userId: 'cust-1' } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccessControlController],
      providers: [
        { provide: AccessControlService, useValue: accessControlService },
      ],
    }).compile();

    controller = module.get<AccessControlController>(AccessControlController);
    jest.clearAllMocks();
  });

  it('rejects non-admin IAM access', () => {
    expect(() => controller.listRoles(customerReq)).toThrow(ForbiddenException);
  });
});
