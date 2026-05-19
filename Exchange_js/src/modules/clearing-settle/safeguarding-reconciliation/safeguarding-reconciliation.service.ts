import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  classifyWalletSurface,
} from '../../asset-treasury/wallets/system-wallet.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  buildStateTransitionAction,
} from '../../audit-logging/constants/audit-actions.constant';
import {
  FiatStatementImportQueryDto,
  GenerateSafeguardingDailyDiffDto,
  ImportFiatStatementDto,
  SafeguardingBreakQueryDto,
  SafeguardingRunQueryDto,
  SafeguardingWarningQueryDto,
  UpdateReconciliationBreakStatusDto,
  UpdateReconciliationWarningStatusDto,
} from './dto/safeguarding-reconciliation.dto';
import {
  FiatStatementImportStatuses,
  ReconciliationBreakStatuses,
  ReconciliationBreakTypes,
  ReconciliationWarningStatuses,
  ReconciliationWarningTypes,
  SAFEGUARDING_BREAK_SOURCE_TYPE,
  SafeguardingPoolRoles,
  SafeguardingRunStatuses,
} from './constants/safeguarding-reconciliation.constant';

type TxClient = Prisma.TransactionClient;

type AssetSummary = {
  id: string;
  currency: string;
  type: string;
  decimals: number;
};

type LiabilitySnapshotRow = {
  customerId: string;
  customerNo: string | null;
  assetId: string;
  assetCurrency: string | null;
  liabilityAmount: Prisma.Decimal;
};

type PoolSnapshotRow = {
  assetId: string;
  assetCurrency: string | null;
  poolRole: string;
  walletId: string | null;
  accountRef: string | null;
  sourceType: string;
  sourceRef: string | null;
  balanceAmount: Prisma.Decimal;
  updatedAt: Date | null;
};

type StatementAggregate = {
  importIds: string[];
  assetId: string;
  assetCurrency: string | null;
  totalClosingBalance: Prisma.Decimal;
};

type BreakComputation = {
  assetId: string;
  assetCurrency: string | null;
  assetType: string;
  liabilityAmount: Prisma.Decimal;
  poolAmount: Prisma.Decimal;
  externalAmount: Prisma.Decimal | null;
  breakType: string | null;
  deltaAmount: Prisma.Decimal;
  details: Record<string, unknown>;
};

