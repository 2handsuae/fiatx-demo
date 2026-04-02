import {
  InternalTransactionType,
  TreasuryTransferInitiationMode,
  TreasuryTransferPurpose,
} from './dto/internal-transaction.dto';

export type InternalTxSystemWalletRole =
  | 'DEPOSIT'
  | 'MASTER'
  | 'LIQ'
  | 'PAYOUT'
  | 'CUST_BANK'
  | 'LIQ_BANK';

export interface TreasuryTransferRoutePolicy {
  purpose: TreasuryTransferPurpose;
  internalType: InternalTransactionType;
  assetType: 'CRYPTO' | 'FIAT';
  fromRole: InternalTxSystemWalletRole;
  toRole: InternalTxSystemWalletRole;
  allowedInitiationModes: readonly TreasuryTransferInitiationMode[];
}

export const TREASURY_TRANSFER_ROUTE_POLICIES: Record<
  TreasuryTransferPurpose,
  readonly TreasuryTransferRoutePolicy[]
> = {
  [TreasuryTransferPurpose.DEPOSIT_COLLECTION]: [
    {
      purpose: TreasuryTransferPurpose.DEPOSIT_COLLECTION,
      internalType: InternalTransactionType.DEP_TO_MASTER,
      assetType: 'CRYPTO',
      fromRole: 'DEPOSIT',
      toRole: 'MASTER',
      allowedInitiationModes: [TreasuryTransferInitiationMode.AUTOMATED],
    },
  ],
  [TreasuryTransferPurpose.PAYOUT_FUNDING]: [
    {
      purpose: TreasuryTransferPurpose.PAYOUT_FUNDING,
      internalType: InternalTransactionType.MASTER_TO_PAYOUT,
      assetType: 'CRYPTO',
      fromRole: 'MASTER',
      toRole: 'PAYOUT',
      allowedInitiationModes: [TreasuryTransferInitiationMode.MANUAL],
    },
  ],
  [TreasuryTransferPurpose.PAYOUT_RETURN]: [
    {
      purpose: TreasuryTransferPurpose.PAYOUT_RETURN,
      internalType: InternalTransactionType.PAYOUT_TO_MASTER,
      assetType: 'CRYPTO',
      fromRole: 'PAYOUT',
      toRole: 'MASTER',
      allowedInitiationModes: [TreasuryTransferInitiationMode.MANUAL],
    },
  ],
  [TreasuryTransferPurpose.LIQUIDITY_TOPUP]: [
    {
      purpose: TreasuryTransferPurpose.LIQUIDITY_TOPUP,
      internalType: InternalTransactionType.MASTER_TO_LIQ,
      assetType: 'CRYPTO',
      fromRole: 'MASTER',
      toRole: 'LIQ',
      allowedInitiationModes: [TreasuryTransferInitiationMode.MANUAL],
    },
  ],
  [TreasuryTransferPurpose.LIQUIDITY_RETURN]: [
    {
      purpose: TreasuryTransferPurpose.LIQUIDITY_RETURN,
      internalType: InternalTransactionType.LIQ_TO_MASTER,
      assetType: 'CRYPTO',
      fromRole: 'LIQ',
      toRole: 'MASTER',
      allowedInitiationModes: [TreasuryTransferInitiationMode.MANUAL],
    },
  ],
  [TreasuryTransferPurpose.POOL_REBALANCING]: [
    {
      purpose: TreasuryTransferPurpose.POOL_REBALANCING,
      internalType: InternalTransactionType.CLIENT_BANK_TO_LIQ_BANK,
      assetType: 'FIAT',
      fromRole: 'CUST_BANK',
      toRole: 'LIQ_BANK',
      allowedInitiationModes: [TreasuryTransferInitiationMode.MANUAL],
    },
    {
      purpose: TreasuryTransferPurpose.POOL_REBALANCING,
      internalType: InternalTransactionType.LIQ_BANK_TO_CLIENT_BANK,
      assetType: 'FIAT',
      fromRole: 'LIQ_BANK',
      toRole: 'CUST_BANK',
      allowedInitiationModes: [TreasuryTransferInitiationMode.MANUAL],
    },
  ],
};

export const MANUAL_TREASURY_TRANSFER_PURPOSES = [
  TreasuryTransferPurpose.PAYOUT_FUNDING,
  TreasuryTransferPurpose.PAYOUT_RETURN,
  TreasuryTransferPurpose.LIQUIDITY_TOPUP,
  TreasuryTransferPurpose.LIQUIDITY_RETURN,
  TreasuryTransferPurpose.POOL_REBALANCING,
] as const;

export type ManualTreasuryTransferPurpose =
  (typeof MANUAL_TREASURY_TRANSFER_PURPOSES)[number];

export const MANUAL_TREASURY_TRANSFER_INITIATION_MODE =
  TreasuryTransferInitiationMode.MANUAL;
