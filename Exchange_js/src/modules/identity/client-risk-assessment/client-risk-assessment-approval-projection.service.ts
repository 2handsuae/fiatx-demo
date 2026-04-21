import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ClientRiskAssessmentService } from './client-risk-assessment.service';
import {
  ApprovalEvents,
  ApprovalDecisionEvent,
} from '../../governance/approvals/constants/approval.constants';

const CRA_ACTION_TYPES = ['RISK_RATING_MLRO_REVIEW'];

@Injectable()
export class ClientRiskAssessmentApprovalProjectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly craService: ClientRiskAssessmentService,
  ) {}

  @OnEvent(ApprovalEvents.APPROVED, { async: true })
  async onApproved(event: ApprovalDecisionEvent) {
    return this.handleEvent(event);
  }

  @OnEvent(ApprovalEvents.REJECTED, { async: true })
  async onRejected(event: ApprovalDecisionEvent) {
    return this.handleEvent(event);
  }

  private async handleEvent(event: ApprovalDecisionEvent) {
    if (!CRA_ACTION_TYPES.includes(event.actionType)) return;
    if (!event.entityRef?.startsWith('client_risk_assessment:')) return;

    const assessmentId = event.entityRef.replace('client_risk_assessment:', '');
    await this.craService.handleSignoffComplete(assessmentId, {
      status: event.status,
    });
  }
}
