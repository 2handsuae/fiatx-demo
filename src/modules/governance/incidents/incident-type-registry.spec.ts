// 战役甲波一 Task 2：类型注册表——spec §1 十类终盘（MANUAL 退役）。
import { ASSESSMENT_BASIS_BY_SCHEME, INCIDENT_TYPE_REGISTRY, getIncidentTypeConfig } from './incident-type-registry';
import { IncidentTypes } from './incident.constants';

describe('INCIDENT_TYPE_REGISTRY (spec §1 十类终盘)', () => {
  it('has exactly the 10 chartered types and MANUAL is gone', () => {
    expect(Object.keys(INCIDENT_TYPE_REGISTRY).sort()).toEqual([
      'ASSET_NONCOMPLIANCE', 'CLIENT_SHORTFALL', 'COMPLAINT_ESCALATION', 'CYBER_BCDR',
      'DATA_BREACH', 'LARGE_UNEXPLAINED', 'OUTSOURCING_FAILURE', 'PRUDENTIAL_BREACH',
      'STUCK_TRANSACTION_MAJOR', 'UNAUTHORIZED_OUTFLOW',
    ]);
    // 终审 M5：incident.constants.ts:6 的注释声称"键集一致性由本文件第一条测试钉死"——
    // 此前那句话只是承诺，实际没有断言 IncidentTypes 键集，这条把它兑现成真的。
    expect(Object.keys(IncidentTypes).sort()).toEqual(Object.keys(INCIDENT_TYPE_REGISTRY).sort());
  });
  it('DATA_BREACH: DPO 经办、CISO 单步结案、双码候选、影响口径', () => {
    const c = INCIDENT_TYPE_REGISTRY.DATA_BREACH;
    expect(c.operatorGroup).toBe('INCIDENT_DATA_WRITE');
    // 甲波一 T5 修1（Ruling-6）：族独占能力码——assertOperator 实际消费的是这个，不是 operatorGroup。
    expect(c.operatorMarkerCode).toBe('cap.incident.data');
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
    expect(c.operatorMarkerCode).toBe('cap.incident.fin');
    expect(c.closeActionType).toBe('INCIDENT_CLOSE_PRUDENTIAL');
    expect(c.assessmentScheme).toBe('SHORTFALL');
  });
  it('存量三类行为锚不变、走存量链', () => {
    expect(INCIDENT_TYPE_REGISTRY.UNAUTHORIZED_OUTFLOW.closeActionType).toBe('INCIDENT_CLOSE_SECURITY');
    expect(INCIDENT_TYPE_REGISTRY.LARGE_UNEXPLAINED.closeActionType).toBe('INCIDENT_CLOSE_FINANCIAL');
    expect(INCIDENT_TYPE_REGISTRY.STUCK_TRANSACTION_MAJOR.closeActionType).toBe('INCIDENT_CLOSE_FINANCIAL');
  });
  // 战役甲波五 T4：通电——enabled:true，结案走 CUSTOMER 链，锚键改投诉侧两号。
  it('COMPLAINT_ESCALATION 通电：enabled + CUSTOMER 结案链 + complaintNo/ownerCustomerNo 锚', () => {
    const c = INCIDENT_TYPE_REGISTRY.COMPLAINT_ESCALATION;
    expect(c.enabled).toBe(true);
    expect(c.closeActionType).toBe('INCIDENT_CLOSE_CUSTOMER');
    expect(c.requiredAnchors).toEqual(['complaintNo', 'ownerCustomerNo']);
    // 评审 Minor 6（修复轮1）：补钉未改动的两个字段——不可勾通报依据 + IMPACT 口径。
    expect(c.reportBasisCandidates).toEqual([]);
    expect(c.assessmentScheme).toBe('IMPACT');
    expect(() => getIncidentTypeConfig('COMPLAINT_ESCALATION')).not.toThrow();
    expect(() => getIncidentTypeConfig('MANUAL')).toThrow(/unknown/i);
  });
  // 事件表单重设计 spec §4.1：定损结论按类型收窄的第九格。
  it('每个类型的 allowedAssessmentBases 非空且是其口径合法集的子集', () => {
    for (const [type, cfg] of Object.entries(INCIDENT_TYPE_REGISTRY)) {
      const schemeSet = ASSESSMENT_BASIS_BY_SCHEME[cfg.assessmentScheme];
      expect(cfg.allowedAssessmentBases.length).toBeGreaterThan(0);
      for (const b of cfg.allowedAssessmentBases) expect(schemeSet).toContain(b);
    }
  });
  it('影响口径六类中仅 DATA_BREACH 允许 DATA_IMPACT、其余固定 SERVICE_IMPACT', () => {
    expect(INCIDENT_TYPE_REGISTRY.DATA_BREACH.allowedAssessmentBases).toEqual(['DATA_IMPACT']);
    for (const t of ['CYBER_BCDR', 'OUTSOURCING_FAILURE', 'ASSET_NONCOMPLIANCE', 'COMPLAINT_ESCALATION']) {
      expect(INCIDENT_TYPE_REGISTRY[t].allowedAssessmentBases).toEqual(['SERVICE_IMPACT']);
    }
  });
});
