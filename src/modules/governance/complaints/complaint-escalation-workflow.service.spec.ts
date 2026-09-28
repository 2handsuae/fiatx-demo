// 战役甲波五 T4 · 投诉升级 workflow——铁律③只调 IncidentService.registerFromComplaint 与
// ComplaintsService.markEscalated，零直写零自己审计。行为化 mock（同 T3 ri-replacement/
// complaint-resolution-workflow 先例），不是无脑 resolve。
import { ComplaintEscalationWorkflowService } from './complaint-escalation-workflow.service';

const COMPLAINT_NO = 'CMP260101000001';
const INCIDENT_NO = 'INC260101000001';

function actorContext() {
  return { actorType: 'ADMIN' as const, userId: 'uuid-ops', userNo: 'ADM-OPS', role: 'OPS_OFFICER', roleCodes: ['OPS_OFFICER'] };
}

function buildDeps(o: { complaint?: any } = {}) {
  const complaint = o.complaint ?? {
    complaintNo: COMPLAINT_NO, ownerCustomerNo: 'CU1', subject: 'Order disputed', currentStatus: 'INVESTIGATING', escalatedIncidentNo: null,
  };
  const complaints = {
    findByNo: jest.fn().mockResolvedValue(complaint),
    markEscalated: jest.fn().mockResolvedValue({ complaintNo: COMPLAINT_NO }),
  } as any;
  const incidents = {
    registerFromComplaint: jest.fn().mockResolvedValue({ incidentNo: INCIDENT_NO }),
  } as any;

  const svc = new ComplaintEscalationWorkflowService(complaints, incidents);
  return { svc, complaints, incidents };
}

describe('ComplaintEscalationWorkflowService.escalate', () => {
  it('registers a COMPLAINT_ESCALATION incident from the complaint subject, then marks the complaint escalated with the new incidentNo', async () => {
    const { svc, complaints, incidents } = buildDeps();

    const result = await svc.escalate(actorContext(), COMPLAINT_NO);

    expect(result).toEqual({ incidentNo: INCIDENT_NO });

    // 顺序：先建事故单，拿到 incidentNo 才能回填投诉侧（markEscalated 第三参是它）。
    const registerOrder = incidents.registerFromComplaint.mock.invocationCallOrder[0];
    const markOrder = complaints.markEscalated.mock.invocationCallOrder[0];
    expect(registerOrder).toBeLessThan(markOrder);

    expect(incidents.registerFromComplaint).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'uuid-ops' }),
      { complaintNo: COMPLAINT_NO, ownerCustomerNo: 'CU1', title: `Complaint escalation — ${COMPLAINT_NO}`, description: 'Order disputed' },
    );
    expect(complaints.markEscalated).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'uuid-ops' }), COMPLAINT_NO, INCIDENT_NO,
    );
  });

  it('does not write to any table directly — only calls the two subject services (rule ③)', async () => {
    const { svc, complaints, incidents } = buildDeps();
    await svc.escalate(actorContext(), COMPLAINT_NO);
    expect(complaints.findByNo).toHaveBeenCalledTimes(1);
    expect(incidents.registerFromComplaint).toHaveBeenCalledTimes(1);
    expect(complaints.markEscalated).toHaveBeenCalledTimes(1);
  });

  // T2 守卫（ComplaintsService.markEscalated）：已升级过的投诉二次升级 400——workflow 不
  // 自己重复这条守卫（门只在 ComplaintsService 一处），只验证 workflow 把错误原样透传。
  it('propagates the T2 guard rejection when the complaint has already been escalated', async () => {
    const { svc, complaints } = buildDeps({
      complaint: { complaintNo: COMPLAINT_NO, ownerCustomerNo: 'CU1', subject: 'Order disputed', currentStatus: 'INVESTIGATING', escalatedIncidentNo: 'INC-OLD' },
    });
    complaints.markEscalated.mockRejectedValue(new Error(`Complaint ${COMPLAINT_NO} has already been escalated (INC-OLD)`));

    await expect(svc.escalate(actorContext(), COMPLAINT_NO)).rejects.toThrow(/already been escalated/);
  });
});
