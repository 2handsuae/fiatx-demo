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
  const auditLogsServiceMock: any = {
    recordByActor: jest.fn(),
  };

  let service: CustomerAuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CustomerAuthService(
      prismaMock,
      jwtServiceMock,
      auditLogsServiceMock,
    );
  });

  it('should reject login when compliance hold is frozen', async () => {
    prismaMock.customerMain.findFirst.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU001',
      email: 'test@example.com',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuv',
      complianceStatus: 'FROZEN',
      complianceFreezeReason: 'Compliance freeze',
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
      complianceStatus: 'CLEAR',
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
