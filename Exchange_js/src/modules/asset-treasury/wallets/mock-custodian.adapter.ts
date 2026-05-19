import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { CustodianAdapter, CreateVaultParams, CreateVaultResult } from './custodian-adapter.interface';

@Injectable()
export class MockCustodianAdapter implements CustodianAdapter {
  private readonly logger = new Logger(MockCustodianAdapter.name);

  async createVault(params: CreateVaultParams): Promise<CreateVaultResult> {
    this.logger.log(`[MOCK] Creating vault: asset=${params.assetCurrency}, role=${params.role}, existingVault=${params.vaultId ?? 'none'}`);

    if (params.network) {
      const vaultId = params.vaultId ?? `mock-vault-${crypto.randomUUID().slice(0, 8)}`;
      const address = '0x' + crypto.randomBytes(20).toString('hex');
      this.logger.log(`[MOCK] Generated crypto address: ${address}`);
      return { vaultId, address };
    }

    // FIAT wallets have no vault — only IBAN
    const iban = 'AE' + crypto.randomInt(10, 99) + 'MOCK' + crypto.randomBytes(8).toString('hex').toUpperCase();
    this.logger.log(`[MOCK] Generated IBAN: ${iban}`);
    return { vaultId: params.vaultId ?? undefined, iban };
  }
}
