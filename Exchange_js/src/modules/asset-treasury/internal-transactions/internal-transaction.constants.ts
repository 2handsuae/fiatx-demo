import { InternalTransactionType } from './dto/internal-transaction.dto';

export type InternalTxSystemWalletRole =
  | 'MASTER'
  | 'LIQ'
  | 'PAYOUT'
  | 'CUST_BANK'
  | 'LIQ_BANK';

export const MANUAL_CRYPTO_INTERNAL_TRANSACTION_TYPES = [
  InternalTransactionType.MASTER_TO_LIQ,
  InternalTransactionType.LIQ_TO_MASTER,
  InternalTransactionType.MASTER_TO_PAYOUT,
  InternalTransactionType.PAYOUT_TO_MASTER,
  InternalTransactionType.LIQ_TO_PAYOUT,
  InternalTransactionType.PAYOUT_TO_LIQ,
] as const;

export const MANUAL_FIAT_INTERNAL_TRANSACTION_TYPES = [
  InternalTransactionType.CLIENT_BANK_TO_LIQ_BANK,
  InternalTransactionType.LIQ_BANK_TO_CLIENT_BANK,
] as const;

export const MANUAL_INTERNAL_TRANSACTION_TYPES = [
  ...MANUAL_CRYPTO_INTERNAL_TRANSACTION_TYPES,
  ...MANUAL_FIAT_INTERNAL_TRANSACTION_TYPES,
] as const;

export type ManualInternalTransactionType =
  (typeof MANUAL_INTERNAL_TRANSACTION_TYPES)[number];

export const MANUAL_INTERNAL_TX_TYPE_WALLET_ROUTE: Record<
  ManualInternalTransactionType,
  { fromRole: InternalTxSystemWalletRole; toRole: InternalTxSystemWalletRole }
> = {
  [InternalTransactionType.MASTER_TO_LIQ]: {
    fromRole: 'MASTER',
    toRole: 'LIQ',
  },
  [InternalTransactionType.LIQ_TO_MASTER]: {
    fromRole: 'LIQ',
    toRole: 'MASTER',
  },
  [InternalTransactionType.MASTER_TO_PAYOUT]: {
    fromRole: 'MASTER',
    toRole: 'PAYOUT',
  },
  [InternalTransactionType.PAYOUT_TO_MASTER]: {
    fromRole: 'PAYOUT',
    toRole: 'MASTER',
  },
  [InternalTransactionType.LIQ_TO_PAYOUT]: {
    fromRole: 'LIQ',
    toRole: 'PAYOUT',
  },
  [InternalTransactionType.PAYOUT_TO_LIQ]: {
    fromRole: 'PAYOUT',
    toRole: 'LIQ',
  },
  [InternalTransactionType.CLIENT_BANK_TO_LIQ_BANK]: {
    fromRole: 'CUST_BANK',
    toRole: 'LIQ_BANK',
  },
  [InternalTransactionType.LIQ_BANK_TO_CLIENT_BANK]: {
    fromRole: 'LIQ_BANK',
    toRole: 'CUST_BANK',
  },
};
