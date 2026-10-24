import { AuditActions, AuditBusinessWorkflowTypes, AuditEntityTypes, CONTRACT_ACTION_DOMAINS, LP_ADDRESS_AUDIT_ACTIONS } from './audit-actions.constant';
import { AuditCorrelationMode } from '../dto/audit-log.dto';

const S = AuditCorrelationMode.START;
const I = AuditCorrelationMode.INHERIT;

describe('LP 两步准入 T4 · LP 打款地址审计九码（四属性冻结）', () => {
  it('九码全在 LP_ADDRESS_AUDIT_ACTIONS，与平面表同名一一对应；主体类型与 workflowType 已登记', () => {
    expect(CONTRACT_ACTION_DOMAINS).toContain('TREASURY');
    expect(Object.keys(LP_ADDRESS_AUDIT_ACTIONS).sort()).toEqual([
      'LP_ADDRESS_APPROVED', 'LP_ADDRESS_CANCELLED', 'LP_ADDRESS_DEACTIVATED', 'LP_ADDRESS_LABEL_UPDATED', 'LP_ADDRESS_REACTIVATED',
      'LP_ADDRESS_REGISTERED', 'LP_ADDRESS_REJECTED', 'LP_ADDRESS_SCREENED', 'LP_ADDRESS_SUSPENDED',
    ]);
    for (const k of Object.keys(LP_ADDRESS_AUDIT_ACTIONS)) expect((AuditActions as any)[k]).toBe(k);
    expect(AuditEntityTypes.LP_ADDRESS).toBe('LP_ADDRESS');
    expect(AuditBusinessWorkflowTypes.LP_ADDRESS).toBe('LP_ADDRESS');
  });

  it('四属性冻结：REGISTERED 起地址旅程（START）；批准由审批驱动（必填 approvalNo + 必带 causation）；拒绝 / 撤回 / 启停退只要 reason；改标签要前后值', () => {
    const T = 'TREASURY';
    expect(LP_ADDRESS_AUDIT_ACTIONS.LP_ADDRESS_REGISTERED).toEqual({ domain: T, correlationMode: S, requiredFields: ['afterData'], requiresCausation: false });
    expect(LP_ADDRESS_AUDIT_ACTIONS.LP_ADDRESS_SCREENED).toEqual({ domain: T, correlationMode: I, requiredFields: ['afterData'], requiresCausation: false });
    expect(LP_ADDRESS_AUDIT_ACTIONS.LP_ADDRESS_APPROVED).toEqual({ domain: T, correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true });
    // REJECTED 有三个出处（CFO 驳回 / 登记 RED 落点 / ⚡喂 RED），后两者无审批单——故只绑 reason，不强制 approvalNo / causation
    expect(LP_ADDRESS_AUDIT_ACTIONS.LP_ADDRESS_REJECTED).toEqual({ domain: T, correlationMode: I, requiredFields: ['reason'], requiresCausation: false });
    for (const code of ['LP_ADDRESS_CANCELLED', 'LP_ADDRESS_SUSPENDED', 'LP_ADDRESS_REACTIVATED', 'LP_ADDRESS_DEACTIVATED']) {
      expect(LP_ADDRESS_AUDIT_ACTIONS[code]).toEqual({ domain: T, correlationMode: I, requiredFields: ['reason'], requiresCausation: false });
    }
    expect(LP_ADDRESS_AUDIT_ACTIONS.LP_ADDRESS_LABEL_UPDATED).toEqual({ domain: T, correlationMode: I, requiredFields: ['beforeData', 'afterData'], requiresCausation: false });
  });
});
