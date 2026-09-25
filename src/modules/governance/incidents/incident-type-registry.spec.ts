// 战役甲波一 Task 2：类型注册表——spec §1 十类终盘（MANUAL 退役）。
import { INCIDENT_TYPE_REGISTRY, getIncidentTypeConfig } from './incident-type-registry';

describe('INCIDENT_TYPE_REGISTRY (spec §1 十类终盘)', () => {
  it('has exactly the 10 chartered types and MANUAL is gone', () => {
    expect(Object.keys(INCIDENT_TYPE_REGISTRY).sort()).toEqual([
      'ASSET_NONCOMPLIANCE', 'CLIENT_SHORTFALL', 'COMPLAINT_ESCALATION', 'CYBER_BCDR',
      'DATA_BREACH', 'LARGE_UNEXPLAINED', 'OUTSOURCING_FAILURE', 'PRUDENTIAL_BREACH',
      'STUCK_TRANSACTION_MAJOR', 'UNAUTHORIZED_OUTFLOW',
    ]);
  });
  it('DATA_BREACH: DPO 经办、CISO 单步结案、双码候选、影响口径', () => {
    const c = INCIDENT_TYPE_REGISTRY.DATA_BREACH;
    expect(c.operatorGroup).toBe('INCIDENT_DATA_WRITE');
    expect(c.closeActionType).toBe('INCIDENT_CLOSE_TECHSEC');
    expect([...c.reportBasisCandidates].sort()).toEqual(['PDPL_ART_9', 'TIR_II_C_24H']);
    expect(c.assessmentScheme).toBe('IMPACT');
    expect(c.allowedRemediationKinds).toEqual(['CUSTOMER_NOTICE_LOGGED']);
  });
  it('ASSET_NONCOMPLIANCE: 空码集 + 资产暂停引用白名单', () => {
    const c = INCIDENT_TYPE_REGISTRY.ASSET_NONCOMPLIANCE;
    expect(c.reportBasisCandidates).toEqual([]);
    expect(c.allowedRemediationKinds).toEqual(['ASSET_SUSPENSION_REF']);
    expect(c.closeActionType).toBe('INCIDENT_CLOSE_TECHSEC');
  });
  it('PRUDENTIAL_BREACH: CFO 经办不可自批 → 高管链', () => {
    const c = INCIDENT_TYPE_REGISTRY.PRUDENTIAL_BREACH;
    expect(c.operatorGroup).toBe('INCIDENT_FIN_WRITE');
    expect(c.closeActionType).toBe('INCIDENT_CLOSE_PRUDENTIAL');
    expect(c.assessmentScheme).toBe('SHORTFALL');
  });
  it('存量三类行为锚不变、走存量链', () => {
    expect(INCIDENT_TYPE_REGISTRY.UNAUTHORIZED_OUTFLOW.closeActionType).toBe('INCIDENT_CLOSE_SECURITY');
    expect(INCIDENT_TYPE_REGISTRY.LARGE_UNEXPLAINED.closeActionType).toBe('INCIDENT_CLOSE_FINANCIAL');
    expect(INCIDENT_TYPE_REGISTRY.STUCK_TRANSACTION_MAJOR.closeActionType).toBe('INCIDENT_CLOSE_FINANCIAL');
  });
  it('COMPLAINT_ESCALATION 停用：getIncidentTypeConfig 抛 400', () => {
    expect(INCIDENT_TYPE_REGISTRY.COMPLAINT_ESCALATION.enabled).toBe(false);
    expect(() => getIncidentTypeConfig('COMPLAINT_ESCALATION')).toThrow(/disabled/i);
    expect(() => getIncidentTypeConfig('MANUAL')).toThrow(/unknown/i);
  });
});
