import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccessControlController } from './access-control.controller';
import { AccessControlService } from './access-control.service';
import { ChangeTicketsService } from '../../governance/change-tickets/change-tickets.service';

describe('AccessControlController', () => {
  let controller: AccessControlController;
  const accessControlService = {
    listRoles: jest.fn(),
    listPermissions: jest.fn(),
    getUserRoles: jest.fn(),
    replaceUserRoles: jest.fn(),
  };
  const changeTicketsService = {
    createAdminRoleBindingChangeTicket: jest.fn(),
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
      providers: [
        { provide: AccessControlService, useValue: accessControlService },
        { provide: ChangeTicketsService, useValue: changeTicketsService },
      ],
    }).compile();

    controller = module.get<AccessControlController>(AccessControlController);
    jest.clearAllMocks();
  });

  it('delegates role binding change proposal with actor metadata', async () => {
    changeTicketsService.createAdminRoleBindingChangeTicket.mockResolvedValue({
      id: 'ticket-1',
      ticketNo: 'CT2604030002',
    });

    await controller.replaceUserRoles(
      adminReq,
      'user-1',
      { roleCodes: ['DPO'], changeReason: 'Need DPO access' } as any,
    );

    expect(changeTicketsService.createAdminRoleBindingChangeTicket).toHaveBeenCalledWith(
      'user-1',
      {
        roleCodes: ['DPO'],
        changeReason: 'Need DPO access',
      },
      {
        actorType: 'ADMIN',
        userId: 'admin-1',
        userNo: 'ADMIN-001',
        role: 'SUPER_ADMIN',
        roleCodes: ['SUPER_ADMIN'],
      },
    );
    expect(accessControlService.replaceUserRoles).not.toHaveBeenCalled();
  });

  it('rejects non-admin IAM access', () => {
    expect(() => controller.listRoles(customerReq)).toThrow(ForbiddenException);
  });
});
