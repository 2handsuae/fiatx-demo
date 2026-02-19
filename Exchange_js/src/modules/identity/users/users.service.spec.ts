import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccessControlService } from '../access-control/access-control.service';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import { ConflictException } from '@nestjs/common';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;
  let accessControlService: any;
  let auditLogsService: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    accessControlService = {
      replaceUserRoles: jest.fn(),
    };

    auditLogsService = {
      recordByActor: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: AccessControlService,
          useValue: accessControlService,
        },
        {
          provide: AuditLogsService,
          useValue: auditLogsService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create admin user and bind roles', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'user-1',
      userNo: 'ADM2602190001',
      email: 'new-admin@fiatx.com',
      role: 'IAM_ADMIN',
      status: 'ACTIVE',
    });
    accessControlService.replaceUserRoles.mockResolvedValue({
      userId: 'user-1',
      userNo: 'ADM2602190001',
      roles: ['IAM_ADMIN'],
      warnings: [],
    });
    auditLogsService.recordByActor.mockResolvedValue({});

    const result = await service.createAdminUser({
      email: 'new-admin@fiatx.com',
      roleCodes: ['IAM_ADMIN'],
      actor: {
        actorId: 'admin-1',
        actorRole: 'SUPER_ADMIN',
        actorNo: 'ADMIN-001',
      },
    });

    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    const createdPayload = prisma.user.create.mock.calls[0][0];
    expect(createdPayload.data.email).toBe('new-admin@fiatx.com');
    expect(createdPayload.data.role).toBe('IAM_ADMIN');
    expect(createdPayload.data.password).not.toBe('123456');
    expect(createdPayload.data.password).toBeDefined();

    expect(accessControlService.replaceUserRoles).toHaveBeenCalledWith(
      'user-1',
      ['IAM_ADMIN'],
      {
        actorId: 'admin-1',
        actorRole: 'SUPER_ADMIN',
        actorNo: 'ADMIN-001',
      },
    );
    expect(auditLogsService.recordByActor).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      id: 'user-1',
      userNo: 'ADM2602190001',
      email: 'new-admin@fiatx.com',
      roles: ['IAM_ADMIN'],
    });
  });

  it('should throw conflict when email already exists', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

    await expect(
      service.createAdminUser({
        email: 'existing@fiatx.com',
        roleCodes: ['IAM_ADMIN'],
        actor: {
          actorId: 'admin-1',
          actorRole: 'SUPER_ADMIN',
          actorNo: 'ADMIN-001',
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
