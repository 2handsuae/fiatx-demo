import { Prisma } from '@prisma/client';
import { ReceiptLookupService } from './receipt-lookup.service';

// Production faithfulness: external_statement_lines.amount is a Prisma.Decimal
// whose value is the integer 分 (T2 contract). The tier-2 amount comparison must
// survive Decimal↔BigInt, so default line.amount to a Decimal (integer 分).
const line = (over: any = {}) => ({
  id: over.id ?? 'ext-1',
  externalRef: over.externalRef ?? null,
  amount: over.amount ?? new Prisma.Decimal(10000), // 100.00 元 == 10000 分 (decimals=2)
  direction: over.direction ?? 'IN',
  datetime: over.datetime ?? new Date('2026-06-30T10:00:00Z'),
  ...over,
});

function makePrisma(opts: { balances?: any[]; lines?: any[]; assetDecimals?: number | null }) {
  return {
    externalBalance: { findFirst: jest.fn(async () => opts.balances?.[0] ?? null) },
    // asset.findFirst({ where: { currency }, select: { decimals } }) — tier-2 needs
    // the currency's decimals to convert the funds_order 元 amount into 分.
    // assetDecimals omitted defaults to 2 (AED); pass null to simulate "no asset row".
    asset: {
      findFirst: jest.fn(async () =>
        opts.assetDecimals === null ? null : { decimals: opts.assetDecimals ?? 2 },
      ),
    },
    externalStatementLine: {
      findMany: jest.fn(async ({ where }: any) =>
        (opts.lines ?? []).filter(
          (l: any) =>
            // tier-1 uses `externalRef: { in: [...] }`; tier-2 omits externalRef + filters by direction.
            (where.externalRef === undefined ||
              (where.externalRef.in?.includes(l.externalRef) ?? false)) &&
            (where.direction === undefined || l.direction === where.direction),
        ),
      ),
    },
  } as any;
}

const order = {
  fundsOrderNo: 'FO-1',
  walletId: 'w-1',
  direction: 'IN' as const,
  amount: 100,
  externalRefs: ['0xabc'],
  createdAt: new Date('2026-06-29T00:00:00Z'),
};

