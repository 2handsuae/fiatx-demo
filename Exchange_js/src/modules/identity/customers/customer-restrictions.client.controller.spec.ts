import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { CustomerRestrictionsClientController } from './customer-restrictions.client.controller';
import { CustomerAccessService } from './customer-access.service';

describe('CustomerRestrictionsClientController', () => {
  let controller: CustomerRestrictionsClientController;
  let access: { resolve: jest.Mock };

  beforeEach(async () => {
    access = { resolve: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CustomerRestrictionsClientController],
      providers: [{ provide: CustomerAccessService, useValue: access }],
    }).compile();

    controller = module.get(CustomerRestrictionsClientController);
  });

  afterEach(() => jest.clearAllMocks());

  it('被制裁客户（SILENT，全能力被封）拿到的是空数组 —— 零痕迹', async () => {
    access.resolve.mockResolvedValue({
      lifecycle: 'ACTIVE',
      blocked: new Set(['DEPOSIT', 'WITHDRAW', 'SWAP']),
      disclosedBlocked: new Set(),
      disclosed: [],
      openCount: 1,
    });

    const result = await controller.list({ user: { type: 'CUSTOMER', userId: 'cust-1' } });

    expect(access.resolve).toHaveBeenCalledWith('cust-1');
    expect(result).toEqual([]);
  });

  it('没有任何限制的正常客户，响应与被制裁客户逐字节相等', async () => {
    access.resolve.mockResolvedValue({
      lifecycle: 'ACTIVE',
      blocked: new Set(),
      disclosedBlocked: new Set(),
      disclosed: [],
      openCount: 0,
    });

    const clean = await controller.list({ user: { type: 'CUSTOMER', userId: 'cust-2' } });

    expect(JSON.stringify(clean)).toBe(JSON.stringify([]));
  });

  it('DISCLOSED 限制原样返回，且响应体不含 blocked / openCount', async () => {
    access.resolve.mockResolvedValue({
      lifecycle: 'ACTIVE',
      blocked: new Set(['WITHDRAW', 'SWAP']),
      disclosedBlocked: new Set(['WITHDRAW', 'SWAP']),
      disclosed: [
        {
          restrictionNo: 'RST-1',
          cause: 'MATERIAL_EXPIRED',
          scopes: ['WITHDRAW', 'SWAP'],
          label: 'Document expired',
          reason: 'Passport expired 2026-01-01',
          openedAt: '2026-08-15T00:00:00.000Z',
        },
      ],
    });

    const result = await controller.list({ user: { type: 'CUSTOMER', userId: 'cust-3' } });

    expect(result).toHaveLength(1);
    expect(result[0].restrictionNo).toBe('RST-1');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('blocked');
    expect(serialized).not.toContain('openCount');
  });

  it('admin token 打客户端点 → 403', async () => {
    await expect(
      controller.list({ user: { type: 'ADMIN', userId: 'admin-1' } }),
    ).rejects.toThrow(ForbiddenException);
    expect(access.resolve).not.toHaveBeenCalled();
  });
});
