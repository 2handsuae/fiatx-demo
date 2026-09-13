import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';
import { SwapFeeLevelService } from './swap-fee-level.service';
import { FeeLevelChangeWorkflowBase } from '../shared/fee-level-workflow.base';

const SECONDARY_EVENT = 'workflow.swap-fee-level-change.decided';

@Injectable()
export class SwapFeeLevelChangeWorkflowService extends FeeLevelChangeWorkflowBase {
  constructor(
    prisma: PrismaService,
    feeLevelService: SwapFeeLevelService,
    approvalsService: ApprovalsService,
    auditLogsService: AuditLogsService,
  ) {
    super(prisma, feeLevelService, approvalsService, auditLogsService);
  }

  protected get entityType() {
    return AuditEntityTypes.SWAP_FEE_LEVEL;
  }

  protected get approvalActionType() {
    return ApprovalActionTypes.SWAP_FEE_LEVEL_CHANGE;
  }

  protected get domainLabel() {
    return 'Swap';
  }

  protected get changeRequestModel() {
    return this.prisma.swapFeeLevelChangeRequest;
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: any) {
    return this.onDecidedCore(event);
  }
}
