import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { ForbiddenException } from '@nestjs/common';
import { ChangeTicketsService } from '../../governance/change-tickets/change-tickets.service';

describe('UsersController', () => {
  let controller: UsersController;

  const mockUsersService = {
    createAdminUser: jest.fn(),
    findAll: jest.fn(),
    getMemberDetail: jest.fn(),
    resendAdminInvitation: jest.fn(),
  };

  const mockChangeTicketsService = {
    createAdminMemberProvisioningTicket: jest.fn(),
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
          provide: ChangeTicketsService,
          useValue: mockChangeTicketsService,
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should create admin member provisioning change ticket with actor context', async () => {
    mockChangeTicketsService.createAdminMemberProvisioningTicket.mockResolvedValue({
      id: 'ticket-1',
      ticketNo: 'CT2604030001',
    });

    const req = {
      user: {
        type: 'ADMIN',
        userId: 'actor-1',
        userNo: 'ADMIN-001',
        role: 'SUPER_ADMIN',
      },
    };

    const body = {
      email: 'new-admin@fiatx.com',
      roleCodes: ['CISO'],
      changeReason: 'Need emergency admin coverage',
    };

    await controller.create(req, body as any);

    expect(mockChangeTicketsService.createAdminMemberProvisioningTicket).toHaveBeenCalledWith({
      email: 'new-admin@fiatx.com',
      roleCodes: ['CISO'],
      changeReason: 'Need emergency admin coverage',
    }, {
      actorType: 'ADMIN',
      userId: 'actor-1',
      userNo: 'ADMIN-001',
      role: 'SUPER_ADMIN',
      roleCodes: ['SUPER_ADMIN'],
    });
    expect(mockUsersService.createAdminUser).not.toHaveBeenCalled();
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
