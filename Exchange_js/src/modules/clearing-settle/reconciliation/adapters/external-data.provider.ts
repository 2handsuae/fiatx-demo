import { Prisma } from '@prisma/client';
import { ExternalTx } from '../engine/match-engine.service';

export interface ExternalBalanceProvider {
  /** as-of-cutoff 物理托管余额（per currency）。 */
  balanceAt(currency: string, assetId: string, cutoff: Date): Promise<Prisma.Decimal>;
}
export interface ExternalTxProvider {
  /** 业务日的外部流水（链上 / 银行对账单 entry）。 */
  txsForDate(currency: string, assetId: string, businessDate: string): Promise<ExternalTx[]>;
}
export const EXTERNAL_BALANCE_PROVIDER = Symbol('EXTERNAL_BALANCE_PROVIDER');
export const EXTERNAL_TX_PROVIDER = Symbol('EXTERNAL_TX_PROVIDER');
