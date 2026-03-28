import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { JournalQueryDto } from './dto/journal.dto';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

@Injectable()
export class JournalsService {
  private readonly logger = new Logger(JournalsService.name);
  private static readonly WALLET_TRACKED_SOURCE_TYPES = new Set([
    'DEPOSIT',
    'WITHDRAW',
    'WITHDRAWAL',
    'INTERNAL_TX',
  ]);

  constructor(private prisma: PrismaService) {}

  private resolveWalletBalanceBucket(
    accountCode: string | null | undefined,
  ): 'AVAILABLE' | 'RESTRICTED' | 'IN_TRANSIT' | null {
    if (!accountCode) return null;
    if (accountCode === 'A.CUSTODY' || accountCode === 'A.BANK') {
      return 'AVAILABLE';
    }
    if (
      accountCode === 'A.CUSTODY_RESTRICTED' ||
      accountCode === 'A.BANK_RESTRICTED'
    ) {
      return 'RESTRICTED';
    }
    if (
      accountCode === 'A.CUSTODY_IN_TRANSIT' ||
      accountCode === 'A.BANK_IN_TRANSIT'
    ) {
      return 'IN_TRANSIT';
    }
    return null;
  }

  private isAssetAccount(accountCode: string | null | undefined): boolean {
    return typeof accountCode === 'string' && accountCode.startsWith('A.');
  }

  private extractWalletIdFromDimensions(dimensions: string): string | null {
    if (!dimensions) return null;
    try {
      const parsed = JSON.parse(dimensions);
      if (!parsed || typeof parsed !== 'object') return null;
      const raw = (parsed as Record<string, unknown>).walletId;
      if (typeof raw !== 'string') return null;
      const trimmed = raw.trim();
      if (!trimmed || trimmed.includes('{{') || trimmed.includes('}}')) {
        return null;
      }
      return trimmed ? trimmed : null;
    } catch {
      return null;
    }
  }

  private shouldEnforceWalletId(sourceType: string): boolean {
    return JournalsService.WALLET_TRACKED_SOURCE_TYPES.has(String(sourceType || '').toUpperCase());
  }

  private assertAssetLinesHaveWalletId(
    sourceType: string,
    eventCode: string,
    lines: Array<{
      lineNo: number;
      accountCode: string;
      walletId?: string | null;
    }>,
  ) {
    if (!this.shouldEnforceWalletId(sourceType)) return;

    for (const line of lines) {
      if (!this.isAssetAccount(line.accountCode)) continue;
      if (line.walletId) continue;

      throw new BadRequestException({
        code: 'WALLET_ID_REQUIRED',
        message: `walletId is required for asset line ${line.lineNo} (${line.accountCode}) on ${sourceType} ${eventCode}`,
      });
    }
  }

  private async alignAssetLineOwnerTypeWithWallet(
    client: Prisma.TransactionClient,
    lines: Array<{
      accountCode: string;
      ownerType?: string | null;
      walletId?: string | null;
    }>,
  ) {
    const walletIds = Array.from(
      new Set(
        lines
          .map((line) => line.walletId)
          .filter(
            (walletId): walletId is string =>
              typeof walletId === 'string' && walletId.length > 0,
          ),
      ),
    );

    if (!walletIds.length) return;

    const wallets = await (client as any).wallet.findMany({
      where: { id: { in: walletIds } },
      select: { id: true, ownerType: true },
    });
    const walletById = new Map<string, { id: string; ownerType: string }>(
      wallets.map((wallet: { id: string; ownerType: string }) => [
        wallet.id,
        wallet,
      ]),
    );

    for (const line of lines) {
      if (!line.walletId || !this.isAssetAccount(line.accountCode)) continue;
      const wallet = walletById.get(line.walletId);
      if (!wallet) {
        throw new BadRequestException(
          `Wallet ${line.walletId} not found for asset journal line`,
        );
      }
      line.ownerType = wallet.ownerType;
    }
  }

