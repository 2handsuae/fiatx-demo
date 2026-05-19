import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import {
  ApprovalDecisionEvent,
  ApprovalEvents,
} from './constants/approval.constants';

export interface ApprovalDecidedEvent {
  decision: 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';
  actionType: string;
  entityRef: string;
  approvalId: string;
  approvalNo: string;
  traceId: string;
  workflowType: string;
  decisionByUserId?: string | null;
  decisionByUserNo?: string | null;
  decisionByRole?: string | null;
  decisionReason?: string | null;
  decidedAt?: string | null;
  metadata: Record<string, any>;
}

export abstract class ApprovalHandlerBase {
  abstract readonly actionType: string;
  abstract readonly workflowType: string;
  abstract readonly auditActions: {
    granted: string;
    declined: string;
    cancelled: string;
    expired: string;
  };
  abstract readonly entityType: string;

  constructor(
    protected readonly auditLogsService: AuditLogsService,
    protected readonly eventEmitter: EventEmitter2,
  ) {}

  private buildSecondaryEventName(): string {
    const kebab = this.workflowType.toLowerCase().replace(/_/g, '-');
    return `workflow.${kebab}.decided`;
  }

  private buildAuditActor(event: ApprovalDecisionEvent) {
    return {
      actorType: 'ADMIN' as const,
      actorId: event.decisionByUserId || 'SYSTEM',
      actorNo: (event.decisionByUserNo as string | undefined) || undefined,
      actorRole: (event.decisionByRole as string | undefined) || 'SYSTEM',
    };
  }

  private async emitDecidedEvent(
    decision: ApprovalDecidedEvent['decision'],
    event: ApprovalDecisionEvent,
  ) {
    const payload: ApprovalDecidedEvent = {
      decision,
      actionType: event.actionType,
      entityRef: event.entityRef,
      approvalId: event.approvalId,
      approvalNo: event.approvalNo,
      traceId: event.traceId,
      workflowType: this.workflowType,
      decisionByUserId: event.decisionByUserId,
      decisionByUserNo: event.decisionByUserNo,
      decisionByRole: event.decisionByRole,
      decisionReason: event.decisionReason,
      decidedAt: event.decidedAt,
      metadata: {},
    };

    const eventName = this.buildSecondaryEventName();
    if (typeof this.eventEmitter.emitAsync === 'function') {
      await this.eventEmitter.emitAsync(eventName, payload);
    } else {
      this.eventEmitter.emit(eventName, payload);
    }
  }

  @OnEvent(ApprovalEvents.APPROVED, { async: true })
  async handleApproved(event: ApprovalDecisionEvent) {
    if (event.actionType !== this.actionType) return;

    await this.auditLogsService.recordByActor(
      {
        action: this.auditActions.granted,
        entityType: this.entityType,
        entityId: event.entityRef,
        entityNo: event.approvalNo,
        workflowType: this.workflowType,
        traceId: event.traceId,
        result: AuditResult.SUCCESS,
        metadata: { approvalId: event.approvalId, approvalNo: event.approvalNo },
        requestId: `${this.workflowType}_APPROVAL_GRANTED_${event.approvalNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.buildAuditActor(event),
    );

    await this.emitDecidedEvent('APPROVED', event);
  }

  @OnEvent(ApprovalEvents.REJECTED, { async: true })
  async handleRejected(event: ApprovalDecisionEvent) {
    if (event.actionType !== this.actionType) return;

    await this.auditLogsService.recordByActor(
      {
        action: this.auditActions.declined,
        entityType: this.entityType,
        entityId: event.entityRef,
        entityNo: event.approvalNo,
        workflowType: this.workflowType,
        traceId: event.traceId,
        result: AuditResult.REJECTED,
        metadata: {
          approvalId: event.approvalId,
          approvalNo: event.approvalNo,
          decisionReason: event.decisionReason,
        },
        requestId: `${this.workflowType}_APPROVAL_DECLINED_${event.approvalNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.buildAuditActor(event),
    );

    await this.emitDecidedEvent('DECLINED', event);
  }

  @OnEvent(ApprovalEvents.CANCELLED, { async: true })
  async handleCancelled(event: ApprovalDecisionEvent) {
    if (event.actionType !== this.actionType) return;

    await this.auditLogsService.recordByActor(
      {
        action: this.auditActions.cancelled,
        entityType: this.entityType,
        entityId: event.entityRef,
        entityNo: event.approvalNo,
        workflowType: this.workflowType,
        traceId: event.traceId,
        result: AuditResult.SUCCESS,
        metadata: { approvalId: event.approvalId, approvalNo: event.approvalNo },
        requestId: `${this.workflowType}_APPROVAL_CANCELLED_${event.approvalNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.buildAuditActor(event),
    );

    await this.emitDecidedEvent('CANCELLED', event);
  }

  @OnEvent(ApprovalEvents.EXPIRED, { async: true })
  async handleExpired(event: ApprovalDecisionEvent) {
    if (event.actionType !== this.actionType) return;

    await this.auditLogsService.recordSystem({
      action: this.auditActions.expired,
      entityType: this.entityType,
      entityId: event.entityRef,
      entityNo: event.approvalNo,
      workflowType: this.workflowType,
      traceId: event.traceId,
      result: AuditResult.SUCCESS,
      metadata: {
        approvalId: event.approvalId,
        approvalNo: event.approvalNo,
        expiredAt: event.decidedAt,
      },
      requestId: `${this.workflowType}_APPROVAL_EXPIRED_${event.approvalNo}`,
      sourcePlatform: 'ADMIN_API',
    });

    await this.emitDecidedEvent('EXPIRED', event);
  }
}
