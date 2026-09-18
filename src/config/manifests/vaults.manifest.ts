import { NetworkCode } from './networks.manifest';

export type VaultCode = 'F_OPS' | 'F_SET' | 'F_FEE' | 'F_LIQ' | 'CLIENT_DEPOSIT';

/** vault = 用途容器（HexTrust 语义）：每个 vault 在每条网络上一个地址 */
export interface VaultDefinition {
  code: VaultCode;
  ownerType: 'PLATFORM' | 'CUSTOMER';
  label: string;
  networks: NetworkCode[];
}

export const VAULTS: Record<VaultCode, VaultDefinition> = {
  F_OPS: { code: 'F_OPS', ownerType: 'PLATFORM', label: 'Company Operations', networks: ['TRON', 'AED_ZAND'] },
  F_SET: { code: 'F_SET', ownerType: 'PLATFORM', label: 'Company Settlement', networks: ['AED_ZAND'] },
  F_FEE: { code: 'F_FEE', ownerType: 'PLATFORM', label: 'Company Fees', networks: ['TRON', 'AED_ZAND'] },
  F_LIQ: { code: 'F_LIQ', ownerType: 'PLATFORM', label: 'Company Liquidity', networks: ['TRON', 'AED_ZAND'] },
  CLIENT_DEPOSIT: { code: 'CLIENT_DEPOSIT', ownerType: 'CUSTOMER', label: 'Client Deposit Pool', networks: ['TRON', 'AED_ZAND'] },
};

export const VAULT_CODES = Object.keys(VAULTS) as VaultCode[];
export const PLATFORM_VAULT_CODES: VaultCode[] = ['F_OPS', 'F_SET', 'F_FEE', 'F_LIQ'];

export function isVaultCode(code: string): code is VaultCode {
  return Object.prototype.hasOwnProperty.call(VAULTS, code);
}

/** 平台侧地址行 = 4 个 vault × 各自网络（F_SET 只走法币通道）= 7 行，与种子一一对应 */
export function platformWalletSlots(): Array<{ vaultCode: VaultCode; network: NetworkCode }> {
  return PLATFORM_VAULT_CODES.flatMap((vaultCode) =>
    VAULTS[vaultCode].networks.map((network) => ({ vaultCode, network })),
  );
}
