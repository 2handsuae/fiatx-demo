import { BadRequestException } from '@nestjs/common';
import { IncidentCloseWorkflowService } from './incident-close-workflow.service';
import { IncidentStatus as S, IncidentTypes as T } from './incident.constants';

const ops = { actorType: 'ADMIN' as const, userId: 'uuid-ops', userNo: 'ADM-OPS', roleCodes: ['OPS_OFFICER'] };

function makeWorkflow(o: Partial<Record<'incidentRow' | 'remediations', any>> = {}) {
  const incidentRow = o.incidentRow ?? {
    id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.ASSESSED,
    assessmentBasis: 'NO_LOSS', assessedAmount: null, reportRequired: false, reportedAt: null,
    customerNo: 'CU1', sourceCaseNo: 'REC1', traceId: 'trace-1',
  };
  const remediations = o.remediations ?? [];
  const incidents: any = {
    findByNo: jest.fn(async () => incidentRow),
    findRemediations: jest.fn(async () => remediations),
    markCloseRequested: jest.fn(async () => undefined),
    close: jest.fn(async () => ({ incidentNo: incidentRow.incidentNo, status: S.CLOSED })),
  };
  const approvals: any = { createAndSubmit: jest.fn(async () => ({ approvalNo: 'AC1' })) };
  const auditLogs: any = { recordByActor: jest.fn(async () => ({})), recordSystem: jest.fn(async () => ({})) };
  const wf = new IncidentCloseWorkflowService(incidents, approvals, auditLogs);
  return { wf, incidents, approvals, auditLogs, incidentRow };
}

