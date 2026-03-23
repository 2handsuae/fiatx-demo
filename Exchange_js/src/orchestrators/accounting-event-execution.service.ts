import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { ClearingsService } from '../modules/clearing-settle/clearing/clearings.service';
import { JournalsService } from '../modules/accounting/journals/journals.service';

type ResolvedAcctEvent = {
  eventCode: string;
  entityType: string;
  triggerType: string;
  triggerKey: string;
  fromStatus?: string | null;
  toStatus: string;
  assetType: string;
  postingMode: string;
  postingReversalOfEventCode?: string | null;
  clearingMode: string;
  clearingTemplateCode?: string | null;
};

export interface AccountingEventExecutionRequest {
  entityType: string;
  triggerKey: string;
  fromStatus?: string | null;
  toStatus: string;
  assetType: 'FIAT' | 'CRYPTO' | 'ALL';
  sourceId: string;
  frozenContext: any;
  journalSourceType: string;
  clearingSourceType: string;
}

export interface ResolvedAccountingEventContext {
  event: ResolvedAcctEvent;
  sourceId: string;
  frozenContext: any;
  journalSourceType: string;
  clearingSourceType: string;
}

export interface AccountingEventExecutionResult {
  eventCode: string | null;
  matchedEvent: ResolvedAcctEvent | null;
  journalResult: any;
  clearingResult: any;
}

@Injectable()
export class AccountingEventExecutionService {
  private readonly logger = new Logger(AccountingEventExecutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journalsService: JournalsService,
    private readonly clearingsService: ClearingsService,
  ) {}

  private async resolveEvent(
    client: Prisma.TransactionClient,
    params: Omit<
      AccountingEventExecutionRequest,
      'sourceId' | 'frozenContext' | 'journalSourceType' | 'clearingSourceType'
    >,
  ): Promise<ResolvedAcctEvent | null> {
    const { entityType, triggerKey, fromStatus, toStatus, assetType } = params;
    return (client as any).acctEvent.findFirst({
      where: {
        entityType,
        triggerType: 'STATUS_TRANSITION',
        triggerKey,
        isActive: true,
        OR: [{ fromStatus: fromStatus || null }, { fromStatus: null }],
        toStatus,
        assetType: { in: [assetType, 'ALL'] },
      },
    });
  }

  private requiresPosting(event: ResolvedAcctEvent): boolean {
    return event.postingMode !== 'NONE';
  }

  private requiresClearing(event: ResolvedAcctEvent): boolean {
    return event.clearingMode === 'TEMPLATE';
  }

  private async findExistingJournal(
    client: Prisma.TransactionClient,
    sourceType: string,
    sourceId: string,
    eventCode: string,
  ) {
    return (client as any).journal.findFirst({
      where: { sourceType, sourceId, eventCode },
      include: { lines: true },
    });
  }

  private async findExistingClearing(
    client: Prisma.TransactionClient,
    sourceType: string,
    sourceId: string,
    eventCode: string,
  ) {
    return (client as any).clearing.findFirst({
      where: { sourceType, sourceId, clearingType: eventCode },
      include: { lines: true },
    });
  }

  async execute(
    params: AccountingEventExecutionRequest,
    tx?: Prisma.TransactionClient,
  ): Promise<AccountingEventExecutionResult> {
    const executeInTransaction = async (
      client: Prisma.TransactionClient,
    ): Promise<AccountingEventExecutionResult> => {
      const event = await this.resolveEvent(client, params);
      if (!event) {
        this.logger.warn(
          `No matching accounting event found for ${params.entityType} ${params.triggerKey} ${params.fromStatus || 'NULL'}->${params.toStatus} (${params.assetType})`,
        );
        return {
          eventCode: null,
          matchedEvent: null,
          journalResult: null,
          clearingResult: null,
        };
      }

      const requiresPosting = this.requiresPosting(event);
      const requiresClearing = this.requiresClearing(event);

      let existingJournal: any = null;
      let existingClearing: any = null;

      if (requiresPosting && requiresClearing) {
        [existingJournal, existingClearing] = await Promise.all([
          this.findExistingJournal(
            client,
            params.journalSourceType,
            params.sourceId,
            event.eventCode,
          ),
          this.findExistingClearing(
            client,
            params.clearingSourceType,
            params.sourceId,
            event.eventCode,
          ),
        ]);

        if ((existingJournal && !existingClearing) || (!existingJournal && existingClearing)) {
          throw new BadRequestException({
            code: 'PARTIAL_EVENT_EXECUTION',
            message: `Event ${event.eventCode} is partially executed for source ${params.sourceId}`,
          });
        }

        if (existingJournal && existingClearing) {
          return {
            eventCode: event.eventCode,
            matchedEvent: event,
            journalResult: existingJournal,
            clearingResult: existingClearing,
          };
        }
      }

      const resolved: ResolvedAccountingEventContext = {
        event,
        sourceId: params.sourceId,
        frozenContext: params.frozenContext,
        journalSourceType: params.journalSourceType,
        clearingSourceType: params.clearingSourceType,
      };

      const clearingResult = requiresClearing
        ? await this.clearingsService.executeResolvedEvent(
            {
              event,
              sourceType: params.clearingSourceType,
              sourceId: params.sourceId,
              context: params.frozenContext,
            },
            client,
          )
        : null;

      const journalResult = requiresPosting
        ? await this.journalsService.executeResolvedEvent(
            {
              event,
              sourceType: params.journalSourceType,
              sourceId: params.sourceId,
              context: params.frozenContext,
            },
            client,
          )
        : null;

      return {
        eventCode: resolved.event.eventCode,
        matchedEvent: resolved.event,
        journalResult,
        clearingResult,
      };
    };

    if (tx) {
      return executeInTransaction(tx);
    }

    return (this.prisma as any).$transaction((client: Prisma.TransactionClient) =>
      executeInTransaction(client),
    );
  }
}
