import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccessControlController } from './access-control.controller';
import { AccessControlService } from './access-control.service';
import { RoleDefinitionCreateWorkflowService } from './role-definition-create-workflow.service';
import { RoleDefinitionModifyWorkflowService } from './role-definition-modify-workflow.service';

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
        { provide: RoleDefinitionCreateWorkflowService, useValue: {} },
        { provide: RoleDefinitionModifyWorkflowService, useValue: {} },
      ],
    }).compile();

    controller = module.get<AccessControlController>(AccessControlController);
    jest.clearAllMocks();
  });

  it('rejects non-admin IAM access', () => {
    expect(() => controller.listRoles(customerReq)).toThrow(ForbiddenException);
  });
});
