// 战役乙波三 T1：审慎（NLA）地基行为测试（照 capital-injection-workflow.service.spec.ts 的
// acct(code, ledger) 编码 mock 先例——resolveTbAccountId 按 ledger 返回不同账户 id，
// 若实现把 AED/USDT 的 ledger 传错或余额查错账户，断言会对不上，能真的抓到跨 ledger 错误）。
import { PrudentialService } from './prudential.service';
import { MONTHLY_OPEX_BASE_AED_MINOR, NLA_FLOOR_AED_MINOR, usdtMinorToAedMinor } from './prudential.constants';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';

const AED = { id: 'asset-aed', code: 'AED', currency: 'AED', decimals: 2, type: 'FIAT', status: 'ACTIVE' };
const USDT = { id: 'asset-usdt', code: 'USDT-TRON', currency: 'USDT', decimals: 6, type: 'CRYPTO', status: 'ACTIVE' };
const OPS_WALLET = { id: 'w-ops', walletNo: 'WAL-OPS' };

function makePrisma(assets: any[] = [AED, USDT]) {
  return { asset: { findMany: jest.fn(async () => assets) } };
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
    const service = new PrudentialService(prisma, systemWallets, accounting);

    const status = await service.computeStatus();

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
    expect(status.perAsset).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assetCode: 'AED', currency: 'AED', balanceMinor: '100000000', aedEquivalentMinor: '100000000' }),
        expect.objectContaining({ assetCode: 'USDT-TRON', currency: 'USDT', balanceMinor: '113600000000', aedEquivalentMinor: '41719600' }),
      ]),
    );
  });

  it('flags breach when below the floor, and headroom is negative-safe (breached ⇒ headroom < 0 as string)', async () => {
    const prisma: any = makePrisma();
    const systemWallets: any = makeSystemWallets();
    // AED 10,000,000 fils (=100,000.00 AED) + USDT 0 → 远低于红线 120,000,000 fils
    const accounting: any = makeAccounting({
      AED: { creditsPosted: 10_000_000n, debitsPosted: 0n },
      USDT: { creditsPosted: 0n, debitsPosted: 0n },
    });
    const service = new PrudentialService(prisma, systemWallets, accounting);

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
    const service = new PrudentialService(prisma, systemWallets, accounting);

    const status = await service.computeStatus();

    expect(status.perAsset.find((a) => a.currency === 'AED')?.balanceMinor).toBe('120000000');
    expect(status.nlaAedMinor).toBe('120000000');
    expect(status.breached).toBe(false); // 恰等于红线，不破线
  });
});
