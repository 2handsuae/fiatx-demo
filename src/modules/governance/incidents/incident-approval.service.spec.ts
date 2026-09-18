import { EventEmitter2 } from '@nestjs/event-emitter';
import { IncidentCloseFinancialApprovalService, IncidentCloseSecurityApprovalService } from './incident-approval.service';

describe('IncidentCloseSecurityApprovalService/IncidentCloseFinancialApprovalService (Task 7)', () => {
  it('each handler only claims its own action type, sharing one workflowType (feeding into the same second-order event)', () => {
    const emitter = new EventEmitter2();
    const security = new IncidentCloseSecurityApprovalService(emitter);
    const financial = new IncidentCloseFinancialApprovalService(emitter);
    expect(security.actionType).toBe('INCIDENT_CLOSE_SECURITY');
    expect(security.workflowType).toBe('INCIDENT');
    expect(financial.actionType).toBe('INCIDENT_CLOSE_FINANCIAL');
    expect(financial.workflowType).toBe('INCIDENT');
  });

  it('does not act on a decision that is not its own actionType (Security handler receives a Financial decision)', async () => {
    const emitter = new EventEmitter2();
    const security = new IncidentCloseSecurityApprovalService(emitter);
    const spy = jest.spyOn(emitter, 'emitAsync');
    await security.handleApproved({ actionType: 'INCIDENT_CLOSE_FINANCIAL', entityRef: 'INC1' } as any);
    expect(spy).not.toHaveBeenCalled();
  });

  it('decisions from both action types emit the same second-order event workflow.incident.decided', async () => {
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