describe('IncidentCloseWorkflowService（平账三期 Task 7）', () => {
  describe('requestClose —— 前置守卫', () => {
    it('REGISTERED → 400（变异靶子①：删掉这条守卫本用例必红）', async () => {
      const { wf } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.REGISTERED, traceId: 't' } });
      await expect(wf.requestClose('INC1', ops)).rejects.toThrow(BadRequestException);
    });

    it('INVESTIGATING → 400（变异靶子①）', async () => {
      const { wf } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.INVESTIGATING, traceId: 't' } });
      await expect(wf.requestClose('INC1', ops)).rejects.toThrow(BadRequestException);
    });

    it('CLOSED（已是终态）→ 400', async () => {
      const { wf } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.CLOSED, traceId: 't' } });
      await expect(wf.requestClose('INC1', ops)).rejects.toThrow(BadRequestException);
    });

    it('ASSESSED 但定损口径非 NO_LOSS → 400（须先进处置中）', async () => {
      const { wf } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.ASSESSED, assessmentBasis: 'FIRM_LOSS', traceId: 't' } });
      await expect(wf.requestClose('INC1', ops)).rejects.toThrow(/处置中/);
    });

    it('ASSESSED 且 NO_LOSS 但已挂善后单 → 400', async () => {
      const { wf } = makeWorkflow({
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.ASSESSED, assessmentBasis: 'NO_LOSS', traceId: 't' },
        remediations: ['ADJ1'],
      });
      await expect(wf.requestClose('INC1', ops)).rejects.toThrow(/处置中/);
    });

    it('ASSESSED + NO_LOSS + 零善后 → 放行（CLOSE_NO_ACTION 路）', async () => {
      const { wf } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.ASSESSED, assessmentBasis: 'NO_LOSS', reportRequired: false, traceId: 't' } });
      await expect(wf.requestClose('INC1', ops)).resolves.toBeDefined();
    });

    it('RESOLVING → 放行（不看 assessmentBasis/善后挂载）', async () => {
      const { wf } = makeWorkflow({
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.RESOLVING, assessmentBasis: 'FIRM_LOSS', reportRequired: false, traceId: 't' },
        remediations: ['ADJ1'],
      });
      await expect(wf.requestClose('INC1', ops)).resolves.toBeDefined();
    });

    it('reportRequired=true 而未 markReported → 400（通报没留痕不许关）', async () => {
      const { wf } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.RESOLVING, reportRequired: true, reportedAt: null, traceId: 't' } });
      await expect(wf.requestClose('INC1', ops)).rejects.toThrow(/通报/);
    });

    it('reportRequired=true 且已 markReported → 放行', async () => {
      const { wf } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.RESOLVING, reportRequired: true, reportedAt: new Date(), traceId: 't' } });
      await expect(wf.requestClose('INC1', ops)).resolves.toBeDefined();
    });
  });

  describe('requestClose —— 类型 → 动作类型路由', () => {
    it('UNAUTHORIZED_OUTFLOW → INCIDENT_CLOSE_SECURITY', async () => {
      const { wf, approvals } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.UNAUTHORIZED_OUTFLOW, status: S.RESOLVING, traceId: 't' } });
      await wf.requestClose('INC1', ops);
      expect(approvals.createAndSubmit.mock.calls[0][0].actionType).toBe('INCIDENT_CLOSE_SECURITY');
    });

    it.each([T.LARGE_UNEXPLAINED, T.CLIENT_SHORTFALL, T.MANUAL])('%s → INCIDENT_CLOSE_FINANCIAL', async (type) => {
      const { wf, approvals } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type, status: S.RESOLVING, traceId: 't' } });
      await wf.requestClose('INC1', ops);
      expect(approvals.createAndSubmit.mock.calls[0][0].actionType).toBe('INCIDENT_CLOSE_FINANCIAL');
    });
  });

  describe('requestClose —— objectSnapshot 零 UUID + markCloseRequested + 审计', () => {
    it('正路径：objectSnapshot 含类型/金额/定损口径/善后单号清单/是否已通报，无 UUID', async () => {
      const { wf, approvals, incidents, auditLogs } = makeWorkflow({
        incidentRow: {
          id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.RESOLVING,
          assessmentBasis: 'CLIENT_COLLECTION', assessedAmount: { toString: () => '900' },
          reportRequired: true, reportedAt: new Date(), customerNo: 'CU1', sourceCaseNo: 'REC1', traceId: 'trace-9',
        },
        remediations: ['ITR9'],
      });
      const r = await wf.requestClose('INC1', ops);
      expect(r).toEqual({ incidentNo: 'INC1', approvalNo: 'AC1' });

      const call = approvals.createAndSubmit.mock.calls[0][0];
      expect(call.entityRef).toBe('INC1');
      expect(call.traceId).toBe('trace-9');
      expect(call.objectSnapshot).toEqual({
        type: T.CLIENT_SHORTFALL, amount: '900', assessmentBasis: 'CLIENT_COLLECTION',
        remediationReferenceNos: ['ITR9'], reported: true,
      });
      expect(JSON.stringify(call.objectSnapshot)).not.toMatch(/uuid-/);

      expect(incidents.markCloseRequested).toHaveBeenCalledWith('INC1', 'AC1');
      const audit = auditLogs.recordByActor.mock.calls[0][0];
      expect(audit).toMatchObject({ action: 'INCIDENT_CLOSE_REQUESTED', approvalNo: 'AC1', correlationId: 'trace-9' });
    });
  });

  describe('onDecided —— 裁决落地', () => {
    it('APPROVED → close() 被调 + INCIDENT_CLOSED 审计（fromStatus/toStatus/approvalNo/causationId）', async () => {
      const { wf, incidents, auditLogs } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.RESOLVING, traceId: 'trace-1' } });
      await wf.onDecided({
        decision: 'APPROVED', actionType: 'INCIDENT_CLOSE_FINANCIAL', entityRef: 'INC1',
        approvalId: 'A1', approvalNo: 'AC1', traceId: 'trace-1', workflowType: 'INCIDENT',
        decisionByRole: 'CFO', metadata: {},
      } as any);
      expect(incidents.close).toHaveBeenCalledWith('INC1');
      const audit = auditLogs.recordSystem.mock.calls[0][0];
      expect(audit).toMatchObject({ action: 'INCIDENT_CLOSED', approvalNo: 'AC1', causationId: 'A1', fromStatus: S.RESOLVING, toStatus: S.CLOSED, correlationId: 'trace-1' });
    });

    it('DECLINED → 留原状态：close() 不被调，不写审计', async () => {
      const { wf, incidents, auditLogs } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.RESOLVING, traceId: 'trace-1' } });
      await wf.onDecided({
        decision: 'DECLINED', actionType: 'INCIDENT_CLOSE_FINANCIAL', entityRef: 'INC1',
        approvalId: 'A1', approvalNo: 'AC1', traceId: 'trace-1', workflowType: 'INCIDENT', metadata: {},
      } as any);
      expect(incidents.close).not.toHaveBeenCalled();
      expect(auditLogs.recordSystem).not.toHaveBeenCalled();
      expect(auditLogs.recordByActor).not.toHaveBeenCalled();
    });

    it('EXPIRED/CANCELLED 同样留原状态（非 APPROVED 一律 no-op，不查库）', async () => {
      const { wf, incidents } = makeWorkflow();
      await wf.onDecided({ decision: 'EXPIRED', entityRef: 'INC1' } as any);
      await wf.onDecided({ decision: 'CANCELLED', entityRef: 'INC1' } as any);
      expect(incidents.close).not.toHaveBeenCalled();
      expect(incidents.findByNo).not.toHaveBeenCalled();
    });
  });
});
