export enum TransferPath {
  CRYPTO_DEPOSIT_SWEEP       = 'CRYPTO_DEPOSIT_SWEEP',
  CRYPTO_HOTWALLET_FUND      = 'CRYPTO_HOTWALLET_FUND',
  CRYPTO_HOTWALLET_RETURN    = 'CRYPTO_HOTWALLET_RETURN',
  CRYPTO_SETTLE_OUT          = 'CRYPTO_SETTLE_OUT',
  CRYPTO_SETTLE_IN           = 'CRYPTO_SETTLE_IN',
  CRYPTO_WITHDRAW_FEE_COLLECT = 'CRYPTO_WITHDRAW_FEE_COLLECT',
  CRYPTO_SWAP_FEE_COLLECT     = 'CRYPTO_SWAP_FEE_COLLECT',
  FIAT_SETTLE_OUT     = 'FIAT_SETTLE_OUT',
  FIAT_SETTLE_IN      = 'FIAT_SETTLE_IN',
  FIAT_WITHDRAW_FEE_COLLECT = 'FIAT_WITHDRAW_FEE_COLLECT',
  FIAT_SWAP_FEE_COLLECT     = 'FIAT_SWAP_FEE_COLLECT',
}

export enum AccountingClass {
  A = 'A',
  B = 'B',
}

export enum TransferMedium {
  CHAIN = 'CHAIN',
  BANK = 'BANK',
}

/** TB 镜像方向:物理资金流完成(funds-flow CLEAR)时在 TB 上记"客户池↔FIRM_TREASURY" */
export type TbMirror = 'POOL_TO_FIRM' | 'FIRM_TO_POOL';

export interface TransferPathPolicy {
  path: TransferPath;
  from: string;
  to: string;
  class: AccountingClass;
  medium: TransferMedium;
  trigger: string[];
  mirror?: TbMirror;
  route?: string[];          // multi-hop ordered roles (fiat 2-hop)
}

