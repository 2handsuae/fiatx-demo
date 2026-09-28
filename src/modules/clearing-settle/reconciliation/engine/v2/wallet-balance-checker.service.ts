// src/modules/clearing-settle/reconciliation/engine/v2/wallet-balance-checker.service.ts
//
// Phase B / T6: per-wallet balance check (1:1 direct, no layered fallback).
//   Customer wallet:  external == PAYABLE[c] + SUSPENSE[c]
//   Firm wallet:      external == FIRM_OPS / FIRM_SET / FIRM_LIQ / INCOME_SWAP_FEE /
//                     INCOME_WITHDRAW_FEE / INCOME_OTHER
//
// The spec (design §7) explicitly removes the older "first try == PAYABLE,
// then fall back to == PAYABLE+SUSPENSE" pattern: a single equality holds
// or the case is opened. The PAYABLE / SUSPENSE breakdown is *display only*.
//
// Inputs
//   walletRef       — physical wallet identifier (Wallet.id for customers,
//                     firm wallet code for firm)
//   externalClosing — closing balance from ExternalBalance at the cutoff (bigint,
//                     same minor-unit scale as account_flows.amount)
//   cutoff          — reconciliation cutoff time (flows after cutoff are excluded)
//
// Internal-balance computation
//   1. Pull all account_flows rows at this walletRef (POSTED, createdAt ≤ cutoff).
//   2. Resolve each row's tbAccountId via tbAccountRegistry; drop aggregate legs
//      (CLIENT_ASSET code=1 / FIRM_ASSET code=50). Those share walletRef purely
//      for traceability — they belong to the aggregate book, not this wallet.
//   3. PAYABLE (100), SUSPENSE (101), and firm equity codes
//      (200/201/203/210/211/212) are all
//      CREDIT-normal: direction='IN' (credit side) → balance up,
//      direction='OUT' (debit side) → balance down. No class-flip needed.
//   4. Classify wallet kind from observed codes; build result.

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../../core/prisma/prisma.service';
import {
  TB_ACCOUNT_CODES,
  TB_CODE_TO_COA,
} from '../../../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { effectiveCutoffFilter } from './effective-cutoff';

const CUSTOMER_CODES: ReadonlySet<number> = new Set<number>([
  TB_ACCOUNT_CODES.CLIENT_PAYABLE,    // 100
  TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE,  // 101
]);

const FIRM_CODES: ReadonlySet<number> = new Set<number>([
  TB_ACCOUNT_CODES.FIRM_OPS,          // 200
  TB_ACCOUNT_CODES.FIRM_SET,          // 201
  TB_ACCOUNT_CODES.FIRM_LIQ,          // 203
  TB_ACCOUNT_CODES.INCOME_SWAP_FEE,   // 210
  TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE, // 211
  TB_ACCOUNT_CODES.INCOME_OTHER,      // 212
]);

const AGGREGATE_CODES: ReadonlySet<number> = new Set<number>([
  TB_ACCOUNT_CODES.CLIENT_ASSET,  // 1
  TB_ACCOUNT_CODES.FIRM_ASSET,    // 50
]);

type WalletKind = 'CUSTOMER' | 'FIRM' | 'UNKNOWN';

export interface WalletBalanceCheckResult {
  pass: boolean;
  walletRef: string;
  walletKind: WalletKind;
  coaCode: string;                          // 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE' / 'E.FIRM_OPS' / '' for UNKNOWN
  ownerNo: string | null;
  internal: {
    payable?: bigint;                       // CUSTOMER only
    suspense?: bigint;                      // CUSTOMER only
    firmEquity?: bigint;                    // FIRM only
    total: bigint;
  };
  external: bigint;
  delta: bigint;                            // external − internal.total
}

interface FlowRow {
  tbAccountId: string;
  direction: string;                        // 'IN' | 'OUT'
  amount: Prisma.Decimal;
}

interface RegistryRow {
  tbAccountId: string;
  code: number;
  ownerType: string;
  ownerNo: string | null;
}

@Injectable()
export class WalletBalanceCheckerService {
  constructor(private readonly prisma: PrismaService) {}

