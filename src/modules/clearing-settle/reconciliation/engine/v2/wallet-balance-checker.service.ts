// src/modules/clearing-settle/reconciliation/engine/v2/wallet-balance-checker.service.ts
//
// Per-wallet balance check (1:1 direct, no layered fallback), 戊波一 T11 版：
//   内部余额 = 该钱包「自己的现金户」上 POSTED、≤ cutoff 的流水，IN 加 OUT 减。
//   external == internal.total，否则开案——单一等式，没有回退。
//
// 现金户的取法与记账侧一致（AccountingService.resolveCashAccountId）：
//   钱包 ownerType 定码（CUSTOMER → 1 客户现金 / PLATFORM → 50 公司现金），
//   network 定账本（AED_ZAND → 1 / TRON → 2），再按注册表 (code, ledger, 'WALLET', walletRef) 得户。
//   钱包不存在、或没开现金户 → 直接抛，不回落到任何别的户（没有 UNKNOWN 这一档）。
//
// 「IN」的含义：钱进这个户。现金户是借方户，借方行 = IN（投影按行所在账户类别翻方向，见
// AccountFlowProjectorService）；所以对客户钱包是"钱进来"，对公司钱包同理，外部对账单同向。
//
// 调账单落的行（sourceType = RECON_ADJUSTMENT）**计入**余额——调账就是为了让内部余额
// 追上外部；它们只是不进"逐行匹配"（见 WalletFlowMatcherService）。
//
// Inputs
//   walletRef       — Wallet.id
//   externalClosing — closing balance from ExternalBalance at the cutoff (bigint,
//                     same minor-unit scale as account_flows.amount)
//   cutoff          — reconciliation cutoff time (flows after cutoff are excluded)

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../../core/prisma/prisma.service';
import {
  TB_ACCOUNT_CODES,
  TB_CODE_TO_COA,
  cashAccountCodeFor,
} from '../../../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { ledgerForNetwork } from '../../../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import type { NetworkCode } from '../../../../../config/manifests/networks.manifest';
import { effectiveCutoffFilter } from './effective-cutoff';

type WalletKind = 'CUSTOMER' | 'FIRM';

/** 一个钱包的现金户：对账引擎读流水的唯一落点。 */
export interface WalletCashAccount {
  walletKind: WalletKind;
  coaCode: 'A.CLIENT_CASH' | 'A.FIRM_CASH';
  /** 客户钱包 = 客户号；公司钱包没有客户归属 = null */
  ownerNo: string | null;
  /** 32 位补零十六进制——与 account_flows.tbAccountId 同形，可直接等值查流水 */
  tbAccountId: string;
}

export interface WalletBalanceCheckResult {
  pass: boolean;
  walletRef: string;
  walletKind: WalletKind;
  coaCode: 'A.CLIENT_CASH' | 'A.FIRM_CASH';
  ownerNo: string | null;
  cashTbAccountId: string;
  internal: { total: bigint };
  external: bigint;
  delta: bigint;                            // external − internal.total
}

const padTbId = (id: string) => (id.length < 32 ? id.padStart(32, '0') : id);

@Injectable()
export class WalletBalanceCheckerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 钱包 → 它的现金户。walletRef 不是钱包（未归属外部账户的案子拿外部账号当 walletRef）→ null；
   * 钱包在但没开现金户 → 抛（记账侧同口径：没开户就是流程失败，不兜底）。
   */
  async resolveCashAccount(walletRef: string): Promise<WalletCashAccount | null> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletRef },
      select: { ownerType: true, ownerNo: true, network: true },
    });
    if (!wallet) return null;

    const code = cashAccountCodeFor(wallet.ownerType);
    const ledger = ledgerForNetwork(wallet.network as NetworkCode);
    const reg = await this.prisma.tbAccountRegistry.findFirst({
      where: { code, ledger, ownerType: 'WALLET', ownerUuid: walletRef, status: 'ACTIVE' },
      select: { tbAccountId: true },
    });
    if (!reg) {
      throw new NotFoundException({
        code: 'WALLET_CASH_ACCOUNT_NOT_FOUND',
        message: `Wallet ${walletRef} has no cash account (code=${code} ledger=${ledger}) — wallet was never provisioned`,
      });
    }

    const walletKind: WalletKind = code === TB_ACCOUNT_CODES.CLIENT_CASH ? 'CUSTOMER' : 'FIRM';
    return {
      walletKind,
      coaCode: TB_CODE_TO_COA[code] as WalletCashAccount['coaCode'],
      ownerNo: walletKind === 'CUSTOMER' ? wallet.ownerNo : null,
      // 取流水用补零后的 32 位户号（同款历史坑：首位 0 的户号在某一侧少一位，等值查询会静默查空）。
      tbAccountId: padTbId(reg.tbAccountId),
    };
  }

  async checkBalance(input: {
    walletRef: string;
    externalClosing: bigint;
    cutoff: Date;
  }): Promise<WalletBalanceCheckResult> {
    const { walletRef, externalClosing, cutoff } = input;

    const cash = await this.resolveCashAccount(walletRef);
    if (!cash) {
      throw new NotFoundException({
        code: 'WALLET_NOT_FOUND',
        message: `Wallet ${walletRef} not found — cannot check its balance`,
      });
    }

    // 现金户上 POSTED、≤ cutoff 的全部行（含调账行）：IN 加、OUT 减。
    const flows = await this.prisma.accountFlow.findMany({
      where: {
        tbAccountId: cash.tbAccountId,
        transferType: 'POSTED',
        ...effectiveCutoffFilter(cutoff),
      },
      select: { direction: true, amount: true },
    });

    let total = 0n;
    for (const f of flows) {
      const amt = BigInt(f.amount.toString());
      total += f.direction === 'IN' ? amt : -amt;
    }

    const delta = externalClosing - total;
    return {
      pass: delta === 0n,
      walletRef,
      walletKind: cash.walletKind,
      coaCode: cash.coaCode,
      ownerNo: cash.ownerNo,
      cashTbAccountId: cash.tbAccountId,
      internal: { total },
      external: externalClosing,
      delta,
    };
  }
}
