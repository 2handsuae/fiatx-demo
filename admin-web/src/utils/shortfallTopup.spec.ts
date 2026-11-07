import {
  defaultFromWalletId,
  pickFromWallets,
  shortfallTopupChip,
  type FromWalletOption,
} from './shortfallTopup';

const w = (walletRole: string, walletNo: string, ownerUuid = `uuid-${walletNo}`): FromWalletOption => ({
  ownerUuid, walletNo, walletRole, balance: '1000',
});

describe('shortfallTopupChip（案件页差异行 Status 标签，按划转单 status × recognized）', () => {
  const T = 'ITR202611070001';

  it('待批 → Pending CFO', () => {
    expect(shortfallTopupChip({ transferNo: T, status: 'PENDING_APPROVAL', recognized: false }))
      .toEqual({ tone: 'blue', label: `Pending CFO · ${T}` });
  });

  it('执行中（短缺已记）→ Shortfall recognised · topping up', () => {
    expect(shortfallTopupChip({ transferNo: T, status: 'EXECUTING', recognized: true }))
      .toEqual({ tone: 'amber', label: `Shortfall recognised · topping up ${T}` });
  });

  it('成功 → Explained，带对勾', () => {
    expect(shortfallTopupChip({ transferNo: T, status: 'SUCCESS', recognized: true }))
      .toEqual({ tone: 'green', label: `Explained · ${T}`, check: true });
  });

  it('失败且短缺已记 → top-up failed（红），不是通用的 Failed', () => {
    const chip = shortfallTopupChip({ transferNo: T, status: 'FAILED', recognized: true });
    expect(chip.tone).toBe('red');
    expect(chip.label).toBe(`Shortfall recognised · top-up failed ${T}`);
  });

  it('失败但短缺没记成（RECOGNITION_FAILED）不会冒充「已记短缺」；兜底显示通用状态词', () => {
    const chip = shortfallTopupChip({ transferNo: T, status: 'FAILED', recognized: false });
    expect(chip.tone).toBe('gray');
    expect(chip.label).toBe(`Failed · ${T}`);
    expect(chip.label).not.toContain('recognised');
  });

  it('未知状态原样带状态码，不静默吞', () => {
    expect(shortfallTopupChip({ transferNo: T, status: 'SOMETHING_NEW', recognized: false }).label)
      .toBe(`SOMETHING_NEW · ${T}`);
  });
});

describe('pickFromWallets / defaultFromWalletId（Top up from 下拉）', () => {
  it('只留运营户与手续费户，运营户排前，其余角色（结算户 / LP 前厅 / 客户）全丢', () => {
    const rows = [w('F_SET', 'W-SET'), w('F_FEE', 'W-FEE'), w('F_LIQ', 'W-LIQ'), w('F_OPS', 'W-OPS'), w('CUSTOMER', 'W-CU')];
    expect(pickFromWallets(rows).map((r) => r.walletNo)).toEqual(['W-OPS', 'W-FEE']);
  });

  it('没有钱包 id 的行（登记表缺 ownerUuid）不进下拉——没法提交', () => {
    expect(pickFromWallets([w('F_OPS', 'W-OPS', '')])).toEqual([]);
  });

  it('默认选运营户；只有手续费户时不替人选', () => {
    expect(defaultFromWalletId(pickFromWallets([w('F_FEE', 'W-FEE'), w('F_OPS', 'W-OPS')]))).toBe('uuid-W-OPS');
    expect(defaultFromWalletId(pickFromWallets([w('F_FEE', 'W-FEE')]))).toBe('');
  });
});