@Injectable()
export class SafeguardingReconciliationService {
  private static readonly MAX_NO_GENERATION_RETRIES = 10;
  private static readonly LIABILITY_ACCOUNT_CODES = [
    'L.CLIENT_CREDIT',
    'L.CLIENT_HELD',
  ] as const;
  private static readonly FIAT_IN_TRANSIT_STATUSES = new Set([
    'CONFIRMING',
    'CONFIRMED',
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length ? normalized : null;
  }

  private normalizeBusinessDate(value: string): string {
    const normalized = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      throw new BadRequestException(
        'businessDate must be in YYYY-MM-DD format',
      );
    }
    const date = new Date(`${normalized}T00:00:00.000Z`);
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== normalized
    ) {
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

  private toDecimal(
    value: Prisma.Decimal | string | number | null | undefined,
  ): Prisma.Decimal {
    return new Prisma.Decimal(value ?? 0);
  }

  private formatDecimal(
    value: Prisma.Decimal | string | number | null | undefined,
  ): string | null {
    if (value === null || value === undefined) return null;
    return this.toDecimal(value).toString();
  }

  private decimalsEqual(
    left: Prisma.Decimal | string | number | null | undefined,
    right: Prisma.Decimal | string | number | null | undefined,
  ) {
    return this.toDecimal(left).equals(this.toDecimal(right));
  }

  private absoluteDelta(
    left: Prisma.Decimal | string | number | null | undefined,
    right: Prisma.Decimal | string | number | null | undefined,
  ) {
    return this.toDecimal(left).minus(this.toDecimal(right)).abs();
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
    return JSON.stringify(value);
  }

  private getActorContext(operatorId: string) {
    return {
      actorType: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
      actorId: operatorId,
      actorRole: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
    };
  }

  private getSourcePlatform(operatorId: string) {
    return operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_API';
  }

  private async recordAudit(
    input: {
      action: string;
      entityType: string;
      entityId: string;
      entityNo?: string | null;
      reason?: string | null;
      traceId?: string | null;
    },
    operatorId: string,
    db: any,
  ) {
    await this.auditLogsService.recordByActor(
      {
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        entityNo: input.entityNo || undefined,
        reason: input.reason || undefined,
        traceId: input.traceId || undefined,
        sourcePlatform: this.getSourcePlatform(operatorId),
      },
      this.getActorContext(operatorId),
      db,
    );
  }

  private async createRunWithUniqueNo(
    tx: TxClient,
    data: Omit<any, 'id' | 'runNo' | 'createdAt' | 'updatedAt'>,
  ) {
    for (
      let attempt = 1;
      attempt <= SafeguardingReconciliationService.MAX_NO_GENERATION_RETRIES;
      attempt += 1
    ) {
      try {
        return await (tx as any).safeguardingRun.create({
          data: {
            ...data,
            runNo: generateReferenceNo('SRN'),
          },
        });
      } catch (error) {
        const maybe = error as { code?: string; meta?: { target?: string[] | string } };
        const target = maybe?.meta?.target;
        const isConflict =
          maybe?.code === 'P2002' &&
          ((Array.isArray(target) && target.includes('runNo')) ||
            (typeof target === 'string' && target.includes('runNo')));
        if (isConflict) continue;
        throw error;
      }
    }
    throw new InternalServerErrorException('Failed to generate safeguarding run no');
  }

  private async createBreakWithUniqueNo(
    tx: TxClient,
    data: Omit<any, 'id' | 'breakNo' | 'createdAt' | 'updatedAt'>,
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
        const isConflict =
          maybe?.code === 'P2002' &&
          ((Array.isArray(target) && target.includes('breakNo')) ||
            (typeof target === 'string' && target.includes('breakNo')));
        if (isConflict) continue;
        throw error;
      }
    }
    throw new InternalServerErrorException('Failed to generate safeguarding break no');
  }

  private async createWarningWithUniqueNo(
    tx: TxClient,
    data: Omit<any, 'id' | 'warningNo' | 'createdAt' | 'updatedAt'>,
  ) {
    for (
      let attempt = 1;
      attempt <= SafeguardingReconciliationService.MAX_NO_GENERATION_RETRIES;
      attempt += 1
    ) {
      try {
        return await (tx as any).reconciliationWarning.create({
          data: {
            ...data,
            warningNo: generateReferenceNo('RWN'),
          },
        });
      } catch (error) {
        const maybe = error as { code?: string; meta?: { target?: string[] | string } };
        const target = maybe?.meta?.target;
        const isConflict =
          maybe?.code === 'P2002' &&
          ((Array.isArray(target) && target.includes('warningNo')) ||
            (typeof target === 'string' && target.includes('warningNo')));
        if (isConflict) continue;
        throw error;
      }
    }
    throw new InternalServerErrorException(
      'Failed to generate safeguarding warning no',
    );
  }

  private async createStatementImportWithUniqueNo(
    tx: TxClient,
    data: Omit<any, 'id' | 'importNo' | 'createdAt' | 'updatedAt'>,
  ) {
    for (
      let attempt = 1;
      attempt <= SafeguardingReconciliationService.MAX_NO_GENERATION_RETRIES;
      attempt += 1
    ) {
      try {
        return await (tx as any).fiatStatementImport.create({
          data: {
            ...data,
            importNo: generateReferenceNo('STI'),
          },
        });
      } catch (error) {
        const maybe = error as { code?: string; meta?: { target?: string[] | string } };
        const target = maybe?.meta?.target;
        const isConflict =
          maybe?.code === 'P2002' &&
          ((Array.isArray(target) && target.includes('importNo')) ||
            (typeof target === 'string' && target.includes('importNo')));
        if (isConflict) continue;
        throw error;
      }
    }
    throw new InternalServerErrorException(
      'Failed to generate fiat statement import no',
    );
  }

  private aggregateLiabilityRows(
    rows: any[],
    customerNosById = new Map<string, string | null>(),
  ): LiabilitySnapshotRow[] {
    const map = new Map<string, LiabilitySnapshotRow>();

    for (const row of rows) {
      const assetId = this.normalizeOptionalString(row.assetId);
      const customerId = this.normalizeOptionalString(row.ownerId);
      if (!assetId || !customerId) continue;
      const key = `${customerId}::${assetId}`;
      const existing = map.get(key) || {
        customerId,
        customerNo:
          customerNosById.get(customerId) ??
          this.normalizeOptionalString(row.ownerNo),
        assetId,
        assetCurrency: null,
        liabilityAmount: new Prisma.Decimal(0),
      };
      const amount = this.toDecimal(row?._sum?.amount || 0);
      const nextAmount =
        String(row.drCr || '').toUpperCase() === 'CR'
          ? existing.liabilityAmount.plus(amount)
          : existing.liabilityAmount.minus(amount);
      map.set(key, {
        ...existing,
        liabilityAmount: nextAmount,
      });
    }

    return Array.from(map.values());
  }

  private async buildLiabilitySnapshots(
    businessDate: string,
    db: any,
  ): Promise<LiabilitySnapshotRow[]> {
    const { cutoffAt } = this.buildBusinessDateCutoff(businessDate);
    const rows = await (db as any).journalLine.findMany({
      select: {
        assetId: true,
        ownerId: true,
        accountCode: true,
        drCr: true,
        amount: true,
      },
      where: {
        ownerType: 'CUSTOMER',
        ownerId: { not: null },
        accountCode: {
          in: Array.from(
            SafeguardingReconciliationService.LIABILITY_ACCOUNT_CODES,
          ),
        },
        createdAt: { lte: cutoffAt },
      },
    });
    const customerIds = Array.from(
      new Set(
        rows
          .map((row: any) => this.normalizeOptionalString(row.ownerId))
          .filter((value: string | null): value is string => Boolean(value)),
      ),
    );
    const customers =
      customerIds.length > 0
        ? await (db as any).customerMain.findMany({
            where: { id: { in: customerIds } },
            select: { id: true, customerNo: true },
          })
        : [];
    const customerNosById = new Map<string, string | null>(
      customers.map((customer: any) => [
        customer.id,
        this.normalizeOptionalString(customer.customerNo),
      ]),
    );
    return this.aggregateLiabilityRows(
      rows.map((row: any) => ({
        ...row,
        _sum: { amount: row.amount },
      })),
      customerNosById,
    );
  }

  private isEligiblePoolWallet(wallet: any) {
    const surface = classifyWalletSurface(wallet);
    if (surface === 'CUSTOMER_DEPOSIT') return true;
    if (surface !== 'CUSTOMER_POOL') return false;
    return (
      String(wallet.walletRole || '').toUpperCase() === SafeguardingPoolRoles.MASTER ||
      String(wallet.walletRole || '').toUpperCase() === SafeguardingPoolRoles.PAYOUT ||
      String(wallet.walletRole || '').toUpperCase() === SafeguardingPoolRoles.CUST_BANK
    );
  }

  private mapWalletToPoolRole(wallet: any) {
    if (classifyWalletSurface(wallet) === 'CUSTOMER_DEPOSIT') {
      return SafeguardingPoolRoles.DEPOSIT;
    }
    return String(wallet.walletRole || '').toUpperCase();
  }

  private async buildWalletPoolSnapshots(db: any): Promise<PoolSnapshotRow[]> {
    const wallets = await (db as any).wallet.findMany({
      where: {
        status: 'ACTIVE',
        walletRole: {
          in: [
            SafeguardingPoolRoles.DEPOSIT,
            SafeguardingPoolRoles.MASTER,
            SafeguardingPoolRoles.PAYOUT,
            SafeguardingPoolRoles.CUST_BANK,
          ],
        },
      },
      select: {
        id: true,
        walletNo: true,
        ownerType: true,
        ownerId: true,
        ownerNo: true,
        type: true,
        direction: true,
        walletRole: true,
        assetId: true,
        address: true,
        iban: true,
      },
    });
    const eligibleWallets = wallets.filter((wallet: any) =>
      this.isEligiblePoolWallet(wallet),
    );
    const walletIds = eligibleWallets.map((wallet: any) => wallet.id);
    const snapshots = walletIds.length
      ? await (db as any).walletBalanceSnapshot.findMany({
          where: { walletId: { in: walletIds } },
          select: {
            walletId: true,
            assetId: true,
            totalBalance: true,
            availableBalance: true,
            restrictedBalance: true,
            updatedAt: true,
          },
        })
      : [];
    const snapshotByWalletId = new Map<string, any>(
      snapshots.map((item: any) => [item.walletId, item]),
    );

    return eligibleWallets.map((wallet: any) => {
      const snapshot = snapshotByWalletId.get(wallet.id);
      return {
        assetId: wallet.assetId,
        assetCurrency: null,
        poolRole: this.mapWalletToPoolRole(wallet),
        walletId: wallet.id,
        accountRef: wallet.iban || wallet.address || wallet.walletNo || null,
        sourceType: 'WALLET_SNAPSHOT',
        sourceRef: wallet.walletNo || null,
        balanceAmount: snapshot
          ? this.toDecimal(snapshot.totalBalance)
          : new Prisma.Decimal(0),
        updatedAt: snapshot?.updatedAt || null,
      };
    });
  }

  private async buildFiatInTransitSnapshots(
    db: any,
  ): Promise<PoolSnapshotRow[]> {
    const payouts = await (db as any).payout.findMany({
      where: {
        type: 'FIAT',
        status: {
          in: Array.from(
            SafeguardingReconciliationService.FIAT_IN_TRANSIT_STATUSES,
          ),
        },
      },
      select: {
        id: true,
        payoutNo: true,
        assetId: true,
        amount: true,
        updatedAt: true,
      },
    });

    const map = new Map<string, PoolSnapshotRow>();
    for (const payout of payouts) {
      const existing = map.get(payout.assetId) || {
        assetId: payout.assetId,
        assetCurrency: null,
        poolRole: SafeguardingPoolRoles.OUTBOUND_IN_TRANSIT,
        walletId: null,
        accountRef: 'FIAT_OUTBOUND_IN_TRANSIT',
        sourceType: 'PAYOUT_IN_TRANSIT',
        sourceRef: null,
        balanceAmount: new Prisma.Decimal(0),
        updatedAt: payout.updatedAt || null,
      };
      existing.balanceAmount = existing.balanceAmount.plus(
        this.toDecimal(payout.amount),
      );
      existing.updatedAt =
        !existing.updatedAt || payout.updatedAt > existing.updatedAt
          ? payout.updatedAt
          : existing.updatedAt;
      map.set(payout.assetId, existing);
    }

    return Array.from(map.values());
  }

  private async loadPolicies(assetIds: string[], db: any) {
    if (!assetIds.length) return [];
    return (db as any).safeguardingPolicy.findMany({
      where: {
        assetId: { in: assetIds },
        status: 'ACTIVE',
      },
    });
  }

  private policyMap(policies: any[]) {
    return new Map<string, any>(
      policies.map((item) => [`${item.assetId}::${item.poolRole}`, item]),
    );
  }

  private async createWarningRecords(
    run: any,
    poolSnapshots: PoolSnapshotRow[],
    policyMap: Map<string, any>,
    operatorId: string,
    db: any,
  ) {
    const { cutoffAt } = this.buildBusinessDateCutoff(run.businessDate);
    const warnings: any[] = [];

    for (const snapshot of poolSnapshots) {
      const policy = policyMap.get(`${snapshot.assetId}::${snapshot.poolRole}`);
      if (!policy) continue;

      if (
        snapshot.poolRole === SafeguardingPoolRoles.DEPOSIT &&
        policy.collectionAmountThreshold &&
        this.toDecimal(snapshot.balanceAmount).gt(
          this.toDecimal(policy.collectionAmountThreshold),
        )
      ) {
        warnings.push(
          await this.createWarningWithUniqueNo(db, {
            runId: run.id,
            businessDate: run.businessDate,
            assetId: snapshot.assetId,
            assetCode: snapshot.assetCurrency,
            warningType:
              ReconciliationWarningTypes.DEPOSIT_COLLECTION_OVER_AMOUNT,
            poolRole: snapshot.poolRole,
            walletId: snapshot.walletId,
            accountRef: snapshot.accountRef,
            observedValue: snapshot.balanceAmount,
            thresholdValue: this.toDecimal(policy.collectionAmountThreshold),
            status: ReconciliationWarningStatuses.OPEN,
            detailsJson: this.serializeJson({
              sourceType: snapshot.sourceType,
              sourceRef: snapshot.sourceRef,
            }),
          }),
        );
      }

      if (
        snapshot.poolRole === SafeguardingPoolRoles.DEPOSIT &&
        policy.collectionMaxAgeMinutes &&
        snapshot.updatedAt
      ) {
        const ageMinutes = Math.floor(
          (cutoffAt.getTime() - snapshot.updatedAt.getTime()) / 60000,
        );
        if (ageMinutes > Number(policy.collectionMaxAgeMinutes)) {
          warnings.push(
            await this.createWarningWithUniqueNo(db, {
              runId: run.id,
              businessDate: run.businessDate,
              assetId: snapshot.assetId,
              assetCode: snapshot.assetCurrency,
              warningType:
                ReconciliationWarningTypes.DEPOSIT_COLLECTION_OVER_AGE,
              poolRole: snapshot.poolRole,
              walletId: snapshot.walletId,
              accountRef: snapshot.accountRef,
              observedValue: new Prisma.Decimal(ageMinutes),
              thresholdValue: new Prisma.Decimal(
                Number(policy.collectionMaxAgeMinutes),
              ),
              status: ReconciliationWarningStatuses.OPEN,
              detailsJson: this.serializeJson({
                updatedAt: snapshot.updatedAt.toISOString(),
              }),
            }),
          );
        }
      }

      if (
        snapshot.poolRole === SafeguardingPoolRoles.PAYOUT &&
        policy.targetMinBalance &&
        this.toDecimal(snapshot.balanceAmount).lt(
          this.toDecimal(policy.targetMinBalance),
        )
      ) {
        warnings.push(
          await this.createWarningWithUniqueNo(db, {
            runId: run.id,
            businessDate: run.businessDate,
            assetId: snapshot.assetId,
            assetCode: snapshot.assetCurrency,
            warningType: ReconciliationWarningTypes.PAYOUT_TARGET_BELOW_MIN,
            poolRole: snapshot.poolRole,
            walletId: snapshot.walletId,
            accountRef: snapshot.accountRef,
            observedValue: snapshot.balanceAmount,
            thresholdValue: this.toDecimal(policy.targetMinBalance),
            status: ReconciliationWarningStatuses.OPEN,
            detailsJson: this.serializeJson({
              sourceType: snapshot.sourceType,
              sourceRef: snapshot.sourceRef,
            }),
          }),
        );
      }

      if (
        snapshot.poolRole === SafeguardingPoolRoles.PAYOUT &&
        policy.targetMaxBalance &&
        this.toDecimal(snapshot.balanceAmount).gt(
          this.toDecimal(policy.targetMaxBalance),
        )
      ) {
        warnings.push(
          await this.createWarningWithUniqueNo(db, {
            runId: run.id,
            businessDate: run.businessDate,
            assetId: snapshot.assetId,
            assetCode: snapshot.assetCurrency,
            warningType: ReconciliationWarningTypes.PAYOUT_TARGET_ABOVE_MAX,
            poolRole: snapshot.poolRole,
            walletId: snapshot.walletId,
            accountRef: snapshot.accountRef,
            observedValue: snapshot.balanceAmount,
            thresholdValue: this.toDecimal(policy.targetMaxBalance),
            status: ReconciliationWarningStatuses.OPEN,
            detailsJson: this.serializeJson({
              sourceType: snapshot.sourceType,
              sourceRef: snapshot.sourceRef,
            }),
          }),
        );
      }
    }

    for (const warning of warnings) {
      await this.recordAudit(
        {

          action: buildStateTransitionAction(
            'RECONCILIATION_WARNING',
            'NEW',
            ReconciliationWarningStatuses.OPEN,
          ),
          entityType: AuditEntityTypes.RECONCILIATION_WARNING,
          entityId: warning.id,
          entityNo: warning.warningNo,
          traceId: run.traceId || null,
        },
        operatorId,
        db,
      );
    }

    return warnings;
  }

  private async loadStatementAggregates(
    businessDate: string,
    db: any,
  ): Promise<StatementAggregate[]> {
    const imports = await (db as any).fiatStatementImport.findMany({
      where: {
        businessDate,
        status: FiatStatementImportStatuses.READY,
      },
      select: {
        id: true,
        assetId: true,
        closingBalance: true,
        asset: {
          select: {
            currency: true,
          },
        },
      },
    });
    const map = new Map<string, StatementAggregate>();
    for (const item of imports) {
      const existing = map.get(item.assetId) || {
        importIds: [] as string[],
        assetId: item.assetId,
        assetCurrency: item.asset?.currency || null,
        totalClosingBalance: new Prisma.Decimal(0),
      };
      existing.importIds.push(item.id);
      existing.totalClosingBalance = existing.totalClosingBalance.plus(
        this.toDecimal(item.closingBalance || 0),
      );
      map.set(item.assetId, existing);
    }
    return Array.from(map.values());
  }

  private computeBreakForAsset(
    asset: AssetSummary,
    liabilityAmount: Prisma.Decimal,
    poolAmount: Prisma.Decimal,
    externalAmount: Prisma.Decimal | null,
  ): BreakComputation {
    const layer12Mismatch = !liabilityAmount.equals(poolAmount);
    const layer23Mismatch =
      asset.type === 'FIAT' &&
      externalAmount !== null &&
      !poolAmount.equals(externalAmount);

    let breakType: string | null = null;
    if (asset.type === 'FIAT' && layer12Mismatch && layer23Mismatch) {
      breakType = ReconciliationBreakTypes.MULTI_LAYER_BREAK;
    } else if (layer12Mismatch) {
      breakType = ReconciliationBreakTypes.COVERAGE_BREAK;
    } else if (layer23Mismatch) {
      breakType = ReconciliationBreakTypes.EXTERNAL_PROOF_BREAK;
    }

    let deltaAmount = new Prisma.Decimal(0);
    if (breakType === ReconciliationBreakTypes.COVERAGE_BREAK) {
      deltaAmount = this.absoluteDelta(liabilityAmount, poolAmount);
    } else if (breakType === ReconciliationBreakTypes.EXTERNAL_PROOF_BREAK) {
      deltaAmount = this.absoluteDelta(poolAmount, externalAmount);
    } else if (breakType === ReconciliationBreakTypes.MULTI_LAYER_BREAK) {
      deltaAmount = Prisma.Decimal.max(
        this.absoluteDelta(liabilityAmount, poolAmount),
        this.absoluteDelta(poolAmount, externalAmount),
      );
    }

    return {
      assetId: asset.id,
      assetCurrency: asset.currency,
      assetType: asset.type,
      liabilityAmount,
      poolAmount,
      externalAmount,
      breakType,
      deltaAmount,
      details: {
        businessDate: undefined,
        liabilityAmount: liabilityAmount.toString(),
        poolAmount: poolAmount.toString(),
        externalAmount: externalAmount?.toString() || null,
        assetType: asset.type,
      },
    };
  }

  private async syncBreakForAsset(
    run: any,
    computation: BreakComputation,
    operatorId: string,
    db: any,
  ) {
    const existing = await (db as any).reconciliationBreak.findUnique({
      where: {
        businessDate_sourceType_sourceId: {
          businessDate: run.businessDate,
          sourceType: SAFEGUARDING_BREAK_SOURCE_TYPE,
          sourceId: computation.assetId,
        },
      },
    });

    if (!computation.breakType) {
      return existing
        ? {
            break: existing,
            created: false,
            active: false,
          }
        : null;
    }

    const detailsJson = this.serializeJson({
      ...computation.details,
      businessDate: run.businessDate,
      breakType: computation.breakType,
    });

    if (!existing) {
      const created = await this.createBreakWithUniqueNo(db, {
        runId: run.id,
        businessDate: run.businessDate,
        sourceType: SAFEGUARDING_BREAK_SOURCE_TYPE,
        sourceId: computation.assetId,
        sourceNo: computation.assetCurrency,
        withdrawId: null,
        withdrawNo: null,
        payoutId: null,
        payoutNo: null,
        assetId: computation.assetId,
        assetCode: computation.assetCurrency,
        breakType: computation.breakType,
        liabilityAmount: computation.liabilityAmount,
        poolAmount: computation.poolAmount,
        externalAmount: computation.externalAmount,
        expectedNetDelta: computation.liabilityAmount,
        observedNetDelta:
          computation.externalAmount ?? computation.poolAmount,
        deltaAmount: computation.deltaAmount,
        reasonCode: computation.breakType,
        status: ReconciliationBreakStatuses.OPEN,
        linkedAlertId: null,
        linkedCaseId: null,
        detailsJson,
        detectedAt: new Date(),
      });
      await this.recordAudit(
        {

          action: AuditActions.TX_SAFEGUARDING_BREAK_DETECTED,
          entityType: AuditEntityTypes.RECONCILIATION_BREAK,
          entityId: created.id,
          entityNo: created.breakNo,
          traceId: run.traceId || null,
        },
        operatorId,
        db,
      );
      return {
        break: created,
        created: true,
        active: true,
      };
    }

    const reopening = new Set<string>([
      ReconciliationBreakStatuses.RESOLVED,
      ReconciliationBreakStatuses.ACCEPTED_DIFFERENCE,
    ]).has(String(existing.status || '').toUpperCase());
    const updated = await (db as any).reconciliationBreak.update({
      where: { id: existing.id },
      data: {
        runId: run.id,
        sourceNo: computation.assetCurrency,
        assetCode: computation.assetCurrency,
        breakType: computation.breakType,
        liabilityAmount: computation.liabilityAmount,
        poolAmount: computation.poolAmount,
        externalAmount: computation.externalAmount,
        expectedNetDelta: computation.liabilityAmount,
        observedNetDelta:
          computation.externalAmount ?? computation.poolAmount,
        deltaAmount: computation.deltaAmount,
        reasonCode: computation.breakType,
        detailsJson,
        detectedAt: new Date(),
        status: reopening ? ReconciliationBreakStatuses.OPEN : existing.status,
        resolvedAt: reopening ? null : existing.resolvedAt,
        reopenedAt: reopening ? new Date() : existing.reopenedAt,
      },
    });
    await this.recordAudit(
      {

        action: reopening
          ? AuditActions.TX_SAFEGUARDING_BREAK_DETECTED
          : buildStateTransitionAction(
              'RECONCILIATION_BREAK',
              existing.status,
              updated.status,
            ),
        entityType: AuditEntityTypes.RECONCILIATION_BREAK,
        entityId: updated.id,
        entityNo: updated.breakNo,
        traceId: run.traceId || null,
      },
      operatorId,
      db,
    );
    const linked = updated;
    return {
      break: linked,
      created: false,
      active: true,
    };
  }

  private summarizeByAsset(
    computations: BreakComputation[],
    warningCounts: Map<string, number>,
  ) {
    return computations.map((item) => ({
      assetId: item.assetId,
      assetCode: item.assetCurrency,
      assetType: item.assetType,
      liabilityAmount: item.liabilityAmount.toString(),
      poolAmount: item.poolAmount.toString(),
      externalAmount: item.externalAmount?.toString() || null,
      breakType: item.breakType,
      deltaAmount: item.deltaAmount.toString(),
      warningCount: warningCounts.get(item.assetId) || 0,
    }));
  }

  async generateDailyDiff(
    dto: GenerateSafeguardingDailyDiffDto,
    operatorId: string,
  ) {
    const businessDate = this.normalizeBusinessDate(dto.businessDate);

    return this.prisma.$transaction(async (tx) => {
      const run = await this.createRunWithUniqueNo(tx as any, {
        businessDate,
        status: SafeguardingRunStatuses.RUNNING,
        traceId: `SAFEGUARDING:${businessDate}`,
        startedAt: new Date(),
      });

      const liabilitySnapshots = await this.buildLiabilitySnapshots(
        businessDate,
        tx,
      );
      const walletPoolSnapshots = await this.buildWalletPoolSnapshots(tx);
      const fiatInTransitSnapshots = await this.buildFiatInTransitSnapshots(tx);
      const poolSnapshots = [...walletPoolSnapshots, ...fiatInTransitSnapshots];

      const assetIds = new Set<string>();
      for (const row of liabilitySnapshots) assetIds.add(row.assetId);
      for (const row of poolSnapshots) assetIds.add(row.assetId);

      const statementAggregates = await this.loadStatementAggregates(
        businessDate,
        tx,
      );
      for (const row of statementAggregates) assetIds.add(row.assetId);

      const assets = assetIds.size
        ? await (tx as any).asset.findMany({
            where: { id: { in: Array.from(assetIds) } },
            select: {
              id: true,
              currency: true,
              type: true,
              decimals: true,
            },
          })
        : [];
      const assetById = new Map<string, AssetSummary>(
        assets.map((asset: AssetSummary) => [asset.id, asset]),
      );

      await (tx as any).liabilitySnapshot.createMany({
        data: liabilitySnapshots.map((item) => ({
          runId: run.id,
          customerId: item.customerId,
          customerNo: item.customerNo,
          assetId: item.assetId,
          assetCode: assetById.get(item.assetId)?.currency || item.assetCurrency,
          liabilityAmount: item.liabilityAmount,
        })),
      });

      await (tx as any).safeguardingPoolSnapshot.createMany({
        data: poolSnapshots.map((item) => ({
          runId: run.id,
          assetId: item.assetId,
          assetCode: assetById.get(item.assetId)?.currency || item.assetCurrency,
          poolRole: item.poolRole,
          walletId: item.walletId,
          accountRef: item.accountRef,
          sourceType: item.sourceType,
          sourceRef: item.sourceRef,
          balanceAmount: item.balanceAmount,
        })),
      });

      const policies = await this.loadPolicies(Array.from(assetIds), tx);
      const warnings = await this.createWarningRecords(
        run,
        poolSnapshots.map((item) => ({
          ...item,
          assetCurrency: assetById.get(item.assetId)?.currency || item.assetCurrency,
        })),
        this.policyMap(policies),
        operatorId,
        tx as any,
      );

      if (statementAggregates.length) {
        await (tx as any).fiatStatementImport.updateMany({
          where: { id: { in: statementAggregates.flatMap((item) => item.importIds) } },
          data: { runId: run.id },
        });
      }

      const warningCounts = new Map<string, number>();
      for (const item of warnings) {
        warningCounts.set(item.assetId, (warningCounts.get(item.assetId) || 0) + 1);
      }

      const liabilityByAsset = new Map<string, Prisma.Decimal>();
      for (const row of liabilitySnapshots) {
        liabilityByAsset.set(
          row.assetId,
          this.toDecimal(liabilityByAsset.get(row.assetId)).plus(
            this.toDecimal(row.liabilityAmount),
          ),
        );
      }

      const poolByAsset = new Map<string, Prisma.Decimal>();
      for (const row of poolSnapshots) {
        poolByAsset.set(
          row.assetId,
          this.toDecimal(poolByAsset.get(row.assetId)).plus(
            this.toDecimal(row.balanceAmount),
          ),
        );
      }

      const externalByAsset = new Map<string, Prisma.Decimal>();
      for (const row of statementAggregates) {
        externalByAsset.set(row.assetId, row.totalClosingBalance);
      }

      const computations = Array.from(assetIds)
        .map((assetId) => {
          const asset = assetById.get(assetId);
          if (!asset) return null;
          return this.computeBreakForAsset(
            asset,
            liabilityByAsset.get(assetId) || new Prisma.Decimal(0),
            poolByAsset.get(assetId) || new Prisma.Decimal(0),
            externalByAsset.has(assetId) ? externalByAsset.get(assetId)! : null,
          );
        })
        .filter((item): item is BreakComputation => Boolean(item));

      const activeBreaks: any[] = [];
      for (const computation of computations) {
        const synced = await this.syncBreakForAsset(run, computation, operatorId, tx as any);
        if (synced?.active) {
          activeBreaks.push(synced.break);
        }
      }

      const finishedRun = await (tx as any).safeguardingRun.update({
        where: { id: run.id },
        data: {
          status: SafeguardingRunStatuses.COMPLETED,
          breakCount: activeBreaks.length,
          warningCount: warnings.length,
          finishedAt: new Date(),
          summaryJson: this.serializeJson(
            this.summarizeByAsset(computations, warningCounts),
          ),
        },
      });

      await this.recordAudit(
        {

          action: AuditActions.SAFEGUARDING_RUN_GENERATED,
          entityType: AuditEntityTypes.SAFEGUARDING_RUN,
          entityId: finishedRun.id,
          entityNo: finishedRun.runNo,
          traceId: finishedRun.traceId || null,
        },
        operatorId,
        tx as any,
      );

      return {
        runId: finishedRun.id,
        runNo: finishedRun.runNo,
        businessDate: finishedRun.businessDate,
        breakCount: finishedRun.breakCount,
        warningCount: finishedRun.warningCount,
        summaryByAsset: this.summarizeByAsset(computations, warningCounts),
      };
    });
  }

  async findAllForAdmin(query: SafeguardingBreakQueryDto) {
    const where: any = {
      sourceType: SAFEGUARDING_BREAK_SOURCE_TYPE,
    };
    if (query.businessDate) where.businessDate = query.businessDate;
    if (query.assetId) where.assetId = query.assetId;
    if (query.assetCurrency) where.assetCode = query.assetCurrency;
    if (query.status) where.status = query.status;
    if (query.breakType) where.breakType = query.breakType;

    const [items, total] = await Promise.all([
      (this.prisma as any).reconciliationBreak.findMany({
        where,
        skip: query.skip || 0,
        take: query.take || 20,
        orderBy: [{ businessDate: 'desc' }, { assetCode: 'asc' }],
        include: {
          run: true,
        },
      }),
      (this.prisma as any).reconciliationBreak.count({ where }),
    ]);

    return { items, total };
  }

  async findOneForAdmin(id: string) {
    const item = await (this.prisma as any).reconciliationBreak.findUnique({
      where: { id },
      include: {
        run: true,
      },
    });
    if (!item || item.sourceType !== SAFEGUARDING_BREAK_SOURCE_TYPE) {
      throw new NotFoundException('Safeguarding reconciliation break not found');
    }
    return {
      ...item,
      details: this.parseJson(item.detailsJson),
      linkedAlerts: [],
      linkedCases: [],
    };
  }

  async updateStatus(
    id: string,
    dto: UpdateReconciliationBreakStatusDto,
    operatorId: string,
  ) {
    const current = await (this.prisma as any).reconciliationBreak.findUnique({
      where: { id },
    });
    if (!current || current.sourceType !== SAFEGUARDING_BREAK_SOURCE_TYPE) {
      throw new NotFoundException('Safeguarding reconciliation break not found');
    }

    const updateData: any = {
      status: dto.status,
    };
    if (dto.status === ReconciliationBreakStatuses.RESOLVED) {
      updateData.resolvedAt = new Date();
    }
    const updated = await (this.prisma as any).reconciliationBreak.update({
      where: { id },
      data: updateData,
    });

    await this.recordAudit(
      {

        action:
          dto.status === ReconciliationBreakStatuses.RESOLVED
            ? AuditActions.TX_SAFEGUARDING_BREAK_RESOLVED
            : buildStateTransitionAction(
                'RECONCILIATION_BREAK',
                current.status,
                updated.status,
              ),
        entityType: AuditEntityTypes.RECONCILIATION_BREAK,
        entityId: updated.id,
        entityNo: updated.breakNo,
        reason: dto.note || undefined,
        traceId: updated.runId ? `SAFEGUARDING:${updated.businessDate}` : null,
      },
      operatorId,
      this.prisma,
    );

    return updated;
  }

  async findWarningsForAdmin(query: SafeguardingWarningQueryDto) {
    const where: any = {};
    if (query.businessDate) where.businessDate = query.businessDate;
    if (query.assetId) where.assetId = query.assetId;
    if (query.assetCurrency) where.assetCode = query.assetCurrency;
    if (query.poolRole) where.poolRole = query.poolRole;
    if (query.warningType) where.warningType = query.warningType;
    if (query.status) where.status = query.status;

    const [items, total] = await Promise.all([
      (this.prisma as any).reconciliationWarning.findMany({
        where,
        skip: query.skip || 0,
        take: query.take || 20,
        orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          run: true,
          wallet: true,
        },
      }),
      (this.prisma as any).reconciliationWarning.count({ where }),
    ]);

    return { items, total };
  }

  async findWarningForAdmin(id: string) {
    const item = await (this.prisma as any).reconciliationWarning.findUnique({
      where: { id },
      include: {
        run: true,
        wallet: true,
      },
    });
    if (!item) {
      throw new NotFoundException('Safeguarding reconciliation warning not found');
    }
    return {
      ...item,
      details: this.parseJson(item.detailsJson),
    };
  }

  async updateWarningStatus(
    id: string,
    dto: UpdateReconciliationWarningStatusDto,
    operatorId: string,
  ) {
    const current = await (this.prisma as any).reconciliationWarning.findUnique({
      where: { id },
    });
    if (!current) {
      throw new NotFoundException('Safeguarding reconciliation warning not found');
    }

    const updateData: any = {
      status: dto.status,
    };
    if (dto.status === ReconciliationWarningStatuses.ACKNOWLEDGED) {
      updateData.acknowledgedAt = new Date();
    }
    if (dto.status === ReconciliationWarningStatuses.RESOLVED) {
      updateData.resolvedAt = new Date();
    }
    if (dto.status === ReconciliationWarningStatuses.ACCEPTED) {
      updateData.acceptedAt = new Date();
    }

    const updated = await (this.prisma as any).reconciliationWarning.update({
      where: { id },
      data: updateData,
    });

    await this.recordAudit(
      {

        action: buildStateTransitionAction(
          'RECONCILIATION_WARNING',
          current.status,
          updated.status,
        ),
        entityType: AuditEntityTypes.RECONCILIATION_WARNING,
        entityId: updated.id,
        entityNo: updated.warningNo,
        reason: dto.note || undefined,
        traceId: `SAFEGUARDING:${updated.businessDate}`,
      },
      operatorId,
      this.prisma,
    );

    return updated;
  }

  async findRunsForAdmin(query: SafeguardingRunQueryDto) {
    const where: any = {};
    if (query.businessDate) where.businessDate = query.businessDate;

    const [items, total] = await Promise.all([
      (this.prisma as any).safeguardingRun.findMany({
        where,
        skip: query.skip || 0,
        take: query.take || 20,
        orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
      }),
      (this.prisma as any).safeguardingRun.count({ where }),
    ]);

    return { items, total };
  }

  async findRunForAdmin(id: string) {
    const run = await (this.prisma as any).safeguardingRun.findUnique({
      where: { id },
    });
    if (!run) {
      throw new NotFoundException('Safeguarding run not found');
    }

    const [liabilities, pools, warnings, breaks, statements] = await Promise.all([
      (this.prisma as any).liabilitySnapshot.findMany({
        where: { runId: id },
        orderBy: [{ assetCode: 'asc' }, { customerNo: 'asc' }],
      }),
      (this.prisma as any).safeguardingPoolSnapshot.findMany({
        where: { runId: id },
        orderBy: [{ assetCode: 'asc' }, { poolRole: 'asc' }],
        include: { wallet: true },
      }),
      (this.prisma as any).reconciliationWarning.findMany({
        where: { runId: id },
        orderBy: [{ assetCode: 'asc' }, { warningType: 'asc' }],
      }),
      (this.prisma as any).reconciliationBreak.findMany({
        where: { runId: id, sourceType: SAFEGUARDING_BREAK_SOURCE_TYPE },
        orderBy: [{ assetCode: 'asc' }],
      }),
      (this.prisma as any).fiatStatementImport.findMany({
        where: { runId: id },
        orderBy: [{ assetId: 'asc' }],
      }),
    ]);

    return {
      ...run,
      summary: this.parseJson(run.summaryJson),
      liabilities,
      pools,
      warnings,
      breaks,
      statements,
    };
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (inQuotes && line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
        continue;
      }
      current += char;
    }
    result.push(current.trim());
    return result;
  }

  private normalizeStatementHeader(header: string) {
    return String(header || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  private parseFiatStatementCsv(buffer: Buffer) {
    const content = buffer.toString('utf8').trim();
    if (!content) {
      throw new BadRequestException('Statement CSV is empty');
    }
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length < 2) {
      throw new BadRequestException('Statement CSV must include header and rows');
    }

    const headers = this.parseCsvLine(lines[0]).map((item) =>
      this.normalizeStatementHeader(item),
    );
    const valueDateIndex = headers.findIndex((item) =>
      ['valuedate', 'date', 'bookingdate'].includes(item),
    );
    const referenceIndex = headers.findIndex((item) =>
      ['referenceno', 'reference', 'ref'].includes(item),
    );
    const amountIndex = headers.findIndex((item) => item === 'amount');
    const balanceIndex = headers.findIndex((item) => item === 'balance');
    const descriptionIndex = headers.findIndex((item) =>
      ['description', 'details', 'narrative', 'memo'].includes(item),
    );

    if (amountIndex < 0 || balanceIndex < 0) {
      throw new BadRequestException(
        'Statement CSV must include amount and balance columns',
      );
    }

    const entries = lines.slice(1).map((line, index) => {
      const values = this.parseCsvLine(line);
      const amountValue = values[amountIndex];
      const balanceValue = values[balanceIndex];
      if (!amountValue || !balanceValue) {
        throw new BadRequestException(
          `Statement CSV row ${index + 2} is missing amount or balance`,
        );
      }
      return {
        lineNo: index + 1,
        valueDate: valueDateIndex >= 0 ? values[valueDateIndex] || null : null,
        referenceNo: referenceIndex >= 0 ? values[referenceIndex] || null : null,
        description:
          descriptionIndex >= 0 ? values[descriptionIndex] || null : null,
        amount: new Prisma.Decimal(amountValue),
        balance: new Prisma.Decimal(balanceValue),
        rawRowJson: JSON.stringify(
          headers.reduce<Record<string, string | null>>((acc, header, headerIndex) => {
            acc[header] = values[headerIndex] || null;
            return acc;
          }, {}),
        ),
      };
    });

    if (!entries.length) {
      throw new BadRequestException('Statement CSV must include at least one row');
    }

    const closingBalance = entries[entries.length - 1].balance;
    if (closingBalance === null || closingBalance === undefined) {
      throw new BadRequestException('Statement CSV closing balance is required');
    }

    return {
      entries,
      closingBalance,
    };
  }

  async importFiatStatement(
    dto: ImportFiatStatementDto,
    file: { originalname?: string; buffer?: Buffer } | undefined,
    operatorId: string,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('CSV file is required');
    }

    const [asset, wallet] = await Promise.all([
      (this.prisma as any).asset.findUnique({
        where: { id: dto.assetId },
      }),
      (this.prisma as any).wallet.findUnique({
        where: { id: dto.walletId },
      }),
    ]);

    if (!asset || String(asset.type || '').toUpperCase() !== 'FIAT') {
      throw new BadRequestException('Fiat asset is required for statement import');
    }
    if (!wallet) {
      throw new BadRequestException('Wallet not found');
    }
    if (wallet.assetId !== dto.assetId) {
      throw new BadRequestException('Wallet asset does not match statement asset');
    }
    if (String(wallet.walletRole || '').toUpperCase() !== SafeguardingPoolRoles.CUST_BANK) {
      throw new BadRequestException('Only C_CMA wallet can accept fiat statements');
    }
    const parsed = this.parseFiatStatementCsv(file.buffer);
    const businessDate = this.normalizeBusinessDate(dto.businessDate);

    return this.prisma.$transaction(async (tx) => {
      const created = await this.createStatementImportWithUniqueNo(tx as any, {
        runId: null,
        businessDate,
        assetId: dto.assetId,
        walletId: dto.walletId,
        fileName: file.originalname || 'statement.csv',
        status: FiatStatementImportStatuses.PENDING,
        closingBalance: null,
        traceId: `SAFEGUARDING:${businessDate}:${asset.currency}`,
        detailsJson: this.serializeJson({
          rowCount: parsed.entries.length,
        }),
      });

      await (tx as any).fiatStatementEntry.createMany({
        data: parsed.entries.map((item) => ({
          importId: created.id,
          lineNo: item.lineNo,
          valueDate: item.valueDate,
          referenceNo: item.referenceNo,
          description: item.description,
          amount: item.amount,
          balance: item.balance,
          rawRowJson: item.rawRowJson,
        })),
      });

      const updated = await (tx as any).fiatStatementImport.update({
        where: { id: created.id },
        data: {
          status: FiatStatementImportStatuses.READY,
          closingBalance: parsed.closingBalance,
          parsedAt: new Date(),
        },
      });

      await this.recordAudit(
        {

          action: AuditActions.FIAT_STATEMENT_IMPORTED,
          entityType: AuditEntityTypes.FIAT_STATEMENT_IMPORT,
          entityId: updated.id,
          entityNo: updated.importNo,
          traceId: updated.traceId || null,
        },
        operatorId,
        tx as any,
      );

      return updated;
    });
  }

  async findFiatStatementImports(query: FiatStatementImportQueryDto) {
    const where: any = {};
    if (query.businessDate) where.businessDate = query.businessDate;
    if (query.assetId) where.assetId = query.assetId;
    if (query.walletId) where.walletId = query.walletId;
    if (query.status) where.status = query.status;

    const [items, total] = await Promise.all([
      (this.prisma as any).fiatStatementImport.findMany({
        where,
        skip: query.skip || 0,
        take: query.take || 20,
        orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          asset: true,
          wallet: true,
        },
      }),
      (this.prisma as any).fiatStatementImport.count({ where }),
    ]);

    return { items, total };
  }

  async findFiatStatementImport(id: string) {
    const item = await (this.prisma as any).fiatStatementImport.findUnique({
      where: { id },
      include: {
        asset: true,
        wallet: true,
        entries: {
          orderBy: { lineNo: 'asc' },
        },
      },
    });
    if (!item) {
      throw new NotFoundException('Fiat statement import not found');
    }
    return {
      ...item,
      details: this.parseJson(item.detailsJson),
    };
  }

  async exportEvidencePackage(runId: string, operatorId: string) {
    const run = await this.findRunForAdmin(runId);
    const payload = {
      runId: run.id,
      runNo: run.runNo,
      businessDate: run.businessDate,
      exportedAt: new Date().toISOString(),
      summary: run.summary,
      liabilities: run.liabilities,
      pools: run.pools,
      warnings: run.warnings,
      breaks: run.breaks,
      statements: run.statements,
      traceId: run.traceId,
    };

    await this.recordAudit(
      {
        action: AuditActions.SAFEGUARDING_EVIDENCE_PACKAGE_EXPORTED,
        entityType: AuditEntityTypes.SAFEGUARDING_RUN,
        entityId: run.id,
        entityNo: run.runNo,
        traceId: run.traceId || null,
      },
      operatorId,
      this.prisma,
    );

    return payload;
  }
}
