import { buildDeterministicNo } from '../../common/utils/no-generator.util';

export const DEFAULT_ASSETS = [
  // 1. Fiat
  {
    assetNo: buildDeterministicNo('AS', 'FIAT', 'AED', ''),
    type: 'FIAT',
    currency: 'AED',
    code: 'AED',
    network: '',
    description: 'United Arab Emirates Dirham',
    decimals: 2,
    status: 'ACTIVE',
  },
  // 2. Crypto
  {
    assetNo: buildDeterministicNo('AS', 'CRYPTO', 'USDT', 'TRON'),
    type: 'CRYPTO',
    currency: 'USDT',
    code: 'USDT-TRON',
    network: 'TRON',
    description: 'Tether (TRC20)',
    decimals: 6,
    status: 'ACTIVE',
  },
];
