import { CustomerLedgerProvisioningService } from './customer-ledger-provisioning.service';
import { TB_ACCOUNT_CODES } from './constants/tb-account-codes.constant';

const OWNER = { id: 'uuid-1', customerNo: 'CU250907001' };
const makeDeps = (over: { assets?: any[]; existing?: any } = {}) => {
  const prisma: any = {
    asset: { findMany: jest.fn().mockResolvedValue(over.assets ?? [
      { code: 'AED', currency: 'AED' },
      { code: 'USDT-TRON', currency: 'USDT' },
      { code: 'USDT-ERC20', currency: 'USDT' }, // 同币种第二资产：ledger 撞，须去重
    ]) },
  };
  const registry: any = { resolve: jest.fn().mockResolvedValue(over.existing ?? null) };
  const accounting: any = { createAccounts: jest.fn().mockResolvedValue(undefined) };
  return { prisma, registry, accounting };
};
const build = (d: ReturnType<typeof makeDeps>) =>
  new CustomerLedgerProvisioningService(d.prisma, d.accounting, d.registry);

describe('CustomerLedgerProvisioningService（spec §7）', () => {
  it('ACTIVE 资产×两科目、按 (code,ledger) 去重：三资产两币种 → 4 户一次建齐', async () => {
    const d = makeDeps();
    const r = await build(d).provisionCustomerAccounts(OWNER);
    expect(r.created).toBe(4);
    const params = d.accounting.createAccounts.mock.calls[0][0];
    expect(params).toHaveLength(4);
    expect(params.map((p: any) => [p.code, p.ledger]).sort()).toEqual([
      [TB_ACCOUNT_CODES.CLIENT_PAYABLE, 1], [TB_ACCOUNT_CODES.CLIENT_PAYABLE, 2],
      [TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, 1], [TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, 2],
    ].sort());
    expect(params[0]).toMatchObject({ ownerType: 'CUSTOMER', ownerUuid: 'uuid-1', ownerNo: 'CU250907001' });
  });

  it('registry 已有行（种子客户）→ 跳过、零建户（与种子 findFirst 语义一致，spec §7）', async () => {
    const d = makeDeps({ existing: { tbAccountId: 'deadbeef' } });
    const r = await build(d).provisionCustomerAccounts(OWNER);
    expect(r.created).toBe(0);
    expect(d.accounting.createAccounts).not.toHaveBeenCalled();
  });

  it('TB 建户抛错 → 原样上抛，不吞（吞错正是 :155 卡单的病根）', async () => {
    const d = makeDeps();
    d.accounting.createAccounts.mockRejectedValue(new Error('TB down'));
    await expect(build(d).provisionCustomerAccounts(OWNER)).rejects.toThrow('TB down');
  });
});
