import { ReceiptLookupService } from './receipt-lookup.service';

const line = (over: any = {}) => ({
  id: over.id ?? 'ext-1',
  externalRef: over.externalRef ?? null,
  amount: over.amount ?? 100,
  direction: over.direction ?? 'IN',
  datetime: over.datetime ?? new Date('2026-06-30T10:00:00Z'),
  ...over,
});

function makePrisma(opts: { balances?: any[]; lines?: any[] }) {
  return {
    externalBalance: { findFirst: jest.fn(async () => opts.balances?.[0] ?? null) },
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
    const noRef = { ...order, externalRefs: [] };
    const prisma = makePrisma({
      balances: [{ source: 'CHAIN', accountRef: 'acc-1' }],
      lines: [line({ id: 'a', amount: 100 }), line({ id: 'b', amount: 100 })],
    });
    const res = await new ReceiptLookupService(prisma).findUniqueReceipt(noRef as any);
    expect(res).toEqual({ kind: 'MISS', candidates: 2 });
  });

  it('tier-2 unique element match → HIT with businessDate', async () => {
    const noRef = { ...order, externalRefs: [] };
    const prisma = makePrisma({
      balances: [{ source: 'CHAIN', accountRef: 'acc-1' }],
      lines: [
        line({ id: 'a', amount: 100, direction: 'IN' }),
        line({ id: 'b', amount: 999, direction: 'IN' }),
      ],
    });
    const res = await new ReceiptLookupService(prisma).findUniqueReceipt(noRef as any);
    expect(res).toEqual({ kind: 'HIT', lineId: 'a', effectiveDate: '2026-06-30' });
  });
});
