import { EventEmitter2 } from '@nestjs/event-emitter';
import { IncidentCloseFinancialApprovalService, IncidentCloseSecurityApprovalService } from './incident-approval.service';

describe('IncidentCloseSecurityApprovalService/IncidentCloseFinancialApprovalService（Task 7）', () => {
  it('两个 handler 各只认领自己的动作类型，共用同一 workflowType（汇入同一二级事件）', () => {
    const emitter = new EventEmitter2();
    const security = new IncidentCloseSecurityApprovalService(emitter);
    const financial = new IncidentCloseFinancialApprovalService(emitter);
    expect(security.actionType).toBe('INCIDENT_CLOSE_SECURITY');
    expect(security.workflowType).toBe('INCIDENT');
    expect(financial.actionType).toBe('INCIDENT_CLOSE_FINANCIAL');
    expect(financial.workflowType).toBe('INCIDENT');
  });

  it('不是自己的 actionType 就不动手（Security handler 收到 Financial 的裁决）', async () => {
    const emitter = new EventEmitter2();
    const security = new IncidentCloseSecurityApprovalService(emitter);
    const spy = jest.spyOn(emitter, 'emitAsync');
    await security.handleApproved({ actionType: 'INCIDENT_CLOSE_FINANCIAL', entityRef: 'INC1' } as any);
    expect(spy).not.toHaveBeenCalled();
  });

  it('两条动作类型的裁决都派生同一个二级事件 workflow.incident.decided', async () => {
    const emitter = new EventEmitter2();
    const security = new IncidentCloseSecurityApprovalService(emitter);
    const financial = new IncidentCloseFinancialApprovalService(emitter);
    const spy = jest.spyOn(emitter, 'emitAsync');

    await security.handleApproved({ actionType: 'INCIDENT_CLOSE_SECURITY', entityRef: 'INC1', approvalId: 'A1', approvalNo: 'AC1', traceId: 'T1' } as any);
    await financial.handleApproved({ actionType: 'INCIDENT_CLOSE_FINANCIAL', entityRef: 'INC2', approvalId: 'A2', approvalNo: 'AC2', traceId: 'T2' } as any);

    expect(spy).toHaveBeenNthCalledWith(1, 'workflow.incident.decided', expect.objectContaining({ decision: 'APPROVED', entityRef: 'INC1' }));
    expect(spy).toHaveBeenNthCalledWith(2, 'workflow.incident.decided', expect.objectContaining({ decision: 'APPROVED', entityRef: 'INC2' }));
  });
});