export const TRANSFER_PATH_WHITELIST: Record<TransferPath, TransferPathPolicy> = {
  [TransferPath.CRYPTO_DEPOSIT_SWEEP]: {
    path: TransferPath.CRYPTO_DEPOSIT_SWEEP,
    from: 'C_DEP',
    to: 'C_MAIN',
    class: AccountingClass.A,
    medium: TransferMedium.CHAIN,
    trigger: ['CRON', 'THRESHOLD'],
  },
  [TransferPath.CRYPTO_HOTWALLET_FUND]: {
    path: TransferPath.CRYPTO_HOTWALLET_FUND,
    from: 'C_MAIN',
    to: 'C_OUT',
    class: AccountingClass.A,
    medium: TransferMedium.CHAIN,
    trigger: ['WITHDRAW'],
  },
  [TransferPath.CRYPTO_HOTWALLET_RETURN]: {
    path: TransferPath.CRYPTO_HOTWALLET_RETURN,
    from: 'C_OUT',
    to: 'C_MAIN',
    class: AccountingClass.A,
    medium: TransferMedium.CHAIN,
    trigger: ['WITHDRAW'],
  },
  [TransferPath.CRYPTO_SETTLE_OUT]: {
    path: TransferPath.CRYPTO_SETTLE_OUT,
    from: 'C_MAIN',
    to: 'F_OPS',
    class: AccountingClass.B,
    medium: TransferMedium.CHAIN,
    trigger: ['EOD'],
    mirror: 'POOL_TO_FIRM',
  },
  [TransferPath.CRYPTO_SETTLE_IN]: {
    path: TransferPath.CRYPTO_SETTLE_IN,
    from: 'F_OPS',
    to: 'C_MAIN',
    class: AccountingClass.B,
    medium: TransferMedium.CHAIN,
    trigger: ['EOD'],
    mirror: 'FIRM_TO_POOL',
  },
  [TransferPath.CRYPTO_WITHDRAW_FEE_COLLECT]: {
    path: TransferPath.CRYPTO_WITHDRAW_FEE_COLLECT,
    from: 'C_MAIN',
    to: 'F_FEE',
    class: AccountingClass.B,
    medium: TransferMedium.CHAIN,
    trigger: ['EOD'],
    mirror: 'POOL_TO_FIRM',
  },
  [TransferPath.FIAT_SETTLE_OUT]: {
    path: TransferPath.FIAT_SETTLE_OUT,
    from: 'C_VIBAN',
    to: 'F_OPS',
    route: ['C_VIBAN', 'F_SET', 'F_OPS'],
    class: AccountingClass.B,
    medium: TransferMedium.BANK,
    trigger: ['SWAP'],
    mirror: 'POOL_TO_FIRM',
  },
  [TransferPath.FIAT_SETTLE_IN]: {
    path: TransferPath.FIAT_SETTLE_IN,
    from: 'F_OPS',
    to: 'C_VIBAN',
    route: ['F_OPS', 'F_SET', 'C_VIBAN'],
    class: AccountingClass.B,
    medium: TransferMedium.BANK,
    trigger: ['SWAP'],
    mirror: 'FIRM_TO_POOL',
  },
  [TransferPath.FIAT_WITHDRAW_FEE_COLLECT]: {
    path: TransferPath.FIAT_WITHDRAW_FEE_COLLECT,
    from: 'C_VIBAN',
    to: 'F_FEE',
    class: AccountingClass.B,
    medium: TransferMedium.BANK,
    // WITHDRAW only — withdrawal fee genuinely leaves the client VIBAN. Swap service
    // fees are company-side (F_OPS→F_FEE) under Model A, not C_VIBAN→F_FEE.
    trigger: ['WITHDRAW'],
    mirror: 'POOL_TO_FIRM',
  },
  [TransferPath.FIAT_SWAP_FEE_COLLECT]: {
    path: TransferPath.FIAT_SWAP_FEE_COLLECT,
    from: 'F_OPS',
    to: 'F_FEE',
    class: AccountingClass.B,
    medium: TransferMedium.BANK,
    trigger: ['SWAP'],
    // No mirror: company-internal movement (F_OPS→F_FEE), TB no-op.
  },
  // Shares the F_OPS→F_FEE role pair with FIAT_SWAP_FEE_COLLECT; declared AFTER it so
  // resolvePathPolicy('F_OPS','F_FEE') keeps returning the fiat path. Crypto swap-fee
  // settlement reaches this entry by explicit enum key, not by role-pair resolution.
  [TransferPath.CRYPTO_SWAP_FEE_COLLECT]: {
    path: TransferPath.CRYPTO_SWAP_FEE_COLLECT,
    from: 'F_OPS',
    to: 'F_FEE',
    class: AccountingClass.B,
    medium: TransferMedium.CHAIN,
    trigger: ['SWAP', 'EOD'],
    // No mirror: company-internal movement (F_OPS→F_FEE), TB no-op.
  },
};

export function resolvePathPolicy(fromRole: string, toRole: string): TransferPathPolicy | null {
  for (const policy of Object.values(TRANSFER_PATH_WHITELIST)) {
    if (policy.from === fromRole && policy.to === toRole) {
      return policy;
    }
  }
  return null;
}

export function resolveRoutePolicy(route: string[]): TransferPathPolicy | null {
  for (const policy of Object.values(TRANSFER_PATH_WHITELIST)) {
    if (
      policy.route &&
      policy.route.length === route.length &&
      policy.route.every((r, i) => r === route[i])
    ) {
      return policy;
    }
  }
  return null;
}

// 充值归集阈值（MVP 硬编码；配置化为 ADVANCED）
export const AGGREGATION_THRESHOLD = '100'; // 归集触发额：地址累计未归集 ≥ 100 才扫
export const DUST_THRESHOLD = '1';          // dust：< 1 记 DUST_SKIPPED，不动
