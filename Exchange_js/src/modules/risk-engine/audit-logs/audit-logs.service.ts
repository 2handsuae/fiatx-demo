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
    AuditActions.ALERT_ASSIGNED,
    AuditActions.ALERT_ESCALATED,
    AuditActions.ALERT_RESOLVED,
    AuditActions.ALERT_FALSE_POSITIVE,
    'ONBOARDING_WORKFLOW_CLEAR',
    'ONBOARDING_WORKFLOW_REJECT',
    'ONBOARDING_WORKFLOW_REQUIRE_EDD',
    'PERIODIC_REVIEW_WORKFLOW_CLEAR',
    'PERIODIC_REVIEW_WORKFLOW_REJECT',
    'PERIODIC_REVIEW_WORKFLOW_REQUIRE_EDD',
  ]);

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
        workflowId: this.normalizeOptionalString(input.workflowId),
        workflowNo: this.normalizeOptionalString(input.workflowNo),
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
        (input.workflowId || input.entityId) &&
        db?.withdrawTransaction?.findUnique
      ) {
        withdraw = await db.withdrawTransaction.findUnique({
          where: { id: input.workflowId || input.entityId },
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

      const workflowId =
        this.normalizeOptionalString(input.workflowId) ||
        this.normalizeOptionalString(withdraw?.id) ||
        this.normalizeOptionalString(payout?.withdraw?.id) ||
        this.normalizeOptionalString(payout?.id) ||
        null;
      const workflowNo =
        this.normalizeOptionalString(input.workflowNo) ||
        this.normalizeOptionalString(withdraw?.withdrawNo) ||
        this.normalizeOptionalString(payout?.withdraw?.withdrawNo) ||
        workflowId;
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
          (workflowId ? `${AuditWorkflowTypes.WITHDRAW}:${workflowId}` : null),
        workflowType: AuditWorkflowTypes.WITHDRAW,
        workflowId,
        workflowNo,
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
        (input.workflowId || input.entityId) &&
        db?.swapTransaction?.findUnique
      ) {
        swap = await db.swapTransaction.findUnique({
          where: { id: input.workflowId || input.entityId },
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
        if (!swap && input.entityId && input.entityId !== input.workflowId) {
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

      const workflowId =
        this.normalizeOptionalString(input.workflowId) ||
        this.normalizeOptionalString(swap?.id) ||
        this.normalizeOptionalString(quote?.id) ||
        this.normalizeOptionalString(swap?.quoteId) ||
        null;
      const workflowNo =
        this.normalizeOptionalString(input.workflowNo) ||
        this.normalizeOptionalString(swap?.swapNo) ||
        this.normalizeOptionalString(quote?.quoteNo) ||
        this.normalizeOptionalString(swap?.quoteNo) ||
        workflowId;
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
          (workflowId ? `${AuditWorkflowTypes.SWAP}:${workflowId}` : null),
        workflowType: AuditWorkflowTypes.SWAP,
        workflowId,
        workflowNo,
        entityOwnerNo: resolvedEntityOwnerNo,
        relatedSubjectNos,
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

  private async resolveSwapWorkflowSearchExpansion(
    workflowNo: string,
    db: any,
  ): Promise<{
    workflowNos: string[];
    traceIds: string[];
  }> {
    const normalizedWorkflowNo = this.normalizeOptionalString(workflowNo);
    if (!normalizedWorkflowNo) {
      return {
        workflowNos: [],
        traceIds: [],
      };
    }

    const directSwapMatches = db?.swapTransaction?.findMany
      ? await db.swapTransaction.findMany({
          where: {
            swapNo: normalizedWorkflowNo,
          },
          select: {
            id: true,
            swapNo: true,
            quoteId: true,
            quoteNo: true,
          },
        })
      : [];

    const quoteMatches = db?.swapQuote?.findMany
      ? await db.swapQuote.findMany({
          where: {
            quoteNo: normalizedWorkflowNo,
          },
          select: {
            id: true,
            quoteNo: true,
          },
        })
      : [];

    const quoteIds = this.toSortedUniqueStrings([
      ...directSwapMatches.map((item: any) => item.quoteId),
      ...quoteMatches.map((item: any) => item.id),
    ]);

    const linkedSwapMatches =
      quoteIds.length && db?.swapTransaction?.findMany
        ? await db.swapTransaction.findMany({
            where: {
              OR: [
                { quoteId: { in: quoteIds } },
                { quoteSnapshotRef: { in: quoteIds } },
              ],
            },
            select: {
              id: true,
              swapNo: true,
              quoteId: true,
              quoteNo: true,
            },
          })
        : [];

    const allSwaps = [...directSwapMatches, ...linkedSwapMatches];
    return {
      workflowNos: this.toSortedUniqueStrings([
        ...allSwaps.map((item: any) => item.swapNo),
      ]),
      traceIds: this.toSortedUniqueStrings([
        ...allSwaps.map((item: any) =>
          item.id ? `${AuditWorkflowTypes.SWAP}:${item.id}` : null,
        ),
      ]),
    };
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
    const workflowIds = this.toSortedUniqueStrings(
      records
        .filter((item) => item.workflowType === AuditWorkflowTypes.SWAP)
        .map((item) => this.normalizeOptionalString(item.workflowId)) as Array<string | null>,
    );
    const workflowNos = this.toSortedUniqueStrings(
      records
        .filter((item) => item.workflowType === AuditWorkflowTypes.SWAP)
        .map((item) => this.normalizeOptionalString(item.workflowNo)) as Array<string | null>,
    );
    const subjectNos = this.toSortedUniqueStrings(
      records.flatMap((item) =>
        Array.isArray(item.subjectNos)
          ? item.subjectNos.map((subject: any) =>
              this.normalizeOptionalString(subject?.subjectNo),
            )
          : [],
      ) as Array<string | null>,
    );

    const candidateNos = this.toSortedUniqueStrings([
      ...workflowNos,
      ...subjectNos,
    ]);

    if (!workflowIds.length && !candidateNos.length) {
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
              ...(workflowIds.length
                ? [
                    { id: { in: workflowIds } },
                    { quoteId: { in: workflowIds } },
                    { quoteSnapshotRef: { in: workflowIds } },
                  ]
                : []),
              ...(candidateNos.length
                ? [
                    { swapNo: { in: candidateNos } },
                    { quoteNo: { in: candidateNos } },
                  ]
                : []),
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
      ...workflowIds,
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
    if (query.triggerType) andClauses.push({ triggerType: query.triggerType });
    if (query.module) andClauses.push({ module: query.module });
    if (query.entityType) andClauses.push({ entityType: query.entityType });
    if (query.entityId) andClauses.push({ entityId: query.entityId });
    if (query.actorId) andClauses.push({ actorId: query.actorId });
    if (query.actorNo) andClauses.push({ actorNo: query.actorNo });
    if (query.entityOwnerNo) andClauses.push({ entityOwnerNo: query.entityOwnerNo });
    if (query.traceId) andClauses.push({ traceId: query.traceId });
    if (query.workflowType) andClauses.push({ workflowType: query.workflowType });
    if (query.result) andClauses.push({ result: query.result });

    const normalizedWorkflowType = this.normalizeEntityType(query.workflowType);
    const normalizedWorkflowNo = this.normalizeOptionalString(query.workflowNo);
    if (normalizedWorkflowNo) {
      if (normalizedWorkflowType === AuditWorkflowTypes.SWAP && db) {
        const expanded = await this.resolveSwapWorkflowSearchExpansion(
          normalizedWorkflowNo,
          db,
        );
        const workflowNos = expanded.workflowNos;
        const orClauses: any[] = [];
        if (workflowNos.length) {
          orClauses.push({ workflowNo: { in: workflowNos } });
          orClauses.push({
            subjectNos: {
              some: {
                subjectNo: { in: workflowNos },
              },
            },
          });
        }
        if (expanded.traceIds.length) {
          orClauses.push({
            traceId: { in: expanded.traceIds },
          });
        }
        if (orClauses.length) {
          andClauses.push({ OR: orClauses });
        } else {
          andClauses.push({ id: '__NO_MATCH__' });
        }
      } else {
        andClauses.push({ workflowNo: normalizedWorkflowNo });
      }
    }

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
        : (this.toSortedUniqueStrings(records.map((row: any) => row.workflowNo)) as string[]);

    const normalizedCriteriaWorkflowNo =
      workflowSummaryType === AuditWorkflowTypes.SWAP && canonicalSwapWorkflowNo
        ? canonicalSwapWorkflowNo
        : query.workflowNo || null;
    const filterSnapshotWorkflowNo =
      workflowSummaryType === AuditWorkflowTypes.SWAP && canonicalSwapWorkflowNo
        ? canonicalSwapWorkflowNo
        : query.workflowNo || null;

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
        workflowNo: normalizedCriteriaWorkflowNo,
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
        workflowNo: filterSnapshotWorkflowNo,
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
    const workflowIds = Array.from(
      new Set(
        records
          .filter((item) => item.workflowType === AuditWorkflowTypes.WITHDRAW)
          .map((item) => this.normalizeOptionalString(item.workflowId))
          .filter(Boolean) as string[],
      ),
    );

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
            amlRiskTier: true,
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
            amlRiskTier: true,
            investorClassification: true,
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
