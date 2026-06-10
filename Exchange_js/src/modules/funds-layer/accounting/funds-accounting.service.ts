import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { TB_CODE_TO_COA } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import {
  TransferPath,
  TRANSFER_PATH_WHITELIST,
} from '../constants/internal-transfer-paths.constant';
import { decimalToTbUnits } from './tb-amount.util';

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
   * 物理资金流完成时的 TB 镜像:客户池 ↔ FIRM_OPS,金额 = transfer.amount。
   * 结算腿(SETTLE_*)与提现费去混同(FEE_DECOMMINGLE)共用;无 mirror 的路径 no-op。
   * 幂等:evidence (sourceType, internalTxNo, eventCode) → deterministic transfer id。
   */
  async mirrorPhysicalTransfer(input: {
    internalTransferId: string;
    tx?: Prisma.TransactionClient;
  }): Promise<ApplyResult> {
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

    const policy = TRANSFER_PATH_WHITELIST[transfer.pathLabel as TransferPath];
    const mirror = policy?.mirror;
    if (!mirror) return { tbApplied: false };

    // Multi-hop routes (fiat 2-hop via F_SET): mirror only when every hop has
    // physically CLEARed — a manually cleared first hop must not book the full
    // movement while funds still sit in the transit wallet.
    if (policy.route && policy.route.length > 0) {
      const funds = await (db as any).internalFund.findMany({
        where: { internalTransactionId: transfer.id },
        select: { status: true },
      });
      const allClear = funds.length > 0 && funds.every((f: any) => f.status === 'CLEAR');
      if (!allClear) return { tbApplied: false };
    }

    const currency = transfer.asset.currency;
    const ledger = (TB_LEDGERS as Record<string, number>)[currency];
    if (!ledger) {
      throw new NotFoundException({
        code: 'TB_LEDGER_NOT_FOUND',
        message: `Unsupported asset currency for TB accounting: ${currency}`,
      });
    }

    const amount = decimalToTbUnits(new Prisma.Decimal(transfer.amount), transfer.asset.decimals);
    if (amount <= 0n) return { tbApplied: false };

    const poolCode = transfer.asset.type === 'FIAT' ? TB_ACCOUNT_CODES.CLIENT_BANK : TB_ACCOUNT_CODES.CLIENT_CUSTODY;
    const poolId = await this.accounting.resolveTbAccountId({ code: poolCode, ledger, ownerType: 'SYSTEM' });
    const firmId = await this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FIRM_OPS, ledger, ownerType: 'SYSTEM' });

    const isFeePath =
      transfer.pathLabel === TransferPath.FEE_COLLECT ||
      transfer.pathLabel === TransferPath.FIAT_FEE_COLLECT;

    const debitAccountId = mirror === 'POOL_TO_FIRM' ? firmId : poolId;
    const creditAccountId = mirror === 'POOL_TO_FIRM' ? poolId : firmId;
    const debitTbCode = mirror === 'POOL_TO_FIRM' ? TB_ACCOUNT_CODES.FIRM_OPS : poolCode;
    const creditTbCode = mirror === 'POOL_TO_FIRM' ? poolCode : TB_ACCOUNT_CODES.FIRM_OPS;

    let code: number;
    let eventCode: string;
    if (isFeePath) {
      code = TB_TRANSFER_CODES.FEE_DECOMMINGLE;
      eventCode = 'FEE_DECOMMINGLE';
    } else if (mirror === 'POOL_TO_FIRM') {
      code = TB_TRANSFER_CODES.SETTLE_POOL_TO_FIRM;
      eventCode = 'SETTLE_POOL_TO_FIRM';
    } else {
      code = TB_TRANSFER_CODES.SETTLE_FIRM_TO_POOL;
      eventCode = 'SETTLE_FIRM_TO_POOL';
    }

    const { tbTransferId } = await this.accounting.executeTransfer({
      debitAccountId,
      creditAccountId,
      amount,
      ledger,
      code,
      tx: input.tx,
      evidence: {
        sourceType: transfer.sourceType ?? 'INTERNAL_TRANSFER',
        sourceNo: transfer.internalTxNo,
        eventCode,
        debitCode: TB_CODE_TO_COA[debitTbCode],
        creditCode: TB_CODE_TO_COA[creditTbCode],
        assetCurrency: currency,
        traceId: transfer.traceId ?? `MIRROR:${transfer.internalTxNo}`,
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        memo: `${transfer.pathLabel} physical mirror (${eventCode})`,
      },
    });

    return { tbApplied: true, tbTransferId };
  }
}
