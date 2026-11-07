// src/modules/clearing-settle/reconciliation/engine/v2/wallet-balance-checker.service.ts
//
// Per-wallet balance check (1:1 direct, no layered fallback), 戊波一 T11 版：
//   内部余额 = 该钱包「自己的现金户」上 POSTED、≤ cutoff 的流水，IN 加 OUT 减。
//   external == internal.total，否则开案——单一等式，没有回退。
//
// 现金户的取法与记账侧是**同一个解析器**（戊波二 T9a，裁定 11）：
//   AccountingService.resolveCashAccountId(walletId, ledger)——钱包 ownerType 定码
//   （CUSTOMER → 1 客户现金 / PLATFORM → 50 公司现金），ledger 由 ledgerForNetwork(wallet.network) 给
//   （AED_ZAND → 1 / TRON → 2）。读端不再自查注册表。
//   钱包不存在、或没开现金户 → 直接抛，不回落到任何别的户（没有 UNKNOWN 这一档）。
//
// 「IN」的含义：钱进这个户。现金户是借方户，借方行 = IN（投影按行所在账户类别翻方向，见
// AccountFlowProjectorService）；所以对客户钱包是"钱进来"，对公司钱包同理，外部对账单同向。
//
// 调账单落的行（sourceType = RECON_ADJUSTMENT）**计入**余额——调账就是为了让内部余额
// 追上外部；它们只是不进"逐行匹配"（见 WalletFlowMatcherService）。
//
// 对内差额（戊波二 T9a，spec §4.5，只对客户钱包）：钱包自己的两本账必须一致——
//   internalDelta = (现金 1·钱包 + 短缺待补 2·钱包) − (应付 100·该客户·该账本 + 暂扣 101·该客户·该账本)
// 四个户都用同一个 effectiveCutoffFilter、都是各户自己的 POSTED 净额（IN 加 OUT 减；贷方户的 IN = 贷 = 余额增加，
// 同一口径），按户汇总而不是按 walletRef 标签（码 2 的流水没有 walletRef，见 AccountFlowProjectorService）。
// 公司钱包没有逐钱包恒等式 → internalDelta = null。
// 前提：同一客户在同一账本至多一只 CUSTOMER 钱包（Wallet 唯一键 [vaultCode, network, ownerNo] + 两个网络各对一个账本）——
// 否则「按钱包的现金」对「按客户的应付」比不出个所以然。
//
// Inputs
//   walletRef       — Wallet.id
//   externalClosing — closing balance from ExternalBalance at the cutoff (bigint,
//                     same minor-unit scale as account_flows.amount)
//   cutoff          — reconciliation cutoff time (flows after cutoff are excluded)

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../../core/prisma/prisma.service';
import { AccountingService } from '../../../../accounting/tigerbeetle/accounting.service';
import {
  TB_ACCOUNT_CODES,
  TB_CODE_TO_COA,
  cashAccountCodeFor,
} from '../../../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { ledgerForNetwork } from '../../../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { bigintToHex } from '../../../../accounting/tigerbeetle/utils/tb-id.util';
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

/**
 * 客户钱包「自己的两本账」在截止点的四个户净额与差额（戊波二 T10 起读面也用它，案件页 Internal 格副行）：
 * delta = (cash + shortfall) − (payable + suspense)。checkBalance 的 internalDelta 与案件页读到的是同一份算式、同一个截止口径。
 */
export interface InternalBreakdown {
  cash: bigint;
  shortfall: bigint;
  payable: bigint;
  suspense: bigint;
  delta: bigint;
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
  /** (现金 + 短缺待补) − (应付 + 暂扣)，签名最小单位；公司钱包 null */
  internalDelta: bigint | null;
}

