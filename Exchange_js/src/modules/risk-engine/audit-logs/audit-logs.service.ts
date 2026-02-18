import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from './constants/audit-actions.constant';
import {
  AuditActorContext,
  AuditLogQueryDto,
  AuditResult,
  AuditTriggerType,
  CreateAuditLogEventDto,
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
  packageNo: string;
  fileName: string;
  generatedAt: string;
  itemCount: number;
  digest: string;
  manifest: Record<string, unknown>;
  records: any[];
}

type AuditWriteClient = Prisma.TransactionClient | PrismaService;

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

  constructor(private readonly prisma: PrismaService) {}

  private getDb(client?: Prisma.TransactionClient): AuditWriteClient {
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
  ): AuditSubjectNoRecord[] {
    return buildAuditSubjectNos({
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
    });
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
    client?: Prisma.TransactionClient,
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
    for (let i = 0; i < AuditLogsService.MAX_NO_RETRIES; i += 1) {
      try {
        return await db.auditEvidencePackage.create({
          data: {
            ...data,
            packageNo: generateReferenceNo('EVP'),
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

  async hasIdempotencyKey(
    idempotencyKey: string,
    client?: Prisma.TransactionClient,
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
    client?: Prisma.TransactionClient,
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
    const entityOwnerNo = await this.resolveEntityOwnerNo(input, db);
    const subjectNos = this.buildSubjectNos(
      input,
      actor,
      actorNo,
      entityNo,
      entityOwnerNo,
    );

    const payloadDigest = sha256Hex({
      triggerType,
      action: input.action,
      module: input.module,
      entityType: input.entityType,
      entityId: input.entityId || null,
      entityNo: entityNo || null,
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
    client?: Prisma.TransactionClient,
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

  async exportEvidencePackage(
    query: ExportEvidencePackageDto,
    exporter: AuditActorContext,
  ): Promise<EvidenceExportResult> {
    const skip = this.normalizeSkip(query.skip);
    const maxItems = this.normalizeExportMaxItems(query.maxItems);
    const where = this.buildWhere(query);

    const db = this.getDb() as any;
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
      orderBy: { occurredAt: 'asc' },
      ...includeSubjectNos,
    });

    const records = rows.map((row: any) => this.mapEvent(row));
    const recordDigests = records.map((row: any) => ({
      id: row.id,
      auditNo: row.auditNo,
      digest: row.payloadDigest || sha256Hex(row),
    }));

    const generatedAt = new Date().toISOString();
    const manifest = {
      version: '1.0',
      generatedAt,
      exportedBy: exporter,
      criteria: {
        ...query,
        skip,
        maxItems,
      },
      itemCount: records.length,
      digestAlgorithm: 'sha256',
      recordDigests,
    };

    const digest = sha256Hex({ manifest, records });

    const evidencePackage = await this.createPackageWithUniqueNo({
      exportedByType: exporter.actorType,
      exportedById: exporter.actorId,
      exportedByRole: exporter.actorRole ?? null,
      filterSnapshot: this.serializeJson({ ...query, skip, maxItems }),
      itemCount: records.length,
      digest,
      manifest: this.serializeJson(manifest),
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
        reason: `Exported ${records.length} audit logs`,
        metadata: {
          digest,
          itemCount: records.length,
        },
        requestId: `EXPORT_${evidencePackage.packageNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      exporter,
    );

    return {
      packageNo: evidencePackage.packageNo,
      fileName: `${evidencePackage.packageNo}.json`,
      generatedAt,
      itemCount: records.length,
      digest,
      manifest,
      records: query.includeRecords === false ? [] : records,
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
