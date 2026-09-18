import { AuditActions, INCIDENT_AUDIT_ACTIONS, CONTRACT_ACTION_DOMAINS } from './audit-actions.constant';
import { AuditCorrelationMode, AuditCategory } from '../dto/audit-log.dto';
import { AuditLogsService } from '../audit-logs.service';

const N = AuditCorrelationMode.NONE;
const S = AuditCorrelationMode.START;
const I = AuditCorrelationMode.INHERIT;

describe('平账三期 · 事故登记审计十一码（spec §7）', () => {
  it('十一码全在治理名册，域 GOVERNANCE 已入合同', () => {
    expect(CONTRACT_ACTION_DOMAINS).toContain('GOVERNANCE');
    expect(Object.keys(INCIDENT_AUDIT_ACTIONS).sort()).toEqual([
      'INCIDENT_ASSESSED',
      'INCIDENT_CLOSED',
      'INCIDENT_CLOSE_REQUESTED',
      'INCIDENT_ESCALATED',
      'INCIDENT_INVESTIGATION_STARTED',
      'INCIDENT_NOTE_ADDED',
      'INCIDENT_REGISTERED',
      'INCIDENT_REGULATOR_REPORTED',
      'INCIDENT_REGULATOR_REPORT_DRAFTED',
      'INCIDENT_REMEDIATION_LINKED',
      'INCIDENT_WITHDRAWN',
    ]);
    for (const k of Object.keys(INCIDENT_AUDIT_ACTIONS)) {
      expect((AuditActions as any)[k]).toBe(k);
    }
  });

  it('每码都声明了四件事（domain / correlationMode / requiredFields / requiresCausation）', () => {
    for (const k of Object.keys(INCIDENT_AUDIT_ACTIONS)) {
      const s = INCIDENT_AUDIT_ACTIONS[k];
      expect(s.domain).toBe('GOVERNANCE');
      expect(Object.values(AuditCorrelationMode)).toContain(s.correlationMode);
      expect(Array.isArray(s.requiredFields)).toBe(true);
      expect(typeof s.requiresCausation).toBe('boolean');
    }
  });

  it('四属性冻结：登记起旅程（S），结案两步继承并由裁决驱动因果（I），其余八个纯单步动作不伪造关联（N，二期判例）', () => {
    expect(INCIDENT_AUDIT_ACTIONS.INCIDENT_REGISTERED).toEqual({
      domain: 'GOVERNANCE', correlationMode: S, requiredFields: ['type'], requiresCausation: false,
    });
    expect(INCIDENT_AUDIT_ACTIONS.INCIDENT_INVESTIGATION_STARTED).toEqual({
      domain: 'GOVERNANCE', correlationMode: N, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false,
    });
    expect(INCIDENT_AUDIT_ACTIONS.INCIDENT_NOTE_ADDED).toEqual({
      domain: 'GOVERNANCE', correlationMode: N, requiredFields: ['body'], requiresCausation: false,
    });
    expect(INCIDENT_AUDIT_ACTIONS.INCIDENT_ESCALATED).toEqual({
      domain: 'GOVERNANCE', correlationMode: N, requiredFields: ['escalatedTo'], requiresCausation: false,
    });
    expect(INCIDENT_AUDIT_ACTIONS.INCIDENT_ASSESSED).toEqual({
      domain: 'GOVERNANCE', correlationMode: N, requiredFields: ['assessmentBasis'], requiresCausation: false,
    });
    expect(INCIDENT_AUDIT_ACTIONS.INCIDENT_REMEDIATION_LINKED).toEqual({
      domain: 'GOVERNANCE', correlationMode: N, requiredFields: ['referenceNo'], requiresCausation: false,
    });
    expect(INCIDENT_AUDIT_ACTIONS.INCIDENT_REGULATOR_REPORT_DRAFTED).toEqual({
      domain: 'GOVERNANCE', correlationMode: N, requiredFields: [], requiresCausation: false,
    });
    expect(INCIDENT_AUDIT_ACTIONS.INCIDENT_REGULATOR_REPORTED).toEqual({
      domain: 'GOVERNANCE', correlationMode: N, requiredFields: ['basisCodes'], requiresCausation: false,
    });
    expect(INCIDENT_AUDIT_ACTIONS.INCIDENT_CLOSE_REQUESTED).toEqual({
      domain: 'GOVERNANCE', correlationMode: I, requiredFields: [], requiresCausation: false,
    });
    expect(INCIDENT_AUDIT_ACTIONS.INCIDENT_CLOSED).toEqual({
      domain: 'GOVERNANCE', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true,
    });
    expect(INCIDENT_AUDIT_ACTIONS.INCIDENT_WITHDRAWN).toEqual({
      domain: 'GOVERNANCE', correlationMode: N, requiredFields: ['reason'], requiresCausation: false,
    });
  });

  it('二期 Critical 回归：走真 AuditLogsService.recordByActor 写 INCIDENT_NOTE_ADDED 缺必填字段 body 必须被拒——证明 assertActionSpec 的 ?? 链已接上（只登记常量不接链 = 免检静默放行）', async () => {
    const prisma: any = { auditLogEvent: { create: jest.fn(), findUnique: jest.fn() } };
    const service = new AuditLogsService(prisma);

    await expect(
      service.recordByActor(
        {
          action: AuditActions.INCIDENT_NOTE_ADDED,
          actionDomain: 'GOVERNANCE',
          category: AuditCategory.BUSINESS,
          primarySubjectType: 'INCIDENT',
          primarySubjectNo: 'INC1',
          correlationId: 'trace-inc-1',
          // 故意不带 body —— 这是 INCIDENT_NOTE_ADDED 的特有必填字段
        } as any,
        { actorType: 'ADMIN', actorNo: 'ops-1', actorDisplayName: 'ops-1' },
      ),
    ).rejects.toThrow(/missing required field.*body/i);

    expect(prisma.auditLogEvent.create).not.toHaveBeenCalled();
  });
});
