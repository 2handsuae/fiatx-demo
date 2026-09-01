import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { UsersDomainService } from '../users/users.domain.service';
import { AdminInvitationsService } from '../users/admin-invitations.service';
import { AdminInviteWorkflowService } from '../users/admin-invite-workflow.service';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ForbiddenException } from '@nestjs/common';
import { AccessControlService } from '../access-control/access-control.service';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { UserStatusAction } from '../users/constants/user-status-transitions.constant';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: any;
  let usersDomainService: any;
  let eventEmitter: any;
  let accessControlService: any;

  beforeEach(async () => {
    usersService = {
      findOne: jest.fn(),
      findByIdentifier: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
    };

    usersDomainService = {
      applyUserTransition: jest.fn().mockResolvedValue(undefined),
    };

    eventEmitter = {
      emit: jest.fn(),
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
          provide: UsersDomainService,
          useValue: usersDomainService,
        },
        {
          provide: AdminInvitationsService,
          useValue: {
            getInvitationPreview: jest.fn(),
          },
        },
        {
          provide: AdminInviteWorkflowService,
          useValue: {
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
          provide: EventEmitter2,
          useValue: eventEmitter,
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

  it('第一批 · V1 域打点上收：auth.service.ts 不再直接写审计', () => {
    const src = require('fs').readFileSync(`${__dirname}/auth.service.ts`, 'utf8');
    expect(src).not.toMatch(/recordByActor|recordSystem/);
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

    await expect(
      service.validateUser('ciso@fiatx.com', '123456'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each(['INVITE_SENT', 'PENDING_INVITE_APPROVAL'])(
    '%s 账号（受邀未接受/待审批）任意密码登录一律 ForbiddenException，不进失败计数',
    async (status) => {
      usersService.findByIdentifier.mockResolvedValue({
        id: 'user-1',
        userNo: 'ADM-001',
        role: 'CISO',
        email: 'ciso@fiatx.com',
        password: '$2b$10$abc',
        status,
        failedLoginAttempts: 0,
        lockedUntil: null,
      });

      await expect(
        service.validateUser('ciso@fiatx.com', 'any-password'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(usersService.update).not.toHaveBeenCalled();
      expect(usersDomainService.applyUserTransition).not.toHaveBeenCalled();
    },
  );

  it('INVITE_SENT 账号连打 5 次也不会命中 LOCK 分支：迁移表这两态没有 LOCK 边，前置守卫必须先拦住', async () => {
    usersService.findByIdentifier.mockResolvedValue({
      id: 'user-1',
      userNo: 'ADM-001',
      role: 'CISO',
      email: 'ciso@fiatx.com',
      password: '$2b$10$abc',
      status: 'INVITE_SENT',
      failedLoginAttempts: 4,
      lockedUntil: null,
    });

    for (let i = 0; i < 5; i++) {
      await expect(
        service.validateUser('ciso@fiatx.com', 'wrong-password'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }

    expect(usersDomainService.applyUserTransition).not.toHaveBeenCalled();
  });

  it('should reject deleted admin login through active-user lookup filtering', async () => {
    usersService.findByIdentifier.mockResolvedValue(null);

    const result = await service.validateUser('deleted-admin@fiatx.com', '123456');

    expect(result).toBeNull();
    // 登录成功/失败流水归安全日志（本项目不做）——不再断言审计调用。
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('连续失败第 5 次达阈值时 emit ADMIN_LOGIN_CONSECUTIVE_FAILURE，交由 workflow 层写 ADMIN_ACCOUNT_LOCK_APPLIED', async () => {
    usersService.findByIdentifier.mockResolvedValue({
      id: 'user-1',
      userNo: 'ADM-001',
      role: 'CISO',
      email: 'ciso@fiatx.com',
      password: '$2b$10$abc',
      status: 'ACTIVE',
      failedLoginAttempts: 4,
      lockedUntil: null,
    });
    usersService.update.mockResolvedValue(undefined);

    const bcrypt = require('bcrypt');
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(false);

    const result = await service.validateUser('ciso@fiatx.com', 'wrong-password');

    expect(result).toBeNull();
    // Task 9：锁定改变了 status，只经迁移表走——不再走 usersService.update。
    expect(usersDomainService.applyUserTransition).toHaveBeenCalledWith(
      'user-1',
      UserStatusAction.LOCK,
      expect.objectContaining({ failedLoginAttempts: 5, lockedUntil: expect.any(Date) }),
    );
    expect(usersService.update).not.toHaveBeenCalled();
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      DomainEventNames.ADMIN_LOGIN_CONSECUTIVE_FAILURE,
      expect.objectContaining({
        userId: 'user-1',
        userNo: 'ADM-001',
        failedLoginAttempts: 5,
      }),
    );
  });

  it('锁定到期后首次登录自动解锁：emit ADMIN_LOGIN_AUTO_UNLOCKED，交由 workflow 层写 ADMIN_ACCOUNT_LOCK_RELEASED', async () => {
    usersService.findByIdentifier.mockResolvedValue({
      id: 'user-1',
      userNo: 'ADM-001',
      role: 'CISO',
      email: 'ciso@fiatx.com',
      password: '$2b$10$abc',
      status: 'LOCKED',
      failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() - 1000),
    });
    usersService.update.mockResolvedValue(undefined);

    const bcrypt = require('bcrypt');
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);

    await service.validateUser('ciso@fiatx.com', '123456');

    // Task 9：自动解锁改变了 status，只经迁移表走——不再走 usersService.update。
    expect(usersDomainService.applyUserTransition).toHaveBeenCalledWith(
      'user-1',
      UserStatusAction.UNLOCK,
      { failedLoginAttempts: 0, lockedUntil: null },
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      DomainEventNames.ADMIN_LOGIN_AUTO_UNLOCKED,
      expect.objectContaining({ userId: 'user-1', userNo: 'ADM-001' }),
    );
  });

  it('锁定仍未到期时不自动解锁、不 emit 解锁事件', async () => {
    usersService.findByIdentifier.mockResolvedValue({
      id: 'user-1',
      userNo: 'ADM-001',
      role: 'CISO',
      email: 'ciso@fiatx.com',
      password: '$2b$10$abc',
      status: 'LOCKED',
      failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() + 60000),
    });

    await expect(
      service.validateUser('ciso@fiatx.com', '123456'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(usersService.update).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalledWith(
      DomainEventNames.ADMIN_LOGIN_AUTO_UNLOCKED,
      expect.anything(),
    );
  });

  it('未达阈值的失败登录不 emit 锁定事件', async () => {
    usersService.findByIdentifier.mockResolvedValue({
      id: 'user-1',
      userNo: 'ADM-001',
      role: 'CISO',
      email: 'ciso@fiatx.com',
      password: '$2b$10$abc',
      status: 'ACTIVE',
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    usersService.update.mockResolvedValue(undefined);

    const bcrypt = require('bcrypt');
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(false);

    await service.validateUser('ciso@fiatx.com', 'wrong-password');

    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('should return resolved role and permission sets for admin session', async () => {
    usersService.findById.mockResolvedValue({
      id: 'user-1',
      userNo: 'ADMIN-TECH',
      email: 'tech_admin@fiatx.com',
      status: 'ACTIVE',
      lastLoginAt: new Date('2026-03-15T08:00:00.000Z'),
    });
    accessControlService.getUserRoleCodes.mockResolvedValue(['TECH_OFFICER']);
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
        roles: ['TECH_OFFICER'],
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
    expect((result as any).user.roles).toEqual(['SUPER_ADMIN', 'MLRO']);
  });

  it('successful admin login clears failed attempts and returns a fresh authTraceId without writing audit', async () => {
    usersService.findByIdentifier.mockResolvedValue({
      id: 'user-1',
      userNo: 'ADMIN-001',
      role: 'SUPER_ADMIN',
      email: 'admin@fiatx.com',
      password: '$2b$10$YjgDqqV9A6t5r2On1m8xP.Ef9nQ4myS0xFjM8g9v8T6SdR5QQVh6W',
      status: 'ACTIVE',
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
    });
    usersService.update.mockResolvedValue(undefined);

    const bcrypt = require('bcrypt');
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);

    const result = await service.validateUser('admin@fiatx.com', '123456', {
      requestId: 'req-login-1',
      sourceIp: '127.0.0.1',
      sourcePlatform: 'ADMIN_AUTH_API',
    });

    expect(result).toEqual(
      expect.objectContaining({ userNo: 'ADMIN-001', authTraceId: expect.any(String) }),
    );
    expect(usersService.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failedLoginAttempts: 0, lockedUntil: null }),
      }),
    );
    // 登录成功流水归安全日志（本项目不做）——不再写审计、不再 emit 锁定事件。
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('should reject deleted admin session snapshots', async () => {
    usersService.findById.mockResolvedValue(null);

    await expect(service.getAdminSession('deleted-user')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
