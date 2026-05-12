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
    _client: Prisma.TransactionClient,
    _lines: Array<{
      id: string;
      walletId?: string | null;
      assetId?: string | null;
      accountCode: string;
      drCr: string;
      amount: Prisma.Decimal;
    }>,
  ): Promise<any> {
    throw new Error('DEPRECATED: migrate to TB — WalletBalanceEntry/WalletBalanceSnapshot projection');
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
    _params: {
      ownerId: string;
      assetId: string;
      ownerType?: string;
    },
    _tx?: Prisma.TransactionClient,
  ): Promise<any> {
    throw new Error('DEPRECATED: migrate to TB — getCustomerLiabilityBalance via JournalLine aggregation');
  }

  async createJournal(
    _params: {
      sourceType: string;
      sourceId: string;
      eventCode: string;
      context: any;
    },
    _tx?: Prisma.TransactionClient,
  ): Promise<any> {
    throw new Error('DEPRECATED: migrate to TB — createJournal writes JournalLine rows');
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

  async reverseJournal(
    _params: {
      sourceType: string;
      sourceId: string;
      reversalEventCode: string;
      targetEventCode: string;
      context: any;
    },
    _tx?: Prisma.TransactionClient,
  ): Promise<any> {
    throw new Error('DEPRECATED: migrate to TB — reverseJournal writes JournalLine rows');
  }

  async reverseAllBySource(
    _params: {
      sourceType: string;
      sourceId: string;
      context: any;
    },
    _tx?: Prisma.TransactionClient,
  ): Promise<any> {
    throw new Error('DEPRECATED: migrate to TB — reverseAllBySource writes JournalLine rows');
  }

  async createDepositJournal(
    _depositId: string,
    _eventCode: string,
    _amount: string,
    _assetId: string,
    _ownerId: string,
  ): Promise<any> {
    throw new Error('DEPRECATED: migrate to TB — createDepositJournal writes JournalLine rows');
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
