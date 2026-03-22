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
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
} from '../../risk-engine/audit-logs/constants/audit-actions.constant';
import {
  AuditResult,
  AuditSubjectRole,
  AuditTriggerType,
} from '../../risk-engine/audit-logs/dto/audit-log.dto';
import { ApprovalsService } from '../approvals/approvals.service';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
  ApprovalStatuses,
  isSuperAdminRoleContext,
} from '../approvals/constants/approval.constants';
import {
  CancelDeleteRequestDto,
  CreateDeleteRequestDto,
  DeleteRequestQueryDto,
  ExecuteDeleteRequestDto,
  SubmitDeleteRequestDto,
} from './dto/delete-request.dto';
import {
  DeleteRequestActiveStatuses,
  DeleteRequestStatuses,
  DeleteRequestTargetTypes,
  DeleteRequestWorkflowTypes,
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
  latestApproval: DeleteRequestApprovalSnapshot;
};

type ChangeTicketTargetRow = Record<string, any>;
type AuditEvidencePackageTargetRow = Record<string, any>;
type ComplianceCaseEvidencePackageTargetRow = Record<string, any>;
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
      targetType: typeof DeleteRequestTargetTypes.COMPLIANCE_CASE_EVIDENCE_PACKAGE;
      targetId: string;
      targetNo: string;
      row: ComplianceCaseEvidencePackageTargetRow;
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
  statusFrom?: string;
  statusTo?: string;
  approvalNo?: string | null;
}

