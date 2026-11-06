import { currencyForNetwork } from '../../../../config/manifests/assets.manifest';
import type { NetworkCode } from '../../../../config/manifests/networks.manifest';

/** One ledger per currency. Immutable once assigned. */
export const TB_LEDGERS = {
  AED: 1,
  USDT: 2,
} as const;

export type TbLedgerId = (typeof TB_LEDGERS)[keyof typeof TB_LEDGERS];

/** 网络 → 账本：钱包所在网络对应的资产币种即账本(TRON → USDT 2，AED_ZAND → AED 1)。开户 / 种子共用这一处。 */
export const ledgerForNetwork = (network: NetworkCode): TbLedgerId =>
  TB_LEDGERS[currencyForNetwork(network) as keyof typeof TB_LEDGERS];
