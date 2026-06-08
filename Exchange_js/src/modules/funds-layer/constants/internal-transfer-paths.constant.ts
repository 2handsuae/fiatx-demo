export enum TransferPath {
  AGGREGATE      = 'AGGREGATE',
  FUND_OUT       = 'FUND_OUT',
  FUND_RETURN    = 'FUND_RETURN',
  INTERNAL_OUT   = 'INTERNAL_OUT',
  INTERNAL_IN    = 'INTERNAL_IN',
  FEE_COLLECT    = 'FEE_COLLECT',
  FIAT_SETTLE_OUT     = 'FIAT_SETTLE_OUT',
  FIAT_SETTLE_IN      = 'FIAT_SETTLE_IN',
  FIAT_FEE_COLLECT    = 'FIAT_FEE_COLLECT',
  FIAT_SPREAD_COLLECT = 'FIAT_SPREAD_COLLECT',
}

export enum AccountingClass {
  A = 'A',
  B = 'B',
}

export enum TransferMedium {
  CHAIN = 'CHAIN',
  BANK = 'BANK',
}

export type DrainAccount = 'TRADE_CLEARING' | 'FEE_RECEIVABLE';

export interface TransferPathPolicy {
  path: TransferPath;
  from: string;
  to: string;
  class: AccountingClass;
  medium: TransferMedium;
  trigger: string[];
  drain?: DrainAccount;
  route?: string[];          // multi-hop ordered roles (fiat 2-hop)
}

export const TRANSFER_PATH_WHITELIST: Record<TransferPath, TransferPathPolicy> = {
  [TransferPath.AGGREGATE]: {
    path: TransferPath.AGGREGATE,
    from: 'C_DEP',
    to: 'C_MAIN',
    class: AccountingClass.A,
    medium: TransferMedium.CHAIN,
    trigger: ['CRON', 'THRESHOLD'],
  },
  [TransferPath.FUND_OUT]: {
    path: TransferPath.FUND_OUT,
    from: 'C_MAIN',
    to: 'C_OUT',
    class: AccountingClass.A,
    medium: TransferMedium.CHAIN,
    trigger: ['WITHDRAW'],
  },
  [TransferPath.FUND_RETURN]: {
    path: TransferPath.FUND_RETURN,
    from: 'C_OUT',
    to: 'C_MAIN',
    class: AccountingClass.A,
    medium: TransferMedium.CHAIN,
    trigger: ['WITHDRAW'],
  },
  [TransferPath.INTERNAL_OUT]: {
    path: TransferPath.INTERNAL_OUT,
    from: 'C_MAIN',
    to: 'F_LIQ',
    class: AccountingClass.B,
    medium: TransferMedium.CHAIN,
    trigger: ['EOD'],
    drain: 'TRADE_CLEARING',
  },
  [TransferPath.INTERNAL_IN]: {
    path: TransferPath.INTERNAL_IN,
    from: 'F_LIQ',
    to: 'C_MAIN',
    class: AccountingClass.B,
    medium: TransferMedium.CHAIN,
    trigger: ['EOD'],
    drain: 'TRADE_CLEARING',
  },
  [TransferPath.FEE_COLLECT]: {
    path: TransferPath.FEE_COLLECT,
    from: 'C_MAIN',
    to: 'F_OPS',
    class: AccountingClass.B,
    medium: TransferMedium.CHAIN,
    trigger: ['CRON'],
    drain: 'FEE_RECEIVABLE',
  },
  [TransferPath.FIAT_SETTLE_OUT]: {
    path: TransferPath.FIAT_SETTLE_OUT,
    from: 'C_VIBAN',
    to: 'F_LIQ',
    route: ['C_VIBAN', 'F_SET', 'F_LIQ'],
    class: AccountingClass.B,
    medium: TransferMedium.BANK,
    trigger: ['SWAP'],
    drain: 'TRADE_CLEARING',
  },
  [TransferPath.FIAT_SETTLE_IN]: {
    path: TransferPath.FIAT_SETTLE_IN,
    from: 'F_LIQ',
    to: 'C_VIBAN',
    route: ['F_LIQ', 'F_SET', 'C_VIBAN'],
    class: AccountingClass.B,
    medium: TransferMedium.BANK,
    trigger: ['SWAP'],
    drain: 'TRADE_CLEARING',
  },
  [TransferPath.FIAT_FEE_COLLECT]: {
    path: TransferPath.FIAT_FEE_COLLECT,
    from: 'C_VIBAN',
    to: 'F_FEE',
    class: AccountingClass.B,
    medium: TransferMedium.BANK,
    trigger: ['SWAP', 'WITHDRAW'],
    drain: 'FEE_RECEIVABLE',
  },
  [TransferPath.FIAT_SPREAD_COLLECT]: {
    path: TransferPath.FIAT_SPREAD_COLLECT,
    from: 'F_LIQ',
    to: 'F_FEE',
    class: AccountingClass.B,
    medium: TransferMedium.BANK,
    trigger: ['SWAP'],
    drain: 'FEE_RECEIVABLE',
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
