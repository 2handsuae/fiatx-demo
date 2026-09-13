import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';
import { WithdrawalFeeLevelService } from './withdrawal-fee-level.service';
import { FeeLevelCreationWorkflowBase, FeeLevelCreationDtoBase } from '../shared/fee-level-workflow.base';

const SECONDARY_EVENT = 'workflow.withdrawal-fee-level-creation.decided';

type WithdrawalFeeLevelCreateDto = FeeLevelCreationDtoBase & {
  assetId: string;
};

@Injectable()
export class WithdrawalFeeLevelCreationWorkflowService extends FeeLevelCreationWorkflowBase<WithdrawalFeeLevelCreateDto> {
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
    return ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_CREATION;
  }

  protected get domainLabel() {
    return 'Withdrawal';
  }

  protected get levelModel() {
    return this.prisma.withdrawalFeeLevel;
  }

  protected assetFields(source: any) {
    return { assetId: source.assetId };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async onDecided(payload: any) {
    return this.onDecidedCore(payload);
  }
}
