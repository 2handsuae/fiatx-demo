// 模拟托管方回单（平账二期 spec §4）：内部划转腿一提交，托管方 / 银行的对账单上就该有这两行。
// 这是本波唯一的新演示装置（demo/simulated-externals.md 登记）——除此之外的外部账单仍只由
// recon:demo 铸。铺场脚本 pass / break 两模式都先清空外部账单再从账本流水重铸，划转结清后的
// 流水会被一并重铸，所以不会同一笔两行；代价是「铺场时不得有在途划转」（recon-demo.ts 前置闸）。
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { toBusinessDate } from '../../../accounting/tigerbeetle/utils/business-date.util';
import { WalletBalanceCheckerService } from '../engine/v2/wallet-balance-checker.service';

export interface LegMovementInput {
  fundsOrderNo: string;
  fromWalletId: string;
  toWalletId: string;
  /** external_statement_lines.currency / external_balances.currency 存 asset.code（全仓惯例，B 批实证） */
  assetCode: string;
  assetType: 'CRYPTO' | 'FIAT';
  amountMinor: bigint;
  externalRef: string;
  at: Date;
  description: string;
}

type Book = 'CLIENT' | 'FIRM';

@Injectable()
export class SimulatedCustodianStatementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balanceChecker: WalletBalanceCheckerService,
  ) {}

  async recordLegMovement(input: LegMovementInput): Promise<{ outLineId: string; inLineId: string; cutoffDate: string }> {
    const source = input.assetType === 'CRYPTO' ? 'HEXTRUST' : 'ZAND';
    const cutoffDate = toBusinessDate(input.at);
    const out = await this.writeLine(input, source, input.fromWalletId, 'OUT');
    const inn = await this.writeLine(input, source, input.toWalletId, 'IN');
    await this.bumpClosing(input, source, cutoffDate, input.fromWalletId, -input.amountMinor, out.book);
    await this.bumpClosing(input, source, cutoffDate, input.toWalletId, input.amountMinor, inn.book);
    return { outLineId: out.id, inLineId: inn.id, cutoffDate };
  }

  private async walletBook(walletId: string): Promise<Book> {
    const w = await (this.prisma as any).wallet.findUnique({ where: { id: walletId }, select: { ownerType: true } });
    if (!w) throw new NotFoundException(`钱包不存在：${walletId}`);
    return w.ownerType === 'CUSTOMER' ? 'CLIENT' : 'FIRM';
  }

  private async writeLine(input: LegMovementInput, source: string, walletId: string, direction: 'IN' | 'OUT'): Promise<{ id: string; book: Book }> {
    const book = await this.walletBook(walletId);
    const dedupKey = `SIM-${input.fundsOrderNo}-${walletId}`;
    const data = {
      source, accountRef: walletId, subAccount: walletId, book, currency: input.assetCode, direction,
      amount: new Prisma.Decimal(input.amountMinor.toString()), externalRef: input.externalRef,
      datetime: input.at, description: input.description,
    };
    const row = await (this.prisma as any).externalStatementLine.upsert({
      where: { dedupKey }, update: data, create: { ...data, dedupKey }, select: { id: true },
    });
    return { id: row.id as string, book };
  }

  private async bumpClosing(input: LegMovementInput, source: string, cutoffDate: string, walletId: string, deltaMinor: bigint, book: Book): Promise<void> {
    const delta = new Prisma.Decimal(deltaMinor.toString());
    const where = { source_accountRef_cutoffDate: { source, accountRef: walletId, cutoffDate } };
    const eb = await (this.prisma as any).externalBalance.findUnique({ where });
    if (eb) {
      await (this.prisma as any).externalBalance.update({
        where: { id: eb.id },
        data: { closingBalance: new Prisma.Decimal(eb.closingBalance).plus(delta), lineCount: (eb.lineCount ?? 0) + 1 },
      });
      return;
    }
    // 当日无余额行（e2e 或铺场之前）：以引擎算出的内部余额为基准，「托管方与我们一致，只差这一笔」。
    const check = await this.balanceChecker.checkBalance({ walletRef: walletId, externalClosing: 0n, cutoff: input.at });
    await (this.prisma as any).externalBalance.create({
      data: {
        source, accountRef: walletId, currency: input.assetCode, book, cutoffDate,
        closingBalance: new Prisma.Decimal(check.internal.total.toString()).plus(delta),
        openingBalance: new Prisma.Decimal(0), asOfAt: input.at, status: 'INGESTED',
        walletRef: walletId, coaCode: check.coaCode, ownerNo: check.ownerNo, lineCount: 1,
      },
    });
  }
}
