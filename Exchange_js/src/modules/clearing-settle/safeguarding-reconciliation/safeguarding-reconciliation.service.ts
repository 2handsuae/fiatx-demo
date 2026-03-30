import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ComplianceAlertsService } from '../../risk-engine/compliance-alerts/compliance-alerts.service';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
  buildStateTransitionAction,
} from '../../risk-engine/audit-logs/constants/audit-actions.constant';
import { AuditTriggerType } from '../../risk-engine/audit-logs/dto/audit-log.dto';
import {
  TRANSACTION_REVIEW_RULES,
  TRANSACTION_REVIEW_STAGES,
  TRANSACTION_WITHDRAW_SOURCE_TYPE,
} from '../../risk-engine/constants/onboarding-compliance-workflow.constant';
import {
  GenerateSafeguardingDailyDiffDto,
  SafeguardingBreakQueryDto,
  UpdateReconciliationBreakStatusDto,
} from './dto/safeguarding-reconciliation.dto';
import {
  RECONCILIATION_BREAK_SOURCE_TYPE,
  ReconciliationBreakReasonCodes,
  ReconciliationBreakStatuses,
  type ReconciliationBreakReasonCode,
} from './constants/safeguarding-reconciliation.constant';

type TxClient = Prisma.TransactionClient;

