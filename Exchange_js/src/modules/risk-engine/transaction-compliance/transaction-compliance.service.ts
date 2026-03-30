import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, KytCase, TravelRuleCase } from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  MockKytCaseCompleteDto,
  MockTravelRuleCaseCompleteDto,
  TxKytCaseCallbackDto,
  TxTravelRuleCaseCallbackDto,
  TxCaseListQueryDto,
} from './dto/tx-compliance.dto';
import {
  KYT_FINAL_COMPATIBILITY_STATUSES,
  KytScreeningStage,
  normalizeKytResponseLifecycleStatus,
  normalizeTravelRuleResponseLifecycleStatus,
  TRAVEL_RULE_FINAL_COMPATIBILITY_STATUSES,
  TxResponseLifecycleStatusOrEmpty,
  TxComplianceProviderMode,
  TxSourceContext,
  TxSourceType,
  UpsertKytCaseInput,
  UpsertTravelRuleCaseInput,
} from './types/tx-compliance.types';
import { DepositTransactionStatus } from '../../trading/deposit-transactions/dto/deposit-transaction.dto';
import { WithdrawTransactionStatus } from '../../trading/withdraw-transactions/dto/withdraw-transaction.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from '../audit-logs/constants/audit-actions.constant';
import { AuditResult, AuditTriggerType } from '../audit-logs/dto/audit-log.dto';
import {
  BridgeExecutionResult,
  TransactionRiskBridgeService,
} from './transaction-risk-bridge.service';
import { PayinSimulationMode } from '../../asset-treasury/payins/dto/payin.dto';

type DbClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class TransactionComplianceService {
  private readonly logger = new Logger(TransactionComplianceService.name);
  private readonly auditLogsService: AuditLogsService;

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly transactionRiskBridgeService?: TransactionRiskBridgeService,
  ) {
    this.auditLogsService = new AuditLogsService(prisma);
  }

  private getClient(tx?: Prisma.TransactionClient): DbClient {
    return tx ?? this.prisma;
  }

  async evaluateSwapFinalReview(
    swapId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<BridgeExecutionResult> {
    if (!this.transactionRiskBridgeService) {
      throw new NotFoundException('TransactionRiskBridgeService is unavailable');
    }

    return this.transactionRiskBridgeService.handleSwapFinalReview(
      {
        swapId,
        sourceType: TxSourceType.SWAP,
        sourceId: swapId,
      },
      tx,
    );
  }

  async initializeWithdrawFinalDecisionRecord(
    withdrawId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<BridgeExecutionResult> {
    if (!this.transactionRiskBridgeService) {
      throw new NotFoundException('TransactionRiskBridgeService is unavailable');
    }

    return this.transactionRiskBridgeService.initializeWithdrawFinalReview(
      withdrawId,
      tx,
    );
  }

  private getProviderMode(): TxComplianceProviderMode {
    const configured = (process.env.TX_COMPLIANCE_PROVIDER_MODE || '').toUpperCase();
    if (configured === 'MOCK' || configured === 'MANUAL') {
      return configured;
    }
    return process.env.NODE_ENV === 'production' ? 'MANUAL' : 'MOCK';
  }

  private serializePayload(payload: unknown): string | null {
    if (payload === null || payload === undefined) {
      return null;
    }
    if (typeof payload === 'string') {
      return payload;
    }
    return JSON.stringify(payload);
  }

  private isCryptoAssetType(assetType?: string | null): boolean {
    return String(assetType || '').toUpperCase() === 'CRYPTO';
  }

  private generateCaseNo(prefix: 'KYT' | 'TRV'): string {
    return generateReferenceNo(prefix);
  }

  public normalizeKytLifecycleStatus(
    status?: string | null,
    options?: { allowEmpty?: boolean },
  ): TxResponseLifecycleStatusOrEmpty {
    return normalizeKytResponseLifecycleStatus(status, options);
  }

  public normalizeTravelRuleLifecycleStatus(
    status?: string | null,
    required?: boolean,
    options?: { allowEmpty?: boolean },
  ): TxResponseLifecycleStatusOrEmpty {
    return normalizeTravelRuleResponseLifecycleStatus(status, required, options);
  }

  private normalizeKytStatus(status?: string | null): string {
    return this.normalizeKytLifecycleStatus(status);
  }

  private normalizeTravelRuleStatus(
    status?: string | null,
    required?: boolean,
  ): string {
    return this.normalizeTravelRuleLifecycleStatus(status, required);
  }

  private expandLifecycleStatusFilter(
    status: string | null | undefined,
    kind: 'KYT' | 'TRAVEL_RULE',
  ): string[] | null {
    const current = String(status || '').trim().toUpperCase();
    if (!current) {
      return null;
    }

    const normalized =
      kind === 'KYT'
        ? this.normalizeKytLifecycleStatus(current, { allowEmpty: true })
        : this.normalizeTravelRuleLifecycleStatus(current, true, {
            allowEmpty: true,
          });

    if (normalized === 'CREATED') {
      return ['CREATED'];
    }

    if (normalized === 'RECEIVED') {
      return ['RECEIVED', 'SENT', 'PENDING'];
    }

    return kind === 'KYT'
      ? [...KYT_FINAL_COMPATIBILITY_STATUSES]
      : [...TRAVEL_RULE_FINAL_COMPATIBILITY_STATUSES];
  }

  private normalizePayloadLifecycleValue(
    value: unknown,
    kind: 'KYT' | 'TRAVEL_RULE',
    required?: boolean,
  ): unknown {
    if (Array.isArray(value)) {
      return value.map((item) =>
        this.normalizePayloadLifecycleValue(item, kind, required),
      );
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    const current = value as Record<string, unknown>;
    const payloadRequired =
      kind === 'TRAVEL_RULE' && typeof current.required === 'boolean'
        ? current.required
        : required;
    const normalized: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(current)) {
      if (key === 'status' || key === 'lifecycle') {
        normalized[key] =
          kind === 'KYT'
            ? this.normalizeKytLifecycleStatus(String(entry || ''), {
                allowEmpty: true,
              })
            : this.normalizeTravelRuleLifecycleStatus(
                String(entry || ''),
                Boolean(payloadRequired),
                { allowEmpty: true },
              );
        continue;
      }

      normalized[key] = this.normalizePayloadLifecycleValue(
        entry,
        kind,
        Boolean(payloadRequired),
      );
    }

    return normalized;
  }

  private normalizeSerializedPayloadLifecycle(
    payload: string | null | undefined,
    kind: 'KYT' | 'TRAVEL_RULE',
    required?: boolean,
  ): string | null | undefined {
    if (!payload) {
      return payload;
    }

    try {
      const parsed = JSON.parse(payload);
      return JSON.stringify(
        this.normalizePayloadLifecycleValue(parsed, kind, required),
      );
    } catch {
      return payload;
    }
  }

  private normalizeKytCaseForRead<T extends Record<string, any> | null>(
    record: T,
  ): T {
    if (!record) {
      return record;
    }

    const normalizedReports = Array.isArray(record.reports)
      ? record.reports.map((report: Record<string, any>) => ({
          ...report,
          normalizedPayload: this.normalizeSerializedPayloadLifecycle(
            report.normalizedPayload,
            'KYT',
          ),
        }))
      : record.reports;

    return {
      ...record,
      status: this.normalizeKytLifecycleStatus(record.status, {
        allowEmpty: true,
      }),
      latestNormalizedPayload: this.normalizeSerializedPayloadLifecycle(
        record.latestNormalizedPayload,
        'KYT',
      ),
      reports: normalizedReports,
    } as T;
  }

  private normalizeTravelRuleCaseForRead<
    T extends Record<string, any> | null,
  >(record: T): T {
    if (!record) {
      return record;
    }

    const normalizedReports = Array.isArray(record.reports)
      ? record.reports.map((report: Record<string, any>) => ({
          ...report,
          status: this.normalizeTravelRuleLifecycleStatus(
            report.status,
            report.required,
            { allowEmpty: true },
          ),
          normalizedPayload: this.normalizeSerializedPayloadLifecycle(
            report.normalizedPayload,
            'TRAVEL_RULE',
            report.required,
          ),
        }))
      : record.reports;

    return {
      ...record,
      status: this.normalizeTravelRuleLifecycleStatus(
        record.status,
        record.required,
        { allowEmpty: true },
      ),
      latestNormalizedPayload: this.normalizeSerializedPayloadLifecycle(
        record.latestNormalizedPayload,
        'TRAVEL_RULE',
        record.required,
      ),
      reports: normalizedReports,
    } as T;
  }

  private normalizeSimulationRiskLevel(
    value?: string | null,
  ): 'LOW' | 'MEDIUM' | 'HIGH' {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === 'MEDIUM' || normalized === 'HIGH') {
      return normalized;
    }
    return 'LOW';
  }

  private normalizeSimulationRiskReason(value?: string | null): string | null {
    const normalized = String(value || '').trim().toUpperCase();
    if (
      normalized === 'KYT_ISSUE' ||
      normalized === 'TRAVEL_RULE_ISSUE' ||
      normalized === 'LARGE_DEPOSIT_PROFILE_MISMATCH' ||
      normalized === 'SANCTIONS_HIT'
    ) {
      return normalized;
    }
    return null;
  }

  private async resolveInboundSignalForPayin(
    payinId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = this.getClient(tx) as any;
    const payin = await client.payin.findUnique({
      where: { id: payinId },
      select: {
        id: true,
        providerTxnId: true,
      },
    });

    if (!payin?.providerTxnId) {
      return null;
    }

    return client.inboundTransferSignal.findUnique({
      where: { id: payin.providerTxnId },
      select: {
        id: true,
        signalNo: true,
        simulationRiskLevel: true,
        simulationRiskReason: true,
      },
    });
  }

  private buildDepositSimulationProfile(input: {
    depositId: string;
    payinId: string;
    travelRuleRequired: boolean;
    inboundSignal?: {
      id?: string | null;
      signalNo?: string | null;
      simulationRiskLevel?: string | null;
      simulationRiskReason?: string | null;
    } | null;
  }) {
    const riskLevel = this.normalizeSimulationRiskLevel(
      input.inboundSignal?.simulationRiskLevel,
    );
    const riskReason = this.normalizeSimulationRiskReason(
      input.inboundSignal?.simulationRiskReason,
    );
    const effectiveTravelRuleRequired = input.travelRuleRequired;

    const base = {
      riskLevel,
      riskReason,
      effectiveTravelRuleRequired,
      simulationSignalId: input.inboundSignal?.id || null,
      simulationSignalNo: input.inboundSignal?.signalNo || null,
      providerCaseId: `MOCK-KYT-${input.payinId}`,
      providerTransferId: `MOCK-TRV-${input.payinId}`,
      checkedAt: new Date(),
      counterpartyVasp: effectiveTravelRuleRequired
        ? 'AUTO-FILLED-COUNTERPARTY-VASP'
        : null,
    } as const;

    return {
      ...base,
      kytStatus: 'FINAL',
      travelRuleStatus: 'FINAL',
      riskScore:
        riskLevel === 'HIGH' ? 52 : riskLevel === 'MEDIUM' ? 34 : 18,
    };
  }

  private deriveWithdrawComplianceStatusFromTransactionStatus(
    status?: string | null,
  ): 'PENDING' | 'CLEAR' | 'HOLD' | 'REJECT' {
    const current = String(status || '').trim().toUpperCase();

    if (current === WithdrawTransactionStatus.UNDER_REVIEW) {
      return 'HOLD';
    }

    if (current === WithdrawTransactionStatus.REJECTED) {
      return 'REJECT';
    }

    if (
      current === WithdrawTransactionStatus.PAYOUT_PENDING ||
      current === WithdrawTransactionStatus.SUCCESS ||
      current === WithdrawTransactionStatus.FAILED ||
      current === WithdrawTransactionStatus.RETURNED
    ) {
      return 'CLEAR';
    }

    return 'PENDING';
  }

  private deriveDepositComplianceStatusFromTransactionStatus(
    status?: string | null,
  ): 'PENDING' | 'CLEAR' | 'HOLD' | 'REJECT' {
    const current = String(status || '').trim().toUpperCase();

    if (
      current === DepositTransactionStatus.UNDER_REVIEW ||
      current === DepositTransactionStatus.FROZEN
    ) {
      return 'HOLD';
    }

    if (current === DepositTransactionStatus.REJECTED) {
      return 'REJECT';
    }

    if (current === DepositTransactionStatus.SUCCESS) {
      return 'CLEAR';
    }

    return 'PENDING';
  }

  private deriveWithdrawCompatibilitySnapshotFromTransactionStatus(
    status?: string | null,
  ): 'PENDING' | 'CLEAR' | 'UNDER_REVIEW' | 'REJECTED' {
    const current = String(status || '').trim().toUpperCase();

    if (current === WithdrawTransactionStatus.UNDER_REVIEW) {
      return 'UNDER_REVIEW';
    }

    if (current === WithdrawTransactionStatus.REJECTED) {
      return 'REJECTED';
    }

    if (
      current === WithdrawTransactionStatus.PAYOUT_PENDING ||
      current === WithdrawTransactionStatus.SUCCESS ||
      current === WithdrawTransactionStatus.FAILED ||
      current === WithdrawTransactionStatus.RETURNED
    ) {
      return 'CLEAR';
    }

    return 'PENDING';
  }

  private normalizeSourceType(raw: string): TxSourceType {
    const current = String(raw || '').toUpperCase();
    if (Object.values(TxSourceType).includes(current as TxSourceType)) {
      return current as TxSourceType;
    }
    throw new BadRequestException(`Unsupported sourceType: ${raw}`);
  }

  private clampReportPagination(input: {
    limit?: number;
    offset?: number;
  }): { limit: number; offset: number } {
    const rawLimit = Number.isFinite(input.limit) ? Number(input.limit) : 20;
    const rawOffset = Number.isFinite(input.offset) ? Number(input.offset) : 0;
    const limit = Math.max(1, Math.min(100, Math.trunc(rawLimit)));
    const offset = Math.max(0, Math.trunc(rawOffset));
    return { limit, offset };
  }

  private async maybeTriggerKytAlert(
    input: {
      caseId: string;
      caseNo: string;
      status: string;
      screeningStage: string;
      sourceType: string;
      sourceId: string;
      ownerType: string;
      ownerId?: string | null;
      ownerNo?: string | null;
      provider?: string;
      providerCaseId?: string | null;
      riskScore?: number | null;
      reportDeduped?: boolean;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const normalizedStatus = this.normalizeKytStatus(input.status);
    if (!normalizedStatus) {
      return;
    }
    if (input.reportDeduped) {
      return;
    }
    if (!this.transactionRiskBridgeService) {
      this.logger.debug(
        `Transaction risk bridge unavailable for KYT case ${input.caseId}; skip tx alert bridge`,
      );
      return;
    }
    const normalizedSourceType = this.normalizeSourceType(input.sourceType);
    if (
      normalizedSourceType !== TxSourceType.DEPOSIT &&
      normalizedSourceType !== TxSourceType.WITHDRAW
    ) {
      return;
    }

    // Withdraw response containers are evidence-only. They must not auto-drive
    // risk workflow transitions; the canonical manual simulation root is the
    // dedicated TX_WITHDRAW_FINAL decision record.
    if (normalizedSourceType === TxSourceType.WITHDRAW) {
      return;
    }

    const aggregate = await this.getTransactionCaseAggregate(
      input.sourceType,
      input.sourceId,
      {
        includeReports: false,
        includePayload: false,
        limit: 1,
        offset: 0,
      },
      tx,
    );
    await this.transactionRiskBridgeService.handleDepositFinalReviewIfReady(
      {
        depositId: input.sourceId,
        sourceType: TxSourceType.DEPOSIT,
        sourceId: input.sourceId,
        aggregate,
        triggerSource: 'KYT',
        triggerStatus: normalizedStatus,
        reportDeduped: input.reportDeduped,
      },
      tx,
    );
  }

  private async maybeTriggerTravelRuleAlert(
    input: {
      caseId: string;
      caseNo: string;
      status: string;
      required: boolean;
      sourceType: string;
      sourceId: string;
      ownerType: string;
      ownerId?: string | null;
      ownerNo?: string | null;
      provider?: string;
      providerTransferId?: string | null;
      counterpartyVasp?: string | null;
      reportDeduped?: boolean;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const normalizedStatus = this.normalizeTravelRuleStatus(
      input.status,
      input.required,
    );
    if (!normalizedStatus) {
      return;
    }
    if (input.reportDeduped) {
      return;
    }
    if (!this.transactionRiskBridgeService) {
      this.logger.debug(
        `Transaction risk bridge unavailable for travel rule case ${input.caseId}; skip tx alert bridge`,
      );
      return;
    }
    const normalizedSourceType = this.normalizeSourceType(input.sourceType);
    if (
      normalizedSourceType !== TxSourceType.DEPOSIT &&
      normalizedSourceType !== TxSourceType.WITHDRAW
    ) {
      return;
    }

    // Withdraw Travel Rule responses are evidence containers only. They do not
    // auto-trigger withdraw risk progression.
    if (normalizedSourceType === TxSourceType.WITHDRAW) {
      return;
    }

    const aggregate = await this.getTransactionCaseAggregate(
      input.sourceType,
      input.sourceId,
      {
        includeReports: false,
        includePayload: false,
        limit: 1,
        offset: 0,
      },
      tx,
    );
    await this.transactionRiskBridgeService.handleDepositFinalReviewIfReady(
      {
        depositId: input.sourceId,
        sourceType: TxSourceType.DEPOSIT,
        sourceId: input.sourceId,
        aggregate,
        triggerSource: 'TRAVEL_RULE',
        triggerStatus: normalizedStatus,
        reportDeduped: input.reportDeduped,
      },
      tx,
    );
  }

  private async resolveSourceContext(
    sourceType: TxSourceType,
    sourceId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<TxSourceContext> {
    const client = this.getClient(tx);

    switch (sourceType) {
      case TxSourceType.DEPOSIT: {
        const deposit = await client.depositTransaction.findUnique({
          where: { id: sourceId },
          select: {
            id: true,
            ownerType: true,
            ownerId: true,
            assetId: true,
          },
        });
        if (!deposit) {
          throw new NotFoundException(`Deposit ${sourceId} not found`);
        }
        return {
          sourceType,
          sourceId: deposit.id,
          ownerType: deposit.ownerType,
          ownerId: deposit.ownerId,
          assetId: deposit.assetId,
        };
      }
      case TxSourceType.WITHDRAW: {
        const withdraw = await client.withdrawTransaction.findUnique({
          where: { id: sourceId },
          select: {
            id: true,
            ownerType: true,
            ownerId: true,
            assetId: true,
          },
        });
        if (!withdraw) {
          throw new NotFoundException(`Withdraw ${sourceId} not found`);
        }
        return {
          sourceType,
          sourceId: withdraw.id,
          ownerType: withdraw.ownerType,
          ownerId: withdraw.ownerId,
          assetId: withdraw.assetId,
        };
      }
      default:
        throw new BadRequestException(
          `sourceType ${sourceType} requires explicit ownerType/ownerId/assetId for mock APIs`,
        );
    }
  }

  private resolveManualSourceContext(input: {
    sourceType: TxSourceType;
    sourceId: string;
    ownerType?: string;
    ownerId?: string;
    assetId?: string;
  }): TxSourceContext | null {
    if (!input.ownerType || !input.assetId) {
      return null;
    }

    return {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      ownerType: input.ownerType,
      ownerId: input.ownerId || null,
      assetId: input.assetId,
    };
  }

  private buildMockKytPayload(input: {
    sourceType: TxSourceType;
    sourceId: string;
    stage: KytScreeningStage;
    status: string;
    riskScore: number;
    providerCaseId: string;
  }) {
    return {
      provider: 'MOCK',
      providerCaseId: input.providerCaseId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      stage: input.stage,
      status: input.status,
      riskScore: input.riskScore,
      hits: [],
    };
  }

  private buildMockTravelPayload(input: {
    sourceType: TxSourceType;
    sourceId: string;
    status: string;
    required: boolean;
    providerTransferId: string;
    counterpartyVasp?: string | null;
  }) {
    return {
      provider: 'MOCK',
      providerTransferId: input.providerTransferId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      required: input.required,
      status: input.status,
      counterpartyVasp: input.counterpartyVasp || null,
    };
  }

  private buildKytReportSelect(includePayload: boolean) {
    return includePayload
      ? {
          id: true,
          sourceType: true,
          sourceId: true,
          screeningStage: true,
          provider: true,
          providerCaseId: true,
          rawPayload: true,
          normalizedPayload: true,
          receivedAt: true,
          createdAt: true,
        }
      : {
          id: true,
          sourceType: true,
          sourceId: true,
          screeningStage: true,
          provider: true,
          providerCaseId: true,
          receivedAt: true,
          createdAt: true,
        };
  }

  private buildTravelReportSelect(includePayload: boolean) {
    return includePayload
      ? {
          id: true,
          sourceType: true,
          sourceId: true,
          provider: true,
          providerTransferId: true,
          required: true,
          status: true,
          counterpartyVasp: true,
          rawPayload: true,
          normalizedPayload: true,
          receivedAt: true,
          createdAt: true,
        }
      : {
          id: true,
          sourceType: true,
          sourceId: true,
          provider: true,
          providerTransferId: true,
          required: true,
          status: true,
          counterpartyVasp: true,
          receivedAt: true,
          createdAt: true,
        };
  }

  private async getTransactionSourceSummary(
    sourceType: TxSourceType,
    sourceId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = this.getClient(tx) as any;

    if (sourceType === TxSourceType.DEPOSIT) {
      const deposit = await client.depositTransaction.findUnique({
        where: { id: sourceId },
        select: {
          id: true,
          depositNo: true,
          ownerType: true,
          ownerId: true,
          customer: {
            select: {
              customerNo: true,
            },
          },
        },
      });
      if (!deposit) {
        throw new NotFoundException(`Deposit ${sourceId} not found`);
      }
      return {
        sourceType,
        sourceId: deposit.id,
        sourceNo: deposit.depositNo,
        ownerType: deposit.ownerType,
        ownerId: deposit.ownerId,
        ownerNo: deposit.customer?.customerNo || null,
        customerId: deposit.ownerId,
        customerNo: deposit.customer?.customerNo || null,
      };
    }

    if (sourceType === TxSourceType.WITHDRAW) {
      const withdraw = await client.withdrawTransaction.findUnique({
        where: { id: sourceId },
        select: {
          id: true,
          withdrawNo: true,
          ownerType: true,
          ownerId: true,
          ownerNo: true,
          customer: {
            select: {
              customerNo: true,
            },
          },
        },
      });
      if (!withdraw) {
        throw new NotFoundException(`Withdraw ${sourceId} not found`);
      }
      return {
        sourceType,
        sourceId: withdraw.id,
        sourceNo: withdraw.withdrawNo,
        ownerType: withdraw.ownerType,
        ownerId: withdraw.ownerId,
        ownerNo: withdraw.ownerNo || withdraw.customer?.customerNo || null,
        customerId: withdraw.ownerId,
        customerNo: withdraw.customer?.customerNo || null,
      };
    }

    return {
      sourceType,
      sourceId,
      sourceNo: sourceId,
      ownerType: null,
      ownerId: null,
      ownerNo: null,
      customerId: null,
      customerNo: null,
    };
  }

  async listKytCases(query: TxCaseListQueryDto) {
    const where: Prisma.KytCaseWhereInput = {};
    if (query.sourceType) where.sourceType = query.sourceType;
    if (query.sourceId) where.sourceId = query.sourceId;
    if (query.status) {
      const statusFilter = this.expandLifecycleStatusFilter(
        query.status,
        'KYT',
      );
      if (statusFilter) {
        where.status = { in: statusFilter };
      }
    }
    if (query.provider) where.provider = query.provider;
    if (query.screeningStage) where.screeningStage = query.screeningStage;

    const skip = query.skip ?? 0;
    const take = query.take ?? 20;

    const [items, total] = await Promise.all([
      this.prisma.kytCase.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.kytCase.count({ where }),
    ]);

    return {
      items: items.map((item) => this.normalizeKytCaseForRead(item)),
      total,
    };
  }

  async listTravelRuleCases(query: TxCaseListQueryDto) {
    const where: Prisma.TravelRuleCaseWhereInput = {};
    if (query.sourceType) where.sourceType = query.sourceType;
    if (query.sourceId) where.sourceId = query.sourceId;
    if (query.status) {
      const statusFilter = this.expandLifecycleStatusFilter(
        query.status,
        'TRAVEL_RULE',
      );
      if (statusFilter) {
        where.status = { in: statusFilter };
      }
    }
    if (query.provider) where.provider = query.provider;

    const skip = query.skip ?? 0;
    const take = query.take ?? 20;

    const [items, total] = await Promise.all([
      this.prisma.travelRuleCase.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.travelRuleCase.count({ where }),
    ]);

    return {
      items: items.map((item) => this.normalizeTravelRuleCaseForRead(item)),
      total,
    };
  }

  async getKytCaseDetail(
    id: string,
    options?: {
      includeReports?: boolean;
      includePayload?: boolean;
      limit?: number;
      offset?: number;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const includeReports = options?.includeReports !== false;
    const includePayload = options?.includePayload === true;
    const { limit, offset } = this.clampReportPagination({
      limit: options?.limit,
      offset: options?.offset,
    });

    const record = await (this.getClient(tx) as any).kytCase.findUnique({
      where: { id },
      include: includeReports
        ? {
            reports: {
              orderBy: { receivedAt: 'desc' },
              skip: offset,
              take: limit,
              select: this.buildKytReportSelect(includePayload),
            },
          }
        : undefined,
    });

    if (!record) {
      throw new NotFoundException(`KYT case not found: ${id}`);
    }

    const aggregate = await this.getTransactionCaseAggregate(
      record.sourceType,
      record.sourceId,
      {
        includeReports: false,
        includePayload: false,
        limit: 1,
        offset: 0,
      },
      tx,
    );
    const sourceSummary = await this.getTransactionSourceSummary(
      record.sourceType,
      record.sourceId,
      tx,
    );

    const normalizedRecord = this.normalizeKytCaseForRead(record);

    return {
      ...normalizedRecord,
      sourceSummary: {
        ...sourceSummary,
        derivedComplianceStatus: aggregate.derivedComplianceStatus,
      },
      derivedComplianceStatus: aggregate.derivedComplianceStatus,
    };
  }

  async getTravelRuleCaseDetail(
    id: string,
    options?: {
      includeReports?: boolean;
      includePayload?: boolean;
      limit?: number;
      offset?: number;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const includeReports = options?.includeReports !== false;
    const includePayload = options?.includePayload === true;
    const { limit, offset } = this.clampReportPagination({
      limit: options?.limit,
      offset: options?.offset,
    });

    const record = await (this.getClient(tx) as any).travelRuleCase.findUnique({
      where: { id },
      include: includeReports
        ? {
            reports: {
              orderBy: { receivedAt: 'desc' },
              skip: offset,
              take: limit,
              select: this.buildTravelReportSelect(includePayload),
            },
          }
        : undefined,
    });

    if (!record) {
      throw new NotFoundException(`Travel Rule case not found: ${id}`);
    }

    const aggregate = await this.getTransactionCaseAggregate(
      record.sourceType,
      record.sourceId,
      {
        includeReports: false,
        includePayload: false,
        limit: 1,
        offset: 0,
      },
      tx,
    );
    const sourceSummary = await this.getTransactionSourceSummary(
      record.sourceType,
      record.sourceId,
      tx,
    );

    const normalizedRecord = this.normalizeTravelRuleCaseForRead(record);

    return {
      ...normalizedRecord,
      sourceSummary: {
        ...sourceSummary,
        derivedComplianceStatus: aggregate.derivedComplianceStatus,
      },
      derivedComplianceStatus: aggregate.derivedComplianceStatus,
    };
  }

  async callbackKytCase(
    dto: TxKytCaseCallbackDto,
    tx?: Prisma.TransactionClient,
  ) {
    const sourceType = this.normalizeSourceType(dto.sourceType);
    const sourceContext =
      this.resolveManualSourceContext({
        sourceType,
        sourceId: dto.sourceId,
        ownerType: dto.ownerType,
        ownerId: dto.ownerId,
        assetId: dto.assetId,
      }) ||
      (await this.resolveSourceContext(sourceType, dto.sourceId, tx));
    const screeningStage = dto.screeningStage ?? KytScreeningStage.MAIN;
    const checkedAt = dto.checkedAt ? new Date(dto.checkedAt) : new Date();
    const normalizedStatus = this.normalizeKytStatus(dto.status);

    const upserted = await this.upsertKytCaseAndAppendReport(
      {
        ...sourceContext,
        screeningStage,
        provider: dto.provider || 'EXTERNAL',
        providerCaseId: dto.providerCaseId,
        status: normalizedStatus,
        riskScore: dto.riskScore ?? null,
        checkedAt,
        rawPayload: dto.rawPayload || {
          providerCaseId: dto.providerCaseId,
          sourceType,
          sourceId: dto.sourceId,
          screeningStage,
          status: normalizedStatus,
          riskScore: dto.riskScore ?? null,
          checkedAt: checkedAt.toISOString(),
        },
        normalizedPayload: dto.normalizedPayload || {
          status: normalizedStatus,
          riskScore: dto.riskScore ?? null,
          checkedAt: checkedAt.toISOString(),
        },
      },
      tx,
      { dedupeReport: true },
    );

    if (sourceType === TxSourceType.DEPOSIT) {
      await this.syncDepositSnapshotFromCases(dto.sourceId, tx);
    } else if (sourceType === TxSourceType.WITHDRAW) {
      await this.syncWithdrawSnapshotFromCases(dto.sourceId, tx);
    }

    const aggregate = await this.getTransactionCaseAggregate(
      sourceType,
      dto.sourceId,
      {
        includeReports: true,
        includePayload: true,
        limit: 20,
        offset: 0,
      },
      tx,
    );

    return {
      callbackAccepted: true,
      caseId: upserted.case.id,
      reportId: upserted.report?.id || null,
      reportDeduped: upserted.reportDeduped,
      ...aggregate,
    };
  }

  async callbackTravelRuleCase(
    dto: TxTravelRuleCaseCallbackDto,
    tx?: Prisma.TransactionClient,
  ) {
    const sourceType = this.normalizeSourceType(dto.sourceType);
    const sourceContext =
      this.resolveManualSourceContext({
        sourceType,
        sourceId: dto.sourceId,
        ownerType: dto.ownerType,
        ownerId: dto.ownerId,
        assetId: dto.assetId,
      }) ||
      (await this.resolveSourceContext(sourceType, dto.sourceId, tx));
    const checkedAt = dto.checkedAt ? new Date(dto.checkedAt) : new Date();
    const required = dto.required ?? false;
    const normalizedStatus = this.normalizeTravelRuleStatus(dto.status, required);

    const upserted = await this.upsertTravelRuleCaseAndAppendReport(
      {
        ...sourceContext,
        provider: dto.provider || 'EXTERNAL',
        providerTransferId: dto.providerTransferId,
        required,
        status: normalizedStatus,
        counterpartyVasp: dto.counterpartyVasp || null,
        checkedAt,
        rawPayload: dto.rawPayload || {
          providerTransferId: dto.providerTransferId,
          sourceType,
          sourceId: dto.sourceId,
          required,
          status: normalizedStatus,
          counterpartyVasp: dto.counterpartyVasp || null,
          checkedAt: checkedAt.toISOString(),
        },
        normalizedPayload: dto.normalizedPayload || {
          required,
          status: normalizedStatus,
          counterpartyVasp: dto.counterpartyVasp || null,
          checkedAt: checkedAt.toISOString(),
        },
      },
      tx,
      { dedupeReport: true },
    );

    if (sourceType === TxSourceType.DEPOSIT) {
      await this.syncDepositSnapshotFromCases(dto.sourceId, tx);
    } else if (sourceType === TxSourceType.WITHDRAW) {
      await this.syncWithdrawSnapshotFromCases(dto.sourceId, tx);
    }

    const aggregate = await this.getTransactionCaseAggregate(
      sourceType,
      dto.sourceId,
      {
        includeReports: true,
        includePayload: true,
        limit: 20,
        offset: 0,
      },
      tx,
    );

    return {
      callbackAccepted: true,
      caseId: upserted.case.id,
      reportId: upserted.report?.id || null,
      reportDeduped: upserted.reportDeduped,
      ...aggregate,
    };
  }

  async getTransactionCaseAggregate(
    sourceTypeInput: TxSourceType | string,
    sourceId: string,
    options?: {
      includeReports?: boolean;
      includePayload?: boolean;
      limit?: number;
      offset?: number;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const sourceType = this.normalizeSourceType(sourceTypeInput as string);
    const client = this.getClient(tx) as any;
    const includeReports = options?.includeReports !== false;
    const includePayload = options?.includePayload === true;
    const { limit, offset } = this.clampReportPagination({
      limit: options?.limit,
      offset: options?.offset,
    });

    const kytReportSelect = includePayload
      ? {
          id: true,
          sourceType: true,
          sourceId: true,
          screeningStage: true,
          provider: true,
          providerCaseId: true,
          rawPayload: true,
          normalizedPayload: true,
          receivedAt: true,
          createdAt: true,
        }
      : {
          id: true,
          sourceType: true,
          sourceId: true,
          screeningStage: true,
          provider: true,
          providerCaseId: true,
          receivedAt: true,
          createdAt: true,
        };

    const travelReportSelect = includePayload
      ? {
          id: true,
          sourceType: true,
          sourceId: true,
          provider: true,
          providerTransferId: true,
          required: true,
          status: true,
          counterpartyVasp: true,
          rawPayload: true,
          normalizedPayload: true,
          receivedAt: true,
          createdAt: true,
        }
      : {
          id: true,
          sourceType: true,
          sourceId: true,
          provider: true,
          providerTransferId: true,
          required: true,
          status: true,
          counterpartyVasp: true,
          receivedAt: true,
          createdAt: true,
        };

    const kytInclude = includeReports
      ? {
          reports: {
            orderBy: { receivedAt: 'desc' },
            skip: offset,
            take: limit,
            select: kytReportSelect,
          },
        }
      : undefined;

    const travelInclude = includeReports
      ? {
          reports: {
            orderBy: { receivedAt: 'desc' },
            skip: offset,
            take: limit,
            select: travelReportSelect,
          },
        }
      : undefined;

    const [
      preKytCase,
      mainKytCase,
      travelRuleCase,
      withdrawSummary,
      depositSummary,
    ] = await Promise.all([
      sourceType === TxSourceType.WITHDRAW
        ? client.kytCase.findUnique({
            where: {
              sourceType_sourceId_screeningStage: {
                sourceType,
                sourceId,
                screeningStage: KytScreeningStage.PRE_TXN,
              },
            },
            include: kytInclude,
          })
        : Promise.resolve(null),
      client.kytCase.findUnique({
        where: {
          sourceType_sourceId_screeningStage: {
            sourceType,
            sourceId,
            screeningStage: KytScreeningStage.MAIN,
          },
        },
        include: kytInclude,
      }),
      client.travelRuleCase.findUnique({
        where: {
          sourceType_sourceId: {
            sourceType,
            sourceId,
          },
        },
        include: travelInclude,
      }),
      sourceType === TxSourceType.WITHDRAW
        ? client.withdrawTransaction.findUnique({
            where: { id: sourceId },
            select: {
              status: true,
            },
          })
        : Promise.resolve(null),
      sourceType === TxSourceType.DEPOSIT
        ? client.depositTransaction.findUnique({
            where: { id: sourceId },
            select: {
              status: true,
            },
          })
        : Promise.resolve(null),
    ]);

    const normalizedPreKytCase = this.normalizeKytCaseForRead(preKytCase);
    const normalizedMainKytCase = this.normalizeKytCaseForRead(mainKytCase);
    const normalizedTravelRuleCase =
      this.normalizeTravelRuleCaseForRead(travelRuleCase);

    const derivedComplianceStatus =
      sourceType === TxSourceType.WITHDRAW
        ? this.deriveWithdrawComplianceStatusFromTransactionStatus(
            withdrawSummary?.status,
          )
        : this.deriveDepositComplianceStatusFromTransactionStatus(
            depositSummary?.status,
          );

    return {
      sourceType,
      sourceId,
      preKytCase: normalizedPreKytCase || null,
      mainKytCase: normalizedMainKytCase || null,
      travelRuleCase: normalizedTravelRuleCase || null,
      derivedComplianceStatus,
    };
  }

  async upsertKytCaseAndAppendReport(
    input: UpsertKytCaseInput,
    tx?: Prisma.TransactionClient,
    options?: {
      dedupeReport?: boolean;
    },
  ) {
    if (!input.assetId) {
      throw new BadRequestException('assetId is required for KYT case');
    }

    const client = this.getClient(tx);
    const provider = input.provider || 'MOCK';
    const status = this.normalizeKytStatus(input.status);
    const checkedAt = input.checkedAt ?? new Date();
    const providerCaseId = input.providerCaseId || null;
    const rawPayload = this.serializePayload(input.rawPayload);
    const normalizedPayload = this.serializePayload(input.normalizedPayload);
    const existed = await client.kytCase.findUnique({
      where: {
        sourceType_sourceId_screeningStage: {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          screeningStage: input.screeningStage,
        },
      },
      select: {
        id: true,
        caseNo: true,
        status: true,
      },
    });

    const record = await client.kytCase.upsert({
      where: {
        sourceType_sourceId_screeningStage: {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          screeningStage: input.screeningStage,
        },
      },
      create: {
        caseNo: this.generateCaseNo('KYT'),
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        screeningStage: input.screeningStage,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        assetId: input.assetId,
        provider,
        providerCaseId,
        status,
        riskScore: input.riskScore ?? null,
        checkedAt,
        latestRawPayload: rawPayload,
        latestNormalizedPayload: normalizedPayload,
      },
      update: {
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        assetId: input.assetId,
        provider,
        providerCaseId,
        status,
        riskScore: input.riskScore ?? null,
        checkedAt,
        latestRawPayload: rawPayload,
        latestNormalizedPayload: normalizedPayload,
      },
    });

    let dedupedReport = null;
    if (options?.dedupeReport) {
      dedupedReport = await client.kytCaseReport.findFirst({
        where: {
          kytCaseId: record.id,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          screeningStage: input.screeningStage,
          provider,
          providerCaseId,
          rawPayload,
          normalizedPayload,
        },
        orderBy: { receivedAt: 'desc' },
      });
    }

    const report =
      dedupedReport ||
      (await client.kytCaseReport.create({
        data: {
          kytCaseId: record.id,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          screeningStage: input.screeningStage,
          provider,
          providerCaseId,
          rawPayload,
          normalizedPayload,
          receivedAt: checkedAt,
        },
      }));

    await this.auditLogsService.recordSystem(
      {
        triggerType: existed
          ? AuditTriggerType.DATA_UPDATE
          : AuditTriggerType.DATA_CREATE,
        action: existed
          ? AuditActions.KYT_CASE_UPDATED
          : AuditActions.KYT_CASE_CREATED,
        module: AuditModules.TRANSACTION_COMPLIANCE,
        entityType: AuditEntityTypes.KYT_CASE,
        entityId: record.id,
        entityNo: record.caseNo,
        entityOwnerType: record.ownerType,
        entityOwnerId: record.ownerId || undefined,
        reason: existed
          ? 'KYT case updated by compliance flow'
          : 'KYT case created by compliance flow',
        beforeData: existed
          ? {
              status: existed.status,
            }
          : undefined,
        afterData: {
          status: record.status,
          screeningStage: record.screeningStage,
          provider: record.provider,
          providerCaseId: record.providerCaseId,
        },
        metadata: {
          sourceType: record.sourceType,
          sourceId: record.sourceId,
          reportId: report.id,
          createdNew: !existed,
        },
        sourcePlatform: tx ? 'SYSTEM_TX' : 'SYSTEM',
      },
      tx,
    );

    await this.maybeTriggerKytAlert(
      {
        caseId: record.id,
        caseNo: record.caseNo,
        status: record.status,
        screeningStage: record.screeningStage,
        sourceType: record.sourceType,
        sourceId: record.sourceId,
        ownerType: record.ownerType,
        ownerId: record.ownerId,
        provider: record.provider,
        providerCaseId: record.providerCaseId,
        riskScore: record.riskScore,
        reportDeduped: !!dedupedReport,
      },
      tx,
    );

    return { case: record, report, reportDeduped: !!dedupedReport };
  }

  async upsertTravelRuleCaseAndAppendReport(
    input: UpsertTravelRuleCaseInput,
    tx?: Prisma.TransactionClient,
    options?: {
      dedupeReport?: boolean;
    },
  ) {
    if (!input.assetId) {
      throw new BadRequestException('assetId is required for Travel Rule case');
    }

    const client = this.getClient(tx);
    const provider = input.provider || 'MOCK';
    const required = input.required ?? false;
    const status = this.normalizeTravelRuleStatus(input.status, required);
    const checkedAt = input.checkedAt ?? new Date();
    const providerTransferId = input.providerTransferId || null;
    const rawPayload = this.serializePayload(input.rawPayload);
    const normalizedPayload = this.serializePayload(input.normalizedPayload);
    const existed = await client.travelRuleCase.findUnique({
      where: {
        sourceType_sourceId: {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
        },
      },
      select: {
        id: true,
        caseNo: true,
        status: true,
      },
    });

    const record = await client.travelRuleCase.upsert({
      where: {
        sourceType_sourceId: {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
        },
      },
      create: {
        caseNo: this.generateCaseNo('TRV'),
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        assetId: input.assetId,
        provider,
        providerTransferId,
        required,
        status,
        counterpartyVasp: input.counterpartyVasp || null,
        checkedAt,
        latestRawPayload: rawPayload,
        latestNormalizedPayload: normalizedPayload,
      },
      update: {
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        assetId: input.assetId,
        provider,
        providerTransferId,
        required,
        status,
        counterpartyVasp: input.counterpartyVasp || null,
        checkedAt,
        latestRawPayload: rawPayload,
        latestNormalizedPayload: normalizedPayload,
      },
    });

    let dedupedReport = null;
    if (options?.dedupeReport) {
      dedupedReport = await client.travelRuleCaseReport.findFirst({
        where: {
          travelRuleCaseId: record.id,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          provider,
          providerTransferId,
          status,
          required,
          counterpartyVasp: input.counterpartyVasp || null,
          rawPayload,
          normalizedPayload,
        },
        orderBy: { receivedAt: 'desc' },
      });
    }

    const report =
      dedupedReport ||
      (await client.travelRuleCaseReport.create({
        data: {
          travelRuleCaseId: record.id,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          provider,
          providerTransferId,
          required,
          status,
          counterpartyVasp: input.counterpartyVasp || null,
          rawPayload,
          normalizedPayload,
          receivedAt: checkedAt,
        },
      }));

    await this.auditLogsService.recordSystem(
      {
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: AuditActions.TRAVEL_RULE_UPDATED,
        module: AuditModules.TRANSACTION_COMPLIANCE,
        entityType: AuditEntityTypes.TRAVEL_RULE_CASE,
        entityId: record.id,
        entityNo: record.caseNo,
        entityOwnerType: record.ownerType,
        entityOwnerId: record.ownerId || undefined,
        reason: existed
          ? 'Travel Rule case updated by compliance flow'
          : 'Travel Rule case created by compliance flow',
        beforeData: existed
          ? {
              status: existed.status,
            }
          : undefined,
        afterData: {
          status: record.status,
          provider: record.provider,
          providerTransferId: record.providerTransferId,
          required: record.required,
        },
        metadata: {
          sourceType: record.sourceType,
          sourceId: record.sourceId,
          reportId: report.id,
          createdNew: !existed,
        },
        sourcePlatform: tx ? 'SYSTEM_TX' : 'SYSTEM',
      },
      tx,
    );

    await this.maybeTriggerTravelRuleAlert(
      {
        caseId: record.id,
        caseNo: record.caseNo,
        status: record.status,
        required: record.required,
        sourceType: record.sourceType,
        sourceId: record.sourceId,
        ownerType: record.ownerType,
        ownerId: record.ownerId,
        provider: record.provider,
        providerTransferId: record.providerTransferId,
        counterpartyVasp: record.counterpartyVasp,
        reportDeduped: !!dedupedReport,
      },
      tx,
    );

    return { case: record, report, reportDeduped: !!dedupedReport };
  }

  async syncDepositSnapshotFromCases(
    depositId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = this.getClient(tx);

    const [kytCase, travelCase] = await Promise.all([
      client.kytCase.findUnique({
        where: {
          sourceType_sourceId_screeningStage: {
            sourceType: TxSourceType.DEPOSIT,
            sourceId: depositId,
            screeningStage: KytScreeningStage.MAIN,
          },
        },
      }),
      client.travelRuleCase.findUnique({
        where: {
          sourceType_sourceId: {
            sourceType: TxSourceType.DEPOSIT,
            sourceId: depositId,
          },
        },
      }),
    ]);

    if (!kytCase && !travelCase) {
      return null;
    }

    const data: Prisma.DepositTransactionUpdateInput = {};

    if (kytCase) {
      data.kytStatus = this.normalizeKytStatus(kytCase.status);
      data.kytScreeningId = kytCase.providerCaseId || kytCase.id;
      data.kytRiskScore = kytCase.riskScore;
      data.kytCheckedAt = kytCase.checkedAt;
    }

    if (travelCase) {
      data.travelRuleRequired = travelCase.required;
      data.travelRuleStatus = this.normalizeTravelRuleStatus(
        travelCase.status,
        travelCase.required,
      );
      data.travelRuleTransferId =
        travelCase.providerTransferId || travelCase.id;
      data.counterpartyVasp = travelCase.counterpartyVasp;
      data.travelRuleCheckedAt = travelCase.checkedAt;
    }

    return client.depositTransaction.update({
      where: { id: depositId },
      data,
    });
  }

  async syncWithdrawSnapshotFromCases(
    withdrawId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = this.getClient(tx);

    const [withdrawal, preKytCase, mainKytCase, travelCase] = await Promise.all([
      client.withdrawTransaction.findUnique({
        where: { id: withdrawId },
        select: {
          status: true,
        },
      }),
      client.kytCase.findUnique({
        where: {
          sourceType_sourceId_screeningStage: {
            sourceType: TxSourceType.WITHDRAW,
            sourceId: withdrawId,
            screeningStage: KytScreeningStage.PRE_TXN,
          },
        },
      }),
      client.kytCase.findUnique({
        where: {
          sourceType_sourceId_screeningStage: {
            sourceType: TxSourceType.WITHDRAW,
            sourceId: withdrawId,
            screeningStage: KytScreeningStage.MAIN,
          },
        },
      }),
      client.travelRuleCase.findUnique({
        where: {
          sourceType_sourceId: {
            sourceType: TxSourceType.WITHDRAW,
            sourceId: withdrawId,
          },
        },
      }),
    ]);

    if (!withdrawal) {
      throw new NotFoundException(`Withdraw ${withdrawId} not found`);
    }

    if (!preKytCase && !mainKytCase && !travelCase) {
      return null;
    }

    const data: Prisma.WithdrawTransactionUpdateInput = {
      preKytStatus: preKytCase
        ? this.normalizeKytStatus(preKytCase.status)
        : undefined,
      kytStatus: mainKytCase
        ? this.normalizeKytStatus(mainKytCase.status)
        : '',
      travelRuleRequired: travelCase?.required ?? undefined,
      travelRuleStatus: travelCase
        ? this.normalizeTravelRuleStatus(travelCase.status, travelCase.required)
        : undefined,
      complianceStatus:
        this.deriveWithdrawCompatibilitySnapshotFromTransactionStatus(
          withdrawal.status,
        ),
    };

    if (preKytCase) {
      data.preKytId = preKytCase.providerCaseId || preKytCase.id;
      data.preKytRiskScore = preKytCase.riskScore;
      data.preKytCheckedAt = preKytCase.checkedAt;
    }

    if (mainKytCase) {
      data.kytScreeningId = mainKytCase.providerCaseId || mainKytCase.id;
      data.kytRiskScore = mainKytCase.riskScore;
      data.kytCheckedAt = mainKytCase.checkedAt;
    }

    if (travelCase) {
      data.travelRuleTransferId =
        travelCase.providerTransferId || travelCase.id;
      data.travelRuleCheckedAt = travelCase.checkedAt;
      data.counterpartyVasp = travelCase.counterpartyVasp;
    }

    return client.withdrawTransaction.update({
      where: { id: withdrawId },
      data,
    });
  }

  async ensureWithdrawPreKytCaseOnCreate(
    withdrawId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = this.getClient(tx);
    const withdrawal = await client.withdrawTransaction.findUnique({
      where: { id: withdrawId },
      select: {
        id: true,
        ownerType: true,
        ownerId: true,
        assetId: true,
        travelRuleRequired: true,
        toAddress: true,
        toIban: true,
        asset: {
          select: {
            type: true,
            code: true,
            network: true,
          },
        },
      },
    });

    if (!withdrawal) {
      throw new NotFoundException(`Withdraw ${withdrawId} not found`);
    }

    if (!this.isCryptoAssetType(withdrawal.asset?.type)) {
      return null;
    }

    const checkedAt = new Date();
    const travelRuleRequired = true;

    await this.upsertKytCaseAndAppendReport(
      {
        sourceType: TxSourceType.WITHDRAW,
        sourceId: withdrawal.id,
        screeningStage: KytScreeningStage.PRE_TXN,
        ownerType: withdrawal.ownerType,
        ownerId: withdrawal.ownerId,
        assetId: withdrawal.assetId,
        provider: 'SYSTEM',
        providerCaseId: `WITHDRAW-PRE-KYT-${withdrawal.id}`,
        status: 'FINAL',
        checkedAt,
        rawPayload: {
          lifecycle: 'FINAL',
          triggerEntityType: 'WITHDRAW',
          triggerEntityId: withdrawal.id,
          triggerStatus: 'PENDING_COMPLIANCE',
          assetCode: withdrawal.asset?.code || null,
          assetNetwork: withdrawal.asset?.network || null,
          destinationAddress: withdrawal.toAddress || null,
          destinationIban: withdrawal.toIban || null,
        },
        normalizedPayload: {
          lifecycle: 'FINAL',
          triggerEntityType: 'WITHDRAW',
          triggerEntityId: withdrawal.id,
          triggerStatus: 'PENDING_COMPLIANCE',
        },
      },
      tx,
    );

    await this.upsertTravelRuleCaseAndAppendReport(
      {
        sourceType: TxSourceType.WITHDRAW,
        sourceId: withdrawal.id,
        ownerType: withdrawal.ownerType,
        ownerId: withdrawal.ownerId,
        assetId: withdrawal.assetId,
        provider: 'SYSTEM',
        providerTransferId: `WITHDRAW-TRAVEL-${withdrawal.id}`,
        required: travelRuleRequired,
        status: 'FINAL',
        counterpartyVasp: null,
        checkedAt,
        rawPayload: {
          lifecycle: 'FINAL',
          triggerEntityType: 'WITHDRAW',
          triggerEntityId: withdrawal.id,
          triggerStatus: 'PENDING_COMPLIANCE',
          assetCode: withdrawal.asset?.code || null,
          assetNetwork: withdrawal.asset?.network || null,
          destinationAddress: withdrawal.toAddress || null,
          destinationIban: withdrawal.toIban || null,
          required: travelRuleRequired,
        },
        normalizedPayload: {
          lifecycle: 'FINAL',
          triggerEntityType: 'WITHDRAW',
          triggerEntityId: withdrawal.id,
          triggerStatus: 'PENDING_COMPLIANCE',
          required: travelRuleRequired,
        },
      },
      tx,
    );

    return this.syncWithdrawSnapshotFromCases(withdrawal.id, tx);
  }

  async ensureDepositMainCasesOnPayinConfirmed(
    depositId: string,
    payinId: string,
    tx?: Prisma.TransactionClient,
  ) {
    return this.ensureDepositMainCasesOnPayinConfirmedByMode(
      depositId,
      payinId,
      null,
      tx,
    );
  }

  async ensureInteractiveDepositMainCasesOnPayinConfirmed(
    depositId: string,
    payinId: string,
    tx?: Prisma.TransactionClient,
  ) {
    return this.ensureDepositMainCasesOnPayinConfirmedByMode(
      depositId,
      payinId,
      PayinSimulationMode.INTERACTIVE,
      tx,
    );
  }

  private async ensureDepositMainCasesOnPayinConfirmedByMode(
    depositId: string,
    payinId: string,
    simulationMode: PayinSimulationMode | null,
    tx?: Prisma.TransactionClient,
  ) {
    const client = this.getClient(tx);
    const deposit = await client.depositTransaction.findUnique({
      where: { id: depositId },
      select: {
        id: true,
        ownerType: true,
        ownerId: true,
        assetId: true,
        travelRuleRequired: true,
        asset: {
          select: {
            type: true,
          },
        },
      },
    });

    if (!deposit) {
      throw new NotFoundException(`Deposit ${depositId} not found`);
    }

    if (!this.isCryptoAssetType(deposit.asset?.type)) {
      if (!this.transactionRiskBridgeService) {
        this.logger.debug(
          `Transaction risk bridge unavailable for fiat deposit ${deposit.id}; skip direct final review`,
        );
        return null;
      }

      return this.transactionRiskBridgeService.handleDirectDepositFinalReview(
        {
          depositId: deposit.id,
          sourceType: TxSourceType.DEPOSIT,
          sourceId: deposit.id,
          triggerStatus: 'PAYIN_CONFIRMED',
          kytStatus: 'FINAL',
          travelRuleRequired: false,
          travelRuleStatus: 'FINAL',
        },
        tx,
      );
    }

    const providerMode = this.getProviderMode();
    const provider = providerMode === 'MOCK' ? 'MOCK' : 'MANUAL';
    const inboundSignal = await this.resolveInboundSignalForPayin(payinId, tx);
    const simulation = this.buildDepositSimulationProfile({
      depositId: deposit.id,
      payinId,
      travelRuleRequired: deposit.travelRuleRequired,
      inboundSignal,
    });

    await this.upsertKytCaseAndAppendReport(
      {
        sourceType: TxSourceType.DEPOSIT,
        sourceId: deposit.id,
        screeningStage: KytScreeningStage.MAIN,
        ownerType: deposit.ownerType,
        ownerId: deposit.ownerId,
        assetId: deposit.assetId,
        provider,
        providerCaseId: simulation.providerCaseId,
        status: simulation.kytStatus,
        riskScore: simulation.riskScore,
        checkedAt: simulation.checkedAt,
        rawPayload: {
          ...this.buildMockKytPayload({
            sourceType: TxSourceType.DEPOSIT,
            sourceId: deposit.id,
            stage: KytScreeningStage.MAIN,
            status: simulation.kytStatus,
            riskScore: simulation.riskScore,
            providerCaseId: simulation.providerCaseId,
          }),
          provider,
          source: simulationMode === PayinSimulationMode.INTERACTIVE
            ? 'interactive-auto-filled'
            : 'confirmed-auto-filled',
          triggerEntityType: 'PAYIN',
          triggerEntityId: payinId,
          triggerStatus: 'CONFIRMED',
          simulationSignalId: simulation.simulationSignalId,
          simulationSignalNo: simulation.simulationSignalNo,
          finalRiskExecutionMode: 'MANUAL',
        },
        normalizedPayload: {
          status: simulation.kytStatus,
          riskScore: simulation.riskScore,
          triggerEntityType: 'PAYIN',
          triggerEntityId: payinId,
          triggerStatus: 'CONFIRMED',
          simulationSignalId: simulation.simulationSignalId,
          simulationSignalNo: simulation.simulationSignalNo,
          finalRiskExecutionMode: 'MANUAL',
        },
      },
      tx,
    );

    await this.upsertTravelRuleCaseAndAppendReport(
      {
        sourceType: TxSourceType.DEPOSIT,
        sourceId: deposit.id,
        ownerType: deposit.ownerType,
        ownerId: deposit.ownerId,
        assetId: deposit.assetId,
        provider,
        providerTransferId: simulation.providerTransferId,
        required: simulation.effectiveTravelRuleRequired,
        status: simulation.travelRuleStatus,
        checkedAt: simulation.checkedAt,
        rawPayload: {
          ...this.buildMockTravelPayload({
            sourceType: TxSourceType.DEPOSIT,
            sourceId: deposit.id,
            status: simulation.travelRuleStatus,
            required: simulation.effectiveTravelRuleRequired,
            providerTransferId: simulation.providerTransferId,
            counterpartyVasp: simulation.counterpartyVasp,
          }),
          provider,
          source: simulationMode === PayinSimulationMode.INTERACTIVE
            ? 'interactive-auto-filled'
            : 'confirmed-auto-filled',
          triggerEntityType: 'PAYIN',
          triggerEntityId: payinId,
          triggerStatus: 'CONFIRMED',
          simulationSignalId: simulation.simulationSignalId,
          simulationSignalNo: simulation.simulationSignalNo,
          finalRiskExecutionMode: 'MANUAL',
        },
        normalizedPayload: {
          required: simulation.effectiveTravelRuleRequired,
          status: simulation.travelRuleStatus,
          triggerEntityType: 'PAYIN',
          triggerEntityId: payinId,
          triggerStatus: 'CONFIRMED',
          counterpartyVasp: simulation.counterpartyVasp,
          simulationSignalId: simulation.simulationSignalId,
          simulationSignalNo: simulation.simulationSignalNo,
          finalRiskExecutionMode: 'MANUAL',
        },
      },
      tx,
    );

    return this.syncDepositSnapshotFromCases(deposit.id, tx);
  }

  async ensureWithdrawMainCasesBeforePayoutDispatch(
    withdrawId: string,
    payoutId: string,
    dispatchAction = 'DISPATCH_START',
    tx?: Prisma.TransactionClient,
  ) {
    this.logger.debug(
      `Skip legacy withdraw dispatch response generation for ${withdrawId} on ${dispatchAction} (payout=${payoutId})`,
    );
    return this.syncWithdrawSnapshotFromCases(withdrawId, tx);
  }

  async ensureWithdrawMainCasesOnPayoutConfirmed(
    withdrawId: string,
    payoutId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = this.getClient(tx);
    const withdrawal = await client.withdrawTransaction.findUnique({
      where: { id: withdrawId },
      select: {
        id: true,
        ownerType: true,
        ownerId: true,
        assetId: true,
        toAddress: true,
        toIban: true,
        asset: {
          select: {
            type: true,
            code: true,
            network: true,
          },
        },
      },
    });

    if (!withdrawal) {
      throw new NotFoundException(`Withdraw ${withdrawId} not found`);
    }

    if (!this.isCryptoAssetType(withdrawal.asset?.type)) {
      return this.syncWithdrawSnapshotFromCases(withdrawId, tx);
    }

    const checkedAt = new Date();
    await this.upsertKytCaseAndAppendReport(
      {
        sourceType: TxSourceType.WITHDRAW,
        sourceId: withdrawal.id,
        screeningStage: KytScreeningStage.MAIN,
        ownerType: withdrawal.ownerType,
        ownerId: withdrawal.ownerId,
        assetId: withdrawal.assetId,
        provider: 'SYSTEM',
        providerCaseId: `WITHDRAW-KYT-${withdrawal.id}`,
        status: 'FINAL',
        checkedAt,
        rawPayload: {
          lifecycle: 'FINAL',
          triggerEntityType: 'PAYOUT',
          triggerEntityId: payoutId,
          triggerStatus: 'CONFIRMED',
          assetCode: withdrawal.asset?.code || null,
          assetNetwork: withdrawal.asset?.network || null,
          destinationAddress: withdrawal.toAddress || null,
          destinationIban: withdrawal.toIban || null,
        },
        normalizedPayload: {
          lifecycle: 'FINAL',
          triggerEntityType: 'PAYOUT',
          triggerEntityId: payoutId,
          triggerStatus: 'CONFIRMED',
        },
      },
      tx,
    );

    return this.syncWithdrawSnapshotFromCases(withdrawId, tx);
  }

  async ensureDepositComplianceCases(
    depositId: string,
    tx?: Prisma.TransactionClient,
  ) {
    return this.ensureDepositMainCasesOnPayinConfirmed(
      depositId,
      `LEGACY-DEPOSIT-${depositId}`,
      tx,
    );
  }

  async ensureWithdrawComplianceCases(
    withdrawId: string,
    tx?: Prisma.TransactionClient,
  ) {
    return this.ensureWithdrawPreKytCaseOnCreate(withdrawId, tx);
  }

  async mockCompleteKytCase(
    dto: MockKytCaseCompleteDto,
    tx?: Prisma.TransactionClient,
  ) {
    const sourceContext =
      this.resolveManualSourceContext(dto) ||
      (await this.resolveSourceContext(dto.sourceType, dto.sourceId, tx));

    const stage = dto.screeningStage ?? KytScreeningStage.MAIN;
    const provider = dto.provider || 'MOCK';
    const providerCaseId = dto.providerCaseId || `MOCK-KYT-${Date.now()}`;
    const status = this.normalizeKytStatus(dto.status || 'FINAL');
    const riskScore = dto.riskScore ?? Math.floor(Math.random() * 30) + 1;
    const checkedAt = new Date();

    const upserted = await this.upsertKytCaseAndAppendReport(
      {
        ...sourceContext,
        screeningStage: stage,
        provider,
        providerCaseId,
        status,
        riskScore,
        checkedAt,
        rawPayload:
          dto.rawPayload ||
          this.buildMockKytPayload({
            sourceType: dto.sourceType,
            sourceId: dto.sourceId,
            stage,
            status,
            riskScore,
            providerCaseId,
          }),
        normalizedPayload:
          dto.normalizedPayload || {
            status,
            riskScore,
          },
      },
      tx,
    );

    if (dto.sourceType === TxSourceType.DEPOSIT) {
      await this.syncDepositSnapshotFromCases(dto.sourceId, tx);
    }
    if (dto.sourceType === TxSourceType.WITHDRAW) {
      await this.syncWithdrawSnapshotFromCases(dto.sourceId, tx);
    }

    return upserted;
  }

  async mockCompleteTravelRuleCase(
    dto: MockTravelRuleCaseCompleteDto,
    tx?: Prisma.TransactionClient,
  ) {
    const sourceContext =
      this.resolveManualSourceContext(dto) ||
      (await this.resolveSourceContext(dto.sourceType, dto.sourceId, tx));

    const provider = dto.provider || 'MOCK';
    const required = dto.required ?? false;
    const status = this.normalizeTravelRuleStatus(dto.status || 'FINAL', required);
    const providerTransferId =
      dto.providerTransferId || `MOCK-TRV-${Date.now()}`;
    const checkedAt = new Date();

    const upserted = await this.upsertTravelRuleCaseAndAppendReport(
      {
        ...sourceContext,
        provider,
        providerTransferId,
        required,
        status,
        counterpartyVasp: dto.counterpartyVasp || null,
        checkedAt,
        rawPayload:
          dto.rawPayload ||
          this.buildMockTravelPayload({
            sourceType: dto.sourceType,
            sourceId: dto.sourceId,
            status,
            required,
            providerTransferId,
            counterpartyVasp: dto.counterpartyVasp,
          }),
        normalizedPayload:
          dto.normalizedPayload || {
            required,
            status,
            counterpartyVasp: dto.counterpartyVasp || null,
          },
      },
      tx,
    );

    if (dto.sourceType === TxSourceType.DEPOSIT) {
      await this.syncDepositSnapshotFromCases(dto.sourceId, tx);
    }
    if (dto.sourceType === TxSourceType.WITHDRAW) {
      await this.syncWithdrawSnapshotFromCases(dto.sourceId, tx);
    }

    return upserted;
  }

  async getCaseSummaries(
    sourceType: TxSourceType,
    sourceId: string,
    screeningStage: KytScreeningStage = KytScreeningStage.MAIN,
    tx?: Prisma.TransactionClient,
  ): Promise<{ kytCase: Partial<KytCase> | null; travelRuleCase: Partial<TravelRuleCase> | null }> {
    const aggregate = await this.getTransactionCaseAggregate(
      sourceType,
      sourceId,
      {
        includeReports: false,
        includePayload: false,
      },
      tx,
    );
    const kytCase =
      screeningStage === KytScreeningStage.PRE_TXN
        ? aggregate.preKytCase
        : aggregate.mainKytCase;

    return {
      kytCase,
      travelRuleCase: aggregate.travelRuleCase,
    };
  }
}