  async checkBalance(input: {
    walletRef: string;
    externalClosing: bigint;
    cutoff: Date;
  }): Promise<WalletBalanceCheckResult> {
    const { walletRef, externalClosing, cutoff } = input;

    // 1. Pull flows landing on this walletRef up to cutoff (POSTED only).
    const flows = (await this.prisma.accountFlow.findMany({
      where: {
        walletRef,
        transferType: 'POSTED',
        ...effectiveCutoffFilter(cutoff),
      },
      select: { tbAccountId: true, direction: true, amount: true },
    })) as FlowRow[];

    // 2. Resolve tbAccountIds via registry.
    //
    // ⚠ 两张表的 tbAccountId 格式不同，必须补零后再 join：
    //   `account_flows.tbAccountId` 来自上游 `bigint.toString(16)`，**没有**
    //   `padStart(32,'0')`，首个十六进制位是 0 的账户会少一位（31 字符）；
    //   `tb_account_registry.tbAccountId` 恒为 32 位补零形式。
    //   不补零就 join 落空，下面 `if (!reg) continue` 会把这笔分录**从余额里
    //   静默丢掉**——不报错、不留痕，该钱包的 internal.total 直接少一整条
    //   PAYABLE（客户户常常只有这一条，于是余额算成 0），delta 变成外部收盘
    //   全额：凭空造出破口，或反过来把真破口抹平。命中率约 1/16（首位随机），
    //   且账户号是每次 `stack.sh reset` 重铺时新生成的，所以它表现为「按种子
    //   随机发作」——同一份代码这次绿下次红，最容易被误判成测试脆弱。
    //   属于铁律⑤「账实一致」的静默破口，不是边界防御。
    //
    //   同款工作区兄弟件已有：`wallet-flow-matcher.service.ts:203` 的 padTbId
    //   （它的注释原话："Without this ... flows silently drop and surface as
    //   bogus orphan"），以及 `tb-evidence.service.ts:369/372/429/545`。
    //   本文件这一半 2026-09-02 才补上——在此之前 matcher 补零、checker 不补，
    //   同一个引擎的两半用着不同的连接键。
    const padTbId = (id: string) => (id.length < 32 ? id.padStart(32, '0') : id);
    const accountIds = Array.from(new Set(flows.map((f) => padTbId(f.tbAccountId))));
    const registries: RegistryRow[] = accountIds.length
      ? await this.prisma.tbAccountRegistry.findMany({
          where: { tbAccountId: { in: accountIds } },
          select: { tbAccountId: true, code: true, ownerType: true, ownerNo: true },
        })
      : [];
    const regById = new Map<string, RegistryRow>(
      registries.map((r) => [padTbId(r.tbAccountId), r]),
    );

    // 3. Per-account balance accumulator (only for non-aggregate accounts).
    //    PAYABLE/SUSPENSE/firm-equity are all CREDIT-normal → IN = balance up.
    //    No class-aware flip needed (assets are filtered out as aggregate above).
    const balanceByAccount = new Map<string, bigint>(); // tbAccountId → balance
    const seenCodes = new Set<number>();
    let ownerNo: string | null = null;
    let ownerType: string | null = null;

    for (const f of flows) {
      const reg = regById.get(padTbId(f.tbAccountId));
      if (!reg) continue;                           // unknown account — skip defensively
      if (AGGREGATE_CODES.has(reg.code)) continue;  // aggregate leg — not this wallet's
      seenCodes.add(reg.code);
      if (!ownerNo && reg.ownerNo) ownerNo = reg.ownerNo;
      if (!ownerType) ownerType = reg.ownerType;

      const amt = BigInt(f.amount.toString());
      const signed = f.direction === 'IN' ? amt : -amt;
      // 键也走补零：下面 §4 按 `regById.get(accId)` 回查这个 Map 的键，
      // 两处键格式必须一致，否则补零只补了一半、回查照样落空。
      balanceByAccount.set(
        padTbId(f.tbAccountId),
        (balanceByAccount.get(padTbId(f.tbAccountId)) ?? 0n) + signed,
      );
    }

    // 4. Classify wallet kind. Customer wins if any customer code is hit
    //    (a fresh wallet may have only SUSPENSE before compliance release).
    const hasCustomerCode = Array.from(seenCodes).some((c) => CUSTOMER_CODES.has(c));
    const hasFirmCode = Array.from(seenCodes).some((c) => FIRM_CODES.has(c));

    let walletKind: WalletKind = 'UNKNOWN';
    let coaCode = '';
    const internal: WalletBalanceCheckResult['internal'] = { total: 0n };

    if (hasCustomerCode) {
      walletKind = 'CUSTOMER';
      coaCode = `${TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE]}+${TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE]}`;
      // Sum per code across all accounts that hit this customer code.
      let payable = 0n;
      let suspense = 0n;
      for (const [accId, bal] of balanceByAccount) {
        const reg = regById.get(accId);
        if (!reg) continue;
        if (reg.code === TB_ACCOUNT_CODES.CLIENT_PAYABLE) payable += bal;
        else if (reg.code === TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE) suspense += bal;
      }
      internal.payable = payable;
      internal.suspense = suspense;
      internal.total = payable + suspense;
    } else if (hasFirmCode) {
      walletKind = 'FIRM';
      // Firm wallet: expect exactly one firm-equity account behind this walletRef.
      // If multiple firm codes are observed, the first one seen wins for coaCode;
      // total still sums all firm-equity legs (defensive).
      let firmEquity = 0n;
      let firmCodeForLabel: number | null = null;
      for (const [accId, bal] of balanceByAccount) {
        const reg = regById.get(accId);
        if (!reg) continue;
        if (FIRM_CODES.has(reg.code)) {
          firmEquity += bal;
          if (firmCodeForLabel == null) firmCodeForLabel = reg.code;
        }
      }
      if (firmCodeForLabel != null) {
        coaCode = TB_CODE_TO_COA[firmCodeForLabel] ?? '';
      }
      internal.firmEquity = firmEquity;
      internal.total = firmEquity;
    } else {
      // UNKNOWN: neither customer nor firm code observed at this walletRef
      // (e.g. caller passed an aggregate-only walletRef). Leave totals at 0,
      // coaCode empty, ownerNo null — caller decides how to handle.
      ownerNo = null;
    }

    const delta = externalClosing - internal.total;
    const pass = delta === 0n;

    return {
      pass,
      walletRef,
      walletKind,
      coaCode,
      ownerNo,
      internal,
      external: externalClosing,
      delta,
    };
  }
}
