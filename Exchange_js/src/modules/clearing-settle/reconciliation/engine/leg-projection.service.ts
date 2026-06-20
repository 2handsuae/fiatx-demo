import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';

/**
 * 内部"账户腿"（read-time 投影，只取终态）。spec 2026-06-20 §4.1。
 * 投影源是真实 payin/payout/internal_fund；在途（未终态）不投影 → 它们是式4/5 的在途时序，不是 break。
 * - 法币腿 account 滚到 CMA（§2.5），保留 sub_account=VIBAN（下钻定位客户）。
 * - external_ref = txHash || referenceNo（crypto 走 txHash，fiat 走银行 referenceNo）；主匹配判别键。
 */
export interface InternalLeg {
  source: 'PAYIN' | 'PAYOUT' | 'INTERNALFUND';
  sourceId: string;
  sourceNo: string;
  account: string; // 法币=CMA；crypto=钱包 vaultId（缺则 walletId）
  subAccount: string | null; // VIBAN / walletId（下钻 + 法币入金模糊配）
  direction: 'IN' | 'OUT';
  currency: string;
  amount: Prisma.Decimal;
  externalRef: string | null; // txHash || referenceNo
  datetime: Date; // createdAt（fallback 模糊配的时序锚）
}

/** 法币 account_ref 一律滚到 CMA（§2.5）。与假对账单生成器同源常量，保证两边账户键对齐。 */
export const FIAT_CMA_ACCOUNT: Record<string, string> = {
  AED: 'C_CMA-AED-0001',
};

/** 是否法币币种（滚 CMA）。USDT 等虚拟币按 vault 逐钱包。 */
export function isFiat(currency: string): boolean {
  return currency in FIAT_CMA_ACCOUNT;
}

type WalletRef = { id?: string; vaultId?: string | null; iban?: string | null } | null | undefined;

