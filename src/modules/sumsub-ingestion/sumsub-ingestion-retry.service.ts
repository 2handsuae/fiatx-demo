// src/modules/sumsub-ingestion/sumsub-ingestion-retry.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SumsubIngestionService } from './sumsub-ingestion.service';

// Minimum wait between retries (ms): attempt 1→ 30s, 2→ 5min, 3→ 30min
const BACKOFF_MS = [30_000, 300_000, 1_800_000];

@Injectable()
export class SumsubRetryService {
  private readonly logger = new Logger(SumsubRetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestionService: SumsubIngestionService,
  ) {}

  @Cron('*/2 * * * *', { timeZone: 'Asia/Dubai' })
  async retryFailedEvents(): Promise<void> {
    const now = new Date();

    const events = await this.prisma.sumsubWebhookEvent.findMany({
      where: {
        status: 'FAILED',
        retryCount: { lt: 3 },
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    for (const event of events) {
      const backoff = BACKOFF_MS[event.retryCount] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
      const lastAttempt = event.lastRetryAt ?? event.createdAt;
      if (now.getTime() - lastAttempt.getTime() < backoff) continue;

      this.logger.log(
        `Retrying event ${event.eventNo} (attempt ${event.retryCount + 1}/3)`,
      );

      try {
        await this.ingestionService.dispatch(event);
      } catch {
        // dispatch() already updates status/retryCount; swallow here
      }
    }
  }
}
