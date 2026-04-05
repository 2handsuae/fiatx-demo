import { ApprovalSlaProjectionService } from './approval-sla-projection.service';
import { ApprovalActionTypes } from '../approvals/constants/approval.constants';

describe('ApprovalSlaProjectionService', () => {
  it('skips approval timeout timers for change ticket approvals', async () => {
    const slaTimersService = {
      ensureApprovalTimeoutTimer: jest.fn(),
      closeApprovalTimeoutTimer: jest.fn(),
    };

    const service = new ApprovalSlaProjectionService(slaTimersService as any);

    await service.onSubmitted({
      approvalId: 'approval-1',
      approvalNo: 'APR2604050001',
      actionType: ApprovalActionTypes.CHANGE_TICKET_APPROVAL,
      entityRef: 'ticket-1',
      traceId: 'trace-1',
      workflowType: 'ADMIN_MEMBER_PROVISIONING',
      workflowNo: 'CT2604050001',
      status: 'PENDING',
    });

    expect(slaTimersService.ensureApprovalTimeoutTimer).not.toHaveBeenCalled();
  });

  it('skips approval timeout timer closure for delete request approvals', async () => {
    const slaTimersService = {
      ensureApprovalTimeoutTimer: jest.fn(),
      closeApprovalTimeoutTimer: jest.fn(),
    };

    const service = new ApprovalSlaProjectionService(slaTimersService as any);

    await service.onApproved({
      approvalId: 'approval-1',
      approvalNo: 'APR2604050002',
      actionType: ApprovalActionTypes.DELETE_REQUEST_APPROVAL,
      entityRef: 'request-1',
      traceId: 'trace-2',
      workflowType: 'ADMIN_USER_DELETION',
      workflowNo: 'DR2604050001',
      status: 'APPROVED',
    });

    expect(slaTimersService.closeApprovalTimeoutTimer).not.toHaveBeenCalled();
  });

  it('skips approval timeout timers for audit evidence export approvals', async () => {
    const slaTimersService = {
      ensureApprovalTimeoutTimer: jest.fn(),
      closeApprovalTimeoutTimer: jest.fn(),
    };

    const service = new ApprovalSlaProjectionService(slaTimersService as any);

    await service.onSubmitted({
      approvalId: 'approval-1',
      approvalNo: 'APR2604050003',
      actionType: ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL,
      entityRef: 'pkg-1',
      traceId: 'trace-3',
      workflowType: 'AUDIT_EVIDENCE_EXPORT',
      workflowNo: 'EVP2604050001',
      status: 'PENDING',
    });

    await service.onApproved({
      approvalId: 'approval-1',
      approvalNo: 'APR2604050003',
      actionType: ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL,
      entityRef: 'pkg-1',
      traceId: 'trace-3',
      workflowType: 'AUDIT_EVIDENCE_EXPORT',
      workflowNo: 'EVP2604050001',
      status: 'APPROVED',
    });

    expect(slaTimersService.ensureApprovalTimeoutTimer).not.toHaveBeenCalled();
    expect(slaTimersService.closeApprovalTimeoutTimer).not.toHaveBeenCalled();
  });
});
