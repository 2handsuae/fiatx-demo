export const CUSTODIAN_ADAPTER = Symbol('CUSTODIAN_ADAPTER');

/** 一个 vault 在一条网络上开一个地址（HexTrust 语义）；银行通道给虚拟账号 */
export interface CreateAddressParams {
  vaultCode: string;
  network: string;
  ownerNo: string;
}

export interface CreateAddressResult {
  custodianRef: string;
  address?: string;
  iban?: string;
}

export interface CustodianAdapter {
  createAddress(params: CreateAddressParams): Promise<CreateAddressResult>;
}
