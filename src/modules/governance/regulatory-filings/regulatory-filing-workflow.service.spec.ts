import { BadRequestException } from '@nestjs/common';
import { RegulatoryFilingWorkflowService } from './regulatory-filing-workflow.service';
import { FilingStatus } from './regulatory-filing.constants';

const officer = { actorType: 'ADMIN' as const, userId: 'uuid-officer', userNo: 'ADM-CO', roleCodes: ['COMPLIANCE_OFFICER'] };

function makeWorkflow(rowOverrides: Partial<Record<string, any>> = {}) {
  const row = {
    id: 'uuid-fil', filingNo: 'FIL1', type: 'INCIDENT_REPORT', direction: 'OUTBOUND',
    authority: 'VARA', ccAuthorities: null, basisCode: 'BASIS_CODE_1', incidentNo: 'INC1',
    title: 'Incident report to regulator — INC1', deadlineAt: new Date('2026-10-01T00:00:00.000Z'),
    body: 'Filing body text', status: FilingStatus.DRAFT, traceId: 'trace-1',
    ...rowOverrides,
  };
  const filings: any = {
    findByNo: jest.fn(async () => row),
    markSignoffRequested: jest.fn(async () => undefined),
    applySignoffDecision: jest.fn(async () => undefined),
  };
  const approvals: any = { createAndSubmit: jest.fn(async () => ({ approvalNo: 'APR-1' })) };
  const wf = new RegulatoryFilingWorkflowService(filings, approvals);
  return { wf, filings, approvals, row };
}

describe('RegulatoryFilingWorkflowService (Task 4)', () => {
  describe('submitForSignoff', () => {
    it('DRAFT + non-empty body → createAndSubmit receives actionType/entityRef/objectSnapshot (zero UUID, human impact string) + markSignoffRequested is called', async () => {
      const { wf, filings, approvals } = makeWorkflow();
      const result = await wf.submitForSignoff('FIL1', officer);
      expect(result).toEqual({ filingNo: 'FIL1', approvalNo: 'APR-1' });

      const call = approvals.createAndSubmit.mock.calls[0][0];
      expect(call.actionType).toBe('REG_FILING_SUBMIT');
      expect(call.entityRef).toBe('FIL1');
      expect(call.traceId).toBe('trace-1');
      expect(call.objectSnapshot).toEqual({
        filingNo: 'FIL1', type: 'INCIDENT_REPORT', direction: 'OUTBOUND', authority: 'VARA',
        ccAuthorities: [], basisCode: 'BASIS_CODE_1', incidentNo: 'INC1',
        deadlineAt: '2026-10-01T00:00:00.000Z', title: 'Incident report to regulator — INC1',
        impact: 'Submitting Incident report to regulator to VARA (Dubai Virtual Assets Regulatory Authority) for incident INC1, statutory deadline 2026-10-01T00:00:00.000Z',
      });
      expect(JSON.stringify(call.objectSnapshot)).not.toMatch(/uuid-/);

      expect(filings.markSignoffRequested).toHaveBeenCalledWith('FIL1', 'APR-1', officer);
    });

    it('ccAuthorities present → split into an array in the snapshot', async () => {
      const { wf, approvals } = makeWorkflow({ ccAuthorities: 'UAE_FIU,EOCN' });
      await wf.submitForSignoff('FIL1', officer);
      expect(approvals.createAndSubmit.mock.calls[0][0].objectSnapshot.ccAuthorities).toEqual(['UAE_FIU', 'EOCN']);
    });

    it('no incidentNo / no deadlineAt → impact omits both trailing clauses', async () => {
      const { wf, approvals } = makeWorkflow({ incidentNo: null, deadlineAt: null, basisCode: null, type: 'MATERIAL_CHANGE_NOTIFICATION' });
      await wf.submitForSignoff('FIL1', officer);
      const impact = approvals.createAndSubmit.mock.calls[0][0].objectSnapshot.impact;
      expect(impact).toBe('Submitting Material change notification to VARA (Dubai Virtual Assets Regulatory Authority)');
    });

    it.each([
      ['empty string', ''],
      ['whitespace only', '   '],
      ['null', null],
    ])('body is %s → BadRequest, approvals untouched, markSignoffRequested untouched', async (_label, body) => {
      const { wf, filings, approvals } = makeWorkflow({ body });
      await expect(wf.submitForSignoff('FIL1', officer)).rejects.toThrow(BadRequestException);
      expect(approvals.createAndSubmit).not.toHaveBeenCalled();
      expect(filings.markSignoffRequested).not.toHaveBeenCalled();
    });

    it.each([
      [FilingStatus.PENDING_SIGNOFF],
      [FilingStatus.SIGNED_OFF],
      [FilingStatus.SUBMITTED],
      [FilingStatus.CLOSED],
      [FilingStatus.CANCELLED],
    ])('status %s (not DRAFT) → BadRequest, approvals untouched', async (status) => {
      const { wf, approvals } = makeWorkflow({ status });
      await expect(wf.submitForSignoff('FIL1', officer)).rejects.toThrow(BadRequestException);
      expect(approvals.createAndSubmit).not.toHaveBeenCalled();
    });
  });

  // 区别于事故先例（incident-close-workflow.onDecided 只吃 APPROVED）：报送被驳回要回
  // 草拟（spec §3），四种 decision 全部转发给 applySignoffDecision，不在 workflow 层挑拣。
  describe('onDecided — forwards all four decisions to applySignoffDecision (spec §3)', () => {
    it.each([
      ['APPROVED', null],
      ['DECLINED', 'Not ready for signoff'],
      ['CANCELLED', null],
      ['EXPIRED', null],
    ])('%s → applySignoffDecision(entityRef, decision, event) is called', async (decision, decisionReason) => {
      const { wf, filings } = makeWorkflow();
      await wf.onDecided({
        decision, actionType: 'REG_FILING_SUBMIT', entityRef: 'FIL1',
        approvalId: 'A1', approvalNo: 'APR-1', traceId: 'trace-1', workflowType: 'REGULATORY_FILING',
        decisionReason, metadata: {},
      } as any);
      expect(filings.applySignoffDecision).toHaveBeenCalledWith('FIL1', decision, {
        approvalNo: 'APR-1', approvalId: 'A1', decisionReason,
      });
    });
  });
});
