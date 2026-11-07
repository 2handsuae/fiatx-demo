import {
  HOUSE_TRANSFER_FAILURE_LABEL,
  HOUSE_TRANSFER_PURPOSE_LABEL,
  houseTransferStatusMeta,
  isFeeSweepRoute,
  isHouseTransferStuck,
} from './houseTransferStatusMap';

/* 六个后端状态、三个失败原因、唯一用途，来源：
   src/modules/asset-treasury/company-funding/dto/house-transfer.dto.ts
   （HouseTransferStatus / HOUSE_TRANSFER_PURPOSES）与 house-transfer-workflow.service.ts 的 failureReasonCode。 */
const BACKEND_STATUSES = ['PENDING_APPROVAL', 'EXECUTING', 'SUCCESS', 'FAILED', 'REJECTED', 'CANCELLED'];
const BACKEND_FAILURE_CODES = ['INSUFFICIENT_FIRM_BALANCE', 'LEG_FAILED', 'POSTING_FAILED'];

describe('houseTransferStatusMap', () => {
  it('六个后端状态都拿到真条目，不是裸枚举兜底', () => {
    for (const s of BACKEND_STATUSES) {
      const meta = houseTransferStatusMeta(s);
      expect(meta.label).not.toBe(s);
      expect(meta.badgeClass).toMatch(/^bg-[a-z]+-\d+ text-[a-z]+-\d+$/);
    }
  });

  it('EXECUTING + POSTING_FAILED 显示为「卡住」，不是失败也不是执行中', () => {
    const stuck = houseTransferStatusMeta('EXECUTING', 'POSTING_FAILED');
    expect(stuck.label).toBe('Stuck — posting failed');
    expect(stuck.label).not.toBe(houseTransferStatusMeta('FAILED').label);
    expect(stuck.label).not.toBe(houseTransferStatusMeta('EXECUTING').label);
    expect(isHouseTransferStuck('EXECUTING', 'POSTING_FAILED')).toBe(true);
  });

  it('只有 EXECUTING 上的 POSTING_FAILED 才算卡住；别的状态 / 别的原因照常显示', () => {
    expect(isHouseTransferStuck('EXECUTING', null)).toBe(false);
    expect(isHouseTransferStuck('EXECUTING', 'LEG_FAILED')).toBe(false);
    expect(isHouseTransferStuck('FAILED', 'POSTING_FAILED')).toBe(false);
    expect(houseTransferStatusMeta('FAILED', 'LEG_FAILED').label).toBe('Failed');
    expect(houseTransferStatusMeta('EXECUTING').label).toBe('Executing · funds in transit');
  });

  it('未映射状态原样显示状态码，空值显示破折号（不静默吞）', () => {
    expect(houseTransferStatusMeta('SOME_FUTURE_STATUS').label).toBe('SOME_FUTURE_STATUS');
    expect(houseTransferStatusMeta(null).label).toBe('—');
  });

  it('三个失败原因都有人话，用途只有扫费一项', () => {
    for (const c of BACKEND_FAILURE_CODES) expect(HOUSE_TRANSFER_FAILURE_LABEL[c]).toBeTruthy();
    expect(Object.keys(HOUSE_TRANSFER_PURPOSE_LABEL)).toEqual(['FEE_SWEEP']);
    expect(HOUSE_TRANSFER_PURPOSE_LABEL.FEE_SWEEP).toBe('Fee sweep');
  });

  it('只有手续费户 → 运营户是扫费路线（码 90 只在这条路出现）', () => {
    expect(isFeeSweepRoute('F_FEE', 'F_OPS')).toBe(true);
    expect(isFeeSweepRoute('F_OPS', 'F_FEE')).toBe(false);
    expect(isFeeSweepRoute('F_FEE', 'F_FEE')).toBe(false);
    expect(isFeeSweepRoute(null, 'F_OPS')).toBe(false);
  });
});
