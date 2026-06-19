import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { ExternalBalanceProvider, ExternalTxProvider } from './external-data.provider';
import { ExternalTx } from '../engine/match-engine.service';

/**
 * Mock 外部数据源：余额读 wallet.mockBalance，流水从 funds 记录派生。
 * 真实 HexTrust/Zand adapter 后期实现同接口替换。
 */
@Injectable()
export class MockExternalAdapter implements ExternalBalanceProvider, ExternalTxProvider {
  constructor(private readonly prisma: PrismaService) {}

  async balanceAt(currency: string, assetId: string, _cutoff: Date): Promise<Prisma.Decimal> {
    // 客户/公司边界：客户资产对账只 sum 客户钱包（walletRole C_*）。
    // firm 自有资金（F_*，COA A.FIRM_TREASURY）走独立 firm recon，绝不混入此处——
    // 内部侧 TB 取 A.CLIENT_CUSTODY/A.CLIENT_BANK（仅客户），外部必须同边界否则凭空多出假 break。
    const wallets = await this.prisma.wallet.findMany({
      where: { assetId, status: 'ACTIVE', walletRole: { startsWith: 'C_' } },
      select: { mockBalance: true },
    });
    return wallets.reduce(
      (s, w) => s.plus(new Prisma.Decimal(w.mockBalance ?? 0)),
      new Prisma.Decimal(0),
    );
  }

  async txsForDate(currency: string, assetId: string, businessDate: string): Promise<ExternalTx[]> {
    // client-scoped by construction：internalFund 即客户资金流（链上腿），天然属客户边界，
    // 不含 firm 自有资金。direction-aware 匹配（区分 IN/OUT）是 documented follow-up，此处不扩范围。
    const start = new Date(`${businessDate}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 86400000);
    const funds = await this.prisma.internalFund.findMany({
      where: {
        assetId,
        status: 'CLEAR',
        txHash: { not: null },
        createdAt: { gte: start, lt: end },
      },
      select: { id: true, txHash: true, amount: true },
    });
    return funds.map(f => ({
      source: 'HEXTRUST',
      txId: f.id,
      txHash: f.txHash,
      referenceNo: null,
      amount: new Prisma.Decimal(f.amount),
      direction: 'IN',
      timestamp: start,
    }));
  }
}