  private async projectWalletBalances(
    client: Prisma.TransactionClient,
    lines: Array<{
      id: string;
      walletId?: string | null;
      assetId?: string | null;
      accountCode: string;
      drCr: string;
      amount: Prisma.Decimal;
    }>,
  ) {
    const candidates = lines.filter(
      (line) => line.walletId && line.assetId && this.resolveWalletBalanceBucket(line.accountCode),
    );
    if (!candidates.length) return;

    const existingEntries = await (client as any).walletBalanceEntry.findMany({
      where: { journalLineId: { in: candidates.map((line) => line.id) } },
      select: { journalLineId: true },
    });
    const projectedLineIds = new Set(
      existingEntries.map((entry: { journalLineId: string }) => entry.journalLineId),
    );

    const pending = candidates.filter(
      (line) => !projectedLineIds.has(line.id) && line.walletId && line.assetId,
    );
    if (!pending.length) return;

    const balanceDeltaByBucket = new Map<
      string,
      {
        walletId: string;
        assetId: string;
        bucket: 'AVAILABLE' | 'RESTRICTED' | 'IN_TRANSIT';
        delta: Prisma.Decimal;
      }
    >();
    for (const line of pending) {
      if (!line.walletId || !line.assetId) continue;
      const bucket = this.resolveWalletBalanceBucket(line.accountCode);
      if (!bucket) continue;

      const direction = line.drCr === 'DR' ? new Prisma.Decimal(1) : new Prisma.Decimal(-1);
      const delta = this.parseDecimal(line.amount).mul(direction);
      const bucketKey = `${line.walletId}::${line.assetId}::${bucket}`;

      const existing = balanceDeltaByBucket.get(bucketKey);
      if (existing) {
        existing.delta = existing.delta.plus(delta);
      } else {
        balanceDeltaByBucket.set(bucketKey, {
          walletId: line.walletId,
          assetId: line.assetId,
          bucket,
          delta,
        });
      }
    }

    if (balanceDeltaByBucket.size > 0) {
      const walletIds = Array.from(
        new Set(
          Array.from(balanceDeltaByBucket.values()).map((item) => item.walletId),
        ),
      );
      const assetIds = Array.from(
        new Set(
          Array.from(balanceDeltaByBucket.values()).map((item) => item.assetId),
        ),
      );

      const snapshots = await (client as any).walletBalanceSnapshot.findMany({
        where: {
          walletId: { in: walletIds },
          assetId: { in: assetIds },
        },
        select: {
          walletId: true,
          assetId: true,
          availableBalance: true,
          restrictedBalance: true,
          inTransitBalance: true,
        },
      });
      const snapshotByKey = new Map<
        string,
        {
          availableBalance: Prisma.Decimal | string | number;
          restrictedBalance: Prisma.Decimal | string | number;
          inTransitBalance: Prisma.Decimal | string | number;
        }
      >(
        snapshots.map((snapshot: any) => [
          `${snapshot.walletId}::${snapshot.assetId}`,
          {
            availableBalance: snapshot.availableBalance,
            restrictedBalance: snapshot.restrictedBalance,
            inTransitBalance: snapshot.inTransitBalance,
          },
        ]),
      );

      for (const deltaItem of balanceDeltaByBucket.values()) {
        const snapshot = snapshotByKey.get(
          `${deltaItem.walletId}::${deltaItem.assetId}`,
        );
        const current =
          deltaItem.bucket === 'AVAILABLE'
            ? this.parseDecimal(snapshot?.availableBalance)
            : deltaItem.bucket === 'RESTRICTED'
              ? this.parseDecimal(snapshot?.restrictedBalance)
              : this.parseDecimal(snapshot?.inTransitBalance);
        const next = current.plus(deltaItem.delta);
        if (next.lt(0)) {
          throw new BadRequestException({
            code: 'INSUFFICIENT_WALLET_BALANCE',
            message: `Insufficient ${deltaItem.bucket.toLowerCase()} balance for wallet ${deltaItem.walletId} asset ${deltaItem.assetId}`,
          });
        }
      }
    }

    for (const line of pending) {
      if (!line.walletId || !line.assetId) continue;
      const bucket = this.resolveWalletBalanceBucket(line.accountCode);
      if (!bucket) continue;

      const direction = line.drCr === 'DR' ? new Prisma.Decimal(1) : new Prisma.Decimal(-1);
      const amount = this.parseDecimal(line.amount);
      const delta = amount.mul(direction);
      const deltaAvailable = bucket === 'AVAILABLE' ? delta : new Prisma.Decimal(0);
      const deltaRestricted = bucket === 'RESTRICTED' ? delta : new Prisma.Decimal(0);
      const deltaInTransit = bucket === 'IN_TRANSIT' ? delta : new Prisma.Decimal(0);

      await (client as any).walletBalanceEntry.create({
        data: {
          journalLineId: line.id,
          walletId: line.walletId,
          assetId: line.assetId,
          accountCode: line.accountCode,
          drCr: line.drCr,
          amount,
          deltaAvailable,
          deltaRestricted,
          deltaInTransit,
        },
      });

      await (client as any).walletBalanceSnapshot.upsert({
        where: {
          walletId_assetId: {
            walletId: line.walletId,
            assetId: line.assetId,
          },
        },
        update: {
          availableBalance: { increment: deltaAvailable },
          restrictedBalance: { increment: deltaRestricted },
          inTransitBalance: { increment: deltaInTransit },
          totalBalance: { increment: delta },
          lastJournalLineId: line.id,
        },
        create: {
          walletId: line.walletId,
          assetId: line.assetId,
          availableBalance: deltaAvailable,
          restrictedBalance: deltaRestricted,
          inTransitBalance: deltaInTransit,
          totalBalance: delta,
          lastJournalLineId: line.id,
        },
      });
    }
  }

