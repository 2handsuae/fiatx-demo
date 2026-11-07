import { AuditActions, V7_TREASURY_AUDIT_ACTIONS, CONTRACT_ACTION_DOMAINS } from './audit-actions.constant';
import { AuditCorrelationMode } from '../dto/audit-log.dto';

const N = AuditCorrelationMode.NONE;
const I = AuditCorrelationMode.INHERIT;

describe('平账二期 · 内部划转单审计（七码 + 戊波二 T7a 记短缺 = 八码，spec §10 / 戊波二 §4.1）', () => {
  it('八码全在 V7 财资名册，域 TREASURY 已入合同', () => {
    expect(CONTRACT_ACTION_DOMAINS).toContain('TREASURY');
    expect(Object.keys(V7_TREASURY_AUDIT_ACTIONS).sort()).toEqual([
      'INTERNAL_TRANSFER_CANCELLED', 'INTERNAL_TRANSFER_EXECUTION_STARTED', 'INTERNAL_TRANSFER_FAILED',
      'INTERNAL_TRANSFER_LEG_POSTED', 'INTERNAL_TRANSFER_REJECTED', 'INTERNAL_TRANSFER_REQUESTED', 'INTERNAL_TRANSFER_SETTLED',
      'INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED',
    ]);
    for (const k of Object.keys(V7_TREASURY_AUDIT_ACTIONS)) expect((AuditActions as any)[k]).toBe(k);
  });
  it('四属性冻结：提交起旅程 NONE，其余继承；批准 / 拒绝带审批因果', () => {
    expect(V7_TREASURY_AUDIT_ACTIONS.INTERNAL_TRANSFER_REQUESTED).toEqual({ domain: 'TREASURY', correlationMode: N, requiredFields: ['amount', 'reason'], requiresCausation: false });
    expect(V7_TREASURY_AUDIT_ACTIONS.INTERNAL_TRANSFER_CANCELLED).toEqual({ domain: 'TREASURY', correlationMode: I, requiredFields: ['reason'], requiresCausation: false });
    expect(V7_TREASURY_AUDIT_ACTIONS.INTERNAL_TRANSFER_REJECTED).toEqual({ domain: 'TREASURY', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true });
    expect(V7_TREASURY_AUDIT_ACTIONS.INTERNAL_TRANSFER_EXECUTION_STARTED).toEqual({ domain: 'TREASURY', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true });
    expect(V7_TREASURY_AUDIT_ACTIONS.INTERNAL_TRANSFER_LEG_POSTED).toEqual({ domain: 'TREASURY', correlationMode: I, requiredFields: ['amount'], requiresCausation: false });
    expect(V7_TREASURY_AUDIT_ACTIONS.INTERNAL_TRANSFER_SETTLED).toEqual({ domain: 'TREASURY', correlationMode: I, requiredFields: ['amount', 'effectiveDate'], requiresCausation: false });
    expect(V7_TREASURY_AUDIT_ACTIONS.INTERNAL_TRANSFER_FAILED).toEqual({ domain: 'TREASURY', correlationMode: I, requiredFields: ['reasonCode'], requiresCausation: false });
  });
  it('记短缺（码 91 落账）一码：继承旅程、必填金额与生效日、要审批因果', () => {
    expect(V7_TREASURY_AUDIT_ACTIONS.INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED).toEqual({ domain: 'TREASURY', correlationMode: I, requiredFields: ['amount', 'effectiveDate'], requiresCausation: true });
  });
});