describe('ReceiptLookupService', () => {
  it('tier-1 externalRef exact match, exactly one → hit with businessDate', async () => {
    const prisma = makePrisma({
      balances: [{ source: 'CHAIN', accountRef: 'acc-1' }],
      lines: [line({ externalRef: '0xabc' })],
    });
    const res = await new ReceiptLookupService(prisma).findUniqueReceipt(order as any);
    expect(res).toEqual({ kind: 'HIT', lineId: 'ext-1', effectiveDate: '2026-06-30' });
  });

  it('tier-1 matches on txHash (referenceNo null) — aligns with matcher refsOf(txHash/referenceNo/providerTxnId)', async () => {
    // On-chain deposit/withdraw: the external receipt ref is the txHash, carried in externalRefs
    // (order.referenceNo is null). This is the I-1 gap: a txHash-only order must still tier-1 HIT.
    // The matching line's amount+direction deliberately DO NOT match, so the only path to HIT is
    // tier-1 ref membership — proving txHash participates (scalar externalRef impl would MISS here).
    const chainOrder = { ...order, externalRefs: ['0xTXHASH'] };
    const prisma = makePrisma({
      balances: [{ source: 'CHAIN', accountRef: 'acc-1' }],
      lines: [line({ id: 'chain-1', externalRef: '0xTXHASH', amount: 777, direction: 'OUT' })],
    });
    const res = await new ReceiptLookupService(prisma).findUniqueReceipt(chainOrder as any);
    expect(res).toEqual({ kind: 'HIT', lineId: 'chain-1', effectiveDate: '2026-06-30' });
  });

  it('zero candidates → MISS with count 0', async () => {
    const prisma = makePrisma({
      balances: [{ source: 'CHAIN', accountRef: 'acc-1' }],
      lines: [],
    });
    const res = await new ReceiptLookupService(prisma).findUniqueReceipt(order as any);
    expect(res).toEqual({ kind: 'MISS', candidates: 0 });
  });

  it('no external balance locator → MISS with count 0', async () => {
    const prisma = makePrisma({ balances: [], lines: [line({ externalRef: '0xabc' })] });
    const res = await new ReceiptLookupService(prisma).findUniqueReceipt(order as any);
    expect(res).toEqual({ kind: 'MISS', candidates: 0 });
  });

  it('tier-1 multiple externalRef matches → MISS with count, never guesses', async () => {
    const prisma = makePrisma({
      balances: [{ source: 'CHAIN', accountRef: 'acc-1' }],
      lines: [line({ id: 'a', externalRef: '0xabc' }), line({ id: 'b', externalRef: '0xabc' })],
    });
    const res = await new ReceiptLookupService(prisma).findUniqueReceipt(order as any);
    expect(res).toEqual({ kind: 'MISS', candidates: 2 });
  });

  it('multiple tier-2 candidates → MISS with count, never guesses', async () => {
    // order.amount=100 元 → 10000 分 (decimals=2); both lines carry 10000 分.
    const noRef = { ...order, externalRefs: [] };
    const prisma = makePrisma({
      balances: [{ source: 'CHAIN', accountRef: 'acc-1', currency: 'AED' }],
      lines: [
        line({ id: 'a', amount: new Prisma.Decimal(10000) }),
        line({ id: 'b', amount: new Prisma.Decimal(10000) }),
      ],
    });
    const res = await new ReceiptLookupService(prisma).findUniqueReceipt(noRef as any);
    expect(res).toEqual({ kind: 'MISS', candidates: 2 });
  });

  it('tier-2 unique element match → HIT with businessDate', async () => {
    // order.amount=100 元 → 10000 分; only line 'a' carries 10000 分, 'b' carries 99900.
    const noRef = { ...order, externalRefs: [] };
    const prisma = makePrisma({
      balances: [{ source: 'CHAIN', accountRef: 'acc-1', currency: 'AED' }],
      lines: [
        line({ id: 'a', amount: new Prisma.Decimal(10000), direction: 'IN' }),
        line({ id: 'b', amount: new Prisma.Decimal(99900), direction: 'IN' }),
      ],
    });
    const res = await new ReceiptLookupService(prisma).findUniqueReceipt(noRef as any);
    expect(res).toEqual({ kind: 'HIT', lineId: 'a', effectiveDate: '2026-06-30' });
  });

  // ── T3: tier-2 amount is compared across scales — funds_order 元 vs external line 分. ──
  it('tier-2 元→分 scale conversion: order 498 元 matches line 49800 分 (AED decimals=2) → HIT', async () => {
    // The v1-spec gap: funds_orders store 元 (498), external lines store 分 (49800).
    // Old code did String(498) === String(49800) → always MISS. After 元→分 it HITs.
    const noRef = { ...order, amount: 498, externalRefs: [] };
    const prisma = makePrisma({
      balances: [{ source: 'CHAIN', accountRef: 'acc-1', currency: 'AED' }],
      assetDecimals: 2,
      lines: [line({ id: 'aed-hit', amount: new Prisma.Decimal(49800), direction: 'IN' })],
    });
    const res = await new ReceiptLookupService(prisma).findUniqueReceipt(noRef as any);
    expect(res).toEqual({ kind: 'HIT', lineId: 'aed-hit', effectiveDate: '2026-06-30' });
  });

  it('tier-2 元→分 for USDT (decimals=6): order 3 元 matches line 3000000 分 → HIT', async () => {
    const noRef = { ...order, amount: 3, externalRefs: [] };
    const prisma = makePrisma({
      balances: [{ source: 'CHAIN', accountRef: 'acc-1', currency: 'USDT' }],
      assetDecimals: 6,
      lines: [line({ id: 'usdt-hit', amount: new Prisma.Decimal(3000000), direction: 'IN' })],
    });
    const res = await new ReceiptLookupService(prisma).findUniqueReceipt(noRef as any);
    expect(res).toEqual({ kind: 'HIT', lineId: 'usdt-hit', effectiveDate: '2026-06-30' });
  });

  it('tier-2 no asset row for currency → cannot convert, safe MISS (candidates 0), never misfire', async () => {
    // Push moves money: if decimals are unknowable we MUST NOT compare on a wrong
    // scale (which could false-HIT). Refuse to convert → MISS 0.
    const noRef = { ...order, amount: 498, externalRefs: [] };
    const prisma = makePrisma({
      balances: [{ source: 'CHAIN', accountRef: 'acc-1', currency: 'AED' }],
      assetDecimals: null,
      lines: [line({ id: 'x', amount: new Prisma.Decimal(49800), direction: 'IN' })],
    });
    const res = await new ReceiptLookupService(prisma).findUniqueReceipt(noRef as any);
    expect(res).toEqual({ kind: 'MISS', candidates: 0 });
  });

  it('tier-2 string-value edge: line amount "49800.0" Decimal still equals order 498 元 → HIT (not string ===)', async () => {
    // Guards against comparing via String(): "49800" vs "49800.0" would be a false MISS.
    const noRef = { ...order, amount: 498, externalRefs: [] };
    const prisma = makePrisma({
      balances: [{ source: 'CHAIN', accountRef: 'acc-1', currency: 'AED' }],
      assetDecimals: 2,
      lines: [line({ id: 'edge', amount: new Prisma.Decimal('49800.0'), direction: 'IN' })],
    });
    const res = await new ReceiptLookupService(prisma).findUniqueReceipt(noRef as any);
    expect(res).toEqual({ kind: 'HIT', lineId: 'edge', effectiveDate: '2026-06-30' });
  });
});
