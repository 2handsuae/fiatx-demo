import { WalletRole } from './dto/wallet.dto';

export const CUSTODIAN_ADAPTER = Symbol('CUSTODIAN_ADAPTER');

export interface CreateVaultParams {
  assetCode: string;
  network?: string;
  role: WalletRole;
}

export interface CreateVaultResult {
  vaultId: string;
  address?: string;
  iban?: string;
}

export interface CustodianAdapter {
  createVault(params: CreateVaultParams): Promise<CreateVaultResult>;
}