  private toCanonicalSourcePath(source: string): string {
    if (source === 'source') return 'src';
    if (source.startsWith('source.')) return `src.${source.slice('source.'.length)}`;
    return source;
  }

  private resolveTemplateValue(
    source: string | null | undefined,
    context: any,
  ): string | null {
    if (!source) return null;
    const normalizedSource = this.toCanonicalSourcePath(source);

    // 1. Handle FIXED_ prefix
    if (normalizedSource.startsWith('FIXED_')) {
      return normalizedSource.replace('FIXED_', '');
    }

    // 2. Try to resolve as path if it contains a dot or exists in context
    if (normalizedSource.includes('.')) {
      const keys = normalizedSource.split('.');
      let value = context;
      for (const key of keys) {
        if (value && Object.prototype.hasOwnProperty.call(value, key)) {
          value = value[key];
        } else {
          return null;
        }
      }
      return value !== undefined ? String(value) : null;
    }

    // 3. If it exists in context root (like 'src'), resolve it
    if (
      context &&
      Object.prototype.hasOwnProperty.call(context, normalizedSource)
    ) {
      return String(context[normalizedSource]);
    }

    // 4. Otherwise, treat as a literal fixed value (e.g., "CUSTOMER", "PLATFORM")
    // This maintains backward compatibility with existing seed data
    return normalizedSource;
  }

  private processTemplateString(
    templateStr: string | null | undefined,
    context: any,
  ): string {
    if (!templateStr || templateStr === '{}') return templateStr || '{}';

    try {
      let result = templateStr;
      result = result.replace(/\{\{([\w\.]+)\}\}/g, (match, path) => {
        const val = this.resolveTemplateValue(path, context);
        return val !== null ? val : match;
      });
      return result;
    } catch (e) {
      this.logger.error('Error processing template string', e);
      return templateStr;
    }
  }

  private parseDecimal(value: Prisma.Decimal | string | number | null | undefined): Prisma.Decimal {
    if (value === null || value === undefined) return new Prisma.Decimal(0);
    if (value instanceof Prisma.Decimal) return value;
    return new Prisma.Decimal(value);
  }

