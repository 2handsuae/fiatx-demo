import { Injectable, Logger } from '@nestjs/common';

export enum AlertSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL',
}

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  alert(
    title: string,
    message: string,
    severity: AlertSeverity = AlertSeverity.ERROR,
    metadata?: any,
  ) {
    const alertData = {
      timestamp: new Date().toISOString(),
      title,
      message,
      severity,
      metadata,
    };

    // In a real system, this would send to Slack/PagerDuty/Sentry
    this.logger.error(
      `[ALERT][${severity}] ${title}: ${message}`,
      JSON.stringify(metadata),
    );

    // Simulating external call
    if (severity === AlertSeverity.CRITICAL) {
      console.error('!!! CRITICAL ALERT !!!', alertData);
    }
  }

  logMetric(name: string, value: number, tags?: Record<string, string>) {
    this.logger.log(`[METRIC] ${name}=${value} ${JSON.stringify(tags || {})}`);
  }
}
