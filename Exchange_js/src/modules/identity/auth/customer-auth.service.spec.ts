import { ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { CustomerAuthService } from './customer-auth.service';

describe('CustomerAuthService', () => {
  const prismaMock: any = {
    customerMain: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  const jwtServiceMock: any = {
    sign: jest.fn(),
  };

  let service: CustomerAuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CustomerAuthService(prismaMock, jwtServiceMock);
  });

  it('第一批 · V1 域打点上收：customer-auth.service.ts 不再直接写审计', () => {
    const src = require('fs').readFileSync(`${__dirname}/customer-auth.service.ts`, 'utf8');
    expect(src).not.toMatch(/recordByActor|recordSystem/);
  });

  // ★ 本轮语义反转（Task 5）：登录门只认关系是否终止。
  // 被制裁的客户【必须能登录】，且登录体验与常人无异 —— 在登录页竖一块
  // 「账号已冻结」的牌子，本身就是把调查告知当事人（tipping-off，多数 AML
  // 法域的刑事犯罪）。受限客户同样要能登录：他们得看到 DISCLOSED 提示、去补材料。
  it('制裁客户（有 OPEN SANCTION 限制）允许登录 —— 本轮语义反转', async () => {
    const passwordHash = await bcrypt.hash('123456', 4);
    prismaMock.customerMain.findFirst.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU001',
      email: 'test@example.com',
      passwordHash,
      lifecycle: 'ACTIVE',
      failedLoginCount: 0,
    });

    await expect(
      service.validateCustomer('test@example.com', '123456'),
    ).resolves.toMatchObject({ id: 'c1' });
  });

  it('关系已终止（OFFBOARDED）的客户被拒登录，且【不写】任何提示性合规审计', async () => {
    prismaMock.customerMain.findFirst.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU001',
      email: 'test@example.com',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuv',
      lifecycle: 'OFFBOARDED',
      failedLoginCount: 0,
    });

    await expect(
      service.validateCustomer('test@example.com', '123456'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prismaMock.customerMain.update).not.toHaveBeenCalled();
  });

  it('should allow login when restriction is active but hold is not frozen', async () => {
    const passwordHash = await bcrypt.hash('123456', 4);
    prismaMock.customerMain.findFirst.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU001',
      email: 'test@example.com',
      passwordHash,
      lifecycle: 'ACTIVE',
      failedLoginCount: 1,
      lockedUntil: null,
    });
    prismaMock.customerMain.update.mockResolvedValue({});

    const result = await service.validateCustomer('test@example.com', '123456');

    expect(result).toEqual(
      expect.objectContaining({
        id: 'c1',
        email: 'test@example.com',
      }),
    );
    expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({
          failedLoginCount: 0,
          lockedUntil: null,
        }),
      }),
    );
  });
});
