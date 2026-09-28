import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { IncidentRegistrationWorkflowService } from './incident-registration-workflow.service';
import { IncidentTypes as T } from './incident.constants';

const ops = { actorType: 'ADMIN' as const, userId: 'uuid-ops', userNo: 'ADM-OPS', roleCodes: ['OPS_OFFICER'] };

function makeWorkflow(incidentNo = 'INC1') {
  const incidents: any = {
    register: jest.fn(async () => ({ incidentNo, traceId: 'trace-1' })),
    // 甲波一 T5 修1（M1 修复）：register() 现在一开头就调 assertOperator——本文件测的是
    // 编排本身（定性行写回顺序），不重测断言行为，恒放行；M1 的失效路径单独一条用例覆盖。
    assertOperator: jest.fn(async () => undefined),
    // 战役甲波五 T4 修复轮1（评审 Minor 2）：人工登记拒绝清单门，恒放行——失效路径单独
    // 一条用例覆盖（见下方"manual registration rejection ... before assertOperator"）。
    assertManuallyRegistrable: jest.fn(() => undefined),
  };
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

  it.each([T.LARGE_UNEXPLAINED, T.CLIENT_SHORTFALL, T.CYBER_BCDR])('%s: does not write back a disposition line (there is no such thing as dispositionNo here)', async (type) => {
    const { wf, dispositionLink } = makeWorkflow('INC2');
    await wf.register({ type, title: 't', description: 'd' } as any, ops);
    expect(dispositionLink.attachIncident).not.toHaveBeenCalled();
  });

  // 评审修复（C1 挂接链）：大额升级路（案件页 Escalate to incident 带 sourceDispositionNo）
  // 此前从头到尾没人把事故号写到定性行上——attachIncident 的唯一调用点被
  // type===UNAUTHORIZED_OUTFLOW 罩死。放宽成「带了 sourceDispositionNo 就 attach」后，
  // LARGE_UNEXPLAINED 也要真正挂接。
  it('LARGE_UNEXPLAINED with sourceDispositionNo: after creation, also writes the disposition line back with attachIncident(dispositionNo, incidentNo) — C1 挂接链评审修复', async () => {
    const { wf, incidents, dispositionLink } = makeWorkflow('INC4');
    const dto = { type: T.LARGE_UNEXPLAINED, title: 't', description: 'd', sourceCaseNo: 'REC2', sourceDispositionNo: 'RCD2' };
    const r = await wf.register(dto as any, ops);
    expect(r).toEqual({ incidentNo: 'INC4' });
    expect(incidents.register).toHaveBeenCalledWith(dto, ops);
    expect(dispositionLink.attachIncident).toHaveBeenCalledWith('RCD2', 'INC4');
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

  // 甲波一 T5 修1（M1 修复）：断言前移到 workflow 开头——actor 不持经办能力时，必须在
  // dispositionLink.record()（落定性）之前就 403，不许先写一行永远等不到 incidentNo
  // 回填的孤儿定性行。
  it('actor lacks the operator capability: assertOperator rejects before any disposition write (M1, 防孤儿定性行)', async () => {
    const { wf, incidents, dispositionLink } = makeWorkflow();
    incidents.assertOperator.mockRejectedValueOnce(new ForbiddenException('no capability'));
    const dto = {
      type: T.UNAUTHORIZED_OUTFLOW, title: 't', description: 'd',
      sourceCaseNo: 'REC9', explainedExternalLineId: 'EXT-1', findingNote: 'found it',
    };
    await expect(wf.register(dto as any, ops)).rejects.toThrow(ForbiddenException);
    expect(dispositionLink.record).not.toHaveBeenCalled();
    expect(incidents.register).not.toHaveBeenCalled();
    expect(dispositionLink.attachIncident).not.toHaveBeenCalled();
  });

  // 评审修复（Minor 2，修复轮1）：人工登记拒绝清单（IncidentService.
  // assertManuallyRegistrable，COMPLAINT_ESCALATION 等）此前只挂在 IncidentService.register
  // 内部、在 assertOperator 之后才检查——HTTP 入口先经本 workflow 的 assertOperator（:47-48），
  // 一个不持经办能力的 actor 会先吃 403，永远到不了那条 400，等于清单对非运营 actor 从未真正
  // 生效。修法：workflow 在自己的 assertOperator 之前先调同一个门；本用例证明顺序——
  // assertOperator 被喂了会抛 403 的 mock，但因为清单门先拦，assertOperator 根本不会被调用，
  // 抛出的是 400 不是 403。
  it('manual registration rejection (assertManuallyRegistrable) is checked before assertOperator — a non-operator actor gets 400, not 403', async () => {
    const { wf, incidents, dispositionLink } = makeWorkflow();
    incidents.assertManuallyRegistrable = jest.fn(() => {
      throw new BadRequestException('Incident type COMPLAINT_ESCALATION cannot be registered manually — it is only created via complaint escalation');
    });
    incidents.assertOperator.mockRejectedValueOnce(new ForbiddenException('actor lacks capability'));

    await expect(wf.register({ type: T.COMPLAINT_ESCALATION, title: 't', description: 'd' } as any, ops)).rejects.toThrow(BadRequestException);

    expect(incidents.assertOperator).not.toHaveBeenCalled();
    expect(dispositionLink.record).not.toHaveBeenCalled();
    expect(incidents.register).not.toHaveBeenCalled();
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
