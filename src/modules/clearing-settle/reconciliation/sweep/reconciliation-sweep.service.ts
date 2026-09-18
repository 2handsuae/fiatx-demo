import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WalletReconRunService } from '../workflow/wallet-recon-run.service';

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

  private cutoffForYesterday(): Date {
    // End-of-business-day UTC for T-1 — same boundary the wallet engine
    // uses for its account_flows + external_balances queries.
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    d.setUTCHours(23, 59, 59, 999);
    return d;
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
