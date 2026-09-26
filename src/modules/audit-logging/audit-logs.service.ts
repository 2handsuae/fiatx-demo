import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../common/utils/no-generator.util';
import {
  AuditActions,
  AuditEntityTypes,
  mapRawAuditActionToUserAction,
  AuditWorkflowTypes,
  V1_AUDIT_ACTIONS,
  V1_ACTION_DOMAINS, CONTRACT_ACTION_DOMAINS, V4_DEPOSIT_AUDIT_ACTIONS, V5_WITHDRAW_AUDIT_ACTIONS, V6_SWAP_AUDIT_ACTIONS,
  V8_RECON_AUDIT_ACTIONS, V7_TREASURY_AUDIT_ACTIONS,
  V2_CUSTOMER_AUDIT_ACTIONS, RETIRED_DYNAMIC_TRANSITION_PATTERN,
  DEPRECATED_AUDIT_ACTIONS, INCIDENT_AUDIT_ACTIONS, REG_FILING_AUDIT_ACTIONS,
  COMPLIANCE_OFFICE_AUDIT_ACTIONS,
} from './constants/audit-actions.constant';
import {
  AuditActorContext,
  AuditCorrelationMode,
  AuditEvidenceExportMode,
  AuditEvidencePackageStatus,
  AuditLogView,
  AuditLogQueryDto,
  AuditOutcome,
  AuditSubjectInput,
  AuditSubjectRole,
  CreateAuditLogEventDto,
  EvidencePackageQueryDto,
  ExportEvidencePackageDto,
} from './dto/audit-log.dto';
import {
  maskIpAddress,
} from './utils/audit-mask.util';
import { sha256Hex } from './utils/audit-digest.util';

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

export interface DepositEvidenceChainItem {
  depositId: string;
  depositNo: string | null;
}

export interface DepositEvidenceSnapshots {
  deposits: any[];
  depositEvidenceChain: DepositEvidenceChainItem[];
}

export interface SwapEvidenceChainItem {
  swapId: string;
  swapNo: string | null;
  quoteId: string | null;
  quoteNo: string | null;
}

export interface SwapEvidenceSnapshots {
  swapTransactions: any[];
  swapQuotes: any[];
  swapEvidenceChain: SwapEvidenceChainItem[];
}

export interface WithdrawEvidenceChainItem {
  withdrawId: string;
  withdrawNo: string | null;
}

export interface WithdrawEvidenceSnapshots {
  withdrawTransactions: any[];
  withdrawEvidenceChain: WithdrawEvidenceChainItem[];
}

type AuditWriteClient = any;

