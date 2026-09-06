import { IncidentRegistrationWorkflowService } from './incident-registration-workflow.service';
import { IncidentTypes as T } from './incident.constants';

const ops = { actorType: 'ADMIN' as const, userId: 'uuid-ops', userNo: 'ADM-OPS', roleCodes: ['OPS_OFFICER'] };

function makeWorkflow(incidentNo = 'INC1') {
  const incidents: any = { register: jest.fn(async () => ({ incidentNo, traceId: 'trace-1' })) };
  const dispositionLink: any = { attachIncident: jest.fn(async () => undefined) };
  const wf = new IncidentRegistrationWorkflowService(incidents, dispositionLink);
  return { wf, incidents, dispositionLink };
}

describe('IncidentRegistrationWorkflowService（平账三期 Task 5 · 铁律③编排点）', () => {
  it('UNAUTHORIZED_OUTFLOW：建单后回写定性行 attachIncident(dispositionNo, incidentNo)', async () => {
    const { wf, incidents, dispositionLink } = makeWorkflow('INC1');
    const dto = { type: T.UNAUTHORIZED_OUTFLOW, title: 't', description: 'd', sourceCaseNo: 'REC1', sourceDispositionNo: 'RCD1' };
    const r = await wf.register(dto as any, ops);
    expect(r).toEqual({ incidentNo: 'INC1' });
    expect(incidents.register).toHaveBeenCalledWith(dto, ops);
    expect(dispositionLink.attachIncident).toHaveBeenCalledWith('RCD1', 'INC1');
  });

  it.each([T.LARGE_UNEXPLAINED, T.CLIENT_SHORTFALL, T.MANUAL])('%s：不回写定性行（没有 dispositionNo 这回事）', async (type) => {
    const { wf, dispositionLink } = makeWorkflow('INC2');
    await wf.register({ type, title: 't', description: 'd' } as any, ops);
    expect(dispositionLink.attachIncident).not.toHaveBeenCalled();
  });

  it('IncidentService.register 校验失败时不建 attachIncident（异常直接透传，不吞）', async () => {
    const { wf, incidents, dispositionLink } = makeWorkflow();
    incidents.register.mockRejectedValueOnce(new Error('未授权转出事故必须带来源案号与定性行号'));
    await expect(wf.register({ type: T.UNAUTHORIZED_OUTFLOW, title: 't', description: 'd' } as any, ops)).rejects.toThrow(/来源案号与定性行号/);
    expect(dispositionLink.attachIncident).not.toHaveBeenCalled();
  });
});
