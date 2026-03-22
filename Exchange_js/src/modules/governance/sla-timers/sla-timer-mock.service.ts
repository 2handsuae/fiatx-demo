import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../approvals/constants/approval.constants';
import { ChangeTicketsService } from '../change-tickets/change-tickets.service';
import {
  ChangeTicketDeployStatuses,
  ChangeTicketReleaseEnvironments,
  ChangeTicketTypes,
} from '../change-tickets/constants/change-ticket.constants';
import { ReleaseGatesService } from '../change-tickets/release-gates.service';
import { SlaTimerStatuses, SlaTimerTypes } from './constants/sla-timer.constants';
import {
  MockApprovalTimeoutDto,
  MockChangeFollowUpDto,
} from './dto/sla-timer.dto';
import { SlaTimersService } from './sla-timers.service';

@Injectable()
export class SlaTimerMockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalsService: ApprovalsService,
    private readonly changeTicketsService: ChangeTicketsService,
    private readonly releaseGatesService: ReleaseGatesService,
    private readonly slaTimersService: SlaTimersService,
  ) {}

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length ? normalized : null;
  }

  private decisionBypassActor(actor: ApprovalActorContext): ApprovalActorContext {
    return {
      actorType: 'ADMIN',
      userId: actor.userId,
      userNo: actor.userNo,
      role: 'SUPER_ADMIN',
      roleCodes: ['SUPER_ADMIN'],
    };
  }

  private async findActiveTimerOrThrow(subjectId: string, timerType: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const found = await this.prisma.slaTimer.findFirst({
        where: {
          subjectId,
          timerType,
          status: SlaTimerStatuses.ACTIVE,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (found) {
        return found;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new NotFoundException(`Active SLA timer not found for ${timerType}:${subjectId}`);
  }

  async createApprovalTimeoutMock(dto: MockApprovalTimeoutDto, actor: ApprovalActorContext) {
    const approval = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.CHANGE_TICKET_APPROVAL,
        entityRef: `SLA-MOCK-APPROVAL-${randomUUID()}`,
        metadata: {
          mockMode: true,
          mockType: SlaTimerTypes.APPROVAL_TIMEOUT,
          requestedBy: actor.userId,
        },
        traceId: this.normalizeOptionalString(dto.traceId) || randomUUID(),
      },
      {
        reason:
          this.normalizeOptionalString(dto.reason) || 'SLA approval-timeout mock submitted',
      },
      actor,
    );

    const timer = await this.findActiveTimerOrThrow(
      approval.id,
      SlaTimerTypes.APPROVAL_TIMEOUT,
    );
    const recalculated = await this.slaTimersService.recalc(
      timer.id,
      {
        dueInSeconds: dto.dueInSeconds,
        graceSeconds: dto.graceSeconds,
        reason:
          this.normalizeOptionalString(dto.reason) ||
          'SLA approval-timeout mock recalculated',
        traceId: approval.traceId,
      },
      actor,
    );

    return recalculated;
  }

  async createChangeFollowUpMock(dto: MockChangeFollowUpDto, actor: ApprovalActorContext) {
    const traceId = this.normalizeOptionalString(dto.traceId) || randomUUID();
    const releaseVersion =
      this.normalizeOptionalString(dto.releaseVersion) || `demo-${Date.now()}`;
    const dueAt = new Date(
      Date.now() +
        (typeof dto.dueInSeconds === 'number' ? dto.dueInSeconds : 30) * 1000,
    );

    const ticket = await this.changeTicketsService.create(
      {
        changeType: ChangeTicketTypes.GOVERNANCE_POLICY_CHANGE,
        scopeSummary: 'SLA mock emergency follow-up change ticket',
        testEvidenceRef: 'DEMO-TEST-EVIDENCE',
        rollbackPlanRef: 'DEMO-ROLLBACK-PLAN',
        emergency: true,
        emergencyReason:
          this.normalizeOptionalString(dto.reason) || 'SLA mock emergency deployment',
        postApprovalDueAt: dueAt.toISOString(),
        traceId,
      },
      actor,
    );

    const submitted = await this.changeTicketsService.submit(
      ticket.id,
      {
        reason:
          this.normalizeOptionalString(dto.reason) ||
          `SLA mock change ticket ${ticket.ticketNo} submitted`,
        traceId,
      },
      actor,
    );

    if (!submitted.latestApprovalId) {
      throw new BadRequestException('Change ticket approval was not linked');
    }

    await this.approvalsService.approve(
      submitted.latestApprovalId,
      {
        checkerRole: 'TECH_ADMIN',
        reason:
          this.normalizeOptionalString(dto.reason) ||
          `SLA mock change ticket ${ticket.ticketNo} approved`,
        traceId,
      },
      this.decisionBypassActor(actor),
    );

    await this.releaseGatesService.runGateCheck(
      ticket.id,
      {
        targetEnv: ChangeTicketReleaseEnvironments.PROD,
        releaseVersion,
        reason: 'SLA mock gate check',
        traceId,
      },
      actor,
    );

    await this.releaseGatesService.markDeployStatus(
      ticket.id,
      {
        targetEnv: ChangeTicketReleaseEnvironments.PROD,
        releaseVersion,
        deployStatus: dto.simulateDeployFailure
          ? ChangeTicketDeployStatuses.DEPLOY_FAILED
          : ChangeTicketDeployStatuses.DEPLOYED,
        reason:
          this.normalizeOptionalString(dto.reason) ||
          (dto.simulateDeployFailure
            ? 'SLA mock deploy failed'
            : 'SLA mock deployed'),
        traceId,
      },
      actor,
    );

    const timer = await this.findActiveTimerOrThrow(
      ticket.id,
      SlaTimerTypes.CHANGE_POST_APPROVAL_FOLLOWUP,
    );

    if (typeof dto.graceSeconds === 'number') {
      return this.slaTimersService.recalc(
        timer.id,
        {
          graceSeconds: dto.graceSeconds,
          reason:
            this.normalizeOptionalString(dto.reason) ||
            'SLA change follow-up mock recalculated',
          traceId,
        },
        actor,
      );
    }

    return this.slaTimersService.getById(timer.id);
  }

  async mockExpire(id: string, actor: ApprovalActorContext) {
    const current = await this.slaTimersService.getById(id);
    if (current.status !== SlaTimerStatuses.ACTIVE) {
      throw new BadRequestException('Only ACTIVE timers can be mock-expired');
    }

    const dueAt = new Date(Date.now() - (current.graceSeconds + 5) * 1000).toISOString();

    await this.slaTimersService.recalc(
      id,
      {
        dueAt,
        reason: 'SLA mock-expire backdated dueAt',
        traceId: current.traceId,
      },
      actor,
    );
    await this.slaTimersService.expireDueTimers();
    return this.slaTimersService.getById(id);
  }
}
