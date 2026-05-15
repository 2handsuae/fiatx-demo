import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { ForbiddenException } from '@nestjs/common';
import { AdminInviteWorkflowService } from './admin-invite-workflow.service';
import { AdminSuspensionWorkflowService } from './admin-suspension-workflow.service';
import { AdminReactivationWorkflowService } from './admin-reactivation-workflow.service';
import { AdminPasswordResetWorkflowService } from './admin-password-reset-workflow.service';

describe('UsersController', () => {
  let controller: UsersController;

  const mockUsersService = {
    createAdminUser: jest.fn(),
    findAll: jest.fn(),
    getMemberDetail: jest.fn(),
    resendAdminInvitation: jest.fn(),
  };

  const mockAdminInviteWorkflow = {
    initiateInvite: jest.fn(),
  };

  const mockAdminSuspensionWorkflow = {
    initiateSuspension: jest.fn(),
  };

  const mockAdminReactivationWorkflow = {
    initiateReactivation: jest.fn(),
  };

  const mockAdminPasswordResetWorkflow = {
    initiateReset: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
        {
          provide: AdminInviteWorkflowService,
          useValue: mockAdminInviteWorkflow,
        },
        {
          provide: AdminSuspensionWorkflowService,
          useValue: mockAdminSuspensionWorkflow,
        },
        {
          provide: AdminReactivationWorkflowService,
          useValue: mockAdminReactivationWorkflow,
        },
        {
          provide: AdminPasswordResetWorkflowService,
          useValue: mockAdminPasswordResetWorkflow,
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call adminInviteWorkflow.initiateInvite when creating an admin user', async () => {
    mockAdminInviteWorkflow.initiateInvite.mockResolvedValue({ approvalNo: 'APR-001' });

    const req = {
      user: {
        type: 'ADMIN',
        userId: 'actor-1',
        userNo: 'ADMIN-001',
        role: 'SUPER_ADMIN',
        roleCodes: ['SUPER_ADMIN'],
      },
    };

    const body = {
      email: 'new-admin@fiatx.com',
      roleCodes: ['CISO'],
      changeReason: 'Need emergency admin coverage',
    };

    await controller.create(req, body as any);

    expect(mockAdminInviteWorkflow.initiateInvite).toHaveBeenCalledWith(
      {
        email: 'new-admin@fiatx.com',
        roleCodes: ['CISO'],
        changeReason: 'Need emergency admin coverage',
      },
      expect.objectContaining({ actorType: 'ADMIN', userId: 'actor-1' }),
    );
  });

  it('should reject create when token is not admin', async () => {
    const req = {
      user: {
        type: 'CUSTOMER',
      },
    };

    await expect(
      controller.create(req, { email: 'x@fiatx.com', roleCodes: ['CISO'] } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('delegates GET /users/:id to getMemberDetail', async () => {
    mockUsersService.getMemberDetail.mockResolvedValue({
      id: 'user-1',
      userNo: 'ADM2602190001',
      email: 'inactive-admin@fiatx.com',
      status: 'INACTIVE',
      roles: ['CISO'],
      latestInvitation: {
        inviteStatus: 'PENDING',
        inviteExpiresAt: '2026-02-20T00:00:00.000Z',
      },
    });

    const req = {
      user: {
        type: 'ADMIN',
      },
    };

    await expect(controller.findOne(req, 'user-1')).resolves.toEqual({
      id: 'user-1',
      userNo: 'ADM2602190001',
      email: 'inactive-admin@fiatx.com',
      status: 'INACTIVE',
      roles: ['CISO'],
      latestInvitation: {
        inviteStatus: 'PENDING',
        inviteExpiresAt: '2026-02-20T00:00:00.000Z',
      },
    });
    expect(mockUsersService.getMemberDetail).toHaveBeenCalledWith('user-1');
  });
});
