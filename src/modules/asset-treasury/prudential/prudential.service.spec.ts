// 战役乙波三 T1：审慎（NLA）地基行为测试（照 capital-injection-workflow.service.spec.ts 的
// acct(code, ledger) 编码 mock 先例——resolveTbAccountId 按 ledger 返回不同账户 id，
// 若实现把 AED/USDT 的 ledger 传错或余额查错账户，断言会对不上，能真的抓到跨 ledger 错误）。
// 战役乙波三 T2：assertPostOutflowCompliant 单测半（mock computeStatus 控制水位，spec §10.2）。
import { BadRequestException } from '@nestjs/common';
import { PrudentialService } from './prudential.service';
import { AED_USD_PEG_RATE, MONTHLY_OPEX_BASE_AED_MINOR, NLA_FLOOR_AED_MINOR, usdtMinorToAedMinor } from './prudential.constants';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';

const AED = { id: 'asset-aed', code: 'AED', currency: 'AED', decimals: 2, type: 'FIAT', status: 'ACTIVE' };
const USDT = { id: 'asset-usdt', code: 'USDT-TRON', currency: 'USDT', decimals: 6, type: 'CRYPTO', status: 'ACTIVE' };
const SUSPENDED_USDT = { id: 'asset-usdt-susp', code: 'USDT-TRON', currency: 'USDT', decimals: 6, type: 'CRYPTO', status: 'SUSPENDED' };
const OPS_WALLET = { id: 'w-ops', walletNo: 'WAL-OPS' };

/** 评审 Imp#1：mock 真按 `where` 过滤（币种 + status，如果查询带了 status 的话）——不是
 *  「mock 无视 where 假绿」（本仓判例）。这样若实现日后又偷偷塞回 `status: 'ACTIVE'`，
 *  这份 mock 会把 SUSPENDED 资产真的滤掉，下面的"暂停资产仍计入 NLA"用例会真的变红。 */
function makePrisma(assets: any[] = [AED, USDT]) {
  return {
    asset: {
      findMany: jest.fn(async ({ where }: any = {}) => {
        const allowedCurrencies: string[] | undefined = where?.currency?.in;
        const requiredStatus: string | undefined = where?.status;
        return assets.filter(
          (a) =>
            (!allowedCurrencies || allowedCurrencies.includes(a.currency)) &&
            (!requiredStatus || a.status === requiredStatus),
        );
      }),
    },
  };
}

function makeSystemWallets() {
  return { resolve: jest.fn(async () => OPS_WALLET) };
}

type Balances = Record<string, { creditsPosted: bigint; debitsPosted: bigint; debitsPending?: bigint }>;

/** 账户 id 编码同 capital-injection-workflow.service.spec.ts 的 acct()：按 ledger 区分账户，
 *  lookupBalance 再按账户 id 反查对应币种的余额——两币种账户绝不会串号。 */
function makeAccounting(balances: Balances) {
  const acctIdByLedger = new Map<number, bigint>();
  return {
    resolveTbAccountId: jest.fn(async ({ code, ledger }: any) => {
      if (code !== TB_ACCOUNT_CODES.FIRM_OPS) throw new Error(`unexpected code: ${code}`);
      const id = BigInt(ledger) * 1000n;
      acctIdByLedger.set(ledger, id);
      return id;
    }),
    lookupBalance: jest.fn(async (tbAccountId: bigint) => {
      const currency = tbAccountId === BigInt(TB_LEDGERS.AED) * 1000n ? 'AED' : 'USDT';
      const b = balances[currency] ?? { creditsPosted: 0n, debitsPosted: 0n };
      return {
        creditsPosted: b.creditsPosted,
        debitsPosted: b.debitsPosted,
        debitsPending: b.debitsPending ?? 0n,
        creditsPending: 0n,
      };
    }),
  };
}

