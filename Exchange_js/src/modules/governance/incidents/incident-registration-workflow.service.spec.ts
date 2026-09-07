import { IncidentRegistrationWorkflowService } from './incident-registration-workflow.service';
import { IncidentTypes as T } from './incident.constants';

const ops = { actorType: 'ADMIN' as const, userId: 'uuid-ops', userNo: 'ADM-OPS', roleCodes: ['OPS_OFFICER'] };

function makeWorkflow(incidentNo = 'INC1') {
  const incidents: any = { register: jest.fn(async () => ({ incidentNo, traceId: 'trace-1' })) };
  const dispositionLink: any = { attachIncident: jest.fn(async () => undefined) };
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
});
