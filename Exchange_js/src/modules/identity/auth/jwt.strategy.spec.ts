import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const prismaMock: any = {
    customerMain: {
      findUnique: jest.fn(),
    },
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: 'admin-1', status: 'ACTIVE' }),
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
      roleCodes: ['SUPER_ADMIN', 'MLRO'],
      type: 'ADMIN',
    };

    await expect(strategy.validate(payload)).resolves.toEqual({
      userId: 'admin-1',
      username: 'admin@fiatx.com',
      userNo: 'ADMIN-001',
      role: 'SUPER_ADMIN',
      roleCodes: ['SUPER_ADMIN', 'MLRO'],
      type: 'ADMIN',
      scope: null,
    });
    expect(prismaMock.customerMain.findUnique).not.toHaveBeenCalled();
  });

  it('should backfill roleCodes from role when token payload omits them', async () => {
    await expect(
      strategy.validate({
        sub: 'admin-2',
        username: 'mlro@fiatx.com',
        userNo: 'ADMIN-MLRO',
        role: 'MLRO',
        type: 'ADMIN',
      }),
    ).resolves.toEqual({
      userId: 'admin-2',
      username: 'mlro@fiatx.com',
      userNo: 'ADMIN-MLRO',
      role: 'MLRO',
      roleCodes: ['MLRO'],
      type: 'ADMIN',
      scope: null,
    });
  });

  it('should reject customer token when compliance hold is frozen', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      complianceStatus: 'FROZEN',
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

  it('should allow customer token when restriction is present but hold is active', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      complianceStatus: 'CLEAR',
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
      roleCodes: ['CUSTOMER'],
      type: 'CUSTOMER',
      scope: null,
    });
  });

  it('should allow customer token when complianceStatus is CLEAR', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      complianceStatus: 'CLEAR',
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
      roleCodes: ['CUSTOMER'],
      type: 'CUSTOMER',
      scope: null,
    });
  });
});
