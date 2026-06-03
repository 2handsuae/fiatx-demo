import { Injectable, NotFoundException, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { TB_CODE_TO_COA } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import {
  AccountingClass,
  TransferPath,
  TRANSFER_PATH_WHITELIST,
} from '../constants/internal-transfer-paths.constant';

type ApplyResult =
  | { tbApplied: false }
  | { tbApplied: true; tbTransferId: bigint };

@Injectable()
export class FundsAccountingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
  ) {}

  /**
   * A 类：客户资产在公司钱包间搬位置，TB 托管余额不变 → 不产生 TB transfer。
   * B 类：drain TRADE_CLEARING ↔ CUSTODY。direction 由 TRADE_CLEARING 的实际
   * 余额符号决定（net CREDIT → drain out；net DEBIT → drain in），pathLabel
   * 仅用于选择 drain 账户。FEE_RECEIVABLE drain 留待 Phase 4。
   */
  async applyAccounting(input: {
    accountingClass: AccountingClass;
    internalTransferId: string;
  }): Promise<ApplyResult> {
    if (input.accountingClass === AccountingClass.A) {
      return { tbApplied: false };
    }

    const transfer = await this.prisma.internalTransaction.findUnique({
      where: { id: input.internalTransferId },
      include: { asset: true },
    });
    if (!transfer) {
      throw new NotFoundException({
        code: 'INTERNAL_TRANSFER_NOT_FOUND',
        message: `Internal transfer ${input.internalTransferId} not found`,
      });
    }

    // pathLabel selects which SYSTEM account TRADE_CLEARING balance gets drained.
    const policy = TRANSFER_PATH_WHITELIST[transfer.pathLabel as TransferPath];
    const drain = policy?.drain;
    if (drain !== 'TRADE_CLEARING') {
      // FEE_RECEIVABLE drain (FEE_COLLECT) lands in Phase 4.
      throw new NotImplementedException({
        code: 'B_CLASS_FEE_RECEIVABLE_PENDING',
        message: `B-class drain=${drain ?? 'UNKNOWN'} accounting is implemented in Phase 4`,
      });
    }

    const currency = transfer.asset.currency;
    const ledger = (TB_LEDGERS as Record<string, number>)[currency];
    if (!ledger) {
      throw new NotFoundException({
        code: 'TB_LEDGER_NOT_FOUND',
        message: `Unsupported asset currency for TB accounting: ${currency}`,
      });
    }

    const tradeClearingId = await this.accounting.resolveTbAccountId({
      code: TB_ACCOUNT_CODES.TRADE_CLEARING,
      ledger,
      ownerType: 'SYSTEM',
    });
    const custodyId = await this.accounting.resolveTbAccountId({
      code: TB_ACCOUNT_CODES.CUSTODY,
      ledger,
      ownerType: 'SYSTEM',
    });

    // lookupBalance returns bigint posted amounts → net is already in TB units;
    // the drain amount needs no decimal conversion.
    const balance = await this.accounting.lookupBalance(tradeClearingId);
    const net = balance.creditsPosted - balance.debitsPosted;
    if (net === 0n) {
      return { tbApplied: false };
    }

    const amount = net > 0n ? net : -net;

    // Direction is driven PURELY by the balance sign — self-correcting.
    let debitAccountId: bigint;
    let creditAccountId: bigint;
    let drainCode: number;
    let debitTbCode: number;
    let creditTbCode: number;
    if (net > 0n) {
      // TRADE_CLEARING net CREDIT → debit it to zero, credit CUSTODY.
      debitAccountId = tradeClearingId;
      creditAccountId = custodyId;
      drainCode = TB_TRANSFER_CODES.EOD_DRAIN_OUT;
      debitTbCode = TB_ACCOUNT_CODES.TRADE_CLEARING;
      creditTbCode = TB_ACCOUNT_CODES.CUSTODY;
    } else {
      // TRADE_CLEARING net DEBIT → credit it to zero, debit CUSTODY.
      debitAccountId = custodyId;
      creditAccountId = tradeClearingId;
      drainCode = TB_TRANSFER_CODES.EOD_DRAIN_IN;
      debitTbCode = TB_ACCOUNT_CODES.CUSTODY;
      creditTbCode = TB_ACCOUNT_CODES.TRADE_CLEARING;
    }

    const eventCode = net > 0n ? 'EOD_DRAIN_OUT' : 'EOD_DRAIN_IN';
    const { tbTransferId } = await this.accounting.executeTransfer({
      debitAccountId,
      creditAccountId,
      amount,
      ledger,
      code: drainCode,
      evidence: {
        sourceType: 'EOD_SETTLEMENT',
        sourceNo: transfer.internalTxNo,
        eventCode,
        debitCode: TB_CODE_TO_COA[debitTbCode],
        creditCode: TB_CODE_TO_COA[creditTbCode],
        assetCurrency: currency,
        traceId: transfer.traceId ?? `EOD:${transfer.internalTxNo}`,
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        memo: 'EOD TRADE_CLEARING drain',
      },
    });

    return { tbApplied: true, tbTransferId };
  }
}
