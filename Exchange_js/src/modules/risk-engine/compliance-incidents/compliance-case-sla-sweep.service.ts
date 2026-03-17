import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ComplianceAlertsService } from '../compliance-alerts/compliance-alerts.service';
import { DEFAULT_COMPLIANCE_CASE_SLA_SCAN_MS } from './constants/compliance-incident-rules.constant';
import { ComplianceIncidentsService } from './compliance-incidents.service';

@Injectable()
export class ComplianceCaseSlaSweepService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ComplianceCaseSlaSweepService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly complianceAlertsService: ComplianceAlertsService,
    private readonly complianceIncidentsService: ComplianceIncidentsService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    const intervalMs = Number(
      process.env.COMPLIANCE_CASE_SLA_SCAN_MS || DEFAULT_COMPLIANCE_CASE_SLA_SCAN_MS,
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
      const [alerts, cases] = await Promise.all([
        this.complianceAlertsService.markOverdueAlerts(),
        this.complianceIncidentsService.markOverdueCases(),
      ]);
      if (alerts.markedCount || cases.markedCount) {
        this.logger.log(
          `Compliance SLA sweep marked overdue alerts=${alerts.markedCount} cases=${cases.markedCount}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown compliance SLA sweep error';
      this.logger.warn(`Compliance SLA sweep failed: ${message}`);
    } finally {
      this.running = false;
    }
  }
}
