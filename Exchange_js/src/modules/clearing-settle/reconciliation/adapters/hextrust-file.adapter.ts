import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { ExternalBalanceProvider, ExternalTxProvider } from './external-data.provider';
import { ExternalTx } from '../engine/match-engine.service';

/**
 * HexTrust (USDT) 托管交易 file adapter。
 * 读取持久化的 reconciliation_external_statements 行（source=HEXTRUST），
 * balanceAt → closingBalance；txsForDate → 解析 rawJson 的 tx-array。
 * 真实 shape：[{ id, txHash, amountDecimal, assetKey, transactionType(DEPOSIT/WITHDRAWAL),
 *   primaryTransactionStatus, vaultId, blockTimestamp, ... }]。
 * match key = txHash；DEPOSIT→IN，WITHDRAWAL→OUT。
 */
@Injectable()
export class HexTrustFileAdapter implements ExternalBalanceProvider, ExternalTxProvider {
  constructor(private readonly prisma: PrismaService) {}

  private async load(currency: string, businessDate: string) {
    return this.prisma.reconciliationExternalStatement.findUnique({
      where: { source_businessDate_currency: { source: 'HEXTRUST', businessDate, currency } },
    });
  }

  async balanceAt(currency: string, _assetId: string, cutoff: Date): Promise<Prisma.Decimal> {
    const businessDate = this.dateOf(cutoff);
    const row = await this.load(currency, businessDate);
    return new Prisma.Decimal(row?.closingBalance ?? 0);
  }

  async txsForDate(currency: string, _assetId: string, businessDate: string): Promise<ExternalTx[]> {
    const row = await this.load(currency, businessDate);
    if (!row) return [];
    const txs = JSON.parse(row.rawJson) as HexTrustTx[];
    const ts = new Date(`${businessDate}T00:00:00.000Z`);
    return (txs ?? []).map((t) => ({
      source: 'HEXTRUST',
      txId: t.id ?? t.txHash,
      txHash: t.txHash,
      referenceNo: null,
      amount: new Prisma.Decimal(t.amountDecimal),
      direction: t.transactionType === 'DEPOSIT' ? 'IN' : 'OUT',
      timestamp: t.blockTimestamp ? new Date(t.blockTimestamp) : ts,
    }));
  }

  private dateOf(cutoff: Date): string {
    const d = new Date(cutoff.getTime() - 86400000);
    return d.toISOString().slice(0, 10);
  }
}

interface HexTrustTx {
  id?: string;
  traceId?: string;
  txHash: string;
  amountDecimal: string;
  assetKey?: string;
  transactionType: 'DEPOSIT' | 'WITHDRAWAL';
  primaryTransactionStatus?: string;
  vaultId?: string;
  from?: string;
  to?: string;
  confirmationCount?: number;
  blockTimestamp?: string;
  createdAt?: string;
}
