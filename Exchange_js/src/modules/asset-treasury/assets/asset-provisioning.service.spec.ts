// asset-provisioning.service.spec.ts
import { AssetProvisioningService } from './asset-provisioning.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';

describe('AssetProvisioningService (real-time 1:1)', () => {
  function setup(type: 'FIAT' | 'CRYPTO', currency: string) {
    const createAccounts = jest.fn().mockResolvedValue(undefined);
    const prisma: any = {
      asset: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'a1', type, currency, assetNo: 'AST-1' }),
        aggregate: jest.fn().mockResolvedValue({ _max: { tbLedgerId: 1 } }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const svc = new AssetProvisioningService(prisma, { createAccounts } as any);
    return { svc, createAccounts };
  }

  it('CRYPTO 资产开 5 个系统账户(无 FIRM_SET)', async () => {
    const { svc, createAccounts } = setup('CRYPTO', 'USDT');
    await svc.provision('a1');
    const codes = createAccounts.mock.calls[0][0].map((p: any) => p.code).sort((a: number, b: number) => a - b);
    expect(codes).toEqual([
      TB_ACCOUNT_CODES.CLIENT_ASSET, // 1
      TB_ACCOUNT_CODES.FIRM_ASSET,   // 50
      TB_ACCOUNT_CODES.FIRM_OPS,     // 200
      TB_ACCOUNT_CODES.FIRM_FEE,     // 202
      TB_ACCOUNT_CODES.FIRM_LIQ,     // 203
    ]);
  });

  it('FIAT 资产额外开 FIRM_SET(6 个)', async () => {
    const { svc, createAccounts } = setup('FIAT', 'AED');
    await svc.provision('a1');
    const codes = createAccounts.mock.calls[0][0].map((p: any) => p.code);
    expect(codes).toContain(TB_ACCOUNT_CODES.FIRM_SET); // 201
    expect(codes).toHaveLength(6);
  });
});
