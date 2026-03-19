import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PeriodicReviewService } from './periodic-review.service';

const DEFAULT_PERIODIC_REVIEW_SWEEP_MS = 60_000;

@Injectable()
export class PeriodicReviewSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PeriodicReviewSweepService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly periodicReviewService: PeriodicReviewService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    const intervalMs = Number(
      process.env.PERIODIC_REVIEW_SWEEP_MS || DEFAULT_PERIODIC_REVIEW_SWEEP_MS,
    );
    if (!Number.isFinite(intervalMs) || intervalMs < 1000) {
      return;
    }

    this.timer = setInterval(() => {
      void this.runOnce();
    }, intervalMs);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce() {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.periodicReviewService.sweepDueCustomers();
      if (result.createdCount || result.blockedCount) {
        this.logger.log(
          `Periodic review sweep created=${result.createdCount} blocked=${result.blockedCount}`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown periodic review sweep error';
      this.logger.warn(`Periodic review sweep failed: ${message}`);
    } finally {
      this.running = false;
    }
  }
}
