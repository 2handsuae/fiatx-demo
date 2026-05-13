import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { CustodianAdapter, CreateVaultParams, CreateVaultResult } from './custodian-adapter.interface';

@Injectable()
export class MockCustodianAdapter implements CustodianAdapter {
  private readonly logger = new Logger(MockCustodianAdapter.name);

  async createVault(params: CreateVaultParams): Promise<CreateVaultResult> {
    this.logger.log(`[MOCK] Creating vault: asset=${params.assetCode}, role=${params.role}`);

    const vaultId = `mock-vault-${crypto.randomUUID().slice(0, 8)}`;

    if (params.network) {
      const address = '0x' + crypto.randomBytes(20).toString('hex');
      this.logger.log(`[MOCK] Generated crypto address: ${address}`);
      return { vaultId, address };
    }

    const iban = 'AE' + crypto.randomInt(10, 99) + 'MOCK' + crypto.randomBytes(8).toString('hex').toUpperCase();
    this.logger.log(`[MOCK] Generated IBAN: ${iban}`);
    return { vaultId, iban };
  }
}