describe('usdtMinorToAedMinor（乙波三 T1）', () => {
  it('converts USDT minor to AED minor at the peg (113_600_000_000n → 41_719_600n)', () => {
    expect(usdtMinorToAedMinor(113_600_000_000n)).toBe(41_719_600n);
  });
});

describe('PrudentialService.computeStatus（乙波三 T1）', () => {
  it('resolves F_OPS wallets for both assets, sums AED + converted USDT, and does NOT flag breach when above the floor', async () => {
    const prisma: any = makePrisma();
    const systemWallets: any = makeSystemWallets();
    // AED 100,000,000 fils (=1,000,000.00 AED) + USDT 113,600,000,000 µUSDT (→41,719,600 fils)
    // 合计 141,719,600 fils > 红线 120,000,000 fils → 不破线
    const accounting: any = makeAccounting({
      AED: { creditsPosted: 100_000_000n, debitsPosted: 0n },
      USDT: { creditsPosted: 113_600_000_000n, debitsPosted: 0n },
    });
    const auditLogs: any = { recordByActor: jest.fn(async () => ({})) };
    const service = new PrudentialService(prisma, systemWallets, accounting, auditLogs);

    const status = await service.computeStatus();

    // 评审 Imp#1：查询只按币种，不按 status——findMany 的 where 里不该出现 status 键。
    expect(prisma.asset.findMany).toHaveBeenCalledWith({ where: { currency: { in: ['AED', 'USDT'] } } });
    expect(systemWallets.resolve).toHaveBeenCalledWith(AED.id, 'F_OPS');
    expect(systemWallets.resolve).toHaveBeenCalledWith(USDT.id, 'F_OPS');
    expect(accounting.resolveTbAccountId).toHaveBeenCalledWith(
      expect.objectContaining({ code: TB_ACCOUNT_CODES.FIRM_OPS, ledger: TB_LEDGERS.AED, ownerType: 'SYSTEM' }),
    );
    expect(accounting.resolveTbAccountId).toHaveBeenCalledWith(
      expect.objectContaining({ code: TB_ACCOUNT_CODES.FIRM_OPS, ledger: TB_LEDGERS.USDT, ownerType: 'SYSTEM' }),
    );

    const expectedNla = 100_000_000n + 41_719_600n;
    expect(status.nlaAedMinor).toBe(expectedNla.toString());
    expect(status.floorAedMinor).toBe(NLA_FLOOR_AED_MINOR.toString());
    expect(status.headroomAedMinor).toBe((expectedNla - NLA_FLOOR_AED_MINOR).toString());
    expect(status.breached).toBe(false);
    expect(status.monthlyOpexBaseAedMinor).toBe(MONTHLY_OPEX_BASE_AED_MINOR.toString());
    expect(status.coefficient).toBe('1.2');
    expect(status.pegRate).toBe(AED_USD_PEG_RATE); // 裁定 R2：单源直出，不是第二份字面量
    expect(status.perAsset).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assetCode: 'AED', currency: 'AED', balanceMinor: '100000000', aedEquivalentMinor: '100000000' }),
        expect.objectContaining({ assetCode: 'USDT-TRON', currency: 'USDT', balanceMinor: '113600000000', aedEquivalentMinor: '41719600' }),
      ]),
    );
  });

  it('keeps a SUSPENDED asset in the NLA — 评审 Imp#1：资产暂停只停交易，公司手上的余额没消失，不按 status 过滤', async () => {
    const prisma: any = makePrisma([AED, SUSPENDED_USDT]);
    const systemWallets: any = makeSystemWallets();
    const accounting: any = makeAccounting({
      AED: { creditsPosted: 100_000_000n, debitsPosted: 0n },
      USDT: { creditsPosted: 113_600_000_000n, debitsPosted: 0n },
    });
    const auditLogs: any = { recordByActor: jest.fn(async () => ({})) };
    const service = new PrudentialService(prisma, systemWallets, accounting, auditLogs);

    const status = await service.computeStatus();

    // mock 是按 where 真过滤的（见 makePrisma 头注释）：这里能拿到 SUSPENDED_USDT，
    // 恰恰证明 computeStatus 的查询没有带 status 条件——如果实现又偷偷塞回
    // `status: 'ACTIVE'`，mock 会把它滤掉，下面两条断言就会红。
    expect(systemWallets.resolve).toHaveBeenCalledWith(SUSPENDED_USDT.id, 'F_OPS');
    const expectedNla = 100_000_000n + 41_719_600n;
    expect(status.nlaAedMinor).toBe(expectedNla.toString());
    expect(status.perAsset.find((a) => a.currency === 'USDT')).toBeDefined();
  });

  it('flags breach when below the floor, and headroom is negative-safe (breached ⇒ headroom < 0 as string)', async () => {
    const prisma: any = makePrisma();
    const systemWallets: any = makeSystemWallets();
    // AED 10,000,000 fils (=100,000.00 AED) + USDT 0 → 远低于红线 120,000,000 fils
    const accounting: any = makeAccounting({
      AED: { creditsPosted: 10_000_000n, debitsPosted: 0n },
      USDT: { creditsPosted: 0n, debitsPosted: 0n },
    });
    const auditLogs: any = { recordByActor: jest.fn(async () => ({})) };
    const service = new PrudentialService(prisma, systemWallets, accounting, auditLogs);

    const status = await service.computeStatus();

    expect(status.breached).toBe(true);
    const expectedHeadroom = 10_000_000n - NLA_FLOOR_AED_MINOR;
    expect(expectedHeadroom < 0n).toBe(true); // 断言本身的前提没写反
    expect(status.headroomAedMinor).toBe(expectedHeadroom.toString());
    expect(status.headroomAedMinor.startsWith('-')).toBe(true);
  });

  it('pending debits also reduce available balance (available = creditsPosted − debitsPosted − debitsPending，同 vendor-payment.service.ts 口径)', async () => {
    const prisma: any = makePrisma();
    const systemWallets: any = makeSystemWallets();
    const accounting: any = makeAccounting({
      AED: { creditsPosted: 200_000_000n, debitsPosted: 50_000_000n, debitsPending: 30_000_000n }, // available = 120,000,000
      USDT: { creditsPosted: 0n, debitsPosted: 0n },
    });
    const auditLogs: any = { recordByActor: jest.fn(async () => ({})) };
    const service = new PrudentialService(prisma, systemWallets, accounting, auditLogs);

    const status = await service.computeStatus();

    expect(status.perAsset.find((a) => a.currency === 'AED')?.balanceMinor).toBe('120000000');
    expect(status.nlaAedMinor).toBe('120000000');
    expect(status.breached).toBe(false); // 恰等于红线，不破线
  });
});

