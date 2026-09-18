import { L1GateService } from './l1-gate.service';

describe('L1GateService', () => {
  let service: L1GateService;
  let customerAccess: any;
  let prisma: any;

  beforeEach(() => {
    customerAccess = { resolve: jest.fn() };
    prisma = { customerMain: { findUnique: jest.fn() } };
    service = new L1GateService(customerAccess, prisma);
  });

  const activeAccess = { lifecycle: 'ACTIVE', blocked: new Set<string>(), disclosed: [] };

  it('全过 → verdict PASS,holdReason 为 null', async () => {
    customerAccess.resolve.mockResolvedValue(activeAccess);
    prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'PREMIUM' });

    const snap = await service.evaluate({ domain: 'WITHDRAW', customerId: 'c1' });

    expect(snap.verdict).toBe('PASS');
    expect(snap.holdReason).toBeNull();
    expect(snap.tradingTier).toBe('PREMIUM');
    expect(snap.checks.find((c) => c.code === 'CUSTOMER_ELIGIBILITY')?.outcome).toBe('PASS');
  });

  it('生命周期非 ACTIVE + 提现域 → BLOCK（钱还没动,可以拒）', async () => {
    customerAccess.resolve.mockResolvedValue({ ...activeAccess, lifecycle: 'SUSPENDED' });
    prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });

    const snap = await service.evaluate({ domain: 'WITHDRAW', customerId: 'c1' });

    expect(snap.verdict).toBe('BLOCK');
    expect(snap.checks.find((c) => c.code === 'CUSTOMER_ELIGIBILITY')?.outcome).toBe('FAIL');
  });

  it('生命周期非 ACTIVE + 充值域 → HOLD（钱已到账,拒不了）', async () => {
    customerAccess.resolve.mockResolvedValue({ ...activeAccess, lifecycle: 'SUSPENDED' });
    prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });

    const snap = await service.evaluate({ domain: 'DEPOSIT', customerId: 'c1' });

    expect(snap.verdict).toBe('HOLD');
    expect(snap.holdReason).toBe('LIFECYCLE_NOT_ACTIVE');
  });

  it('便签卡住本域能力 → 充值 HOLD 且 holdReason 是该 cause', async () => {
    customerAccess.resolve.mockResolvedValue({
      lifecycle: 'ACTIVE',
      blocked: new Set(['DEPOSIT', 'WITHDRAW', 'SWAP']),
      disclosed: [],
      blockingNotes: [
        { capability: 'DEPOSIT', restrictionNo: 'RST-1', cause: 'SANCTION', visibility: 'SILENT' },
        { capability: 'WITHDRAW', restrictionNo: 'RST-1', cause: 'SANCTION', visibility: 'SILENT' },
        { capability: 'SWAP', restrictionNo: 'RST-1', cause: 'SANCTION', visibility: 'SILENT' },
      ],
    });
    prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });

    const snap = await service.evaluate({ domain: 'DEPOSIT', customerId: 'c1' });

    expect(snap.verdict).toBe('HOLD');
    expect(snap.holdReason).toBe('CAPABILITY_RESTRICTED');
    expect(snap.checks.find((c) => c.code === 'CUSTOMER_RESTRICTION')?.outcome).toBe('FAIL');
  });

  it('便签只卡 WITHDRAW/SWAP 时,充值域该项判 PASS,detail 文案原样不变', async () => {
    customerAccess.resolve.mockResolvedValue({
      lifecycle: 'ACTIVE',
      blocked: new Set(['WITHDRAW', 'SWAP']),
      disclosed: [],
      blockingNotes: [
        { capability: 'WITHDRAW', restrictionNo: 'RST-1', cause: 'MATERIAL_EXPIRED', visibility: 'DISCLOSED' },
        { capability: 'SWAP', restrictionNo: 'RST-1', cause: 'MATERIAL_EXPIRED', visibility: 'DISCLOSED' },
      ],
    });
    prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });

    const snap = await service.evaluate({ domain: 'DEPOSIT', customerId: 'c1' });

    expect(snap.verdict).toBe('PASS');
    const restriction = snap.checks.find((c) => c.code === 'CUSTOMER_RESTRICTION');
    expect(restriction?.outcome).toBe('PASS');
    expect(restriction?.detail).toBe('No OPEN restriction note blocks this domain\'s capability');
  });

  // D10（业主裁定，波五 T7）：管理台 L1 快照②格此前只说"被限制(N项)",不说为什么。
  // 现在必须露出具体因由(cause)+限制便签号(restrictionNo,铁律⑥业务键) ——
  // 必须消费 blockingNotes(含 SILENT 行),不能用 disclosed(制裁因由不在里面,
  // 管理台会看不全)。客户面继续走 toCustomer*View 白名单,零暴露(见下方专项断言)。
  it('D10：②格 FAIL detail 带具体因由 + 限制便签号（制裁客户,SILENT 行也要露给管理台）', async () => {
    customerAccess.resolve.mockResolvedValue({
      lifecycle: 'ACTIVE',
      blocked: new Set(['WITHDRAW']),
      disclosed: [],
      blockingNotes: [
        { capability: 'WITHDRAW', restrictionNo: 'RST2601010001', cause: 'SANCTION', visibility: 'SILENT' },
      ],
    });
    prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });

    const snap = await service.evaluate({ domain: 'WITHDRAW', customerId: 'c1' });

    const restriction = snap.checks.find((c) => c.code === 'CUSTOMER_RESTRICTION');
    expect(restriction?.outcome).toBe('FAIL');
    expect(restriction?.detail).toBe('Customer restriction holds down WITHDRAW — SANCTION (RST2601010001)');
  });

  it('D10：同一能力被多条便签同卡 → detail 逐条列出因由+便签号,分号分隔', async () => {
    customerAccess.resolve.mockResolvedValue({
      lifecycle: 'ACTIVE',
      blocked: new Set(['WITHDRAW']),
      disclosed: [],
      blockingNotes: [
        { capability: 'WITHDRAW', restrictionNo: 'RST2601010001', cause: 'SANCTION', visibility: 'SILENT' },
        { capability: 'WITHDRAW', restrictionNo: 'RST2601010002', cause: 'ADMIN_SUSPENSION', visibility: 'DISCLOSED' },
      ],
    });
    prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });

    const snap = await service.evaluate({ domain: 'WITHDRAW', customerId: 'c1' });

    const restriction = snap.checks.find((c) => c.code === 'CUSTOMER_RESTRICTION');
    expect(restriction?.detail).toBe(
      'Customer restriction holds down WITHDRAW — SANCTION (RST2601010001); ADMIN_SUSPENSION (RST2601010002)',
    );
  });

  it('调用方传进来的 preChecks 原样进快照,FAIL 会影响 verdict', async () => {
    customerAccess.resolve.mockResolvedValue(activeAccess);
    prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });

    const snap = await service.evaluate({
      domain: 'SWAP',
      customerId: 'c1',
      preChecks: [{ code: 'BALANCE_SUFFICIENCY', outcome: 'FAIL', detail: '余额不足' }],
    });

    expect(snap.verdict).toBe('BLOCK');
    expect(snap.checks.find((c) => c.code === 'BALANCE_SUFFICIENCY')?.detail).toBe('余额不足');
  });

  it('未提供的项一律落 SKIPPED,十项一个不少', async () => {
    customerAccess.resolve.mockResolvedValue(activeAccess);
    prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });

    const snap = await service.evaluate({ domain: 'DEPOSIT', customerId: 'c1' });

    expect(snap.checks).toHaveLength(10);
    expect(snap.checks.find((c) => c.code === 'QUOTE_VALIDITY')?.outcome).toBe('NA');
  });

  it('preChecks 若伪造 CUSTOMER_RESTRICTION=PASS,不能覆盖本 service 判的 FAIL(自判项永远赢)', async () => {
    customerAccess.resolve.mockResolvedValue({
      lifecycle: 'ACTIVE',
      blocked: new Set(['WITHDRAW']),
      disclosed: [],
      blockingNotes: [
        { capability: 'WITHDRAW', restrictionNo: 'RST-1', cause: 'ADMIN_SUSPENSION', visibility: 'DISCLOSED' },
      ],
    });
    prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });

    const snap = await service.evaluate({
      domain: 'WITHDRAW',
      customerId: 'c1',
      preChecks: [{ code: 'CUSTOMER_RESTRICTION', outcome: 'PASS', detail: '伪造的放行' }],
    });

    const restriction = snap.checks.find((c) => c.code === 'CUSTOMER_RESTRICTION');
    expect(restriction?.outcome).toBe('FAIL');
    expect(restriction?.detail).not.toBe('伪造的放行');
    expect(snap.verdict).toBe('BLOCK');
  });

  it('preChecks 若伪造 CUSTOMER_ELIGIBILITY=PASS,不能覆盖本 service 判的 FAIL(自判项永远赢)', async () => {
    customerAccess.resolve.mockResolvedValue({ ...activeAccess, lifecycle: 'SUSPENDED' });
    prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });

    const snap = await service.evaluate({
      domain: 'DEPOSIT',
      customerId: 'c1',
      preChecks: [{ code: 'CUSTOMER_ELIGIBILITY', outcome: 'PASS', detail: '伪造的放行' }],
    });

    const eligibility = snap.checks.find((c) => c.code === 'CUSTOMER_ELIGIBILITY');
    expect(eligibility?.outcome).toBe('FAIL');
    expect(snap.verdict).toBe('HOLD');
    expect(snap.holdReason).toBe('LIFECYCLE_NOT_ACTIVE');
  });

  describe('NOT_APPLICABLE 表:三域逐格钉住(业主 2026-08-22 拍板)', () => {
    const NON_SELF_CODES = [
      'SINGLE_LIMIT',
      'CUMULATIVE_LIMIT',
      'LARGE_APPROVAL',
      'ACCOUNT_READINESS',
      'BALANCE_SUFFICIENCY',
      'QUOTE_VALIDITY',
      'TRADING_READINESS',
    ] as const;

    const EXPECTED_NA: Record<'DEPOSIT' | 'WITHDRAW' | 'SWAP', string[]> = {
      DEPOSIT: ['CUMULATIVE_LIMIT', 'LARGE_APPROVAL', 'BALANCE_SUFFICIENCY', 'QUOTE_VALIDITY'],
      WITHDRAW: [],
      SWAP: ['LARGE_APPROVAL'],
    };

    it.each(['DEPOSIT', 'WITHDRAW', 'SWAP'] as const)('%s 域:NA 项与 SKIPPED 项逐一钉住', async (domain) => {
      customerAccess.resolve.mockResolvedValue(activeAccess);
      prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });

      const snap = await service.evaluate({ domain, customerId: 'c1' });

      const naSet = new Set(EXPECTED_NA[domain]);
      for (const code of NON_SELF_CODES) {
        const outcome = snap.checks.find((c) => c.code === code)?.outcome;
        if (naSet.has(code)) {
          expect(outcome).toBe('NA');
        } else {
          expect(outcome).toBe('SKIPPED');
        }
      }
    });
  });

  describe('ASSET_AVAILABILITY（波二第十项）', () => {
    it('资产 SUSPENDED + 提现域 → BLOCK，第十格 FAIL', async () => {
      customerAccess.resolve.mockResolvedValue(activeAccess);
      prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });
      prisma.asset = { findMany: jest.fn().mockResolvedValue([{ id: 'a-usdt', assetNo: 'AS2601012024', currency: 'USDT', status: 'SUSPENDED' }]) };

      const snap = await service.evaluate({ domain: 'WITHDRAW', customerId: 'c1', assetIds: ['a-usdt'] });

      expect(snap.verdict).toBe('BLOCK');
      const check = snap.checks.find((c) => c.code === 'ASSET_AVAILABILITY');
      expect(check?.outcome).toBe('FAIL');
      expect(check?.detail).toContain('AS2601012024');
      expect(prisma.asset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['a-usdt'] } } }));
    });

    it('资产 SUSPENDED + 充值域 → HOLD，holdReason=ASSET_SUSPENDED', async () => {
      customerAccess.resolve.mockResolvedValue(activeAccess);
      prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });
      prisma.asset = { findMany: jest.fn().mockResolvedValue([{ id: 'a-usdt', assetNo: 'AS2601012024', currency: 'USDT', status: 'SUSPENDED' }]) };

      const snap = await service.evaluate({ domain: 'DEPOSIT', customerId: 'c1', assetIds: ['a-usdt'] });

      expect(snap.verdict).toBe('HOLD');
      expect(snap.holdReason).toBe('ASSET_SUSPENDED');
    });

    it('两个资产都 ACTIVE（兑换）→ PASS；不传 assetIds → 第十格 SKIPPED', async () => {
      customerAccess.resolve.mockResolvedValue(activeAccess);
      prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });
      prisma.asset = { findMany: jest.fn().mockResolvedValue([
        { id: 'a-usdt', assetNo: 'AS1', currency: 'USDT', status: 'ACTIVE' },
        { id: 'a-aed', assetNo: 'AS2', currency: 'AED', status: 'ACTIVE' },
      ]) };

      const ok = await service.evaluate({ domain: 'SWAP', customerId: 'c1', assetIds: ['a-usdt', 'a-aed'] });
      expect(ok.verdict).toBe('PASS');
      expect(ok.checks.find((c) => c.code === 'ASSET_AVAILABILITY')?.outcome).toBe('PASS');

      const none = await service.evaluate({ domain: 'SWAP', customerId: 'c1' });
      expect(none.checks.find((c) => c.code === 'ASSET_AVAILABILITY')?.outcome).toBe('SKIPPED');
    });

    it('自判自赢：preChecks 里塞 ASSET_AVAILABILITY=PASS 也盖不掉本 service 判出的 FAIL', async () => {
      customerAccess.resolve.mockResolvedValue(activeAccess);
      prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });
      prisma.asset = { findMany: jest.fn().mockResolvedValue([{ id: 'a-usdt', assetNo: 'AS1', currency: 'USDT', status: 'SUSPENDED' }]) };

      const snap = await service.evaluate({
        domain: 'WITHDRAW', customerId: 'c1', assetIds: ['a-usdt'],
        preChecks: [{ code: 'ASSET_AVAILABILITY', outcome: 'PASS', detail: '伪造' }],
      });
      expect(snap.checks.find((c) => c.code === 'ASSET_AVAILABILITY')?.outcome).toBe('FAIL');
    });
  });
});
