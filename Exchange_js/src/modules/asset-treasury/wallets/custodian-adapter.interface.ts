import { WalletRole } from './dto/wallet.dto';

export const CUSTODIAN_ADAPTER = Symbol('CUSTODIAN_ADAPTER');

export interface CreateVaultParams {
  assetCurrency: string;
  network?: string;
  role: WalletRole;
  vaultId?: string;
}

export interface CreateVaultResult {
  vaultId?: string;
  address?: string;
  iban?: string;
}

export interface CustodianAdapter {
  createVault(params: CreateVaultParams): Promise<CreateVaultResult>;
}