  private assertJournalBalancedByAsset(
    lines: Array<{
      lineNo: number;
      drCr: string;
      amount: Prisma.Decimal;
      assetId: string | null | undefined;
    }>,
    eventCode: string,
  ) {
    const balanceByAsset = new Map<string, { dr: Prisma.Decimal; cr: Prisma.Decimal }>();

    for (const line of lines) {
      if (!line.assetId) {
        throw new BadRequestException({
          code: 'JOURNAL_IMBALANCED',
          message: `Missing assetId on journal line ${line.lineNo} (${eventCode})`,
        });
      }

      const amount = this.parseDecimal(line.amount);
      if (amount.lt(0)) {
        throw new BadRequestException({
          code: 'JOURNAL_IMBALANCED',
          message: `Negative amount on journal line ${line.lineNo} (${eventCode})`,
        });
      }

      const bucket = balanceByAsset.get(line.assetId) || {
        dr: new Prisma.Decimal(0),
        cr: new Prisma.Decimal(0),
      };

      if (line.drCr === 'DR') {
        bucket.dr = bucket.dr.plus(amount);
      } else if (line.drCr === 'CR') {
        bucket.cr = bucket.cr.plus(amount);
      } else {
        throw new BadRequestException({
          code: 'JOURNAL_IMBALANCED',
          message: `Invalid drCr "${line.drCr}" on journal line ${line.lineNo} (${eventCode})`,
        });
      }

      balanceByAsset.set(line.assetId, bucket);
    }

    for (const [assetId, totals] of balanceByAsset.entries()) {
      if (!totals.dr.eq(totals.cr)) {
        throw new BadRequestException({
          code: 'JOURNAL_IMBALANCED',
          message: `Journal not balanced for asset ${assetId} (${eventCode}), DR=${totals.dr.toString()} CR=${totals.cr.toString()}`,
        });
      }
    }
  }

