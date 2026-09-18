import { AuditActions, V8_RECON_AUDIT_ACTIONS } from './audit-actions.constant';

describe('平账 A 批审计两码——出生即冻结四属性（spec §2.8）', () => {
  it('RECON_CASE_AGING_BREACHED：RECON 域、N 模式、无特有必填', () => {
    expect(AuditActions.RECON_CASE_AGING_BREACHED).toBe('RECON_CASE_AGING_BREACHED');
    expect(V8_RECON_AUDIT_ACTIONS.RECON_CASE_AGING_BREACHED).toEqual({
      domain: 'RECON', correlationMode: 'NONE', requiredFields: [], requiresCausation: false,
    });
  });
  it('RECON_AGING_TIMEOUT_SIMULATED：RECON 域、N 模式、无特有必填', () => {
    expect(AuditActions.RECON_AGING_TIMEOUT_SIMULATED).toBe('RECON_AGING_TIMEOUT_SIMULATED');
    expect(V8_RECON_AUDIT_ACTIONS.RECON_AGING_TIMEOUT_SIMULATED).toEqual({
      domain: 'RECON', correlationMode: 'NONE', requiredFields: [], requiresCausation: false,
    });
  });
  it('V8 名册 7 → 9 码', () => {
    expect(Object.keys(V8_RECON_AUDIT_ACTIONS)).toHaveLength(9);
  });
});
