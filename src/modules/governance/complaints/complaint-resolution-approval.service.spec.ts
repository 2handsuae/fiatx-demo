// 战役甲波五 T4（承接项A）：投诉裁决审批 handler——照 incident-approval.service.spec.ts
// 的形状测最小行为合同（actionType 精确过滤 + 派生二级事件名）。
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ComplaintResolutionApprovalService } from './complaint-resolution-approval.service';

describe('ComplaintResolutionApprovalService (Task 4 承接项A)', () => {
  it('claims COMPLAINT_RESOLUTION on the shared COMPLAINT workflowType', () => {
    const emitter = new EventEmitter2();
    const svc = new ComplaintResolutionApprovalService(emitter);
    expect(svc.actionType).toBe('COMPLAINT_RESOLUTION');
    expect(svc.workflowType).toBe('COMPLAINT');
  });

  it('does not act on a decision that is not its own actionType', async () => {
    const emitter = new EventEmitter2();
    const svc = new ComplaintResolutionApprovalService(emitter);
    const spy = jest.spyOn(emitter, 'emitAsync');
    await svc.handleApproved({ actionType: 'RI_REPLACEMENT', entityRef: 'CMP1' } as any);
    expect(spy).not.toHaveBeenCalled();
  });

  it('an APPROVED decision emits the registered second-order event workflow.complaint.decided (domain-events.constants.ts COMPLAINT_RESOLUTION_DECIDED)', async () => {
    const emitter = new EventEmitter2();
    const svc = new ComplaintResolutionApprovalService(emitter);
    const spy = jest.spyOn(emitter, 'emitAsync');
    await svc.handleApproved({ actionType: 'COMPLAINT_RESOLUTION', entityRef: 'CMP1', approvalId: 'A1', approvalNo: 'APR-CMP-1', traceId: 'T1' } as any);
    expect(spy).toHaveBeenCalledWith('workflow.complaint.decided', expect.objectContaining({ decision: 'APPROVED', entityRef: 'CMP1' }));
  });
});
