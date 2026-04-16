export type AssetConfigManifestItem = {
  assetNo: string;
  code: string;
  type: 'FIAT' | 'CRYPTO';
  network: string;
  decimals: number;
  description: string | null;
  status: 'ACTIVE' | 'DISABLED';
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  depositMinAmount: string;
  depositMaxAmount: string | null;
  withdrawMinAmount: string;
  withdrawMaxAmount: string | null;
  minConfirmations: number | null; // null for FIAT, positive integer for CRYPTO
};

export const DEFAULT_ASSET_CONFIGS: AssetConfigManifestItem[] = [
  {
    assetNo: 'AS_USD',
    code: 'USD',
    type: 'FIAT',
    network: '',
    decimals: 2,
    description: 'United States Dollar',
    status: 'ACTIVE',
    depositEnabled: true,
    withdrawEnabled: true,
    depositMinAmount: '100',
    depositMaxAmount: null,
    withdrawMinAmount: '100',
    withdrawMaxAmount: null,
    minConfirmations: null,
  },
  {
    assetNo: 'AS_AED',
    code: 'AED',
    type: 'FIAT',
    network: '',
    decimals: 2,
    description: 'UAE Dirham',
    status: 'ACTIVE',
    depositEnabled: true,
    withdrawEnabled: true,
    depositMinAmount: '100',
    depositMaxAmount: null,
    withdrawMinAmount: '100',
    withdrawMaxAmount: null,
    minConfirmations: null,
  },
  {
    assetNo: 'AS_USDT_TRON',
    code: 'USDT',
    type: 'CRYPTO',
    network: 'TRON',
    decimals: 6,
    description: 'Tether USD on TRON network',
    status: 'ACTIVE',
    depositEnabled: true,
    withdrawEnabled: true,
    depositMinAmount: '10',
    depositMaxAmount: null,
    withdrawMinAmount: '10',
    withdrawMaxAmount: null,
    minConfirmations: 20,
  },
  {
    assetNo: 'AS_BTC',
    code: 'BTC',
    type: 'CRYPTO',
    network: 'BITCOIN',
    decimals: 8,
    description: 'Bitcoin',
    status: 'ACTIVE',
    depositEnabled: true,
    withdrawEnabled: true,
    depositMinAmount: '0.001',
    depositMaxAmount: null,
    withdrawMinAmount: '0.001',
    withdrawMaxAmount: null,
    minConfirmations: 3,
  },
];
