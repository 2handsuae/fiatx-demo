import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import {
  AuditResult,
} from '../../audit-logging/dto/audit-log.dto';
import {
  ApprovalActorContext,
  ApprovalStatuses,
} from '../approvals/constants/approval.constants';
import { GovernanceRegistriesService } from '../registries/governance-registries.service';
import {
  AppointmentStatuses,
  GovernanceRegistrySubjectTypes,
  ShareholdingRegistryStatuses,
} from '../registries/constants/governance-registries.constants';
import {
  BindRegulatoryGateReceiptDto,
  CreateRegulatoryGateDto,
  MarkRegulatoryGateEffectiveDto,
  RecordRegulatoryGateFeedbackDto,
  RegulatoryGateQueryDto,
  RevokeRegulatoryGateDto,
  SubmitRegulatoryGateDto,
  UpdateRegulatoryGateDto,
} from './dto/regulatory-gates.dto';
import {
  RegulatoryGateAuthorities,
  RegulatoryGateEffectivenessStatuses,
  RegulatoryGateFilingStatuses,
  RegulatoryGateInternalApprovalStatuses,
  RegulatoryGatePrefixes,
  RegulatoryGateReceiptStatuses,
  RegulatoryGateResults,
  RegulatoryGateSubjectTypes,
  RegulatoryGateTypes,
} from './constants/regulatory-gates.constants';
import { WalletRole } from '../../asset-treasury/wallets/dto/wallet.dto';

type RegulatoryGateWriteClient = any;

