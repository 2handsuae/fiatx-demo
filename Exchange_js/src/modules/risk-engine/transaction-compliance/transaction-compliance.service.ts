import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, KytCase, TravelRuleCase } from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  MockBackfillDto,
  MockKytCaseCompleteDto,
  MockTravelRuleCaseCompleteDto,
  TxCaseListQueryDto,
} from './dto/tx-compliance.dto';
import {
  KytScreeningStage,
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
import { ComplianceAlertsService } from '../compliance-alerts/compliance-alerts.service';

type DbClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class TransactionComplianceService {
  private readonly logger = new Logger(TransactionComplianceService.name);
  private readonly auditLogsService: AuditLogsService;
  private readonly complianceAlertsService: ComplianceAlertsService;

  constructor(private readonly prisma: PrismaService) {
    this.auditLogsService = new AuditLogsService(prisma);
    this.complianceAlertsService = new ComplianceAlertsService(prisma);
  }

  private getClient(tx?: Prisma.TransactionClient): DbClient {
    return tx ?? this.prisma;
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

  private generateCaseNo(prefix: 'KYT' | 'TRV'): string {
    return generateReferenceNo(prefix);
  }

  private normalizeKytStatus(status?: string | null): string {
    const current = (status || 'PENDING').toUpperCase();
    if (current === 'CLEAR') return 'PASS';
    if (current === 'HOLD') return 'REVIEW';
    if (current === 'REJECT') return 'FAIL';
    if (['PENDING', 'PASS', 'REVIEW', 'FAIL'].includes(current)) {
      return current;
    }
    return 'PENDING';
  }

  private normalizeTravelRuleStatus(
    status?: string | null,
    required?: boolean,
  ): string {
    const current = (status || '').toUpperCase();
    if (!required && !current) return 'NOT_REQUIRED';
    if (!required && current === 'PENDING') return 'NOT_REQUIRED';
    if (
      [
        'NOT_REQUIRED',
        'PENDING',
        'SENT',
        'RECEIVED',
        'ACCEPTED',
        'REJECTED',
        'EXPIRED',
      ].includes(current)
    ) {
      return current;
    }
    return required ? 'PENDING' : 'NOT_REQUIRED';
  }

  private deriveWithdrawComplianceStatus(input: {
    preKytStatus: string;
    mainKytStatus: string;
    travelRuleStatus: string;
    travelRuleRequired: boolean;
    hasPre: boolean;
    hasMain: boolean;
    hasTravel: boolean;
  }): 'PENDING' | 'CLEAR' | 'HOLD' | 'REJECT' {
    const {
      preKytStatus,
      mainKytStatus,
      travelRuleStatus,
      travelRuleRequired,
      hasMain,
      hasPre,
      hasTravel,
    } = input;

    if (!hasPre || !hasMain || !hasTravel) {
      return 'PENDING';
    }

    if (preKytStatus === 'FAIL' || mainKytStatus === 'FAIL') {
      return 'REJECT';
    }

    if (travelRuleRequired && travelRuleStatus === 'REJECTED') {
      return 'REJECT';
    }

    if (preKytStatus === 'REVIEW' || mainKytStatus === 'REVIEW') {
      return 'HOLD';
    }

    if (
      travelRuleRequired &&
      ['PENDING', 'SENT', 'RECEIVED', 'EXPIRED'].includes(travelRuleStatus)
    ) {
      return 'HOLD';
    }

    if (
      preKytStatus === 'PASS' &&
      mainKytStatus === 'PASS' &&
      (!travelRuleRequired || travelRuleStatus === 'ACCEPTED')
    ) {
      return 'CLEAR';
    }

    return 'PENDING';
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
    },
    tx?: Prisma.TransactionClient,
  ) {
    const normalizedStatus = this.normalizeKytStatus(input.status);
    if (normalizedStatus !== 'REVIEW' && normalizedStatus !== 'FAIL') {
      return;
    }

    const ruleCode = normalizedStatus === 'FAIL' ? 'TX_KYT_FAIL' : 'TX_KYT_REVIEW';
    const message =
      normalizedStatus === 'FAIL'
        ? `KYT case ${input.caseNo} reached FAIL status`
        : `KYT case ${input.caseNo} reached REVIEW status`;

    try {
      await this.complianceAlertsService.triggerSystemAlert(
        {
          ruleCode,
          sourceModule: AuditModules.TRANSACTION_COMPLIANCE,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          stage: input.screeningStage,
          entityType: AuditEntityTypes.KYT_CASE,
          entityId: input.caseId,
          entityNo: input.caseNo,
          ownerType: input.ownerType,
          ownerId: input.ownerId || undefined,
          ownerNo: input.ownerNo || undefined,
          title:
            normalizedStatus === 'FAIL'
              ? 'Transaction KYT Failed'
              : 'Transaction KYT Review Required',
          message,
          metadata: {
            screeningStage: input.screeningStage,
            provider: input.provider || null,
            providerCaseId: input.providerCaseId || null,
            riskScore: input.riskScore ?? null,
          },
          sourcePlatform: tx ? 'SYSTEM_TX' : 'SYSTEM',
        },
        tx,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to trigger KYT alert for case ${input.caseId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
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
    },
    tx?: Prisma.TransactionClient,
  ) {
    const normalizedStatus = this.normalizeTravelRuleStatus(
      input.status,
      input.required,
    );
    if (!input.required) return;
    if (normalizedStatus !== 'REJECTED' && normalizedStatus !== 'EXPIRED') return;

    const ruleCode =
      normalizedStatus === 'REJECTED'
        ? 'TX_TRAVEL_RULE_REJECTED'
        : 'TX_TRAVEL_RULE_EXPIRED';
    const message =
      normalizedStatus === 'REJECTED'
        ? `Travel Rule case ${input.caseNo} was rejected`
        : `Travel Rule case ${input.caseNo} expired`;

    try {
      await this.complianceAlertsService.triggerSystemAlert(
        {
          ruleCode,
          sourceModule: AuditModules.TRANSACTION_COMPLIANCE,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          entityType: AuditEntityTypes.TRAVEL_RULE_CASE,
          entityId: input.caseId,
          entityNo: input.caseNo,
          ownerType: input.ownerType,
          ownerId: input.ownerId || undefined,
          ownerNo: input.ownerNo || undefined,
          title:
            normalizedStatus === 'REJECTED'
              ? 'Travel Rule Rejected'
              : 'Travel Rule Expired',
          message,
          metadata: {
            required: input.required,
            provider: input.provider || null,
            providerTransferId: input.providerTransferId || null,
            counterpartyVasp: input.counterpartyVasp || null,
          },
          sourcePlatform: tx ? 'SYSTEM_TX' : 'SYSTEM',
        },
        tx,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to trigger Travel Rule alert for case ${input.caseId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
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

  async listKytCases(query: TxCaseListQueryDto) {
    const where: Prisma.KytCaseWhereInput = {};
    if (query.sourceType) where.sourceType = query.sourceType;
    if (query.sourceId) where.sourceId = query.sourceId;
    if (query.status) where.status = query.status;
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

    return { items, total };
  }

  async listTravelRuleCases(query: TxCaseListQueryDto) {
    const where: Prisma.TravelRuleCaseWhereInput = {};
    if (query.sourceType) where.sourceType = query.sourceType;
    if (query.sourceId) where.sourceId = query.sourceId;
    if (query.status) where.status = query.status;
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

    return { items, total };
  }

  async upsertKytCaseAndAppendReport(
    input: UpsertKytCaseInput,
    tx?: Prisma.TransactionClient,
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

    const report = await client.kytCaseReport.create({
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
    });

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
      },
      tx,
    );

    return { case: record, report };
  }

  async upsertTravelRuleCaseAndAppendReport(
    input: UpsertTravelRuleCaseInput,
    tx?: Prisma.TransactionClient,
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

    const report = await client.travelRuleCaseReport.create({
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
    });

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
      },
      tx,
    );

    return { case: record, report };
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

    const [preKytCase, mainKytCase, travelCase] = await Promise.all([
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

    if (!preKytCase && !mainKytCase && !travelCase) {
      return null;
    }

    const preStatus = this.normalizeKytStatus(preKytCase?.status);
    const mainStatus = this.normalizeKytStatus(mainKytCase?.status);
    const travelRequired = travelCase?.required ?? false;
    const travelStatus = this.normalizeTravelRuleStatus(
      travelCase?.status,
      travelRequired,
    );

    const complianceStatus = this.deriveWithdrawComplianceStatus({
      preKytStatus: preStatus,
      mainKytStatus: mainStatus,
      travelRuleStatus: travelStatus,
      travelRuleRequired: travelRequired,
      hasPre: !!preKytCase,
      hasMain: !!mainKytCase,
      hasTravel: !!travelCase,
    });

    const data: Prisma.WithdrawTransactionUpdateInput = {
      preKytStatus: preStatus,
      kytStatus: mainStatus,
      travelRuleRequired: travelRequired,
      travelRuleStatus: travelStatus,
      complianceStatus,
      complianceReviewedAt: complianceStatus === 'PENDING' ? null : new Date(),
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

  async ensureDepositComplianceCases(
    depositId: string,
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
      },
    });

    if (!deposit) {
      throw new NotFoundException(`Deposit ${depositId} not found`);
    }

    const providerMode = this.getProviderMode();
    const provider = providerMode === 'MOCK' ? 'MOCK' : 'MANUAL';

    if (providerMode === 'MOCK') {
      const providerCaseId = `MOCK-KYT-${Date.now()}-${Math.floor(
        Math.random() * 10000,
      )}`;
      const providerTransferId = `MOCK-TRV-${Date.now()}-${Math.floor(
        Math.random() * 10000,
      )}`;
      const riskScore = Math.floor(Math.random() * 30) + 1;
      const checkedAt = new Date();

      await this.upsertKytCaseAndAppendReport(
        {
          sourceType: TxSourceType.DEPOSIT,
          sourceId: deposit.id,
          screeningStage: KytScreeningStage.MAIN,
          ownerType: deposit.ownerType,
          ownerId: deposit.ownerId,
          assetId: deposit.assetId,
          provider,
          providerCaseId,
          status: 'PASS',
          riskScore,
          checkedAt,
          rawPayload: this.buildMockKytPayload({
            sourceType: TxSourceType.DEPOSIT,
            sourceId: deposit.id,
            stage: KytScreeningStage.MAIN,
            status: 'PASS',
            riskScore,
            providerCaseId,
          }),
          normalizedPayload: {
            status: 'PASS',
            riskScore,
          },
        },
        tx,
      );

      const travelStatus = deposit.travelRuleRequired ? 'ACCEPTED' : 'NOT_REQUIRED';
      await this.upsertTravelRuleCaseAndAppendReport(
        {
          sourceType: TxSourceType.DEPOSIT,
          sourceId: deposit.id,
          ownerType: deposit.ownerType,
          ownerId: deposit.ownerId,
          assetId: deposit.assetId,
          provider,
          providerTransferId,
          required: deposit.travelRuleRequired,
          status: travelStatus,
          checkedAt,
          rawPayload: this.buildMockTravelPayload({
            sourceType: TxSourceType.DEPOSIT,
            sourceId: deposit.id,
            status: travelStatus,
            required: deposit.travelRuleRequired,
            providerTransferId,
          }),
          normalizedPayload: {
            required: deposit.travelRuleRequired,
            status: travelStatus,
          },
        },
        tx,
      );
    } else {
      await this.upsertKytCaseAndAppendReport(
        {
          sourceType: TxSourceType.DEPOSIT,
          sourceId: deposit.id,
          screeningStage: KytScreeningStage.MAIN,
          ownerType: deposit.ownerType,
          ownerId: deposit.ownerId,
          assetId: deposit.assetId,
          provider,
          status: 'PENDING',
          rawPayload: {
            status: 'PENDING',
            source: 'manual-placeholder',
          },
          normalizedPayload: {
            status: 'PENDING',
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
          required: deposit.travelRuleRequired,
          status: deposit.travelRuleRequired ? 'PENDING' : 'NOT_REQUIRED',
          rawPayload: {
            status: deposit.travelRuleRequired ? 'PENDING' : 'NOT_REQUIRED',
            source: 'manual-placeholder',
          },
          normalizedPayload: {
            required: deposit.travelRuleRequired,
            status: deposit.travelRuleRequired ? 'PENDING' : 'NOT_REQUIRED',
          },
        },
        tx,
      );
    }

    return this.syncDepositSnapshotFromCases(deposit.id, tx);
  }

  async ensureWithdrawComplianceCases(
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
      },
    });

    if (!withdrawal) {
      throw new NotFoundException(`Withdraw ${withdrawId} not found`);
    }

    const providerMode = this.getProviderMode();
    const provider = providerMode === 'MOCK' ? 'MOCK' : 'MANUAL';

    if (providerMode === 'MOCK') {
      const checkedAt = new Date();
      const preRisk = Math.floor(Math.random() * 20) + 1;
      const mainRisk = Math.floor(Math.random() * 30) + 1;

      const preProviderCaseId = `MOCK-KYT-PRE-${Date.now()}-${Math.floor(
        Math.random() * 10000,
      )}`;
      const mainProviderCaseId = `MOCK-KYT-MAIN-${Date.now()}-${Math.floor(
        Math.random() * 10000,
      )}`;
      const providerTransferId = `MOCK-TRV-${Date.now()}-${Math.floor(
        Math.random() * 10000,
      )}`;

      await this.upsertKytCaseAndAppendReport(
        {
          sourceType: TxSourceType.WITHDRAW,
          sourceId: withdrawal.id,
          screeningStage: KytScreeningStage.PRE_TXN,
          ownerType: withdrawal.ownerType,
          ownerId: withdrawal.ownerId,
          assetId: withdrawal.assetId,
          provider,
          providerCaseId: preProviderCaseId,
          status: 'PASS',
          riskScore: preRisk,
          checkedAt,
          rawPayload: this.buildMockKytPayload({
            sourceType: TxSourceType.WITHDRAW,
            sourceId: withdrawal.id,
            stage: KytScreeningStage.PRE_TXN,
            status: 'PASS',
            riskScore: preRisk,
            providerCaseId: preProviderCaseId,
          }),
          normalizedPayload: {
            status: 'PASS',
            riskScore: preRisk,
          },
        },
        tx,
      );

      await this.upsertKytCaseAndAppendReport(
        {
          sourceType: TxSourceType.WITHDRAW,
          sourceId: withdrawal.id,
          screeningStage: KytScreeningStage.MAIN,
          ownerType: withdrawal.ownerType,
          ownerId: withdrawal.ownerId,
          assetId: withdrawal.assetId,
          provider,
          providerCaseId: mainProviderCaseId,
          status: 'PASS',
          riskScore: mainRisk,
          checkedAt,
          rawPayload: this.buildMockKytPayload({
            sourceType: TxSourceType.WITHDRAW,
            sourceId: withdrawal.id,
            stage: KytScreeningStage.MAIN,
            status: 'PASS',
            riskScore: mainRisk,
            providerCaseId: mainProviderCaseId,
          }),
          normalizedPayload: {
            status: 'PASS',
            riskScore: mainRisk,
          },
        },
        tx,
      );

      const travelStatus = withdrawal.travelRuleRequired ? 'ACCEPTED' : 'NOT_REQUIRED';
      await this.upsertTravelRuleCaseAndAppendReport(
        {
          sourceType: TxSourceType.WITHDRAW,
          sourceId: withdrawal.id,
          ownerType: withdrawal.ownerType,
          ownerId: withdrawal.ownerId,
          assetId: withdrawal.assetId,
          provider,
          providerTransferId,
          required: withdrawal.travelRuleRequired,
          status: travelStatus,
          checkedAt,
          rawPayload: this.buildMockTravelPayload({
            sourceType: TxSourceType.WITHDRAW,
            sourceId: withdrawal.id,
            status: travelStatus,
            required: withdrawal.travelRuleRequired,
            providerTransferId,
          }),
          normalizedPayload: {
            required: withdrawal.travelRuleRequired,
            status: travelStatus,
          },
        },
        tx,
      );
    } else {
      await this.upsertKytCaseAndAppendReport(
        {
          sourceType: TxSourceType.WITHDRAW,
          sourceId: withdrawal.id,
          screeningStage: KytScreeningStage.PRE_TXN,
          ownerType: withdrawal.ownerType,
          ownerId: withdrawal.ownerId,
          assetId: withdrawal.assetId,
          provider,
          status: 'PENDING',
          rawPayload: { status: 'PENDING', stage: KytScreeningStage.PRE_TXN },
          normalizedPayload: { status: 'PENDING' },
        },
        tx,
      );

      await this.upsertKytCaseAndAppendReport(
        {
          sourceType: TxSourceType.WITHDRAW,
          sourceId: withdrawal.id,
          screeningStage: KytScreeningStage.MAIN,
          ownerType: withdrawal.ownerType,
          ownerId: withdrawal.ownerId,
          assetId: withdrawal.assetId,
          provider,
          status: 'PENDING',
          rawPayload: { status: 'PENDING', stage: KytScreeningStage.MAIN },
          normalizedPayload: { status: 'PENDING' },
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
          provider,
          required: withdrawal.travelRuleRequired,
          status: withdrawal.travelRuleRequired ? 'PENDING' : 'NOT_REQUIRED',
          rawPayload: {
            status: withdrawal.travelRuleRequired ? 'PENDING' : 'NOT_REQUIRED',
          },
          normalizedPayload: {
            required: withdrawal.travelRuleRequired,
            status: withdrawal.travelRuleRequired ? 'PENDING' : 'NOT_REQUIRED',
          },
        },
        tx,
      );
    }

    return this.syncWithdrawSnapshotFromCases(withdrawal.id, tx);
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
    const status = this.normalizeKytStatus(dto.status || 'PASS');
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
    const status = this.normalizeTravelRuleStatus(
      dto.status || (required ? 'ACCEPTED' : 'NOT_REQUIRED'),
      required,
    );
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

  async mockBackfill(dto: MockBackfillDto) {
    const providerMode = this.getProviderMode();
    const limit = dto.limit ?? 100;
    const dryRun = dto.dryRun ?? false;
    const sourceTypes = dto.sourceType
      ? [dto.sourceType]
      : [TxSourceType.DEPOSIT, TxSourceType.WITHDRAW];

    let scanned = 0;
    let processed = 0;

    const summary = {
      deposit: { scanned: 0, processed: 0 },
      withdraw: { scanned: 0, processed: 0 },
    };

    if (sourceTypes.includes(TxSourceType.DEPOSIT)) {
      const where: Prisma.DepositTransactionWhereInput = {};
      if (dto.sourceStatus) {
        where.status = dto.sourceStatus;
      } else {
        where.status = {
          in: [
            DepositTransactionStatus.COMPLIANCE_PENDING,
            DepositTransactionStatus.UNDER_REVIEW,
          ],
        };
      }

      const rows = await this.prisma.depositTransaction.findMany({
        where,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });

      summary.deposit.scanned = rows.length;
      scanned += rows.length;

      if (!dryRun) {
        for (const row of rows) {
          await this.ensureDepositComplianceCases(row.id);
          summary.deposit.processed += 1;
          processed += 1;
        }
      }
    }

    if (sourceTypes.includes(TxSourceType.WITHDRAW)) {
      const where: Prisma.WithdrawTransactionWhereInput = {};
      if (dto.sourceStatus) {
        where.status = dto.sourceStatus;
      } else {
        where.status = {
          in: [
            WithdrawTransactionStatus.PENDING_COMPLIANCE,
            WithdrawTransactionStatus.UNDER_REVIEW,
          ],
        };
      }

      const rows = await this.prisma.withdrawTransaction.findMany({
        where,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });

      summary.withdraw.scanned = rows.length;
      scanned += rows.length;

      if (!dryRun) {
        for (const row of rows) {
          await this.ensureWithdrawComplianceCases(row.id);
          summary.withdraw.processed += 1;
          processed += 1;
        }
      }
    }

    this.logger.log(
      `tx compliance mock-backfill finished: mode=${providerMode}, dryRun=${dryRun}, scanned=${scanned}, processed=${processed}`,
    );

    await this.auditLogsService.recordSystem({
      triggerType: AuditTriggerType.SYSTEM_EVENT,
      action: AuditActions.SYSTEM_TX_COMPLIANCE_BACKFILL_EXECUTED,
      module: AuditModules.TRANSACTION_COMPLIANCE,
      entityType: AuditEntityTypes.KYT_CASE,
      result: AuditResult.SUCCESS,
      reason: dryRun
        ? 'Transaction compliance backfill dry-run executed'
        : 'Transaction compliance backfill executed',
      metadata: {
        mode: providerMode,
        dryRun,
        scanned,
        processed,
        summary,
      },
      sourcePlatform: 'SYSTEM',
    });

    return {
      mode: providerMode,
      dryRun,
      scanned,
      processed,
      summary,
    };
  }

  async getCaseSummaries(
    sourceType: TxSourceType,
    sourceId: string,
    screeningStage: KytScreeningStage = KytScreeningStage.MAIN,
    tx?: Prisma.TransactionClient,
  ): Promise<{ kytCase: Partial<KytCase> | null; travelRuleCase: Partial<TravelRuleCase> | null }> {
    const client = this.getClient(tx);

    const [kytCase, travelRuleCase] = await Promise.all([
      client.kytCase.findUnique({
        where: {
          sourceType_sourceId_screeningStage: {
            sourceType,
            sourceId,
            screeningStage,
          },
        },
        select: {
          id: true,
          caseNo: true,
          sourceType: true,
          sourceId: true,
          screeningStage: true,
          provider: true,
          providerCaseId: true,
          status: true,
          riskScore: true,
          checkedAt: true,
          updatedAt: true,
        },
      }),
      client.travelRuleCase.findUnique({
        where: {
          sourceType_sourceId: {
            sourceType,
            sourceId,
          },
        },
        select: {
          id: true,
          caseNo: true,
          sourceType: true,
          sourceId: true,
          provider: true,
          providerTransferId: true,
          required: true,
          status: true,
          counterpartyVasp: true,
          checkedAt: true,
          updatedAt: true,
        },
      }),
    ]);

    return {
      kytCase,
      travelRuleCase,
    };
  }
}
