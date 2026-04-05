import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../approvals/constants/approval.constants';
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
    private readonly slaTimersService: SlaTimersService,
  ) {}

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length ? normalized : null;
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
    void dto;
    void actor;
    throw new BadRequestException(
      'Change follow-up SLA demo is not supported under the minimal ChangeTicket workflow',
    );
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
