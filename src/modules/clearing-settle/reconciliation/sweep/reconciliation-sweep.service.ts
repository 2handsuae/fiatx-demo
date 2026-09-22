import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WalletReconRunService } from '../workflow/wallet-recon-run.service';
import { toBusinessDate, endOfBusinessDate } from '../../../accounting/tigerbeetle/utils/business-date.util';

/**
 * Daily reconciliation sweep. Single engine (WALLET_V1) — the per-wallet
 * engine processes every active wallet across all assets in one pass, so
 * the legacy CRYPTO / FIAT split is gone. Business date = yesterday (T+0)
 * because external balances for day D arrive overnight; we fire once at
 * 02:30 Dubai when bank/custody statements are in.
 */
@Injectable()
export class ReconciliationSweepService {
  private readonly logger = new Logger(ReconciliationSweepService.name);
  constructor(private readonly walletRecon: WalletReconRunService) {}

  // Scan logic kept separate from the @Cron wrapper so it's directly
  // testable with an injected `now`, without waiting on a real clock.
  cutoffForYesterday(now: Date = new Date()): Date {
    // 业务日 T-1 的日终（迪拜口径，见 business-date.util.ts 顶部规则）——
    // 与钱包引擎 account_flows + external_balances 查询用的是同一条边界。
    const businessDate = toBusinessDate(new Date(now.getTime() - 86_400_000));
    return endOfBusinessDate(businessDate);
  }

  @Cron('0 30 2 * * *', { timeZone: 'Asia/Dubai' })
  async dailyRecon(): Promise<void> {
    const cutoff = this.cutoffForYesterday();
    try {
      const res = await this.walletRecon.run({ cutoff });
      this.logger.log(
        `Recon ${cutoff.toISOString().slice(0, 10)}: runId=${res.runId} status=${res.status} wallets=${res.walletsChecked} opened=${res.casesOpened} reObserved=${res.casesReObserved} autoHealed=${res.casesAutoHealed}`,
      );
    } catch (err) {
      this.logger.error(
        `Recon ${cutoff.toISOString().slice(0, 10)} failed`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
