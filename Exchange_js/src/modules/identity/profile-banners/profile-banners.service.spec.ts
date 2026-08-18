import { ProfileBannerService } from './profile-banners.service';

describe('ProfileBannerService', () => {
  const prismaMock: any = {
    customerMain: { findUnique: jest.fn() },
  };

  const customerAccessServiceMock: any = { resolve: jest.fn() };
  const materialRequestsMock: any = { listLiveByCustomer: jest.fn() };

  const buildAccess = (overrides?: Record<string, unknown>) => ({
    lifecycle: 'ACTIVE',
    blocked: new Set<string>(),
    disclosedBlocked: new Set<string>(),
    disclosed: [] as Array<Record<string, unknown>>,
    openCount: 0,
    ...overrides,
  });

  // 材料请求账一行的最小投影 —— 字段对齐 MaterialRequestsService.listLiveByCustomer()
  // 的返回形状（MaterialRequestRow）。
  const buildRequest = (overrides?: Record<string, unknown>) => ({
    requestNo: 'MRQ1', customerId: 'c1', materialType: 'PASSPORT',
    orderDomain: null, orderRef: null, restrictionNo: null,
    status: 'PENDING_SUBMISSION', reason: 'PASSPORT expires on 2026-09-01',
    ...overrides,
  });

  let service: ProfileBannerService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.customerMain.findUnique.mockResolvedValue({ id: 'c1', customerNo: 'CU0001' });
    customerAccessServiceMock.resolve.mockResolvedValue(buildAccess());
    materialRequestsMock.listLiveByCustomer.mockResolvedValue([]);
    service = new ProfileBannerService(prismaMock, customerAccessServiceMock, materialRequestsMock);
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

  // ── 2026-08-17 材料请求账：横幅数据源改读 material_requests（Task 11）──

  it('不绑单不挂限制（护照 T-30）→ INFO 黄档，带 CTA', async () => {
    materialRequestsMock.listLiveByCustomer.mockResolvedValue([buildRequest()]);

    const banners = await service.getBannersFor('c1');

    expect(banners).toEqual([
      {
        id: 'material-request:MRQ1',
        type: 'MATERIAL_REFRESH',
        severity: 'INFO',
        title: 'Passport needs refreshing',
        description: 'PASSPORT expires on 2026-09-01',
        materialType: 'PASSPORT',
        ctaLabel: 'Verify now',
        ctaPath: '/verification/MRQ1',
        dismissible: true,
      },
    ]);
  });

  it('挂了限制 → BLOCKING 红档', async () => {
    materialRequestsMock.listLiveByCustomer.mockResolvedValue([
      buildRequest({ restrictionNo: 'RST2608170001' }),
    ]);

    const banners = await service.getBannersFor('c1');

    expect(banners).toHaveLength(1);
    expect(banners[0]).toMatchObject({
      severity: 'BLOCKING',
      title: 'Passport required',
      dismissible: false,
    });
  });

  it('绑了单又没挂限制 → 横幅上不露（订单页管它，G6）', async () => {
    materialRequestsMock.listLiveByCustomer.mockResolvedValue([
      buildRequest({ materialType: 'SOURCE_OF_FUNDS', orderDomain: 'DEPOSIT', orderRef: 'DP2608170001' }),
    ]);

    const banners = await service.getBannersFor('c1');

    expect(banners).toEqual([]);
  });

  it('已提交的行不给 CTA（客户没什么可点的）', async () => {
    materialRequestsMock.listLiveByCustomer.mockResolvedValue([
      buildRequest({ status: 'SUBMITTED' }),
    ]);

    const banners = await service.getBannersFor('c1');

    expect(banners).toHaveLength(1);
    expect(banners[0].ctaLabel).toBeNull();
    expect(banners[0].ctaPath).toBeNull();
  });

  it('同一张便签不同时出两条横幅（材料横幅优先，它带 CTA）', async () => {
    materialRequestsMock.listLiveByCustomer.mockResolvedValue([
      buildRequest({ restrictionNo: 'RST2608170001' }),
    ]);
    customerAccessServiceMock.resolve.mockResolvedValue(
      buildAccess({
        disclosedBlocked: new Set(['WITHDRAW', 'SWAP']),
        disclosed: [
          {
            restrictionNo: 'RST2608170001',
            cause: 'MATERIAL_EXPIRED',
            scopes: ['WITHDRAW', 'SWAP'],
            label: 'Document expired',
            reason: 'Passport expired',
            openedAt: '2026-08-17T02:00:00.000Z',
          },
        ],
        openCount: 1,
      }),
    );

    const banners = await service.getBannersFor('c1');

    expect(banners).toHaveLength(1);
    expect(banners[0].type).toBe('MATERIAL_REFRESH');
  });
});
