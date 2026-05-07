import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
  buildStateTransitionAction,
} from '../../audit-logging/constants/audit-actions.constant';
import {
  AuditResult,
} from '../../audit-logging/dto/audit-log.dto';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import {
  AppointmentStatuses,
  ConflictDisclosureStatuses,
  GovernanceRegistryPrefixes,

  GovernanceRegistrySubjectTypes,
  ShareholdingParticipantTypes,
  ShareholdingRegistryStatuses,
  TrainingStatuses,
  WindDownMaterialStatuses,
} from './constants/governance-registries.constants';
import {
  CreateAppointmentRecordDto,
  CreateConflictDisclosureDto,
  CreateShareholdingRegistryVersionDto,
  CreateTrainingRecordDto,
  CreateWindDownMaterialRecordDto,
  GovernanceRegistryQueryDto,
  ShareholdingParticipantDto,
  UpdateAppointmentRecordDto,
  UpdateConflictDisclosureDto,
  UpdateShareholdingRegistryVersionDto,
  UpdateTrainingRecordDto,
  UpdateWindDownMaterialRecordDto,
} from './dto/governance-registries.dto';

type RegistryWriteClient = any;
type RegistryUpdateOptions = {
  bypassRegulatoryGateCheck?: boolean;
  ignoreRegulatoryGateId?: string | null;
  auditReason?: string | null;
};

