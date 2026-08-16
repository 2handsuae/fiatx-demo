import { ProfileBannerService } from './profile-banners.service';

describe('ProfileBannerService', () => {
  const prismaMock: any = {
    customerMain: { findUnique: jest.fn() },
    materialRefreshCycle: { findMany: jest.fn() },
  };

  const customerAccessServiceMock: any = { resolve: jest.fn() };

  const buildAccess = (overrides?: Record<string, unknown>) => ({
    lifecycle: 'ACTIVE',
    blocked: new Set<string>(),
    disclosedBlocked: new Set<string>(),
    disclosed: [] as Array<Record<string, unknown>>,
    openCount: 0,
    ...overrides,
  });

  let service: ProfileBannerService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.customerMain.findUnique.mockResolvedValue({ id: 'c1', customerNo: 'CU0001' });
    prismaMock.materialRefreshCycle.findMany.mockResolvedValue([]);
    customerAccessServiceMock.resolve.mockResolvedValue(buildAccess());
    service = new ProfileBannerService(prismaMock, customerAccessServiceMock);
  });

  // 零痕迹：SILENT 限制在 CustomerAccess.disclosed 里结构性不存在，
  // 因此提示条这一层拿不到任何可渲染的东西 —— 不是"记得别渲染"，是没数据。
  it('SANCTION 客户返回空数组（不含任何提示该客户被摁住的 banner）', async () => {
    customerAccessServiceMock.resolve.mockResolvedValue(
      buildAccess({
        blocked: new Set(['DEPOSIT', 'WITHDRAW', 'SWAP']),
        openCount: 1,
      }),
    );

    const banners = await service.getBannersFor('c1');

    expect(banners).toEqual([]);
  });

  it('MATERIAL_EXPIRED 客户返回一条 RESTRICTION banner，CTA 指向 /verification', async () => {
    customerAccessServiceMock.resolve.mockResolvedValue(
      buildAccess({
        disclosedBlocked: new Set(['WITHDRAW', 'SWAP']),
        disclosed: [
          {
            restrictionNo: 'RST26080900B7',
            cause: 'MATERIAL_EXPIRED',
            scopes: ['WITHDRAW', 'SWAP'],
            label: 'Document expired',
            reason: 'Emirates ID expired on 2026-08-01',
            openedAt: '2026-08-09T02:00:00.000Z',
          },
        ],
        openCount: 1,
      }),
    );

    const banners = await service.getBannersFor('c1');

    expect(banners).toEqual([
      {
        id: 'banner-restriction-RST26080900B7',
        type: 'RESTRICTION',
        severity: 'WARNING',
        title: 'Document expired',
        description: 'Emirates ID expired on 2026-08-01',
        ctaLabel: 'Go to verification',
        ctaPath: '/verification',
        dismissible: false,
      },
    ]);
  });

  it('scope 含 ALL 的 DISCLOSED 限制升级为 BLOCKING 且无 CTA', async () => {
    customerAccessServiceMock.resolve.mockResolvedValue(
      buildAccess({
        disclosedBlocked: new Set(['DEPOSIT', 'WITHDRAW', 'SWAP']),
        disclosed: [
          {
            restrictionNo: 'RST26081500A1',
            cause: 'ADMIN_SUSPENSION',
            scopes: ['ALL'],
            label: 'Account suspended',
            reason: 'Suspended pending ops review',
            openedAt: '2026-08-15T10:22:00.000Z',
          },
        ],
        openCount: 1,
      }),
    );

    const banners = await service.getBannersFor('c1');

    expect(banners).toHaveLength(1);
    expect(banners[0].severity).toBe('BLOCKING');
    expect(banners[0].type).toBe('RESTRICTION');
    expect(banners[0].ctaPath).toBeNull();
  });
});