describe('PrudentialService.assertPostOutflowCompliant（乙波三 T2 · 算术门）', () => {
  const actor = { actorType: 'ADMIN' as const, userId: 'uuid-tre', userNo: 'ADM-TRE', roleCodes: ['TREASURY_OFFICER'] };

  /** 门方法只依赖 computeStatus 的返回值——直接 spyOn 控水位（brief Step4：「mock
   *  computeStatus 控制水位」），prisma/systemWallets/accounting 三个依赖本身不会被调用。 */
  function makeService(nlaAedMinor: bigint, floorAedMinor: bigint = NLA_FLOOR_AED_MINOR) {
    const auditLogs: any = { recordByActor: jest.fn(async () => ({})) };
    const service = new PrudentialService({} as any, {} as any, {} as any, auditLogs);
    jest.spyOn(service, 'computeStatus').mockResolvedValue({
      perAsset: [], nlaAedMinor: nlaAedMinor.toString(), floorAedMinor: floorAedMinor.toString(),
      headroomAedMinor: (nlaAedMinor - floorAedMinor).toString(), breached: nlaAedMinor < floorAedMinor,
      monthlyOpexBaseAedMinor: MONTHLY_OPEX_BASE_AED_MINOR.toString(), coefficient: '1.2', pegRate: AED_USD_PEG_RATE,
    });
    return { service, auditLogs };
  }

  it('passes silently when the outflow leaves NLA at/above the floor (no audit write)', async () => {
    const { service, auditLogs } = makeService(150_000_000n); // 1,500,000.00 AED, floor 1,200,000.00
    await expect(
      service.assertPostOutflowCompliant({ currency: 'AED', amountMinor: 10_000_000n, orderKind: 'VENDOR_PAYMENT', counterpartyNo: 'VEN1', actor }),
    ).resolves.toBeUndefined();
    expect(auditLogs.recordByActor).not.toHaveBeenCalled();
  });

  it('blocks (400) when the outflow would cross the floor — message carries the three figures (current/after/floor)', async () => {
    const { service } = makeService(150_000_000n); // 150M - 40M = 110M < 120M floor
    const err: any = await service
      .assertPostOutflowCompliant({ currency: 'AED', amountMinor: 40_000_000n, orderKind: 'VENDOR_PAYMENT', counterpartyNo: 'VEN1', actor })
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain('1500000.00 AED'); // 当前 NLA
    expect(err.message).toContain('1100000.00 AED'); // 动后 NLA
    expect(err.message).toContain('1200000.00 AED'); // 红线
    expect(err.message).toContain('Company Rulebook VI.C');
    expect(err.message).toContain('this payment');
  });

  it('blocks an LP exchange with its own label in the message ("this LP exchange")', async () => {
    const { service } = makeService(50_000_000n); // 已经低于红线，任何出款都拦
    const err: any = await service
      .assertPostOutflowCompliant({ currency: 'AED', amountMinor: 1_000_000n, orderKind: 'LP_EXCHANGE', counterpartyNo: 'LPP1', actor })
      .catch((e) => e);
    expect(err.message).toContain('this LP exchange');
  });

  it('passes a payment within headroom (does not block, no audit write — 正常期小额付款照常过)', async () => {
    const { service, auditLogs } = makeService(150_000_000n);
    await expect(
      service.assertPostOutflowCompliant({ currency: 'AED', amountMinor: 1_000_000n, orderKind: 'VENDOR_PAYMENT', counterpartyNo: 'VEN1', actor }),
    ).resolves.toBeUndefined();
    expect(auditLogs.recordByActor).not.toHaveBeenCalled();
  });

  it('converts a USDT outflow to AED before comparing — properly converted stays within headroom; the raw µUSDT count would have falsely blocked it', async () => {
    const { service, auditLogs } = makeService(200_000_000n); // 2,000,000.00 AED, floor 1,200,000.00
    // 50,000 USDT (6dp) 经折算 ≈183,625.00 AED，动后 NLA ≈1,816,375.00 仍远高于红线——
    // 若实现忘记转换、直接拿 50_000_000_000n(µUSDT) 当 AED 分比较，会被判定跌破而误拦。
    await expect(
      service.assertPostOutflowCompliant({ currency: 'USDT', amountMinor: 50_000_000_000n, orderKind: 'LP_EXCHANGE', counterpartyNo: 'LPP1', actor }),
    ).resolves.toBeUndefined();
    expect(auditLogs.recordByActor).not.toHaveBeenCalled();
  });

  it('a USDT outflow correctly converted can still trip an AED-denominated floor', async () => {
    const { service } = makeService(150_000_000n); // 1,500,000.00 AED
    // 113,600,000,000 µUSDT → 41,719,600 fils（既有换算用例）；after = 108,280,400 < 120,000,000 floor。
    const err: any = await service
      .assertPostOutflowCompliant({ currency: 'USDT', amountMinor: 113_600_000_000n, orderKind: 'LP_EXCHANGE', counterpartyNo: 'LPP1', actor })
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain('1082804.00 AED');
    expect(usdtMinorToAedMinor(113_600_000_000n)).toBe(41_719_600n); // 换算基准值不漂
  });

  it('writes PRUDENTIAL_GATE_BLOCKED (DENIED, reasonCode=NLA_FLOOR, explicit requestId, non-empty reason) before throwing', async () => {
    const { service, auditLogs } = makeService(50_000_000n);
    const err: any = await service
      .assertPostOutflowCompliant({ currency: 'AED', amountMinor: 1_000_000n, orderKind: 'VENDOR_PAYMENT', counterpartyNo: 'VEN1', actor })
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException); // 断言写审计先于抛异常这件事本身发生过（走到了这一行）
    expect(auditLogs.recordByActor).toHaveBeenCalledTimes(1);
    const audit = auditLogs.recordByActor.mock.calls[0][0];
    expect(audit).toMatchObject({
      action: 'PRUDENTIAL_GATE_BLOCKED', actionDomain: 'TREASURY', outcome: 'DENIED',
      reasonCode: 'NLA_FLOOR', primarySubjectType: 'PRUDENTIAL_STATUS', primarySubjectNo: 'NLA',
    });
    expect(typeof audit.reason).toBe('string');
    expect(audit.reason.length).toBeGreaterThan(0);
    expect(audit.requestId).toMatch(/^PRUDENTIAL_GATE_BLOCKED_NLA_/);
    const actorEnvelope = auditLogs.recordByActor.mock.calls[0][1];
    expect(actorEnvelope).toMatchObject({ actorType: 'ADMIN', actorNo: 'ADM-TRE', actorDisplayName: 'ADM-TRE', actorRolesAtTime: ['TREASURY_OFFICER'] });
  });

  it('subjects use OUTSOURCING_VENDOR for VENDOR_PAYMENT and LIQUIDITY_PROVIDER for LP_EXCHANGE — counterpartyNo mirrored, role RELATED', async () => {
    const { service: vendorSvc, auditLogs: vendorAudit } = makeService(50_000_000n);
    await vendorSvc.assertPostOutflowCompliant({ currency: 'AED', amountMinor: 1_000_000n, orderKind: 'VENDOR_PAYMENT', counterpartyNo: 'VEN1', actor }).catch(() => {});
    expect(vendorAudit.recordByActor.mock.calls[0][0].subjects).toEqual([
      expect.objectContaining({ subjectType: 'OUTSOURCING_VENDOR', subjectNo: 'VEN1', subjectRole: 'RELATED' }),
    ]);

    const { service: lpSvc, auditLogs: lpAudit } = makeService(50_000_000n);
    await lpSvc.assertPostOutflowCompliant({ currency: 'AED', amountMinor: 1_000_000n, orderKind: 'LP_EXCHANGE', counterpartyNo: 'LPP1', actor }).catch(() => {});
    expect(lpAudit.recordByActor.mock.calls[0][0].subjects).toEqual([
      expect.objectContaining({ subjectType: 'LIQUIDITY_PROVIDER', subjectNo: 'LPP1', subjectRole: 'RELATED' }),
    ]);
  });

  it('metadata carries the three figures + currency/orderKind/counterpartyNo (amountMinor as the minor-unit string)', async () => {
    const { service, auditLogs } = makeService(150_000_000n);
    await service.assertPostOutflowCompliant({ currency: 'AED', amountMinor: 40_000_000n, orderKind: 'VENDOR_PAYMENT', counterpartyNo: 'VEN1', actor }).catch(() => {});
    const audit = auditLogs.recordByActor.mock.calls[0][0];
    expect(audit.metadata).toMatchObject({
      orderKind: 'VENDOR_PAYMENT', counterpartyNo: 'VEN1', currency: 'AED', amountMinor: '40000000',
      nlaBeforeAedMinor: '150000000', nlaAfterAedMinor: '110000000', floorAedMinor: '120000000',
    });
  });
});