@Injectable()
export class GovernanceRegistriesService {
  private static readonly DEFAULT_TAKE = 20;

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length ? normalized : null;
  }

  private normalizeTake(take?: number): number {
    if (!take || take < 1) return GovernanceRegistriesService.DEFAULT_TAKE;
    return Math.min(take, 200);
  }

  private normalizeSkip(skip?: number): number {
    if (!skip || skip < 0) return 0;
    return skip;
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

  private toDecimal(value?: string | null): Prisma.Decimal | null {
    const normalized = this.normalizeOptionalString(value);
    if (!normalized) return null;
    return new Prisma.Decimal(normalized);
  }

  private serializeMetadata(value: unknown): string {
    if (value === null || value === undefined) return '{}';
    try {
      return JSON.stringify(value);
    } catch {
      throw new BadRequestException('Failed to serialize metadataJson');
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

  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorId: actor.userId,
      actorNo: actor.userNo,
      actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
    };
  }

  private async recordAudit(input: {
    action: string;
    entityType: string;
    entityId: string;
    entityNo: string;
    traceId?: string | null;
    reason?: string | null;
  }, actor: ApprovalActorContext) {
    await this.auditLogsService.recordByActor(
      {
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        entityNo: input.entityNo,
        traceId: input.traceId || undefined,
        workflowType: AuditWorkflowTypes.GOVERNANCE_REGISTRY,
        result: AuditResult.SUCCESS,
        reason: input.reason || undefined,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );
  }

  private statusAction(entity: string, before: string, after: string) {
    return buildStateTransitionAction(entity, before, after);
  }

  private participantPayload(participant: ShareholdingParticipantDto, index: number) {
    return {
      participantType:
        this.normalizeOptionalString(participant.participantType) ||
        ShareholdingParticipantTypes.SHAREHOLDER,
      participantName: this.normalizeOptionalString(participant.participantName) || 'UNKNOWN',
      ownershipPercent: this.toDecimal(participant.ownershipPercent || null),
      controlSummary: this.normalizeOptionalString(participant.controlSummary),
      evidenceRef: this.normalizeOptionalString(participant.evidenceRef),
      metadataJson: this.serializeMetadata(participant.metadataJson),
      sortOrder: index,
    };
  }

  private mapParticipant(item: any) {
    return {
      id: item.id,
      participantType: item.participantType,
      participantName: item.participantName,
      ownershipPercent:
        item.ownershipPercent instanceof Prisma.Decimal
          ? item.ownershipPercent.toString()
          : item.ownershipPercent || null,
      controlSummary: item.controlSummary,
      evidenceRef: item.evidenceRef,
      metadataJson: this.parseMetadata(item.metadataJson),
      sortOrder: item.sortOrder,
    };
  }

  private mapShareholdingVersion(item: any, regulatoryGateSummary?: Record<string, unknown> | null) {
    return {
      id: item.id,
      registryNo: item.registryNo,
      status: item.status,
      versionLabel: item.versionLabel,
      effectiveFrom: item.effectiveFrom,
      effectiveTo: item.effectiveTo,
      supersededById: item.supersededById,
      latestApprovalId: item.latestApprovalId,
      latestApprovalStatus: item.latestApprovalStatus,
      docRef: item.docRef,
      evidenceRef: item.evidenceRef,
      traceId: item.traceId,
      metadataJson: this.parseMetadata(item.metadataJson),
      createdByUserId: item.createdByUserId,
      updatedByUserId: item.updatedByUserId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      subjectType: GovernanceRegistrySubjectTypes.SHAREHOLDING_REGISTRY_VERSION,
      subjectId: item.id,
      subjectNo: item.registryNo,
      regulatoryGateSummary: regulatoryGateSummary || null,
      participants: Array.isArray(item.participants)
        ? item.participants
            .sort((left: any, right: any) => left.sortOrder - right.sortOrder)
            .map((participant: any) => this.mapParticipant(participant))
        : [],
    };
  }

  private mapAppointment(item: any, regulatoryGateSummary?: Record<string, unknown> | null) {
    return {
      id: item.id,
      appointmentNo: item.appointmentNo,
      status: item.status,
      roleType: item.roleType,
      personName: item.personName,
      regulatedFlag: item.regulatedFlag,
      proposedEffectiveAt: item.proposedEffectiveAt,
      effectiveAt: item.effectiveAt,
      endedAt: item.endedAt,
      latestApprovalId: item.latestApprovalId,
      latestApprovalStatus: item.latestApprovalStatus,
      docRef: item.docRef,
      evidenceRef: item.evidenceRef,
      traceId: item.traceId,
      metadataJson: this.parseMetadata(item.metadataJson),
      createdByUserId: item.createdByUserId,
      updatedByUserId: item.updatedByUserId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      subjectType: GovernanceRegistrySubjectTypes.APPOINTMENT_RECORD,
      subjectId: item.id,
      subjectNo: item.appointmentNo,
      regulatoryGateSummary: regulatoryGateSummary || null,
    };
  }

  private async findRegulatoryGateSummary(
    db: RegistryWriteClient,
    subjectType: string,
    subjectId: string,
  ) {
    const gate = await db.regulatoryGateItem.findFirst({
      where: {
        subjectType,
        subjectId,
        revokedAt: null,
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    if (!gate) return null;
    return {
      gateId: gate.id,
      gateNo: gate.gateNo,
      gateType: gate.gateType,
      gateResult: gate.gateResult,
      filingStatus: gate.filingStatus,
      receiptStatus: gate.receiptStatus,
      effectivenessStatus: gate.effectivenessStatus,
    };
  }

  private async ensureNoBlockingRegulatoryGate(input: {
    db: RegistryWriteClient;
    subjectType: string;
    subjectId: string;
    nextStatus: string;
    activeStatus: string;
    bypassRegulatoryGateCheck?: boolean;
    ignoreRegulatoryGateId?: string | null;
  }) {
    if (input.bypassRegulatoryGateCheck || input.nextStatus !== input.activeStatus) {
      return;
    }

    const gate = await input.db.regulatoryGateItem.findFirst({
      where: {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        revokedAt: null,
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    if (gate && gate.id !== input.ignoreRegulatoryGateId) {
      throw new BadRequestException(
        `${input.subjectType} cannot be activated manually while regulatory gate ${gate.gateNo} remains active`,
      );
    }
  }

  private deriveTrainingStatus(status?: string | null, dueAt?: Date | null, completedAt?: Date | null) {
    const normalized = this.normalizeOptionalString(status) || TrainingStatuses.ASSIGNED;
    if (normalized === TrainingStatuses.WAIVED) return TrainingStatuses.WAIVED;
    if (completedAt) return TrainingStatuses.COMPLETED;
    if (dueAt && dueAt.getTime() < Date.now()) return TrainingStatuses.OVERDUE;
    return normalized;
  }

  private mapTraining(item: any) {
    return {
      id: item.id,
      trainingNo: item.trainingNo,
      status: this.deriveTrainingStatus(item.status, item.dueAt, item.completedAt),
      assignee: item.assignee,
      trainingType: item.trainingType,
      dueAt: item.dueAt,
      completedAt: item.completedAt,
      evidenceRef: item.evidenceRef,
      waiverReason: item.waiverReason,
      traceId: item.traceId,
      metadataJson: this.parseMetadata(item.metadataJson),
      createdByUserId: item.createdByUserId,
      updatedByUserId: item.updatedByUserId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      subjectType: GovernanceRegistrySubjectTypes.TRAINING_RECORD,
      subjectId: item.id,
      subjectNo: item.trainingNo,
    };
  }

  private mapConflict(item: any) {
    return {
      id: item.id,
      disclosureNo: item.disclosureNo,
      status: item.status,
      disclosureType: item.disclosureType,
      disclosedByName: item.disclosedByName,
      disclosedAt: item.disclosedAt,
      reviewDueAt: item.reviewDueAt,
      mitigationSummary: item.mitigationSummary,
      closedAt: item.closedAt,
      evidenceRef: item.evidenceRef,
      traceId: item.traceId,
      metadataJson: this.parseMetadata(item.metadataJson),
      createdByUserId: item.createdByUserId,
      updatedByUserId: item.updatedByUserId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      subjectType: GovernanceRegistrySubjectTypes.CONFLICT_DISCLOSURE,
      subjectId: item.id,
      subjectNo: item.disclosureNo,
    };
  }

  private mapWindDownMaterial(item: any) {
    return {
      id: item.id,
      materialNo: item.materialNo,
      status: item.status,
      materialType: item.materialType,
      versionLabel: item.versionLabel,
      effectiveAt: item.effectiveAt,
      reviewDueAt: item.reviewDueAt,
      supersededAt: item.supersededAt,
      supersededById: item.supersededById,
      evidenceRef: item.evidenceRef,
      traceId: item.traceId,
      metadataJson: this.parseMetadata(item.metadataJson),
      createdByUserId: item.createdByUserId,
      updatedByUserId: item.updatedByUserId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      subjectType: GovernanceRegistrySubjectTypes.WIND_DOWN_MATERIAL,
      subjectId: item.id,
      subjectNo: item.materialNo,
    };
  }

  private buildContains(keyword?: string | null) {
    const normalized = this.normalizeOptionalString(keyword);
    if (!normalized) return null;
    return {
      contains: normalized,
      mode: 'insensitive' as const,
    };
  }

  async listShareholdingVersions(query: GovernanceRegistryQueryDto) {
    const keyword = this.buildContains(query.keyword);
    const where: Record<string, any> = {};
    if (query.status) where.status = query.status;
    if (keyword) {
      where.OR = [
        { registryNo: keyword },
        { versionLabel: keyword },
        { evidenceRef: keyword },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.shareholdingRegistryVersion.findMany({
        where,
        skip: this.normalizeSkip(query.skip),
        take: this.normalizeTake(query.take),
        orderBy: [{ createdAt: 'desc' }],
        include: {
          participants: {
            orderBy: [{ sortOrder: 'asc' }],
          },
        },
      }),
      this.prisma.shareholdingRegistryVersion.count({ where }),
    ]);

    return {
      items: items.map((item: any) => this.mapShareholdingVersion(item)),
      total,
    };
  }

  async getShareholdingVersion(id: string) {
    const item = await this.prisma.shareholdingRegistryVersion.findUnique({
      where: { id },
      include: {
        participants: {
          orderBy: [{ sortOrder: 'asc' }],
        },
      },
    });
    if (!item) {
      throw new NotFoundException(`Shareholding registry version not found: ${id}`);
    }
    const regulatoryGateSummary = await this.findRegulatoryGateSummary(
      this.prisma,
      GovernanceRegistrySubjectTypes.SHAREHOLDING_REGISTRY_VERSION,
      item.id,
    );
    return this.mapShareholdingVersion(item, regulatoryGateSummary);
  }

  async createShareholdingVersion(
    dto: CreateShareholdingRegistryVersionDto,
    actor: ApprovalActorContext,
  ) {
    const outcome = await this.prisma.$transaction(async (db: RegistryWriteClient) => {
      let superseded: any = null;
      if (dto.supersedesId) {
        superseded = await db.shareholdingRegistryVersion.findUnique({
          where: { id: dto.supersedesId },
        });
        if (!superseded) {
          throw new NotFoundException(`Shareholding registry version not found: ${dto.supersedesId}`);
        }
      }

      const effectiveFrom = this.toDate(dto.effectiveFrom);
      const created = await db.shareholdingRegistryVersion.create({
        data: {
          registryNo: generateReferenceNo(GovernanceRegistryPrefixes.SHAREHOLDING),
          status:
            this.normalizeOptionalString(dto.status) || ShareholdingRegistryStatuses.DRAFT,
          versionLabel: this.normalizeOptionalString(dto.versionLabel),
          effectiveFrom,
          docRef: this.normalizeOptionalString(dto.docRef),
          evidenceRef: this.normalizeOptionalString(dto.evidenceRef),
          latestApprovalId: null,
          latestApprovalStatus: null,
          metadataJson: this.serializeMetadata(dto.metadataJson),
          traceId: this.buildTraceId(dto.traceId),
          createdByUserId: actor.userId,
          participants: {
            create: (dto.participants || []).map((item, index) =>
              this.participantPayload(item, index),
            ),
          },
        },
        include: {
          participants: {
            orderBy: [{ sortOrder: 'asc' }],
          },
        },
      });

      if (superseded) {
        await db.shareholdingRegistryVersion.update({
          where: { id: superseded.id },
          data: {
            status: ShareholdingRegistryStatuses.SUPERSEDED,
            supersededById: created.id,
            effectiveTo: effectiveFrom || superseded.effectiveTo || new Date(),
            updatedByUserId: actor.userId,
          },
        });
      }
      return {
        created,
        superseded,
      };
    }, { timeout: 15000 });

    await this.recordAudit(
      {
        action: AuditActions.SHAREHOLDING_REGISTRY_CREATED,
        entityType: AuditEntityTypes.SHAREHOLDING_REGISTRY_VERSION,
        entityId: outcome.created.id,
        entityNo: outcome.created.registryNo,
        traceId: outcome.created.traceId,
      },
      actor,
    );

    if (
      outcome.superseded &&
      outcome.superseded.status !== ShareholdingRegistryStatuses.SUPERSEDED
    ) {
      await this.recordAudit(
        {
          action: this.statusAction(
            'SHAREHOLDING_REGISTRY',
            outcome.superseded.status,
            ShareholdingRegistryStatuses.SUPERSEDED,
          ),
          entityType: AuditEntityTypes.SHAREHOLDING_REGISTRY_VERSION,
          entityId: outcome.superseded.id,
          entityNo: outcome.superseded.registryNo,
          traceId: outcome.superseded.traceId,
          reason: `Superseded by ${outcome.created.registryNo}`,
        },
        actor,
      );
    }

    return this.mapShareholdingVersion(outcome.created);
  }

  async updateShareholdingVersion(
    id: string,
    dto: UpdateShareholdingRegistryVersionDto,
    actor: ApprovalActorContext,
    options: RegistryUpdateOptions = {},
  ) {
    const outcome = await this.prisma.$transaction(async (db: RegistryWriteClient) => {
      const current = await db.shareholdingRegistryVersion.findUnique({
        where: { id },
        include: { participants: true },
      });
      if (!current) {
        throw new NotFoundException(`Shareholding registry version not found: ${id}`);
      }

      const nextStatus =
        this.normalizeOptionalString(dto.status) || current.status;
      await this.ensureNoBlockingRegulatoryGate({
        db,
        subjectType: GovernanceRegistrySubjectTypes.SHAREHOLDING_REGISTRY_VERSION,
        subjectId: current.id,
        nextStatus,
        activeStatus: ShareholdingRegistryStatuses.ACTIVE,
        bypassRegulatoryGateCheck: options.bypassRegulatoryGateCheck,
        ignoreRegulatoryGateId: options.ignoreRegulatoryGateId,
      });
      const updateData: Record<string, unknown> = {
        status: nextStatus,
        versionLabel:
          dto.versionLabel === undefined
            ? current.versionLabel
            : this.normalizeOptionalString(dto.versionLabel),
        effectiveFrom:
          dto.effectiveFrom === undefined
            ? current.effectiveFrom
            : this.toDate(dto.effectiveFrom),
        effectiveTo:
          dto.effectiveTo === undefined
            ? current.effectiveTo
            : this.toDate(dto.effectiveTo),
        docRef:
          dto.docRef === undefined ? current.docRef : this.normalizeOptionalString(dto.docRef),
        evidenceRef:
          dto.evidenceRef === undefined
            ? current.evidenceRef
            : this.normalizeOptionalString(dto.evidenceRef),
        metadataJson:
          dto.metadataJson === undefined
            ? current.metadataJson
            : this.serializeMetadata(dto.metadataJson),
        traceId: this.buildTraceId(dto.traceId || current.traceId),
        updatedByUserId: actor.userId,
      };

      if (
        nextStatus === ShareholdingRegistryStatuses.SUPERSEDED &&
        updateData.effectiveTo === current.effectiveTo
      ) {
        updateData.effectiveTo = new Date();
      }

      if (dto.participants) {
        updateData.participants = {
          deleteMany: {},
          create: dto.participants.map((item, index) =>
            this.participantPayload(item, index),
          ),
        };
      }

      const updated = await db.shareholdingRegistryVersion.update({
        where: { id },
        data: updateData,
        include: {
          participants: {
            orderBy: [{ sortOrder: 'asc' }],
          },
        },
      });
      return {
        current,
        updated,
      };
    }, { timeout: 15000 });

    await this.recordAudit(
      {
        action:
          outcome.current.status !== outcome.updated.status
            ? this.statusAction(
                'SHAREHOLDING_REGISTRY',
                outcome.current.status,
                outcome.updated.status,
              )
            : AuditActions.SHAREHOLDING_REGISTRY_UPDATED,
        entityType: AuditEntityTypes.SHAREHOLDING_REGISTRY_VERSION,
        entityId: outcome.updated.id,
        entityNo: outcome.updated.registryNo,
        traceId: outcome.updated.traceId,
        reason: options.auditReason || undefined,
      },
      actor,
    );

    return this.mapShareholdingVersion(outcome.updated);
  }

  async listAppointments(query: GovernanceRegistryQueryDto) {
    const keyword = this.buildContains(query.keyword);
    const where: Record<string, any> = {};
    if (query.status) where.status = query.status;
    if (keyword) {
      where.OR = [
        { appointmentNo: keyword },
        { roleType: keyword },
        { personName: keyword },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.appointmentRecord.findMany({
        where,
        skip: this.normalizeSkip(query.skip),
        take: this.normalizeTake(query.take),
        orderBy: [{ createdAt: 'desc' }],
      }),
      this.prisma.appointmentRecord.count({ where }),
    ]);

    return {
      items: items.map((item: any) => this.mapAppointment(item)),
      total,
    };
  }

  async getAppointment(id: string) {
    const item = await this.prisma.appointmentRecord.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException(`Appointment record not found: ${id}`);
    }
    const regulatoryGateSummary = await this.findRegulatoryGateSummary(
      this.prisma,
      GovernanceRegistrySubjectTypes.APPOINTMENT_RECORD,
      item.id,
    );
    return this.mapAppointment(item, regulatoryGateSummary);
  }

  async createAppointment(dto: CreateAppointmentRecordDto, actor: ApprovalActorContext) {
    const created = await this.prisma.appointmentRecord.create({
      data: {
        appointmentNo: generateReferenceNo(GovernanceRegistryPrefixes.APPOINTMENT),
        status: this.normalizeOptionalString(dto.status) || AppointmentStatuses.PLANNED,
        roleType: this.requiredString(dto.roleType, 'roleType'),
        personName: this.requiredString(dto.personName, 'personName'),
        regulatedFlag: dto.regulatedFlag === true,
        proposedEffectiveAt: this.toDate(dto.proposedEffectiveAt),
        effectiveAt: this.toDate(dto.effectiveAt),
        latestApprovalId: null,
        latestApprovalStatus: null,
        docRef: this.normalizeOptionalString(dto.docRef),
        evidenceRef: this.normalizeOptionalString(dto.evidenceRef),
        metadataJson: this.serializeMetadata(dto.metadataJson),
        traceId: this.buildTraceId(dto.traceId),
        createdByUserId: actor.userId,
      },
    });

    await this.recordAudit(
      {
        action: AuditActions.APPOINTMENT_RECORD_CREATED,
        entityType: AuditEntityTypes.APPOINTMENT_RECORD,
        entityId: created.id,
        entityNo: created.appointmentNo,
        traceId: created.traceId,
      },
      actor,
    );

    const regulatoryGateSummary = await this.findRegulatoryGateSummary(
      this.prisma,
      GovernanceRegistrySubjectTypes.APPOINTMENT_RECORD,
      created.id,
    );
    return this.mapAppointment(created, regulatoryGateSummary);
  }

  async updateAppointment(
    id: string,
    dto: UpdateAppointmentRecordDto,
    actor: ApprovalActorContext,
    options: RegistryUpdateOptions = {},
  ) {
    const current = await this.prisma.appointmentRecord.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException(`Appointment record not found: ${id}`);
    }

    const nextStatus = this.normalizeOptionalString(dto.status) || current.status;
    await this.ensureNoBlockingRegulatoryGate({
      db: this.prisma,
      subjectType: GovernanceRegistrySubjectTypes.APPOINTMENT_RECORD,
      subjectId: current.id,
      nextStatus,
      activeStatus: AppointmentStatuses.ACTIVE,
      bypassRegulatoryGateCheck: options.bypassRegulatoryGateCheck,
      ignoreRegulatoryGateId: options.ignoreRegulatoryGateId,
    });
    const nextEndedAt =
      dto.endedAt !== undefined
        ? this.toDate(dto.endedAt)
        : nextStatus === AppointmentStatuses.ENDED && !current.endedAt
          ? new Date()
          : current.endedAt;

    const updated = await this.prisma.appointmentRecord.update({
      where: { id },
      data: {
        status: nextStatus,
        roleType:
          dto.roleType === undefined ? current.roleType : this.requiredString(dto.roleType, 'roleType'),
        personName:
          dto.personName === undefined
            ? current.personName
            : this.requiredString(dto.personName, 'personName'),
        regulatedFlag:
          dto.regulatedFlag === undefined ? current.regulatedFlag : dto.regulatedFlag === true,
        proposedEffectiveAt:
          dto.proposedEffectiveAt === undefined
            ? current.proposedEffectiveAt
            : this.toDate(dto.proposedEffectiveAt),
        effectiveAt:
          dto.effectiveAt === undefined ? current.effectiveAt : this.toDate(dto.effectiveAt),
        endedAt: nextEndedAt,
        docRef:
          dto.docRef === undefined ? current.docRef : this.normalizeOptionalString(dto.docRef),
        evidenceRef:
          dto.evidenceRef === undefined
            ? current.evidenceRef
            : this.normalizeOptionalString(dto.evidenceRef),
        metadataJson:
          dto.metadataJson === undefined
            ? current.metadataJson
            : this.serializeMetadata(dto.metadataJson),
        traceId: this.buildTraceId(dto.traceId || current.traceId),
        updatedByUserId: actor.userId,
      },
    });

    await this.recordAudit(
      {
        action:
          current.status !== updated.status
            ? this.statusAction('APPOINTMENT_RECORD', current.status, updated.status)
            : AuditActions.APPOINTMENT_RECORD_UPDATED,
        entityType: AuditEntityTypes.APPOINTMENT_RECORD,
        entityId: updated.id,
        entityNo: updated.appointmentNo,
        traceId: updated.traceId,
        reason: options.auditReason || undefined,
      },
      actor,
    );

    const regulatoryGateSummary = await this.findRegulatoryGateSummary(
      this.prisma,
      GovernanceRegistrySubjectTypes.APPOINTMENT_RECORD,
      updated.id,
    );
    return this.mapAppointment(updated, regulatoryGateSummary);
  }

  async activateShareholdingVersionFromRegulatoryGate(
    id: string | null | undefined,
    input: {
      effectiveAt?: Date | null;
      traceId?: string | null;
      gateId?: string | null;
      gateNo?: string | null;
    },
    actor: ApprovalActorContext,
  ) {
    const targetId = this.requiredString(id, 'shareholdingRegistryVersionId');
    const current = await this.prisma.shareholdingRegistryVersion.findUnique({
      where: { id: targetId },
    });
    if (!current) {
      throw new NotFoundException(
        `Shareholding registry version not found: ${targetId}`,
      );
    }
    if (current.status === ShareholdingRegistryStatuses.ACTIVE) {
      return this.getShareholdingVersion(targetId);
    }

    return this.updateShareholdingVersion(
      targetId,
      {
        status: ShareholdingRegistryStatuses.ACTIVE,
        effectiveFrom:
          current.effectiveFrom || !input.effectiveAt
            ? undefined
            : input.effectiveAt.toISOString(),
        traceId: this.normalizeOptionalString(input.traceId) || current.traceId,
      },
      actor,
      {
        bypassRegulatoryGateCheck: true,
        ignoreRegulatoryGateId: input.gateId,
        auditReason: `Activated by regulatory gate ${input.gateNo || input.gateId || 'UNKNOWN'}`,
      },
    );
  }

  async activateAppointmentFromRegulatoryGate(
    id: string | null | undefined,
    input: {
      effectiveAt?: Date | null;
      traceId?: string | null;
      gateId?: string | null;
      gateNo?: string | null;
    },
    actor: ApprovalActorContext,
  ) {
    const targetId = this.requiredString(id, 'appointmentRecordId');
    const current = await this.prisma.appointmentRecord.findUnique({
      where: { id: targetId },
    });
    if (!current) {
      throw new NotFoundException(`Appointment record not found: ${targetId}`);
    }
    if (current.status === AppointmentStatuses.ACTIVE) {
      return this.getAppointment(targetId);
    }

    const effectiveAt =
      input.effectiveAt || current.proposedEffectiveAt || current.effectiveAt || new Date();

    return this.updateAppointment(
      targetId,
      {
        status: AppointmentStatuses.ACTIVE,
        effectiveAt: effectiveAt.toISOString(),
        traceId: this.normalizeOptionalString(input.traceId) || current.traceId,
      },
      actor,
      {
        bypassRegulatoryGateCheck: true,
        ignoreRegulatoryGateId: input.gateId,
        auditReason: `Activated by regulatory gate ${input.gateNo || input.gateId || 'UNKNOWN'}`,
      },
    );
  }

  async listTrainings(query: GovernanceRegistryQueryDto) {
    const keyword = this.buildContains(query.keyword);
    const where: Record<string, any> = {};
    if (query.status) where.status = query.status;
    if (keyword) {
      where.OR = [
        { trainingNo: keyword },
        { assignee: keyword },
        { trainingType: keyword },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.trainingRecord.findMany({
        where,
        skip: this.normalizeSkip(query.skip),
        take: this.normalizeTake(query.take),
        orderBy: [{ createdAt: 'desc' }],
      }),
      this.prisma.trainingRecord.count({ where }),
    ]);

    return {
      items: items.map((item: any) => this.mapTraining(item)),
      total,
    };
  }

  async getTraining(id: string) {
    const item = await this.prisma.trainingRecord.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException(`Training record not found: ${id}`);
    }
    return this.mapTraining(item);
  }

  async createTraining(dto: CreateTrainingRecordDto, actor: ApprovalActorContext) {
    const dueAt = this.toDate(dto.dueAt);
    const completedAt = this.toDate(dto.completedAt);
    const created = await this.prisma.trainingRecord.create({
      data: {
        trainingNo: generateReferenceNo(GovernanceRegistryPrefixes.TRAINING),
        status: this.deriveTrainingStatus(dto.status, dueAt, completedAt),
        assignee: this.requiredString(dto.assignee, 'assignee'),
        trainingType: this.requiredString(dto.trainingType, 'trainingType'),
        dueAt,
        completedAt,
        evidenceRef: this.normalizeOptionalString(dto.evidenceRef),
        waiverReason: this.normalizeOptionalString(dto.waiverReason),
        metadataJson: this.serializeMetadata(dto.metadataJson),
        traceId: this.buildTraceId(dto.traceId),
        createdByUserId: actor.userId,
      },
    });


    await this.recordAudit(
      {
        action: AuditActions.TRAINING_RECORD_CREATED,
        entityType: AuditEntityTypes.TRAINING_RECORD,
        entityId: created.id,
        entityNo: created.trainingNo,
        traceId: created.traceId,
      },
      actor,
    );

    return this.mapTraining(created);
  }

  async updateTraining(id: string, dto: UpdateTrainingRecordDto, actor: ApprovalActorContext) {
    const current = await this.prisma.trainingRecord.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException(`Training record not found: ${id}`);
    }

    const dueAt =
      dto.dueAt === undefined ? current.dueAt : this.toDate(dto.dueAt);
    const completedAt =
      dto.completedAt === undefined ? current.completedAt : this.toDate(dto.completedAt);
    const nextStatus = this.deriveTrainingStatus(
      dto.status || current.status,
      dueAt,
      completedAt,
    );

    const updated = await this.prisma.trainingRecord.update({
      where: { id },
      data: {
        status: nextStatus,
        assignee:
          dto.assignee === undefined ? current.assignee : this.requiredString(dto.assignee, 'assignee'),
        trainingType:
          dto.trainingType === undefined
            ? current.trainingType
            : this.requiredString(dto.trainingType, 'trainingType'),
        dueAt,
        completedAt,
        evidenceRef:
          dto.evidenceRef === undefined
            ? current.evidenceRef
            : this.normalizeOptionalString(dto.evidenceRef),
        waiverReason:
          dto.waiverReason === undefined
            ? current.waiverReason
            : this.normalizeOptionalString(dto.waiverReason),
        metadataJson:
          dto.metadataJson === undefined
            ? current.metadataJson
            : this.serializeMetadata(dto.metadataJson),
        traceId: this.buildTraceId(dto.traceId || current.traceId),
        updatedByUserId: actor.userId,
      },
    });

    await this.recordAudit(
      {
        action:
          current.status !== updated.status
            ? this.statusAction('TRAINING_RECORD', current.status, updated.status)
            : AuditActions.TRAINING_RECORD_UPDATED,
        entityType: AuditEntityTypes.TRAINING_RECORD,
        entityId: updated.id,
        entityNo: updated.trainingNo,
        traceId: updated.traceId,
      },
      actor,
    );

    return this.mapTraining(updated);
  }

  async listConflicts(query: GovernanceRegistryQueryDto) {
    const keyword = this.buildContains(query.keyword);
    const where: Record<string, any> = {};
    if (query.status) where.status = query.status;
    if (keyword) {
      where.OR = [
        { disclosureNo: keyword },
        { disclosedByName: keyword },
        { disclosureType: keyword },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.conflictDisclosure.findMany({
        where,
        skip: this.normalizeSkip(query.skip),
        take: this.normalizeTake(query.take),
        orderBy: [{ createdAt: 'desc' }],
      }),
      this.prisma.conflictDisclosure.count({ where }),
    ]);

    return {
      items: items.map((item: any) => this.mapConflict(item)),
      total,
    };
  }

  async getConflict(id: string) {
    const item = await this.prisma.conflictDisclosure.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException(`Conflict disclosure not found: ${id}`);
    }
    return this.mapConflict(item);
  }

  async createConflictDisclosure(
    dto: CreateConflictDisclosureDto,
    actor: ApprovalActorContext,
  ) {
    const created = await this.prisma.conflictDisclosure.create({
      data: {
        disclosureNo: generateReferenceNo(GovernanceRegistryPrefixes.CONFLICT),
        status:
          this.normalizeOptionalString(dto.status) || ConflictDisclosureStatuses.OPEN,
        disclosureType: this.requiredString(dto.disclosureType, 'disclosureType'),
        disclosedByName: this.requiredString(dto.disclosedByName, 'disclosedByName'),
        disclosedAt: this.toDate(dto.disclosedAt) || new Date(),
        reviewDueAt: this.toDate(dto.reviewDueAt),
        mitigationSummary: this.normalizeOptionalString(dto.mitigationSummary),
        evidenceRef: this.normalizeOptionalString(dto.evidenceRef),
        metadataJson: this.serializeMetadata(dto.metadataJson),
        traceId: this.buildTraceId(dto.traceId),
        createdByUserId: actor.userId,
      },
    });


    await this.recordAudit(
      {
        action: AuditActions.CONFLICT_DISCLOSURE_CREATED,
        entityType: AuditEntityTypes.CONFLICT_DISCLOSURE,
        entityId: created.id,
        entityNo: created.disclosureNo,
        traceId: created.traceId,
      },
      actor,
    );

    return this.mapConflict(created);
  }

  async updateConflictDisclosure(
    id: string,
    dto: UpdateConflictDisclosureDto,
    actor: ApprovalActorContext,
  ) {
    const current = await this.prisma.conflictDisclosure.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException(`Conflict disclosure not found: ${id}`);
    }

    const nextStatus = this.normalizeOptionalString(dto.status) || current.status;
    const nextClosedAt =
      dto.closedAt !== undefined
        ? this.toDate(dto.closedAt)
        : (nextStatus === ConflictDisclosureStatuses.MITIGATED ||
            nextStatus === ConflictDisclosureStatuses.CLOSED) &&
          !current.closedAt
          ? new Date()
          : current.closedAt;

    const updated = await this.prisma.conflictDisclosure.update({
      where: { id },
      data: {
        status: nextStatus,
        disclosureType:
          dto.disclosureType === undefined
            ? current.disclosureType
            : this.requiredString(dto.disclosureType, 'disclosureType'),
        disclosedByName:
          dto.disclosedByName === undefined
            ? current.disclosedByName
            : this.requiredString(dto.disclosedByName, 'disclosedByName'),
        disclosedAt:
          dto.disclosedAt === undefined
            ? current.disclosedAt
            : this.toDate(dto.disclosedAt) || current.disclosedAt,
        reviewDueAt:
          dto.reviewDueAt === undefined
            ? current.reviewDueAt
            : this.toDate(dto.reviewDueAt),
        mitigationSummary:
          dto.mitigationSummary === undefined
            ? current.mitigationSummary
            : this.normalizeOptionalString(dto.mitigationSummary),
        closedAt: nextClosedAt,
        evidenceRef:
          dto.evidenceRef === undefined
            ? current.evidenceRef
            : this.normalizeOptionalString(dto.evidenceRef),
        metadataJson:
          dto.metadataJson === undefined
            ? current.metadataJson
            : this.serializeMetadata(dto.metadataJson),
        traceId: this.buildTraceId(dto.traceId || current.traceId),
        updatedByUserId: actor.userId,
      },
    });

    await this.recordAudit(
      {
        action:
          current.status !== updated.status
            ? this.statusAction('CONFLICT_DISCLOSURE', current.status, updated.status)
            : AuditActions.CONFLICT_DISCLOSURE_UPDATED,
        entityType: AuditEntityTypes.CONFLICT_DISCLOSURE,
        entityId: updated.id,
        entityNo: updated.disclosureNo,
        traceId: updated.traceId,
      },
      actor,
    );

    return this.mapConflict(updated);
  }

  async listWindDownMaterials(query: GovernanceRegistryQueryDto) {
    const keyword = this.buildContains(query.keyword);
    const where: Record<string, any> = {};
    if (query.status) where.status = query.status;
    if (keyword) {
      where.OR = [
        { materialNo: keyword },
        { materialType: keyword },
        { versionLabel: keyword },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.windDownMaterialRecord.findMany({
        where,
        skip: this.normalizeSkip(query.skip),
        take: this.normalizeTake(query.take),
        orderBy: [{ createdAt: 'desc' }],
      }),
      this.prisma.windDownMaterialRecord.count({ where }),
    ]);

    return {
      items: items.map((item: any) => this.mapWindDownMaterial(item)),
      total,
    };
  }

  async getWindDownMaterial(id: string) {
    const item = await this.prisma.windDownMaterialRecord.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException(`Wind-down material record not found: ${id}`);
    }
    return this.mapWindDownMaterial(item);
  }

  async createWindDownMaterial(
    dto: CreateWindDownMaterialRecordDto,
    actor: ApprovalActorContext,
  ) {
    const created = await this.prisma.windDownMaterialRecord.create({
      data: {
        materialNo: generateReferenceNo(GovernanceRegistryPrefixes.WIND_DOWN),
        status:
          this.normalizeOptionalString(dto.status) || WindDownMaterialStatuses.ACTIVE,
        materialType: this.requiredString(dto.materialType, 'materialType'),
        versionLabel: this.requiredString(dto.versionLabel, 'versionLabel'),
        effectiveAt: this.toDate(dto.effectiveAt),
        reviewDueAt: this.toDate(dto.reviewDueAt),
        evidenceRef: this.normalizeOptionalString(dto.evidenceRef),
        metadataJson: this.serializeMetadata(dto.metadataJson),
        traceId: this.buildTraceId(dto.traceId),
        createdByUserId: actor.userId,
      },
    });


    await this.recordAudit(
      {
        action: AuditActions.WIND_DOWN_MATERIAL_CREATED,
        entityType: AuditEntityTypes.WIND_DOWN_MATERIAL,
        entityId: created.id,
        entityNo: created.materialNo,
        traceId: created.traceId,
      },
      actor,
    );

    return this.mapWindDownMaterial(created);
  }

  async updateWindDownMaterial(
    id: string,
    dto: UpdateWindDownMaterialRecordDto,
    actor: ApprovalActorContext,
  ) {
    const current = await this.prisma.windDownMaterialRecord.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException(`Wind-down material record not found: ${id}`);
    }

    const nextStatus = this.normalizeOptionalString(dto.status) || current.status;
    const nextSupersededAt =
      dto.supersededAt !== undefined
        ? this.toDate(dto.supersededAt)
        : nextStatus === WindDownMaterialStatuses.SUPERSEDED && !current.supersededAt
          ? new Date()
          : current.supersededAt;

    const updated = await this.prisma.windDownMaterialRecord.update({
      where: { id },
      data: {
        status: nextStatus,
        materialType:
          dto.materialType === undefined
            ? current.materialType
            : this.requiredString(dto.materialType, 'materialType'),
        versionLabel:
          dto.versionLabel === undefined
            ? current.versionLabel
            : this.requiredString(dto.versionLabel, 'versionLabel'),
        effectiveAt:
          dto.effectiveAt === undefined
            ? current.effectiveAt
            : this.toDate(dto.effectiveAt),
        reviewDueAt:
          dto.reviewDueAt === undefined
            ? current.reviewDueAt
            : this.toDate(dto.reviewDueAt),
        supersededAt: nextSupersededAt,
        evidenceRef:
          dto.evidenceRef === undefined
            ? current.evidenceRef
            : this.normalizeOptionalString(dto.evidenceRef),
        metadataJson:
          dto.metadataJson === undefined
            ? current.metadataJson
            : this.serializeMetadata(dto.metadataJson),
        traceId: this.buildTraceId(dto.traceId || current.traceId),
        updatedByUserId: actor.userId,
      },
    });

    await this.recordAudit(
      {
        action:
          current.status !== updated.status
            ? this.statusAction('WIND_DOWN_MATERIAL', current.status, updated.status)
            : AuditActions.WIND_DOWN_MATERIAL_UPDATED,
        entityType: AuditEntityTypes.WIND_DOWN_MATERIAL,
        entityId: updated.id,
        entityNo: updated.materialNo,
        traceId: updated.traceId,
      },
      actor,
    );

    return this.mapWindDownMaterial(updated);
  }
}
