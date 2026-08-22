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
    });
    prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });

    const snap = await service.evaluate({ domain: 'DEPOSIT', customerId: 'c1' });

    expect(snap.verdict).toBe('HOLD');
    expect(snap.holdReason).toBe('CAPABILITY_RESTRICTED');
    expect(snap.checks.find((c) => c.code === 'CUSTOMER_RESTRICTION')?.outcome).toBe('FAIL');
  });

  it('便签只卡 WITHDRAW/SWAP 时,充值域该项判 PASS', async () => {
    customerAccess.resolve.mockResolvedValue({
      lifecycle: 'ACTIVE',
      blocked: new Set(['WITHDRAW', 'SWAP']),
      disclosed: [],
    });
    prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });

    const snap = await service.evaluate({ domain: 'DEPOSIT', customerId: 'c1' });

    expect(snap.verdict).toBe('PASS');
    expect(snap.checks.find((c) => c.code === 'CUSTOMER_RESTRICTION')?.outcome).toBe('PASS');
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

  it('未提供的项一律落 SKIPPED,九项一个不少', async () => {
    customerAccess.resolve.mockResolvedValue(activeAccess);
    prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });

    const snap = await service.evaluate({ domain: 'DEPOSIT', customerId: 'c1' });

    expect(snap.checks).toHaveLength(9);
    expect(snap.checks.find((c) => c.code === 'QUOTE_VALIDITY')?.outcome).toBe('NA');
  });
});
