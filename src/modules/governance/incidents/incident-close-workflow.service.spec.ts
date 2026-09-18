import { BadRequestException } from '@nestjs/common';
import { IncidentCloseWorkflowService } from './incident-close-workflow.service';
import { IncidentStatus as S, IncidentTypes as T } from './incident.constants';

const treasury = { actorType: 'ADMIN' as const, userId: 'uuid-treasury', userNo: 'ADM-TRS', roleCodes: ['TREASURY_OFFICER'] };

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

describe('IncidentCloseWorkflowService (Task 7)', () => {
  describe('requestClose — preconditions', () => {
    it('REGISTERED → 400 (mutation target 1: removing this guard must turn this case red)', async () => {
      const { wf } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.REGISTERED, traceId: 't' } });
      await expect(wf.requestClose('INC1', treasury)).rejects.toThrow(BadRequestException);
    });

    it('INVESTIGATING → 400 (mutation target 1)', async () => {
      const { wf } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.INVESTIGATING, traceId: 't' } });
      await expect(wf.requestClose('INC1', treasury)).rejects.toThrow(BadRequestException);
    });

    it('CLOSED (already terminal) → 400', async () => {
      const { wf } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.CLOSED, traceId: 't' } });
      await expect(wf.requestClose('INC1', treasury)).rejects.toThrow(BadRequestException);
    });

    it('ASSESSED but assessment basis is not NO_LOSS → 400 (must enter Resolving first)', async () => {
      const { wf } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.ASSESSED, assessmentBasis: 'FIRM_LOSS', traceId: 't' } });
      await expect(wf.requestClose('INC1', treasury)).rejects.toThrow(/enter Resolving/);
    });

    it('ASSESSED and NO_LOSS but already has remediation linked → 400', async () => {
      const { wf } = makeWorkflow({
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.ASSESSED, assessmentBasis: 'NO_LOSS', traceId: 't' },
        remediations: ['ADJ1'],
      });
      await expect(wf.requestClose('INC1', treasury)).rejects.toThrow(/enter Resolving/);
    });

    it('ASSESSED + NO_LOSS + zero remediation → allowed (the CLOSE_NO_ACTION path)', async () => {
      const { wf } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.ASSESSED, assessmentBasis: 'NO_LOSS', reportRequired: false, traceId: 't' } });
      await expect(wf.requestClose('INC1', treasury)).resolves.toBeDefined();
    });

    it('RESOLVING → allowed (assessmentBasis/remediation links are not checked)', async () => {
      const { wf } = makeWorkflow({
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.RESOLVING, assessmentBasis: 'FIRM_LOSS', reportRequired: false, traceId: 't' },
        remediations: ['ADJ1'],
      });
      await expect(wf.requestClose('INC1', treasury)).resolves.toBeDefined();
    });

    it('reportRequired=true but not yet markReported → 400 (cannot close without a reporting trace)', async () => {
      const { wf } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.RESOLVING, reportRequired: true, reportedAt: null, traceId: 't' } });
      await expect(wf.requestClose('INC1', treasury)).rejects.toThrow(/regulator reporting/);
    });

    it('reportRequired=true and already markReported → allowed', async () => {
      const { wf } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.RESOLVING, reportRequired: true, reportedAt: new Date(), traceId: 't' } });
      await expect(wf.requestClose('INC1', treasury)).resolves.toBeDefined();
    });
  });

  describe('requestClose — type → action type routing', () => {
    it('UNAUTHORIZED_OUTFLOW → INCIDENT_CLOSE_SECURITY', async () => {
      const { wf, approvals } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.UNAUTHORIZED_OUTFLOW, status: S.RESOLVING, traceId: 't' } });
      await wf.requestClose('INC1', treasury);
      expect(approvals.createAndSubmit.mock.calls[0][0].actionType).toBe('INCIDENT_CLOSE_SECURITY');
    });

    it.each([T.LARGE_UNEXPLAINED, T.CLIENT_SHORTFALL, T.MANUAL])('%s → INCIDENT_CLOSE_FINANCIAL', async (type) => {
      const { wf, approvals } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type, status: S.RESOLVING, traceId: 't' } });
      await wf.requestClose('INC1', treasury);
      expect(approvals.createAndSubmit.mock.calls[0][0].actionType).toBe('INCIDENT_CLOSE_FINANCIAL');
    });
  });

  describe('requestClose — objectSnapshot has zero UUIDs + markCloseRequested + audit', () => {
    it('happy path: objectSnapshot carries type/amount/assessment basis/remediation reference list/reported flag, no UUIDs', async () => {
      const { wf, approvals, incidents, auditLogs } = makeWorkflow({
        incidentRow: {
          id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.RESOLVING,
          assessmentBasis: 'CLIENT_COLLECTION', assessedAmount: { toString: () => '900' },
          reportRequired: true, reportedAt: new Date(), customerNo: 'CU1', sourceCaseNo: 'REC1', traceId: 'trace-9',
        },
        remediations: ['ITR9'],
      });
      const r = await wf.requestClose('INC1', treasury);
      expect(r).toEqual({ incidentNo: 'INC1', approvalNo: 'AC1' });

      const call = approvals.createAndSubmit.mock.calls[0][0];
      expect(call.entityRef).toBe('INC1');
      expect(call.traceId).toBe('trace-9');
      expect(call.objectSnapshot).toEqual({
        incidentNo: 'INC1', customerNo: 'CU1',
        type: T.CLIENT_SHORTFALL, amount: '900', assessmentBasis: 'CLIENT_COLLECTION',
        remediationReferenceNos: ['ITR9'], reported: true,
        impact: 'Closing incident INC1 (Client shortfall): Assessment: pursuing collection 900, 1 remediation item(s), reported to VARA',
      });
      expect(JSON.stringify(call.objectSnapshot)).not.toMatch(/uuid-/);

      expect(incidents.markCloseRequested).toHaveBeenCalledWith('INC1', 'AC1');
      const audit = auditLogs.recordByActor.mock.calls[0][0];
      expect(audit).toMatchObject({ action: 'INCIDENT_CLOSE_REQUESTED', approvalNo: 'AC1', correlationId: 'trace-9' });
    });

    it('an assessment row with assetCode → impact appends the currency (called out at final review: previously uncovered branch)', async () => {
      const { wf, approvals } = makeWorkflow({
        incidentRow: {
          id: 'uuid-inc', incidentNo: 'INC1', type: T.UNAUTHORIZED_OUTFLOW, status: S.RESOLVING,
          assessmentBasis: 'FIRM_LOSS', assessedAmount: { toString: () => '400' }, assetCode: 'USDT-TRON',
          reportRequired: false, reportedAt: null, customerNo: null, sourceCaseNo: 'REC1', traceId: 'trace-2',
        },
        remediations: ['ADJ2'],
      });
      await wf.requestClose('INC1', treasury);
      const call = approvals.createAndSubmit.mock.calls[0][0];
      expect(call.objectSnapshot.impact).toBe('Closing incident INC1 (Unauthorized outflow): Assessment: loss recognized 400 USDT-TRON, 1 remediation item(s), no reporting required');
    });
  });

  describe('onDecided — decision landing', () => {
    it('APPROVED → close() is called + INCIDENT_CLOSED audit (fromStatus/toStatus/approvalNo/causationId)', async () => {
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

    it('DECLINED → status left unchanged: close() is not called, no audit written', async () => {
      const { wf, incidents, auditLogs } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.RESOLVING, traceId: 'trace-1' } });
      await wf.onDecided({
        decision: 'DECLINED', actionType: 'INCIDENT_CLOSE_FINANCIAL', entityRef: 'INC1',
        approvalId: 'A1', approvalNo: 'AC1', traceId: 'trace-1', workflowType: 'INCIDENT', metadata: {},
      } as any);
      expect(incidents.close).not.toHaveBeenCalled();
      expect(auditLogs.recordSystem).not.toHaveBeenCalled();
      expect(auditLogs.recordByActor).not.toHaveBeenCalled();
    });

    it('EXPIRED/CANCELLED also leave status unchanged (anything but APPROVED is a no-op, no lookup)', async () => {
      const { wf, incidents } = makeWorkflow();
      await wf.onDecided({ decision: 'EXPIRED', entityRef: 'INC1' } as any);
      await wf.onDecided({ decision: 'CANCELLED', entityRef: 'INC1' } as any);
      expect(incidents.close).not.toHaveBeenCalled();
      expect(incidents.findByNo).not.toHaveBeenCalled();
    });
  });
});
