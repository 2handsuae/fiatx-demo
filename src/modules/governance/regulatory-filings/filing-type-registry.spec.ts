// 战役甲波二 Task 1：报送类型注册表 + 依据码目录 authority 回填。
import { FILING_TYPE_REGISTRY, getFilingTypeConfig } from './filing-type-registry';
import { FILING_TRANSITIONS, FilingStatus, RegulatoryAuthorities } from './regulatory-filing.constants';
import { INCIDENT_REPORT_BASES } from '../incidents/incident.constants';

describe('FILING_TYPE_REGISTRY (spec §2 类型目录五行)', () => {
  it('恰好 5 键，且全部 enabled', () => {
    const keys = Object.keys(FILING_TYPE_REGISTRY).sort();
    expect(keys).toEqual([
      'AUDITOR_APPOINTMENT_NOTICE', 'INCIDENT_REPORT', 'MARKET_OFFENCE_DUAL_REPORT',
      'MATERIAL_CHANGE_NOTIFICATION', 'REG_INFO_REQUEST_RESPONSE',
    ]);
    for (const key of keys) {
      expect(FILING_TYPE_REGISTRY[key].enabled).toBe(true);
    }
  });

  it('INCIDENT_REPORT 是唯一 requiresIncident=true 的类型', () => {
    const requiresIncident = Object.entries(FILING_TYPE_REGISTRY)
      .filter(([, c]) => c.requiresIncident)
      .map(([type]) => type);
    expect(requiresIncident).toEqual(['INCIDENT_REPORT']);
  });

  it('REG_INFO_REQUEST_RESPONSE 是唯一 INBOUND 类型，且 defaultHours===48', () => {
    const inbound = Object.entries(FILING_TYPE_REGISTRY)
      .filter(([, c]) => c.direction === 'INBOUND')
      .map(([type]) => type);
    expect(inbound).toEqual(['REG_INFO_REQUEST_RESPONSE']);
    expect(FILING_TYPE_REGISTRY.REG_INFO_REQUEST_RESPONSE.defaultHours).toBe(48);
  });

  it('getFilingTypeConfig 未知类型抛 BadRequest', () => {
    expect(() => getFilingTypeConfig('NOPE')).toThrow(/unknown/i);
  });
});

describe('FILING_TRANSITIONS (spec §3 六态六边)', () => {
  it('恰好六态，CLOSED / CANCELLED 出边为空', () => {
    expect(Object.keys(FILING_TRANSITIONS).sort()).toEqual(Object.values(FilingStatus).sort());
    expect(FILING_TRANSITIONS[FilingStatus.CLOSED]).toEqual([]);
    expect(FILING_TRANSITIONS[FilingStatus.CANCELLED]).toEqual([]);
  });
});

describe('INCIDENT_REPORT_BASES authority 回填 (spec §2 依据码目录)', () => {
  const authorityKeys = new Set(Object.keys(RegulatoryAuthorities));

  it('每条 authority 都落在 RegulatoryAuthorities 键集内', () => {
    for (const base of Object.values(INCIDENT_REPORT_BASES)) {
      expect(authorityKeys.has(base.authority)).toBe(true);
    }
  });

  it('PDPL_ART_9 归 UAE_DATA_OFFICE，其余六条归 VARA', () => {
    expect(INCIDENT_REPORT_BASES.PDPL_ART_9.authority).toBe('UAE_DATA_OFFICE');
    const others = Object.entries(INCIDENT_REPORT_BASES).filter(([code]) => code !== 'PDPL_ART_9');
    expect(others).toHaveLength(6);
    for (const [, base] of others) {
      expect(base.authority).toBe('VARA');
    }
  });
});
