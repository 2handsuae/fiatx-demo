import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ensureCustomerCanTransact } from '../shared/customer-transaction-guard';
import {
  AuditActions,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { OnboardingService } from '../../identity/onboarding/onboarding.service';
import { DepositTransactionsService } from './deposit-transactions.service';
import { FundsOrderService } from '../../funds-orders/funds-order.service';
import {
  FundsOrderAction,
  FundsOrderStatus,
} from '../../funds-orders/dto/funds-order.dto';
import {
  InboundTransferScanMode,
  CreateInboundTransferSignalDto,
  InboundTransferChannelType,
  InboundTransferSignalQueryDto,
  InboundTransferSignalStatus,
  ScanInboundTransferSignalsDto,
  SimulationRiskLevel,
  SimulationRiskReason,
} from './dto/inbound-transfer-signal.dto';
import { WalletRole } from '../../asset-treasury/wallets/dto/wallet.dto';

export interface ScanSummaryRecord {
  signalId: string;
  signalNo: string;
  payinId: string | null;
  payinNo: string | null;
  payinStatus: string | null;
  depositId: string | null;
  depositNo: string | null;
  depositStatus: string | null;
}

export interface ScanSummary {
  scannedCount: number;
  createdPayinCount: number;
  reusedPayinCount: number;
  blockedCount: number;
  failedCount: number;
  depositIds: string[];
  records: ScanSummaryRecord[];
}

@Injectable()
export class InboundTransferSignalsService {
  private readonly logger = new Logger(InboundTransferSignalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly depositService: DepositTransactionsService,
    private readonly fundsOrderService: FundsOrderService,
    private readonly onboardingService: OnboardingService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async findAllForCustomer(
    customerId: string,
    query: InboundTransferSignalQueryDto,
  ) {
    const where: Record<string, unknown> = {
      ownerId: customerId,
    };

    if (query.walletId) where.walletId = query.walletId;
    if (query.status) where.status = query.status;

    const [items, total] = await Promise.all([
      (this.prisma as any).inboundTransferSignal.findMany({
        where,
        skip: query.skip ?? 0,
        take: query.take ?? 20,
        orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
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
          wallet: {
            select: {
              id: true,
              address: true,
              iban: true,
              walletNo: true,
              type: true,
              walletRole: true,
            },
          },
        },
      }),
      (this.prisma as any).inboundTransferSignal.count({ where }),
    ]);

    return { items, total };
  }

  async createForCustomer(
    customerId: string,
    dto: CreateInboundTransferSignalDto,
  ) {
    await this.onboardingService.assertTradingEligibility(customerId, 'DEPOSIT');
    const customer = await (this.prisma as any).customerMain.findUnique({
      where: { id: customerId },
    });
    ensureCustomerCanTransact(customer);
    const wallet = await this.getCustomerDepositWalletOrThrow(customerId, dto.walletId);
    const channelType = this.getChannelTypeFromWallet(wallet);

    if (channelType === InboundTransferChannelType.CRYPTO) {
      if (!dto.txHash || !dto.fromAddress) {
        throw new BadRequestException(
          'Crypto inbound signal requires txHash and fromAddress',
        );
      }
    } else if (!dto.referenceNo || !dto.fromIban) {
      throw new BadRequestException(
        'Fiat inbound signal requires referenceNo and fromIban',
      );
    }

    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(new Prisma.Decimal(0))) {
      throw new BadRequestException('Inbound signal amount must be greater than 0');
    }

    this.assertSimulationRiskProfile(dto, channelType);

    const dedupeKey = this.buildDedupeKey({
      channelType,
      walletId: wallet.id,
      assetId: wallet.assetId,
      txHash: dto.txHash,
      referenceNo: dto.referenceNo,
    });

    const existing = await (this.prisma as any).inboundTransferSignal.findUnique({
      where: { dedupeKey },
      include: {
        asset: {
          select: { id: true, code: true, type: true, network: true, decimals: true },
        },
        wallet: {
          select: {
            id: true,
            address: true,
            iban: true,
            walletNo: true,
            type: true,
            walletRole: true,
          },
        },
      },
    });
    if (existing) return existing;

    try {
      const created = await (this.prisma as any).inboundTransferSignal.create({
        data: {
          signalNo: generateReferenceNo('SIG'),
          ownerId: customerId,
          walletId: wallet.id,
          assetId: wallet.assetId,
          channelType,
          amount,
          txHash: dto.txHash,
          referenceNo: dto.referenceNo,
          fromAddress: dto.fromAddress,
          fromIban: dto.fromIban,
          simulationRiskLevel: dto.simulationRiskLevel || null,
          simulationRiskReason: dto.simulationRiskReason || null,
          status: InboundTransferSignalStatus.PENDING_SCAN,
          dedupeKey,
          submittedAt: new Date(),
        },
      });

      await this.recordSignalAudit({
        action: AuditActions.INBOUND_SIGNAL_SUBMITTED,
        signal: created,
        reason: 'Customer submitted inbound transfer signal',

        metadata: {
          signalId: created.id,
          walletId: created.walletId,
          assetId: created.assetId,
          ownerId: created.ownerId,
        },
        sourcePlatform: 'CUSTOMER_API',
      });

      return (this.prisma as any).inboundTransferSignal.findUnique({
        where: { id: created.id },
        include: {
          asset: {
            select: { id: true, code: true, type: true, network: true, decimals: true },
          },
          wallet: {
            select: {
              id: true,
              address: true,
              iban: true,
              walletNo: true,
              type: true,
              walletRole: true,
            },
          },
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return (this.prisma as any).inboundTransferSignal.findUnique({
          where: { dedupeKey },
        });
      }
      throw error;
    }
  }

  async scanForCustomer(
    customerId: string,
    dto: ScanInboundTransferSignalsDto,
  ): Promise<ScanSummary> {
    const wallet = await this.getCustomerDepositWalletOrThrow(customerId, dto.walletId);
    const signals = await (this.prisma as any).inboundTransferSignal.findMany({
      where: {
        ownerId: customerId,
        walletId: dto.walletId,
        status: InboundTransferSignalStatus.PENDING_SCAN,
      },
      orderBy: [{ submittedAt: 'asc' }, { createdAt: 'asc' }],
    });

    const summary: ScanSummary = {
      scannedCount: 0,
      createdPayinCount: 0,
      reusedPayinCount: 0,
      blockedCount: 0,
      failedCount: 0,
      depositIds: [],
      records: [],
    };
    const depositIds = new Set<string>();

    let tradingGateError: unknown = null;
    try {
      await this.onboardingService.assertTradingEligibility(customerId, 'DEPOSIT');
    } catch (error) {
      tradingGateError = error;
    }

    for (const signal of signals) {
      summary.scannedCount += 1;

      await this.recordSignalAudit({
        action: AuditActions.INBOUND_SIGNAL_SCANNED,
        signal,
        reason: 'Customer triggered inbound transfer scan',

        metadata: {
          signalId: signal.id,
          walletId: signal.walletId,
          assetId: signal.assetId,
          ownerId: signal.ownerId,
        },
        sourcePlatform: 'CUSTOMER_API',
      });

      if (tradingGateError) {
        const blockedReason = this.describeError(tradingGateError);
        await this.markSignalIgnored(signal, blockedReason);
        summary.blockedCount += 1;
        continue;
      }

      try {
        const processed = await this.processSignal(
          signal,
          wallet,
          dto.mode || InboundTransferScanMode.QUICK_DEMO,
        );
        if (processed.createdPayin) {
          summary.createdPayinCount += 1;
        } else {
          summary.reusedPayinCount += 1;
        }
        if (processed.depositId) {
          depositIds.add(processed.depositId);
        }
        summary.records.push({
          signalId: signal.id,
          signalNo: signal.signalNo,
          payinId: processed.payinId,
          payinNo: processed.payinNo,
          payinStatus: processed.payinStatus,
          depositId: processed.depositId,
          depositNo: processed.depositNo,
          depositStatus: processed.depositStatus,
        });
      } catch (error) {
        const failureReason = this.describeError(error);
        this.logger.warn(
          `Failed scanning inbound transfer signal ${signal.id}: ${failureReason}`,
        );
        await (this.prisma as any).inboundTransferSignal.update({
          where: { id: signal.id },
          data: {
            status: InboundTransferSignalStatus.FAILED,
            lastScannedAt: new Date(),
            scanResult: failureReason,
          },
        });
        await this.recordSignalAudit({
          action: AuditActions.INBOUND_SIGNAL_FAILED,
          signal,
          reason: failureReason,
  
          metadata: {
            signalId: signal.id,
            walletId: signal.walletId,
            assetId: signal.assetId,
            ownerId: signal.ownerId,
          },
          sourcePlatform: 'CUSTOMER_API',
        });
        summary.failedCount += 1;
      }
    }

    summary.depositIds = Array.from(depositIds);
    return summary;
  }

  private async processSignal(
    signal: any,
    wallet: any,
    mode: InboundTransferScanMode = InboundTransferScanMode.QUICK_DEMO,
  ) {
    const existing = await this.resolveExistingDeposit(signal);
    const createdDeposit = !existing;

    let deposit: any;
    let fundsOrder: any;
    if (existing) {
      deposit = existing.deposit;
      fundsOrder = existing.fundsOrder;
    } else {
      const detected = await this.depositService.detected({
        assetId: signal.assetId,
        toWalletId: signal.walletId,
        amount: signal.amount.toString(),
        txHash: signal.txHash || undefined,
        fromAddress: signal.fromAddress || undefined,
        fromIban: signal.fromIban || undefined,
        referenceNo: signal.referenceNo || undefined,
        providerTxnId: signal.id,
      });
      deposit = detected.deposit;
      fundsOrder = detected.fundsOrder;
    }

    // QUICK_DEMO advances the funds_order to CLEARED (crypto needs the two-hop
    // OBSERVE_CONFIRMING → CONFIRM; fiat is CONFIRMED-at-birth and auto-driven by
    // the workflow's funds_order.status.changed handler). INTERACTIVE stops at the
    // freshly-created funds_order so an operator can drive it manually.
    if (mode !== InboundTransferScanMode.INTERACTIVE && fundsOrder) {
      fundsOrder = await this.advanceFundsOrder(fundsOrder.id, signal.channelType);
    }
    // Re-read the deposit after driving so its status reflects the workflow.
    deposit = await this.findDeposit(deposit.id);

    await (this.prisma as any).inboundTransferSignal.update({
      where: { id: signal.id },
      data: {
        status: InboundTransferSignalStatus.PAYIN_CREATED,
        lastScannedAt: new Date(),
        scanResult: deposit
          ? `Matched to funds order ${fundsOrder?.fundsOrderNo} and deposit ${deposit.depositNo}`
          : `Matched to funds order ${fundsOrder?.fundsOrderNo}`,
      },
    });

    await this.recordSignalAudit({
      action: AuditActions.INBOUND_SIGNAL_MATCHED,
      signal,
      reason: createdDeposit
        ? 'Inbound transfer signal created new deposit'
        : 'Inbound transfer signal reused existing deposit',
      metadata: {
        signalId: signal.id,
        walletId: signal.walletId,
        assetId: signal.assetId,
        ownerId: signal.ownerId,
        fundsOrderId: fundsOrder?.id || null,
        depositId: deposit?.id || null,
      },
      sourcePlatform: 'CUSTOMER_API',
    });

    if (
      String(fundsOrder?.status || '').toUpperCase() === FundsOrderStatus.FAILED
    ) {
      throw new BadRequestException(`Funds order ${fundsOrder.id} is FAILED`);
    }

    return {
      createdPayin: createdDeposit,
      payinId: fundsOrder?.id || null,
      payinNo: fundsOrder?.fundsOrderNo || null,
      payinStatus: fundsOrder?.status || null,
      depositId: deposit?.id || null,
      depositNo: deposit?.depositNo || null,
      depositStatus: deposit?.status || null,
    };
  }

  /**
   * Dedup a re-scanned signal to its already-created deposit (+ payin funds_order).
   * A funds_order carries the signal id in providerTxnId (set on detected()), so
   * that is the primary key; fall back to wallet + txHash / referenceNo for signals
   * created before providerTxnId was recorded.
   */
  private async resolveExistingDeposit(
    signal: any,
  ): Promise<{ deposit: any; fundsOrder: any } | null> {
    const byProviderTxnId = await (this.prisma as any).fundsOrder.findFirst({
      where: { providerTxnId: signal.id, depositTransactionId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    if (byProviderTxnId) {
      return this.hydrateDepositFundsOrder(byProviderTxnId);
    }

    const walletMatch =
      signal.channelType === InboundTransferChannelType.CRYPTO && signal.txHash
        ? { toWalletId: signal.walletId, txHash: signal.txHash }
        : signal.channelType === InboundTransferChannelType.FIAT &&
            signal.referenceNo
          ? { toWalletId: signal.walletId, referenceNo: signal.referenceNo }
          : null;
    if (walletMatch) {
      const byWallet = await (this.prisma as any).fundsOrder.findFirst({
        where: { ...walletMatch, depositTransactionId: { not: null } },
        orderBy: { createdAt: 'desc' },
      });
      if (byWallet) return this.hydrateDepositFundsOrder(byWallet);
    }

    return null;
  }

  private async hydrateDepositFundsOrder(fundsOrder: any) {
    const deposit = await this.findDeposit(fundsOrder.depositTransactionId);
    return { deposit, fundsOrder };
  }

  /**
   * Drive a payin funds_order to CLEARED. Crypto is born SUBMITTED and needs
   * OBSERVE_CONFIRMING → CONFIRM; fiat is born CONFIRMED. In both cases the
   * workflow's funds_order.status.changed handler carries the order the rest of the
   * way (CONFIRMED → CLEAR), so we advance only as far as the inbound scan owns.
   */
  private async advanceFundsOrder(
    fundsOrderId: string,
    channelType: InboundTransferChannelType,
  ) {
    let current = await this.fundsOrderService.findById(fundsOrderId);
    if (!current) {
      throw new NotFoundException(`Funds order not found: ${fundsOrderId}`);
    }

    if (
      channelType === InboundTransferChannelType.CRYPTO &&
      current.status === FundsOrderStatus.SUBMITTED
    ) {
      await this.fundsOrderService.advance(
        fundsOrderId,
        FundsOrderAction.OBSERVE_CONFIRMING,
        'SYSTEM',
      );
      current = await this.fundsOrderService.findById(fundsOrderId);
    }

    if (current?.status === FundsOrderStatus.CONFIRMING) {
      await this.fundsOrderService.advance(
        fundsOrderId,
        FundsOrderAction.CONFIRM,
        'SYSTEM',
      );
      current = await this.fundsOrderService.findById(fundsOrderId);
    }

    if (!current) {
      throw new NotFoundException(
        `Funds order not found after update: ${fundsOrderId}`,
      );
    }

    return current;
  }

  private async findDeposit(depositId: string) {
    return (this.prisma as any).depositTransaction.findUnique({
      where: { id: depositId },
    });
  }

  private async getCustomerDepositWalletOrThrow(customerId: string, walletId: string) {
    const wallet = await (this.prisma as any).wallet.findUnique({
      where: { id: walletId },
      include: {
        asset: true,
      },
    });
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }
    const DEPOSIT_WALLET_ROLES = new Set([WalletRole.C_DEP, WalletRole.C_VIBAN]);
    if (
      wallet.ownerType !== 'CUSTOMER' ||
      wallet.ownerId !== customerId ||
      !DEPOSIT_WALLET_ROLES.has(wallet.walletRole as WalletRole)
    ) {
      throw new ForbiddenException('Customer can only use own deposit wallet');
    }
    if (wallet.status !== 'ACTIVE') {
      throw new BadRequestException('Deposit wallet must be ACTIVE');
    }
    return wallet;
  }

  private getChannelTypeFromWallet(wallet: any): InboundTransferChannelType {
    const type = String(wallet.asset?.type || '').toUpperCase();
    if (type === InboundTransferChannelType.CRYPTO) {
      return InboundTransferChannelType.CRYPTO;
    }
    if (type === InboundTransferChannelType.FIAT) {
      return InboundTransferChannelType.FIAT;
    }
    throw new BadRequestException(`Unsupported wallet asset type: ${wallet.asset?.type}`);
  }

  private buildDedupeKey(input: {
    channelType: InboundTransferChannelType;
    walletId: string;
    assetId: string;
    txHash?: string;
    referenceNo?: string;
  }) {
    const uniquePart =
      input.channelType === InboundTransferChannelType.CRYPTO
        ? this.normalizeToken(input.txHash)
        : this.normalizeToken(input.referenceNo);
    if (!uniquePart) {
      throw new BadRequestException('Inbound signal dedupe identifier is required');
    }

    return [
      input.channelType,
      this.normalizeToken(input.walletId),
      this.normalizeToken(input.assetId),
      uniquePart,
    ].join(':');
  }

  private normalizeToken(value?: string | null) {
    return String(value || '').trim().toLowerCase();
  }

  private assertSimulationRiskProfile(
    dto: CreateInboundTransferSignalDto,
    channelType: InboundTransferChannelType,
  ) {
    const level = String(dto.simulationRiskLevel || '').trim().toUpperCase();
    const reason = String(dto.simulationRiskReason || '').trim().toUpperCase();

    if (!level) {
      return;
    }

    if (level === SimulationRiskLevel.LOW) {
      if (reason) {
        throw new BadRequestException('LOW simulation risk does not accept a reason.');
      }
      return;
    }

    if (level === SimulationRiskLevel.MEDIUM) {
      const allowedReasons =
        channelType === InboundTransferChannelType.FIAT
          ? [SimulationRiskReason.LARGE_DEPOSIT_PROFILE_MISMATCH]
          : [
              SimulationRiskReason.KYT_ISSUE,
              SimulationRiskReason.TRAVEL_RULE_ISSUE,
              SimulationRiskReason.LARGE_DEPOSIT_PROFILE_MISMATCH,
            ];
      if (!allowedReasons.includes(reason as SimulationRiskReason)) {
        throw new BadRequestException(
          channelType === InboundTransferChannelType.FIAT
            ? 'FIAT MEDIUM simulation risk requires LARGE_DEPOSIT_PROFILE_MISMATCH.'
            : 'CRYPTO MEDIUM simulation risk requires KYT_ISSUE, TRAVEL_RULE_ISSUE, or LARGE_DEPOSIT_PROFILE_MISMATCH.',
        );
      }
      return;
    }

    if (level === SimulationRiskLevel.HIGH) {
      if (reason !== SimulationRiskReason.SANCTIONS_HIT) {
        throw new BadRequestException(
          'HIGH simulation risk requires SANCTIONS_HIT.',
        );
      }
      return;
    }

    throw new BadRequestException(`Unsupported simulation risk level: ${level}`);
  }

  private async markSignalIgnored(signal: any, reason: string) {
    await (this.prisma as any).inboundTransferSignal.update({
      where: { id: signal.id },
      data: {
        status: InboundTransferSignalStatus.IGNORED,
        lastScannedAt: new Date(),
        scanResult: reason,
      },
    });
    await this.recordSignalAudit({
      action: AuditActions.INBOUND_SIGNAL_BLOCKED,
      signal,
      reason,
      metadata: {
        signalId: signal.id,
        walletId: signal.walletId,
        assetId: signal.assetId,
        ownerId: signal.ownerId,
      },
      sourcePlatform: 'CUSTOMER_API',
    });
  }

  private async recordSignalAudit(params: {
    action: string;
    signal: any;
    reason: string;
    metadata: Record<string, unknown>;
    sourcePlatform: string;
  }) {
    const { action, signal, reason, metadata, sourcePlatform } = params;
    await this.auditLogsService.recordSystem({
      action,
      entityType: AuditEntityTypes.INBOUND_TRANSFER_SIGNAL,
      entityId: signal.id,
      entityNo: signal.signalNo,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: signal.ownerId,
      workflowType: 'DEPOSIT',
      reason,
      metadata,
      sourcePlatform,
    });
  }

  private describeError(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'object' && error && 'message' in error) {
      return String((error as any).message);
    }
    return 'Unknown error';
  }
}
