import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { CustodianAdapter, CreateAddressParams, CreateAddressResult } from './custodian-adapter.interface';
import { assertNetwork } from '../../../config/manifests/networks.manifest';
import { fakeTronAddress } from '../../../common/utils/tron-address.util';

@Injectable()
export class MockCustodianAdapter implements CustodianAdapter {
  private readonly logger = new Logger(MockCustodianAdapter.name);

  async createAddress(params: CreateAddressParams): Promise<CreateAddressResult> {
    const network = assertNetwork(params.network);
    const custodianRef = `mock-${network.custodian.toLowerCase()}-${randomUUID().slice(0, 8)}`;
    const seed = `${params.vaultCode}|${params.network}|${params.ownerNo}|${custodianRef}`;
    if (network.kind === 'CHAIN') {
      const address = fakeTronAddress(seed);
      this.logger.log(`[MOCK] ${network.custodian} address on ${network.code}: ${address}`);
      return { custodianRef, address };
    }
    const digits = createHash('sha256').update(seed).digest('hex').replace(/\D/g, '').padEnd(16, '0').slice(0, 16);
    const iban = `AE07086${digits}`;
    this.logger.log(`[MOCK] ${network.custodian} virtual IBAN on ${network.code}: ${iban}`);
    return { custodianRef, iban };
  }
}