@Injectable()
export class RegulatoryGatesService {
  private static readonly DEFAULT_TAKE = 20;

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly auditLogsService: AuditLogsService,
    private readonly governanceRegistriesService: GovernanceRegistriesService,
  ) {}

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length ? normalized : null;
  }

  private normalizeTake(take?: number): number {
    if (!take || take < 1) return RegulatoryGatesService.DEFAULT_TAKE;
    return Math.min(take, 200);
  }

  private normalizeSkip(skip?: number): number {
    if (!skip || skip < 0) return 0;
    return skip;
  }

  private buildTraceId(traceId?: string | null) {
    return this.normalizeOptionalString(traceId) || randomUUID();
  }

  private requiredString(value: unknown, field: string): string {
    const normalized = this.normalizeOptionalString(value);
    if (!normalized) {
      throw new BadRequestException(`${field} is required`);
    }
    return normalized;
  }

  private toDate(value?: string | null): Date | null {
    const normalized = this.normalizeOptionalString(value);
    if (!normalized) return null;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`Invalid date value: ${value}`);
    }
    return date;
  }

  private serializeMetadata(value: unknown): string {
    if (value === null || value === undefined) return '{}';
    try {
      return JSON.stringify(value);
    } catch {
      throw new BadRequestException('Failed to serialize regulatory gate metadata');
    }
  }

  private parseMetadata(value?: string | null): Record<string, unknown> {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private buildContains(keyword?: string | null) {
    const normalized = this.normalizeOptionalString(keyword);
    if (!normalized) return null;
    return {
      contains: normalized,
      mode: 'insensitive' as const,
    };
  }

  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorId: actor.userId,
      actorNo: actor.userNo,
      actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
    };
  }

  private mapApprovalStatusToGateStatus(status?: string | null) {
    const normalized = String(status || '').trim().toUpperCase();
    if (!normalized) {
      return RegulatoryGateInternalApprovalStatuses.NOT_REQUIRED;
    }
    if (normalized === ApprovalStatuses.APPROVED) {
      return RegulatoryGateInternalApprovalStatuses.APPROVED;
    }
    if (normalized === ApprovalStatuses.REJECTED) {
      return RegulatoryGateInternalApprovalStatuses.REJECTED;
    }
    if (normalized === ApprovalStatuses.PENDING || normalized === ApprovalStatuses.DRAFT) {
      return RegulatoryGateInternalApprovalStatuses.PENDING;
    }
    return RegulatoryGateInternalApprovalStatuses.CANCELLED;
  }

  private deriveGateProjection(input: {
    internalApprovalStatus?: string | null;
    filingStatus?: string | null;
    receiptStatus?: string | null;
    effectivenessStatus?: string | null;
  }) {
    const internalApprovalStatus =
      this.normalizeOptionalString(input.internalApprovalStatus) ||
      RegulatoryGateInternalApprovalStatuses.NOT_REQUIRED;
    const filingStatus =
      this.normalizeOptionalString(input.filingStatus) ||
      RegulatoryGateFilingStatuses.REQUIRED;
    const receiptStatus =
      this.normalizeOptionalString(input.receiptStatus) ||
      RegulatoryGateReceiptStatuses.PENDING;
    const effectivenessStatus =
      this.normalizeOptionalString(input.effectivenessStatus) ||
      RegulatoryGateEffectivenessStatuses.BLOCKED;

    if (effectivenessStatus === RegulatoryGateEffectivenessStatuses.REVOKED) {
      return {
        effectivenessStatus: RegulatoryGateEffectivenessStatuses.REVOKED,
        gateResult: RegulatoryGateResults.REVOKED,
      };
    }

    if (effectivenessStatus === RegulatoryGateEffectivenessStatuses.EFFECTIVE) {
      return {
        effectivenessStatus: RegulatoryGateEffectivenessStatuses.EFFECTIVE,
        gateResult: RegulatoryGateResults.EFFECTIVE,
      };
    }

    const internalReady =
      internalApprovalStatus === RegulatoryGateInternalApprovalStatuses.NOT_REQUIRED ||
      internalApprovalStatus === RegulatoryGateInternalApprovalStatuses.APPROVED;
    const filingReady = filingStatus === RegulatoryGateFilingStatuses.ACCEPTED;
    const receiptReady =
      receiptStatus === RegulatoryGateReceiptStatuses.BOUND ||
      receiptStatus === RegulatoryGateReceiptStatuses.REPLACED;

    if (internalReady && filingReady && receiptReady) {
      return {
        effectivenessStatus: RegulatoryGateEffectivenessStatuses.READY,
        gateResult: RegulatoryGateResults.READY,
      };
    }

    return {
      effectivenessStatus: RegulatoryGateEffectivenessStatuses.BLOCKED,
      gateResult: RegulatoryGateResults.BLOCKED,
    };
  }

  private async recordAudit(
    input: {
      action: string;
      entityId: string;
      entityNo: string;
      traceId?: string | null;
      reason?: string | null;
    },
    actor: ApprovalActorContext,
    db?: RegulatoryGateWriteClient,
  ) {
    await this.auditLogsService.recordByActor(
      {
        action: input.action,
        entityType: AuditEntityTypes.REGULATORY_GATE_ITEM,
        entityId: input.entityId,
        entityNo: input.entityNo,
        traceId: input.traceId || undefined,
        workflowType: AuditWorkflowTypes.REGULATORY_GATE,
        result: AuditResult.SUCCESS,
        reason: input.reason || undefined,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
      db,
    );
  }

  private mapSummary(row: any) {
    if (!row) return null;
    return {
      gateId: row.id,
      gateNo: row.gateNo,
      gateType: row.gateType,
      gateResult: row.gateResult,
      filingStatus: row.filingStatus,
      receiptStatus: row.receiptStatus,
      effectivenessStatus: row.effectivenessStatus,
    };
  }

  private mapGate(row: any) {
    return {
      id: row.id,
      gateNo: row.gateNo,
      gateType: row.gateType,
      authority: row.authority,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      subjectNo: row.subjectNo,
      scopeSummary: row.scopeSummary,
      shareholdingRegistryVersionId: row.shareholdingRegistryVersionId,
      appointmentRecordId: row.appointmentRecordId,
      walletId: row.walletId,
      linkedApprovalId: row.linkedApprovalId,
      internalApprovalStatus: row.internalApprovalStatus,
      filingStatus: row.filingStatus,
      receiptStatus: row.receiptStatus,
      effectivenessStatus: row.effectivenessStatus,
      gateResult: row.gateResult,
      filingRefNo: row.filingRefNo,
      filingSubmittedAt: row.filingSubmittedAt,
      latestFeedback: row.latestFeedback,
      latestFeedbackAt: row.latestFeedbackAt,
      receiptType: row.receiptType,
      receiptRefNo: row.receiptRefNo,
      receiptBoundAt: row.receiptBoundAt,
      proposedEffectiveAt: row.proposedEffectiveAt,
      effectiveAt: row.effectiveAt,
      revokedAt: row.revokedAt,
      traceId: row.traceId,
      metadataJson: this.parseMetadata(row.metadataJson),
      createdByUserId: row.createdByUserId,
      updatedByUserId: row.updatedByUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      shareholdingRegistryVersion: row.shareholdingRegistryVersion
        ? {
            id: row.shareholdingRegistryVersion.id,
            registryNo: row.shareholdingRegistryVersion.registryNo,
            status: row.shareholdingRegistryVersion.status,
          }
        : null,
      appointmentRecord: row.appointmentRecord
        ? {
            id: row.appointmentRecord.id,
            appointmentNo: row.appointmentRecord.appointmentNo,
            status: row.appointmentRecord.status,
            regulatedFlag: row.appointmentRecord.regulatedFlag,
          }
        : null,
      wallet: row.wallet
        ? {
            id: row.wallet.id,
            walletNo: row.wallet.walletNo,
            walletRole: row.wallet.walletRole,
          }
        : null,
      linkedApproval: row.linkedApproval
        ? {
            id: row.linkedApproval.id,
            approvalNo: row.linkedApproval.approvalNo,
            status: row.linkedApproval.status,
          }
        : null,
    };
  }

  private async getGateRowOrThrow(id: string, db?: RegulatoryGateWriteClient) {
    const row = await (db || this.prisma).regulatoryGateItem.findUnique({
      where: { id },
      include: {
        shareholdingRegistryVersion: true,
        appointmentRecord: true,        wallet: true,
        linkedApproval: true,
      },
    });
    if (!row) {
      throw new NotFoundException(`Regulatory gate item not found: ${id}`);
    }
    return row;
  }

  private async resolveLinkedApprovalProjection(
    linkedApprovalId: string | null,
    db: RegulatoryGateWriteClient,
  ) {
    if (!linkedApprovalId) {
      return {
        linkedApproval: null,
        internalApprovalStatus: RegulatoryGateInternalApprovalStatuses.NOT_REQUIRED,
      };
    }

    const linkedApproval = await db.approvalCase.findUnique({
      where: { id: linkedApprovalId },
    });
    if (!linkedApproval) {
      throw new NotFoundException(`Approval case not found: ${linkedApprovalId}`);
    }

    return {
      linkedApproval,
      internalApprovalStatus: this.mapApprovalStatusToGateStatus(linkedApproval.status),
    };
  }

  private async resolveCreateSubject(
    dto: CreateRegulatoryGateDto,
    db: RegulatoryGateWriteClient,
  ) {
    if (dto.gateType === RegulatoryGateTypes.CONTROL_CHANGE) {
      const shareholdingRegistryVersionId = this.requiredString(
        dto.shareholdingRegistryVersionId,
        'shareholdingRegistryVersionId',
      );
      if (this.normalizeOptionalString(dto.appointmentRecordId)) {
        throw new BadRequestException(
          'CONTROL_CHANGE cannot bind appointmentRecordId',
        );
      }
      const version = await db.shareholdingRegistryVersion.findUnique({
        where: { id: shareholdingRegistryVersionId },
      });
      if (!version) {
        throw new NotFoundException(
          `Shareholding registry version not found: ${shareholdingRegistryVersionId}`,
        );
      }
      return {
        subjectType: RegulatoryGateSubjectTypes.SHAREHOLDING_REGISTRY_VERSION,
        subjectId: version.id,
        subjectNo: version.registryNo,
        shareholdingRegistryVersionId: version.id,
        appointmentRecordId: null,        walletId: null,
      };
    }

    if (dto.gateType === RegulatoryGateTypes.REGULATED_APPOINTMENT_CHANGE) {
      const appointmentRecordId = this.requiredString(
        dto.appointmentRecordId,
        'appointmentRecordId',
      );
      if (this.normalizeOptionalString(dto.shareholdingRegistryVersionId)) {
        throw new BadRequestException(
          'REGULATED_APPOINTMENT_CHANGE cannot bind shareholdingRegistryVersionId',
        );
      }
      const appointment = await db.appointmentRecord.findUnique({
        where: { id: appointmentRecordId },
      });
      if (!appointment) {
        throw new NotFoundException(
          `Appointment record not found: ${appointmentRecordId}`,
        );
      }
      if (appointment.regulatedFlag !== true) {
        throw new BadRequestException(
          'REGULATED_APPOINTMENT_CHANGE requires regulated appointment record',
        );
      }
      return {
        subjectType: RegulatoryGateSubjectTypes.APPOINTMENT_RECORD,
        subjectId: appointment.id,
        subjectNo: appointment.appointmentNo,
        shareholdingRegistryVersionId: null,
        appointmentRecordId: appointment.id,        walletId: null,
      };
    }

    if (dto.gateType === RegulatoryGateTypes.CLIENT_BANK_ACCOUNT_ENABLEMENT) {
      const walletId = this.requiredString(dto.walletId, 'walletId');
      const wallet = await db.wallet.findUnique({
        where: { id: walletId },
      });
      if (!wallet) {
        throw new NotFoundException(`Wallet not found: ${walletId}`);
      }
      if (wallet.walletRole !== WalletRole.C_CMA) {
        throw new BadRequestException(
          'CLIENT_BANK_ACCOUNT_ENABLEMENT requires C_CMA wallet',
        );
      }
      return {
        subjectType: RegulatoryGateSubjectTypes.WALLET,
        subjectId: wallet.id,
        subjectNo: wallet.walletNo || wallet.id,
        shareholdingRegistryVersionId: null,
        appointmentRecordId: null,        walletId: wallet.id,
      };
    }

    throw new BadRequestException(`Unsupported gateType: ${dto.gateType}`);
  }

  private async ensureNoConcurrentGate(
    input: { subjectType: string; subjectId: string },
    db: RegulatoryGateWriteClient,
  ) {
    const existing = await db.regulatoryGateItem.findFirst({
      where: {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        revokedAt: null,
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    if (existing) {
      throw new BadRequestException(
        `Unrevoked regulatory gate already exists for ${input.subjectType}:${input.subjectId}`,
      );
    }
  }

  async list(query: RegulatoryGateQueryDto) {
    const keyword = this.buildContains(query.keyword);
    const where: Record<string, any> = {};
    if (query.gateType) where.gateType = query.gateType;
    if (query.subjectType) where.subjectType = query.subjectType;
    if (query.subjectNo) where.subjectNo = this.buildContains(query.subjectNo);
    if (query.gateResult) where.gateResult = query.gateResult;
    if (query.filingStatus) where.filingStatus = query.filingStatus;
    if (query.receiptStatus) where.receiptStatus = query.receiptStatus;
    if (query.effectivenessStatus) {
      where.effectivenessStatus = query.effectivenessStatus;
    }
    if (keyword) {
      where.OR = [
        { gateNo: keyword },
        { subjectNo: keyword },
        { scopeSummary: keyword },
        { filingRefNo: keyword },
        { receiptRefNo: keyword },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.regulatoryGateItem.findMany({
        where,
        skip: this.normalizeSkip(query.skip),
        take: this.normalizeTake(query.take),
        orderBy: [{ createdAt: 'desc' }],
        include: {
          shareholdingRegistryVersion: true,
          appointmentRecord: true,
          linkedApproval: true,
        },
      }),
      this.prisma.regulatoryGateItem.count({ where }),
    ]);

    return {
      items: items.map((item: any) => this.mapGate(item)),
      total,
    };
  }

  async getById(id: string) {
    const item = await this.getGateRowOrThrow(id);
    return this.mapGate(item);
  }

  async create(dto: CreateRegulatoryGateDto, actor: ApprovalActorContext) {
    return this.prisma.$transaction(async (db: RegulatoryGateWriteClient) => {
      const subject = await this.resolveCreateSubject(dto, db);
      await this.ensureNoConcurrentGate(subject, db);

      const linkedApprovalId = this.normalizeOptionalString(dto.linkedApprovalId);
      const { internalApprovalStatus } = await this.resolveLinkedApprovalProjection(
        linkedApprovalId,
        db,
      );
      const projection = this.deriveGateProjection({
        internalApprovalStatus,
        filingStatus: RegulatoryGateFilingStatuses.REQUIRED,
        receiptStatus: RegulatoryGateReceiptStatuses.PENDING,
        effectivenessStatus: RegulatoryGateEffectivenessStatuses.BLOCKED,
      });

      const created = await db.regulatoryGateItem.create({
        data: {
          gateNo: generateReferenceNo(RegulatoryGatePrefixes.GATE),
          gateType: dto.gateType,
          authority:
            this.normalizeOptionalString(dto.authority) ||
            RegulatoryGateAuthorities.VARA,
          subjectType: subject.subjectType,
          subjectId: subject.subjectId,
          subjectNo: subject.subjectNo,
          scopeSummary: this.normalizeOptionalString(dto.scopeSummary),
          shareholdingRegistryVersionId: subject.shareholdingRegistryVersionId,
          appointmentRecordId: subject.appointmentRecordId,
          walletId: subject.walletId,
          linkedApprovalId,
          internalApprovalStatus,
          filingStatus: RegulatoryGateFilingStatuses.REQUIRED,
          receiptStatus: RegulatoryGateReceiptStatuses.PENDING,
          effectivenessStatus: projection.effectivenessStatus,
          gateResult: projection.gateResult,
          proposedEffectiveAt: this.toDate(dto.proposedEffectiveAt),
          metadataJson: this.serializeMetadata(dto.metadataJson),
          traceId: this.buildTraceId(dto.traceId),
          activeKey: `${subject.subjectType}:${subject.subjectId}`,
          createdByUserId: actor.userId,
        },
        include: {
          shareholdingRegistryVersion: true,
          appointmentRecord: true,          wallet: true,
          linkedApproval: true,
        },
      });

      await this.recordAudit(
        {
          action: AuditActions.REGULATORY_GATE_CREATED,
          entityId: created.id,
          entityNo: created.gateNo,
          traceId: created.traceId,
        },
        actor,
        db,
      );

      return this.mapGate(created);
    }, { timeout: 15000 });
  }

  async update(
    id: string,
    dto: UpdateRegulatoryGateDto,
    actor: ApprovalActorContext,
  ) {
    return this.prisma.$transaction(async (db: RegulatoryGateWriteClient) => {
      const current = await this.getGateRowOrThrow(id, db);
      if (
        current.effectivenessStatus === RegulatoryGateEffectivenessStatuses.EFFECTIVE ||
        current.effectivenessStatus === RegulatoryGateEffectivenessStatuses.REVOKED
      ) {
        throw new BadRequestException(
          'Effective or revoked regulatory gate cannot be patched directly',
        );
      }

      const linkedApprovalId =
        dto.linkedApprovalId === undefined
          ? current.linkedApprovalId
          : this.normalizeOptionalString(dto.linkedApprovalId);
      const { internalApprovalStatus } = await this.resolveLinkedApprovalProjection(
        linkedApprovalId,
        db,
      );
      const projection = this.deriveGateProjection({
        internalApprovalStatus,
        filingStatus: current.filingStatus,
        receiptStatus: current.receiptStatus,
        effectivenessStatus: current.effectivenessStatus,
      });

      const updated = await db.regulatoryGateItem.update({
        where: { id },
        data: {
          authority:
            dto.authority === undefined
              ? current.authority
              : this.normalizeOptionalString(dto.authority) ||
                RegulatoryGateAuthorities.VARA,
          scopeSummary:
            dto.scopeSummary === undefined
              ? current.scopeSummary
              : this.normalizeOptionalString(dto.scopeSummary),
          linkedApprovalId,
          internalApprovalStatus,
          proposedEffectiveAt:
            dto.proposedEffectiveAt === undefined
              ? current.proposedEffectiveAt
              : this.toDate(dto.proposedEffectiveAt),
          effectivenessStatus: projection.effectivenessStatus,
          gateResult: projection.gateResult,
          metadataJson:
            dto.metadataJson === undefined
              ? current.metadataJson
              : this.serializeMetadata(dto.metadataJson),
          traceId: this.buildTraceId(dto.traceId || current.traceId),
          updatedByUserId: actor.userId,
        },
        include: {
          shareholdingRegistryVersion: true,
          appointmentRecord: true,          wallet: true,
          linkedApproval: true,
        },
      });

      await this.recordAudit(
        {
          action: AuditActions.REGULATORY_GATE_UPDATED,
          entityId: updated.id,
          entityNo: updated.gateNo,
          traceId: updated.traceId,
        },
        actor,
        db,
      );

      return this.mapGate(updated);
    }, { timeout: 15000 });
  }

  async submit(
    id: string,
    dto: SubmitRegulatoryGateDto,
    actor: ApprovalActorContext,
  ) {
    return this.prisma.$transaction(async (db: RegulatoryGateWriteClient) => {
      const current = await this.getGateRowOrThrow(id, db);
      if (
        current.filingStatus !== RegulatoryGateFilingStatuses.REQUIRED &&
        current.filingStatus !== RegulatoryGateFilingStatuses.RETURNED
      ) {
        throw new BadRequestException(
          'Only REQUIRED or RETURNED gate filings can be submitted',
        );
      }

      const updated = await db.regulatoryGateItem.update({
        where: { id },
        data: {
          filingStatus: RegulatoryGateFilingStatuses.SUBMITTED,
          filingRefNo:
            dto.filingRefNo === undefined
              ? current.filingRefNo
              : this.normalizeOptionalString(dto.filingRefNo),
          filingSubmittedAt:
            this.toDate(dto.filingSubmittedAt) || new Date(),
          traceId: this.buildTraceId(dto.traceId || current.traceId),
          updatedByUserId: actor.userId,
        },
        include: {
          shareholdingRegistryVersion: true,
          appointmentRecord: true,          wallet: true,
          linkedApproval: true,
        },
      });

      await this.recordAudit(
        {
          action: AuditActions.REGULATORY_GATE_SUBMITTED,
          entityId: updated.id,
          entityNo: updated.gateNo,
          traceId: updated.traceId,
        },
        actor,
        db,
      );

      return this.mapGate(updated);
    }, { timeout: 15000 });
  }

  async recordFeedback(
    id: string,
    dto: RecordRegulatoryGateFeedbackDto,
    actor: ApprovalActorContext,
  ) {
    return this.prisma.$transaction(async (db: RegulatoryGateWriteClient) => {
      const current = await this.getGateRowOrThrow(id, db);
      if (current.filingStatus !== RegulatoryGateFilingStatuses.SUBMITTED) {
        throw new BadRequestException(
          'Filing feedback can only be recorded after submission',
        );
      }
      if (
        dto.filingStatus !== RegulatoryGateFilingStatuses.ACCEPTED &&
        (current.receiptStatus === RegulatoryGateReceiptStatuses.BOUND ||
          current.receiptStatus === RegulatoryGateReceiptStatuses.REPLACED)
      ) {
        throw new BadRequestException(
          'Accepted filing with bound receipt cannot move to returned or rejected',
        );
      }

      const projection = this.deriveGateProjection({
        internalApprovalStatus: current.internalApprovalStatus,
        filingStatus: dto.filingStatus,
        receiptStatus: current.receiptStatus,
      });

      const updated = await db.regulatoryGateItem.update({
        where: { id },
        data: {
          filingStatus: dto.filingStatus,
          latestFeedback:
            dto.latestFeedback === undefined
              ? current.latestFeedback
              : this.normalizeOptionalString(dto.latestFeedback),
          latestFeedbackAt:
            this.toDate(dto.latestFeedbackAt) || new Date(),
          effectivenessStatus: projection.effectivenessStatus,
          gateResult: projection.gateResult,
          traceId: this.buildTraceId(dto.traceId || current.traceId),
          updatedByUserId: actor.userId,
        },
        include: {
          shareholdingRegistryVersion: true,
          appointmentRecord: true,          wallet: true,
          linkedApproval: true,
        },
      });

      await this.recordAudit(
        {
          action: AuditActions.REGULATORY_GATE_FEEDBACK_RECORDED,
          entityId: updated.id,
          entityNo: updated.gateNo,
          traceId: updated.traceId,
        },
        actor,
        db,
      );

      return this.mapGate(updated);
    }, { timeout: 15000 });
  }

  async bindReceipt(
    id: string,
    dto: BindRegulatoryGateReceiptDto,
    actor: ApprovalActorContext,
  ) {
    return this.prisma.$transaction(async (db: RegulatoryGateWriteClient) => {
      const current = await this.getGateRowOrThrow(id, db);
      if (current.filingStatus !== RegulatoryGateFilingStatuses.ACCEPTED) {
        throw new BadRequestException(
          'Receipt can only be bound after filing is accepted',
        );
      }

      const nextReceiptStatus =
        current.receiptStatus === RegulatoryGateReceiptStatuses.PENDING
          ? RegulatoryGateReceiptStatuses.BOUND
          : RegulatoryGateReceiptStatuses.REPLACED;
      const projection = this.deriveGateProjection({
        internalApprovalStatus: current.internalApprovalStatus,
        filingStatus: current.filingStatus,
        receiptStatus: nextReceiptStatus,
      });

      const updated = await db.regulatoryGateItem.update({
        where: { id },
        data: {
          receiptStatus: nextReceiptStatus,
          receiptType: dto.receiptType,
          receiptRefNo: this.requiredString(dto.receiptRefNo, 'receiptRefNo'),
          receiptBoundAt: this.toDate(dto.receiptBoundAt) || new Date(),
          effectivenessStatus: projection.effectivenessStatus,
          gateResult: projection.gateResult,
          traceId: this.buildTraceId(dto.traceId || current.traceId),
          updatedByUserId: actor.userId,
        },
        include: {
          shareholdingRegistryVersion: true,
          appointmentRecord: true,          wallet: true,
          linkedApproval: true,
        },
      });

      await this.recordAudit(
        {
          action: AuditActions.REGULATORY_GATE_RECEIPT_BOUND,
          entityId: updated.id,
          entityNo: updated.gateNo,
          traceId: updated.traceId,
        },
        actor,
        db,
      );

      return this.mapGate(updated);
    }, { timeout: 15000 });
  }

  async markEffective(
    id: string,
    dto: MarkRegulatoryGateEffectiveDto,
    actor: ApprovalActorContext,
  ) {
    const current = await this.getGateRowOrThrow(id);
    if (current.effectivenessStatus === RegulatoryGateEffectivenessStatuses.EFFECTIVE) {
      throw new BadRequestException('Regulatory gate is already effective');
    }
    if (current.effectivenessStatus === RegulatoryGateEffectivenessStatuses.REVOKED) {
      throw new BadRequestException('Revoked regulatory gate cannot become effective');
    }

    const linkedApprovalId = this.normalizeOptionalString(current.linkedApprovalId);
    const { internalApprovalStatus } = await this.resolveLinkedApprovalProjection(
      linkedApprovalId,
      this.prisma,
    );
    const internalReady =
      internalApprovalStatus === RegulatoryGateInternalApprovalStatuses.NOT_REQUIRED ||
      internalApprovalStatus === RegulatoryGateInternalApprovalStatuses.APPROVED;
    const receiptReady =
      current.receiptStatus === RegulatoryGateReceiptStatuses.BOUND ||
      current.receiptStatus === RegulatoryGateReceiptStatuses.REPLACED;

    if (
      !internalReady ||
      current.filingStatus !== RegulatoryGateFilingStatuses.ACCEPTED ||
      !receiptReady
    ) {
      throw new BadRequestException(
        'Regulatory gate cannot become effective before approval, accepted filing, and bound receipt are satisfied',
      );
    }

    const effectiveAt =
      this.toDate(dto.effectiveAt) || current.proposedEffectiveAt || new Date();

    const updated = await this.prisma.regulatoryGateItem.update({
      where: { id },
      data: {
        linkedApprovalId,
        internalApprovalStatus,
        effectivenessStatus: RegulatoryGateEffectivenessStatuses.EFFECTIVE,
        gateResult: RegulatoryGateResults.EFFECTIVE,
        effectiveAt,
        traceId: this.buildTraceId(dto.traceId || current.traceId),
        updatedByUserId: actor.userId,
      },
      include: {
        shareholdingRegistryVersion: true,
        appointmentRecord: true,        wallet: true,
        linkedApproval: true,
      },
    });

    if (updated.gateType === RegulatoryGateTypes.CONTROL_CHANGE) {
      await this.governanceRegistriesService.activateShareholdingVersionFromRegulatoryGate(
        updated.shareholdingRegistryVersionId,
        {
          effectiveAt,
          traceId: updated.traceId,
          gateId: updated.id,
          gateNo: updated.gateNo,
        },
        actor,
      );
    } else if (
      updated.gateType === RegulatoryGateTypes.REGULATED_APPOINTMENT_CHANGE
    ) {
      await this.governanceRegistriesService.activateAppointmentFromRegulatoryGate(
        updated.appointmentRecordId,
        {
          effectiveAt,
          traceId: updated.traceId,
          gateId: updated.id,
          gateNo: updated.gateNo,
        },
        actor,
      );
    }

    await this.recordAudit(
      {
        action: AuditActions.REGULATORY_GATE_MARKED_EFFECTIVE,
        entityId: updated.id,
        entityNo: updated.gateNo,
        traceId: updated.traceId,
      },
      actor,
    );

    return this.mapGate(updated);
  }

  async revoke(
    id: string,
    dto: RevokeRegulatoryGateDto,
    actor: ApprovalActorContext,
  ) {
    return this.prisma.$transaction(async (db: RegulatoryGateWriteClient) => {
      const current = await this.getGateRowOrThrow(id, db);
      if (current.effectivenessStatus === RegulatoryGateEffectivenessStatuses.REVOKED) {
        throw new BadRequestException('Regulatory gate is already revoked');
      }

      const updated = await db.regulatoryGateItem.update({
        where: { id },
        data: {
          effectivenessStatus: RegulatoryGateEffectivenessStatuses.REVOKED,
          gateResult: RegulatoryGateResults.REVOKED,
          revokedAt: this.toDate(dto.revokedAt) || new Date(),
          activeKey: null,
          traceId: this.buildTraceId(dto.traceId || current.traceId),
          updatedByUserId: actor.userId,
        },
        include: {
          shareholdingRegistryVersion: true,
          appointmentRecord: true,          wallet: true,
          linkedApproval: true,
        },
      });

      await this.recordAudit(
        {
          action: AuditActions.REGULATORY_GATE_REVOKED,
          entityId: updated.id,
          entityNo: updated.gateNo,
          traceId: updated.traceId,
          reason: this.normalizeOptionalString(dto.reason),
        },
        actor,
        db,
      );

      return this.mapGate(updated);
    });
  }
}
