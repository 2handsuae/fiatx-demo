import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
} from './constants/audit-actions.constant';
import {
  AuditActorContext,
  AuditEvidenceExportMode,
  AuditEvidencePackageStatus,
  AuditLogQueryDto,
  AuditResult,
  AuditSubjectRole,
  AuditTriggerType,
  CreateAuditLogEventDto,
  EvidencePackageQueryDto,
  ExportEvidencePackageDto,
} from './dto/audit-log.dto';
import {
  AUDIT_MASK_VERSION,
  maskAuditPayload,
  maskIpAddress,
} from './utils/audit-mask.util';
import { sha256Hex } from './utils/audit-digest.util';
import {
  buildAuditSubjectNos,
  type AuditSubjectNoRecord,
} from './utils/audit-subject-no.util';

export interface EvidenceExportResult {
  id: string;
  packageNo: string;
  fileName: string;
  generatedAt: string;
  status: string;
  itemCount: number;
  digest: string;
  manifest: Record<string, unknown>;
}

export interface PreparedEvidenceExportSelection {
  normalizedCriteria: Record<string, unknown>;
  filterSnapshot: Record<string, unknown>;
  selectedEventIds: string[];
  records: any[];
  itemCount: number;
  workflowSummary: {
    workflowType: string | null;
    workflowNos: string[];
  };
}

export interface BuiltEvidencePackageArtifacts {
  generatedAt: string;
  itemCount: number;
  manifest: Record<string, unknown>;
  digest: string;
  packageBody: Record<string, unknown>;
}

interface DepositWorkflowContext {
  traceId: string | null;
  workflowType: string | null;
  workflowId: string | null;
  workflowNo: string | null;
  entityOwnerNo: string | null;
  relatedSubjectNos: AuditSubjectNoRecord[];
}

type AuditWriteClient = any;