  async getCustomerLiabilityBalance(
    params: {
      ownerId: string;
      assetId: string;
      ownerType?: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const { ownerId, assetId, ownerType = 'CUSTOMER' } = params;
    const client = tx || this.prisma;

    const [creditCr, creditDr, heldCr, heldDr] = await Promise.all([
      (client as any).journalLine.aggregate({
        _sum: { amount: true },
        where: {
          accountCode: 'L.CLIENT_CREDIT',
          ownerType,
          ownerId,
          assetId,
          drCr: 'CR',
        },
      }),
      (client as any).journalLine.aggregate({
        _sum: { amount: true },
        where: {
          accountCode: 'L.CLIENT_CREDIT',
          ownerType,
          ownerId,
          assetId,
          drCr: 'DR',
        },
      }),
      (client as any).journalLine.aggregate({
        _sum: { amount: true },
        where: {
          accountCode: 'L.CLIENT_HELD',
          ownerType,
          ownerId,
          assetId,
          drCr: 'CR',
        },
      }),
      (client as any).journalLine.aggregate({
        _sum: { amount: true },
        where: {
          accountCode: 'L.CLIENT_HELD',
          ownerType,
          ownerId,
          assetId,
          drCr: 'DR',
        },
      }),
    ]);

    const creditBalance = this.parseDecimal(creditCr?._sum?.amount).minus(
      this.parseDecimal(creditDr?._sum?.amount),
    );
    const heldBalance = this.parseDecimal(heldCr?._sum?.amount).minus(
      this.parseDecimal(heldDr?._sum?.amount),
    );
    const availableBalance = creditBalance;

    return {
      ownerId,
      ownerType,
      assetId,
      availableBalance,
      creditBalance,
      heldBalance,
    };
  }

  async createJournal(params: {
    sourceType: string;
    sourceId: string;
    eventCode: string;
    context: any;
  }, tx?: Prisma.TransactionClient) {
    const { sourceType, sourceId, eventCode, context } = params;
    const client = tx || this.prisma;

    // Idempotency check
    const existing = await (client as any).journal.findFirst({
      where: { sourceType, sourceId, eventCode },
      include: { lines: true },
    });

    if (existing) {
      this.logger.log(
        `Journal entry already exists for ${sourceType} ${sourceId} event ${eventCode}`,
      );
      return existing;
    }

    // Find Template
    const template = await (client as any).journalHeaderTemplate.findFirst(
      {
        where: { eventCode, status: 'ACTIVE' },
        include: { journalLineTemplates: true },
      },
    );

    if (!template) {
      this.logger.error(
        `No active journal template found for event ${eventCode}. Please check JournalHeaderTemplate table.`,
      );
      throw new NotFoundException(
        `No active journal template found for event ${eventCode}`,
      );
    }

    this.logger.log(
      `Creating journal entry using template ${template.templateCode}`,
    );

    // Resolve Source No
    let sourceNo = null;
    try {
      if (sourceType === 'DEPOSIT') {
        sourceNo = context.src.depositNo;
      } else if (sourceType === 'SWAP') {
        const source = await (client as any).swapTransaction.findUnique({ where: { id: sourceId }, select: { swapNo: true } });
        sourceNo = source?.swapNo;
      } else if (sourceType === 'WITHDRAWAL' || sourceType === 'WITHDRAW') {
        const source = await (client as any).withdrawTransaction.findUnique({ where: { id: sourceId }, select: { withdrawNo: true } });
        sourceNo = source?.withdrawNo;
      } else if (sourceType === 'PAYIN') {
        const source = await (client as any).payin.findUnique({ where: { id: sourceId }, select: { payinNo: true } });
        sourceNo = source?.payinNo;
      } else if (sourceType === 'PAYOUT') {
        const source = await (client as any).payout.findUnique({ where: { id: sourceId }, select: { payoutNo: true } });
        sourceNo = source?.payoutNo;
      } else if (sourceType === 'INTERNAL_TX') {
        const source = await (client as any).internalTransaction.findUnique({
          where: { id: sourceId },
          select: { internalTxNo: true },
        });
        sourceNo = source?.internalTxNo;
      } else if (sourceType === 'CLEARING') {
        const source = await (client as any).clearing.findUnique({ where: { id: sourceId }, select: { clearingNo: true } });
        sourceNo = source?.clearingNo;
      }
    } catch (e) {
      // Ignore errors if source not found
    }

    const journalId = crypto.randomUUID();
    const linesCreateInput: any[] = [];

    for (const lineTemplate of template.journalLineTemplates) {
      // 1. Resolve Amount
      let amount = new Prisma.Decimal(0);
      if (lineTemplate.amountSource === 'AMOUNT') {
        amount = new Prisma.Decimal(context.src.amount || 0);
      } else if (lineTemplate.amountSource === 'NET_AMOUNT') {
        amount = new Prisma.Decimal(context.src.netAmount || 0);
      } else if (lineTemplate.amountSource === 'FROM_AMOUNT') {
        amount = new Prisma.Decimal(context.src.fromAmount || 0);
      } else if (lineTemplate.amountSource === 'TO_AMOUNT') {
        amount = new Prisma.Decimal(context.src.toAmount || 0);
      } else if (lineTemplate.amountSource === 'FEE_AMOUNT') {
        amount = new Prisma.Decimal(context.src.feeAmount || 0);
      }

      // 2. Resolve Asset
      let assetId = context.src.assetId;
      if (lineTemplate.assetSource === 'FROM_ASSET_ID') {
        assetId = context.src.fromAssetId;
      } else if (lineTemplate.assetSource === 'TO_ASSET_ID') {
        assetId = context.src.toAssetId;
      } else if (lineTemplate.assetSource === 'FEE_ASSET_ID') {
        assetId = context.src.feeAssetId;
      }

      // 3. Resolve Identity
      const ownerType =
        this.resolveTemplateValue(lineTemplate.ownerTypeSource, context) ||
        'PLATFORM';
      const ownerId = this.resolveTemplateValue(
        lineTemplate.ownerIdSource,
        context,
      );

      // 4. Resolve FX & Reference
      const fxRateVal = this.resolveTemplateValue(
        lineTemplate.fxRateSource,
        context,
      );
      const fxRate = fxRateVal ? new Prisma.Decimal(fxRateVal) : null;
      const referenceId = this.resolveTemplateValue(
        lineTemplate.referenceSource,
        context,
      );

      // 5. Resolve Dimensions & Description
      const dimensions = this.processTemplateString(
        lineTemplate.dimensionsRule,
        context,
      );
      const walletId = this.extractWalletIdFromDimensions(dimensions);
      const description = this.processTemplateString(
        lineTemplate.description || template.description,
        context,
      );

      linesCreateInput.push({
        id: `JEL_${crypto.randomUUID()}`,
        journalId,
        lineNo: lineTemplate.lineNo,
        accountCode: lineTemplate.accountCode,
        drCr: lineTemplate.drCr,
        amount,
        assetId,
        fxRate,
        referenceId,
        ownerType,
        ownerId,
        walletId,
        dimensions,
        description,
        journalLineTemplateId: lineTemplate.id,
      });
    }

    await this.alignAssetLineOwnerTypeWithWallet(client, linesCreateInput);

    this.assertJournalBalancedByAsset(
      linesCreateInput.map((line) => ({
        lineNo: line.lineNo,
        drCr: line.drCr,
        amount: this.parseDecimal(line.amount),
        assetId: line.assetId,
      })),
      eventCode,
    );
    this.assertAssetLinesHaveWalletId(
      sourceType,
      eventCode,
      linesCreateInput.map((line) => ({
        lineNo: line.lineNo,
        accountCode: line.accountCode,
        walletId: line.walletId,
      })),
    );

    const executeCreate = async (transactionClient: Prisma.TransactionClient) => {
      try {
        const createdJournal = await transactionClient.journal.create({
          data: {
            id: journalId,
            journalNo: generateReferenceNo('JO'),
            sourceType,
            sourceId,
            sourceNo,
            eventCode,
            postingStatus: 'POSTED',
            baseAssetId: template.baseAssetId, // Use template's base asset
            postedAt: new Date(),
            description: this.processTemplateString(
              template.description,
              context,
            ),
            totalAmount: new Prisma.Decimal(context.src.amount || 0),
            journalHeaderTemplateId: template.id,
          },
        });

        if (linesCreateInput.length > 0) {
          await transactionClient.journalLine.createMany({ data: linesCreateInput });
          await this.projectWalletBalances(transactionClient, linesCreateInput);
        }

        return createdJournal;
      } catch (error: any) {
        this.logger.error(
          `Failed to create journal entry for ${eventCode}: ${error.message}`,
          error.stack,
        );
        throw error;
      }
    };

    if (tx) {
      return executeCreate(tx);
    } else {
      return this.prisma.$transaction(async (transactionClient: Prisma.TransactionClient) => {
        return executeCreate(transactionClient);
      });
    }
  }

  async triggerEvent(params: {
    entityType: string;
    triggerKey: string;
    fromStatus?: string | null;
    toStatus: string;
    assetType: 'FIAT' | 'CRYPTO' | 'ALL';
    context: any;
    sourceId: string;
    }, tx?: Prisma.TransactionClient) {
    const {
      entityType,
      triggerKey,
      fromStatus,
      toStatus,
      assetType,
      context,
      sourceId,
    } = params;
    const client = tx || this.prisma;

    // Find Matching Event
    const event = await (client as any).acctEvent.findFirst({
      where: {
        entityType,
        triggerType: 'STATUS_TRANSITION',
        triggerKey,
        isActive: true,
        OR: [
          { fromStatus: fromStatus || null },
          { fromStatus: null }, // Optional wildcard
        ],
        toStatus,
        assetType: { in: [assetType, 'ALL'] },
      },
    });

    if (!event) {
      this.logger.warn(
        `No matching accounting event found for ${entityType} ${triggerKey} ${fromStatus}->${toStatus} (${assetType}). Please check AcctEvent table.`,
      );
      return null;
    }

    this.logger.log(`Matched Accounting Event: ${event.eventCode}`);

    return this.executeResolvedEvent(
      {
        event,
        sourceType: entityType,
        sourceId,
        context,
      },
      tx,
    );
  }

  async executeResolvedEvent(
    params: {
      event: {
        eventCode: string;
        postingMode: string;
        postingReversalOfEventCode?: string | null;
      };
      sourceType: string;
      sourceId: string;
      context: any;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const { event, sourceType, sourceId, context } = params;

    if (event.postingMode === 'AUTO_REVERSAL') {
      if (!event.postingReversalOfEventCode) {
        throw new BadRequestException({
          code: 'POSTING_REVERSAL_TARGET_REQUIRED',
          message: `postingReversalOfEventCode is required for event ${event.eventCode}`,
        });
      }
      return this.reverseJournal({
        sourceType,
        sourceId,
        reversalEventCode: event.eventCode,
        targetEventCode: event.postingReversalOfEventCode,
        context,
      }, tx);
    }

    if (event.postingMode === 'BULK_REVERSAL_BY_SOURCE') {
      return this.reverseAllBySource(
        {
          sourceType,
          sourceId,
          context,
        },
        tx,
      );
    }

    if (event.postingMode === 'NONE') {
      return null;
    }

    return this.createJournal({
      sourceType,
      sourceId,
      eventCode: event.eventCode,
      context,
    }, tx);
  }

  async reverseJournal(params: {
    sourceType: string;
    sourceId: string;
    reversalEventCode: string;
    targetEventCode: string;
    context: any;
  }, tx?: Prisma.TransactionClient) {
    const { sourceType, sourceId, reversalEventCode, targetEventCode, context } =
      params;
    const client = tx || this.prisma;

    // 1. Idempotency check
    const existing = await (client as any).journal.findFirst({
      where: { sourceType, sourceId, eventCode: reversalEventCode },
    });
    if (existing) {
      this.logger.log(
        `Reversal journal already exists for ${sourceType} ${sourceId} event ${reversalEventCode}`,
      );
      return existing;
    }

    // 2. Find the original journal to reverse
    const originalJournal = await (client as any).journal.findFirst({
      where: { sourceType, sourceId, eventCode: targetEventCode },
      include: { lines: true },
    });

    if (!originalJournal) {
      this.logger.error(
        `Cannot perform AUTO_REVERSAL: Original journal not found for ${sourceType} ${sourceId} event ${targetEventCode}`,
      );
      return null;
    }

    this.logger.log(
      `Performing AUTO_REVERSAL of journal ${originalJournal.id} (Event: ${targetEventCode})`,
    );

    const reversalJournalId = crypto.randomUUID();
    const reversalLines = originalJournal.lines.map((line: any) => ({
      id: `JEL_${crypto.randomUUID()}`,
      journalId: reversalJournalId,
      lineNo: line.lineNo,
      accountCode: line.accountCode,
      drCr: line.drCr === 'DR' ? 'CR' : 'DR', // Mirror direction
      amount: line.amount,
      assetId: line.assetId,
      fxRate: line.fxRate,
      ownerType: line.ownerType,
      ownerId: line.ownerId,
      walletId: line.walletId ?? this.extractWalletIdFromDimensions(line.dimensions || '{}'),
      dimensions: line.dimensions,
      referenceId: line.referenceId,
      description: `[REVERSAL] ${line.description}`,
      journalLineTemplateId: line.journalLineTemplateId,
    }));

    const executeReverse = async (transactionClient: Prisma.TransactionClient) => {
      const createdJournal = await transactionClient.journal.create({
        data: {
          id: reversalJournalId,
          journalNo: generateReferenceNo('JO'),
          sourceType,
          sourceId,
          eventCode: reversalEventCode,
          postingStatus: 'POSTED',
          baseAssetId: originalJournal.baseAssetId,
          reversalOfJournalId: originalJournal.id,
          postedAt: new Date(),
          description: `[REVERSAL] ${originalJournal.description}`,
          totalAmount: originalJournal.totalAmount,
          journalHeaderTemplateId: originalJournal.journalHeaderTemplateId,
        },
      });

      if (reversalLines.length > 0) {
        await transactionClient.journalLine.createMany({ data: reversalLines });
        await this.projectWalletBalances(transactionClient, reversalLines);
      }

      return createdJournal;
    };

    if (tx) {
      return executeReverse(tx);
    } else {
      return this.prisma.$transaction(async (transactionClient: Prisma.TransactionClient) => {
        return executeReverse(transactionClient);
      });
    }
  }

  async reverseAllBySource(
    params: {
      sourceType: string;
      sourceId: string;
      context: any;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const { sourceType, sourceId, context } = params;
    const client = tx || this.prisma;

    const originalJournals = await (client as any).journal.findMany({
      where: {
        sourceType,
        sourceId,
        reversalOfJournalId: null,
      },
      orderBy: { createdAt: 'asc' },
    });
    const originalJournalIds = originalJournals.map((journal: any) => journal.id);
    const existingReversals = originalJournalIds.length
      ? await (client as any).journal.findMany({
          where: {
            sourceType,
            sourceId,
            reversalOfJournalId: {
              in: originalJournalIds,
            },
          },
          select: {
            reversalOfJournalId: true,
          },
        })
      : [];
    const reversedSourceIds = new Set(
      existingReversals
        .map((journal: { reversalOfJournalId?: string | null }) => journal.reversalOfJournalId)
        .filter(
          (value: string | null | undefined): value is string =>
            typeof value === 'string' && value.length > 0,
        ),
    );

    const reversals: any[] = [];
    for (const journal of originalJournals) {
      if (reversedSourceIds.has(journal.id)) {
        continue;
      }
      const reversal = await this.reverseJournal(
        {
          sourceType,
          sourceId,
          reversalEventCode: `REV_${journal.eventCode}`,
          targetEventCode: journal.eventCode,
          context,
        },
        tx,
      );
      if (reversal) {
        reversals.push(reversal);
      }
    }

    return reversals;
  }

  async createDepositJournal(
    depositId: string,
    eventCode: string,
    amount: string,
    assetId: string,
    ownerId: string,
  ) {
    const deposit = await (this.prisma as any).depositTransaction.findUnique({
      where: { id: depositId },
    });

    const context = {
      src: {
        ownerId,
        ownerType: deposit?.ownerType || 'CUSTOMER',
        assetId,
        depositId,
        amount,
        depositNo: deposit?.depositNo,
        walletId: deposit?.toWalletId,
      },
    };

    return this.createJournal({
      sourceType: 'DEPOSIT',
      sourceId: depositId,
      eventCode,
      context,
    });
  }

  async findAll(query: JournalQueryDto) {
    const {
      skip,
      take,
      id,
      sourceType,
      eventCode,
      postingStatus,
      baseAssetId,
      createdAtStart,
      createdAtEnd,
      postedAtStart,
      postedAtEnd,
      sortBy,
      sortOrder,
    } = query;

    const where: any = {};

    if (id) where.id = { contains: id };
    if (sourceType) where.sourceType = sourceType;
    if (eventCode) where.eventCode = { contains: eventCode };
    if (postingStatus) where.postingStatus = postingStatus;
    if (baseAssetId) where.baseAssetId = baseAssetId;

    if (createdAtStart || createdAtEnd) {
      where.createdAt = {};
      if (createdAtStart) where.createdAt.gte = new Date(createdAtStart);
      if (createdAtEnd) where.createdAt.lte = new Date(createdAtEnd);
    }

    if (postedAtStart || postedAtEnd) {
      where.postedAt = {};
      if (postedAtStart) where.postedAt.gte = new Date(postedAtStart);
      if (postedAtEnd) where.postedAt.lte = new Date(postedAtEnd);
    }

    const orderBy: any = {};
    if (sortBy) {
      orderBy[sortBy] = sortOrder || 'asc';
    } else {
      orderBy.createdAt = 'desc';
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).journal.findMany({
        skip: skip ? Number(skip) : 0,
        take: take ? Number(take) : 20,
        where,
        orderBy,
        include: {
          baseAsset: {
            select: {
              code: true,
              type: true,
            },
          },
        },
      }),
      (this.prisma as any).journal.count({ where }),
    ]);

    const itemsWithSourceNo = items;

    return { items: itemsWithSourceNo, total };
  }

  async findOne(id: string) {
    const item = await (this.prisma as any).journal.findUnique({
      where: { id },
      include: {
        baseAsset: true,
      },
    });
    if (!item) throw new NotFoundException('Journal entry not found');
    return item;
  }
}
