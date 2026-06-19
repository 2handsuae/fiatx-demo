import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { ExternalBalanceProvider, ExternalTxProvider } from './external-data.provider';
import { ExternalTx } from '../engine/match-engine.service';

/**
 * Zand (AED) 银行对账单 file adapter。
 * 读取持久化的 reconciliation_external_statements 行（source=ZAND）。
 * 对账单已按物理账户隔离：同 source+date+currency 可有多行（findMany）。
 * balanceAt → Σ closingBalance；txsForDate → concat 各行 rawJson.StatementRecords。
 * 真实 shape：StatementRecords[].{ ChannelRefId, TransactionType(Credit/Debit), TransactionAmount.{Amount,Currency} }。
 * match key = ChannelRefId（= 内部 referenceNo）；Credit→IN，Debit→OUT。
 */
@Injectable()
export class ZandFileAdapter implements ExternalBalanceProvider, ExternalTxProvider {
  constructor(private readonly prisma: PrismaService) {}

  private async load(currency: string, businessDate: string) {
    return this.prisma.reconciliationExternalStatement.findMany({
      where: { source: 'ZAND', businessDate, currency },
    });
  }

  async balanceAt(currency: string, _assetId: string, cutoff: Date): Promise<Prisma.Decimal> {
    const businessDate = this.dateOf(cutoff);
    const rows = await this.load(currency, businessDate);
    return rows.reduce(
      (s, r) => s.plus(new Prisma.Decimal(r.closingBalance ?? 0)),
      new Prisma.Decimal(0),
    );
  }

  async txsForDate(currency: string, _assetId: string, businessDate: string): Promise<ExternalTx[]> {
    const rows = await this.load(currency, businessDate);
    const ts = new Date(`${businessDate}T00:00:00.000Z`);
    return rows.flatMap((row) => {
      const doc = JSON.parse(row.rawJson) as ZandStatement;
      return (doc.StatementRecords ?? []).map((r) => ({
        source: 'ZAND',
        txId: r.ChannelRefId,
        txHash: null,
        referenceNo: r.ChannelRefId,
        amount: new Prisma.Decimal(r.TransactionAmount.Amount),
        direction: r.TransactionType === 'Credit' ? 'IN' : 'OUT',
        timestamp: r.PostedDate ? new Date(r.PostedDate) : ts,
      }));
    });
  }

  /** cutoff 是 T+1 00:00（UTC）；businessDate = cutoff − 1 天。 */
  private dateOf(cutoff: Date): string {
    const d = new Date(cutoff.getTime() - 86400000);
    return d.toISOString().slice(0, 10);
  }
}

interface ZandStatement {
  StatementInfo?: { FromDate?: string; ToDate?: string; AccountId?: string };
  StatementRecords?: Array<{
    ChannelRefId: string;
    InstructionIdentification?: string;
    ValueDate?: string;
    PostedDate?: string;
    InstructedAmount?: { Amount: number; Currency: string };
    TransactionAmount: { Amount: number; Currency: string };
    TransactionType: 'Credit' | 'Debit';
    Balance?: number;
    VirtualAccount?: string;
  }>;
}
