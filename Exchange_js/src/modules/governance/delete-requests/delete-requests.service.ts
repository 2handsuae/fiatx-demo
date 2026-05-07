import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import {
  AuditResult,
  AuditSubjectRole,
} from '../../audit-logging/dto/audit-log.dto';
import { sha256Hex } from '../../audit-logging/utils/audit-digest.util';
import { ApprovalsService } from '../approvals/approvals.service';
import { ChangeTicketStatuses } from '../change-tickets/constants/change-ticket.constants';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
  ApprovalStatuses,
  isSuperAdminRoleContext,
} from '../approvals/constants/approval.constants';
import {
  CancelDeleteRequestDto,
  ConsumeDeleteRequestDto,
  CreateDeleteRequestDto,
  DeleteRequestQueryDto,
  SubmitDeleteRequestDto,
} from './dto/delete-request.dto';
import {
  DeleteRequestActiveStatuses,
  DeleteRequestStatuses,
  DeleteRequestTargetTypes,
} from './constants/delete-request.constants';

type DeleteRequestWriteClient = any;

type DeleteRequestApprovalSnapshot = {
  id: string;
  approvalNo: string;
  status: string;
  traceId: string;
} | null;

type DeleteRequestRow = {
  [key: string]: any;
  approvalCase: DeleteRequestApprovalSnapshot;
};

type ChangeTicketTargetRow = Record<string, any>;
type AuditEvidencePackageTargetRow = Record<string, any>;
type AdminUserTargetRow = Record<string, any>;

export type ResolvedDeleteTarget =
  | {
      targetType: typeof DeleteRequestTargetTypes.CHANGE_TICKET;
      targetId: string;
      targetNo: string;
      row: ChangeTicketTargetRow;
      approvalNo: string | null;
    }
  | {
      targetType: typeof DeleteRequestTargetTypes.AUDIT_EVIDENCE_PACKAGE;
      targetId: string;
      targetNo: string;
      row: AuditEvidencePackageTargetRow;
      approvalNo: string | null;
      approvalStatus: string | null;
    }
  | {
      targetType: typeof DeleteRequestTargetTypes.ADMIN_USER;
      targetId: string;
      targetNo: string;
      row: AdminUserTargetRow;
      approvalNo: null;
    };

interface DeleteRequestProjectionResult {
  request: DeleteRequestRow;
  action?: string;
  reason?: string;
  result?: AuditResult;
  approvalNo?: string | null;
}

