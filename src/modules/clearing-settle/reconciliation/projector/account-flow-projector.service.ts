// src/modules/clearing-settle/reconciliation/projector/account-flow-projector.service.ts
//
// 把每条 TbTransferEvidence 投影成两行 AccountFlow（借方账户一行、贷方账户一行），
// 让单个钱包 / 单个账户的流水下钻是一次走索引的查询，而不是读时 OR 过滤 + 现算方向。
//
// 戊波一起的两条规则：
//   1. 方向按账户类别，含义统一为「钱进这个户 = IN」：
//      借方户（现金 1 / 50、开支 300–302）借 = IN、贷 = OUT；
//      贷方户（应付 / 暂挂 / 权益 / 收入）贷 = IN、借 = OUT。
//      类别从凭证自带的助记码（debitCode / creditCode）判，不查注册表。
//   2. walletRef 是派生值：该行账户在注册表里若是 WALLET 归属（现金户，一钱包一户），
//      填其 ownerUuid（= 钱包 id），否则 null。调用方不再自己算、也不再传钱包标签。
//
// `(tbTransferId, tbAccountId)` 唯一：persist 重复调用（例如 enrichForPost 把 LOCK 提到 POST）
// 是 upsert，更新已有两行，不会重复插入。

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  COA_TO_TB_CODE,
  isDebitNormalCode,
} from '../../../accounting/tigerbeetle/constants/tb-account-codes.constant';

interface EvidenceLike {
  tbTransferId: string;
  sourceType: string;
  sourceNo: string;
  eventCode: string;
  /** 助记码（'A.CLIENT_CASH' 等），决定两侧各自的账户类别 */
  debitCode: string;
  creditCode: string;
  debitTbAccountId: string | null;
  creditTbAccountId: string | null;
  amount: number | Prisma.Decimal | string;
  assetCode: string;
  transferType: string;
  createdAt: Date | string;
  effectiveDate: string;
  externalRef?: string | null;
  debitBalanceAfter?: string | null;
  creditBalanceAfter?: string | null;
}

export interface AccountFlowRow {
  tbTransferId: string;
  tbAccountId: string;
  walletRef: string | null;
  direction: 'IN' | 'OUT';
  amount: number | Prisma.Decimal | string;
  externalRef: string | null;
  eventCode: string;
  sourceType: string;
  sourceNo: string;
  transferType: string;
  assetCode: string;
  createdAt: Date;
  effectiveDate: string;
  balanceAfter: string | null;
}

// Narrow client surface — accepts both PrismaClient and Prisma.TransactionClient.
type AccountFlowClient = {
  accountFlow: {
    upsert: (args: any) => Promise<any>;
  };
  tbAccountRegistry: {
    findMany: (args: any) => Promise<any[]>;
  };
};

/** 钱进这个户 = IN：借方户上的借方行 / 贷方户上的贷方行 = IN，反之 OUT。 */
function directionOf(side: 'DEBIT' | 'CREDIT', coaCode: string): 'IN' | 'OUT' {
  const accountIsDebitNormal = isDebitNormalCode(COA_TO_TB_CODE[coaCode] ?? -1);
  return (side === 'DEBIT') === accountIsDebitNormal ? 'IN' : 'OUT';
}

@Injectable()
export class AccountFlowProjectorService {
  /**
   * Pure projection: evidence → up to 2 flow rows，方向按各自账户类别。
   * `walletRefByAccountId`：tbAccountId → 钱包 id（仅 WALLET 归属的账户有值）；
   * 不传则 walletRef 全为 null（纯投影不查库，派生由 persist 负责）。
   * 某侧没有 TB 账户 id（历史 / 残缺行）则丢掉该侧——唯一索引也不接受 tbAccountId = null。
   */
  projectEvidence(
    evidence: EvidenceLike,
    walletRefByAccountId: ReadonlyMap<string, string | null> = new Map(),
  ): AccountFlowRow[] {
    const createdAt = evidence.createdAt instanceof Date
      ? evidence.createdAt
      : new Date(evidence.createdAt);
    const shared = {
      tbTransferId: evidence.tbTransferId,
      amount: evidence.amount,
      externalRef: evidence.externalRef ?? null,
      eventCode: evidence.eventCode,
      sourceType: evidence.sourceType,
      sourceNo: evidence.sourceNo,
      transferType: evidence.transferType,
      assetCode: evidence.assetCode,
      createdAt,
      effectiveDate: evidence.effectiveDate,
    };

    const rows: AccountFlowRow[] = [];

    if (evidence.debitTbAccountId) {
      rows.push({
        ...shared,
        tbAccountId: evidence.debitTbAccountId,
        walletRef: walletRefByAccountId.get(evidence.debitTbAccountId) ?? null,
        direction: directionOf('DEBIT', evidence.debitCode),
        balanceAfter: evidence.debitBalanceAfter ?? null,
      });
    }

    if (evidence.creditTbAccountId) {
      rows.push({
        ...shared,
        tbAccountId: evidence.creditTbAccountId,
        walletRef: walletRefByAccountId.get(evidence.creditTbAccountId) ?? null,
        direction: directionOf('CREDIT', evidence.creditCode),
        balanceAfter: evidence.creditBalanceAfter ?? null,
      });
    }

    return rows;
  }

  /**
   * Upsert the projection rows. `where` uses the (tbTransferId, tbAccountId)
   * unique constraint so re-projection updates the existing rows.
   *
   * walletRef 派生：按两侧 tbAccountId 一次批量查注册表，ownerType = 'WALLET'
   * 则取 ownerUuid（钱包 id），其余（SYSTEM / CUSTOMER / LP / 注册表无此行）为 null。
   *
   * The caller is responsible for atomicity with the evidence write — pass
   * the same Prisma.TransactionClient so the evidence row and its flow rows
   * commit together.
   */
  async persist(client: AccountFlowClient, evidence: EvidenceLike): Promise<void> {
    const accountIds = [evidence.debitTbAccountId, evidence.creditTbAccountId]
      .filter((id): id is string => !!id);
    const registryRows = accountIds.length
      ? await client.tbAccountRegistry.findMany({
          where: { tbAccountId: { in: accountIds } },
          select: { tbAccountId: true, ownerType: true, ownerUuid: true },
        })
      : [];
    const walletRefByAccountId = new Map<string, string | null>(
      registryRows.map((r: any) => [
        r.tbAccountId as string,
        r.ownerType === 'WALLET' ? (r.ownerUuid ?? null) : null,
      ]),
    );

    for (const row of this.projectEvidence(evidence, walletRefByAccountId)) {
      await client.accountFlow.upsert({
        where: {
          tbTransferId_tbAccountId: {
            tbTransferId: row.tbTransferId,
            tbAccountId: row.tbAccountId,
          },
        },
        create: row,
        update: {
          walletRef: row.walletRef,
          direction: row.direction,
          amount: row.amount,
          externalRef: row.externalRef,
          eventCode: row.eventCode,
          sourceType: row.sourceType,
          sourceNo: row.sourceNo,
          transferType: row.transferType,
          assetCode: row.assetCode,
          effectiveDate: row.effectiveDate,
          // balanceAfter only written when the (re)projection actually carries
          // one — a POST re-projection with no balance must NOT null out the
          // value an earlier LOCK/POST already stamped.
          ...(row.balanceAfter != null ? { balanceAfter: row.balanceAfter } : {}),
          // createdAt intentionally NOT updated — preserves the original
          // evidence timestamp across re-projections (LOCK→POST etc.).
        },
      });
    }
  }
}
