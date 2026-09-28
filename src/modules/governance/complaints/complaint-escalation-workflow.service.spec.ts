// 战役甲波五 T4 · 投诉升级 workflow——铁律③只调 IncidentService.registerFromComplaint 与
// ComplaintsService.markEscalated，零直写零自己审计。行为化 mock（同 T3 ri-replacement/
// complaint-resolution-workflow 先例），不是无脑 resolve。
import { BadRequestException } from '@nestjs/common';
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

  // 评审 Minor 5：原名「does not write to any table directly」说太满——本用例实际只断言
  // 调用次数（各一次），"不直写表" 这个真保证来自构造函数只注入 ComplaintsService/
  // IncidentService 两个服务（没有 PrismaService 可注入，编译期就不可能直写任何表）。
  it('calls each of the two subject services exactly once — the "no direct table write" guarantee is structural (constructor only injects ComplaintsService/IncidentService, no PrismaService)', async () => {
    const { svc, complaints, incidents } = buildDeps();
    await svc.escalate(actorContext(), COMPLAINT_NO);
    expect(complaints.findByNo).toHaveBeenCalledTimes(1);
    expect(incidents.registerFromComplaint).toHaveBeenCalledTimes(1);
    expect(complaints.markEscalated).toHaveBeenCalledTimes(1);
  });

  // 评审 Important 1（修复轮1）：原实现顺序是 findByNo→registerFromComplaint→markEscalated——
  // 二次升级 / RESOLVED 后升级虽然最终仍 400（T2 markEscalated 内部守卫），但事故单已经
  // 建好、审计已经写了（门拒了、门后副作用已发生），这单在事件列表可见、可结案，投诉侧却
  // 不回指它。单人顺序操作就能踩出这条路径，spec 把两条拒列为验收项，属于演示可见的缺陷。
  // 修法：findByNo 之后、registerFromComplaint 之前就做同一条件的预拦，不满足直接 400、
  // 不建单——不留孤儿事故。T2 的 markEscalated 守卫原样保留、不删，仍是权威判定（见下方
  // 「预拦放行后仍原样透传下游错误」用例）。
  it.each([
    ['投诉已终态 RESOLVED（不在两调查态）', { currentStatus: 'RESOLVED', escalatedIncidentNo: null }],
    ['投诉已升级过（escalatedIncidentNo 非空）', { currentStatus: 'INVESTIGATING', escalatedIncidentNo: 'INC-OLD' }],
  ])('预拦：%s → 400，不建事故单（registerFromComplaint 未调用）、不调 markEscalated', async (_label, overrides) => {
    const { svc, complaints, incidents } = buildDeps({
      complaint: { complaintNo: COMPLAINT_NO, ownerCustomerNo: 'CU1', subject: 'Order disputed', ...overrides },
    });

    await expect(svc.escalate(actorContext(), COMPLAINT_NO)).rejects.toThrow(BadRequestException);

    expect(incidents.registerFromComplaint).not.toHaveBeenCalled();
    expect(complaints.markEscalated).not.toHaveBeenCalled();
  });

  // 预拦放行（两调查态 + 未升级过）之后，T2 的 markEscalated 仍是权威判定——workflow 不
  // 吞掉它可能抛出的错误（证明预拦是"提前拦"，不是"取代下游守卫"）。
  it('propagates a downstream markEscalated rejection without swallowing it, even when the pre-check passes', async () => {
    const { svc, complaints } = buildDeps({
      complaint: { complaintNo: COMPLAINT_NO, ownerCustomerNo: 'CU1', subject: 'Order disputed', currentStatus: 'INVESTIGATING', escalatedIncidentNo: null },
    });
    complaints.markEscalated.mockRejectedValue(new Error('downstream guard rejected'));

    await expect(svc.escalate(actorContext(), COMPLAINT_NO)).rejects.toThrow(/downstream guard rejected/);
  });
});
