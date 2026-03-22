import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { AdminInvitationsService } from '../users/admin-invitations.service';
import { JwtService } from '@nestjs/jwt';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import { ForbiddenException } from '@nestjs/common';
import { AccessControlService } from '../access-control/access-control.service';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: any;
  let auditLogsService: any;
  let accessControlService: any;

  beforeEach(async () => {
    usersService = {
      findOne: jest.fn(),
      findByIdentifier: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
    };

    auditLogsService = {
      recordByActor: jest.fn(),
    };

    accessControlService = {
      getUserRoleCodes: jest.fn(),
      getUserPermissionCodes: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: usersService,
        },
        {
          provide: AdminInvitationsService,
          useValue: {
            getInvitationPreview: jest.fn(),
            acceptInvitation: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
          },
        },
        {
          provide: AuditLogsService,
          useValue: auditLogsService,
        },
        {
          provide: AccessControlService,
          useValue: accessControlService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should reject inactive admin login with readable message', async () => {
    usersService.findByIdentifier.mockResolvedValue({
      id: 'user-1',
      userNo: 'ADM-001',
      role: 'CISO',
      email: 'ciso@fiatx.com',
      password: '$2b$10$abc',
      status: 'INACTIVE',
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    auditLogsService.recordByActor.mockResolvedValue({});

    await expect(
      service.validateUser('ciso@fiatx.com', '123456'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(auditLogsService.recordByActor).toHaveBeenCalled();
  });

  it('should return resolved role and permission sets for admin session', async () => {
    usersService.findById.mockResolvedValue({
      id: 'user-1',
      userNo: 'ADMIN-TECH',
      email: 'tech_admin@fiatx.com',
      status: 'ACTIVE',
      lastLoginAt: new Date('2026-03-15T08:00:00.000Z'),
    });
    accessControlService.getUserRoleCodes.mockResolvedValue(['TECH_ADMIN']);
    accessControlService.getUserPermissionCodes.mockResolvedValue([
      'api.get.admin_control_gates_change_tickets',
      'api.post.admin_control_gates_change_tickets',
      'api.get.admin_control_gates_sla_timers',
    ]);

    const result = await service.getAdminSession('user-1');

    expect(result).toEqual(
      expect.objectContaining({
        id: 'user-1',
        userNo: 'ADMIN-TECH',
        roles: ['TECH_ADMIN'],
        permissions: [
          'api.get.admin_control_gates_change_tickets',
          'api.post.admin_control_gates_change_tickets',
          'api.get.admin_control_gates_sla_timers',
        ],
      }),
    );
  });

  it('should include roleCodes in admin login token payload and response user', async () => {
    accessControlService.getUserRoleCodes.mockResolvedValue([
      'SUPER_ADMIN',
      'MLRO',
    ]);
    const jwtSign = (service as any).jwtService.sign as jest.Mock;
    jwtSign.mockReturnValue('token');

    const result = await service.login({
      id: 'user-1',
      userNo: 'ADMIN-001',
      email: 'admin@fiatx.com',
      role: 'SUPER_ADMIN',
      lastLoginAt: new Date('2026-03-20T09:00:00.000Z'),
    });

    expect(jwtSign).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'SUPER_ADMIN',
        roleCodes: ['SUPER_ADMIN', 'MLRO'],
        type: 'ADMIN',
      }),
    );
    expect(result.user.roles).toEqual(['SUPER_ADMIN', 'MLRO']);
  });
});
