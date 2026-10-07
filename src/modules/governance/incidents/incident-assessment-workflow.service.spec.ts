// 战役甲波二 · 事件联动（Task 6）：定损→自动开单编排点的单元测。
// 只测编排本身（谁先调谁、传什么参、reportRequired 分支是否触发开单）——assess() 自己的
// 判定校验/审计已在 incident.service.spec.ts 覆盖，openForIncident 的钟锚计算/开单审计
// 已在 regulatory-filing.service.spec.ts（Task 3）覆盖，本文件不重测。
import { IncidentAssessmentWorkflowService } from './incident-assessment-workflow.service';

const treasury = { actorType: 'ADMIN' as const, userId: 'uuid-treasury', userNo: 'ADM-TRS', roleCodes: ['TREASURY_OFFICER'] };

function makeWorkflow(o: Partial<Record<'assessResult' | 'incidentRow' | 'filingNos', any>> = {}) {
  const assessResult = o.assessResult ?? { incidentNo: 'INC1', status: 'ASSESSED' };
  const incidentRow = o.incidentRow ?? {
    incidentNo: 'INC1', type: 'UNAUTHORIZED_OUTFLOW', title: '疑似未授权转出',
    createdAt: new Date('2026-09-01T00:00:00.000Z'), customerNo: null, traceId: 'trace-1',
  };
  const incidents: any = {
    assess: jest.fn(async () => assessResult),
    findByNo: jest.fn(async () => incidentRow),
  };
  const filings: any = { openForIncident: jest.fn(async () => ({ filingNos: o.filingNos ?? ['FIL1', 'FIL2'] })) };
  const wf = new IncidentAssessmentWorkflowService(incidents, filings);
  return { wf, incidents, filings, incidentRow };
}

describe('IncidentAssessmentWorkflowService (甲波二 T6：定损→自动开单)', () => {
  it('①reportRequired=true + 两码 → IncidentService.assess 先跑判定留痕，再横向调 filings.openForIncident(row, 两码, actor)；filingsOpened 回传两单号', async () => {
    const { wf, incidents, filings, incidentRow } = makeWorkflow();
    const dto = { assessmentBasis: 'FIRM_LOSS', assessedAmount: '5000', reportRequired: true, reportBasisCodes: ['CLIENT_MONEY_DISCREPANCY', 'CLIENT_VA_DISCREPANCY'] };

    const r = await wf.assess('INC1', dto as any, treasury);

    expect(incidents.assess).toHaveBeenCalledWith('INC1', dto, treasury);
    expect(incidents.findByNo).toHaveBeenCalledWith('INC1');
    expect(filings.openForIncident).toHaveBeenCalledWith(incidentRow, ['CLIENT_MONEY_DISCREPANCY', 'CLIENT_VA_DISCREPANCY'], treasury);
    expect(r).toEqual({ incidentNo: 'INC1', status: 'ASSESSED', filingsOpened: ['FIL1', 'FIL2'] });
  });

  it('②reportRequired=false → 不查事故行、不调 openForIncident，filingsOpened 为空数组', async () => {
    const { wf, incidents, filings } = makeWorkflow();
    const dto = { assessmentBasis: 'NO_LOSS', assessedAmount: '0', reportRequired: false };

    const r = await wf.assess('INC1', dto as any, treasury);

    expect(incidents.assess).toHaveBeenCalledWith('INC1', dto, treasury);
    expect(incidents.findByNo).not.toHaveBeenCalled();
    expect(filings.openForIncident).not.toHaveBeenCalled();
    expect(r).toEqual({ incidentNo: 'INC1', status: 'ASSESSED', filingsOpened: [] });
  });

  it('reportRequired=true 但 reportBasisCodes 缺省 → 按空数组传给 openForIncident（brief 接口给的 ?? [] 兜底分支）', async () => {
    const { wf, filings, incidentRow } = makeWorkflow({ filingNos: [] });
    const dto = { assessmentBasis: 'FIRM_LOSS', assessedAmount: '10', reportRequired: true };

    const r = await wf.assess('INC1', dto as any, treasury);

    expect(filings.openForIncident).toHaveBeenCalledWith(incidentRow, [], treasury);
    expect(r.filingsOpened).toEqual([]);
  });
});
