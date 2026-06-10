import { AssetProvisioningService } from './asset-provisioning.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';

describe('AssetProvisioningService (two-book)', () => {
  it('provision 为每个资产开 10 个 SYSTEM 账户(无 FEE_RECEIVABLE)', async () => {
    const createAccounts = jest.fn().mockResolvedValue(undefined);
    const prisma: any = {
      asset: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'a1', type: 'CRYPTO', currency: 'USDT', assetNo: 'AST-1' }),
        aggregate: jest.fn().mockResolvedValue({ _max: { tbLedgerId: 1 } }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const svc = new AssetProvisioningService(prisma, { createAccounts } as any);
    await svc.provision('a1');
    const codes = createAccounts.mock.calls[0][0].map((p: any) => p.code).sort((a: number, b: number) => a - b);
    expect(codes).toEqual([
      TB_ACCOUNT_CODES.CLIENT_CUSTODY,     // 10
      TB_ACCOUNT_CODES.FIRM_OPS,           // 50
      TB_ACCOUNT_CODES.FX_POSITION,        // 60
      TB_ACCOUNT_CODES.TRADE_CLEARING,     // 110
      TB_ACCOUNT_CODES.PAID_IN_CAPITAL,    // 200
      TB_ACCOUNT_CODES.RETAINED_EARNINGS,  // 210
      TB_ACCOUNT_CODES.FEE_INCOME,         // 300
      TB_ACCOUNT_CODES.SPREAD_INCOME,      // 310
      TB_ACCOUNT_CODES.FX_UNREALIZED_PNL,  // 320
      TB_ACCOUNT_CODES.FX_REALIZED_PNL,    // 330
    ]);
    expect(codes).not.toContain(TB_ACCOUNT_CODES.FEE_RECEIVABLE);
  });
});
