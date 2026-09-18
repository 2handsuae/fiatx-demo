import { buildDeterministicNo } from '../../common/utils/no-generator.util';
import type { NetworkCode } from './networks.manifest';

/** 资产 = 币种 × 网络 × 合约地址（spec §3）。上币走开发流程：改这里 + 随版本重铺。 */
export interface AssetManifestEntry {
  assetNo: string;
  type: 'FIAT' | 'CRYPTO';
  currency: string;
  code: string;
  network: NetworkCode;
  description: string;
  decimals: number;
  contractAddress: string | null;
  isNative: boolean;
  standard: string | null;
  minConfirmations: number;
  /** HexTrust assetKey（chainID_ticker）；法币为空；沙盒占位 */
  custodianAssetKey: string | null;
}

export const DEFAULT_ASSETS: AssetManifestEntry[] = [
  {
    assetNo: buildDeterministicNo('AS', 'FIAT', 'AED', 'AED_ZAND'),
    type: 'FIAT',
    currency: 'AED',
    code: 'AED',
    network: 'AED_ZAND',
    description: 'United Arab Emirates Dirham',
    decimals: 2,
    contractAddress: null,
    isNative: true,
    standard: null,
    minConfirmations: 0,
    custodianAssetKey: null,
  },
  {
    assetNo: buildDeterministicNo('AS', 'CRYPTO', 'USDT', 'TRON'),
    type: 'CRYPTO',
    currency: 'USDT',
    code: 'USDT-TRON',
    network: 'TRON',
    description: 'Tether (TRC-20)',
    decimals: 6,
    contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    isNative: false,
    standard: 'TRC-20',
    minConfirmations: 19,
    custodianAssetKey: 'tron_USDT',
  },
];
