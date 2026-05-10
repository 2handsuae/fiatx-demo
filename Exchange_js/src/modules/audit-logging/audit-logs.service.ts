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
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditModules,
  mapRawAuditActionToUserAction,
  AuditWorkflowTypes,
} from './constants/audit-actions.constant';
import {
  AuditActorContext,
  AuditEvidenceExportMode,
  AuditEvidencePackageStatus,
  AuditLogView,
  AuditLogQueryDto,
  AuditResult,
  AuditSubjectRole,
  CreateAuditLogEventDto,
  EvidencePackageQueryDto,
  ExportEvidencePackageDto,
} from './dto/audit-log.dto';
import {
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

export interface DepositEvidenceChainItem {
  depositId: string;
  depositNo: string | null;
  payinId: string | null;
  payinNo: string | null;
  decisionRecordIds: string[];
  kytCaseIds: string[];
  travelRuleCaseIds: string[];
  alertIds: string[];
  caseIds: string[];
  journalIds: string[];
  internalTransactionIds: string[];
  internalFundIds: string[];
}

export interface DepositEvidenceSnapshots {
  deposits: any[];
  kytCases: any[];
  travelRuleCases: any[];
  riskDecisionRecords: any[];
  alerts: any[];
  cases: any[];
  journals: any[];
  internalTransactions: any[];
  internalFunds: any[];
  depositEvidenceChain: DepositEvidenceChainItem[];
}

export interface SwapEvidenceChainItem {
  swapId: string;
  swapNo: string | null;
  quoteId: string | null;
  quoteNo: string | null;
  decisionRecordIds: string[];
  alertIds: string[];
  caseIds: string[];
  journalIds: string[];
  outstandingIds: string[];
}

export interface SwapEvidenceSnapshots {
  swapTransactions: any[];
  swapQuotes: any[];
  swapRiskDecisionRecords: any[];
  swapAlerts: any[];
  swapCases: any[];
  swapJournals: any[];
  swapOutstandings: any[];
  swapEvidenceChain: SwapEvidenceChainItem[];
}

export interface WithdrawEvidenceChainItem {
  withdrawId: string;
  withdrawNo: string | null;
  payoutId: string | null;
  payoutNo: string | null;
  decisionRecordIds: string[];
  preKytCaseIds: string[];
  mainKytCaseIds: string[];
  travelRuleCaseIds: string[];
  alertIds: string[];
  caseIds: string[];
  journalIds: string[];
  clearingIds: string[];
  reconciliationBreakIds: string[];
}

export interface WithdrawEvidenceSnapshots {
  withdrawTransactions: any[];
  payouts: any[];
  preKytCases: any[];
  mainKytCases: any[];
  travelRuleCases: any[];
  riskDecisionRecords: any[];
  alerts: any[];
  cases: any[];
  journals: any[];
  clearings: any[];
  reconciliationBreaks: any[];
  withdrawEvidenceChain: WithdrawEvidenceChainItem[];
}

interface AuditWorkflowContext {
  traceId: string | null;
  workflowType: string | null;
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

  private toSortedUniqueStrings(values: Array<string | null | undefined>): string[] {
    return Array.from(
      new Set(
        values
          .map((value) => String(value || '').trim())
          .filter(Boolean),
      ),
    ).sort();
  }

  private parseStringArray(value?: string | null): string[] {
    const parsed = this.parseJson(value);
    if (!Array.isArray(parsed)) return [];
    return this.toSortedUniqueStrings(parsed.map((item) => String(item ?? '')));
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
      FEE_OCCURRENCE: { model: 'feeOccurrence', field: 'feeNo' },
      REIMBURSEMENT_OBLIGATION: {
        model: 'reimbursementObligation',
        field: 'obligationNo',
      },
      SAFEGUARDING_RUN: { model: 'safeguardingRun', field: 'runNo' },
      RECONCILIATION_WARNING: {
        model: 'reconciliationWarning',
        field: 'warningNo',
      },
      FIAT_STATEMENT_IMPORT: {
        model: 'fiatStatementImport',
        field: 'importNo',
      },
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
      RECONCILIATION_BREAK: { model: 'reconciliationBreak', field: 'breakNo' },
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
  ): Promise<AuditWorkflowContext> {
    const explicitWorkflowType = this.normalizeEntityType(input.workflowType);
    const entityType = this.normalizeEntityType(input.entityType);
    const shouldResolveWithdraw =
      explicitWorkflowType === AuditWorkflowTypes.WITHDRAW ||
      entityType === AuditEntityTypes.WITHDRAW_TRANSACTION ||
      entityType === AuditEntityTypes.PAYOUT ||
      entityType === AuditEntityTypes.RECONCILIATION_BREAK;
    const shouldResolveDeposit =
      explicitWorkflowType === AuditWorkflowTypes.DEPOSIT ||
      entityType === AuditEntityTypes.DEPOSIT_TRANSACTION ||
      entityType === AuditEntityTypes.PAYIN;
    const shouldResolveSwap =
      explicitWorkflowType === AuditWorkflowTypes.SWAP ||
      entityType === AuditEntityTypes.SWAP_TRANSACTION ||
      entityType === AuditEntityTypes.SWAP_QUOTE;

    if (!shouldResolveWithdraw && !shouldResolveDeposit && !shouldResolveSwap) {
      return {
        traceId: this.normalizeOptionalString(input.traceId),
        workflowType: this.normalizeOptionalString(input.workflowType),
        entityOwnerNo,
        relatedSubjectNos: [],
      };
    }

    if (shouldResolveWithdraw) {
      let withdraw: any = null;
      let payout: any = null;

      if (
        (entityType === AuditEntityTypes.WITHDRAW_TRANSACTION ||
          explicitWorkflowType === AuditWorkflowTypes.WITHDRAW ||
          entityType === AuditEntityTypes.RECONCILIATION_BREAK) &&
        input.entityId &&
        db?.withdrawTransaction?.findUnique
      ) {
        withdraw = await db.withdrawTransaction.findUnique({
          where: { id: input.entityId },
          select: {
            id: true,
            withdrawNo: true,
            ownerId: true,
            payoutId: true,
            payoutNo: true,
            customer: {
              select: {
                customerNo: true,
              },
            },
            payout: {
              select: {
                id: true,
                payoutNo: true,
                ownerId: true,
              },
            },
          },
        });
      }

      if (
        !withdraw &&
        entityType === AuditEntityTypes.RECONCILIATION_BREAK &&
        input.entityId &&
        db?.reconciliationBreak?.findUnique
      ) {
        const breakRow = await db.reconciliationBreak.findUnique({
          where: { id: input.entityId },
          select: {
            withdrawId: true,
            payoutId: true,
            withdrawNo: true,
            payoutNo: true,
          },
        });
        if (breakRow?.withdrawId && db?.withdrawTransaction?.findUnique) {
          withdraw = await db.withdrawTransaction.findUnique({
            where: { id: breakRow.withdrawId },
            select: {
              id: true,
              withdrawNo: true,
              ownerId: true,
              payoutId: true,
              payoutNo: true,
              customer: {
                select: {
                  customerNo: true,
                },
              },
            },
          });
        }
        if (breakRow?.payoutId && db?.payout?.findUnique) {
          payout = await db.payout.findUnique({
            where: { id: breakRow.payoutId },
            select: {
              id: true,
              payoutNo: true,
              ownerId: true,
            },
          });
        }
      }

      if (
        !payout &&
        entityType === AuditEntityTypes.PAYOUT &&
        input.entityId &&
        db?.payout?.findUnique
      ) {
        payout = await db.payout.findUnique({
          where: { id: input.entityId },
          select: {
            id: true,
            payoutNo: true,
            ownerId: true,
            withdraw: {
              select: {
                id: true,
                withdrawNo: true,
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
        if (payout?.withdraw) {
          withdraw = payout.withdraw;
        }
      }

      const withdrawId =
        this.normalizeOptionalString(withdraw?.id) ||
        this.normalizeOptionalString(payout?.withdraw?.id) ||
        this.normalizeOptionalString(payout?.id) ||
        null;
      const resolvedEntityOwnerNo =
        entityOwnerNo ||
        withdraw?.customer?.customerNo ||
        payout?.withdraw?.customer?.customerNo ||
        null;
      const relatedSubjectNos = this.mergeSubjectNos(
        this.buildRelatedSubjectNo(
          'WITHDRAW',
          withdraw?.id || payout?.withdraw?.id,
          withdraw?.withdrawNo || payout?.withdraw?.withdrawNo,
        ),
        this.buildRelatedSubjectNo(
          'PAYOUT',
          payout?.id || withdraw?.payout?.id,
          payout?.payoutNo || withdraw?.payout?.payoutNo,
        ),
      );

      return {
        traceId:
          this.normalizeOptionalString(input.traceId) ||
          (withdrawId ? `${AuditWorkflowTypes.WITHDRAW}:${withdrawId}` : null),
        workflowType: AuditWorkflowTypes.WITHDRAW,
        entityOwnerNo: resolvedEntityOwnerNo,
        relatedSubjectNos,
      };
    }

    if (shouldResolveSwap) {
      let swap: any = null;
      let quote: any = null;

      if (
        (entityType === AuditEntityTypes.SWAP_TRANSACTION ||
          explicitWorkflowType === AuditWorkflowTypes.SWAP) &&
        input.entityId &&
        db?.swapTransaction?.findUnique
      ) {
        swap = await db.swapTransaction.findUnique({
          where: { id: input.entityId },
          select: {
            id: true,
            swapNo: true,
            ownerId: true,
            ownerNo: true,
            quoteId: true,
            quoteNo: true,
            customer: {
              select: {
                customerNo: true,
              },
            },
            quote: {
              select: {
                id: true,
                quoteNo: true,
                ownerNo: true,
              },
            },
          },
        });
        if (!swap && input.entityId) {
          swap = await db.swapTransaction.findUnique({
            where: { id: input.entityId },
            select: {
              id: true,
              swapNo: true,
              ownerId: true,
              ownerNo: true,
              quoteId: true,
              quoteNo: true,
              customer: {
                select: {
                  customerNo: true,
                },
              },
              quote: {
                select: {
                  id: true,
                  quoteNo: true,
                  ownerNo: true,
                },
              },
            },
          });
        }
        quote = swap?.quote || null;
      }

      if (
        !quote &&
        entityType === AuditEntityTypes.SWAP_QUOTE &&
        input.entityId &&
        db?.swapQuote?.findUnique
      ) {
        quote = await db.swapQuote.findUnique({
          where: { id: input.entityId },
          select: {
            id: true,
            quoteNo: true,
            ownerId: true,
            ownerNo: true,
            swapTransaction: {
              select: {
                id: true,
                swapNo: true,
                ownerId: true,
                ownerNo: true,
              },
            },
          },
        });
        if (quote?.swapTransaction) {
          swap = quote.swapTransaction;
        }
      }

      const swapId =
        this.normalizeOptionalString(swap?.id) ||
        this.normalizeOptionalString(quote?.id) ||
        this.normalizeOptionalString(swap?.quoteId) ||
        null;
      const resolvedEntityOwnerNo =
        entityOwnerNo ||
        swap?.ownerNo ||
        swap?.customer?.customerNo ||
        quote?.ownerNo ||
        null;
      const relatedSubjectNos = this.mergeSubjectNos(
        this.buildRelatedSubjectNo('SWAP', swap?.id, swap?.swapNo),
        this.buildRelatedSubjectNo('SWAP_QUOTE', quote?.id, quote?.quoteNo),
      );

      return {
        traceId:
          this.normalizeOptionalString(input.traceId) ||
          (swapId ? `${AuditWorkflowTypes.SWAP}:${swapId}` : null),
        workflowType: AuditWorkflowTypes.SWAP,
        entityOwnerNo: resolvedEntityOwnerNo,
        relatedSubjectNos,
      };
    }

    let deposit: any = null;
    let payin: any = null;

    if (
      (entityType === AuditEntityTypes.DEPOSIT_TRANSACTION ||
        explicitWorkflowType === AuditWorkflowTypes.DEPOSIT) &&
      input.entityId &&
      db?.depositTransaction?.findUnique
    ) {
      deposit = await db.depositTransaction.findUnique({
        where: { id: input.entityId },
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
      approvalCaseNo: raw.approvalCaseNo || raw.approvalCase?.approvalNo || null,
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
            decisionByUserNo: raw.approvalCase.decisionByUserNo,
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

  private buildIdempotencyKey(
    input: CreateAuditLogEventDto,
  ): string | null {
    if (input.idempotencyKey) return input.idempotencyKey;
    if (!input.action) return null;
    const normalizedRequestId = this.normalizeOptionalString(input.requestId);

    const parts = [
      input.entityType,
      input.entityId || 'NA',
      input.action,
      normalizedRequestId || 'NO_REQUEST_ID',
    ];

    return sha256Hex(parts.join('|'));
  }

  private mapEvent(raw: any): AuditLogView {
    const metadata = this.parseJson(raw.metadata);
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
    const businessWorkflow = this.deriveBusinessWorkflow(raw);
    const userAction = this.deriveUserAction(raw.action, businessWorkflow);
    const primaryRefNo = this.derivePrimaryRefNo(raw, subjectNos);

    return {
      id: raw.id,
      auditNo: raw.auditNo,
      businessWorkflow,
      businessWorkflowLabel: this.toDisplayLabel(businessWorkflow),
      primaryRefNo,
      userAction,
      userActionLabel: this.toDisplayLabel(userAction),
      action: raw.action,
      entityType: raw.entityType,
      entityId: raw.entityId ?? null,
      entityNo: raw.entityNo ?? null,
      workflowType: raw.workflowType ?? null,
      traceId: raw.traceId ?? null,
      entityOwnerType: raw.entityOwnerType ?? null,
      entityOwnerId: raw.entityOwnerId ?? null,
      entityOwnerNo: raw.entityOwnerNo ?? null,
      actorType: raw.actorType,
      actorId: raw.actorId,
      actorNo: raw.actorNo ?? null,
      actorRole: raw.actorRole ?? null,
      requestId: raw.requestId ?? null,
      sourceIp: raw.sourceIp ?? null,
      sourcePlatform: raw.sourcePlatform ?? null,
      result: raw.result ?? null,
      reason: raw.reason ?? null,
      metadata,
      payloadDigest: raw.payloadDigest ?? null,
      retainedUntil: raw.retainedUntil ?? null,
      subjectNos,
      occurredAt: raw.occurredAt,
      createdAt: raw.createdAt ?? null,
      updatedAt: raw.updatedAt ?? null,
      archivedAt: raw.archivedAt ?? null,
    };
  }

  private deriveBusinessWorkflow(raw: {
    workflowType?: string | null;
    action?: string | null;
  }): string | null {
    const workflowType = this.normalizeOptionalString(raw.workflowType);
    if (workflowType && workflowType !== AuditWorkflowTypes.APPROVAL) {
      return workflowType;
    }

    const action = this.normalizeOptionalString(raw.action)?.toUpperCase() || null;
    switch (action) {
      case AuditActions.ADMIN_LOGIN_SUCCESS:
      case AuditActions.ADMIN_LOGIN_FAILED:
      case AuditActions.ACCOUNT_LOCKED:
      case AuditActions.ACCOUNT_UNLOCKED:
        return AuditBusinessWorkflowTypes.ADMIN_LOGIN_ACCESS;
      default:
        return workflowType === AuditWorkflowTypes.APPROVAL ? null : workflowType;
    }
  }

  private deriveUserAction(
    action?: string | null,
    businessWorkflow?: string | null,
  ): string | null {
    const normalizedAction = this.normalizeOptionalString(action)?.toUpperCase() || null;
    if (!normalizedAction) {
      return null;
    }

    if (
      normalizedAction === AuditActions.APPROVAL_EXECUTION_FAILED &&
      businessWorkflow !== AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT
    ) {
      return normalizedAction;
    }

    return mapRawAuditActionToUserAction(normalizedAction) || normalizedAction;
  }

  private derivePrimaryRefNo(
    raw: {
      entityNo?: string | null;
    },
    subjectNos: Array<{ subjectRole?: string | null; subjectNo?: string | null }>,
  ): string | null {
    const preferredSubject =
      subjectNos.find(
        (subject) =>
          subject.subjectRole === AuditSubjectRole.RELATED &&
          this.normalizeOptionalString(subject.subjectNo),
      ) ||
      subjectNos.find(
        (subject) =>
          subject.subjectRole === AuditSubjectRole.OWNER &&
          this.normalizeOptionalString(subject.subjectNo),
      ) ||
      subjectNos.find(
        (subject) =>
          subject.subjectRole === AuditSubjectRole.ENTITY &&
          this.normalizeOptionalString(subject.subjectNo) &&
          !String(subject.subjectNo).trim().toUpperCase().startsWith('APR'),
      ) ||
      subjectNos.find(
        (subject) =>
          subject.subjectRole !== AuditSubjectRole.ACTOR &&
          this.normalizeOptionalString(subject.subjectNo) &&
          !String(subject.subjectNo).trim().toUpperCase().startsWith('APR'),
      ) ||
      null;

    if (preferredSubject) {
      return this.normalizeOptionalString(preferredSubject.subjectNo);
    }

    const entityNo = this.normalizeOptionalString(raw.entityNo);
    if (entityNo) {
      return entityNo;
    }

    const fallbackSubject =
      subjectNos.find(
        (subject) =>
          subject.subjectRole !== AuditSubjectRole.ACTOR &&
          this.normalizeOptionalString(subject.subjectNo),
      ) || null;

    return fallbackSubject ? this.normalizeOptionalString(fallbackSubject.subjectNo) : null;
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
      records.flatMap((item) =>
        Array.isArray(item.subjectNos)
          ? item.subjectNos.map((subject: any) =>
              this.normalizeOptionalString(subject?.subjectNo),
            )
          : [],
      ) as Array<string | null>,
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
    if (query.entityType) andClauses.push({ entityType: query.entityType });
    if (query.entityId) andClauses.push({ entityId: query.entityId });
    if (query.actorId) andClauses.push({ actorId: query.actorId });
    if (query.actorNo) andClauses.push({ actorNo: query.actorNo });
    if (query.entityOwnerNo) andClauses.push({ entityOwnerNo: query.entityOwnerNo });
    if (query.traceId) andClauses.push({ traceId: query.traceId });
    if (query.workflowType) andClauses.push({ workflowType: query.workflowType });
    if (query.result) andClauses.push({ result: query.result });


    if (query.subjectNo || query.subjectType) {
      andClauses.push({
        subjectNos: {
          some: {
            ...(query.subjectNo ? { subjectNo: query.subjectNo } : {}),
            ...(query.subjectType ? { subjectType: query.subjectType } : {}),
          },
        },
      });
    }

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
          { action: { contains: query.keyword } },
          { entityType: { contains: query.keyword } },
          { entityId: { contains: query.keyword } },
          { entityNo: { contains: query.keyword } },
          { actorNo: { contains: query.keyword } },
          { entityOwnerNo: { contains: query.keyword } },
          { traceId: { contains: query.keyword } },
          { reason: { contains: query.keyword } },
          {
            subjectNos: {
              some: {
                subjectNo: { contains: query.keyword },
              },
            },
          },
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
      throw this.auditStorageUnavailable('Audit log event storage');
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
    if (!this.canOperateAuditLogEvent(db)) {
      throw this.auditStorageUnavailable('Audit log event storage');
    }
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

    const maskedSourceIp = maskIpAddress(input.sourceIp);
    const normalizedRequestId = this.normalizeOptionalString(input.requestId);

    const idempotencyKey = this.buildIdempotencyKey(input);
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
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId || null,
      entityNo: entityNo || null,
      traceId: workflowContext.traceId,
      workflowType: workflowContext.workflowType,
      entityOwnerType: input.entityOwnerType || null,
      entityOwnerId: input.entityOwnerId || null,
      entityOwnerNo: entityOwnerNo || null,
      actorType: actor.actorType,
      actorId: actor.actorId,
      actorNo: actorNo || null,
      actorRole: actor.actorRole || null,
      requestId: normalizedRequestId,
      sourceIp: maskedSourceIp,
      sourcePlatform: input.sourcePlatform || null,
      result: input.result || AuditResult.SUCCESS,
      reason: input.reason || null,
      metadata: input.metadata ?? null,
      occurredAt: occurredAt.toISOString(),
      retainedUntil: retainedUntil.toISOString(),
      subjectNos,
    });

    const created = await this.createEventWithUniqueNo(
      {
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        entityNo: entityNo ?? null,
        traceId: workflowContext.traceId ?? null,
        workflowType: workflowContext.workflowType ?? null,
        entityOwnerType: input.entityOwnerType ?? null,
        entityOwnerId: input.entityOwnerId ?? null,
        entityOwnerNo: entityOwnerNo ?? null,
        actorType: actor.actorType,
        actorId: actor.actorId,
        actorNo: actorNo ?? null,
        actorRole: actor.actorRole ?? null,
        requestId: normalizedRequestId,
        sourceIp: maskedSourceIp,
        sourcePlatform: input.sourcePlatform ?? null,
        result: input.result ?? AuditResult.SUCCESS,
        reason: input.reason ?? null,
        metadata: this.serializeJson(input.metadata ?? null),
        idempotencyKey,
        payloadDigest,
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

    const db = this.getDb() as any;
    if (!this.canOperateAuditLogEvent(db)) {
      throw this.auditStorageUnavailable('Audit log event storage');
    }
    const where = await this.buildWhere(query, db);
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
      throw this.auditStorageUnavailable('Audit log event storage');
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

  private buildDepositEvidenceChain(params: {
    deposits: any[];
    riskDecisionRecords: any[];
    kytCases: any[];
    travelRuleCases: any[];
    alerts: any[];
    cases: any[];
    journals: any[];
    internalTransactions: any[];
    internalFunds: any[];
  }): DepositEvidenceChainItem[] {
    const {
      deposits,
      riskDecisionRecords,
      kytCases,
      travelRuleCases,
      alerts,
      cases,
      journals,
      internalTransactions,
      internalFunds,
    } = params;

    const fundsByInternalTxId = new Map<string, any[]>();
    for (const fund of internalFunds) {
      const current = fundsByInternalTxId.get(fund.internalTransactionId) || [];
      current.push(fund);
      fundsByInternalTxId.set(fund.internalTransactionId, current);
    }

    return deposits.map((deposit) => {
      const depositId = String(deposit.id);
      const depositDecisionRecords = riskDecisionRecords.filter(
        (item) => String(item.subjectId) === depositId,
      );
      const depositKytCases = kytCases.filter(
        (item) => String(item.sourceId) === depositId,
      );
      const depositTravelRuleCases = travelRuleCases.filter(
        (item) => String(item.sourceId) === depositId,
      );
      const depositAlerts = alerts.filter(
        (item) => String(item.sourceId) === depositId,
      );
      const depositCases = cases.filter(
        (item) => String(item.sourceId) === depositId,
      );
      const depositJournals = journals.filter(
        (item) => String(item.sourceId) === depositId,
      );
      const depositInternalTxs = internalTransactions.filter(
        (item) => String(item.sourceId) === depositId,
      );
      const depositInternalFunds = depositInternalTxs.flatMap(
        (item) => fundsByInternalTxId.get(String(item.id)) || [],
      );

      return {
        depositId,
        depositNo: deposit.depositNo || null,
        payinId: deposit.payin?.id || null,
        payinNo: deposit.payin?.payinNo || null,
        decisionRecordIds: this.toSortedUniqueStrings([
          ...depositDecisionRecords.map((item) => item.id),
          ...depositAlerts.flatMap((item) => item.decisionRecordIds || []),
          ...depositCases.flatMap((item) => item.decisionRecordIds || []),
        ]),
        kytCaseIds: this.toSortedUniqueStrings(
          depositKytCases.map((item) => item.id),
        ),
        travelRuleCaseIds: this.toSortedUniqueStrings(
          depositTravelRuleCases.map((item) => item.id),
        ),
        alertIds: this.toSortedUniqueStrings(depositAlerts.map((item) => item.id)),
        caseIds: this.toSortedUniqueStrings(depositCases.map((item) => item.id)),
        journalIds: this.toSortedUniqueStrings(
          depositJournals.map((item) => item.id),
        ),
        internalTransactionIds: this.toSortedUniqueStrings(
          depositInternalTxs.map((item) => item.id),
        ),
        internalFundIds: this.toSortedUniqueStrings(
          depositInternalFunds.map((item) => item.id),
        ),
      };
    });
  }

  private buildSwapEvidenceChain(params: {
    swapTransactions: any[];
    swapQuotes: any[];
    riskDecisionRecords: any[];
    alerts: any[];
    cases: any[];
    journals: any[];
    outstandings: any[];
  }): SwapEvidenceChainItem[] {
    const {
      swapTransactions,
      swapQuotes,
      riskDecisionRecords,
      alerts,
      cases,
      journals,
      outstandings,
    } = params;

    return swapTransactions.map((swap) => {
      const swapId = String(swap.id);
      const quoteId = this.normalizeOptionalString(swap.quoteId);
      const linkedQuote = swapQuotes.find(
        (item) => String(item.id) === quoteId,
      );
      const swapDecisionRecords = riskDecisionRecords.filter(
        (item) => String(item.subjectId) === swapId,
      );
      const swapAlerts = alerts.filter(
        (item) => String(item.sourceId) === swapId,
      );
      const swapCases = cases.filter(
        (item) => String(item.sourceId) === swapId,
      );
      const swapJournals = journals.filter(
        (item) => String(item.sourceId) === swapId,
      );
      const swapOutstandings = outstandings.filter(
        (item) => String(item.sourceId) === swapId,
      );

      return {
        swapId,
        swapNo: swap.swapNo || null,
        quoteId: quoteId || linkedQuote?.id || null,
        quoteNo:
          this.normalizeOptionalString(swap.quoteNo) ||
          this.normalizeOptionalString(linkedQuote?.quoteNo) ||
          null,
        decisionRecordIds: this.toSortedUniqueStrings([
          ...swapDecisionRecords.map((item) => item.id),
          ...swapAlerts.flatMap((item) => item.decisionRecordIds || []),
          ...swapCases.flatMap((item) => item.decisionRecordIds || []),
        ]),
        alertIds: this.toSortedUniqueStrings(swapAlerts.map((item) => item.id)),
        caseIds: this.toSortedUniqueStrings(swapCases.map((item) => item.id)),
        journalIds: this.toSortedUniqueStrings(
          swapJournals.map((item) => item.id),
        ),
        outstandingIds: this.toSortedUniqueStrings(
          swapOutstandings.map((item) => item.id),
        ),
      };
    });
  }

  private buildWithdrawEvidenceChain(params: {
    withdrawTransactions: any[];
    payouts: any[];
    preKytCases: any[];
    mainKytCases: any[];
    travelRuleCases: any[];
    riskDecisionRecords: any[];
    alerts: any[];
    cases: any[];
    journals: any[];
    clearings: any[];
    reconciliationBreaks: any[];
  }): WithdrawEvidenceChainItem[] {
    const {
      withdrawTransactions,
      payouts,
      preKytCases,
      mainKytCases,
      travelRuleCases,
      riskDecisionRecords,
      alerts,
      cases,
      journals,
      clearings,
      reconciliationBreaks,
    } = params;

    return withdrawTransactions.map((withdraw) => {
      const withdrawId = String(withdraw.id);
      const payoutId = this.normalizeOptionalString(withdraw.payoutId);
      const linkedPayout = payouts.find((item) => String(item.id) === payoutId);
      const withdrawDecisionRecords = riskDecisionRecords.filter(
        (item) => String(item.subjectId) === withdrawId,
      );
      const withdrawAlerts = alerts.filter(
        (item) => String(item.sourceId) === withdrawId,
      );
      const withdrawCases = cases.filter(
        (item) => String(item.sourceId) === withdrawId,
      );
      const withdrawJournals = journals.filter(
        (item) => String(item.sourceId) === withdrawId,
      );
      const withdrawClearings = clearings.filter(
        (item) => String(item.sourceId) === withdrawId,
      );
      const withdrawBreaks = reconciliationBreaks.filter(
        (item) =>
          String(item.withdrawId) === withdrawId ||
          (payoutId && String(item.payoutId) === payoutId),
      );

      return {
        withdrawId,
        withdrawNo: withdraw.withdrawNo || null,
        payoutId: payoutId || linkedPayout?.id || null,
        payoutNo:
          this.normalizeOptionalString(withdraw.payoutNo) ||
          this.normalizeOptionalString(linkedPayout?.payoutNo) ||
          null,
        decisionRecordIds: this.toSortedUniqueStrings([
          ...withdrawDecisionRecords.map((item) => item.id),
          ...withdrawAlerts.flatMap((item) => item.decisionRecordIds || []),
          ...withdrawCases.flatMap((item) => item.decisionRecordIds || []),
        ]),
        preKytCaseIds: this.toSortedUniqueStrings(
          preKytCases
            .filter((item) => String(item.sourceId) === withdrawId)
            .map((item) => item.id),
        ),
        mainKytCaseIds: this.toSortedUniqueStrings(
          mainKytCases
            .filter((item) => String(item.sourceId) === withdrawId)
            .map((item) => item.id),
        ),
        travelRuleCaseIds: this.toSortedUniqueStrings(
          travelRuleCases
            .filter((item) => String(item.sourceId) === withdrawId)
            .map((item) => item.id),
        ),
        alertIds: this.toSortedUniqueStrings(
          withdrawAlerts.map((item) => item.id),
        ),
        caseIds: this.toSortedUniqueStrings(
          withdrawCases.map((item) => item.id),
        ),
        journalIds: this.toSortedUniqueStrings(
          withdrawJournals.map((item) => item.id),
        ),
        clearingIds: this.toSortedUniqueStrings(
          withdrawClearings.map((item) => item.id),
        ),
        reconciliationBreakIds: this.toSortedUniqueStrings(
          withdrawBreaks.map((item) => item.id),
        ),
      };
    });
  }

  private async buildDepositSnapshots(records: any[], db: any): Promise<DepositEvidenceSnapshots> {
    const depositRecords = records.filter(
      (item) => item.workflowType === AuditWorkflowTypes.DEPOSIT,
    );
    const workflowIds = this.toSortedUniqueStrings([
      ...depositRecords.flatMap((item) =>
        Array.isArray(item.subjectNos)
          ? item.subjectNos
              .filter((s: any) => s.subjectType === 'DEPOSIT' && s.subjectId)
              .map((s: any) => this.normalizeOptionalString(s.subjectId))
          : [],
      ) as Array<string | null>,
      ...depositRecords
        .filter((item) => item.entityType === AuditEntityTypes.DEPOSIT_TRANSACTION)
        .map((item) => this.normalizeOptionalString(item.entityId)) as Array<string | null>,
    ]);

    if (!workflowIds.length || !db?.depositTransaction?.findMany) {
      return {
        deposits: [],
        kytCases: [],
        travelRuleCases: [],
        riskDecisionRecords: [],
        alerts: [],
        cases: [],
        journals: [],
        internalTransactions: [],
        internalFunds: [],
        depositEvidenceChain: [],
      };
    }

    const [deposits, kytCases, travelRuleCases, riskDecisionRecords, alerts, cases, journals, internalTransactions] = await Promise.all([
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
      db.workflowDecisionRecord?.findMany
        ? db.workflowDecisionRecord.findMany({
            where: {
              subjectId: { in: workflowIds },
            },
            orderBy: [{ subjectId: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              customerId: true,
              contextType: true,
              subjectId: true,
              policyVersion: true,
              status: true,
              inputPayload: true,
              inputHash: true,
              outputDecision: true,
              recommendedActions: true,
              outputs: true,
              reasonCodes: true,
              errorMessage: true,
              createdAt: true,
              completedAt: true,
              updatedAt: true,
            },
          })
        : Promise.resolve([]),
      db.complianceAlert?.findMany
        ? db.complianceAlert.findMany({
            where: {
              sourceType: AuditWorkflowTypes.DEPOSIT,
              sourceId: { in: workflowIds },
            },
            orderBy: [{ sourceId: 'asc' }, { firstOccurredAt: 'asc' }],
            select: {
              id: true,
              alertNo: true,
              sourceType: true,
              sourceId: true,
              sourceNo: true,
              stage: true,
              ruleCode: true,
              severity: true,
              status: true,
              decisionRecommendation: true,
              decision: true,
              decisionRecordIds: true,
              linkedCaseIds: true,
              currentDispositionCode: true,
              finalDispositionCode: true,
              hitCount: true,
              metadata: true,
              firstOccurredAt: true,
              lastOccurredAt: true,
              createdAt: true,
              updatedAt: true,
            },
          })
        : Promise.resolve([]),
      db.complianceIncident?.findMany
        ? db.complianceIncident.findMany({
            where: {
              sourceType: AuditWorkflowTypes.DEPOSIT,
              entityId: { in: workflowIds },
            },
            orderBy: [{ entityId: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              incidentNo: true,
              caseType: true,
              status: true,
              severity: true,
              primaryAlertId: true,
              primaryAlertNo: true,
              entityId: true,
              entityNo: true,
              sourceType: true,
              stage: true,
              ruleCode: true,
              decision: true,
              proposedWorkflowDecision: true,
              mlroReviewOutcome: true,
              currentDispositionCode: true,
              finalDispositionCode: true,
              decisionRecordIds: true,
              linkedCaseIds: true,
              metadata: true,
              createdAt: true,
              updatedAt: true,
            },
          })
        : Promise.resolve([]),
      db.journal?.findMany
        ? db.journal.findMany({
            where: {
              sourceType: 'DEPOSIT',
              sourceId: { in: workflowIds },
            },
            orderBy: [{ sourceId: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              journalNo: true,
              sourceType: true,
              sourceId: true,
              sourceNo: true,
              eventCode: true,
              postingStatus: true,
              postedAt: true,
              reversalOfJournalId: true,
              baseAssetId: true,
              totalAmount: true,
              description: true,
              createdAt: true,
              updatedAt: true,
            },
          })
        : Promise.resolve([]),
      db.internalTransaction?.findMany
        ? db.internalTransaction.findMany({
            where: {
              sourceType: 'DEPOSIT',
              sourceId: { in: workflowIds },
              type: 'DEP_TO_MASTER',
            },
            orderBy: [{ sourceId: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              internalTxNo: true,
              sourceType: true,
              sourceId: true,
              sourceNo: true,
              type: true,
              status: true,
              approvalStatus: true,
              assetId: true,
              amount: true,
              feeAmount: true,
              netAmount: true,
              fromWalletId: true,
              toWalletId: true,
              referenceNo: true,
              createdAt: true,
              updatedAt: true,
              completedAt: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const internalTransactionIds = this.toSortedUniqueStrings(
      internalTransactions.map((item: any) => item.id),
    );
    const internalFunds = internalTransactionIds.length && db.internalFund?.findMany
      ? await db.internalFund.findMany({
          where: {
            internalTransactionId: { in: internalTransactionIds },
          },
          orderBy: [{ internalTransactionId: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            internalFundNo: true,
            internalTransactionId: true,
            status: true,
            assetId: true,
            amount: true,
            feeAmount: true,
            netAmount: true,
            fromWalletId: true,
            toWalletId: true,
            referenceNo: true,
            txHash: true,
            createdAt: true,
            updatedAt: true,
            confirmedAt: true,
            completedAt: true,
          },
        })
      : [];

    const mappedRiskDecisionRecords = riskDecisionRecords.map((row: any) => ({
      ...row,
      inputPayload: this.parseJson(row.inputPayload),
      recommendedActions: this.parseJson(row.recommendedActions),
      outputs: this.parseJson(row.outputs),
      reasonCodes: this.parseJson(row.reasonCodes),
    }));
    const mappedAlerts = alerts.map((row: any) => ({
      ...row,
      decisionRecordIds: this.parseStringArray(row.decisionRecordIds),
      linkedCaseIds: this.parseStringArray(row.linkedCaseIds),
      metadata: this.parseJson(row.metadata),
    }));
    const mappedCases = cases.map((row: any) => ({
      ...row,
      sourceId: row.entityId,
      sourceNo: row.entityNo,
      decisionRecordIds: this.parseStringArray(row.decisionRecordIds),
      linkedCaseIds: this.parseStringArray(row.linkedCaseIds),
      metadata: this.parseJson(row.metadata),
    }));
    const depositEvidenceChain = this.buildDepositEvidenceChain({
      deposits,
      riskDecisionRecords: mappedRiskDecisionRecords,
      kytCases,
      travelRuleCases,
      alerts: mappedAlerts,
      cases: mappedCases,
      journals,
      internalTransactions,
      internalFunds,
    });

    return {
      deposits,
      kytCases,
      travelRuleCases,
      riskDecisionRecords: mappedRiskDecisionRecords,
      alerts: mappedAlerts,
      cases: mappedCases,
      journals,
      internalTransactions,
      internalFunds,
      depositEvidenceChain,
    };
  }

  private async buildWithdrawSnapshots(
    records: any[],
    db: any,
  ): Promise<WithdrawEvidenceSnapshots> {
    const withdrawRecords = records.filter(
      (item) => item.workflowType === AuditWorkflowTypes.WITHDRAW,
    );
    const workflowIds = this.toSortedUniqueStrings([
      ...withdrawRecords.flatMap((item) =>
        Array.isArray(item.subjectNos)
          ? item.subjectNos
              .filter((s: any) => s.subjectType === 'WITHDRAW' && s.subjectId)
              .map((s: any) => this.normalizeOptionalString(s.subjectId))
          : [],
      ) as Array<string | null>,
      ...withdrawRecords
        .filter((item) => item.entityType === AuditEntityTypes.WITHDRAW_TRANSACTION)
        .map((item) => this.normalizeOptionalString(item.entityId)) as Array<string | null>,
    ]);

    if (!workflowIds.length || !db?.withdrawTransaction?.findMany) {
      return {
        withdrawTransactions: [],
        payouts: [],
        preKytCases: [],
        mainKytCases: [],
        travelRuleCases: [],
        riskDecisionRecords: [],
        alerts: [],
        cases: [],
        journals: [],
        clearings: [],
        reconciliationBreaks: [],
        withdrawEvidenceChain: [],
      };
    }

    const withdrawTransactions = await db.withdrawTransaction.findMany({
      where: { id: { in: workflowIds } },
      orderBy: { withdrawNo: 'asc' },
      include: {
        asset: {
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
        payout: {
          include: {
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
        },
      },
    });

    const payoutIds = this.toSortedUniqueStrings(
      withdrawTransactions.map((item: any) => item.payoutId),
    );
    const withdrawIds = this.toSortedUniqueStrings(
      withdrawTransactions.map((item: any) => item.id),
    );

    const [
      payouts,
      kytCases,
      travelRuleCases,
      riskDecisionRecords,
      alerts,
      cases,
      journals,
      clearings,
      reconciliationBreaks,
    ] = await Promise.all([
      payoutIds.length && db?.payout?.findMany
        ? db.payout.findMany({
            where: { id: { in: payoutIds } },
            orderBy: { payoutNo: 'asc' },
            include: {
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
          })
        : Promise.resolve([]),
      db.kytCase?.findMany
        ? db.kytCase.findMany({
            where: {
              sourceType: AuditWorkflowTypes.WITHDRAW,
              sourceId: { in: withdrawIds },
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
              sourceType: AuditWorkflowTypes.WITHDRAW,
              sourceId: { in: withdrawIds },
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
      db.workflowDecisionRecord?.findMany
        ? db.workflowDecisionRecord.findMany({
            where: {
              subjectId: { in: withdrawIds },
              contextType: { in: ['TX_WITHDRAW_PRECHECK', 'TX_WITHDRAW_FINAL'] },
            },
            orderBy: [{ subjectId: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              customerId: true,
              contextType: true,
              subjectId: true,
              policyVersion: true,
              status: true,
              inputPayload: true,
              inputHash: true,
              outputDecision: true,
              recommendedActions: true,
              outputs: true,
              reasonCodes: true,
              errorMessage: true,
              createdAt: true,
              completedAt: true,
              updatedAt: true,
            },
          })
        : Promise.resolve([]),
      db.complianceAlert?.findMany
        ? db.complianceAlert.findMany({
            where: {
              sourceType: AuditWorkflowTypes.WITHDRAW,
              sourceId: { in: withdrawIds },
            },
            orderBy: [{ sourceId: 'asc' }, { firstOccurredAt: 'asc' }],
            select: {
              id: true,
              alertNo: true,
              sourceType: true,
              sourceId: true,
              sourceNo: true,
              stage: true,
              ruleCode: true,
              severity: true,
              status: true,
              decisionRecommendation: true,
              decision: true,
              decisionRecordIds: true,
              linkedCaseIds: true,
              currentDispositionCode: true,
              finalDispositionCode: true,
              hitCount: true,
              metadata: true,
              firstOccurredAt: true,
              lastOccurredAt: true,
              createdAt: true,
              updatedAt: true,
            },
          })
        : Promise.resolve([]),
      db.complianceIncident?.findMany
        ? db.complianceIncident.findMany({
            where: {
              sourceType: AuditWorkflowTypes.WITHDRAW,
              entityId: { in: withdrawIds },
            },
            orderBy: [{ entityId: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              incidentNo: true,
              caseType: true,
              status: true,
              severity: true,
              primaryAlertId: true,
              primaryAlertNo: true,
              entityId: true,
              entityNo: true,
              sourceType: true,
              stage: true,
              ruleCode: true,
              decision: true,
              proposedWorkflowDecision: true,
              mlroReviewOutcome: true,
              currentDispositionCode: true,
              finalDispositionCode: true,
              decisionRecordIds: true,
              linkedCaseIds: true,
              metadata: true,
              createdAt: true,
              updatedAt: true,
            },
          })
        : Promise.resolve([]),
      db.journal?.findMany
        ? db.journal.findMany({
            where: {
              sourceType: 'WITHDRAW',
              sourceId: { in: withdrawIds },
            },
            orderBy: [{ sourceId: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              journalNo: true,
              sourceType: true,
              sourceId: true,
              sourceNo: true,
              eventCode: true,
              postingStatus: true,
              postedAt: true,
              reversalOfJournalId: true,
              baseAssetId: true,
              totalAmount: true,
              description: true,
              createdAt: true,
              updatedAt: true,
            },
          })
        : Promise.resolve([]),
      db.clearing?.findMany
        ? db.clearing.findMany({
            where: {
              sourceType: 'WITHDRAWAL',
              sourceId: { in: withdrawIds },
            },
            orderBy: [{ sourceId: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              clearingNo: true,
              sourceType: true,
              sourceId: true,
              outAssetId: true,
              outAmount: true,
              inAssetId: true,
              inAmount: true,
              feeAssetId: true,
              feeAmount: true,
              feeMethod: true,
              outPayoutId: true,
              clearingStatus: true,
              memo: true,
              createdAt: true,
              updatedAt: true,
            },
          })
        : Promise.resolve([]),
      db.reconciliationBreak?.findMany
        ? db.reconciliationBreak.findMany({
            where: {
              OR: [
                { withdrawId: { in: withdrawIds } },
                payoutIds.length ? { payoutId: { in: payoutIds } } : undefined,
              ].filter(Boolean),
            },
            orderBy: [{ businessDate: 'desc' }, { detectedAt: 'desc' }],
          })
        : Promise.resolve([]),
    ]);

    const preKytCases = kytCases.filter(
      (item: any) => String(item.screeningStage || '').trim().toUpperCase() === 'PRE_TXN',
    );
    const mainKytCases = kytCases.filter(
      (item: any) => String(item.screeningStage || '').trim().toUpperCase() !== 'PRE_TXN',
    );
    const mappedRiskDecisionRecords = riskDecisionRecords.map((row: any) => ({
      ...row,
      inputPayload: this.parseJson(row.inputPayload),
      recommendedActions: this.parseJson(row.recommendedActions),
      outputs: this.parseJson(row.outputs),
      reasonCodes: this.parseJson(row.reasonCodes),
    }));
    const mappedAlerts = alerts.map((row: any) => ({
      ...row,
      decisionRecordIds: this.parseStringArray(row.decisionRecordIds),
      linkedCaseIds: this.parseStringArray(row.linkedCaseIds),
      metadata: this.parseJson(row.metadata),
    }));
    const mappedCases = cases.map((row: any) => ({
      ...row,
      sourceId: row.entityId,
      sourceNo: row.entityNo,
      decisionRecordIds: this.parseStringArray(row.decisionRecordIds),
      linkedCaseIds: this.parseStringArray(row.linkedCaseIds),
      metadata: this.parseJson(row.metadata),
    }));
    const mappedReconciliationBreaks = reconciliationBreaks.map((row: any) => ({
      ...row,
      expectedNetDelta: row.expectedNetDelta?.toString?.() ?? '0',
      observedNetDelta: row.observedNetDelta?.toString?.() ?? '0',
      deltaAmount: row.deltaAmount?.toString?.() ?? '0',
      detailsJson: this.parseJson(row.detailsJson),
    }));

    const withdrawEvidenceChain = this.buildWithdrawEvidenceChain({
      withdrawTransactions,
      payouts,
      preKytCases,
      mainKytCases,
      travelRuleCases,
      riskDecisionRecords: mappedRiskDecisionRecords,
      alerts: mappedAlerts,
      cases: mappedCases,
      journals,
      clearings,
      reconciliationBreaks: mappedReconciliationBreaks,
    });

    return {
      withdrawTransactions,
      payouts,
      preKytCases,
      mainKytCases,
      travelRuleCases,
      riskDecisionRecords: mappedRiskDecisionRecords,
      alerts: mappedAlerts,
      cases: mappedCases,
      journals,
      clearings,
      reconciliationBreaks: mappedReconciliationBreaks,
      withdrawEvidenceChain,
    };
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
        swapRiskDecisionRecords: [],
        swapAlerts: [],
        swapCases: [],
        swapJournals: [],
        swapOutstandings: [],
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
            investorTier: true,
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

    const swapIds = this.toSortedUniqueStrings(
      swapTransactions.map((item: any) => item.id),
    );
    if (!swapIds.length) {
      return {
        swapTransactions,
        swapQuotes,
        swapRiskDecisionRecords: [],
        swapAlerts: [],
        swapCases: [],
        swapJournals: [],
        swapOutstandings: [],
        swapEvidenceChain: [],
      };
    }

    const [
      riskDecisionRecords,
      alerts,
      cases,
      journals,
      outstandings,
    ] = await Promise.all([
      db.workflowDecisionRecord?.findMany
        ? db.workflowDecisionRecord.findMany({
            where: {
              subjectId: { in: swapIds },
              contextType: 'TX_SWAP_FINAL',
            },
            orderBy: [{ subjectId: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              customerId: true,
              contextType: true,
              subjectId: true,
              policyVersion: true,
              status: true,
              inputPayload: true,
              inputHash: true,
              outputDecision: true,
              recommendedActions: true,
              outputs: true,
              reasonCodes: true,
              errorMessage: true,
              createdAt: true,
              completedAt: true,
              updatedAt: true,
            },
          })
        : Promise.resolve([]),
      db.complianceAlert?.findMany
        ? db.complianceAlert.findMany({
            where: {
              sourceType: AuditWorkflowTypes.SWAP,
              sourceId: { in: swapIds },
            },
            orderBy: [{ sourceId: 'asc' }, { firstOccurredAt: 'asc' }],
            select: {
              id: true,
              alertNo: true,
              sourceType: true,
              sourceId: true,
              sourceNo: true,
              stage: true,
              ruleCode: true,
              severity: true,
              status: true,
              decisionRecommendation: true,
              decision: true,
              decisionRecordIds: true,
              linkedCaseIds: true,
              currentDispositionCode: true,
              finalDispositionCode: true,
              hitCount: true,
              metadata: true,
              firstOccurredAt: true,
              lastOccurredAt: true,
              createdAt: true,
              updatedAt: true,
            },
          })
        : Promise.resolve([]),
      db.complianceIncident?.findMany
        ? db.complianceIncident.findMany({
            where: {
              sourceType: AuditWorkflowTypes.SWAP,
              entityId: { in: swapIds },
            },
            orderBy: [{ entityId: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              incidentNo: true,
              caseType: true,
              status: true,
              severity: true,
              primaryAlertId: true,
              primaryAlertNo: true,
              entityId: true,
              entityNo: true,
              sourceType: true,
              stage: true,
              ruleCode: true,
              decision: true,
              proposedWorkflowDecision: true,
              mlroReviewOutcome: true,
              currentDispositionCode: true,
              finalDispositionCode: true,
              decisionRecordIds: true,
              linkedCaseIds: true,
              metadata: true,
              createdAt: true,
              updatedAt: true,
            },
          })
        : Promise.resolve([]),
      db.journal?.findMany
        ? db.journal.findMany({
            where: {
              sourceType: 'SWAP',
              sourceId: { in: swapIds },
            },
            orderBy: [{ sourceId: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              journalNo: true,
              sourceType: true,
              sourceId: true,
              sourceNo: true,
              eventCode: true,
              postingStatus: true,
              postedAt: true,
              reversalOfJournalId: true,
              baseAssetId: true,
              totalAmount: true,
              description: true,
              createdAt: true,
              updatedAt: true,
            },
          })
        : Promise.resolve([]),
      db.outstanding?.findMany
        ? db.outstanding.findMany({
            where: {
              sourceType: 'SWAP',
              sourceId: { in: swapIds },
            },
            orderBy: [{ sourceId: 'asc' }, { direction: 'asc' }],
            select: {
              id: true,
              outstandingNo: true,
              sourceType: true,
              sourceId: true,
              sourceNo: true,
              direction: true,
              assetId: true,
              assetCode: true,
              amount: true,
              status: true,
              createdAt: true,
              updatedAt: true,
              closedAt: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const mappedRiskDecisionRecords = riskDecisionRecords.map((row: any) => ({
      ...row,
      inputPayload: this.parseJson(row.inputPayload),
      recommendedActions: this.parseJson(row.recommendedActions),
      outputs: this.parseJson(row.outputs),
      reasonCodes: this.parseJson(row.reasonCodes),
    }));
    const mappedAlerts = alerts.map((row: any) => ({
      ...row,
      decisionRecordIds: this.parseStringArray(row.decisionRecordIds),
      linkedCaseIds: this.parseStringArray(row.linkedCaseIds),
      metadata: this.parseJson(row.metadata),
    }));
    const mappedCases = cases.map((row: any) => ({
      ...row,
      sourceId: row.entityId,
      sourceNo: row.entityNo,
      decisionRecordIds: this.parseStringArray(row.decisionRecordIds),
      linkedCaseIds: this.parseStringArray(row.linkedCaseIds),
      metadata: this.parseJson(row.metadata),
    }));
    const swapEvidenceChain = this.buildSwapEvidenceChain({
      swapTransactions,
      swapQuotes,
      riskDecisionRecords: mappedRiskDecisionRecords,
      alerts: mappedAlerts,
      cases: mappedCases,
      journals,
      outstandings,
    });

    return {
      swapTransactions,
      swapQuotes,
      swapRiskDecisionRecords: mappedRiskDecisionRecords,
      swapAlerts: mappedAlerts,
      swapCases: mappedCases,
      swapJournals: journals,
      swapOutstandings: outstandings,
      swapEvidenceChain,
    };
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
              executionStatus: true,
              traceId: true,
              deletedAt: true,
              decisionByUserNo: true,
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
      throw this.auditStorageUnavailable('Audit evidence package storage');
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
            decisionByUserNo: true,
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

  async findEvidencePackageForApproval(
    approvalId: string,
    entityRef?: string | null,
  ): Promise<any | null> {
    const db = this.getDb() as any;
    if (!this.canOperateAuditEvidencePackage(db)) return null;
    const orClauses: any[] = [{ approvalCaseId: approvalId }];
    if (entityRef) orClauses.push({ id: entityRef });
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
    if (entityRef) orClauses.push({ id: entityRef });
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
