import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { ForbiddenException } from '@nestjs/common';

describe('UsersController', () => {
  let controller: UsersController;

  const mockUsersService = {
    createAdminUser: jest.fn(),
    findAll: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should create admin user with actor context', async () => {
    mockUsersService.createAdminUser.mockResolvedValue({
      id: 'user-1',
      email: 'new-admin@fiatx.com',
      roles: ['IAM_ADMIN'],
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
      roleCodes: ['IAM_ADMIN'],
    };

    await controller.create(req, body as any);

    expect(mockUsersService.createAdminUser).toHaveBeenCalledWith({
      email: 'new-admin@fiatx.com',
      roleCodes: ['IAM_ADMIN'],
      actor: {
        actorId: 'actor-1',
        actorNo: 'ADMIN-001',
        actorRole: 'SUPER_ADMIN',
      },
    });
  });

  it('should reject create when token is not admin', async () => {
    const req = {
      user: {
        type: 'CUSTOMER',
      },
    };

    await expect(
      controller.create(req, { email: 'x@fiatx.com', roleCodes: ['IAM_ADMIN'] } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
