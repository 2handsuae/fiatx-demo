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

  // ★ 本轮语义反转（Task 5）：会话层只认关系是否终止。
  // 被制裁/受限的客户会话【照常放行】—— 每请求 403 本身就是告知调查（tipping-off）。
  // 能不能干事由能力门（CustomerAccessService）判，不在会话层现形。
  it('制裁客户（有 OPEN SANCTION 限制）会话照常放行 —— 本轮语义反转', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      lifecycle: 'ACTIVE',
    });

    await expect(
      strategy.validate({
        sub: 'c1',
        username: 'test@example.com',
        userNo: 'CU-1',
        role: 'CUSTOMER',
        type: 'CUSTOMER',
      }),
    ).resolves.toMatchObject({ userId: 'c1', type: 'CUSTOMER' });
  });

  it('关系已终止（OFFBOARDED）的客户会话被拒', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      lifecycle: 'OFFBOARDED',
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

  it.each(['REJECTED', 'WITHDRAWN'] as const)(
    '%s 的客户会话仍放行（他们要能重新申请）',
    async (lifecycle) => {
      prismaMock.customerMain.findUnique.mockResolvedValue({ id: 'c1', lifecycle });

      await expect(
        strategy.validate({
          sub: 'c1',
          username: 'test@example.com',
          userNo: 'CU-1',
          role: 'CUSTOMER',
          type: 'CUSTOMER',
        }),
      ).resolves.toMatchObject({ userId: 'c1' });
    },
  );

  it('should allow customer token when restriction is present but hold is active', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      lifecycle: 'ACTIVE',
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
      lifecycle: 'ACTIVE',
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
