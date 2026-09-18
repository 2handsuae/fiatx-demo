import { BadRequestException } from '@nestjs/common';

export type NetworkKind = 'CHAIN' | 'BANK_RAIL';
export type NetworkCode = 'TRON' | 'AED_ZAND';

/** 字段对齐 HexTrust 链字段（chainID / chainName / family / minBlockConfirmation）；
 *  银行通道用同一张表描述（family = BANK）。沙盒阶段 chainId / chainName 允许占位。 */
export interface NetworkDefinition {
  code: NetworkCode;
  kind: NetworkKind;
  chainId: string;
  chainName: string;
  family: string;
  custodian: 'HEXTRUST' | 'ZAND';
  /** 登记校验正则——取代旧 address-validator.util.ts 里按资产网络串挑正则 */
  addressPattern: RegExp;
  addressLabel: string;
  minConfirmations: number;
  explorerUrl: string | null;
  /** 只有银行通道有：客户虚拟账号的收款行与户名（原 customer-viban-bank.constant.ts） */
  bankName: string | null;
  accountName: string | null;
}

export const NETWORKS: Record<NetworkCode, NetworkDefinition> = {
  TRON: {
    code: 'TRON',
    kind: 'CHAIN',
    chainId: 'tron',
    chainName: 'Tron',
    family: 'TRON',
    custodian: 'HEXTRUST',
    addressPattern: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
    addressLabel: 'Tron address (T + 33 Base58 chars)',
    minConfirmations: 19,
    explorerUrl: 'https://tronscan.org/#/transaction/',
    bankName: null,
    accountName: null,
  },
  AED_ZAND: {
    code: 'AED_ZAND',
    kind: 'BANK_RAIL',
    chainId: 'zand',
    chainName: 'Zand Bank',
    family: 'BANK',
    custodian: 'ZAND',
    addressPattern: /^AE\d{21}$/,
    addressLabel: 'UAE IBAN (AE + 21 digits)',
    minConfirmations: 0,
    explorerUrl: null,
    bankName: 'Zand Bank PJSC',
    accountName: 'FiatX Ltd',
  },
};

export const NETWORK_CODES = Object.keys(NETWORKS) as NetworkCode[];

export function isNetworkCode(code: string): code is NetworkCode {
  return Object.prototype.hasOwnProperty.call(NETWORKS, code);
}

/** Asset.network / Wallet.network / WithdrawalAddress.network 三列写入前都过它 */
export function assertNetwork(code: string): NetworkDefinition {
  if (!isNetworkCode(code)) {
    throw new BadRequestException({ code: 'UNKNOWN_NETWORK', message: `Unknown network: ${code || '(empty)'}` });
  }
  return NETWORKS[code];
}

export function validateAddressForNetwork(code: string, address: string): { valid: boolean; reason?: string } {
  const net = assertNetwork(code);
  if (!net.addressPattern.test(address)) {
    return { valid: false, reason: `Invalid format for ${net.code}. Expected: ${net.addressLabel}` };
  }
  return { valid: true };
}
