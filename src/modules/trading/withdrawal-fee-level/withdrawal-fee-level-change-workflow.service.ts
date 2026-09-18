import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';
import { WithdrawalFeeLevelService } from './withdrawal-fee-level.service';
import { FeeLevelChangeWorkflowBase } from '../shared/fee-level-workflow.base';

const SECONDARY_EVENT = 'workflow.withdrawal-fee-level-change.decided';

@Injectable()
export class WithdrawalFeeLevelChangeWorkflowService extends FeeLevelChangeWorkflowBase {
  constructor(
    prisma: PrismaService,
    feeLevelService: WithdrawalFeeLevelService,
    approvalsService: ApprovalsService,
    auditLogsService: AuditLogsService,
  ) {
    super(prisma, feeLevelService, approvalsService, auditLogsService);
  }

  protected get entityType() {
    return AuditEntityTypes.WITHDRAWAL_FEE_LEVEL;
  }

  protected get approvalActionType() {
    return ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_CHANGE;
  }

  protected get domainLabel() {
    return 'Withdrawal';
  }

  protected get changeRequestModel() {
    return this.prisma.withdrawalFeeLevelChangeRequest;
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: any) {
    return this.onDecidedCore(event);
  }
}