type BreakRow = {
  id: string;
  breakNo: string;
  businessDate: string;
  sourceType: string;
  sourceId: string;
  sourceNo: string | null;
  withdrawId: string;
  withdrawNo: string | null;
  payoutId: string | null;
  payoutNo: string | null;
  assetId: string;
  assetCode: string | null;
  expectedNetDelta: Prisma.Decimal;
  observedNetDelta: Prisma.Decimal;
  deltaAmount: Prisma.Decimal;
  reasonCode: string;
  status: string;
  linkedAlertId: string | null;
  linkedCaseId: string | null;
  detailsJson: string | null;
  detectedAt: Date;
  resolvedAt: Date | null;
  reopenedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type CandidateWithdraw = {
  id: string;
  withdrawNo: string;
  ownerType: string;
  ownerId: string;
  status: string;
  netAmount: Prisma.Decimal;
  assetId: string;
  completedAt: Date | null;
  payoutId: string | null;
  payoutNo: string | null;
  asset: {
    id: string;
    code: string;
    type: string;
  };
  payout: {
    id: string;
    payoutNo: string;
    status: string;
    amount: Prisma.Decimal;
    completedAt: Date | null;
    clearings: Array<{
      id: string;
      clearingNo: string;
      sourceType: string;
      sourceId: string;
      inAmount: Prisma.Decimal;
      outAmount: Prisma.Decimal;
      clearingStatus: string;
      outPayoutId: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>;
  } | null;
};

type ComputedBreak = {
  expectedNetDelta: Prisma.Decimal;
  observedNetDelta: Prisma.Decimal;
  deltaAmount: Prisma.Decimal;
  reasonCode: ReconciliationBreakReasonCode | null;
  details: Record<string, unknown>;
};

@Injectable()
export class SafeguardingReconciliationService {
  private static readonly MAX_NO_GENERATION_RETRIES = 10;
  private static readonly TERMINAL_WITHDRAW_STATUSES = new Set([
    'SUCCESS',
    'FAILED',
    'RETURNED',
    'REJECTED',
    'CANCELLED',
  ]);
  private static readonly ZERO_EXPECTED_WITHDRAW_STATUSES = new Set([
    'FAILED',
    'RETURNED',
    'REJECTED',
    'CANCELLED',
  ]);
  private static readonly SUCCESS_PAYOUT_STATUSES = new Set(['CONFIRMED', 'CLEARED']);
  private static readonly COMPENSATION_PAYOUT_STATUSES = new Set([
    'FAILED',
    'TIMEOUT',
    'RETURNED',
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly complianceAlertsService: ComplianceAlertsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length ? normalized : null;
  }

  private normalizePayoutStatus(value: unknown): string {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === 'CLEAR') return 'CLEARED';
    return normalized;
  }

  private normalizeBusinessDate(value: string): string {
    const normalized = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      throw new BadRequestException(
        'businessDate must be in YYYY-MM-DD format',
      );
    }

    const date = new Date(`${normalized}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
      throw new BadRequestException('businessDate must be a valid calendar date');
    }

    return normalized;
  }

  private buildBusinessDateCutoff(businessDate: string) {
    const startAt = new Date(`${businessDate}T00:00:00.000Z`);
    const nextDate = new Date(startAt.getTime());
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    return {
      startAt,
      cutoffAt: new Date(nextDate.getTime() - 1),
    };
  }

  private parseJson(value?: string | null): Record<string, unknown> | null {
    if (!value) return null;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  private serializeJson(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    try {
      return JSON.stringify(value);
    } catch {
      throw new BadRequestException('Failed to serialize break details');
    }
  }

  private toDecimal(value: Prisma.Decimal | string | number | null | undefined) {
    return new Prisma.Decimal(value ?? 0);
  }

  private areDecimalsEqual(a: Prisma.Decimal, b: Prisma.Decimal) {
    return a.equals(b);
  }

  private async createBreakWithUniqueNo(
    tx: TxClient,
    data: Omit<BreakRow, 'id' | 'breakNo' | 'createdAt' | 'updatedAt'>,
  ) {
    for (
      let attempt = 1;
      attempt <= SafeguardingReconciliationService.MAX_NO_GENERATION_RETRIES;
      attempt += 1
    ) {
      try {
        return await (tx as any).reconciliationBreak.create({
          data: {
            ...data,
            breakNo: generateReferenceNo('RBR'),
          },
        });
      } catch (error) {
        const maybe = error as { code?: string; meta?: { target?: string[] | string } };
        const target = maybe?.meta?.target;
        const isBreakNoConflict =
          maybe?.code === 'P2002' &&
          ((Array.isArray(target) && target.includes('breakNo')) ||
            (typeof target === 'string' && target.includes('breakNo')));
        if (isBreakNoConflict) continue;
        throw error;
      }
    }

    throw new InternalServerErrorException(
      `Failed to generate unique breakNo after ${SafeguardingReconciliationService.MAX_NO_GENERATION_RETRIES} attempts`,
    );
  }

  private async findCandidateWithdraws(
    businessDate: string,
  ): Promise<CandidateWithdraw[]> {
    const { cutoffAt } = this.buildBusinessDateCutoff(businessDate);
    return (this.prisma as any).withdrawTransaction.findMany({
      where: {
        payoutId: { not: null },
        completedAt: { not: null, lte: cutoffAt },
        status: {
          in: Array.from(
            SafeguardingReconciliationService.TERMINAL_WITHDRAW_STATUSES,
          ),
        },
      },
      orderBy: [{ completedAt: 'asc' }, { withdrawNo: 'asc' }],
      select: {
        id: true,
        withdrawNo: true,
        ownerType: true,
        ownerId: true,
        status: true,
        netAmount: true,
        assetId: true,
        completedAt: true,
        payoutId: true,
        payoutNo: true,
        asset: {
          select: {
            id: true,
            code: true,
            type: true,
          },
        },
        payout: {
          select: {
            id: true,
            payoutNo: true,
            status: true,
            amount: true,
            completedAt: true,
            clearings: {
              select: {
                id: true,
                clearingNo: true,
                sourceType: true,
                sourceId: true,
                inAmount: true,
                outAmount: true,
                clearingStatus: true,
                outPayoutId: true,
                createdAt: true,
                updatedAt: true,
              },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            },
          },
        },
      },
    });
  }

  private computeBreakForWithdraw(candidate: CandidateWithdraw): ComputedBreak {
    const withdrawStatus = String(candidate.status || '').trim().toUpperCase();
    const payoutStatus = this.normalizePayoutStatus(candidate.payout?.status);
    const clearings = Array.isArray(candidate.payout?.clearings)
      ? candidate.payout!.clearings
      : [];
    const activeClearings = clearings.filter(
      (item) => String(item.clearingStatus || '').trim().toUpperCase() !== 'CANCELLED',
    );
    const cancelledClearings = clearings.filter(
      (item) => String(item.clearingStatus || '').trim().toUpperCase() === 'CANCELLED',
    );

    const expectedNetDelta =
      withdrawStatus === 'SUCCESS'
        ? this.toDecimal(candidate.netAmount)
        : SafeguardingReconciliationService.ZERO_EXPECTED_WITHDRAW_STATUSES.has(withdrawStatus)
          ? this.toDecimal(0)
          : this.toDecimal(0);

    let observedNetDelta = this.toDecimal(0);
    let observedSource = 'ZERO';
    if (activeClearings.length > 0) {
      observedNetDelta = activeClearings.reduce(
        (sum, item) => sum.plus(this.toDecimal(item.inAmount)),
        this.toDecimal(0),
      );
      observedSource = 'ACTIVE_CLEARINGS';
    } else if (
      candidate.payout &&
      SafeguardingReconciliationService.SUCCESS_PAYOUT_STATUSES.has(payoutStatus)
    ) {
      observedNetDelta = this.toDecimal(candidate.payout.amount);
      observedSource = 'PAYOUT';
    } else if (
      candidate.payout &&
      SafeguardingReconciliationService.COMPENSATION_PAYOUT_STATUSES.has(
        payoutStatus,
      ) &&
      clearings.length > 0 &&
      cancelledClearings.length === clearings.length
    ) {
      observedNetDelta = this.toDecimal(0);
      observedSource = 'CANCELLED_CLEARINGS';
    }

    const deltaAmount = observedNetDelta.minus(expectedNetDelta);
    let reasonCode: ReconciliationBreakReasonCode | null = null;

    if (withdrawStatus === 'SUCCESS' && payoutStatus !== 'CLEARED') {
      reasonCode = ReconciliationBreakReasonCodes.SUCCESS_CLOSEOUT_INCOMPLETE;
    } else if (
      SafeguardingReconciliationService.ZERO_EXPECTED_WITHDRAW_STATUSES.has(
        withdrawStatus,
      ) &&
      activeClearings.length > 0
    ) {
      reasonCode = ReconciliationBreakReasonCodes.COMPENSATION_INCOMPLETE;
    } else if (!this.areDecimalsEqual(expectedNetDelta, observedNetDelta)) {
      reasonCode = ReconciliationBreakReasonCodes.DELTA_MISMATCH;
    }

    return {
      expectedNetDelta,
      observedNetDelta,
      deltaAmount,
      reasonCode,
      details: {
        withdrawStatus,
        payoutStatus: payoutStatus || null,
        payoutCompletedAt: candidate.payout?.completedAt?.toISOString?.() || null,
        withdrawCompletedAt: candidate.completedAt?.toISOString?.() || null,
        activeClearingCount: activeClearings.length,
        cancelledClearingCount: cancelledClearings.length,
        clearingCount: clearings.length,
        activeClearingIds: activeClearings.map((item) => item.id),
        cancelledClearingIds: cancelledClearings.map((item) => item.id),
        observedSource,
      },
    };
  }

  private async syncLinkedCaseFromAlert(
    tx: TxClient,
    breakRow: BreakRow,
  ): Promise<BreakRow> {
    if (!breakRow.linkedAlertId) {
      return breakRow;
    }

    const alert = await (tx as any).complianceAlert?.findUnique?.({
      where: { id: breakRow.linkedAlertId },
      select: {
        id: true,
        linkedCaseIds: true,
      },
    });
    if (!alert) return breakRow;

    let linkedCaseId: string | null = null;
    try {
      const parsed = JSON.parse(alert.linkedCaseIds || '[]');
      if (Array.isArray(parsed)) {
        linkedCaseId = this.normalizeOptionalString(parsed[0]);
      }
    } catch {
      linkedCaseId = null;
    }

    if (linkedCaseId === breakRow.linkedCaseId) {
      return breakRow;
    }

    return (tx as any).reconciliationBreak.update({
      where: { id: breakRow.id },
      data: {
        linkedCaseId,
      },
    });
  }

  private async recordBreakAudit(
    tx: TxClient,
    params: {
      breakRow: BreakRow;
      withdraw: CandidateWithdraw;
      action: string;
      reason: string;
      metadata?: Record<string, unknown>;
      triggerType?: AuditTriggerType;
      actorType?: string;
      actorId?: string;
      actorRole?: string;
      sourcePlatform?: string;
    },
  ) {
    await this.auditLogsService.recordByActor(
      {
        triggerType: params.triggerType || AuditTriggerType.SYSTEM_EVENT,
        action: params.action,
        module: AuditModules.SAFEGUARDING_RECONCILIATION,
        entityType: AuditEntityTypes.RECONCILIATION_BREAK,
        entityId: params.breakRow.id,
        entityNo: params.breakRow.breakNo,
        workflowType: AuditWorkflowTypes.WITHDRAW,
        workflowId: params.breakRow.withdrawId,
        workflowNo: params.breakRow.withdrawNo || params.breakRow.sourceNo || params.breakRow.sourceId,
        entityOwnerType: params.withdraw.ownerType,
        entityOwnerId: params.withdraw.ownerId,
        reason: params.reason,
        metadata: {
          businessDate: params.breakRow.businessDate,
          reasonCode: params.breakRow.reasonCode,
          breakStatus: params.breakRow.status,
          withdrawId: params.breakRow.withdrawId,
          payoutId: params.breakRow.payoutId,
          linkedAlertId: params.breakRow.linkedAlertId,
          linkedCaseId: params.breakRow.linkedCaseId,
          ...params.metadata,
        },
        sourcePlatform: params.sourcePlatform,
      },
      {
        actorType: params.actorType || 'SYSTEM',
        actorId: params.actorId || 'SYSTEM',
        actorRole: params.actorRole || 'SYSTEM',
      },
      tx,
    );
  }

  private async upsertAlertForBreak(
    tx: TxClient,
    breakRow: BreakRow,
    withdraw: CandidateWithdraw,
  ) {
    const alert = await this.complianceAlertsService.triggerSystemAlert(
      {
        ruleCode: TRANSACTION_REVIEW_RULES.TX_RECONCILIATION_BREAK_DETECTED,
        sourceModule: AuditModules.SAFEGUARDING_RECONCILIATION,
        sourceType: TRANSACTION_WITHDRAW_SOURCE_TYPE,
        sourceId: withdraw.id,
        sourceNo: withdraw.withdrawNo,
        stage: TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_RECONCILIATION,
        entityType: AuditEntityTypes.RECONCILIATION_BREAK,
        entityId: breakRow.id,
        entityNo: breakRow.breakNo,
        ownerType: withdraw.ownerType,
        ownerId: withdraw.ownerId,
        metadata: {
          breakId: breakRow.id,
          breakNo: breakRow.breakNo,
          businessDate: breakRow.businessDate,
          reasonCode: breakRow.reasonCode,
          expectedNetDelta: breakRow.expectedNetDelta.toString(),
          observedNetDelta: breakRow.observedNetDelta.toString(),
          deltaAmount: breakRow.deltaAmount.toString(),
        },
        sourcePlatform: 'SYSTEM',
      },
      tx,
    );

    const linkedCaseId = Array.isArray((alert as any).linkedCaseIds)
      ? this.normalizeOptionalString((alert as any).linkedCaseIds[0])
      : null;

    return (tx as any).reconciliationBreak.update({
      where: { id: breakRow.id },
      data: {
        linkedAlertId: alert.id,
        linkedCaseId,
      },
    });
  }

  private async upsertBreakForCandidate(
    businessDate: string,
    withdraw: CandidateWithdraw,
    computed: ComputedBreak,
  ) {
    if (!computed.reasonCode || !withdraw.payout) {
      return null;
    }

    return (this.prisma as any).$transaction(async (tx: TxClient) => {
      const now = new Date();
      const existing = await (tx as any).reconciliationBreak.findUnique({
        where: {
          businessDate_sourceType_sourceId: {
            businessDate,
            sourceType: RECONCILIATION_BREAK_SOURCE_TYPE,
            sourceId: withdraw.id,
          },
        },
      });

      const payout = withdraw.payout!;
      const baseData = {
        businessDate,
        sourceType: RECONCILIATION_BREAK_SOURCE_TYPE,
        sourceId: withdraw.id,
        sourceNo: withdraw.withdrawNo,
        withdrawId: withdraw.id,
        withdrawNo: withdraw.withdrawNo,
        payoutId: payout.id,
        payoutNo: payout.payoutNo,
        assetId: withdraw.assetId,
        assetCode: withdraw.asset?.code || null,
        expectedNetDelta: computed.expectedNetDelta,
        observedNetDelta: computed.observedNetDelta,
        deltaAmount: computed.deltaAmount,
        reasonCode: computed.reasonCode as string,
        status: ReconciliationBreakStatuses.OPEN,
        detailsJson: this.serializeJson(computed.details),
      };

      let breakRow: BreakRow;
      let created = false;
      let reopened = false;

      if (!existing) {
        breakRow = await this.createBreakWithUniqueNo(tx, {
          ...baseData,
          linkedAlertId: null,
          linkedCaseId: null,
          detectedAt: now,
          resolvedAt: null,
          reopenedAt: null,
        });
        created = true;
      } else {
        breakRow = await (tx as any).reconciliationBreak.update({
          where: { id: existing.id },
          data: {
            ...baseData,
            resolvedAt: null,
            reopenedAt: [
              ReconciliationBreakStatuses.RESOLVED,
              ReconciliationBreakStatuses.ACCEPTED_DIFFERENCE,
            ].includes(existing.status)
              ? now
              : existing.reopenedAt,
          },
        });
        reopened = [
          ReconciliationBreakStatuses.RESOLVED,
          ReconciliationBreakStatuses.ACCEPTED_DIFFERENCE,
        ].includes(existing.status);
      }

      breakRow = await this.upsertAlertForBreak(tx, breakRow, withdraw);
      breakRow = await this.syncLinkedCaseFromAlert(tx, breakRow);

      if (created || reopened) {
        await this.recordBreakAudit(tx, {
          breakRow,
          withdraw,
          action: AuditActions.TX_RECONCILIATION_BREAK_DETECTED,
          reason: created
            ? `Reconciliation break detected for withdraw ${withdraw.withdrawNo}`
            : `Reconciliation break reopened for withdraw ${withdraw.withdrawNo}`,
          metadata: {
            created,
            reopened,
            details: computed.details,
          },
        });
      }

      return breakRow;
    });
  }

  private async enrichBreaks(rows: BreakRow[]) {
    const alertIds = Array.from(
      new Set(rows.map((row) => row.linkedAlertId).filter(Boolean)),
    ) as string[];
    const caseIds = Array.from(
      new Set(rows.map((row) => row.linkedCaseId).filter(Boolean)),
    ) as string[];
    const withdrawIds = Array.from(new Set(rows.map((row) => row.withdrawId)));
    const payoutIds = Array.from(
      new Set(rows.map((row) => row.payoutId).filter(Boolean)),
    ) as string[];

    const [alerts, cases, withdraws, payouts] = await Promise.all([
      alertIds.length && (this.prisma as any).complianceAlert?.findMany
        ? (this.prisma as any).complianceAlert.findMany({
            where: { id: { in: alertIds } },
            select: {
              id: true,
              alertNo: true,
              status: true,
              stage: true,
              ruleCode: true,
              linkedCaseIds: true,
            },
          })
        : Promise.resolve([]),
      caseIds.length && (this.prisma as any).complianceIncident?.findMany
        ? (this.prisma as any).complianceIncident.findMany({
            where: { id: { in: caseIds } },
            select: {
              id: true,
              incidentNo: true,
              status: true,
              severity: true,
            },
          })
        : Promise.resolve([]),
      withdrawIds.length
        ? (this.prisma as any).withdrawTransaction.findMany({
            where: { id: { in: withdrawIds } },
            select: {
              id: true,
              withdrawNo: true,
              status: true,
              netAmount: true,
              completedAt: true,
            },
          })
        : Promise.resolve([]),
      payoutIds.length
        ? (this.prisma as any).payout.findMany({
            where: { id: { in: payoutIds } },
            select: {
              id: true,
              payoutNo: true,
              status: true,
              amount: true,
              completedAt: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const alertMap = new Map<string, any>(
      alerts.map((item: any) => [String(item.id), item]),
    );
    const caseMap = new Map<string, any>(
      cases.map((item: any) => [String(item.id), item]),
    );
    const withdrawMap = new Map<string, any>(
      withdraws.map((item: any) => [String(item.id), item]),
    );
    const payoutMap = new Map<string, any>(
      payouts.map((item: any) => [String(item.id), item]),
    );

    return rows.map((row) => {
      const alert = row.linkedAlertId ? alertMap.get(String(row.linkedAlertId)) : null;
      let derivedCaseId = row.linkedCaseId;
      if (!derivedCaseId && alert?.linkedCaseIds) {
        try {
          const parsed = JSON.parse(alert.linkedCaseIds || '[]');
          if (Array.isArray(parsed)) {
            derivedCaseId = this.normalizeOptionalString(parsed[0]);
          }
        } catch {
          derivedCaseId = null;
        }
      }
      const linkedCase = derivedCaseId ? caseMap.get(String(derivedCaseId)) : null;
      const withdraw = withdrawMap.get(String(row.withdrawId)) || null;
      const payout = row.payoutId ? payoutMap.get(String(row.payoutId)) || null : null;

      return {
        ...row,
        expectedNetDelta: row.expectedNetDelta.toString(),
        observedNetDelta: row.observedNetDelta.toString(),
        deltaAmount: row.deltaAmount.toString(),
        details: this.parseJson(row.detailsJson),
        linkedAlertId: row.linkedAlertId,
        linkedCaseId: derivedCaseId,
        linkedAlert: alert
          ? {
              id: alert.id,
              alertNo: alert.alertNo,
              status: alert.status,
              stage: alert.stage,
              ruleCode: alert.ruleCode,
            }
          : null,
        linkedCase: linkedCase
          ? {
              id: linkedCase.id,
              incidentNo: linkedCase.incidentNo,
              status: linkedCase.status,
              severity: linkedCase.severity,
            }
          : null,
        withdraw: withdraw
          ? {
              ...withdraw,
              netAmount: withdraw.netAmount?.toString?.() ?? '0',
            }
          : null,
        payout: payout
          ? {
              ...payout,
              amount: payout.amount?.toString?.() ?? '0',
            }
          : null,
      };
    });
  }

  async generateDailyDiff(
    dto: GenerateSafeguardingDailyDiffDto,
    operatorId: string,
  ) {
    const businessDate = this.normalizeBusinessDate(dto.businessDate);
    const candidates = await this.findCandidateWithdraws(businessDate);
    const results: Array<{
      withdrawId: string;
      withdrawNo: string;
      breakId?: string;
      breakNo?: string;
      reasonCode?: string;
      created: boolean;
    }> = [];

    for (const candidate of candidates) {
      const computed = this.computeBreakForWithdraw(candidate);
      if (!computed.reasonCode) continue;

      const existing = await (this.prisma as any).reconciliationBreak.findUnique({
        where: {
          businessDate_sourceType_sourceId: {
            businessDate,
            sourceType: RECONCILIATION_BREAK_SOURCE_TYPE,
            sourceId: candidate.id,
          },
        },
        select: { id: true },
      });
      const breakRow = await this.upsertBreakForCandidate(
        businessDate,
        candidate,
        computed,
      );
      if (!breakRow) continue;

      results.push({
        withdrawId: candidate.id,
        withdrawNo: candidate.withdrawNo,
        breakId: breakRow.id,
        breakNo: breakRow.breakNo,
        reasonCode: breakRow.reasonCode,
        created: !existing,
      });
    }

    return {
      businessDate,
      candidateCount: candidates.length,
      breakCount: results.length,
      generatedBy: operatorId,
      items: results,
    };
  }

  async findAllForAdmin(query: SafeguardingBreakQueryDto) {
    const skip = Math.max(0, Number(query.skip || 0));
    const take = Math.min(200, Math.max(1, Number(query.take || 20)));
    const where: any = {};

    if (query.businessDate) {
      where.businessDate = this.normalizeBusinessDate(query.businessDate);
    }
    if (query.withdrawNo) {
      where.withdrawNo = { contains: query.withdrawNo.trim() };
    }
    if (query.payoutNo) {
      where.payoutNo = { contains: query.payoutNo.trim() };
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.reasonCode) {
      where.reasonCode = query.reasonCode;
    }

    const [rows, total] = await Promise.all([
      (this.prisma as any).reconciliationBreak.findMany({
        where,
        skip,
        take,
        orderBy: [{ businessDate: 'desc' }, { detectedAt: 'desc' }, { breakNo: 'desc' }],
      }),
      (this.prisma as any).reconciliationBreak.count({ where }),
    ]);

    return {
      total,
      skip,
      take,
      items: await this.enrichBreaks(rows),
    };
  }

  async findOneForAdmin(id: string) {
    const row = await (this.prisma as any).reconciliationBreak.findUnique({
      where: { id },
    });
    if (!row) {
      throw new NotFoundException(`Reconciliation break not found: ${id}`);
    }

    const [enriched] = await this.enrichBreaks([row]);
    return enriched;
  }

  async updateStatus(
    id: string,
    dto: UpdateReconciliationBreakStatusDto,
    operatorId: string,
  ) {
    const targetStatus = String(dto.status || '').trim().toUpperCase();
    const note = this.normalizeOptionalString(dto.note);

    return (this.prisma as any).$transaction(async (tx: TxClient) => {
      const current = await (tx as any).reconciliationBreak.findUnique({
        where: { id },
      });
      if (!current) {
        throw new NotFoundException(`Reconciliation break not found: ${id}`);
      }

      const normalizedCurrent = String(current.status || '').trim().toUpperCase();
      if (normalizedCurrent === targetStatus) {
        const [same] = await this.enrichBreaks([current]);
        return same;
      }

      const allowedTargetStatuses = new Set<string>([
        ReconciliationBreakStatuses.UNDER_REVIEW,
        ReconciliationBreakStatuses.RESOLVED,
        ReconciliationBreakStatuses.ACCEPTED_DIFFERENCE,
      ]);
      if (!allowedTargetStatuses.has(targetStatus)) {
        throw new BadRequestException(
          `Unsupported reconciliation break status: ${targetStatus}`,
        );
      }

      let details = this.parseJson(current.detailsJson) || {};
      if (note) {
        details = {
          ...details,
          lastOperatorNote: note,
          lastOperatorId: operatorId,
          lastOperatorAt: new Date().toISOString(),
        };
      }

      let nextResolvedAt = current.resolvedAt;
      let nextReopenedAt = current.reopenedAt;
      if (
        targetStatus === ReconciliationBreakStatuses.RESOLVED ||
        targetStatus === ReconciliationBreakStatuses.ACCEPTED_DIFFERENCE
      ) {
        nextResolvedAt = new Date();
      } else {
        nextResolvedAt = null;
        nextReopenedAt = new Date();
      }

      const updated = await (tx as any).reconciliationBreak.update({
        where: { id },
        data: {
          status: targetStatus,
          resolvedAt: nextResolvedAt,
          reopenedAt: nextReopenedAt,
          detailsJson: this.serializeJson(details),
        },
      });

      const withdraw = await (tx as any).withdrawTransaction.findUnique({
        where: { id: current.withdrawId },
        select: {
          id: true,
          withdrawNo: true,
          ownerType: true,
          ownerId: true,
          status: true,
          netAmount: true,
          assetId: true,
          completedAt: true,
          payoutId: true,
          payoutNo: true,
          asset: {
            select: {
              id: true,
              code: true,
              type: true,
            },
          },
          payout: {
            select: {
              id: true,
              payoutNo: true,
              status: true,
              amount: true,
              completedAt: true,
              clearings: {
                select: {
                  id: true,
                  clearingNo: true,
                  sourceType: true,
                  sourceId: true,
                  inAmount: true,
                  outAmount: true,
                  clearingStatus: true,
                  outPayoutId: true,
                  createdAt: true,
                  updatedAt: true,
                },
              },
            },
          },
        },
      });
      if (!withdraw) {
        throw new NotFoundException(
          `Withdraw transaction not found for reconciliation break ${id}`,
        );
      }

      await this.recordBreakAudit(tx, {
        breakRow: updated,
        withdraw,
        action:
          targetStatus === ReconciliationBreakStatuses.RESOLVED ||
          targetStatus === ReconciliationBreakStatuses.ACCEPTED_DIFFERENCE
            ? AuditActions.TX_RECONCILIATION_BREAK_RESOLVED
            : buildStateTransitionAction(
                'RECONCILIATION_BREAK',
                normalizedCurrent,
                targetStatus,
              ),
        reason:
          note ||
          `Reconciliation break ${updated.breakNo} moved from ${normalizedCurrent} to ${targetStatus}`,
        metadata: {
          statusFrom: normalizedCurrent,
          statusTo: targetStatus,
          operatorNote: note,
        },
        triggerType: AuditTriggerType.STATE_TRANSITION,
        actorType: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
        actorId: operatorId,
        actorRole: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
        sourcePlatform: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_API',
      });

      const [enriched] = await this.enrichBreaks([updated]);
      return enriched;
    });
  }
}