@Injectable()
export class AuditLogsService {
  private static readonly MAX_NO_RETRIES = 10;
  private static readonly DEFAULT_TAKE = 50;
  private static readonly DEFAULT_EXPORT_MAX_ITEMS = 1000;
  private static readonly MAX_EXPORT_MAX_ITEMS = 5000;
  private static readonly RETENTION_YEARS = 8;

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
  ) {}

  private auditStorageUnavailable(resource: string): InternalServerErrorException {
    return new InternalServerErrorException(
      `${resource} is unavailable. Run npm run db:migrate:local or npm run dev:rebuild and retry.`,
    );
  }

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

  private toSortedUniqueStrings(values: Array<string | null | undefined>): string[] {
    return Array.from(
      new Set(
        values
          .map((value) => String(value || '').trim())
          .filter(Boolean),
      ),
    ).sort();
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
      approvalCaseNo: raw.approvalCaseNo || raw.approvalCase?.approvalNo || null,
      approvalCase: raw.approvalCase
        ? {
            id: raw.approvalCase.id,
            approvalNo: raw.approvalCase.approvalNo,
            actionType: raw.approvalCase.actionType,
            entityRef: raw.approvalCase.entityRef,
            status: raw.approvalCase.status,
            traceId: raw.approvalCase.traceId,
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

  private buildIdempotencyKey(
    input: CreateAuditLogEventDto,
  ): string | null {
    if (input.idempotencyKey) return input.idempotencyKey;
    if (!input.action) return null;
    const normalizedRequestId = this.normalizeOptionalString(input.requestId);

    const parts = [
      input.actionDomain,
      input.action,
      input.primarySubjectType || 'NA',
      input.primarySubjectNo || 'NA',
      input.correlationId || 'NO_CORRELATION',
      normalizedRequestId || 'NO_REQUEST_ID',
    ];

    return sha256Hex(parts.join('|'));
  }

  private mapEvent(raw: any): AuditLogView {
    const metadata = this.parseJson(raw.metadata);
    const userAction = this.deriveUserAction(raw.action);

    return {
      id: raw.id,
      eventNo: raw.eventNo,
      userAction,
      userActionLabel: this.toDisplayLabel(userAction),
      action: raw.action,
      category: raw.category ?? null,
      actionDomain: raw.actionDomain ?? null,
      primarySubjectType: raw.primarySubjectType ?? null,
      primarySubjectNo: raw.primarySubjectNo ?? null,
      traceId: raw.traceId ?? null,
      correlationId: raw.correlationId ?? null,
      causationId: raw.causationId ?? null,
      ownerCustomerNo: raw.ownerCustomerNo ?? null,
      actorType: raw.actorType,
      actorNo: raw.actorNo ?? null,
      actorDisplayName: raw.actorDisplayName,
      actorRolesAtTime: (() => {
        try { return JSON.parse(raw.actorRolesAtTime ?? '[]'); } catch { return []; }
      })(),
      isReadOnly: raw.isReadOnly ?? false,
      fromStatus: raw.fromStatus ?? null,
      toStatus: raw.toStatus ?? null,
      amount: raw.amount ?? null,
      currency: raw.currency ?? null,
      approvalNo: raw.approvalNo ?? null,
      policyCode: raw.policyCode ?? null,
      policyVersion: raw.policyVersion ?? null,
      reasonCode: raw.reasonCode ?? null,
      requestId: raw.requestId ?? null,
      sourceIp: raw.sourceIp ?? null,
      sourcePlatform: raw.sourcePlatform ?? null,
      outcome: raw.outcome ?? null,
      reason: raw.reason ?? null,
      metadata,
      beforeData: this.parseJson(raw.beforeData),
      afterData: this.parseJson(raw.afterData),
      payloadDigest: raw.payloadDigest ?? null,
      retainedUntil: raw.retainedUntil ?? null,
      occurredAt: raw.occurredAt,
      recordedAt: raw.recordedAt ?? null,
      archivedAt: raw.archivedAt ?? null,
    };
  }

  private deriveUserAction(action?: string | null): string | null {
    const normalizedAction = this.normalizeOptionalString(action)?.toUpperCase() || null;
    if (!normalizedAction) {
      return null;
    }

    return mapRawAuditActionToUserAction(normalizedAction) || normalizedAction;
  }

  private toDisplayLabel(value: string | null): string | null {
    const normalized = this.normalizeOptionalString(value);
    if (!normalized) {
      return null;
    }

    return normalized
      .toLowerCase()
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private async resolveSwapExportSelectionContext(
    records: any[],
    db: any,
  ): Promise<{
    swapIds: string[];
    swapNos: string[];
    quoteIds: string[];
    quoteNos: string[];
    swapTransactions: Array<{
      id: string;
      swapNo: string | null;
      quoteId: string | null;
      quoteNo: string | null;
      quoteSnapshotRef?: string | null;
    }>;
    swapQuotes: Array<{
      id: string;
      quoteNo: string | null;
    }>;
  }> {
    const candidateNos = this.toSortedUniqueStrings(
      records
        .filter((item) =>
          item.primarySubjectNo &&
          (item.primarySubjectType === AuditEntityTypes.SWAP_TRANSACTION ||
           item.primarySubjectType === AuditEntityTypes.SWAP_QUOTE),
        )
        .map((item) => this.normalizeOptionalString(item.primarySubjectNo)) as Array<string | null>,
    );

    if (!candidateNos.length) {
      return {
        swapIds: [],
        swapNos: [],
        quoteIds: [],
        quoteNos: [],
        swapTransactions: [],
        swapQuotes: [],
      };
    }

    const swapTransactions = db?.swapTransaction?.findMany
      ? await db.swapTransaction.findMany({
          where: {
            OR: [
              { swapNo: { in: candidateNos } },
              { quoteNo: { in: candidateNos } },
            ],
          },
          select: {
            id: true,
            swapNo: true,
            quoteId: true,
            quoteNo: true,
            quoteSnapshotRef: true,
          },
        })
      : [];

    const quoteIds = this.toSortedUniqueStrings([
      ...swapTransactions.map((item: any) => item.quoteId),
      ...swapTransactions.map((item: any) => item.quoteSnapshotRef),
    ]);

    const swapQuotes = (quoteIds.length || candidateNos.length) && db?.swapQuote?.findMany
      ? await db.swapQuote.findMany({
          where: {
            OR: [
              { id: { in: quoteIds } },
              { quoteNo: { in: candidateNos } },
            ],
          },
          select: {
            id: true,
            quoteNo: true,
          },
        })
      : [];

    return {
      swapIds: this.toSortedUniqueStrings(swapTransactions.map((item: any) => item.id)),
      swapNos: this.toSortedUniqueStrings(
        swapTransactions.map((item: any) => item.swapNo),
      ),
      quoteIds: this.toSortedUniqueStrings([
        ...quoteIds,
        ...swapQuotes.map((item: any) => item.id),
      ]),
      quoteNos: this.toSortedUniqueStrings([
        ...swapTransactions.map((item: any) => item.quoteNo),
        ...swapQuotes.map((item: any) => item.quoteNo),
      ]),
      swapTransactions,
      swapQuotes,
    };
  }

  private async buildWhere(query: AuditLogQueryDto, db?: any): Promise<any> {
    const startAt = this.toDate(query.startAt);
    const endAt = this.toDate(query.endAt);

    if (startAt && endAt && startAt > endAt) {
      throw new BadRequestException('startAt must be less than or equal to endAt');
    }

    const where: any = {};
    const andClauses: any[] = [];
    if (query.actorNo) andClauses.push({ actorNo: query.actorNo });
    if (query.traceId) andClauses.push({ traceId: query.traceId });
    if (query.workflowType) andClauses.push({ workflowType: query.workflowType });
    if (query.outcome) andClauses.push({ outcome: query.outcome });


    if (query.includeArchived !== true) {
      andClauses.push({ archivedAt: null });
    }

    if (startAt || endAt) {
      const occurredAt: any = {};
      if (startAt) occurredAt.gte = startAt;
      if (endAt) occurredAt.lte = endAt;
      andClauses.push({ occurredAt });
    }

    if (query.keyword) {
      andClauses.push({
        OR: [
          { eventNo: { contains: query.keyword } },   // ← 新增：Audit No 假承诺修复（波三）
          { action: { contains: query.keyword } },
          { primarySubjectType: { contains: query.keyword } },
          { primarySubjectNo: { contains: query.keyword } },
          { actorNo: { contains: query.keyword } },
          { ownerCustomerNo: { contains: query.keyword } },
          { traceId: { contains: query.keyword } },
          { reason: { contains: query.keyword } },
        ],
      });
    }

    if (andClauses.length === 1) {
      return andClauses[0];
    }
    if (andClauses.length > 1) {
      where.AND = andClauses;
    }
    return where;
  }

  /**
   * 把 subjects 逐行落子表。与主记录同一个 client（同事务）。
   * 不做 upsert —— 唯一键冲突意味着调用方重复传了同一 (类型, 业务键, 角色)，是调用方 bug，应当响。
   */
  private async persistSubjects(
    eventId: string,
    occurredAt: Date,
    subjects: AuditSubjectInput[] | undefined,
    client?: AuditWriteClient,
  ): Promise<void> {
    if (!subjects || subjects.length === 0) return;

    const primaryCount = subjects.filter(
      (s) => s.subjectRole === AuditSubjectRole.PRIMARY,
    ).length;
    if (primaryCount > 1) {
      throw new BadRequestException(
        `Audit event must carry at most exactly one PRIMARY subject, got ${primaryCount}. ` +
          '改了 N 个对象就写 N 条记录，不要在一条记录上挂多个 PRIMARY。',
      );
    }

    const db = this.getDb(client) as any;
    if (!db?.auditLogSubject?.createMany) return;

    await db.auditLogSubject.createMany({
      data: subjects.map((s) => ({
        eventId,
        subjectType: s.subjectType,
        subjectNo: s.subjectNo,
        subjectRole: s.subjectRole,
        occurredAt,
      })),
    });
  }

  // 返回 isNew 供调用方判断：幂等命中（isNew=false）时子表已在首次写入时落过，
  // 调用方不应重放 persistSubjects——否则撞 subjects 唯一键。
  private async createEventWithUniqueNo(
    data: any,
    client?: AuditWriteClient,
  ): Promise<{ row: any; isNew: boolean }> {
    const db = this.getDb(client) as any;

    if (!this.canOperateAuditLogEvent(db)) {
      throw this.auditStorageUnavailable('Audit log event storage');
    }

    if (data.idempotencyKey) {
      const existing = await db.auditLogEvent.findUnique({
        where: { idempotencyKey: data.idempotencyKey },
      });
      if (existing) return { row: existing, isNew: false };
    }

    for (let i = 0; i < AuditLogsService.MAX_NO_RETRIES; i += 1) {
      try {
        const createData: any = {
          ...data,
          eventNo: generateReferenceNo('AUD'),
        };

        const row = await db.auditLogEvent.create({
          data: createData,
        });
        return { row, isNew: true };
      } catch (error) {
        if (this.isUniqueConflict(error, 'eventNo')) continue;

        if (data.idempotencyKey && this.isUniqueConflict(error, 'idempotencyKey')) {
          const existing = await db.auditLogEvent.findUnique({
            where: { idempotencyKey: data.idempotencyKey },
          });
          if (existing) return { row: existing, isNew: false };
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
      throw this.auditStorageUnavailable('Audit evidence package storage');
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

    const db = this.getDb() as any;
    if (!this.canOperateAuditLogEvent(db)) {
      throw new BadRequestException('Audit log event model is unavailable');
    }
    const where = {
      ...(await this.buildWhere(query, db)),
      id: { in: selectedEventIds },
    };

    const rows = await db.auditLogEvent.findMany({
      where,
      skip,
      take: maxItems,
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
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
    const swapSelectionContext =
      workflowSummaryType === AuditWorkflowTypes.SWAP
        ? await this.resolveSwapExportSelectionContext(records, db)
        : null;
    const canonicalSwapWorkflowNo =
      swapSelectionContext && swapSelectionContext.swapNos.length === 1
        ? swapSelectionContext.swapNos[0]
        : null;
    const workflowSummaryNos =
      workflowSummaryType === AuditWorkflowTypes.SWAP && swapSelectionContext
        ? swapSelectionContext.swapNos.length
          ? swapSelectionContext.swapNos
          : []
        : [];

    if (
      workflowSummaryType === AuditWorkflowTypes.SWAP &&
      swapSelectionContext &&
      swapSelectionContext.swapNos.length === 0
    ) {
      throw new BadRequestException(
        'SWAP evidence export selection requires linked swap transaction records',
      );
    }

    return {
      normalizedCriteria: {
        mode: query.mode || AuditEvidenceExportMode.SELECTION,
        skip,
        maxItems,
        includeRecords: query.includeRecords !== false,
        workflowType: explicitWorkflowType,
        traceId: query.traceId || null,
        actorNo: query.actorNo || null,
        ownerCustomerNo: query.ownerCustomerNo || null,
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
        workflowNos: workflowSummaryNos,
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
    const [depositSnapshots, withdrawSnapshots, swapSnapshots] = await Promise.all([
      this.buildDepositSnapshots(selection.records, db),
      this.buildWithdrawSnapshots(selection.records, db),
      this.buildSwapSnapshots(selection.records, db),
    ]);
    const snapshots = {
      ...depositSnapshots,
      ...withdrawSnapshots,
      ...swapSnapshots,
    };
    const recordDigests = selection.records.map((row: any) => ({
      id: row.id,
      eventNo: row.eventNo,
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
    if (!this.canOperateAuditLogEvent(db)) {
      throw this.auditStorageUnavailable('Audit log event storage');
    }
    const existing = await db.auditLogEvent.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    return !!existing;
  }

  /**
   * 按词表声明做写入前校验。声明缺一项就拒绝写入——
   * 「条件必填」由此从一句文档变成硬闸门。
   * 未在 V1 词表里的码（交易域）暂不校验，留给交易域批次。
   *
   * 退役码拦截刻意加了一道 actionDomain 网关（必须显式落在 V1 四域内才拦）——
   * DEPRECATED_AUDIT_ACTIONS 里的裸词是老命名法遗留、不是扁平全局唯一：
   * 'CHANGE_APPLY_FAILED' 此前同时被 TRANSACTION_LIMIT_CHANGE / SWAP_FEE_LEVEL_CHANGE /
   * WITHDRAWAL_FEE_LEVEL_CHANGE 三个保留（非 V1）域复用；三者已分别在 Task 12（费率
   * 两域）/ Task 14（限额）迁走，不再触碰这个裸词。名单里其余码此刻仍可能有真实调用
   * 方在写（含 auth.service.ts 的登录打点）——这些调用方一个都还没迁移到 V1 新码
   * （迁移是 Task 5-9 的事）。若不带这道网关无差别硬拒，会把这些当下仍在正常工作的
   * 调用点现在就打炸，而不是「其他域打审计失败没关系」那种优雅降级。V1 调用方迁移
   * 后会显式传 actionDomain，这条闸门才对它生效——与下面 spec 校验的适用范围用同一
   * 套判据（见 Task 4 report）。
   */
  private assertActionSpec(input: CreateAuditLogEventDto): void {
    const inContractDomain = (CONTRACT_ACTION_DOMAINS as readonly string[]).includes(
      input.actionDomain as string,
    );

    if (inContractDomain && DEPRECATED_AUDIT_ACTIONS.includes(input.action)) {
      throw new BadRequestException(
        `Audit action ${input.action} is deprecated and no longer accepts new writes.`,
      );
    }
    // 站1b-β：动态迁移码族（DEPOSIT_<从>_TO_<到>）整族废除——状态变化进 from/to 两列。
    if (inContractDomain && RETIRED_DYNAMIC_TRANSITION_PATTERN.test(input.action)) {
      throw new BadRequestException(
        `Audit action ${input.action} belongs to the retired dynamic transition family — use the flow code with fromStatus/toStatus columns.`,
      );
    }

    const spec =
      V1_AUDIT_ACTIONS[input.action] ??
      V4_DEPOSIT_AUDIT_ACTIONS[input.action] ??
      V5_WITHDRAW_AUDIT_ACTIONS[input.action] ??
      V6_SWAP_AUDIT_ACTIONS[input.action] ??
      V8_RECON_AUDIT_ACTIONS[input.action] ??
      V7_TREASURY_AUDIT_ACTIONS[input.action] ??
      INCIDENT_AUDIT_ACTIONS[input.action] ??
      REG_FILING_AUDIT_ACTIONS[input.action] ??
      COMPLIANCE_OFFICE_AUDIT_ACTIONS[input.action] ??
      V2_CUSTOMER_AUDIT_ACTIONS[input.action];
    if (!spec) return;

    if (input.actionDomain !== spec.domain) {
      throw new BadRequestException(
        `Audit action ${input.action} must carry actionDomain=${spec.domain}, got ${input.actionDomain}.`,
      );
    }

    // requiredFields 描述的是「成功执行会产出什么」——失败/被拒时按定义就产不出来：
    //   AUDIT_EVIDENCE_EXPORT_GENERATED 失败时没有产物，就没有产物摘要；
    //   ADMIN_ROLE_CHANGE_APPLIED 失败时变更没落地，就没有 afterData。
    // 若不分成败一律强制，每条失败分支都会被拒绝写入 —— 而「失败必须留痕」是本批的核心。
    // 故：成功路径强制 requiredFields；非成功路径改为强制 reasonCode（失败要能被机器聚合）。
    const isSuccess = !input.outcome || input.outcome === AuditOutcome.SUCCESS;
    if (isSuccess) {
      const missing = spec.requiredFields.filter(
        (f) => (input as any)[f] === undefined || (input as any)[f] === null,
      );
      if (missing.length > 0) {
        throw new BadRequestException(
          `Audit action ${input.action} missing required field(s): ${missing.join(', ')}.`,
        );
      }
    } else if (!input.reasonCode) {
      throw new BadRequestException(
        `Audit action ${input.action} has outcome=${input.outcome} and must carry reasonCode. ` +
          '非成功的记录必须带机器可读原因码，否则「这个月因什么拦了多少笔」统计不出来。',
      );
    }

    if (spec.requiresCausation && !input.causationId) {
      throw new BadRequestException(
        `Audit action ${input.action} is asynchronously driven and must carry causationId.`,
      );
    }

    if (spec.correlationMode === AuditCorrelationMode.INHERIT && !input.correlationId) {
      throw new BadRequestException(
        `Audit action ${input.action} is INHERIT and must inherit an existing correlationId. ` +
          '读不到就是有问题（主单没落库，或 START 那步漏了）——绝不允许静默生成新值。',
      );
    }
  }

  async recordByActor(
    input: CreateAuditLogEventDto,
    actor: AuditActorContext,
    client?: AuditWriteClient,
  ) {
    this.assertActionSpec(input);

    const occurredAt = input.occurredAt ? this.toDate(input.occurredAt) : new Date();
    if (!occurredAt) {
      throw new BadRequestException('occurredAt parsing failed');
    }

    const maskedSourceIp = maskIpAddress(input.sourceIp);
    const normalizedRequestId = this.normalizeOptionalString(input.requestId);

    const idempotencyKey = this.buildIdempotencyKey(input);
    const retainedUntil = this.toRetainedUntil(occurredAt);

    const payloadDigest = sha256Hex({
      action: input.action,
      actionDomain: input.actionDomain ?? 'UNCLASSIFIED',
      primarySubjectType: input.primarySubjectType || null,
      primarySubjectNo: input.primarySubjectNo || null,
      ownerCustomerNo: input.ownerCustomerNo || null,
      traceId: input.traceId || null,
      actorType: actor.actorType,
      actorNo: actor.actorNo,
      requestId: normalizedRequestId,
      sourceIp: maskedSourceIp,
      sourcePlatform: input.sourcePlatform || null,
      outcome: input.outcome || AuditOutcome.SUCCESS,
      reason: input.reason || null,
      metadata: input.metadata ?? null,
      occurredAt: occurredAt.toISOString(),
      retainedUntil: retainedUntil.toISOString(),
    });

    const { row: created, isNew } = await this.createEventWithUniqueNo(
      {
        action: input.action,
        // NOT NULL 列，无 DB default——业主裁定其他域暂不传分类，占位值
        // 'UNCLASSIFIED' 如实标注"未分类"，可用 WHERE actionDomain='UNCLASSIFIED'
        // 一把捞出待各域批次补分类的记录；不猜一个像样的值(如 SYSTEM/BUSINESS)充数。
        actionDomain: input.actionDomain ?? 'UNCLASSIFIED',
        category: input.category ?? 'UNCLASSIFIED',
        isReadOnly: input.isReadOnly ?? false,
        primarySubjectType: input.primarySubjectType ?? null,
        primarySubjectNo: input.primarySubjectNo ?? null,
        ownerCustomerNo: input.ownerCustomerNo ?? null,
        actorType: actor.actorType,
        actorNo: actor.actorNo,
        actorDisplayName: actor.actorDisplayName,
        actorRolesAtTime: JSON.stringify(actor.actorRolesAtTime ?? []),
        onBehalfOfType: actor.onBehalfOfType ?? null,
        onBehalfOfNo: actor.onBehalfOfNo ?? null,
        authnMethod: actor.authnMethod ?? null,
        sourcePlatform: input.sourcePlatform ?? 'SYSTEM',
        requestId: normalizedRequestId,
        sessionId: input.sessionId ?? null,
        sourceIp: maskedSourceIp,
        userAgent: input.userAgent ?? null,
        endpoint: input.endpoint ?? null,
        outcome: input.outcome ?? AuditOutcome.SUCCESS,
        reasonCode: input.reasonCode ?? null,
        reason: input.reason ?? null,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        beforeData: this.serializeJson(input.beforeData ?? null),
        afterData: this.serializeJson(input.afterData ?? null),
        amount: input.amount ?? null,
        currency: input.currency ?? null,
        permissionCode: input.permissionCode ?? null,
        policyCode: input.policyCode ?? null,
        policyVersion: input.policyVersion ?? null,
        approvalNo: input.approvalNo ?? null,
        ruleCode: input.ruleCode ?? null,
        ruleVersion: input.ruleVersion ?? null,
        correlationId: input.correlationId ?? null,
        causationId: input.causationId ?? null,
        traceId: input.traceId ?? null,
        groupEventId: input.groupEventId ?? null,
        externalEvidenceRef: input.externalEvidenceRef ?? null,
        metadata: this.serializeJson(input.metadata ?? null),
        effectiveDate: input.effectiveDate ? this.toDate(input.effectiveDate) : null,
        idempotencyKey,
        payloadDigest,
        retainedUntil,
        occurredAt,
        recordedAt: new Date(),
      },
      client,
    );

    // 幂等命中（isNew=false）时 created 是既有行，子表早已写过——重放会撞
    // @@unique([eventId, subjectType, subjectNo, subjectRole])，只在真新建时落子表。
    if (isNew) {
      await this.persistSubjects(created.id, occurredAt, input.subjects, client);
    }

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
        actorNo: 'SYSTEM',
        actorDisplayName: 'SYSTEM',
        actorRolesAtTime: [],
      },
      client,
    );
  }

  async findAll(query: AuditLogQueryDto) {
    const skip = this.normalizeSkip(query.skip);
    const take = this.normalizeTake(query.take);

    const db = this.getDb() as any;
    if (!this.canOperateAuditLogEvent(db)) {
      throw this.auditStorageUnavailable('Audit log event storage');
    }
    const where = await this.buildWhere(query, db);

    if (query.actionDomain) (where as any).actionDomain = query.actionDomain;
    if (query.action) (where as any).action = query.action;
    if (query.outcome) (where as any).outcome = query.outcome;
    if (query.correlationId) (where as any).correlationId = query.correlationId;
    if (query.causationId) (where as any).causationId = query.causationId;
    if (query.ownerCustomerNo) (where as any).ownerCustomerNo = query.ownerCustomerNo;
    if (query.primarySubjectType) (where as any).primarySubjectType = query.primarySubjectType;
    if (query.primarySubjectNo) (where as any).primarySubjectNo = query.primarySubjectNo;
    if (query.isReadOnly !== undefined) (where as any).isReadOnly = query.isReadOnly;

    if (query.subjectNo && !query.subjectRole) {
      // 波三扩语义：Related No = 主对象或任一相关主体。subjects 子表只覆盖名册码
      // （SUBJECTS_COVERED_ACTIONS），交易域主链事件只在主表列上，纯子表查询拉不全。
      // 不直接挂 where.OR——buildWhere 可能已把 keyword 的 OR 返回为顶层子句，会被覆写。
      const subjectClause = {
        OR: [
          { primarySubjectNo: query.subjectNo },
          { subjects: { some: { subjectNo: query.subjectNo } } },
        ],
      };
      (where as any).AND = Array.isArray((where as any).AND)
        ? [...(where as any).AND, subjectClause]
        : (where as any).AND
          ? [(where as any).AND, subjectClause]
          : [subjectClause];
    } else if (query.subjectNo || query.subjectRole) {
      const some: Record<string, string> = {};
      if (query.subjectNo) some.subjectNo = query.subjectNo;
      if (query.subjectRole) some.subjectRole = query.subjectRole;
      (where as any).subjects = { some };
    }

    const [total, rows] = await Promise.all([
      db.auditLogEvent.count({ where }),
      db.auditLogEvent.findMany({
        where,
        skip,
        take,
        orderBy: { occurredAt: 'desc' },
        include: {
          subjects: { select: { subjectType: true, subjectNo: true, subjectRole: true } },
        },
      }),
    ]);

    return {
      total,
      skip,
      take,
      items: rows.map((row: any) => {
        const mapped: any = this.mapEvent(row);
        mapped.subjects = (row.subjects ?? []).map((s: any) => ({
          subjectType: s.subjectType,
          subjectNo: s.subjectNo,
          subjectRole: s.subjectRole,
        }));
        return mapped;
      }),
    };
  }

  async findOne(eventNo: string) {
    const db = this.getDb() as any;
    if (!this.canOperateAuditLogEvent(db)) {
      throw this.auditStorageUnavailable('Audit log event storage');
    }
    const found = await db.auditLogEvent.findUnique({
      where: { eventNo },
      include: {
        subjects: { select: { subjectType: true, subjectNo: true, subjectRole: true } },
      },
    });

    if (!found) {
      throw new NotFoundException(`Audit log not found: ${eventNo}`);
    }

    const mapped: any = this.mapEvent(found);
    mapped.subjects = (found.subjects ?? []).map((s: any) => ({
      subjectType: s.subjectType,
      subjectNo: s.subjectNo,
      subjectRole: s.subjectRole,
    }));
    return mapped;
  }

  private async buildDepositSnapshots(records: any[], db: any): Promise<DepositEvidenceSnapshots> {
    const candidateNos = this.toSortedUniqueStrings(
      records
        .filter(
          (item) =>
            item.primarySubjectNo &&
            item.primarySubjectType === AuditEntityTypes.DEPOSIT_TRANSACTION,
        )
        .map((item) => this.normalizeOptionalString(item.primarySubjectNo)) as Array<string | null>,
    );

    if (!candidateNos.length || !db?.depositTransaction?.findMany) {
      return { deposits: [], depositEvidenceChain: [] };
    }

    const deposits = await db.depositTransaction.findMany({
      where: { depositNo: { in: candidateNos } },
      orderBy: { depositNo: 'asc' },
      include: {
        customer: {
          select: { id: true, customerNo: true, firstName: true, lastName: true, email: true },
        },
        asset: {
          select: { id: true, code: true, type: true, network: true, decimals: true },
        },
      },
    });

    const depositEvidenceChain: DepositEvidenceChainItem[] = deposits.map((row: any) => ({
      depositId: String(row.id),
      depositNo: row.depositNo ?? null,
    }));

    return { deposits, depositEvidenceChain };
  }

  private async buildWithdrawSnapshots(records: any[], db: any): Promise<WithdrawEvidenceSnapshots> {
    const candidateNos = this.toSortedUniqueStrings(
      records
        .filter(
          (item) =>
            item.primarySubjectNo &&
            item.primarySubjectType === AuditEntityTypes.WITHDRAW_TRANSACTION,
        )
        .map((item) => this.normalizeOptionalString(item.primarySubjectNo)) as Array<string | null>,
    );

    if (!candidateNos.length || !db?.withdrawTransaction?.findMany) {
      return { withdrawTransactions: [], withdrawEvidenceChain: [] };
    }

    const withdrawTransactions = await db.withdrawTransaction.findMany({
      where: { withdrawNo: { in: candidateNos } },
      orderBy: { withdrawNo: 'asc' },
      include: {
        asset: {
          select: { id: true, code: true, type: true, network: true, decimals: true },
        },
        customer: {
          select: { id: true, customerNo: true, firstName: true, lastName: true, email: true, riskRating: true },
        },
      },
    });

    const withdrawEvidenceChain: WithdrawEvidenceChainItem[] = withdrawTransactions.map((row: any) => ({
      withdrawId: String(row.id),
      withdrawNo: row.withdrawNo ?? null,
    }));

    return { withdrawTransactions, withdrawEvidenceChain };
  }

  private async buildSwapSnapshots(
    records: any[],
    db: any,
  ): Promise<SwapEvidenceSnapshots> {
    const selectionContext = await this.resolveSwapExportSelectionContext(records, db);
    const workflowIds = this.toSortedUniqueStrings([
      ...selectionContext.swapIds,
      ...selectionContext.quoteIds,
    ]);

    if (
      !workflowIds.length ||
      !db?.swapTransaction?.findMany ||
      !db?.swapQuote?.findMany
    ) {
      return {
        swapTransactions: [],
        swapQuotes: [],
        swapEvidenceChain: [],
      };
    }

    const initialQuotes = await db.swapQuote.findMany({
      where: { id: { in: selectionContext.quoteIds } },
      orderBy: { quoteNo: 'asc' },
      include: {
        fromAsset: {
          select: {
            id: true,
            code: true,
            type: true,
            network: true,
            decimals: true,
          },
        },
        toAsset: {
          select: {
            id: true,
            code: true,
            type: true,
            network: true,
            decimals: true,
          },
        },
      },
    });

    const swapTransactions = await db.swapTransaction.findMany({
      where: {
        OR: [
          { id: { in: selectionContext.swapIds } },
          { quoteId: { in: selectionContext.quoteIds } },
          { quoteSnapshotRef: { in: selectionContext.quoteIds } },
        ],
      },
      orderBy: { swapNo: 'asc' },
      include: {
        fromAsset: {
          select: {
            id: true,
            code: true,
            type: true,
            network: true,
            decimals: true,
          },
        },
        toAsset: {
          select: {
            id: true,
            code: true,
            type: true,
            network: true,
            decimals: true,
          },
        },
        customer: {
          select: {
            id: true,
            customerNo: true,
            firstName: true,
            lastName: true,
            email: true,
            riskRating: true,
          },
        },
      },
    });

    const quoteIds = this.toSortedUniqueStrings([
      ...initialQuotes.map((item: any) => item.id),
      ...swapTransactions.map((item: any) => item.quoteId),
      ...swapTransactions.map((item: any) => item.quoteSnapshotRef),
    ]);

    const swapQuotes = quoteIds.length
      ? await db.swapQuote.findMany({
          where: { id: { in: quoteIds } },
          orderBy: { quoteNo: 'asc' },
          include: {
            fromAsset: {
              select: {
                id: true,
                code: true,
                type: true,
                network: true,
                decimals: true,
              },
            },
            toAsset: {
              select: {
                id: true,
                code: true,
                type: true,
                network: true,
                decimals: true,
              },
            },
          },
        })
      : [];

    const swapEvidenceChain: SwapEvidenceChainItem[] = swapTransactions.map((row: any) => ({
      swapId: String(row.id),
      swapNo: row.swapNo ?? null,
      quoteId: row.quoteId ?? row.quoteSnapshotRef ?? null,
      quoteNo: row.quoteNo ?? null,
    }));

    return { swapTransactions, swapQuotes, swapEvidenceChain };
  }

  async findEvidencePackages(query: EvidencePackageQueryDto) {
    const skip = this.normalizeSkip(query.skip);
    const take = this.normalizeTake(query.take);
    const db = this.getDb() as any;

    if (!this.canOperateAuditEvidencePackage(db)) {
      throw this.auditStorageUnavailable('Audit evidence package storage');
    }

    const where: any = {
      deletedAt: null,
    };
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
              traceId: true,
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

  async findEvidencePackage(packageNo: string) {
    const db = this.getDb() as any;
    if (!this.canOperateAuditEvidencePackage(db)) {
      throw this.auditStorageUnavailable('Audit evidence package storage');
    }

    const found = await db.auditEvidencePackage.findUnique({
      where: { packageNo },
      include: {
        approvalCase: {
          select: {
            id: true,
            approvalNo: true,
            actionType: true,
            entityRef: true,
            status: true,
            traceId: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
    if (!found || found.deletedAt) {
      throw new NotFoundException(`Evidence package not found: ${packageNo}`);
    }

    return this.mapEvidencePackage(found);
  }

  async downloadEvidencePackage(packageNo: string) {
    const found = await this.findEvidencePackage(packageNo);
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

  async findEvidencePackageForApproval(
    approvalId: string,
    entityRef?: string | null,
  ): Promise<any | null> {
    const db = this.getDb() as any;
    if (!this.canOperateAuditEvidencePackage(db)) return null;
    const orClauses: any[] = [{ approvalCaseId: approvalId }];
    // entityRef 现在存 packageNo（铁律⑥，见 audit-evidence-export-workflow.service.ts）。
    if (entityRef) orClauses.push({ packageNo: entityRef });
    return db.auditEvidencePackage.findFirst({ where: { deletedAt: null, OR: orClauses } });
  }

  async linkEvidencePackageApproval(
    packageId: string,
    approvalCaseId: string,
    approvalCaseNo: string | null,
  ): Promise<void> {
    const db = this.getDb() as any;
    if (!this.canOperateAuditEvidencePackage(db)) {
      throw this.auditStorageUnavailable('Audit evidence package storage');
    }
    await db.auditEvidencePackage.update({
      where: { id: packageId },
      data: { approvalCaseId, approvalCaseNo },
    });
  }

  async finalizeEvidencePackage(
    packageId: string,
    data: { status: string; fileName: string; digest: string; manifest: string; packageBody: string },
  ): Promise<void> {
    const db = this.getDb() as any;
    if (!this.canOperateAuditEvidencePackage(db)) {
      throw this.auditStorageUnavailable('Audit evidence package storage');
    }
    await db.auditEvidencePackage.update({ where: { id: packageId }, data });
  }

  async markEvidencePackageFailed(packageId: string): Promise<void> {
    const db = this.getDb() as any;
    if (!this.canOperateAuditEvidencePackage(db)) return;
    await db.auditEvidencePackage.update({
      where: { id: packageId },
      data: { status: AuditEvidencePackageStatus.FAILED },
    });
  }

  async bulkMarkEvidencePackagesStatus(
    approvalId: string,
    entityRef: string | null | undefined,
    status: AuditEvidencePackageStatus,
  ): Promise<void> {
    const db = this.getDb() as any;
    if (!this.canOperateAuditEvidencePackage(db)) return;
    const orClauses: any[] = [{ approvalCaseId: approvalId }];
    // entityRef 现在存 packageNo（铁律⑥，见 audit-evidence-export-workflow.service.ts）。
    if (entityRef) orClauses.push({ packageNo: entityRef });
    await db.auditEvidencePackage.updateMany({
      where: { deletedAt: null, OR: orClauses },
      data: { status },
    });
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
