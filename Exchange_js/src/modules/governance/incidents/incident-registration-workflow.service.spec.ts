import { IncidentRegistrationWorkflowService } from './incident-registration-workflow.service';
import { IncidentTypes as T } from './incident.constants';

const ops = { actorType: 'ADMIN' as const, userId: 'uuid-ops', userNo: 'ADM-OPS', roleCodes: ['OPS_OFFICER'] };

function makeWorkflow(incidentNo = 'INC1') {
  const incidents: any = { register: jest.fn(async () => ({ incidentNo, traceId: 'trace-1' })) };
  const dispositionLink: any = {
    attachIncident: jest.fn(async () => undefined),
    record: jest.fn(async () => ({ dispositionNo: 'RCD-DEFAULT' })),
  };
  const wf = new IncidentRegistrationWorkflowService(incidents, dispositionLink);
  return { wf, incidents, dispositionLink };
}

describe('IncidentRegistrationWorkflowService (Task 5, Rule 3 orchestration point)', () => {
  it('UNAUTHORIZED_OUTFLOW: after creation, writes the disposition line back with attachIncident(dispositionNo, incidentNo)', async () => {
    const { wf, incidents, dispositionLink } = makeWorkflow('INC1');
    const dto = { type: T.UNAUTHORIZED_OUTFLOW, title: 't', description: 'd', sourceCaseNo: 'REC1', sourceDispositionNo: 'RCD1' };
    const r = await wf.register(dto as any, ops);
    expect(r).toEqual({ incidentNo: 'INC1' });
    expect(incidents.register).toHaveBeenCalledWith(dto, ops);
    expect(dispositionLink.attachIncident).toHaveBeenCalledWith('RCD1', 'INC1');
  });

  it.each([T.LARGE_UNEXPLAINED, T.CLIENT_SHORTFALL, T.MANUAL])('%s: does not write back a disposition line (there is no such thing as dispositionNo here)', async (type) => {
    const { wf, dispositionLink } = makeWorkflow('INC2');
    await wf.register({ type, title: 't', description: 'd' } as any, ops);
    expect(dispositionLink.attachIncident).not.toHaveBeenCalled();
  });

  it('when IncidentService.register validation fails, attachIncident is not created (the exception passes straight through, not swallowed)', async () => {
    const { wf, incidents, dispositionLink } = makeWorkflow();
    incidents.register.mockRejectedValueOnce(new Error('An unauthorized-outflow incident requires a source case number and disposition line number'));
    await expect(wf.register({ type: T.UNAUTHORIZED_OUTFLOW, title: 't', description: 'd' } as any, ops)).rejects.toThrow(/source case number and disposition line number/);
    expect(dispositionLink.attachIncident).not.toHaveBeenCalled();
  });

  // ── 平账三期 Task 3 续作：事故路原子落定性（控制方拍板提案 1）──────────────
  it('UNAUTHORIZED_OUTFLOW atomic path: without sourceDispositionNo but with explainedExternalLineId+findingNote, records the finding first, then registers the incident against the new dispositionNo and attaches it back', async () => {
    const { wf, incidents, dispositionLink } = makeWorkflow('INC3');
    dispositionLink.record = jest.fn(async () => ({ dispositionNo: 'RCD-NEW' }));
    const dto = {
      type: T.UNAUTHORIZED_OUTFLOW, title: 't', description: 'd',
      sourceCaseNo: 'REC9', explainedExternalLineId: 'EXT-1', findingNote: 'found it',
    };
    const r = await wf.register(dto as any, ops);
    expect(r).toEqual({ incidentNo: 'INC3' });
    expect(dispositionLink.record).toHaveBeenCalledWith(
      {
        caseNo: 'REC9', matchType: 'ORPHAN_EXTERNAL', explainedExternalLineId: 'EXT-1',
        causeCode: 'UNAUTHORIZED_OUTFLOW', disposition: 'INCIDENT', findingNote: 'found it',
      },
      ops,
    );
    expect(incidents.register).toHaveBeenCalledWith(
      expect.objectContaining({ ...dto, sourceDispositionNo: 'RCD-NEW' }),
      ops,
    );
    expect(dispositionLink.attachIncident).toHaveBeenCalledWith('RCD-NEW', 'INC3');
  });

  it('UNAUTHORIZED_OUTFLOW: neither sourceDispositionNo nor explainedExternalLineId+findingNote present — record() is never called, falls straight through to the original 400', async () => {
    const { wf, incidents, dispositionLink } = makeWorkflow();
    incidents.register.mockRejectedValueOnce(new Error('An unauthorized-outflow incident requires a source case number and disposition line number'));
    await expect(
      wf.register({ type: T.UNAUTHORIZED_OUTFLOW, title: 't', description: 'd', sourceCaseNo: 'REC1' } as any, ops),
    ).rejects.toThrow(/source case number and disposition line number/);
    expect(dispositionLink.record).not.toHaveBeenCalled();
    expect(dispositionLink.attachIncident).not.toHaveBeenCalled();
  });

  // 评审修复（Important 2）：explainedExternalLineId+findingNote 齐了，但 sourceCaseNo
  // 缺——原子路的守卫此前没查这一项，会把 caseNo: undefined 喂进 dispositionLink.record()
  // 炸出裸错误；补上合取后应落回既有的干净 400，record() 绝不能被调用。
  it('UNAUTHORIZED_OUTFLOW atomic path: explainedExternalLineId+findingNote present but sourceCaseNo missing — record() is never called, falls straight through to the original 400', async () => {
    const { wf, incidents, dispositionLink } = makeWorkflow();
    incidents.register.mockRejectedValueOnce(new Error('An unauthorized-outflow incident requires a source case number and disposition line number'));
    await expect(
      wf.register({ type: T.UNAUTHORIZED_OUTFLOW, title: 't', description: 'd', explainedExternalLineId: 'EXT-1', findingNote: 'found it' } as any, ops),
    ).rejects.toThrow(/source case number and disposition line number/);
    expect(dispositionLink.record).not.toHaveBeenCalled();
    expect(dispositionLink.attachIncident).not.toHaveBeenCalled();
  });
});
