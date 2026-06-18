import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';

/** 科目 → 切面余额（debit-positive 口径）。asset 科目 balance = debit_net；L/E/R = −debit_net。 */
@Injectable()
export class BalanceSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  /** 返回 { COA字符串 → balance(Decimal) }，按 createdAt < cutoff + POSTED 重算。 */
  async balancesAtCutoff(
    currency: string,
    cutoff: Date,
  ): Promise<Record<string, Prisma.Decimal>> {
    const rows = await this.prisma.tbTransferEvidence.findMany({
      where: { assetCode: currency, transferType: 'POSTED', createdAt: { lt: cutoff } },
      select: { debitCode: true, creditCode: true, amount: true },
    });
    const debitNet: Record<string, Prisma.Decimal> = {};
    const add = (code: string, v: Prisma.Decimal) => {
      debitNet[code] = (debitNet[code] ?? new Prisma.Decimal(0)).plus(v);
    };
    for (const r of rows) {
      const amt = new Prisma.Decimal(r.amount);
      add(r.debitCode, amt);
      add(r.creditCode, amt.negated());
    }
    const out: Record<string, Prisma.Decimal> = {};
    for (const [code, net] of Object.entries(debitNet)) {
      out[code] = code.startsWith('A.') ? net : net.negated();
    }
    return out;
  }
}
