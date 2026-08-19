import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { CustomerRestrictionsClientController } from './customer-restrictions.client.controller';
import { CustomerAccessService } from './customer-access.service';
import { MaterialRequestsService } from '../material-requests/material-requests.service';

describe('CustomerRestrictionsClientController', () => {
  let controller: CustomerRestrictionsClientController;
  let access: { resolve: jest.Mock };
  let materialRequests: { listLiveByCustomer: jest.Mock };

  beforeEach(async () => {
    access = { resolve: jest.fn() };
    // 默认「没有活着的材料请求」——既有断言的语义因此一条都不变：
    // 没有材料请求可认领，claimedByMaterialRequestNo 恒 null。
    materialRequests = { listLiveByCustomer: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CustomerRestrictionsClientController],
      providers: [
        { provide: CustomerAccessService, useValue: access },
        { provide: MaterialRequestsService, useValue: materialRequests },
      ],
    }).compile();

    controller = module.get(CustomerRestrictionsClientController);
  });

  afterEach(() => jest.clearAllMocks());

  it('被活着的材料请求认领的便签，回包带上认领它的 requestNo（客户面据此只留带入口的那条）', async () => {
    access.resolve.mockResolvedValue({
      lifecycle: 'ACTIVE',
      blocked: new Set(['SWAP', 'WITHDRAW']),
      disclosedBlocked: new Set(['SWAP', 'WITHDRAW']),
      disclosed: [
        {
          restrictionNo: 'RST-1', claimedByMaterialRequestNo: null,
          cause: 'KYT_REJECTED_SOFT', scopes: ['SWAP', 'WITHDRAW'],
          label: 'Verification required', reason: 'Swap SWP1 KYT rejected',
          openedAt: '2026-08-18T00:00:00.000Z',
        },
        {
          restrictionNo: 'RST-2', claimedByMaterialRequestNo: null,
          cause: 'ADMIN_SUSPENSION', scopes: ['ALL'],
          label: 'Account suspended', reason: 'Duplicate account review',
          openedAt: '2026-08-18T00:00:00.000Z',
        },
      ],
      openCount: 2,
    });
    materialRequests.listLiveByCustomer.mockResolvedValue([
      { requestNo: 'MRQ-1', restrictionNo: 'RST-1' },
      { requestNo: 'MRQ-2', restrictionNo: null },
    ]);

    const out = await controller.list({ user: { type: 'CUSTOMER', userId: 'c1' } });

    // RST-1 被 MRQ-1 认领 → 客户面横幅不再重复出它
    expect(out.find((r) => r.restrictionNo === 'RST-1')!.claimedByMaterialRequestNo).toBe('MRQ-1');
    // RST-2 没有任何材料请求可交（管理员停用）→ 仍然要出，且客户只能联系客服
    expect(out.find((r) => r.restrictionNo === 'RST-2')!.claimedByMaterialRequestNo).toBeNull();
  });

  it('不挂便签的材料请求（护照 T-30 那种）不会误认领任何一张便签', async () => {
    access.resolve.mockResolvedValue({
      lifecycle: 'ACTIVE',
      blocked: new Set(['ALL']),
      disclosedBlocked: new Set(['ALL']),
      disclosed: [
        {
          restrictionNo: 'RST-9', claimedByMaterialRequestNo: null,
          cause: 'ADMIN_SUSPENSION', scopes: ['ALL'],
          label: 'Account suspended', reason: 'r',
          openedAt: '2026-08-18T00:00:00.000Z',
        },
      ],
      openCount: 1,
    });
    materialRequests.listLiveByCustomer.mockResolvedValue([
      { requestNo: 'MRQ-NUDGE', restrictionNo: null },
    ]);

    const out = await controller.list({ user: { type: 'CUSTOMER', userId: 'c1' } });
    expect(out[0].claimedByMaterialRequestNo).toBeNull();
  });

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
