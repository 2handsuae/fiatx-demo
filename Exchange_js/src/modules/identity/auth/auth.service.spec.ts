import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { AdminInvitationsService } from '../users/admin-invitations.service';
import { JwtService } from '@nestjs/jwt';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import { ForbiddenException } from '@nestjs/common';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: any;
  let auditLogsService: any;

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
      role: 'IAM_ADMIN',
      email: 'iam_admin@fiatx.com',
      password: '$2b$10$abc',
      status: 'INACTIVE',
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    auditLogsService.recordByActor.mockResolvedValue({});

    await expect(
      service.validateUser('iam_admin@fiatx.com', '123456'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(auditLogsService.recordByActor).toHaveBeenCalled();
  });
});
