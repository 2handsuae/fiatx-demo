import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ReconciliationRunWorkflowService } from '../workflow/reconciliation-run-workflow.service';

/** 业务日 = 昨日（T+0）。02:30 Dubai 跑 crypto；fiat 由对账单上传事件触发 + 12:00 兜底。 */
@Injectable()
export class ReconciliationSweepService {
  private readonly logger = new Logger(ReconciliationSweepService.name);
  constructor(private readonly workflow: ReconciliationRunWorkflowService) {}

  private yesterday(): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  @Cron('0 30 2 * * *', { timeZone: 'Asia/Dubai' })
  async cryptoDaily(): Promise<void> {
    const businessDate = this.yesterday();
    try {
      const res = await this.workflow.run({ businessDate, layer: 'CRYPTO', triggerType: 'SCHEDULED', mode: 'APPLY' });
      this.logger.log(`Recon crypto ${businessDate}: ${JSON.stringify(res)}`);
    } catch (err) {
      this.logger.error(`Recon crypto ${businessDate} failed`, err instanceof Error ? err.stack : undefined);
    }
  }

  @Cron('0 0 12 * * *', { timeZone: 'Asia/Dubai' })
  async fiatFallback(): Promise<void> {
    const businessDate = this.yesterday();
    try {
      const res = await this.workflow.run({ businessDate, layer: 'FIAT', triggerType: 'SCHEDULED', mode: 'APPLY' });
      this.logger.log(`Recon fiat ${businessDate}: ${JSON.stringify(res)}`);
    } catch (err) {
      this.logger.error(`Recon fiat ${businessDate} failed`, err instanceof Error ? err.stack : undefined);
    }
  }
}