@Injectable()
export class DeleteRequestsService {
  private static readonly DEFAULT_TAKE = 20;
  private static readonly MAX_REQUEST_NO_RETRIES = 10;
  private static readonly CHANGE_TICKET_DELETABLE_STATUSES = new Set<string>([
    ChangeTicketStatuses.DONE,
    ChangeTicketStatuses.FAILED,
    ChangeTicketStatuses.REJECTED,
    ChangeTicketStatuses.CANCELLED,
  ]);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    @Inject(forwardRef(() => ApprovalsService))
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private getDb(client?: DeleteRequestWriteClient): DeleteRequestWriteClient {
    return client ?? this.prisma;
  }

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length ? normalized : null;
  }

  private normalizeSkip(skip?: number): number {
    if (!skip || skip < 0) return 0;
    return skip;
  }

  private normalizeTake(take?: number): number {
    if (!take || take < 1) return DeleteRequestsService.DEFAULT_TAKE;
    return Math.min(take, 200);
  }

  private isSuperAdmin(actor?: ApprovalActorContext | null): boolean {
    return !!actor && isSuperAdminRoleContext(actor.roleCodes);
  }

  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorId: actor.userId,
      actorNo: actor.userNo,
      actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
    };
  }

  private systemActor(): ApprovalActorContext {
    return {
      actorType: 'ADMIN',
      userId: 'SYSTEM',
      userNo: 'SYSTEM',
      role: 'SYSTEM',
      roleCodes: ['SYSTEM'],
    };
  }

  private assertTraceConsistency(existingTraceId: string, incomingTraceId?: string | null) {
    const normalized = this.normalizeOptionalString(incomingTraceId);
    if (normalized && normalized !== existingTraceId) {
      throw new BadRequestException('traceId does not match the existing delete request chain');
    }
  }

  private deleteRequestInclude() {
    return {
      approvalCase: {
        select: {
          id: true,
          approvalNo: true,
          status: true,
          traceId: true,
        },
      },
    };
  }

  private parseJson<T>(value?: string | null): T | null {
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  private serializeJson(value: unknown): string {
    return JSON.stringify(value ?? {});
  }

  private mapDeleteRequest(request: DeleteRequestRow) {
    return {
      id: request.id,
      requestNo: request.requestNo,
      targetType: request.targetType,
      targetId: request.targetId,
      targetNo: request.targetNo,
      status: request.status,
      approvalCaseId: request.approvalCaseId,
      approvalNo: request.approvalNo,
      createdByUserId: request.createdByUserId,
      createdByUserNo: request.createdByUserNo,
      submittedByUserId: request.submittedByUserId,
      submittedByUserNo: request.submittedByUserNo,
      consumedByUserId: request.consumedByUserId,
      consumedByUserNo: request.consumedByUserNo,
      deleteReason: request.deleteReason,
      resultNote: request.resultNote,
      docRef: request.docRef,
      targetSnapshotJson: request.targetSnapshotJson
        ? this.parseJson<Record<string, unknown>>(request.targetSnapshotJson)
        : {},
      targetSnapshotDigest: request.targetSnapshotDigest || null,
      traceId: request.traceId,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      submittedAt: request.submittedAt,
      consumedAt: request.consumedAt,
    };
  }

  private deleteRequestSubjectNos(
    request: DeleteRequestRow,
    actor: ApprovalActorContext,
    approvalNo?: string | null,
  ) {
    const subjectNos: Array<{
      subjectRole: AuditSubjectRole;
      subjectType: string;
      subjectId?: string;
      subjectNo: string;
    }> = [
      {
        subjectRole: AuditSubjectRole.ENTITY,
        subjectType: AuditEntityTypes.DELETE_REQUEST,
        subjectId: request.id,
        subjectNo: request.requestNo,
      },
    ];

    const resolvedApprovalNo = this.normalizeOptionalString(approvalNo || request.approvalNo);
    if (resolvedApprovalNo) {
      subjectNos.push({
        subjectRole: AuditSubjectRole.RELATED,
        subjectType: AuditEntityTypes.APPROVAL_CASE,
        subjectId: request.approvalCaseId || undefined,
        subjectNo: resolvedApprovalNo,
      });
    }

    subjectNos.push({
      subjectRole: AuditSubjectRole.RELATED,
      subjectType: request.targetType,
      subjectId: request.targetId,
      subjectNo: request.targetNo,
    });

    subjectNos.push({
      subjectRole: AuditSubjectRole.ACTOR,
      subjectType: actor.actorType,
      subjectId: actor.userId,
      subjectNo: actor.userNo || actor.userId,
    });

    return subjectNos;
  }

  private resolveDeleteRequestBusinessWorkflowType(targetType: string) {
    if (targetType === DeleteRequestTargetTypes.CHANGE_TICKET) {
      return AuditBusinessWorkflowTypes.CHANGE_TICKET_DELETION;
    }
    if (targetType === DeleteRequestTargetTypes.ADMIN_USER) {
      return AuditBusinessWorkflowTypes.ADMIN_USER_DELETION;
    }
    if (targetType === DeleteRequestTargetTypes.AUDIT_EVIDENCE_PACKAGE) {
      return AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_PACKAGE_DELETION;
    }

    throw new BadRequestException(`Unsupported delete request targetType: ${targetType}`);
  }

  private async recordDeleteRequestAudit(
    action: string,
    request: DeleteRequestRow,
    actor: ApprovalActorContext,
    result: AuditResult,
    reason?: string | null,
    metadata?: Record<string, unknown>,
    approvalNo?: string | null,
  ) {
    await this.auditLogsService.recordByActor(
      {
        action,
        entityType: AuditEntityTypes.DELETE_REQUEST,
        entityId: request.id,
        entityNo: request.requestNo,
        workflowType: this.resolveDeleteRequestBusinessWorkflowType(request.targetType),
        traceId: request.traceId,
        result,
        reason: reason || undefined,
        metadata: {
          targetType: request.targetType,
          targetId: request.targetId,
          targetNo: request.targetNo,
          approvalCaseId: request.approvalCaseId,
          approvalNo: approvalNo || request.approvalNo || null,
          ...(metadata || {}),
        },
        subjectNos: this.deleteRequestSubjectNos(request, actor, approvalNo),
        requestId: `DELETE_REQUEST_${request.requestNo}_${action}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );
  }

  private async findRequestOrThrow(
    id: string,
    client?: DeleteRequestWriteClient,
  ): Promise<DeleteRequestRow> {
    const db = this.getDb(client);
    const found = await db.deleteRequest.findUnique({
      where: { id },
      include: this.deleteRequestInclude(),
    });

    if (!found) {
      throw new NotFoundException(`Delete request not found: ${id}`);
    }

    return found as DeleteRequestRow;
  }

  private isUniqueConflict(error: unknown, field: string): boolean {
    const maybe = error as {
      code?: string;
      meta?: { target?: string[] | string };
    };
    if (maybe?.code !== 'P2002') return false;

    const target = maybe.meta?.target;
    if (Array.isArray(target)) return target.includes(field);
    if (typeof target === 'string') return target.includes(field);
    return false;
  }

  private async createRequestWithUniqueNo(
    data: Record<string, any>,
    client?: DeleteRequestWriteClient,
  ): Promise<DeleteRequestRow> {
    const db = this.getDb(client);
    for (let i = 0; i < DeleteRequestsService.MAX_REQUEST_NO_RETRIES; i += 1) {
      try {
        return (await db.deleteRequest.create({
          data: {
            ...data,
            requestNo: generateReferenceNo('DR'),
          },
          include: this.deleteRequestInclude(),
        })) as DeleteRequestRow;
      } catch (error) {
        if (this.isUniqueConflict(error, 'requestNo')) {
          continue;
        }
        throw error;
      }
    }

    throw new ConflictException('Failed to generate unique requestNo');
  }

  private buildDeleteRequestSnapshot(target: ResolvedDeleteTarget) {
    if (target.targetType === DeleteRequestTargetTypes.CHANGE_TICKET) {
      return {
        targetType: target.targetType,
        targetId: target.row.id,
        targetNo: target.row.ticketNo,
        status: target.row.status,
        changeType: target.row.changeType,
        approvalCaseId: target.row.approvalCaseId,
        approvalNo: target.row.approvalNo,
        traceId: target.row.traceId,
        createdAt: target.row.createdAt,
        updatedAt: target.row.updatedAt,
      };
    }

    if (target.targetType === DeleteRequestTargetTypes.ADMIN_USER) {
      return {
        targetType: target.targetType,
        targetId: target.row.id,
        targetNo: target.row.userNo,
        email: target.row.email,
        status: target.row.status,
        role: target.row.role,
        roles: (target.row.userRoles || []).map((item: any) => item.role?.code).filter(Boolean),
        createdAt: target.row.createdAt,
        updatedAt: target.row.updatedAt,
      };
    }

    return {
      targetType: target.targetType,
      targetId: target.row.id,
      targetNo: target.row.packageNo,
      status: target.row.status,
      exportMode: target.row.exportMode,
      itemCount: target.row.itemCount,
      digest: target.row.digest,
      approvalCaseId: target.row.approvalCaseId,
      approvalNo: target.approvalNo,
      approvalStatus: target.approvalStatus,
      createdAt: target.row.createdAt,
      updatedAt: target.row.updatedAt,
    };
  }

  private async findActiveRequestForTarget(
    targetType: string,
    targetId: string,
  ): Promise<DeleteRequestRow | null> {
    const found = await this.prisma.deleteRequest.findFirst({
      where: {
        targetType,
        targetId,
        status: {
          in: [...DeleteRequestActiveStatuses],
        },
      },
      include: this.deleteRequestInclude(),
      orderBy: { createdAt: 'desc' },
    });

    return found as DeleteRequestRow | null;
  }

  private async resolveTargetByNo(
    targetType: string,
    targetNo: string,
  ): Promise<ResolvedDeleteTarget> {
    const normalizedTargetType = String(targetType || '').trim().toUpperCase();
    const normalizedTargetNo = String(targetNo || '').trim();
    if (!normalizedTargetNo) {
      throw new BadRequestException('targetNo is required');
    }

    if (normalizedTargetType === DeleteRequestTargetTypes.CHANGE_TICKET) {
      const row = await this.prisma.changeTicket.findFirst({
        where: {
          ticketNo: normalizedTargetNo,
          deletedAt: null,
        },
        select: {
          id: true,
          ticketNo: true,
          status: true,
          changeType: true,
          approvalCaseId: true,
          approvalNo: true,
          traceId: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
          deletedBy: true,
          deleteRequestId: true,
          deleteRequestNo: true,
          deleteReason: true,
        },
      });
      if (!row) {
        throw new NotFoundException(`Change ticket not found: ${normalizedTargetNo}`);
      }
      if (!DeleteRequestsService.CHANGE_TICKET_DELETABLE_STATUSES.has(row.status)) {
        throw new BadRequestException(
          'Only terminal change tickets can be deleted',
        );
      }
      return {
        targetType: DeleteRequestTargetTypes.CHANGE_TICKET,
        targetId: row.id,
        targetNo: row.ticketNo,
        row,
        approvalNo: row.approvalNo || null,
      };
    }

    if (normalizedTargetType === DeleteRequestTargetTypes.AUDIT_EVIDENCE_PACKAGE) {
      const row = await this.prisma.auditEvidencePackage.findFirst({
        where: {
          packageNo: normalizedTargetNo,
          deletedAt: null,
        },
        select: {
          id: true,
          packageNo: true,
          approvalCaseId: true,
          status: true,
          exportMode: true,
          itemCount: true,
          digest: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
          deletedBy: true,
          deleteRequestId: true,
          deleteReason: true,
          approvalCase: {
            select: {
              approvalNo: true,
              status: true,
            },
          },
        },
      });
      if (!row) {
        throw new NotFoundException(`Evidence export package not found: ${normalizedTargetNo}`);
      }
      if (row.approvalCase?.status === ApprovalStatuses.PENDING) {
        throw new BadRequestException(
          'Evidence export package with pending approval cannot be deleted',
        );
      }
      return {
        targetType: DeleteRequestTargetTypes.AUDIT_EVIDENCE_PACKAGE,
        targetId: row.id,
        targetNo: row.packageNo,
        row,
        approvalNo: row.approvalCase?.approvalNo || null,
        approvalStatus: row.approvalCase?.status || null,
      };
    }

    if (normalizedTargetType === DeleteRequestTargetTypes.ADMIN_USER) {
      const row = await this.prisma.user.findFirst({
        where: {
          userNo: normalizedTargetNo,
          deletedAt: null,
        },
        select: {
          id: true,
          userNo: true,
          email: true,
          status: true,
          role: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
          deletedBy: true,
          deleteRequestId: true,
          deleteReason: true,
          userRoles: {
            select: {
              role: {
                select: {
                  code: true,
                  name: true,
                },
              },
            },
          },
        },
      });
      if (!row) {
        throw new NotFoundException(`Admin user not found: ${normalizedTargetNo}`);
      }
      return {
        targetType: DeleteRequestTargetTypes.ADMIN_USER,
        targetId: row.id,
        targetNo: row.userNo,
        row,
        approvalNo: null,
      };
    }

    throw new BadRequestException(`Unsupported delete request targetType: ${targetType}`);
  }

  async resolveTargetById(
    targetType: string,
    targetId: string,
  ): Promise<ResolvedDeleteTarget> {
    const normalizedTargetType = String(targetType || '').trim().toUpperCase();
    const normalizedTargetId = String(targetId || '').trim();
    if (!normalizedTargetId) {
      throw new BadRequestException('targetId is required');
    }

    if (normalizedTargetType === DeleteRequestTargetTypes.CHANGE_TICKET) {
      const row = await this.prisma.changeTicket.findUnique({
        where: { id: normalizedTargetId },
        select: {
          id: true,
          ticketNo: true,
          status: true,
          changeType: true,
          approvalCaseId: true,
          approvalNo: true,
          traceId: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
          deletedBy: true,
          deleteRequestId: true,
          deleteRequestNo: true,
          deleteReason: true,
        },
      });
      if (!row || row.deletedAt) {
        throw new NotFoundException(`Change ticket not found: ${normalizedTargetId}`);
      }
      if (!DeleteRequestsService.CHANGE_TICKET_DELETABLE_STATUSES.has(row.status)) {
        throw new BadRequestException(
          'Only terminal change tickets can be deleted',
        );
      }
      return {
        targetType: DeleteRequestTargetTypes.CHANGE_TICKET,
        targetId: row.id,
        targetNo: row.ticketNo,
        row,
        approvalNo: row.approvalNo || null,
      };
    }

    if (normalizedTargetType === DeleteRequestTargetTypes.AUDIT_EVIDENCE_PACKAGE) {
      const row = await this.prisma.auditEvidencePackage.findUnique({
        where: { id: normalizedTargetId },
        select: {
          id: true,
          packageNo: true,
          approvalCaseId: true,
          status: true,
          exportMode: true,
          itemCount: true,
          digest: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
          deletedBy: true,
          deleteRequestId: true,
          deleteReason: true,
          approvalCase: {
            select: {
              approvalNo: true,
              status: true,
            },
          },
        },
      });
      if (!row || row.deletedAt) {
        throw new NotFoundException(`Evidence export package not found: ${normalizedTargetId}`);
      }
      if (row.approvalCase?.status === ApprovalStatuses.PENDING) {
        throw new BadRequestException(
          'Evidence export package with pending approval cannot be deleted',
        );
      }
      return {
        targetType: DeleteRequestTargetTypes.AUDIT_EVIDENCE_PACKAGE,
        targetId: row.id,
        targetNo: row.packageNo,
        row,
        approvalNo: row.approvalCase?.approvalNo || null,
        approvalStatus: row.approvalCase?.status || null,
      };
    }

    if (normalizedTargetType === DeleteRequestTargetTypes.ADMIN_USER) {
      const row = await this.prisma.user.findUnique({
        where: { id: normalizedTargetId },
        select: {
          id: true,
          userNo: true,
          email: true,
          status: true,
          role: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
          deletedBy: true,
          deleteRequestId: true,
          deleteReason: true,
          userRoles: {
            select: {
              role: {
                select: {
                  code: true,
                  name: true,
                },
              },
            },
          },
        },
      });
      if (!row || row.deletedAt) {
        throw new NotFoundException(`Admin user not found: ${normalizedTargetId}`);
      }
      return {
        targetType: DeleteRequestTargetTypes.ADMIN_USER,
        targetId: row.id,
        targetNo: row.userNo,
        row,
        approvalNo: null,
      };
    }

    throw new BadRequestException(`Unsupported delete request targetType: ${targetType}`);
  }

  private async applyApprovalProjection(
    request: DeleteRequestRow,
    approvalStatus: string,
    approvalNo: string | null,
  ): Promise<DeleteRequestProjectionResult> {
    if (request.status !== DeleteRequestStatuses.PENDING_APPROVAL) {
      return { request };
    }

    const normalizedApprovalStatus = this.normalizeOptionalString(approvalStatus);
    const normalizedApprovalNo = this.normalizeOptionalString(approvalNo);
    if (!normalizedApprovalStatus) {
      return { request };
    }

    let nextStatus = request.status;
    let action: string | undefined;
    let reason: string | undefined;
    let result: AuditResult | undefined;

    if (normalizedApprovalStatus === ApprovalStatuses.APPROVED) {
      nextStatus = DeleteRequestStatuses.READY;
      action = AuditActions.DELETE_REQUEST_APPROVED;
      reason = `Approval ${normalizedApprovalNo || request.approvalCaseId || ''} approved`;
      result = AuditResult.SUCCESS;
    } else if (
      normalizedApprovalStatus === ApprovalStatuses.REJECTED ||
      normalizedApprovalStatus === ApprovalStatuses.EXPIRED ||
      normalizedApprovalStatus === ApprovalStatuses.CANCELLED
    ) {
      nextStatus = DeleteRequestStatuses.REJECTED;
      action = AuditActions.DELETE_REQUEST_REJECTED;
      reason = `Approval ${normalizedApprovalNo || request.approvalCaseId || ''} ${normalizedApprovalStatus.toLowerCase()}`;
      result = AuditResult.REJECTED;
    }

    const data: Record<string, unknown> = {};
    if (nextStatus !== request.status) {
      data.status = nextStatus;
    }
    if (normalizedApprovalNo && normalizedApprovalNo !== request.approvalNo) {
      data.approvalNo = normalizedApprovalNo;
    }
    if (!Object.keys(data).length) {
      return { request };
    }

    const updated = (await this.prisma.deleteRequest.update({
      where: { id: request.id },
      data,
      include: this.deleteRequestInclude(),
    })) as DeleteRequestRow;

    return {
      request: updated,
      action,
      reason,
      result,
      approvalNo: normalizedApprovalNo,
    };
  }

  async syncApprovalProjectionByEvent(event: {
    approvalId: string;
    approvalNo: string;
    entityRef: string;
    actionType: string;
    status: string;
  }) {
    if (event.actionType !== ApprovalActionTypes.DELETE_REQUEST_APPROVAL) {
      return null;
    }

    const found = await this.prisma.deleteRequest.findUnique({
      where: { id: event.entityRef },
      include: this.deleteRequestInclude(),
    });
    if (!found) {
      return null;
    }

    const row = found as DeleteRequestRow;
    if (row.approvalCaseId && row.approvalCaseId !== event.approvalId) {
      return this.mapDeleteRequest(row);
    }

    const projection = await this.applyApprovalProjection(row, event.status, event.approvalNo);
    if (projection.action) {
      await this.recordDeleteRequestAudit(
        projection.action,
        projection.request,
        this.systemActor(),
        projection.result || AuditResult.SUCCESS,
        projection.reason,
        undefined,
        projection.approvalNo,
      );
    }

    return this.mapDeleteRequest(projection.request);
  }

  async create(dto: CreateDeleteRequestDto, actor: ApprovalActorContext) {
    const target = await this.resolveTargetByNo(dto.targetType, dto.targetNo);
    const existing = await this.findActiveRequestForTarget(target.targetType, target.targetId);
    if (existing) {
      return this.mapDeleteRequest(existing);
    }
    const targetSnapshot = this.buildDeleteRequestSnapshot(target);

    const created = await this.createRequestWithUniqueNo({
      targetType: target.targetType,
      targetId: target.targetId,
      targetNo: target.targetNo,
      status: DeleteRequestStatuses.DRAFT,
      approvalCaseId: null,
      approvalNo: target.approvalNo,
      createdByUserId: actor.userId,
      createdByUserNo: actor.userNo,
      deleteReason: String(dto.deleteReason || '').trim(),
      resultNote: null,
      docRef: this.normalizeOptionalString(dto.docRef),
      targetSnapshotJson: this.serializeJson(targetSnapshot),
      targetSnapshotDigest: sha256Hex(targetSnapshot),
      traceId: randomUUID(),
    });

    await this.recordDeleteRequestAudit(
      AuditActions.DELETE_REQUEST_CREATED,
      created,
      actor,
      AuditResult.SUCCESS,
      'Delete request created',
      {
        targetSnapshotPreview: this.buildDeleteRequestSnapshot(target),
      },
      target.approvalNo || null,
    );

    return this.mapDeleteRequest(created);
  }

  async submit(id: string, dto: SubmitDeleteRequestDto, actor: ApprovalActorContext) {
    const existing = await this.findRequestOrThrow(id);
    if (existing.createdByUserId !== actor.userId) {
      throw new ForbiddenException('Only the creator can submit this delete request');
    }
    if (existing.status !== DeleteRequestStatuses.DRAFT) {
      throw new BadRequestException('Only DRAFT delete requests can be submitted');
    }
    this.assertTraceConsistency(existing.traceId, dto.traceId);
    await this.resolveTargetById(existing.targetType, existing.targetId);

    let approval:
      | {
          id: string;
          approvalNo: string;
          status: string;
        }
      | undefined;

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const current = await this.findRequestOrThrow(id, tx);
      if (current.createdByUserId !== actor.userId) {
        throw new ForbiddenException('Only the creator can submit this delete request');
      }
      if (current.status !== DeleteRequestStatuses.DRAFT) {
        throw new BadRequestException('Only DRAFT delete requests can be submitted');
      }

      approval = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.DELETE_REQUEST_APPROVAL,
          entityRef: current.id,
          docRef: current.docRef || undefined,
          metadata: {
            source: 'WF05',
            requestNo: current.requestNo,
            targetType: current.targetType,
            targetId: current.targetId,
            targetNo: current.targetNo,
          },
          traceId: current.traceId,
        },
        {
          reason:
            this.normalizeOptionalString(dto.reason) ||
            `Delete request ${current.requestNo} submitted`,
          traceId: current.traceId,
        },
        actor,
        tx,
        { emitSideEffects: false },
      );

      return (await tx.deleteRequest.update({
        where: { id: current.id },
        data: {
          status: DeleteRequestStatuses.PENDING_APPROVAL,
          approvalCaseId: approval.id,
          approvalNo: approval.approvalNo,
          submittedByUserId: actor.userId,
          submittedByUserNo: actor.userNo,
          submittedAt: new Date(),
        },
        include: this.deleteRequestInclude(),
      })) as DeleteRequestRow;
    });

    await this.recordDeleteRequestAudit(
      AuditActions.DELETE_REQUEST_SUBMITTED,
      updated,
      actor,
      AuditResult.SUCCESS,
      this.normalizeOptionalString(dto.reason) || 'Delete request submitted',
      {
        approvalCaseId: approval?.id || null,
      },
      approval?.approvalNo || null,
    );

    if (approval) {
      await this.approvalsService.emitSubmittedSideEffects(
        approval.id,
        actor,
        this.normalizeOptionalString(dto.reason) || `Delete request ${updated.requestNo} submitted`,
      );
    }

    return this.mapDeleteRequest(updated);
  }

  async cancel(id: string, dto: CancelDeleteRequestDto, actor: ApprovalActorContext) {
    const current = await this.findRequestOrThrow(id);
    const isSuperAdmin = this.isSuperAdmin(actor);
    if (current.createdByUserId !== actor.userId && !isSuperAdmin) {
      throw new ForbiddenException('Only the creator can cancel this delete request');
    }

    const cancellableStatuses = new Set<string>([
      DeleteRequestStatuses.DRAFT,
      DeleteRequestStatuses.PENDING_APPROVAL,
      DeleteRequestStatuses.READY,
    ]);
    if (!cancellableStatuses.has(current.status)) {
      throw new BadRequestException(
        'Only DRAFT, PENDING_APPROVAL, or READY delete requests can be cancelled',
      );
    }

    this.assertTraceConsistency(current.traceId, dto.traceId);

    let approvalNo = current.approvalNo || null;
    if (current.approvalCaseId && current.approvalCase?.status === ApprovalStatuses.PENDING) {
      const cancelledApproval = await this.approvalsService.cancel(
        current.approvalCaseId,
        {
          reason:
            this.normalizeOptionalString(dto.reason) ||
            `Delete request ${current.requestNo} cancelled`,
          traceId: current.traceId,
        },
        actor,
      );
      approvalNo = cancelledApproval.approvalNo || approvalNo;
    }

    const updated = (await this.prisma.deleteRequest.update({
      where: { id: current.id },
      data: {
        status: DeleteRequestStatuses.CANCELLED,
        approvalNo,
      },
      include: this.deleteRequestInclude(),
    })) as DeleteRequestRow;

    await this.recordDeleteRequestAudit(
      AuditActions.DELETE_REQUEST_CANCELLED,
      updated,
      actor,
      AuditResult.SUCCESS,
      this.normalizeOptionalString(dto.reason) || 'Delete request cancelled',
      isSuperAdmin && current.createdByUserId !== actor.userId
        ? { superAdminBypass: true }
        : undefined,
      approvalNo,
    );

    return this.mapDeleteRequest(updated);
  }

  async consume(id: string, dto: ConsumeDeleteRequestDto, actor: ApprovalActorContext) {
    const current = await this.findRequestOrThrow(id);
    if (current.status === DeleteRequestStatuses.FAILED) {
      throw new BadRequestException('FAILED delete requests cannot be consumed again');
    }
    if (current.status !== DeleteRequestStatuses.READY) {
      throw new BadRequestException('Only READY delete requests can be consumed');
    }

    this.assertTraceConsistency(current.traceId, dto.traceId);

    const superAdminBypass = this.isSuperAdmin(actor) && current.createdByUserId === actor.userId;
    if (current.createdByUserId === actor.userId && !superAdminBypass) {
      throw new ForbiddenException('Creator cannot consume their own delete request');
    }

    const target = await this.resolveTargetById(current.targetType, current.targetId);
    const approval = current.approvalCaseId
      ? await this.approvalsService.requireApproved({
          actionType: ApprovalActionTypes.DELETE_REQUEST_APPROVAL,
          entityRef: current.id,
          approvalCaseId: current.approvalCaseId,
          actor,
          traceId: current.traceId,
        })
      : null;
    const targetSnapshot = this.buildDeleteRequestSnapshot(target);
    const now = new Date();
    const resultNote =
      this.normalizeOptionalString(dto.reason) || `Delete request ${current.requestNo} consumed`;

    try {
      const consumed = await this.prisma.$transaction(async (tx: any) => {
        if (target.targetType === DeleteRequestTargetTypes.CHANGE_TICKET) {
          await tx.changeTicket.update({
            where: { id: target.targetId },
            data: {
              deletedAt: now,
              deletedBy: actor.userId,
              deleteRequestId: current.id,
              deleteRequestNo: current.requestNo,
              deleteReason: current.deleteReason,
            },
          });
        } else if (target.targetType === DeleteRequestTargetTypes.AUDIT_EVIDENCE_PACKAGE) {
          await tx.auditEvidencePackage.update({
            where: { id: target.targetId },
            data: {
              deletedAt: now,
              deletedBy: actor.userId,
              deleteRequestId: current.id,
              deleteReason: current.deleteReason,
            },
          });
        } else {
          await tx.user.update({
            where: { id: target.targetId },
            data: {
              deletedAt: now,
              deletedBy: actor.userId,
              deleteRequestId: current.id,
              deleteReason: current.deleteReason,
            },
          });

          await tx.adminUserInvitation.updateMany({
            where: {
              userId: target.targetId,
              consumedAt: null,
              revokedAt: null,
            },
            data: {
              revokedAt: now,
            },
          });
        }

        return (await tx.deleteRequest.update({
          where: { id: current.id },
          data: {
            status: DeleteRequestStatuses.DONE,
            approvalNo: approval?.approvalNo || current.approvalNo || null,
            consumedByUserId: actor.userId,
            consumedByUserNo: actor.userNo,
            consumedAt: now,
            resultNote,
            targetSnapshotJson: this.serializeJson(targetSnapshot),
            targetSnapshotDigest: sha256Hex(targetSnapshot),
          },
          include: this.deleteRequestInclude(),
        })) as DeleteRequestRow;
      });

      await this.recordDeleteRequestAudit(
        AuditActions.DELETE_REQUEST_CONSUMED,
        consumed,
        actor,
        AuditResult.SUCCESS,
        resultNote,
        {
          targetSnapshot,
          ...(superAdminBypass ? { superAdminBypass: true } : {}),
        },
        approval?.approvalNo || current.approvalNo || null,
      );

      return this.mapDeleteRequest(consumed);
    } catch (error) {
      const failed = (await this.prisma.deleteRequest.update({
        where: { id: current.id },
        data: {
          status: DeleteRequestStatuses.FAILED,
          approvalNo: approval?.approvalNo || current.approvalNo || null,
          consumedByUserId: actor.userId,
          consumedByUserNo: actor.userNo,
          consumedAt: now,
          resultNote:
            error instanceof Error
              ? error.message
              : this.normalizeOptionalString(dto.reason) || 'Delete request consume failed',
          targetSnapshotJson: this.serializeJson(targetSnapshot),
          targetSnapshotDigest: sha256Hex(targetSnapshot),
        },
        include: this.deleteRequestInclude(),
      })) as DeleteRequestRow;

      await this.recordDeleteRequestAudit(
        AuditActions.DELETE_REQUEST_EXECUTION_FAILED,
        failed,
        actor,
        AuditResult.FAILED,
        failed.resultNote,
        {
          targetSnapshot,
          ...(superAdminBypass ? { superAdminBypass: true } : {}),
        },
        approval?.approvalNo || current.approvalNo || null,
      );

      throw error;
    }
  }

  async getById(id: string, actor?: ApprovalActorContext) {
    void actor;
    return this.mapDeleteRequest(await this.findRequestOrThrow(id));
  }

  async list(query: DeleteRequestQueryDto, actor?: ApprovalActorContext) {
    void actor;
    const skip = this.normalizeSkip(query.skip);
    const take = this.normalizeTake(query.take);
    const where: Record<string, any> = {};

    if (query.requestNo) {
      where.requestNo = query.requestNo.trim();
    }
    if (query.targetType) {
      where.targetType = query.targetType.trim().toUpperCase();
    }
    if (query.targetNo) {
      where.targetNo = query.targetNo.trim();
    }
    if (query.status) {
      where.status = query.status.trim().toUpperCase();
    }
    if (query.traceId) {
      where.traceId = query.traceId.trim();
    }
    if (query.approvalNo) {
      where.approvalNo = query.approvalNo.trim();
    }
    if (query.createdByUserNo) {
      where.createdByUserNo = query.createdByUserNo.trim();
    }
    if (query.consumedByUserNo) {
      where.consumedByUserNo = query.consumedByUserNo.trim();
    }
    if (query.keyword) {
      const keyword = query.keyword.trim();
      where.OR = [
        { requestNo: { contains: keyword } },
        { targetNo: { contains: keyword } },
        { targetType: { contains: keyword } },
        { traceId: { contains: keyword } },
        { deleteReason: { contains: keyword } },
        { approvalNo: { contains: keyword } },
        { createdByUserNo: { contains: keyword } },
        { consumedByUserNo: { contains: keyword } },
      ];
    }

    const [total, rows] = await Promise.all([
      this.prisma.deleteRequest.count({ where }),
      this.prisma.deleteRequest.findMany({
        where,
        skip,
        take,
        include: this.deleteRequestInclude(),
        orderBy: [{ createdAt: 'desc' }],
      }),
    ]);

    return {
      total,
      skip,
      take,
      items: rows.map((row) => this.mapDeleteRequest(row as DeleteRequestRow)),
    };
  }
}
