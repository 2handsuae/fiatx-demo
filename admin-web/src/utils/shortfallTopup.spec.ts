import {
  canRecognizeLossAndTopUpFromIncident,
  defaultFromWalletId,
  pickFromWallets,
  shortfallTopupChip,
  type FromWalletOption,
  type IncidentShortfallEntryFacts,
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

describe('canRecognizeLossAndTopUpFromIncident（事故页入口显示条件）', () => {
  const ok: IncidentShortfallEntryFacts = {
    canTopUp: true, status: 'ASSESSED', assessmentBasis: 'FIRM_LOSS',
    sourceCaseNo: 'REC20261107-011', sourceDispositionNo: 'RCD261107342109', customerNo: 'CU2601016170',
    hasTransferRemediation: false,
  };

  it('全满足 → 显示（ASSESSED 与 RESOLVING 都行）', () => {
    expect(canRecognizeLossAndTopUpFromIncident(ok)).toBe(true);
    expect(canRecognizeLossAndTopUpFromIncident({ ...ok, status: 'RESOLVING' })).toBe(true);
  });

  it('没有行锚（sourceDispositionNo 空）→ 不显示：案件页找不到要开弹层的行，会是个点了没反应的按钮（CLIENT_SHORTFALL 经「Register shortfall」登记就是这种）', () => {
    expect(canRecognizeLossAndTopUpFromIncident({ ...ok, sourceDispositionNo: null })).toBe(false);
    expect(canRecognizeLossAndTopUpFromIncident({ ...ok, sourceDispositionNo: '' })).toBe(false);
  });

  it('其余任一条件不满足都收起：无权 / 非 ASSESSED·RESOLVING / 非 FIRM_LOSS / 无来源案 / 无客户 / 已挂 TRANSFER 善后', () => {
    expect(canRecognizeLossAndTopUpFromIncident({ ...ok, canTopUp: false })).toBe(false);
    expect(canRecognizeLossAndTopUpFromIncident({ ...ok, status: 'INVESTIGATING' })).toBe(false);
    expect(canRecognizeLossAndTopUpFromIncident({ ...ok, status: 'CLOSED' })).toBe(false);
    expect(canRecognizeLossAndTopUpFromIncident({ ...ok, assessmentBasis: 'RECOVERED' })).toBe(false);
    expect(canRecognizeLossAndTopUpFromIncident({ ...ok, assessmentBasis: null })).toBe(false);
    expect(canRecognizeLossAndTopUpFromIncident({ ...ok, sourceCaseNo: null })).toBe(false);
    expect(canRecognizeLossAndTopUpFromIncident({ ...ok, customerNo: null })).toBe(false);
    expect(canRecognizeLossAndTopUpFromIncident({ ...ok, hasTransferRemediation: true })).toBe(false);
  });
});
