export type AssetConfigManifestItem = {
  assetNo: string;
  code: string;
  type: 'FIAT' | 'CRYPTO';
  network: string;
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  depositMinAmount: string;
  depositMaxAmount: string | null;
  withdrawMinAmount: string;
  withdrawMaxAmount: string | null;
  networkFeeBuffer: string | null; // null for FIAT
};

export const DEFAULT_ASSET_CONFIGS: AssetConfigManifestItem[] = [
  {
    assetNo: 'AS_AED',
    code: 'AED',
    type: 'FIAT',
    network: '',
    depositEnabled: true,
    withdrawEnabled: true,
    depositMinAmount: '100',
    depositMaxAmount: null,
    withdrawMinAmount: '100',
    withdrawMaxAmount: null,
    networkFeeBuffer: null,
  },
  {
    assetNo: 'AS_USDT_TRON',
    code: 'USDT',
    type: 'CRYPTO',
    network: 'TRON',
    depositEnabled: true,
    withdrawEnabled: true,
    depositMinAmount: '10',
    depositMaxAmount: null,
    withdrawMinAmount: '10',
    withdrawMaxAmount: null,
    networkFeeBuffer: '2',
  },
  {
    assetNo: 'AS_BTC',
    code: 'BTC',
    type: 'CRYPTO',
    network: 'BITCOIN',
    depositEnabled: true,
    withdrawEnabled: true,
    depositMinAmount: '0.001',
    depositMaxAmount: null,
    withdrawMinAmount: '0.001',
    withdrawMaxAmount: null,
    networkFeeBuffer: '0.00005',
  },
];
