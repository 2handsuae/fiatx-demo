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

  // 2026-09-12 翻面：无绑定材料请求时 RESTRICTION banner 不再有 CTA —— 旧行为
  // （DOCUMENT_CTA_CAUSES 命中就发死路由 /verification）随该分支一并退役。
  it('MATERIAL_EXPIRED 客户无绑定材料请求 → RESTRICTION banner 但无 CTA（死路由已退役）', async () => {
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
        ctaLabel: null,
        ctaPath: null,
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

  // 2026-09-12 翻面：挂了限制的材料行让位给条子行——BLOCKING 现在由 scopes 含
  // ALL 的 RESTRICTION banner 表达（材料请求提供 CTA 目标），不再由材料行本身独立判红。
  it('挂了限制 → 条子行升级 BLOCKING、按钮借材料', async () => {
    materialRequestsMock.listLiveByCustomer.mockResolvedValue([
      buildRequest({ restrictionNo: 'RST2608170001' }),
    ]);
    customerAccessServiceMock.resolve.mockResolvedValue(
      buildAccess({
        disclosedBlocked: new Set(['DEPOSIT', 'WITHDRAW', 'SWAP']),
        disclosed: [
          {
            restrictionNo: 'RST2608170001',
            cause: 'PENDING_DOCUMENT',
            scopes: ['ALL'],
            label: 'Passport required',
            reason: 'Passport expired',
            openedAt: '2026-08-17T02:00:00.000Z',
          },
        ],
        openCount: 1,
      }),
    );

    const banners = await service.getBannersFor('c1');

    expect(banners).toHaveLength(1);
    expect(banners[0]).toMatchObject({
      type: 'RESTRICTION',
      severity: 'BLOCKING',
      title: 'Passport required',
      ctaLabel: 'Submit material',
      ctaPath: '/verification/MRQ1',
      dismissible: false,
    });
  });

  // 2026-09-12 业主定案推翻 2026-08-18 G6 的该分支：Overview/Profile 是全量面，
  // 绑订单与否不再排除——只要没挂条子（restrictionNo === null）材料行就发。
  it('绑了单又没挂限制 → 横幅照常显示（G6 已翻案，全量面）', async () => {
    materialRequestsMock.listLiveByCustomer.mockResolvedValue([
      buildRequest({ materialType: 'SOURCE_OF_FUNDS', orderDomain: 'DEPOSIT', orderRef: 'DP2608170001' }),
    ]);

    const banners = await service.getBannersFor('c1');

    expect(banners).toHaveLength(1);
    expect(banners[0]).toMatchObject({
      id: 'material-request:MRQ1',
      type: 'MATERIAL_REFRESH',
      title: 'Source of Funds needs refreshing',
    });
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

  // 2026-09-12 翻面：合并方向反过来了——留条子行（先说「你受限了」+原因），
  // 材料行让位，按钮借绑定材料的入口。
  it('同一张便签不同时出两条横幅（条子行优先，材料行让位——翻面）', async () => {
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
    expect(banners[0].type).toBe('RESTRICTION');
    expect(banners[0]).toMatchObject({
      ctaLabel: 'Submit material',
      ctaPath: '/verification/MRQ1',
    });
  });

  // ── 2026-09-12 业主定案（波三§8）：合并形态翻面——留条子行，按钮借材料 ──

  it('claimed restriction surfaces as RESTRICTION banner borrowing the material CTA (翻面)', async () => {
    materialRequestsMock.listLiveByCustomer.mockResolvedValue([
      { requestNo: 'MRQ1', restrictionNo: 'RST1', status: 'PENDING_SUBMISSION', orderDomain: null, orderRef: null, materialType: 'PROOF_OF_ADDRESS', reason: 'expired' },
    ]);
    customerAccessServiceMock.resolve.mockResolvedValue(buildAccess({
      disclosed: [
        { restrictionNo: 'RST1', cause: 'MATERIAL_EXPIRED', scopes: ['WITHDRAW'], label: 'Account restricted', reason: 'PoA expired', openedAt: '2026-09-12T00:00:00.000Z', claimedByMaterialRequestNo: null },
      ],
    }));

    const banners = await service.getBannersFor('c1');
    const restriction = banners.find((b) => b.type === 'RESTRICTION');

    expect(restriction?.ctaPath).toBe('/verification/MRQ1');
    expect(banners.some((b) => b.id === 'material-request:MRQ1')).toBe(false); // 材料行让位
  });

  it('order-bound unclaimed material now appears (Overview/Profile 全量面)', async () => {
    materialRequestsMock.listLiveByCustomer.mockResolvedValue([
      { requestNo: 'MRQ2', restrictionNo: null, status: 'PENDING_SUBMISSION', orderDomain: 'SWAP', orderRef: 'SWP1', materialType: 'SOURCE_OF_FUNDS', reason: 'kyt' },
    ]);
    customerAccessServiceMock.resolve.mockResolvedValue(buildAccess());

    const banners = await service.getBannersFor('c1');

    expect(banners.some((b) => b.id === 'material-request:MRQ2')).toBe(true);
  });
});
