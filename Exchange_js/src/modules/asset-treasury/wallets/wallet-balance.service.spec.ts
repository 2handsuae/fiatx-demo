import { Prisma } from '@prisma/client';
import { WalletBalanceService } from './wallet-balance.service';

describe('WalletBalanceService', () => {
  let service: WalletBalanceService;
  let tx: any;

  beforeEach(() => {
    tx = { wallet: { update: jest.fn().mockResolvedValue({}) } };
    service = new WalletBalanceService({} as any);
  });

  it('adjust increments mockBalance by delta (within caller tx)', async () => {
    await service.adjust('w1', new Prisma.Decimal(100), tx);
    expect(tx.wallet.update).toHaveBeenCalledTimes(1);
    const arg = tx.wallet.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'w1' });
    expect(arg.data.mockBalance.increment.toString()).toBe('100');
  });

  it('allows negative delta — no balance validation', async () => {
    await service.adjust('w1', new Prisma.Decimal(-50), tx);
    const arg = tx.wallet.update.mock.calls[0][0];
    expect(arg.data.mockBalance.increment.toString()).toBe('-50');
  });

  it('no-op when walletId is null/undefined', async () => {
    await service.adjust(null, new Prisma.Decimal(10), tx);
    await service.adjust(undefined, new Prisma.Decimal(10), tx);
    expect(tx.wallet.update).not.toHaveBeenCalled();
  });

  it('no-op when delta is zero', async () => {
    await service.adjust('w1', new Prisma.Decimal(0), tx);
    expect(tx.wallet.update).not.toHaveBeenCalled();
  });
});
