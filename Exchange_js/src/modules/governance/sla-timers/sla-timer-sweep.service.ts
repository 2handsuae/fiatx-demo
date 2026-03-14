import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  DEFAULT_SLA_TIMER_SCAN_MS,
} from './constants/sla-timer.constants';
import { SlaTimersService } from './sla-timers.service';

@Injectable()
export class SlaTimerSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlaTimerSweepService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly slaTimersService: SlaTimersService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    const intervalMs = Number(process.env.SLA_TIMER_SCAN_MS || DEFAULT_SLA_TIMER_SCAN_MS);
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

  private async runOnce() {
    if (this.running) return;
    this.running = true;
    try {
      await this.slaTimersService.expireDueTimers();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown SLA timer sweep error';
      this.logger.warn(`SLA timer sweep failed: ${message}`);
    } finally {
      this.running = false;
    }
  }
}
