// material-freshness-cron.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { MaterialRefreshService } from './material-refresh.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';
import { computeStage } from './policy/compute-stage';

@Injectable()
export class MaterialFreshnessCronService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly service: MaterialRefreshService,
    private readonly sumsubClient: SumsubClient,
  ) {}

  @Cron('0 2 * * *') // Daily 02:00 UTC
  async runDailyCheck(): Promise<void> {
    console.log('[MaterialFreshnessCron] Daily check starting');

    await this.scanHoldingsForStageTransitions();
    await this.scanGraceExpiredCycles();

    console.log('[MaterialFreshnessCron] Daily check complete');
  }

  private async scanHoldingsForStageTransitions(): Promise<void> {
    const holdings = await this.prisma.customerMaterialHolding.findMany({
      where: {
        status: { in: ['FRESH', 'NOTIFIED', 'URGENT', 'BLOCKING'] },
        expiresAt: { not: null },
      },
      take: 5000,
    });

    const now = Date.now();
    for (const holding of holdings) {
      if (!holding.expiresAt) continue;
      const daysFromExpiry = Math.floor(
        (holding.expiresAt.getTime() - now) / (24 * 60 * 60 * 1000),
      );
      const targetStage = computeStage(daysFromExpiry);
      if (targetStage === 'FRESH' || targetStage === holding.status) continue;

      try {
        if (targetStage === 'NOTIFIED') {
          await this.service.enterNotifiedStage(holding.id);
        } else if (targetStage === 'URGENT') {
          await this.service.escalateToUrgent(holding.id);
        } else if (targetStage === 'BLOCKING') {
          await this.service.enterBlockingStage(holding.id);
        }
      } catch (err) {
        console.error(`Stage transition failed for holding ${holding.id}:`, err);
      }
    }
  }

  private async scanGraceExpiredCycles(): Promise<void> {
    const expired = await this.prisma.materialRefreshCycle.findMany({
      where: {
        status: 'PENDING_CUSTOMER_EVIDENCE',
        graceExpiresAt: { lt: new Date() },
      },
    });

    for (const cycle of expired) {
      try {
        await this.service.terminateCycle(cycle.id, 'grace_expired');
      } catch (err) {
        console.error(`Failed to terminate cycle ${cycle.id}:`, err);
      }
    }
  }
}