@Injectable()
export class WalletBalanceCheckerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
  ) {}

  /**
   * 钱包 → 它的现金户描述。walletRef 不是钱包（未归属外部账户的案子拿外部账号当 walletRef）→ null；
   * 钱包在但没开现金户 → 抛（记账侧同口径：没开户就是流程失败，不兜底）。
   */
  async resolveCashAccount(walletRef: string): Promise<WalletCashAccount | null> {
    return (await this.loadWallet(walletRef))?.cash ?? null;
  }

  private async loadWallet(walletRef: string): Promise<{
    cash: WalletCashAccount;
    ledger: number;
    customerId: string | null;
  } | null> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletRef },
      select: { ownerType: true, ownerNo: true, ownerId: true, network: true },
    });
    if (!wallet) return null;

    const code = cashAccountCodeFor(wallet.ownerType);
    const ledger = ledgerForNetwork(wallet.network as NetworkCode);
    let tbId: bigint;
    try {
      tbId = await this.accounting.resolveCashAccountId(walletRef, ledger);
    } catch (err) {
      // 解析器本身只有一个（记账侧那个）；这里只把「没开户」换回对账读端一直用的错误码。
      if (err instanceof NotFoundException && (err.getResponse() as { code?: string })?.code === 'TB_ACCOUNT_REGISTRY_NOT_FOUND') {
        throw new NotFoundException({
          code: 'WALLET_CASH_ACCOUNT_NOT_FOUND',
          message: `Wallet ${walletRef} has no cash account (code=${code} ledger=${ledger}) — wallet was never provisioned`,
        });
      }
      throw err;
    }

    const walletKind: WalletKind = code === TB_ACCOUNT_CODES.CLIENT_CASH ? 'CUSTOMER' : 'FIRM';
    return {
      cash: {
        walletKind,
        coaCode: TB_CODE_TO_COA[code] as WalletCashAccount['coaCode'],
        ownerNo: walletKind === 'CUSTOMER' ? wallet.ownerNo : null,
        // 户号一律补零成 32 位再去等值查流水（同款历史坑：首位 0 的户号在某一侧少一位，等值查询会静默查空）。
        tbAccountId: bigintToHex(tbId),
      },
      ledger,
      customerId: walletKind === 'CUSTOMER' ? wallet.ownerId : null,
    };
  }

  /** 一个户在截止点的 POSTED 净额：IN 加、OUT 减（含调账行）。四个户共用这一处，所以共用同一个截止口径。 */
  private async netPosted(tbAccountId: string, cutoff: Date): Promise<bigint> {
    const flows = await this.prisma.accountFlow.findMany({
      where: {
        tbAccountId,
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
    return total;
  }

  /** 客户钱包的四户净额（现金由调用方给，已经算过一次的不重算）。对内差额的唯一算式在这里。 */
  private async customerBreakdown(
    walletRef: string,
    customerId: string,
    ledger: number,
    cash: bigint,
    cutoff: Date,
  ): Promise<InternalBreakdown> {
    const accountHex = async (params: { code: number; ownerType: string; ownerUuid: string }) =>
      bigintToHex(await this.accounting.resolveTbAccountId({ ...params, ledger }));
    const shortfall = await this.netPosted(
      await accountHex({ code: TB_ACCOUNT_CODES.CLIENT_SHORTFALL, ownerType: 'WALLET', ownerUuid: walletRef }),
      cutoff,
    );
    const payable = await this.netPosted(
      await accountHex({ code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ownerType: 'CUSTOMER', ownerUuid: customerId }),
      cutoff,
    );
    const suspense = await this.netPosted(
      await accountHex({ code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ownerType: 'CUSTOMER', ownerUuid: customerId }),
      cutoff,
    );
    return { cash, shortfall, payable, suspense, delta: (cash + shortfall) - (payable + suspense) };
  }

  /**
   * 读面用：一个客户钱包在截止点的四户净额与对内差额（案件页 Internal 格副行）。
   * 公司钱包 / 不是钱包的 walletRef（未归属外部账户）→ null。算式与 checkBalance 共用 customerBreakdown。
   */
  async internalBreakdown(walletRef: string, cutoff: Date): Promise<InternalBreakdown | null> {
    const loaded = await this.loadWallet(walletRef);
    if (!loaded || loaded.cash.walletKind !== 'CUSTOMER') return null;
    const cash = await this.netPosted(loaded.cash.tbAccountId, cutoff);
    return this.customerBreakdown(walletRef, loaded.customerId as string, loaded.ledger, cash, cutoff);
  }

  async checkBalance(input: {
    walletRef: string;
    externalClosing: bigint;
    cutoff: Date;
  }): Promise<WalletBalanceCheckResult> {
    const { walletRef, externalClosing, cutoff } = input;

    const loaded = await this.loadWallet(walletRef);
    if (!loaded) {
      throw new NotFoundException({
        code: 'WALLET_NOT_FOUND',
        message: `Wallet ${walletRef} not found — cannot check its balance`,
      });
    }
    const { cash, ledger, customerId } = loaded;

    const total = await this.netPosted(cash.tbAccountId, cutoff);
    const delta = externalClosing - total;

    const internalDelta = cash.walletKind === 'CUSTOMER'
      ? (await this.customerBreakdown(walletRef, customerId as string, ledger, total, cutoff)).delta
      : null;

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
      internalDelta,
    };
  }
}