@Injectable()
export class LegProjectionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 把当日终态的真实内部资金单投影成账户腿。
   * @param assetId  资产 id
   * @param currency 币种 code（AED/USDT…）— 决定 CMA 滚动
   * @param businessDate 业务日 D（YYYY-MM-DD）
   * @param cutoff   D 结束（次日 00:00）
   */
  async project(
    assetId: string,
    currency: string,
    businessDate: string,
    cutoff: Date,
  ): Promise<InternalLeg[]> {
    const start = new Date(`${businessDate}T00:00:00.000Z`);
    const legs: InternalLeg[] = [];

    // ① Payin(CLEARED) → 1 IN 腿（toWallet→account；fiat 滚 CMA）
    const payins = await this.prisma.payin.findMany({
      where: { assetId, status: 'CLEARED', createdAt: { gte: start, lt: cutoff } },
      select: {
        id: true, payinNo: true, amount: true, txHash: true, referenceNo: true, createdAt: true,
        toWallet: { select: { id: true, vaultId: true, iban: true } },
      },
    });
    for (const p of payins) {
      legs.push(this.makeLeg('PAYIN', p.id, p.payinNo, p.amount, 'IN', currency,
        p.txHash, p.referenceNo, p.createdAt, p.toWallet));
    }

    // ② Payout(终态 CLEARED) → 1 OUT 腿（srcWallet = 客户被借记钱包；payoutRef/txHash || referenceNo）
    //    CLEARED 即已物理出账 → 不带 createdAt 窗口（与 in-transit/spec 一致）。
    //    Payout 无 fromWallet 关系 → 经 ownerId 反查客户钱包（与假对账单生成器 ownerToViban/Vault 同源）。
    const payouts = await this.prisma.payout.findMany({
      where: { assetId, status: 'CLEARED' },
      select: { id: true, payoutNo: true, amount: true, txHash: true, referenceNo: true, createdAt: true, ownerId: true },
    });
    const ownerWallet = await this.buildOwnerWalletMap(assetId, currency, payouts);
    for (const po of payouts) {
      legs.push(this.makeLeg('PAYOUT', po.id, po.payoutNo, po.amount, 'OUT', currency,
        po.txHash, po.referenceNo, po.createdAt, po.ownerId ? ownerWallet.get(po.ownerId) : null));
    }

    // ③ InternalFund(CLEAR) → 2 腿：(fromWallet, OUT) + (toWallet, IN)，共享 txHash/referenceNo
    const funds = await this.prisma.internalFund.findMany({
      where: { assetId, status: 'CLEAR', createdAt: { gte: start, lt: cutoff } },
      select: {
        id: true, internalFundNo: true, amount: true, txHash: true, referenceNo: true, createdAt: true,
        fromWallet: { select: { id: true, vaultId: true, iban: true } },
        toWallet: { select: { id: true, vaultId: true, iban: true } },
      },
    });
    for (const f of funds) {
      legs.push(this.makeLeg('INTERNALFUND', f.id, f.internalFundNo, f.amount, 'OUT', currency,
        f.txHash, f.referenceNo, f.createdAt, f.fromWallet));
      legs.push(this.makeLeg('INTERNALFUND', f.id, f.internalFundNo, f.amount, 'IN', currency,
        f.txHash, f.referenceNo, f.createdAt, f.toWallet));
    }

    return legs;
  }

  private makeLeg(
    source: InternalLeg['source'],
    sourceId: string,
    sourceNo: string,
    amount: Prisma.Decimal | number | string,
    direction: 'IN' | 'OUT',
    currency: string,
    txHash: string | null | undefined,
    referenceNo: string | null | undefined,
    datetime: Date,
    wallet: WalletRef,
  ): InternalLeg {
    const { account, subAccount } = this.resolveAccount(currency, wallet);
    return {
      source, sourceId, sourceNo,
      account, subAccount,
      direction, currency,
      amount: new Prisma.Decimal(amount),
      externalRef: this.externalRefFor(currency, direction, txHash, referenceNo),
      datetime,
    };
  }

  /**
   * 腿的 external_ref（主匹配判别键）。
   * - 虚拟币：txHash（进出都有，全局唯一）。
   * - 法币出金：referenceNo（出金把内部号写进 Zand InstructionIdentification → 银行回显）。
   * - 法币入金：**空**（§2.3：入金 external_ref=空；银行不知道我们内部号）→ 走 (VIBAN,金额,时序) 回退模糊配。
   */
  private externalRefFor(
    currency: string,
    direction: 'IN' | 'OUT',
    txHash: string | null | undefined,
    referenceNo: string | null | undefined,
  ): string | null {
    if (!isFiat(currency)) return txHash || referenceNo || null; // crypto 走 txHash
    if (direction === 'OUT') return referenceNo || null; // 法币出金有回显
    return null; // 法币入金无回显 → fallback
  }

  /**
   * Payout 的 srcWallet 经 ownerId 反查（Payout 无 fromWallet 关系）。
   * - 法币：取客户 C_VIBAN 钱包 → iban（与生成器 ownerToViban 同源）。
   * - 虚拟币：取客户 C_DEP 钱包 → vaultId（逐钱包）。
   * 仅查本批 payout 涉及的 ownerId，避免全表扫。
   */
  private async buildOwnerWalletMap(
    assetId: string,
    currency: string,
    payouts: { ownerId: string | null }[],
  ): Promise<Map<string, WalletRef>> {
    const ownerIds = [...new Set(payouts.map((p) => p.ownerId).filter((x): x is string => !!x))];
    const map = new Map<string, WalletRef>();
    if (ownerIds.length === 0) return map;
    const role = isFiat(currency) ? 'C_VIBAN' : 'C_DEP';
    const wallets = await this.prisma.wallet.findMany({
      where: { assetId, ownerId: { in: ownerIds }, walletRole: role, status: 'ACTIVE' },
      select: { id: true, ownerId: true, vaultId: true, iban: true },
    });
    for (const w of wallets) if (w.ownerId) map.set(w.ownerId, w);
    return map;
  }

  /**
   * 钱包 → (account, sub_account)。
   * - 法币：account 滚 CMA；sub_account = 钱包 VIBAN(iban)（下钻定位客户）。
   * - 虚拟币：account = 钱包 vaultId（逐钱包池）；缺 vaultId 回落 walletId；sub_account 同 account。
   */
  private resolveAccount(currency: string, wallet: WalletRef): { account: string; subAccount: string | null } {
    if (isFiat(currency)) {
      return { account: FIAT_CMA_ACCOUNT[currency], subAccount: wallet?.iban ?? null };
    }
    const vault = wallet?.vaultId ?? wallet?.id ?? null;
    return { account: vault ?? 'UNKNOWN', subAccount: vault };
  }
}
