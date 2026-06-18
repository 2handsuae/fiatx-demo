import { Prisma } from '@prisma/client';
import { MockExternalAdapter } from './mock-external.adapter';

describe('MockExternalAdapter', () => {
  let prisma: any;
  let adapter: MockExternalAdapter;
  beforeEach(() => {
    prisma = { wallet: { findMany: jest.fn() } };
    adapter = new MockExternalAdapter(prisma);
  });
  it('balanceAt sums wallet.mockBalance for the asset', async () => {
    prisma.wallet.findMany.mockResolvedValue([
      { mockBalance: new Prisma.Decimal('1000') },
      { mockBalance: new Prisma.Decimal('794.150136') },
    ]);
    const bal = await adapter.balanceAt('USDT', 'asset-usdt', new Date());
    expect(bal.toString()).toBe('1794.150136');
  });
});
