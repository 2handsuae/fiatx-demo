export enum TransferPath {
  AGGREGATE    = 'AGGREGATE',
  FUND_OUT     = 'FUND_OUT',
  FUND_RETURN  = 'FUND_RETURN',
  INTERNAL_OUT = 'INTERNAL_OUT',
  INTERNAL_IN  = 'INTERNAL_IN',
  FEE_COLLECT  = 'FEE_COLLECT',
}

export enum AccountingClass {
  A = 'A',
  B = 'B',
}

export enum TransferMedium {
  CHAIN = 'CHAIN',
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
};

export function resolvePathPolicy(fromRole: string, toRole: string): TransferPathPolicy | null {
  for (const policy of Object.values(TRANSFER_PATH_WHITELIST)) {
    if (policy.from === fromRole && policy.to === toRole) {
      return policy;
    }
  }
  return null;
}
