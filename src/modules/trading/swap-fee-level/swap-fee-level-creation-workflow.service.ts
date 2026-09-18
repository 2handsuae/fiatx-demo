import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';
import { SwapFeeLevelService } from './swap-fee-level.service';
import { FeeLevelCreationWorkflowBase, FeeLevelCreationDtoBase } from '../shared/fee-level-workflow.base';

const SECONDARY_EVENT = 'workflow.swap-fee-level-creation.decided';

type SwapFeeLevelCreateDto = FeeLevelCreationDtoBase & {
  fromAssetId: string;
  toAssetId: string;
};

@Injectable()
export class SwapFeeLevelCreationWorkflowService extends FeeLevelCreationWorkflowBase<SwapFeeLevelCreateDto> {
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
    return ApprovalActionTypes.SWAP_FEE_LEVEL_CREATION;
  }

  protected get domainLabel() {
    return 'Swap';
  }

  protected get levelModel() {
    return this.prisma.swapFeeLevel;
  }

  protected assetFields(source: any) {
    return { fromAssetId: source.fromAssetId, toAssetId: source.toAssetId };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async onDecided(payload: any) {
    return this.onDecidedCore(payload);
  }
}
