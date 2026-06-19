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

  it('balanceAt scopes to CLIENT wallets only (C_* in where; firm excluded by query)', async () => {
    // 模拟 Prisma 行为：findMany 按 where.walletRole.startsWith='C_' 过滤，
    // 只返回客户钱包行（firm F_* 行在 DB 层已被排除，永远不进 reduce）。
    prisma.wallet.findMany.mockImplementation(async ({ where }: any) => {
      // 全量钱包（含 firm），断言查询确实施加了客户过滤后再返回过滤结果
      const all = [
        { walletRole: 'C_DEP', assetId: 'asset-usdt', status: 'ACTIVE', mockBalance: new Prisma.Decimal('440.09') },
        { walletRole: 'C_MAIN', assetId: 'asset-usdt', status: 'ACTIVE', mockBalance: new Prisma.Decimal('100.00') },
        { walletRole: 'F_FEE', assetId: 'asset-usdt', status: 'ACTIVE', mockBalance: new Prisma.Decimal('9999.99') },
        { walletRole: 'F_LIQ', assetId: 'asset-usdt', status: 'ACTIVE', mockBalance: new Prisma.Decimal('5000.00') },
      ];
      const prefix = where?.walletRole?.startsWith;
      return all.filter(
        w =>
          w.assetId === where.assetId &&
          w.status === where.status &&
          (prefix ? w.walletRole.startsWith(prefix) : true),
      );
    });
    const bal = await adapter.balanceAt('USDT', 'asset-usdt', new Date());
    // 客户 440.09 + 100.00 = 540.09；firm 14999.99 必须被排除
    expect(bal.toString()).toBe('540.09');
    // 证明查询确实带了 C_ 客户过滤（边界断言）
    expect(prisma.wallet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ walletRole: { startsWith: 'C_' } }),
      }),
    );
  });
});
