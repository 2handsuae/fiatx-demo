// src/modules/accounting/tigerbeetle/tigerbeetle.service.ts
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createClient,
  Client,
  Account,
  Transfer,
  AccountFilter,
  CreateAccountResult,
  CreateTransferResult,
} from 'tigerbeetle-node';

@Injectable()
export class TigerBeetleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TigerBeetleService.name);
  private client!: Client;
  private readonly address: string;

  constructor(private readonly configService: ConfigService) {
    this.address = this.configService.get<string>('TB_ADDRESS', '127.0.0.1:3001');
  }

  async onModuleInit(): Promise<void> {
    this.logger.log(`Connecting to TigerBeetle at ${this.address}...`);
    this.client = createClient({
      cluster_id: 0n,
      replica_addresses: [this.address],
    });
    // Health check with timeout — don't block app startup if TB is unreachable
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TigerBeetle health-check timed out after 5 s')), 5000),
      );
      await Promise.race([this.client.lookupAccounts([0n]), timeout]);
      this.logger.log('TigerBeetle connection established.');
    } catch (err: any) {
      this.logger.warn(`TigerBeetle health-check failed (${err.message}) — app will continue without accounting`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.logger.log('TigerBeetle client destroyed.');
    }
  }

  async createAccounts(accounts: Account[]): Promise<CreateAccountResult[]> {
    return this.client.createAccounts(accounts);
  }

  async createTransfers(transfers: Transfer[]): Promise<CreateTransferResult[]> {
    return this.client.createTransfers(transfers);
  }

  async lookupAccounts(ids: bigint[]): Promise<Account[]> {
    return this.client.lookupAccounts(ids);
  }

  async lookupTransfers(ids: bigint[]): Promise<Transfer[]> {
    return this.client.lookupTransfers(ids);
  }

  async getAccountTransfers(filter: AccountFilter): Promise<Transfer[]> {
    return this.client.getAccountTransfers(filter);
  }
}
