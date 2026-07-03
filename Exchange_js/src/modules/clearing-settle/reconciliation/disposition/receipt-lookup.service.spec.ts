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
            (where.externalRef === undefined || l.externalRef === where.externalRef) &&
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
  externalRef: '0xabc',
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
    const noRef = { ...order, externalRef: null };
    const prisma = makePrisma({
      balances: [{ source: 'CHAIN', accountRef: 'acc-1' }],
      lines: [line({ id: 'a', amount: 100 }), line({ id: 'b', amount: 100 })],
    });
    const res = await new ReceiptLookupService(prisma).findUniqueReceipt(noRef as any);
    expect(res).toEqual({ kind: 'MISS', candidates: 2 });
  });

  it('tier-2 unique element match → HIT with businessDate', async () => {
    const noRef = { ...order, externalRef: null };
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
