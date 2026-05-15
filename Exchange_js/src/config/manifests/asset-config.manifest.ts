import { buildDeterministicNo } from '../../common/utils/no-generator.util';

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
  minConfirmations: number | null;
};

export const DEFAULT_ASSET_CONFIGS: AssetConfigManifestItem[] = [
  {
    assetNo: buildDeterministicNo('AS', 'FIAT', 'USD', ''),
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
    assetNo: buildDeterministicNo('AS', 'FIAT', 'AED', ''),
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
    assetNo: buildDeterministicNo('AS', 'CRYPTO', 'USDT', 'TRON'),
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
    assetNo: buildDeterministicNo('AS', 'CRYPTO', 'BTC', 'BITCOIN'),
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
    minConfirmations: 6,
  },
];
