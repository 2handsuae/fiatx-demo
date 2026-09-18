import { getComplianceLayerStyle } from './depositActionMap';

/* 客户关系生命周期七态,来源：
   src/modules/identity/constants/customer-lifecycle.constant.ts */
const LIFECYCLE_STATES = [
  'PROSPECT',
  'IN_VERIFICATION',
  'PENDING_APPROVAL',
  'ACTIVE',
  'REJECTED',
  'WITHDRAWN',
  'OFFBOARDED',
];

describe('getComplianceLayerStyle · 生命周期取值域(L1 · Eligibility)', () => {
  /* 这一格三域详情页共用。它此前读的是 CustomerMain 上一个**不存在的列**
     (`complianceStatus`,20260816063807 那次 migration 与 `restrictions` 一起 drop),
     恒 undefined → 恒落 'N/A' 灰。下面这条断言就是钉住"再也不许回到 N/A"。 */
  it('七态一个都不落 N/A —— 恒 N/A 正是被修掉的那个 bug', () => {
    for (const s of LIFECYCLE_STATES) {
      const style = getComplianceLayerStyle(s);
      expect(style.label).toBe(s);
      expect(style.label).not.toBe('N/A');
      expect(style.textColor).not.toBe('text-adm-t3');
    }
  });

  it('ACTIVE 绿 / 其余六态红 —— 与 L1GateService 的 CUSTOMER_ELIGIBILITY 同口径', () => {
    expect(getComplianceLayerStyle('ACTIVE').textColor).toBe('text-adm-green');
    for (const s of LIFECYCLE_STATES.filter((x) => x !== 'ACTIVE')) {
      expect(getComplianceLayerStyle(s).textColor).toBe('text-adm-red');
    }
  });

  it('没有客户(无值)才是 N/A —— 与"有客户但读了个幽灵列"区分得开', () => {
    expect(getComplianceLayerStyle(undefined).label).toBe('N/A');
    expect(getComplianceLayerStyle(null).label).toBe('N/A');
  });

  it('Sumsub 那套取值域不受影响(两套值域不相交)', () => {
    expect(getComplianceLayerStyle('approved').textColor).toBe('text-adm-green');
    expect(getComplianceLayerStyle('onHold').textColor).toBe('text-adm-amber');
    expect(getComplianceLayerStyle('awaitUser').textColor).toBe('text-adm-amber');
  });
});
