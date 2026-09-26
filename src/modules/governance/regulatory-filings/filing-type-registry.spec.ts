// 战役甲波二 Task 1：报送类型注册表 + 依据码目录 authority 回填。
// 战役甲波三 Task 1：族字段回填断言 + 六行 AML 新类型断言 + 两族边集穷举断言。
import { FILING_TYPE_REGISTRY, getFilingTypeConfig } from './filing-type-registry';
import {
  FILING_TRANSITIONS_BY_FAMILY, FilingEntryKinds, FilingStatus, RegulatoryAuthorities,
} from './regulatory-filing.constants';
import { INCIDENT_REPORT_BASES } from '../incidents/incident.constants';

describe('FILING_TYPE_REGISTRY (spec §2 类型目录五行 + 波三六行)', () => {
  it('恰好 11 键，且全部 enabled', () => {
    const keys = Object.keys(FILING_TYPE_REGISTRY).sort();
    expect(keys).toEqual([
      'AUDITOR_APPOINTMENT_NOTICE', 'CNMR', 'HRC', 'HRCA', 'INCIDENT_REPORT', 'MARKET_OFFENCE_DUAL_REPORT',
      'MATERIAL_CHANGE_NOTIFICATION', 'PNMR', 'REG_INFO_REQUEST_RESPONSE', 'SAR', 'STR',
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

  it('既有五行回填 family=GENERAL 与隐式锚显式化的 anchorKind（T1 摘要表）', () => {
    expect(FILING_TYPE_REGISTRY.INCIDENT_REPORT.family).toBe('GENERAL');
    expect(FILING_TYPE_REGISTRY.INCIDENT_REPORT.anchorKind).toBe('BASIS');
    expect(FILING_TYPE_REGISTRY.REG_INFO_REQUEST_RESPONSE.family).toBe('GENERAL');
    expect(FILING_TYPE_REGISTRY.REG_INFO_REQUEST_RESPONSE.anchorKind).toBe('RECEIVED_AT');
    for (const type of ['MATERIAL_CHANGE_NOTIFICATION', 'AUDITOR_APPOINTMENT_NOTICE', 'MARKET_OFFENCE_DUAL_REPORT']) {
      expect(FILING_TYPE_REGISTRY[type].family).toBe('GENERAL');
      expect(FILING_TYPE_REGISTRY[type].anchorKind).toBe('NONE');
    }
  });

  it('六行 AML 新类型：全 OUTBOUND、requiresIncident=false、family=AML', () => {
    for (const type of ['STR', 'SAR', 'CNMR', 'PNMR', 'HRC', 'HRCA']) {
      const cfg = FILING_TYPE_REGISTRY[type];
      expect(cfg.direction).toBe('OUTBOUND');
      expect(cfg.requiresIncident).toBe(false);
      expect(cfg.family).toBe('AML');
    }
  });

  it('STR/SAR：UAE_FIU、无钟、allowNoFilingClose+requiresExternalCaseRef', () => {
    for (const type of ['STR', 'SAR']) {
      const cfg = FILING_TYPE_REGISTRY[type];
      expect(cfg.defaultAuthority).toBe('UAE_FIU');
      expect(cfg.defaultHours).toBeNull();
      expect(cfg.deadlineBusinessDays).toBeUndefined();
      expect(cfg.anchorKind).toBe('NONE');
      expect(cfg.allowNoFilingClose).toBe(true);
      expect(cfg.requiresExternalCaseRef).toBe(true);
    }
  });

  it('CNMR/PNMR：EOCN、5 工作日、EXTERNAL 锚、requiresExternalCaseRef', () => {
    for (const type of ['CNMR', 'PNMR']) {
      const cfg = FILING_TYPE_REGISTRY[type];
      expect(cfg.defaultAuthority).toBe('EOCN');
      expect(cfg.deadlineBusinessDays).toBe(5);
      expect(cfg.defaultHours).toBeNull();
      expect(cfg.anchorKind).toBe('EXTERNAL');
      expect(cfg.requiresExternalCaseRef).toBe(true);
      expect(cfg.allowNoFilingClose).toBeUndefined();
    }
  });

  it('HRC/HRCA：UAE_FIU、无钟，不要求 externalCaseRef（spec §1⑤白项收窄）', () => {
    for (const type of ['HRC', 'HRCA']) {
      const cfg = FILING_TYPE_REGISTRY[type];
      expect(cfg.defaultAuthority).toBe('UAE_FIU');
      expect(cfg.defaultHours).toBeNull();
      expect(cfg.deadlineBusinessDays).toBeUndefined();
      expect(cfg.anchorKind).toBe('NONE');
      expect(cfg.requiresExternalCaseRef).toBeUndefined();
      expect(cfg.allowNoFilingClose).toBeUndefined();
    }
  });

  it('defaultHours 与 deadlineBusinessDays 互斥：任何一行不得两者同时设值', () => {
    for (const [, cfg] of Object.entries(FILING_TYPE_REGISTRY)) {
      const hasHours = cfg.defaultHours != null;
      const hasBusinessDays = cfg.deadlineBusinessDays != null;
      expect(hasHours && hasBusinessDays).toBe(false);
    }
  });
});

describe('FILING_TRANSITIONS_BY_FAMILY (spec §3 点 2：两族边集穷举；T3 删了 FILING_TRANSITIONS 别名，GENERAL 六态六边的断言并入本块第一条)', () => {
  it('GENERAL 族恰好六态，CLOSED / CANCELLED 出边为空', () => {
    expect(Object.keys(FILING_TRANSITIONS_BY_FAMILY.GENERAL).sort()).toEqual(Object.values(FilingStatus).sort());
    expect(FILING_TRANSITIONS_BY_FAMILY.GENERAL[FilingStatus.CLOSED]).toEqual([]);
    expect(FILING_TRANSITIONS_BY_FAMILY.GENERAL[FilingStatus.CANCELLED]).toEqual([]);
  });

  it('两族键集都覆盖 FilingStatus 六态', () => {
    expect(Object.keys(FILING_TRANSITIONS_BY_FAMILY.GENERAL).sort()).toEqual(Object.values(FilingStatus).sort());
    expect(Object.keys(FILING_TRANSITIONS_BY_FAMILY.AML).sort()).toEqual(Object.values(FilingStatus).sort());
  });

  it('GENERAL 族恰好六边（含 PENDING_SIGNOFF 驳回边）', () => {
    const edges = Object.entries(FILING_TRANSITIONS_BY_FAMILY.GENERAL)
      .flatMap(([from, tos]) => tos.map((to) => `${from}->${to}`))
      .sort();
    expect(edges).toEqual([
      'DRAFT->CANCELLED', 'DRAFT->PENDING_SIGNOFF',
      'PENDING_SIGNOFF->DRAFT', 'PENDING_SIGNOFF->SIGNED_OFF',
      'SIGNED_OFF->SUBMITTED', 'SUBMITTED->CLOSED',
    ]);
  });

  it('AML 族恰好四边：DRAFT→SUBMITTED/CLOSED/CANCELLED、SUBMITTED→CLOSED；PENDING_SIGNOFF/SIGNED_OFF 零出边（送签非法跃迁）', () => {
    const edges = Object.entries(FILING_TRANSITIONS_BY_FAMILY.AML)
      .flatMap(([from, tos]) => tos.map((to) => `${from}->${to}`))
      .sort();
    expect(edges).toEqual([
      'DRAFT->CANCELLED', 'DRAFT->CLOSED', 'DRAFT->SUBMITTED', 'SUBMITTED->CLOSED',
    ]);
    expect(FILING_TRANSITIONS_BY_FAMILY.AML[FilingStatus.PENDING_SIGNOFF]).toEqual([]);
    expect(FILING_TRANSITIONS_BY_FAMILY.AML[FilingStatus.SIGNED_OFF]).toEqual([]);
  });

  it('两族终态（CLOSED/CANCELLED）零出边', () => {
    for (const family of ['GENERAL', 'AML'] as const) {
      expect(FILING_TRANSITIONS_BY_FAMILY[family][FilingStatus.CLOSED]).toEqual([]);
      expect(FILING_TRANSITIONS_BY_FAMILY[family][FilingStatus.CANCELLED]).toEqual([]);
    }
  });
});

describe('FilingEntryKinds (spec §5：tipping-off 登记本两新 kind)', () => {
  it('加了 CUSTOMER_COMM 与 AUTHORITY_INSTRUCTION，既有三种保留', () => {
    expect(Object.keys(FilingEntryKinds).sort()).toEqual([
      'AUTHORITY_INSTRUCTION', 'CUSTOMER_COMM', 'OUR_SUPPLEMENT', 'RECEIPT_ACK', 'REGULATOR_INQUIRY',
    ]);
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
