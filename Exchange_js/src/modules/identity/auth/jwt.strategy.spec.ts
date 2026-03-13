import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const prismaMock: any = {
    customerMain: {
      findUnique: jest.fn(),
    },
  };

  let strategy: JwtStrategy;

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new JwtStrategy(prismaMock);
  });

  it('should reject unsupported token type', async () => {
    await expect(strategy.validate({ type: 'UNKNOWN' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('should allow admin token without customer lookup', async () => {
    const payload = {
      sub: 'admin-1',
      username: 'admin@fiatx.com',
      userNo: 'ADMIN-001',
      role: 'SUPER_ADMIN',
      type: 'ADMIN',
    };

    await expect(strategy.validate(payload)).resolves.toEqual({
      userId: 'admin-1',
      username: 'admin@fiatx.com',
      userNo: 'ADMIN-001',
      role: 'SUPER_ADMIN',
      type: 'ADMIN',
    });
    expect(prismaMock.customerMain.findUnique).not.toHaveBeenCalled();
  });

  it('should reject customer token when account is frozen', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      accountStatus: 'FROZEN',
    });

    await expect(
      strategy.validate({
        sub: 'c1',
        username: 'test@example.com',
        userNo: 'CU-1',
        role: 'CUSTOMER',
        type: 'CUSTOMER',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('should allow customer token when account is active', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      accountStatus: 'ACTIVE',
    });

    await expect(
      strategy.validate({
        sub: 'c1',
        username: 'test@example.com',
        userNo: 'CU-1',
        role: 'CUSTOMER',
        type: 'CUSTOMER',
      }),
    ).resolves.toEqual({
      userId: 'c1',
      username: 'test@example.com',
      userNo: 'CU-1',
      role: 'CUSTOMER',
      type: 'CUSTOMER',
    });
  });
});
