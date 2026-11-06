import {
  AuditActions, AuditBusinessWorkflowTypes, AuditEntityTypes,
  CAMPAIGN_E_HOUSE_TRANSFER_AUDIT_ACTIONS, V7_TREASURY_AUDIT_ACTIONS, CONTRACT_ACTION_DOMAINS,
} from './audit-actions.constant';
import { AuditCorrelationMode } from '../dto/audit-log.dto';

const N = AuditCorrelationMode.NONE;
const I = AuditCorrelationMode.INHERIT;

describe('戊波二 · 公司调拨单审计七码（spec §4.2）', () => {
  it('七码全在新名册（键集恰 7），域 TREASURY 已入合同，平面表同名同值', () => {
    expect(CONTRACT_ACTION_DOMAINS).toContain('TREASURY');
    expect(Object.keys(CAMPAIGN_E_HOUSE_TRANSFER_AUDIT_ACTIONS).sort()).toEqual([
      'HOUSE_TRANSFER_CANCELLED', 'HOUSE_TRANSFER_EXECUTION_STARTED', 'HOUSE_TRANSFER_FAILED',
      'HOUSE_TRANSFER_LEG_POSTED', 'HOUSE_TRANSFER_REJECTED', 'HOUSE_TRANSFER_REQUESTED', 'HOUSE_TRANSFER_SETTLED',
    ]);
    for (const k of Object.keys(CAMPAIGN_E_HOUSE_TRANSFER_AUDIT_ACTIONS)) expect((AuditActions as any)[k]).toBe(k);
  });

  it('四属性冻结：提交起旅程 NONE，其余继承；批准 / 拒绝带审批因果；全部域 TREASURY', () => {
    const A = CAMPAIGN_E_HOUSE_TRANSFER_AUDIT_ACTIONS;
    expect(A.HOUSE_TRANSFER_REQUESTED).toEqual({ domain: 'TREASURY', correlationMode: N, requiredFields: ['amount', 'reason'], requiresCausation: false });
    expect(A.HOUSE_TRANSFER_CANCELLED).toEqual({ domain: 'TREASURY', correlationMode: I, requiredFields: ['reason'], requiresCausation: false });
    expect(A.HOUSE_TRANSFER_REJECTED).toEqual({ domain: 'TREASURY', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true });
    expect(A.HOUSE_TRANSFER_EXECUTION_STARTED).toEqual({ domain: 'TREASURY', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true });
    expect(A.HOUSE_TRANSFER_LEG_POSTED).toEqual({ domain: 'TREASURY', correlationMode: I, requiredFields: ['amount'], requiresCausation: false });
    expect(A.HOUSE_TRANSFER_SETTLED).toEqual({ domain: 'TREASURY', correlationMode: I, requiredFields: ['amount', 'effectiveDate'], requiresCausation: false });
    expect(A.HOUSE_TRANSFER_FAILED).toEqual({ domain: 'TREASURY', correlationMode: I, requiredFields: ['reasonCode'], requiresCausation: false });
  });

  it('四属性逐码等于划转单 V7 同名后缀码（调拨单状态机抄划转单原样，审计形制同步）', () => {
    for (const suffix of ['REQUESTED', 'CANCELLED', 'REJECTED', 'EXECUTION_STARTED', 'LEG_POSTED', 'SETTLED', 'FAILED']) {
      expect(CAMPAIGN_E_HOUSE_TRANSFER_AUDIT_ACTIONS[`HOUSE_TRANSFER_${suffix}`]).toEqual(V7_TREASURY_AUDIT_ACTIONS[`INTERNAL_TRANSFER_${suffix}`]);
    }
  });

  it('主体与 workflow 类型已登记，业务键叫 HOUSE_TRANSFER', () => {
    expect(AuditEntityTypes.HOUSE_TRANSFER).toBe('HOUSE_TRANSFER');
    expect(AuditBusinessWorkflowTypes.HOUSE_TRANSFER).toBe('HOUSE_TRANSFER');
  });
});
