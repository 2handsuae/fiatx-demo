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
  TxKytCaseCallbackDto,
  TxTravelRuleCaseCallbackDto,
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

type DbClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class TransactionComplianceService {
  private readonly logger = new Logger(TransactionComplianceService.name);

  constructor(private readonly prisma: PrismaService) {}

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

  private isCryptoAssetType(assetType?: string | null): boolean {
    return String(assetType || '').toUpperCase() === 'CRYPTO';
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

  private deriveSingleStageComplianceStatus(input: {
    kytStatus: string;
    travelRuleStatus: string;
    travelRuleRequired: boolean;
    hasKyt: boolean;
    hasTravel: boolean;
  }): 'PENDING' | 'CLEAR' | 'HOLD' | 'REJECT' {
    const { kytStatus, travelRuleStatus, travelRuleRequired, hasKyt, hasTravel } =
      input;

    if (!hasKyt || !hasTravel) {
      return 'PENDING';
    }

    if (kytStatus === 'FAIL') {
      return 'REJECT';
    }

    if (travelRuleRequired && travelRuleStatus === 'REJECTED') {
      return 'REJECT';
    }

    if (kytStatus === 'REVIEW') {
      return 'HOLD';
    }

    if (
      travelRuleRequired &&
      ['PENDING', 'SENT', 'RECEIVED', 'EXPIRED'].includes(travelRuleStatus)
    ) {
      return 'HOLD';
    }

    if (
      kytStatus === 'PASS' &&
      (!travelRuleRequired || travelRuleStatus === 'ACCEPTED')
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

    const [preKytCase, mainKytCase, travelRuleCase] = await Promise.all([
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
    ]);

    const preStatus = this.normalizeKytStatus(preKytCase?.status);
    const mainStatus = this.normalizeKytStatus(mainKytCase?.status);
    const travelRequired = travelRuleCase?.required ?? false;
    const travelStatus = this.normalizeTravelRuleStatus(
      travelRuleCase?.status,
      travelRequired,
    );

    const derivedComplianceStatus =
      sourceType === TxSourceType.WITHDRAW
        ? this.deriveWithdrawComplianceStatus({
            preKytStatus: preStatus,
            mainKytStatus: mainStatus,
            travelRuleStatus: travelStatus,
            travelRuleRequired: travelRequired,
            hasPre: !!preKytCase,
            hasMain: !!mainKytCase,
            hasTravel: !!travelRuleCase,
          })
        : this.deriveSingleStageComplianceStatus({
            kytStatus: mainStatus,
            travelRuleStatus: travelStatus,
            travelRuleRequired: travelRequired,
            hasKyt: !!mainKytCase,
            hasTravel: !!travelRuleCase,
          });

    return {
      sourceType,
      sourceId,
      preKytCase: preKytCase || null,
      mainKytCase: mainKytCase || null,
      travelRuleCase: travelRuleCase || null,
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
        asset: {
          select: {
            type: true,
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

    const providerMode = this.getProviderMode();
    const provider = providerMode === 'MOCK' ? 'MOCK' : 'MANUAL';
    const checkedAt = new Date();

    if (providerMode === 'MOCK') {
      const riskScore = Math.floor(Math.random() * 20) + 1;
      const providerCaseId = `MOCK-KYT-PRE-${Date.now()}-${Math.floor(
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
          providerCaseId,
          status: 'PASS',
          riskScore,
          checkedAt,
          rawPayload: this.buildMockKytPayload({
            sourceType: TxSourceType.WITHDRAW,
            sourceId: withdrawal.id,
            stage: KytScreeningStage.PRE_TXN,
            status: 'PASS',
            riskScore,
            providerCaseId,
          }),
          normalizedPayload: {
            status: 'PASS',
            riskScore,
            triggerEntityType: 'WITHDRAW',
            triggerEntityId: withdrawal.id,
            triggerStatus: 'CREATED',
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
          checkedAt,
          rawPayload: {
            status: 'PENDING',
            stage: KytScreeningStage.PRE_TXN,
            triggerEntityType: 'WITHDRAW',
            triggerEntityId: withdrawal.id,
            triggerStatus: 'CREATED',
          },
          normalizedPayload: {
            status: 'PENDING',
            triggerEntityType: 'WITHDRAW',
            triggerEntityId: withdrawal.id,
            triggerStatus: 'CREATED',
          },
        },
        tx,
      );
    }

    return this.syncWithdrawSnapshotFromCases(withdrawal.id, tx);
  }

  async ensureDepositMainCasesOnPayinConfirmed(
    depositId: string,
    payinId: string,
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
      return null;
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
          rawPayload: {
            ...this.buildMockKytPayload({
              sourceType: TxSourceType.DEPOSIT,
              sourceId: deposit.id,
              stage: KytScreeningStage.MAIN,
              status: 'PASS',
              riskScore,
              providerCaseId,
            }),
            triggerEntityType: 'PAYIN',
            triggerEntityId: payinId,
            triggerStatus: 'CONFIRMED',
          },
          normalizedPayload: {
            status: 'PASS',
            riskScore,
            triggerEntityType: 'PAYIN',
            triggerEntityId: payinId,
            triggerStatus: 'CONFIRMED',
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
          rawPayload: {
            ...this.buildMockTravelPayload({
              sourceType: TxSourceType.DEPOSIT,
              sourceId: deposit.id,
              status: travelStatus,
              required: deposit.travelRuleRequired,
              providerTransferId,
            }),
            triggerEntityType: 'PAYIN',
            triggerEntityId: payinId,
            triggerStatus: 'CONFIRMED',
          },
          normalizedPayload: {
            required: deposit.travelRuleRequired,
            status: travelStatus,
            triggerEntityType: 'PAYIN',
            triggerEntityId: payinId,
            triggerStatus: 'CONFIRMED',
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
            triggerEntityType: 'PAYIN',
            triggerEntityId: payinId,
            triggerStatus: 'CONFIRMED',
          },
          normalizedPayload: {
            status: 'PENDING',
            triggerEntityType: 'PAYIN',
            triggerEntityId: payinId,
            triggerStatus: 'CONFIRMED',
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
            triggerEntityType: 'PAYIN',
            triggerEntityId: payinId,
            triggerStatus: 'CONFIRMED',
          },
          normalizedPayload: {
            required: deposit.travelRuleRequired,
            status: deposit.travelRuleRequired ? 'PENDING' : 'NOT_REQUIRED',
            triggerEntityType: 'PAYIN',
            triggerEntityId: payinId,
            triggerStatus: 'CONFIRMED',
          },
        },
        tx,
      );
    }

    return this.syncDepositSnapshotFromCases(deposit.id, tx);
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
        travelRuleRequired: true,
        asset: {
          select: {
            type: true,
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

    const providerMode = this.getProviderMode();
    const provider = providerMode === 'MOCK' ? 'MOCK' : 'MANUAL';
    const checkedAt = new Date();

    if (providerMode === 'MOCK') {
      const mainRisk = Math.floor(Math.random() * 30) + 1;
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
          screeningStage: KytScreeningStage.MAIN,
          ownerType: withdrawal.ownerType,
          ownerId: withdrawal.ownerId,
          assetId: withdrawal.assetId,
          provider,
          providerCaseId: mainProviderCaseId,
          status: 'PASS',
          riskScore: mainRisk,
          checkedAt,
          rawPayload: {
            ...this.buildMockKytPayload({
              sourceType: TxSourceType.WITHDRAW,
              sourceId: withdrawal.id,
              stage: KytScreeningStage.MAIN,
              status: 'PASS',
              riskScore: mainRisk,
              providerCaseId: mainProviderCaseId,
            }),
            triggerEntityType: 'PAYOUT',
            triggerEntityId: payoutId,
            triggerStatus: 'CONFIRMED',
          },
          normalizedPayload: {
            status: 'PASS',
            riskScore: mainRisk,
            triggerEntityType: 'PAYOUT',
            triggerEntityId: payoutId,
            triggerStatus: 'CONFIRMED',
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
          rawPayload: {
            ...this.buildMockTravelPayload({
              sourceType: TxSourceType.WITHDRAW,
              sourceId: withdrawal.id,
              status: travelStatus,
              required: withdrawal.travelRuleRequired,
              providerTransferId,
            }),
            triggerEntityType: 'PAYOUT',
            triggerEntityId: payoutId,
            triggerStatus: 'CONFIRMED',
          },
          normalizedPayload: {
            required: withdrawal.travelRuleRequired,
            status: travelStatus,
            triggerEntityType: 'PAYOUT',
            triggerEntityId: payoutId,
            triggerStatus: 'CONFIRMED',
          },
        },
        tx,
      );
    } else {
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
          rawPayload: {
            status: 'PENDING',
            stage: KytScreeningStage.MAIN,
            triggerEntityType: 'PAYOUT',
            triggerEntityId: payoutId,
            triggerStatus: 'CONFIRMED',
          },
          normalizedPayload: {
            status: 'PENDING',
            triggerEntityType: 'PAYOUT',
            triggerEntityId: payoutId,
            triggerStatus: 'CONFIRMED',
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
          provider,
          required: withdrawal.travelRuleRequired,
          status: withdrawal.travelRuleRequired ? 'PENDING' : 'NOT_REQUIRED',
          rawPayload: {
            status: withdrawal.travelRuleRequired ? 'PENDING' : 'NOT_REQUIRED',
            triggerEntityType: 'PAYOUT',
            triggerEntityId: payoutId,
            triggerStatus: 'CONFIRMED',
          },
          normalizedPayload: {
            required: withdrawal.travelRuleRequired,
            status: withdrawal.travelRuleRequired ? 'PENDING' : 'NOT_REQUIRED',
            triggerEntityType: 'PAYOUT',
            triggerEntityId: payoutId,
            triggerStatus: 'CONFIRMED',
          },
        },
        tx,
      );
    }

    return this.syncWithdrawSnapshotFromCases(withdrawal.id, tx);
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
    await this.ensureWithdrawPreKytCaseOnCreate(withdrawId, tx);
    return this.ensureWithdrawMainCasesOnPayoutConfirmed(
      withdrawId,
      `LEGACY-WITHDRAW-${withdrawId}`,
      tx,
    );
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