@Injectable()
export class DeleteRequestsService {
  private static readonly DEFAULT_TAKE = 20;
  private static readonly MAX_REQUEST_NO_RETRIES = 10;

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
      latestApproval: {
        select: {
          id: true,
          approvalNo: true,
          status: true,
          traceId: true,
        },
      },
    };
  }

  private mapDeleteRequest(request: DeleteRequestRow) {
    return {
      id: request.id,
      requestNo: request.requestNo,
      targetType: request.targetType,
      targetId: request.targetId,
      targetNo: request.targetNo,
      status: request.status,
      latestApprovalId: request.latestApprovalId,
      latestApprovalNo: request.latestApproval?.approvalNo || null,
      latestApprovalStatus: request.latestApprovalStatus,
      makerUserId: request.makerUserId,
      submittedByUserId: request.submittedByUserId,
      executedByUserId: request.executedByUserId,
      deleteReason: request.deleteReason,
      docRef: request.docRef,
      targetSnapshotJson: request.targetSnapshotJson
        ? this.parseJson<Record<string, unknown>>(request.targetSnapshotJson)
        : {},
      traceId: request.traceId,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      submittedAt: request.submittedAt,
      executedAt: request.executedAt,
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

  private deleteRequestSubjectNos(request: DeleteRequestRow, approvalNo?: string | null) {
    const subjectNos: Array<{
      subjectRole: AuditSubjectRole;
      subjectType: string;
      subjectId?: string;
      subjectNo: string;
    }> = [
      {
        subjectRole: AuditSubjectRole.ENTITY,
        subjectType: AuditWorkflowTypes.DELETE_REQUEST,
        subjectId: request.id,
        subjectNo: request.requestNo,
      },
      {
        subjectRole: AuditSubjectRole.RELATED,
        subjectType: request.targetType,
        subjectId: request.targetId,
        subjectNo: request.targetNo,
      },
    ];

    const resolvedApprovalNo = this.normalizeOptionalString(
      approvalNo || request.latestApproval?.approvalNo,
    );
    if (resolvedApprovalNo) {
      subjectNos.push({
        subjectRole: AuditSubjectRole.RELATED,
        subjectType: AuditEntityTypes.APPROVAL_CASE,
        subjectId: request.latestApprovalId || undefined,
        subjectNo: resolvedApprovalNo,
      });
    }

    return subjectNos;
  }

  private async recordDeleteRequestAudit(
    action: string,
    request: DeleteRequestRow,
    actor: ApprovalActorContext,
    result: AuditResult,
    reason?: string | null,
    statusFrom?: string | null,
    statusTo?: string | null,
    metadata?: Record<string, unknown>,
    approvalNo?: string | null,
  ) {
    await this.auditLogsService.recordByActor(
      {
        triggerType: AuditTriggerType.DATA_UPDATE,
        action,
        module: AuditModules.GOVERNANCE_DELETE_REQUESTS,
        entityType: AuditEntityTypes.DELETE_REQUEST,
        entityId: request.id,
        entityNo: request.requestNo,
        workflowType: DeleteRequestWorkflowTypes.DELETE_REQUEST,
        workflowId: request.id,
        workflowNo: request.requestNo,
        traceId: request.traceId,
        statusFrom: statusFrom || undefined,
        statusTo: statusTo || undefined,
        result,
        reason: reason || undefined,
        metadata: {
          targetType: request.targetType,
          targetId: request.targetId,
          targetNo: request.targetNo,
          latestApprovalId: request.latestApprovalId,
          latestApprovalNo: approvalNo || request.latestApproval?.approvalNo || null,
          latestApprovalStatus: request.latestApprovalStatus,
          ...(metadata || {}),
        },
        subjectNos: this.deleteRequestSubjectNos(request, approvalNo),
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
        latestApprovalId: target.row.latestApprovalId,
        latestApprovalStatus: target.row.latestApprovalStatus,
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
          latestApprovalId: true,
          latestApprovalStatus: true,
          traceId: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
          deletedBy: true,
          deleteRequestId: true,
          deleteReason: true,
        },
      });
      if (!row) {
        throw new NotFoundException(`Change ticket not found: ${normalizedTargetNo}`);
      }
      if (row.status !== 'CLOSED') {
        throw new BadRequestException('Only CLOSED change tickets can be deleted');
      }
      return {
        targetType: DeleteRequestTargetTypes.CHANGE_TICKET,
        targetId: row.id,
        targetNo: row.ticketNo,
        row,
        approvalNo: null,
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

    if (
      normalizedTargetType ===
      DeleteRequestTargetTypes.COMPLIANCE_CASE_EVIDENCE_PACKAGE
    ) {
      const row = await this.prisma.complianceCaseEvidencePackage.findFirst({
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
        throw new NotFoundException(
          `Case evidence export package not found: ${normalizedTargetNo}`,
        );
      }
      if (row.approvalCase?.status === ApprovalStatuses.PENDING) {
        throw new BadRequestException(
          'Case evidence export package with pending approval cannot be deleted',
        );
      }
      return {
        targetType: DeleteRequestTargetTypes.COMPLIANCE_CASE_EVIDENCE_PACKAGE,
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
          latestApprovalId: true,
          latestApprovalStatus: true,
          traceId: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
          deletedBy: true,
          deleteRequestId: true,
          deleteReason: true,
        },
      });
      if (!row || row.deletedAt) {
        throw new NotFoundException(`Change ticket not found: ${normalizedTargetId}`);
      }
      if (row.status !== 'CLOSED') {
        throw new BadRequestException('Only CLOSED change tickets can be deleted');
      }
      return {
        targetType: DeleteRequestTargetTypes.CHANGE_TICKET,
        targetId: row.id,
        targetNo: row.ticketNo,
        row,
        approvalNo: null,
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

    if (
      normalizedTargetType ===
      DeleteRequestTargetTypes.COMPLIANCE_CASE_EVIDENCE_PACKAGE
    ) {
      const row = await this.prisma.complianceCaseEvidencePackage.findUnique({
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
        throw new NotFoundException(
          `Case evidence export package not found: ${normalizedTargetId}`,
        );
      }
      if (row.approvalCase?.status === ApprovalStatuses.PENDING) {
        throw new BadRequestException(
          'Case evidence export package with pending approval cannot be deleted',
        );
      }
      return {
        targetType: DeleteRequestTargetTypes.COMPLIANCE_CASE_EVIDENCE_PACKAGE,
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
    const normalizedApprovalStatus = this.normalizeOptionalString(approvalStatus);
    const currentApprovalStatus = this.normalizeOptionalString(request.latestApprovalStatus);
    if (!normalizedApprovalStatus) {
      return { request };
    }

    let nextStatus = request.status;
    let action: string | undefined;
    let reason: string | undefined;
    let result: AuditResult | undefined;
    const pendingProjectionStatuses = new Set<string>([
      DeleteRequestStatuses.SUBMITTED,
      DeleteRequestStatuses.APPROVAL_PENDING,
    ]);
    const rejectingApprovalStatuses = new Set<string>([
      ApprovalStatuses.REJECTED,
      ApprovalStatuses.EXPIRED,
      ApprovalStatuses.CANCELLED,
    ]);

    if (
      normalizedApprovalStatus === ApprovalStatuses.APPROVED &&
      pendingProjectionStatuses.has(request.status)
    ) {
      nextStatus = DeleteRequestStatuses.READY_TO_EXECUTE;
      action = AuditActions.DELETE_REQUEST_APPROVED;
      reason = `Approval ${approvalNo || request.latestApprovalId || ''} approved`;
      result = AuditResult.SUCCESS;
    } else if (
      rejectingApprovalStatuses.has(normalizedApprovalStatus) &&
      pendingProjectionStatuses.has(request.status)
    ) {
      nextStatus = DeleteRequestStatuses.REJECTED;
      action = AuditActions.DELETE_REQUEST_REJECTED;
      reason = `Approval ${approvalNo || request.latestApprovalId || ''} ${normalizedApprovalStatus.toLowerCase()}`;
      result = AuditResult.REJECTED;
    } else if (
      normalizedApprovalStatus === ApprovalStatuses.PENDING &&
      request.status === DeleteRequestStatuses.SUBMITTED
    ) {
      nextStatus = DeleteRequestStatuses.APPROVAL_PENDING;
    }

    if (nextStatus === request.status && normalizedApprovalStatus === currentApprovalStatus) {
      return { request };
    }

    const updated = (await this.prisma.deleteRequest.update({
      where: { id: request.id },
      data: {
        status: nextStatus,
        latestApprovalStatus: normalizedApprovalStatus,
      },
      include: this.deleteRequestInclude(),
    })) as DeleteRequestRow;

    return {
      request: updated,
      action,
      reason,
      result,
      statusFrom: request.status,
      statusTo: nextStatus,
      approvalNo,
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
    if (row.latestApprovalId && row.latestApprovalId !== event.approvalId) {
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
        projection.statusFrom,
        projection.statusTo,
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

    const created = await this.createRequestWithUniqueNo({
      targetType: target.targetType,
      targetId: target.targetId,
      targetNo: target.targetNo,
      status: DeleteRequestStatuses.DRAFT,
      latestApprovalStatus: null,
      makerUserId: actor.userId,
      deleteReason: String(dto.deleteReason || '').trim(),
      docRef: this.normalizeOptionalString(dto.docRef),
      targetSnapshotJson: this.serializeJson({}),
      traceId: this.normalizeOptionalString(dto.traceId) || randomUUID(),
    });

    await this.recordDeleteRequestAudit(
      AuditActions.DELETE_REQUEST_CREATED,
      created,
      actor,
      AuditResult.SUCCESS,
      'Delete request created',
      null,
      DeleteRequestStatuses.DRAFT,
      {
        targetSnapshotPreview: this.buildDeleteRequestSnapshot(target),
      },
      target.approvalNo || null,
    );

    return this.mapDeleteRequest(created);
  }

  async submit(id: string, dto: SubmitDeleteRequestDto, actor: ApprovalActorContext) {
    const existing = await this.findRequestOrThrow(id);
    if (existing.makerUserId !== actor.userId) {
      throw new ForbiddenException('Only the maker can submit this delete request');
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
      if (current.makerUserId !== actor.userId) {
        throw new ForbiddenException('Only the maker can submit this delete request');
      }
      if (current.status !== DeleteRequestStatuses.DRAFT) {
        throw new BadRequestException('Only DRAFT delete requests can be submitted');
      }

      await tx.deleteRequest.update({
        where: { id: current.id },
        data: {
          status: DeleteRequestStatuses.SUBMITTED,
          submittedByUserId: actor.userId,
          submittedAt: new Date(),
        },
      });

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
          status: DeleteRequestStatuses.APPROVAL_PENDING,
          latestApprovalId: approval.id,
          latestApprovalStatus: approval.status,
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
      DeleteRequestStatuses.DRAFT,
      DeleteRequestStatuses.APPROVAL_PENDING,
      {
        approvalId: approval?.id || null,
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
    if (current.makerUserId !== actor.userId && !isSuperAdmin) {
      throw new ForbiddenException('Only the maker can cancel this delete request');
    }
    const cancellableStatuses = new Set<string>([
      DeleteRequestStatuses.DRAFT,
      DeleteRequestStatuses.SUBMITTED,
      DeleteRequestStatuses.APPROVAL_PENDING,
    ]);
    if (!cancellableStatuses.has(current.status)) {
      throw new BadRequestException(
        'Only DRAFT, SUBMITTED, or APPROVAL_PENDING delete requests can be cancelled',
      );
    }

    this.assertTraceConsistency(current.traceId, dto.traceId);

    let latestApprovalStatus = current.latestApprovalStatus;
    if (current.latestApprovalId && current.latestApprovalStatus === ApprovalStatuses.PENDING) {
      const cancelledApproval = await this.approvalsService.cancel(
        current.latestApprovalId,
        {
          reason:
            this.normalizeOptionalString(dto.reason) ||
            `Delete request ${current.requestNo} cancelled`,
          traceId: current.traceId,
        },
        actor,
      );
      latestApprovalStatus = cancelledApproval.status;
    }

    const updated = (await this.prisma.deleteRequest.update({
      where: { id: current.id },
      data: {
        status: DeleteRequestStatuses.CANCELLED,
        latestApprovalStatus,
      },
      include: this.deleteRequestInclude(),
    })) as DeleteRequestRow;

    await this.recordDeleteRequestAudit(
      AuditActions.DELETE_REQUEST_CANCELLED,
      updated,
      actor,
      AuditResult.SUCCESS,
      this.normalizeOptionalString(dto.reason) || 'Delete request cancelled',
      current.status,
      DeleteRequestStatuses.CANCELLED,
      isSuperAdmin && current.makerUserId !== actor.userId ? { superAdminBypass: true } : undefined,
      updated.latestApproval?.approvalNo || null,
    );

    return this.mapDeleteRequest(updated);
  }

  async execute(id: string, dto: ExecuteDeleteRequestDto, actor: ApprovalActorContext) {
    const current = await this.findRequestOrThrow(id);
    if (current.status !== DeleteRequestStatuses.READY_TO_EXECUTE) {
      throw new BadRequestException('Only READY_TO_EXECUTE delete requests can be executed');
    }

    this.assertTraceConsistency(current.traceId, dto.traceId);

    const superAdminBypass = this.isSuperAdmin(actor) && current.makerUserId === actor.userId;
    if (current.makerUserId === actor.userId && !superAdminBypass) {
      throw new ForbiddenException('Maker cannot execute their own delete request');
    }

    const target = await this.resolveTargetById(current.targetType, current.targetId);
    const approval = await this.approvalsService.requireApproved({
      actionType: ApprovalActionTypes.DELETE_REQUEST_APPROVAL,
      entityRef: current.id,
      approvalCaseId: current.latestApprovalId || undefined,
      actor,
      traceId: current.traceId,
    });
    const targetSnapshot = this.buildDeleteRequestSnapshot(target);
    const now = new Date();

    try {
      const executed = await this.prisma.$transaction(async (tx: any) => {
        if (target.targetType === DeleteRequestTargetTypes.CHANGE_TICKET) {
          await tx.changeTicket.update({
            where: { id: target.targetId },
            data: {
              deletedAt: now,
              deletedBy: actor.userId,
              deleteRequestId: current.id,
              deleteReason: current.deleteReason,
            },
          });
        } else if (
          target.targetType === DeleteRequestTargetTypes.AUDIT_EVIDENCE_PACKAGE
        ) {
          await tx.auditEvidencePackage.update({
            where: { id: target.targetId },
            data: {
              deletedAt: now,
              deletedBy: actor.userId,
              deleteRequestId: current.id,
              deleteReason: current.deleteReason,
            },
          });
        } else if (
          target.targetType ===
          DeleteRequestTargetTypes.COMPLIANCE_CASE_EVIDENCE_PACKAGE
        ) {
          await tx.complianceCaseEvidencePackage.update({
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
            status: DeleteRequestStatuses.EXECUTED,
            executedByUserId: actor.userId,
            executedAt: now,
            targetSnapshotJson: this.serializeJson(targetSnapshot),
          },
          include: this.deleteRequestInclude(),
        })) as DeleteRequestRow;
      });

      if (current.latestApprovalId) {
        void this.approvalsService
          .markExecutionResult(
            current.latestApprovalId,
            true,
            actor,
            this.normalizeOptionalString(dto.reason) || `Delete request ${current.requestNo} executed`,
          )
          .catch(() => undefined);
      }

      await this.recordDeleteRequestAudit(
        AuditActions.DELETE_REQUEST_EXECUTED,
        executed,
        actor,
        AuditResult.SUCCESS,
        this.normalizeOptionalString(dto.reason) || 'Delete request executed',
        current.status,
        DeleteRequestStatuses.EXECUTED,
        {
          targetSnapshot,
          ...(superAdminBypass ? { superAdminBypass: true } : {}),
        },
        approval.approvalNo || null,
      );

      return this.mapDeleteRequest(executed);
    } catch (error) {
      const failed = (await this.prisma.deleteRequest.update({
        where: { id: current.id },
        data: {
          status: DeleteRequestStatuses.EXECUTION_FAILED,
          executedByUserId: actor.userId,
          executedAt: now,
          targetSnapshotJson: this.serializeJson(targetSnapshot),
        },
        include: this.deleteRequestInclude(),
      })) as DeleteRequestRow;

      if (current.latestApprovalId) {
        void this.approvalsService
          .markExecutionResult(
            current.latestApprovalId,
            false,
            actor,
            this.normalizeOptionalString(dto.reason) ||
              `Delete request ${current.requestNo} execution failed`,
          )
          .catch(() => undefined);
      }

      await this.recordDeleteRequestAudit(
        AuditActions.DELETE_REQUEST_EXECUTION_FAILED,
        failed,
        actor,
        AuditResult.FAILED,
        error instanceof Error
          ? error.message
          : this.normalizeOptionalString(dto.reason) || 'Delete request execution failed',
        current.status,
        DeleteRequestStatuses.EXECUTION_FAILED,
        {
          targetSnapshot,
          ...(superAdminBypass ? { superAdminBypass: true } : {}),
        },
        approval.approvalNo || null,
      );

      throw error;
    }
  }

  async getById(id: string, actor?: ApprovalActorContext) {
    return this.mapDeleteRequest(await this.findRequestOrThrow(id));
  }

  async list(query: DeleteRequestQueryDto, actor?: ApprovalActorContext) {
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
    if (query.latestApprovalStatus) {
      where.latestApprovalStatus = query.latestApprovalStatus.trim().toUpperCase();
    }
    if (query.traceId) {
      where.traceId = query.traceId.trim();
    }
    if (query.keyword) {
      const keyword = query.keyword.trim();
      where.OR = [
        { requestNo: { contains: keyword } },
        { targetNo: { contains: keyword } },
        { targetType: { contains: keyword } },
        { traceId: { contains: keyword } },
        { deleteReason: { contains: keyword } },
        { latestApprovalStatus: { contains: keyword } },
        {
          latestApproval: {
            approvalNo: { contains: keyword },
          },
        },
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
