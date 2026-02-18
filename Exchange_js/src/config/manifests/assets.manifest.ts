export const DEFAULT_ASSETS = [
  // 1. Fiat
  {
    assetNo: 'AS_AED',
    type: 'FIAT',
    code: 'AED',
    network: '',
    description: 'United Arab Emirates Dirham',
    decimals: 2,
    status: 'ACTIVE',
  },
  // 2. Crypto
  {
    assetNo: 'AS_USDT_TRON',
    type: 'CRYPTO',
    code: 'USDT',
    network: 'TRON',
    description: 'Tether (TRC20)',
    decimals: 6,
    status: 'ACTIVE',
  },
  {
    assetNo: 'AS_BTC',
    type: 'CRYPTO',
    code: 'BTC',
    network: 'BITCOIN',
    description: 'Bitcoin',
    decimals: 8,
    status: 'ACTIVE',
  },
];
