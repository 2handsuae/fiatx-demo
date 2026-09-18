import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';
import { WithdrawalFeeLevelService } from './withdrawal-fee-level.service';
import { FeeLevelRetireWorkflowBase } from '../shared/fee-level-workflow.base';

// 二级"已裁决"事件名由 approval-handler.base.ts 按 workflowType 推导：workflow.<kebab>.decided
const SECONDARY_EVENT = 'workflow.withdrawal-fee-level-retire.decided';

/** "删" = 退役终态（spec §7）：CFO 提、运营批；最后一个 ACTIVE 默认档不可退。 */
@Injectable()
export class WithdrawalFeeLevelRetireWorkflowService extends FeeLevelRetireWorkflowBase {
  constructor(
    feeLevelService: WithdrawalFeeLevelService,
    approvalsService: ApprovalsService,
    auditLogsService: AuditLogsService,
  ) {
    super(feeLevelService, approvalsService, auditLogsService);
  }

  protected get entityType() {
    return AuditEntityTypes.WITHDRAWAL_FEE_LEVEL;
  }

  protected get approvalActionType() {
    return ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_RETIRE;
  }

  protected get domainLabel() {
    return 'Withdrawal';
  }

  protected assetFields(source: any) {
    return { assetId: source.assetId };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async onDecided(event: ApprovalDecidedEvent) {
    return this.onDecidedCore(event);
  }
}
