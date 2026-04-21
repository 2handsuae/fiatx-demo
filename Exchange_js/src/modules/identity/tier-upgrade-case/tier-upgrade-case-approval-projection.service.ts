import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ApprovalEvents,
  ApprovalDecisionEvent,
} from '../../governance/approvals/constants/approval.constants';
import { TierUpgradeCaseService } from './tier-upgrade-case.service';

const TIER_UPGRADE_ACTION_TYPES = ['RISK_RATING_TIER_UPGRADE_APPROVAL'];

@Injectable()
export class TierUpgradeCaseApprovalProjectionService {
  private readonly logger = new Logger(TierUpgradeCaseApprovalProjectionService.name);

  constructor(private readonly tierUpgradeCaseService: TierUpgradeCaseService) {}

  @OnEvent(ApprovalEvents.APPROVED, { async: true })
  async onApproved(event: ApprovalDecisionEvent) {
    return this.handleEvent(event);
  }

  @OnEvent(ApprovalEvents.REJECTED, { async: true })
  async onRejected(event: ApprovalDecisionEvent) {
    return this.handleEvent(event);
  }

  private async handleEvent(event: ApprovalDecisionEvent) {
    try {
      if (!TIER_UPGRADE_ACTION_TYPES.includes(event.actionType)) return;
      if (!event.entityRef?.startsWith('tier_upgrade_case:')) return;

      const caseId = event.entityRef.replace('tier_upgrade_case:', '');
      await this.tierUpgradeCaseService.handleSignoffComplete(caseId, { status: event.status });
    } catch (err) {
      this.logger.error(
        `TierUpgradeCaseApprovalProjectionService.handleEvent failed for actionType=${event.actionType} entityRef=${event.entityRef}`,
        err,
      );
    }
  }
}
