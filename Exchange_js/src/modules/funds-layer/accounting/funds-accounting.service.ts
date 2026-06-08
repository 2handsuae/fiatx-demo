import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
   * B 类：drain <drainAcct> ↔ 对手账户（crypto=CUSTODY，fiat=BANK，由 asset.type 选择）。
   * direction 由 drain 账户的实际余额符号决定
   * （net CREDIT → drain out；net DEBIT → drain in），policy.drain 选择 drain 账户。
   * TRADE_CLEARING (EOD settlement) 和 FEE_RECEIVABLE (fee collection) 共用此逻辑。
   */
  async applyAccounting(input: {
    accountingClass: AccountingClass;
    internalTransferId: string;
    tx?: Prisma.TransactionClient;
  }): Promise<ApplyResult> {
    if (input.accountingClass === AccountingClass.A) {
      return { tbApplied: false };
    }

    // When called inside an interactive $transaction (SQLite holds a separate
    // connection), the just-created transfer row is only visible via the same
    // tx client — read through it so the drain is atomic with creation.
    const db = input.tx ?? this.prisma;
    const transfer = await db.internalTransaction.findUnique({
      where: { id: input.internalTransferId },
      include: { asset: true },
    });
    if (!transfer) {
      throw new NotFoundException({
        code: 'INTERNAL_TRANSFER_NOT_FOUND',
        message: `Internal transfer ${input.internalTransferId} not found`,
      });
    }

    // policy.drain selects which SYSTEM account's residual balance gets drained.
    const policy = TRANSFER_PATH_WHITELIST[transfer.pathLabel as TransferPath];
    const drain = policy?.drain;
    let drainTbCode: number;
    let drainOutCode: number;
    let drainInCode: number;
    let drainSourceType: string;
    let drainMemo: string;
    let eventOut: string;
    let eventIn: string;
    if (drain === 'TRADE_CLEARING') {
      drainTbCode = TB_ACCOUNT_CODES.TRADE_CLEARING;
      drainOutCode = TB_TRANSFER_CODES.EOD_DRAIN_OUT;
      drainInCode = TB_TRANSFER_CODES.EOD_DRAIN_IN;
      // TRADE_CLEARING is drained by both crypto EOD and fiat per-swap settlement.
      // Attribute the TB evidence to the actual transfer (EOD_SETTLEMENT vs
      // FIAT_SETTLEMENT) so V8 reconciliation can look it up by sourceType.
      drainSourceType = transfer.sourceType ?? 'EOD_SETTLEMENT';
      drainMemo = `${drainSourceType} TRADE_CLEARING drain`;
      eventOut = 'EOD_DRAIN_OUT';
      eventIn = 'EOD_DRAIN_IN';
    } else if (drain === 'FEE_RECEIVABLE') {
      drainTbCode = TB_ACCOUNT_CODES.FEE_RECEIVABLE;
      // FEE_RECEIVABLE only accrues CREDITS → only the drain-out direction occurs,
      // but keep the generic sign logic so a single code covers both directions.
      drainOutCode = TB_TRANSFER_CODES.FEE_DRAIN;
      drainInCode = TB_TRANSFER_CODES.FEE_DRAIN;
      drainSourceType = 'FEE_COLLECTION';
      drainMemo = 'FEE_RECEIVABLE drain';
      eventOut = 'FEE_DRAIN';
      eventIn = 'FEE_DRAIN';
    } else {
      throw new BadRequestException({
        code: 'B_CLASS_DRAIN_UNSUPPORTED',
        message: `B-class drain=${drain ?? 'UNKNOWN'} is not supported`,
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

    const drainAcctId = await this.accounting.resolveTbAccountId({
      code: drainTbCode,
      ledger,
      ownerType: 'SYSTEM',
    });
    const counterpartyCode =
      transfer.asset.type === 'FIAT'
        ? TB_ACCOUNT_CODES.BANK
        : TB_ACCOUNT_CODES.CUSTODY;
    const counterpartyId = await this.accounting.resolveTbAccountId({
      code: counterpartyCode,
      ledger,
      ownerType: 'SYSTEM',
    });

    // lookupBalance returns bigint posted amounts → net is already in TB units;
    // the drain amount needs no decimal conversion.
    const balance = await this.accounting.lookupBalance(drainAcctId);
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
      // drain account net CREDIT → debit it to zero, credit counterparty (CUSTODY or BANK).
      debitAccountId = drainAcctId;
      creditAccountId = counterpartyId;
      drainCode = drainOutCode;
      debitTbCode = drainTbCode;
      creditTbCode = counterpartyCode;
    } else {
      // drain account net DEBIT → credit it to zero, debit counterparty (CUSTODY or BANK).
      debitAccountId = counterpartyId;
      creditAccountId = drainAcctId;
      drainCode = drainInCode;
      debitTbCode = counterpartyCode;
      creditTbCode = drainTbCode;
    }

    const eventCode = net > 0n ? eventOut : eventIn;
    const { tbTransferId } = await this.accounting.executeTransfer({
      debitAccountId,
      creditAccountId,
      amount,
      ledger,
      code: drainCode,
      tx: input.tx,
      evidence: {
        sourceType: drainSourceType,
        sourceNo: transfer.internalTxNo,
        eventCode,
        debitCode: TB_CODE_TO_COA[debitTbCode],
        creditCode: TB_CODE_TO_COA[creditTbCode],
        assetCurrency: currency,
        traceId: transfer.traceId ?? `EOD:${transfer.internalTxNo}`,
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        memo: drainMemo,
      },
    });

    return { tbApplied: true, tbTransferId };
  }

  async drainFeeReceivableAmount(input: {
    internalTransferId: string;
    amount: Prisma.Decimal;
    tx?: Prisma.TransactionClient;
  }): Promise<{ tbApplied: boolean; tbTransferId?: bigint }> {
    const db = input.tx ?? this.prisma;
    const transfer = await db.internalTransaction.findUnique({
      where: { id: input.internalTransferId },
      include: { asset: true },
    });
    if (!transfer) {
      throw new NotFoundException({
        code: 'INTERNAL_TRANSFER_NOT_FOUND',
        message: `Internal transfer ${input.internalTransferId} not found`,
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
    const amountUnits = this.decimalToTbUnits(input.amount, transfer.asset.decimals);
    if (amountUnits <= 0n) return { tbApplied: false };

    const counterpartyCode =
      transfer.asset.type === 'FIAT' ? TB_ACCOUNT_CODES.BANK : TB_ACCOUNT_CODES.CUSTODY;
    const feeReceivableId = await this.accounting.resolveTbAccountId({
      code: TB_ACCOUNT_CODES.FEE_RECEIVABLE,
      ledger,
      ownerType: 'SYSTEM',
    });
    const counterpartyId = await this.accounting.resolveTbAccountId({
      code: counterpartyCode,
      ledger,
      ownerType: 'SYSTEM',
    });
    const { tbTransferId } = await this.accounting.executeTransfer({
      debitAccountId: feeReceivableId,
      creditAccountId: counterpartyId,
      amount: amountUnits,
      ledger,
      code: TB_TRANSFER_CODES.FEE_DRAIN,
      tx: input.tx,
      evidence: {
        sourceType: 'FIAT_FEE_COLLECTION',
        sourceNo: transfer.internalTxNo,
        eventCode: 'FEE_DRAIN',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FEE_RECEIVABLE],
        creditCode: TB_CODE_TO_COA[counterpartyCode],
        assetCurrency: currency,
        traceId: transfer.traceId ?? `FEE:${transfer.internalTxNo}`,
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        memo: 'FIAT fee collection drain',
      },
    });
    return { tbApplied: true, tbTransferId };
  }

  private decimalToTbUnits(value: Prisma.Decimal, decimals: number): bigint {
    const str = value.toFixed(decimals);
    const [whole, frac = ''] = str.split('.');
    const padded = frac.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + padded);
  }
}
