import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  IncidentCloseFinancialApprovalService,
  IncidentCloseSecurityApprovalService,
  IncidentCloseTechsecApprovalService,
  IncidentClosePrudentialApprovalService,
} from './incident-approval.service';

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

  // 战役甲波一 T8 修复轮 1（评审 M3）：两个新 handler（Task 8）此前没有 actionType/workflowType
  // 断言，逐字照抄上面一条的形状补上。
  it('the two Task 8 handlers (Techsec/Prudential) also only claim their own action type, same shared workflowType', () => {
    const emitter = new EventEmitter2();
    const techsec = new IncidentCloseTechsecApprovalService(emitter);
    const prudential = new IncidentClosePrudentialApprovalService(emitter);
    expect(techsec.actionType).toBe('INCIDENT_CLOSE_TECHSEC');
    expect(techsec.workflowType).toBe('INCIDENT');
    expect(prudential.actionType).toBe('INCIDENT_CLOSE_PRUDENTIAL');
    expect(prudential.workflowType).toBe('INCIDENT');
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