@Injectable()
export class AuditLogsService {
  private static readonly MAX_NO_RETRIES = 10;
  private static readonly DEFAULT_TAKE = 50;
  private static readonly DEFAULT_EXPORT_MAX_ITEMS = 1000;
  private static readonly MAX_EXPORT_MAX_ITEMS = 5000;
  private static readonly RETENTION_YEARS = 8;
  private static readonly ACTION_NAME_RE = /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/;
  private static readonly STATE_TRANSITION_ACTION_ALLOWLIST: Set<string> = new Set([
    AuditActions.CDD_SUBMITTED,
    AuditActions.CDD_APPROVED,
    AuditActions.EDD_REJECTED,
    AuditActions.FINAL_APPROVED,
  ]);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
  ) {}

  private getDb(client?: AuditWriteClient): AuditWriteClient {
    return (client ?? this.prisma) as AuditWriteClient;
  }

  private canOperateAuditLogEvent(db: any): boolean {
    return (
      db &&
      db.auditLogEvent &&
      typeof db.auditLogEvent.create === 'function' &&
      typeof db.auditLogEvent.findUnique === 'function'
    );
  }

  private canOperateAuditLogSubjectNo(db: any): boolean {
    return !!(
      db &&
      db.auditLogSubjectNo &&
      typeof db.auditLogSubjectNo.findMany === 'function'
    );
  }

  private canOperateAuditEvidencePackage(db: any): boolean {
    return !!(
      db &&
      db.auditEvidencePackage &&
      typeof db.auditEvidencePackage.create === 'function' &&
      typeof db.auditEvidencePackage.count === 'function' &&
      typeof db.auditEvidencePackage.findMany === 'function' &&
      typeof db.auditEvidencePackage.findUnique === 'function'
    );
  }

  private normalizeEntityType(input?: string | null): string {
    return String(input || '')
      .trim()
      .toUpperCase();
  }

  private async resolveActorNo(
    actor: AuditActorContext,
    db: any,
  ): Promise<string | null> {
    if (actor.actorNo) return actor.actorNo;

    const actorType = this.normalizeEntityType(actor.actorType);
    if (actorType === 'SYSTEM') return 'SYSTEM';

    try {
      if (actorType === 'ADMIN' && db?.user?.findUnique && actor.actorId) {
        const admin = await db.user.findUnique({
          where: { id: actor.actorId },
          select: { userNo: true },
        });
        return admin?.userNo || null;
      }

      if (actorType === 'CUSTOMER' && db?.customerMain?.findUnique && actor.actorId) {
        const customer = await db.customerMain.findUnique({
          where: { id: actor.actorId },
          select: { customerNo: true },
        });
        return customer?.customerNo || null;
      }
    } catch {
      return null;
    }

    return null;
  }

  private async resolveEntityOwnerNo(
    input: CreateAuditLogEventDto,
    db: any,
  ): Promise<string | null> {
    if (input.entityOwnerNo) return input.entityOwnerNo;
    if (!input.entityOwnerId || !input.entityOwnerType) return null;

    const ownerType = this.normalizeEntityType(input.entityOwnerType);

    try {
      if (ownerType === 'CUSTOMER' && db?.customerMain?.findUnique) {
        const owner = await db.customerMain.findUnique({
          where: { id: input.entityOwnerId },
          select: { customerNo: true },
        });
        return owner?.customerNo || null;
      }

      if ((ownerType === 'ADMIN' || ownerType === 'USER') && db?.user?.findUnique) {
        const owner = await db.user.findUnique({
          where: { id: input.entityOwnerId },
          select: { userNo: true },
        });
        return owner?.userNo || null;
      }
    } catch {
      return null;
    }

    return null;
  }

  private async resolveEntityNo(
    entityType: string,
    entityId?: string | null,
    db?: any,
  ): Promise<string | null> {
    if (!entityId || !db) return null;
    const normalizedType = this.normalizeEntityType(entityType);

    const lookupConfig: Record<
      string,
      { model: string; field: string }
    > = {
      CUSTOMER: { model: 'customerMain', field: 'customerNo' },
      CUSTOMER_MAIN: { model: 'customerMain', field: 'customerNo' },
      WALLET: { model: 'wallet', field: 'walletNo' },
      WITHDRAW_TRANSACTION: { model: 'withdrawTransaction', field: 'withdrawNo' },
      DEPOSIT_TRANSACTION: { model: 'depositTransaction', field: 'depositNo' },
      SWAP_TRANSACTION: { model: 'swapTransaction', field: 'swapNo' },
      PAYOUT: { model: 'payout', field: 'payoutNo' },
      PAYIN: { model: 'payin', field: 'payinNo' },
      INTERNAL_TRANSACTION: { model: 'internalTransaction', field: 'internalTxNo' },
      INTERNAL_FUND: { model: 'internalFund', field: 'internalFundNo' },
      SWAP_QUOTE: { model: 'swapQuote', field: 'quoteNo' },
      KYT_CASE: { model: 'kytCase', field: 'caseNo' },
      TRAVEL_RULE_CASE: { model: 'travelRuleCase', field: 'caseNo' },
      ASSET: { model: 'asset', field: 'assetNo' },
      USER: { model: 'user', field: 'userNo' },
      ADMIN: { model: 'user', field: 'userNo' },
      CHANGE_TICKET: { model: 'changeTicket', field: 'ticketNo' },
      APPROVAL_CASE: { model: 'approvalCase', field: 'approvalNo' },
      AUDIT_EVIDENCE_PACKAGE: { model: 'auditEvidencePackage', field: 'packageNo' },
      DELETE_REQUEST: { model: 'deleteRequest', field: 'requestNo' },
      SLA_TIMER: { model: 'slaTimer', field: 'timerNo' },
    };

    const target = lookupConfig[normalizedType];
    if (!target) return null;

    try {
      const model = db[target.model];
      if (!model || typeof model.findUnique !== 'function') {
        return null;
      }

      const row = await model.findUnique({
        where: { id: entityId },
        select: { [target.field]: true },
      });
      return row?.[target.field] || null;
    } catch {
      return null;
    }
  }

  private buildSubjectNos(
    input: CreateAuditLogEventDto,
    actor: AuditActorContext,
    actorNo: string | null,
    entityNo: string | null,
    entityOwnerNo: string | null,
    extraSubjectNos: AuditSubjectNoRecord[] = [],
  ): AuditSubjectNoRecord[] {
    return this.mergeSubjectNos(
      buildAuditSubjectNos({
        actor: {
          ...actor,
          actorNo: actorNo || undefined,
        },
        entityType: input.entityType,
        entityId: input.entityId || null,
        entityNo,
        entityOwnerType: input.entityOwnerType || null,
        entityOwnerId: input.entityOwnerId || null,
        entityOwnerNo,
        explicitSubjectNos: input.subjectNos,
      }),
      extraSubjectNos,
    );
  }

  private mergeSubjectNos(
    current: AuditSubjectNoRecord[],
    extra: AuditSubjectNoRecord[],
  ): AuditSubjectNoRecord[] {
    const seen = new Set<string>();

    return [...current, ...extra].filter((item) => {
      const key = [
        item.subjectRole,
        item.subjectType,
        item.subjectId || '',
        item.subjectNo,
      ].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private buildDepositTraceId(payinId?: string | null, depositId?: string | null) {
    const rootId =
      this.normalizeOptionalString(payinId) || this.normalizeOptionalString(depositId);
    return rootId ? `${AuditWorkflowTypes.DEPOSIT}:${rootId}` : null;
  }

  private buildRelatedSubjectNo(
    subjectType: string,
    subjectId: string | null | undefined,
    subjectNo: string | null | undefined,
  ): AuditSubjectNoRecord[] {
    if (!subjectNo) return [];

    return [
      {
        subjectRole: AuditSubjectRole.RELATED,
        subjectType,
        subjectId: subjectId || null,
        subjectNo,
      },
    ];
  }

  private async resolveDepositWorkflowContext(
    input: CreateAuditLogEventDto,
    entityOwnerNo: string | null,
    db: any,
  ): Promise<DepositWorkflowContext> {
    const explicitWorkflowType = this.normalizeEntityType(input.workflowType);
    const entityType = this.normalizeEntityType(input.entityType);
    const shouldResolveDeposit =
      explicitWorkflowType === AuditWorkflowTypes.DEPOSIT ||
      entityType === AuditEntityTypes.DEPOSIT_TRANSACTION ||
      entityType === AuditEntityTypes.PAYIN;

    if (!shouldResolveDeposit) {
      return {
        traceId: this.normalizeOptionalString(input.traceId),
        workflowType: this.normalizeOptionalString(input.workflowType),
        workflowId: this.normalizeOptionalString(input.workflowId),
        workflowNo: this.normalizeOptionalString(input.workflowNo),
        entityOwnerNo,
        relatedSubjectNos: [],
      };
    }

    let deposit: any = null;
    let payin: any = null;

    if (
      (entityType === AuditEntityTypes.DEPOSIT_TRANSACTION ||
        explicitWorkflowType === AuditWorkflowTypes.DEPOSIT) &&
      (input.workflowId || input.entityId) &&
      db?.depositTransaction?.findUnique
    ) {
      deposit = await db.depositTransaction.findUnique({
        where: { id: input.workflowId || input.entityId },
        select: {
          id: true,
          depositNo: true,
          ownerId: true,
          payinId: true,
          customer: {
            select: {
              customerNo: true,
            },
          },
          payin: {
            select: {
              id: true,
              payinNo: true,
            },
          },
        },
      });
      payin = deposit?.payin || null;
    }

    if (!payin && entityType === AuditEntityTypes.PAYIN && input.entityId && db?.payin?.findUnique) {
      payin = await db.payin.findUnique({
        where: { id: input.entityId },
        select: {
          id: true,
          payinNo: true,
          depositId: true,
          ownerId: true,
          customer: {
            select: {
              customerNo: true,
            },
          },
          deposit: {
            select: {
              id: true,
              depositNo: true,
              ownerId: true,
              customer: {
                select: {
                  customerNo: true,
                },
              },
            },
          },
        },
      });
      if (payin?.deposit) {
        deposit = payin.deposit;
      }
    }

    const resolvedEntityOwnerNo =
      entityOwnerNo ||
      deposit?.customer?.customerNo ||
      payin?.customer?.customerNo ||
      null;

    const relatedSubjectNos = this.mergeSubjectNos(
      this.buildRelatedSubjectNo('DEPOSIT', deposit?.id, deposit?.depositNo),
      this.buildRelatedSubjectNo('PAYIN', payin?.id, payin?.payinNo),
    );

    return {
      traceId:
        this.normalizeOptionalString(input.traceId) ||
        this.buildDepositTraceId(payin?.id || deposit?.payinId, deposit?.id),
      workflowType: AuditWorkflowTypes.DEPOSIT,
      workflowId:
        this.normalizeOptionalString(input.workflowId) ||
        this.normalizeOptionalString(deposit?.id),
      workflowNo:
        this.normalizeOptionalString(input.workflowNo) ||
        this.normalizeOptionalString(deposit?.depositNo),
      entityOwnerNo: resolvedEntityOwnerNo,
      relatedSubjectNos,
    };
  }

  private serializeJson(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    try {
      return JSON.stringify(value);
    } catch {
      throw new BadRequestException('JSON payload serialization failed');
    }
  }

  private parseJson(value: string | null | undefined): unknown {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private mapEvidencePackage(raw: any) {
    return {
      ...raw,
      approvalCase: raw.approvalCase
        && !raw.approvalCase.deletedAt
        ? {
            id: raw.approvalCase.id,
            approvalNo: raw.approvalCase.approvalNo,
            actionType: raw.approvalCase.actionType,
            entityRef: raw.approvalCase.entityRef,
            status: raw.approvalCase.status,
            executionStatus: raw.approvalCase.executionStatus,
            traceId: raw.approvalCase.traceId,
            decisionByUserId: raw.approvalCase.decisionByUserId,
            decisionByRole: raw.approvalCase.decisionByRole,
            decidedAt: raw.approvalCase.decidedAt,
            createdAt: raw.approvalCase.createdAt,
            updatedAt: raw.approvalCase.updatedAt,
          }
        : null,
      digest:
        raw.status === AuditEvidencePackageStatus.READY || raw.status === AuditEvidencePackageStatus.FAILED
          ? raw.digest
          : null,
      filterSnapshot: this.parseJson(raw.filterSnapshot),
      selectedEventIdsSnapshot: this.parseJson(raw.selectedEventIdsSnapshot),
      manifest: this.parseJson(raw.manifest),
      packageBody: this.parseJson(raw.packageBody),
    };
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

  private toDate(input?: string): Date | undefined {
    if (!input) return undefined;
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`Invalid datetime: ${input}`);
    }
    return parsed;
  }

  private normalizeTake(take?: number): number {
    if (!take || take < 1) return AuditLogsService.DEFAULT_TAKE;
    return Math.min(take, 200);
  }

  private normalizeExportMaxItems(maxItems?: number): number {
    if (!maxItems || maxItems < 1) return AuditLogsService.DEFAULT_EXPORT_MAX_ITEMS;
    return Math.min(maxItems, AuditLogsService.MAX_EXPORT_MAX_ITEMS);
  }

  private normalizeSkip(skip?: number): number {
    if (!skip || skip < 0) return 0;
    return skip;
  }

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length ? normalized : null;
  }

  private toRetainedUntil(occurredAt: Date): Date {
    const retainedUntil = new Date(occurredAt);
    retainedUntil.setFullYear(retainedUntil.getFullYear() + AuditLogsService.RETENTION_YEARS);
    return retainedUntil;
  }

  private hasPayload(value: unknown): boolean {
    return value !== null && value !== undefined;
  }

  private isDeleteAction(action: string): boolean {
    return (
      action.includes('DELETE') ||
      action.includes('REMOVED') ||
      action.includes('PURGED')
    );
  }

  private inferTriggerType(
    input: CreateAuditLogEventDto,
    actor: AuditActorContext,
  ): AuditTriggerType {
    if (input.triggerType) return input.triggerType;

    const action = String(input.action || '').toUpperCase();
    const module = String(input.module || '').toLowerCase();
    const entityType = String(input.entityType || '').toUpperCase();

    if (action === AuditActions.AUDIT_EVIDENCE_PACKAGE_EXPORTED) {
      return AuditTriggerType.EVIDENCE_EXPORT;
    }

    if (input.statusFrom && input.statusTo && input.statusFrom !== input.statusTo) {
      return AuditTriggerType.STATE_TRANSITION;
    }

    if (action.startsWith('MANUAL_')) {
      return AuditTriggerType.MANUAL_OVERRIDE;
    }

    if (
      module.includes('/auth') ||
      action.includes('LOGIN') ||
      action.includes('LOGOUT') ||
      action.includes('LOCK') ||
      entityType === AuditEntityTypes.AUTH
    ) {
      return AuditTriggerType.AUTH_EVENT;
    }

    if (
      action.includes('ROLE') ||
      action.includes('PERMISSION') ||
      action.includes('ACCESS_POLICY')
    ) {
      return AuditTriggerType.PERMISSION_CHANGE;
    }

    if (
      module.includes('config') ||
      action.endsWith('_CONFIG_UPDATED') ||
      action.includes('ACCT_EVENT_UPDATED') ||
      action.includes('CLEARING_TEMPLATE_UPDATED')
    ) {
      return AuditTriggerType.CONFIG_CHANGE;
    }

    const hasBefore = this.hasPayload(input.beforeData);
    const hasAfter = this.hasPayload(input.afterData);

    if (!hasBefore && hasAfter) {
      return AuditTriggerType.DATA_CREATE;
    }

    if (
      (hasBefore && hasAfter) ||
      action.endsWith('_UPDATED') ||
      action.includes('_UPDATE_') ||
      action.includes('MODIFIED')
    ) {
      return AuditTriggerType.DATA_UPDATE;
    }

    if ((hasBefore && !hasAfter) || this.isDeleteAction(action)) {
      return AuditTriggerType.DATA_DELETE;
    }

    if (
      action.startsWith('SYSTEM_') ||
      actor.actorType === 'SYSTEM' ||
      String(input.sourcePlatform || '').toUpperCase() === 'BACKFILL'
    ) {
      return AuditTriggerType.SYSTEM_EVENT;
    }

    return AuditTriggerType.DATA_UPDATE;
  }

  private buildIdempotencyKey(
    input: CreateAuditLogEventDto,
    triggerType: AuditTriggerType,
  ): string | null {
    if (input.idempotencyKey) return input.idempotencyKey;
    if (!input.module || !input.action) return null;
    const normalizedRequestId = this.normalizeOptionalString(input.requestId);

    const parts = [
      input.module,
      input.entityType,
      input.entityId || 'NA',
      input.action,
      normalizedRequestId || 'NO_REQUEST_ID',
      triggerType,
    ];

    return sha256Hex(parts.join('|'));
  }

  private validateInput(
    input: CreateAuditLogEventDto,
    triggerType: AuditTriggerType,
  ) {
    const normalizedAction = String(input.action || '').trim().toUpperCase();
    if (!AuditLogsService.ACTION_NAME_RE.test(normalizedAction)) {
      throw new BadRequestException(
        'action must be UPPER_SNAKE_CASE (e.g. ENTITY_VERB or ENTITY_FROM_TO)',
      );
    }

    if (
      triggerType === AuditTriggerType.STATE_TRANSITION &&
      (!input.statusFrom || !input.statusTo)
    ) {
      throw new BadRequestException(
        'statusFrom/statusTo are required for STATE_TRANSITION triggerType',
      );
    }

    if (
      triggerType === AuditTriggerType.STATE_TRANSITION &&
      !normalizedAction.includes('_TO_') &&
      !AuditLogsService.STATE_TRANSITION_ACTION_ALLOWLIST.has(normalizedAction)
    ) {
      throw new BadRequestException(
        'STATE_TRANSITION action must follow <ENTITY>_<FROM_STATUS>_TO_<TO_STATUS> or approved allowlist',
      );
    }

    if (
      triggerType === AuditTriggerType.MANUAL_OVERRIDE &&
      (!input.reason || !String(input.reason).trim())
    ) {
      throw new BadRequestException('reason is required for MANUAL_OVERRIDE');
    }

    if (
      triggerType === AuditTriggerType.MANUAL_OVERRIDE &&
      !normalizedAction.startsWith('MANUAL_')
    ) {
      throw new BadRequestException('MANUAL_OVERRIDE action must start with MANUAL_');
    }

    if (
      triggerType === AuditTriggerType.SYSTEM_EVENT &&
      !normalizedAction.startsWith('SYSTEM_')
    ) {
      throw new BadRequestException('SYSTEM_EVENT action must start with SYSTEM_');
    }

    if (
      input.result &&
      input.result !== AuditResult.SUCCESS &&
      (!input.reason || !String(input.reason).trim())
    ) {
      throw new BadRequestException('reason is required when result is FAILED/REJECTED');
    }

    if (
      !input.entityId &&
      ![
        AuditTriggerType.AUTH_EVENT,
        AuditTriggerType.SYSTEM_EVENT,
        AuditTriggerType.EVIDENCE_EXPORT,
      ].includes(triggerType)
    ) {
      throw new BadRequestException('entityId is required for this triggerType');
    }
  }

  private mapEvent(raw: any) {
    const subjectNos = Array.isArray(raw.subjectNos)
      ? raw.subjectNos.map((item: any) => ({
          id: item.id,
          eventId: item.eventId,
          subjectRole: item.subjectRole,
          subjectType: item.subjectType,
          subjectId: item.subjectId,
          subjectNo: item.subjectNo,
          occurredAt: item.occurredAt,
          createdAt: item.createdAt,
        }))
      : [];

    return {
      ...raw,
      metadata: this.parseJson(raw.metadata),
      beforeData: this.parseJson(raw.beforeData),
      afterData: this.parseJson(raw.afterData),
      subjectNos,
    };
  }

  private buildWhere(query: AuditLogQueryDto): any {
    const startAt = this.toDate(query.startAt);
    const endAt = this.toDate(query.endAt);

    if (startAt && endAt && startAt > endAt) {
      throw new BadRequestException('startAt must be less than or equal to endAt');
    }

    const where: any = {};
    if (query.triggerType) where.triggerType = query.triggerType;
    if (query.module) where.module = query.module;
    if (query.entityType) where.entityType = query.entityType;
    if (query.entityId) where.entityId = query.entityId;
    if (query.actorId) where.actorId = query.actorId;
    if (query.actorNo) where.actorNo = query.actorNo;
    if (query.entityOwnerNo) where.entityOwnerNo = query.entityOwnerNo;
    if (query.traceId) where.traceId = query.traceId;
    if (query.workflowType) where.workflowType = query.workflowType;
    if (query.workflowNo) where.workflowNo = query.workflowNo;
    if (query.result) where.result = query.result;

    if (query.subjectNo || query.subjectType) {
      where.subjectNos = {
        some: {
          ...(query.subjectNo ? { subjectNo: query.subjectNo } : {}),
          ...(query.subjectType ? { subjectType: query.subjectType } : {}),
        },
      };
    }

    if (query.includeArchived !== true) {
      where.archivedAt = null;
    }

    if (startAt || endAt) {
      where.occurredAt = {};
      if (startAt) where.occurredAt.gte = startAt;
      if (endAt) where.occurredAt.lte = endAt;
    }

    if (query.keyword) {
      where.OR = [
        { action: { contains: query.keyword } },
        { module: { contains: query.keyword } },
        { entityType: { contains: query.keyword } },
        { entityId: { contains: query.keyword } },
        { entityNo: { contains: query.keyword } },
        { actorNo: { contains: query.keyword } },
        { entityOwnerNo: { contains: query.keyword } },
        { traceId: { contains: query.keyword } },
        { workflowNo: { contains: query.keyword } },
        { reason: { contains: query.keyword } },
        {
          subjectNos: {
            some: {
              subjectNo: { contains: query.keyword },
            },
          },
        },
      ];
    }

    return where;
  }

  private async createEventWithUniqueNo(
    data: any,
    subjectNos: AuditSubjectNoRecord[],
    client?: AuditWriteClient,
  ): Promise<any> {
    const db = this.getDb(client) as any;
    const withSubjectNoRelation =
      this.canOperateAuditLogSubjectNo(db) &&
      Array.isArray(subjectNos) &&
      subjectNos.length > 0;
    const includeSubjectNos = withSubjectNoRelation
      ? {
          include: {
            subjectNos: {
              orderBy: { createdAt: 'asc' },
            },
          },
        }
      : {};

    if (!this.canOperateAuditLogEvent(db)) {
      const now = new Date();
      return {
        id: `AUDIT_NOOP_${now.getTime()}`,
        auditNo: generateReferenceNo('AUD'),
        createdAt: now,
        updatedAt: now,
        subjectNos,
        ...data,
      };
    }

    if (data.idempotencyKey) {
      const existing = await db.auditLogEvent.findUnique({
        where: { idempotencyKey: data.idempotencyKey },
        ...includeSubjectNos,
      });
      if (existing) return existing;
    }

    for (let i = 0; i < AuditLogsService.MAX_NO_RETRIES; i += 1) {
      try {
        const createData: any = {
          ...data,
          auditNo: generateReferenceNo('AUD'),
        };
        if (withSubjectNoRelation) {
          createData.subjectNos = {
            create: subjectNos.map((item) => ({
              subjectRole: item.subjectRole,
              subjectType: item.subjectType,
              subjectId: item.subjectId ?? null,
              subjectNo: item.subjectNo,
              occurredAt: data.occurredAt,
            })),
          };
        }

        return await db.auditLogEvent.create({
          data: createData,
          ...includeSubjectNos,
        });
      } catch (error) {
        if (this.isUniqueConflict(error, 'auditNo')) continue;

        if (data.idempotencyKey && this.isUniqueConflict(error, 'idempotencyKey')) {
          const existing = await db.auditLogEvent.findUnique({
            where: { idempotencyKey: data.idempotencyKey },
            ...includeSubjectNos,
          });
          if (existing) return existing;
        }

        throw error;
      }
    }

    throw new InternalServerErrorException(
      `Failed to generate unique auditNo after ${AuditLogsService.MAX_NO_RETRIES} attempts`,
    );
  }

  private async createPackageWithUniqueNo(data: any): Promise<any> {
    const db = this.getDb() as any;
    if (!this.canOperateAuditEvidencePackage(db)) {
      const now = new Date();
      const packageNo = generateReferenceNo('EVP');
      return {
        id: `PKG_NOOP_${now.getTime()}`,
        packageNo,
        fileName: data.fileName || `${packageNo}.json`,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
    }
    for (let i = 0; i < AuditLogsService.MAX_NO_RETRIES; i += 1) {
      try {
        const packageNo = generateReferenceNo('EVP');
        return await db.auditEvidencePackage.create({
          data: {
            ...data,
            packageNo,
            fileName: data.fileName || `${packageNo}.json`,
          },
        });
      } catch (error) {
        if (this.isUniqueConflict(error, 'packageNo')) continue;
        throw error;
      }
    }

    throw new InternalServerErrorException(
      `Failed to generate unique packageNo after ${AuditLogsService.MAX_NO_RETRIES} attempts`,
    );
  }

  async createEvidencePackageRecord(data: any): Promise<any> {
    return this.createPackageWithUniqueNo(data);
  }

  async prepareEvidenceExportSelection(
    query: ExportEvidencePackageDto,
  ): Promise<PreparedEvidenceExportSelection> {
    const skip = this.normalizeSkip(query.skip);
    const maxItems = this.normalizeExportMaxItems(query.maxItems);
    const selectedEventIds = Array.from(
      new Set((query.selectedEventIds || []).map((item) => item.trim()).filter(Boolean)),
    );

    if (!selectedEventIds.length) {
      throw new BadRequestException('selectedEventIds is required for selection export');
    }
    if (selectedEventIds.length > maxItems) {
      throw new BadRequestException(`selectedEventIds exceeds export maxItems=${maxItems}`);
    }

    const where = {
      ...this.buildWhere(query),
      id: { in: selectedEventIds },
    };

    const db = this.getDb() as any;
    if (!this.canOperateAuditLogEvent(db)) {
      throw new BadRequestException('Audit log event model is unavailable');
    }

    const includeSubjectNos = this.canOperateAuditLogSubjectNo(db)
      ? {
          include: {
            subjectNos: {
              orderBy: { createdAt: 'asc' },
            },
          },
        }
      : {};
    const rows = await db.auditLogEvent.findMany({
      where,
      skip,
      take: maxItems,
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      ...includeSubjectNos,
    });

    if (!rows.length) {
      throw new BadRequestException('No audit logs matched the selectedEventIds');
    }

    const records = rows.map((row: any) => this.mapEvent(row));
    const explicitWorkflowType = this.normalizeOptionalString(query.workflowType);
    const resolvedWorkflowTypes = Array.from(
      new Set(
        records
          .map((row: any) => this.normalizeOptionalString(row.workflowType))
          .filter(Boolean) as string[],
      ),
    );
    const workflowSummaryType =
      explicitWorkflowType ||
      (resolvedWorkflowTypes.length === 1 ? resolvedWorkflowTypes[0] : null);
    return {
      normalizedCriteria: {
        mode: query.mode || AuditEvidenceExportMode.SELECTION,
        skip,
        maxItems,
        includeRecords: query.includeRecords !== false,
        workflowType: explicitWorkflowType,
        workflowNo: query.workflowNo || null,
        traceId: query.traceId || null,
        subjectNo: query.subjectNo || null,
        subjectType: query.subjectType || null,
        actorNo: query.actorNo || null,
        entityOwnerNo: query.entityOwnerNo || null,
      },
      filterSnapshot: {
        ...query,
        skip,
        maxItems,
      },
      selectedEventIds,
      records,
      itemCount: records.length,
      workflowSummary: {
        workflowType: workflowSummaryType,
        workflowNos: Array.from(
          new Set(records.map((row: any) => row.workflowNo).filter(Boolean)),
        ).sort() as string[],
      },
    };
  }

  async buildEvidencePackageArtifacts(
    query: ExportEvidencePackageDto,
    exporter: AuditActorContext,
    approvalSummary?: {
      approvalId: string;
      approvalNo?: string | null;
      approvalStatus: string;
      approvedBy?: string | null;
      approvalDecidedAt?: string | null;
    },
  ): Promise<BuiltEvidencePackageArtifacts> {
    const selection = await this.prepareEvidenceExportSelection(query);
    const db = this.getDb() as any;
    const snapshots = await this.buildDepositSnapshots(selection.records, db);
    const recordDigests = selection.records.map((row: any) => ({
      id: row.id,
      auditNo: row.auditNo,
      digest: row.payloadDigest || sha256Hex(row),
    }));

    const generatedAt = new Date().toISOString();
    const manifest = {
      version: '1.0',
      generatedAt,
      exportedBy: exporter,
      exportMode: selection.normalizedCriteria.mode,
      criteria: {
        ...selection.filterSnapshot,
        selectedEventIds: selection.selectedEventIds,
      },
      workflowSummary: selection.workflowSummary,
      itemCount: selection.itemCount,
      digestAlgorithm: 'sha256',
      recordDigests,
      approval: approvalSummary
        ? {
            approvalId: approvalSummary.approvalId,
            approvalNo: approvalSummary.approvalNo || null,
            approvalStatus: approvalSummary.approvalStatus,
            approvedBy: approvalSummary.approvedBy || null,
            approvalDecidedAt: approvalSummary.approvalDecidedAt || null,
          }
        : undefined,
    };
    const packageRecords = query.includeRecords === false ? [] : selection.records;
    const digest = sha256Hex({
      manifest,
      records: packageRecords,
      snapshots,
    });
    const packageBody = {
      manifest,
      records: packageRecords,
      snapshots,
      digest,
    };

    return {
      generatedAt,
      itemCount: selection.itemCount,
      manifest,
      digest,
      packageBody,
    };
  }

  async hasIdempotencyKey(
    idempotencyKey: string,
    client?: AuditWriteClient,
  ): Promise<boolean> {
    const db = this.getDb(client) as any;
    if (!this.canOperateAuditLogEvent(db)) return false;
    const existing = await db.auditLogEvent.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    return !!existing;
  }

  async recordByActor(
    input: CreateAuditLogEventDto,
    actor: AuditActorContext,
    client?: AuditWriteClient,
  ) {
    const db = this.getDb(client) as any;
    const occurredAt = input.occurredAt ? this.toDate(input.occurredAt) : new Date();
    if (!occurredAt) {
      throw new BadRequestException('occurredAt parsing failed');
    }

    const triggerType = this.inferTriggerType(input, actor);
    this.validateInput(input, triggerType);

    const maskedMetadata = maskAuditPayload(input.metadata || null);
    const maskedBeforeData = maskAuditPayload(input.beforeData || null);
    const maskedAfterData = maskAuditPayload(input.afterData || null);
    const maskedSourceIp = maskIpAddress(input.sourceIp);
    const normalizedRequestId = this.normalizeOptionalString(input.requestId);

    const idempotencyKey = this.buildIdempotencyKey(input, triggerType);
    const retainedUntil = this.toRetainedUntil(occurredAt);
    const actorNo = await this.resolveActorNo(actor, db);
    const entityNo =
      input.entityNo || (await this.resolveEntityNo(input.entityType, input.entityId, db));
    const resolvedEntityOwnerNo = await this.resolveEntityOwnerNo(input, db);
    const workflowContext = await this.resolveDepositWorkflowContext(
      input,
      resolvedEntityOwnerNo,
      db,
    );
    const entityOwnerNo = workflowContext.entityOwnerNo;
    const subjectNos = this.buildSubjectNos(
      input,
      actor,
      actorNo,
      entityNo,
      entityOwnerNo,
      workflowContext.relatedSubjectNos,
    );

    const payloadDigest = sha256Hex({
      triggerType,
      action: input.action,
      module: input.module,
      entityType: input.entityType,
      entityId: input.entityId || null,
      entityNo: entityNo || null,
      traceId: workflowContext.traceId,
      workflowType: workflowContext.workflowType,
      workflowId: workflowContext.workflowId,
      workflowNo: workflowContext.workflowNo,
      entityOwnerType: input.entityOwnerType || null,
      entityOwnerId: input.entityOwnerId || null,
      entityOwnerNo: entityOwnerNo || null,
      statusFrom: input.statusFrom || null,
      statusTo: input.statusTo || null,
      actorType: actor.actorType,
      actorId: actor.actorId,
      actorNo: actorNo || null,
      actorRole: actor.actorRole || null,
      requestId: normalizedRequestId,
      sourceIp: maskedSourceIp,
      sourcePlatform: input.sourcePlatform || null,
      result: input.result || AuditResult.SUCCESS,
      reason: input.reason || null,
      metadata: maskedMetadata,
      beforeData: maskedBeforeData,
      afterData: maskedAfterData,
      occurredAt: occurredAt.toISOString(),
      maskVersion: AUDIT_MASK_VERSION,
      retainedUntil: retainedUntil.toISOString(),
      subjectNos,
    });

    const created = await this.createEventWithUniqueNo(
      {
        triggerType,
        action: input.action,
        module: input.module,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        entityNo: entityNo ?? null,
        traceId: workflowContext.traceId ?? null,
        workflowType: workflowContext.workflowType ?? null,
        workflowId: workflowContext.workflowId ?? null,
        workflowNo: workflowContext.workflowNo ?? null,
        entityOwnerType: input.entityOwnerType ?? null,
        entityOwnerId: input.entityOwnerId ?? null,
        entityOwnerNo: entityOwnerNo ?? null,
        statusFrom: input.statusFrom ?? null,
        statusTo: input.statusTo ?? null,
        actorType: actor.actorType,
        actorId: actor.actorId,
        actorNo: actorNo ?? null,
        actorRole: actor.actorRole ?? null,
        requestId: normalizedRequestId,
        sourceIp: maskedSourceIp,
        sourcePlatform: input.sourcePlatform ?? null,
        result: input.result ?? AuditResult.SUCCESS,
        reason: input.reason ?? null,
        metadata: this.serializeJson(maskedMetadata),
        beforeData: this.serializeJson(maskedBeforeData),
        afterData: this.serializeJson(maskedAfterData),
        idempotencyKey,
        payloadDigest,
        maskVersion: AUDIT_MASK_VERSION,
        retainedUntil,
        occurredAt,
      },
      subjectNos,
      client,
    );

    return this.mapEvent(created);
  }

  async recordSystem(
    input: CreateAuditLogEventDto,
    client?: AuditWriteClient,
  ) {
    return this.recordByActor(
      {
        ...input,
        sourcePlatform: input.sourcePlatform || 'SYSTEM',
      },
      {
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        actorNo: 'SYSTEM',
        actorRole: 'SYSTEM',
      },
      client,
    );
  }

  async findAll(query: AuditLogQueryDto) {
    const skip = this.normalizeSkip(query.skip);
    const take = this.normalizeTake(query.take);
    const where = this.buildWhere(query);

    const db = this.getDb() as any;
    if (!this.canOperateAuditLogEvent(db)) {
      return { total: 0, skip, take, items: [] as any[] };
    }
    const includeSubjectNos = this.canOperateAuditLogSubjectNo(db)
      ? {
          include: {
            subjectNos: {
              orderBy: { createdAt: 'asc' },
            },
          },
        }
      : {};

    const [total, rows] = await Promise.all([
      db.auditLogEvent.count({ where }),
      db.auditLogEvent.findMany({
        where,
        skip,
        take,
        orderBy: { occurredAt: 'desc' },
        ...includeSubjectNos,
      }),
    ]);

    return {
      total,
      skip,
      take,
      items: rows.map((row: any) => this.mapEvent(row)),
    };
  }

  async findOne(id: string) {
    const db = this.getDb() as any;
    if (!this.canOperateAuditLogEvent(db)) {
      throw new NotFoundException(`Audit log not found: ${id}`);
    }
    const includeSubjectNos = this.canOperateAuditLogSubjectNo(db)
      ? {
          include: {
            subjectNos: {
              orderBy: { createdAt: 'asc' },
            },
          },
        }
      : {};
    const found = await db.auditLogEvent.findUnique({
      where: { id },
      ...includeSubjectNos,
    });

    if (!found) {
      throw new NotFoundException(`Audit log not found: ${id}`);
    }

    return this.mapEvent(found);
  }

  private async buildDepositSnapshots(records: any[], db: any) {
    const workflowIds = Array.from(
      new Set(
        records
          .filter((item) => item.workflowType === AuditWorkflowTypes.DEPOSIT)
          .map((item) => this.normalizeOptionalString(item.workflowId))
          .filter(Boolean) as string[],
      ),
    );

    if (!workflowIds.length || !db?.depositTransaction?.findMany) {
      return {
        deposits: [],
        kytCases: [],
        travelRuleCases: [],
      };
    }

    const [deposits, kytCases, travelRuleCases] = await Promise.all([
      db.depositTransaction.findMany({
        where: { id: { in: workflowIds } },
        orderBy: { depositNo: 'asc' },
        include: {
          payin: {
            select: {
              id: true,
              payinNo: true,
              status: true,
              type: true,
              txHash: true,
              referenceNo: true,
              statusHistory: true,
              receivedAt: true,
              confirmedAt: true,
            },
          },
          customer: {
            select: {
              id: true,
              customerNo: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          asset: {
            select: {
              id: true,
              code: true,
              type: true,
              network: true,
              decimals: true,
            },
          },
        },
      }),
      db.kytCase?.findMany
        ? db.kytCase.findMany({
            where: {
              sourceType: AuditWorkflowTypes.DEPOSIT,
              sourceId: { in: workflowIds },
            },
            orderBy: [{ sourceId: 'asc' }, { screeningStage: 'asc' }],
            select: {
              id: true,
              caseNo: true,
              sourceId: true,
              screeningStage: true,
              status: true,
              provider: true,
              providerCaseId: true,
              checkedAt: true,
              riskScore: true,
            },
          })
        : Promise.resolve([]),
      db.travelRuleCase?.findMany
        ? db.travelRuleCase.findMany({
            where: {
              sourceType: AuditWorkflowTypes.DEPOSIT,
              sourceId: { in: workflowIds },
            },
            orderBy: [{ sourceId: 'asc' }, { caseNo: 'asc' }],
            select: {
              id: true,
              caseNo: true,
              sourceId: true,
              status: true,
              required: true,
              provider: true,
              providerTransferId: true,
              checkedAt: true,
              counterpartyVasp: true,
            },
          })
        : Promise.resolve([]),
    ]);

    return {
      deposits,
      kytCases,
      travelRuleCases,
    };
  }

  async findEvidencePackages(query: EvidencePackageQueryDto) {
    const skip = this.normalizeSkip(query.skip);
    const take = this.normalizeTake(query.take);
    const db = this.getDb() as any;

    if (!this.canOperateAuditEvidencePackage(db)) {
      return { total: 0, skip, take, items: [] as any[] };
    }

    const where: any = {};
    if (query.status) {
      where.status = query.status;
    }

    const [total, rows] = await Promise.all([
      db.auditEvidencePackage.count({ where }),
      db.auditEvidencePackage.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          approvalCase: {
            select: {
              id: true,
              approvalNo: true,
              actionType: true,
              entityRef: true,
              status: true,
              executionStatus: true,
              traceId: true,
              deletedAt: true,
              decisionByUserId: true,
              decisionByRole: true,
              decidedAt: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      skip,
      take,
      items: rows.map((row: any) => this.mapEvidencePackage(row)),
    };
  }

  async findEvidencePackage(id: string) {
    const db = this.getDb() as any;
    if (!this.canOperateAuditEvidencePackage(db)) {
      throw new NotFoundException(`Evidence package not found: ${id}`);
    }

    const found = await db.auditEvidencePackage.findUnique({
      where: { id },
      include: {
        approvalCase: {
          select: {
            id: true,
            approvalNo: true,
            actionType: true,
            entityRef: true,
            status: true,
            executionStatus: true,
            traceId: true,
            deletedAt: true,
            decisionByUserId: true,
            decisionByRole: true,
            decidedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
    if (!found || found.deletedAt) {
      throw new NotFoundException(`Evidence package not found: ${id}`);
    }

    return this.mapEvidencePackage(found);
  }

  async downloadEvidencePackage(id: string) {
    const found = await this.findEvidencePackage(id);
    return {
      id: found.id,
      packageNo: found.packageNo,
      fileName: found.fileName || `${found.packageNo}.json`,
      digest: found.digest,
      content:
        found.packageBody ||
        {
          manifest: found.manifest,
          records: [],
          snapshots: {},
          digest: found.digest,
        },
    };
  }

  async exportEvidencePackage(
    query: ExportEvidencePackageDto,
    exporter: AuditActorContext,
  ): Promise<EvidenceExportResult> {
    const selection = await this.prepareEvidenceExportSelection(query);
    const artifacts = await this.buildEvidencePackageArtifacts(query, exporter);

    const evidencePackage = await this.createEvidencePackageRecord({
      exportedByType: exporter.actorType,
      exportedById: exporter.actorId,
      exportedByRole: exporter.actorRole ?? null,
      status: AuditEvidencePackageStatus.READY,
      exportMode: query.mode || AuditEvidenceExportMode.SELECTION,
      filterSnapshot: this.serializeJson(selection.filterSnapshot),
      selectedEventIdsSnapshot: this.serializeJson(selection.selectedEventIds),
      itemCount: artifacts.itemCount,
      digest: artifacts.digest,
      manifest: this.serializeJson(artifacts.manifest),
      packageBody: this.serializeJson(artifacts.packageBody),
    });

    await this.recordByActor(
      {
        triggerType: AuditTriggerType.EVIDENCE_EXPORT,
        action: AuditActions.AUDIT_EVIDENCE_PACKAGE_EXPORTED,
        module: AuditModules.AUDIT_LOGS,
        entityType: AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE,
        entityId: evidencePackage.id,
        entityNo: evidencePackage.packageNo,
        result: AuditResult.SUCCESS,
        reason: `Exported ${artifacts.itemCount} audit logs`,
        metadata: {
          digest: artifacts.digest,
          itemCount: artifacts.itemCount,
          exportMode: query.mode || AuditEvidenceExportMode.SELECTION,
        },
        requestId: `EXPORT_${evidencePackage.packageNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      exporter,
    );

    return {
      id: evidencePackage.id,
      packageNo: evidencePackage.packageNo,
      fileName: evidencePackage.fileName || `${evidencePackage.packageNo}.json`,
      generatedAt: artifacts.generatedAt,
      status: evidencePackage.status || AuditEvidencePackageStatus.READY,
      itemCount: artifacts.itemCount,
      digest: artifacts.digest,
      manifest: artifacts.manifest,
    };
  }

  async markArchivedBefore(cutoff: Date, limit = 500) {
    const db = this.getDb() as any;
    if (!this.canOperateAuditLogEvent(db)) {
      return { archived: 0, ids: [] as string[] };
    }
    const rows = await db.auditLogEvent.findMany({
      where: {
        archivedAt: null,
        retainedUntil: { lt: cutoff },
      },
      select: { id: true },
      take: limit,
      orderBy: { retainedUntil: 'asc' },
    });

    if (!rows.length) {
      return { archived: 0, ids: [] as string[] };
    }

    const ids = rows.map((row: { id: string }) => row.id);
    const updated = await db.auditLogEvent.updateMany({
      where: { id: { in: ids } },
      data: { archivedAt: new Date() },
    });

    return { archived: updated.count as number, ids };
  }
}
