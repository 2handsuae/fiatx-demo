import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccountingService } from './accounting.service';
import { TbAccountRegistryService } from './tb-account-registry.service';
import { TB_ACCOUNT_CODES } from './constants/tb-account-codes.constant';
import { CreateTbAccountParams } from './types/accounting.types';

interface AssetProvisionedEvent {
  assetId: string;
  assetCode: string;
  tbLedgerId: number;
}

@Injectable()
export class TbAccountBatchService {
  private readonly logger = new Logger(TbAccountBatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountingService: AccountingService,
    private readonly registryService: TbAccountRegistryService,
  ) {}

  @OnEvent('asset.provisioned', { async: true })
  async onAssetProvisioned(event: AssetProvisionedEvent): Promise<void> {
    this.logger.log(
      `Batch creating customer TB accounts for asset ${event.assetCode} (ledger=${event.tbLedgerId})`,
    );
    await this.batchCreateForAsset(event.assetCode, event.tbLedgerId);
  }

  async batchCreateForAsset(
    assetCode: string,
    ledger: number,
  ): Promise<{ total: number; succeeded: number; failed: number }> {
    const customers = await this.prisma.customerMain.findMany({
      where: {
        onboardingStatus: 'APPROVED',
        adminStatus: 'ACTIVE',
      },
      select: { id: true, customerNo: true },
    });

    let succeeded = 0;
    let failed = 0;

    for (const customer of customers) {
      for (const code of [TB_ACCOUNT_CODES.CLIENT_CREDIT, TB_ACCOUNT_CODES.CLIENT_AUDIT]) {
        try {
          // Check if already exists
          const existing = await this.registryService.resolve({
            code,
            ledger,
            ownerType: 'CUSTOMER',
            ownerUuid: customer.id,
          });
          if (existing) {
            succeeded++;
            continue;
          }

          const codeName =
            code === TB_ACCOUNT_CODES.CLIENT_CREDIT ? 'CLIENT_CREDIT' : 'CLIENT_AUDIT';
          const flags = code === TB_ACCOUNT_CODES.CLIENT_CREDIT ? 0x02 : 0; // debits_must_not_exceed_credits

          const params: CreateTbAccountParams = {
            code,
            ledger,
            ownerType: 'CUSTOMER',
            ownerUuid: customer.id,
            ownerNo: customer.customerNo,
            assetCode,
            description: `${codeName} for ${customer.customerNo} / ${assetCode}`,
            flags,
          };

          await this.accountingService.createAccounts([params]);
          succeeded++;

          // If there was a previous backlog entry, mark it completed
          await this.prisma.tbAccountBacklog.updateMany({
            where: { ledger, customerId: customer.id, code, status: 'FAILED' },
            data: { status: 'COMPLETED' },
          });
        } catch (error) {
          failed++;
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          this.logger.warn(
            `Failed to create TB account code=${code} for customer=${customer.customerNo} asset=${assetCode}: ${errorMsg}`,
          );

          // Upsert backlog entry
          await this.prisma.tbAccountBacklog.upsert({
            where: {
              ledger_customerId_code: { ledger, customerId: customer.id, code },
            },
            create: {
              assetCode,
              ledger,
              customerId: customer.id,
              customerNo: customer.customerNo,
              code,
              status: 'FAILED',
              attempts: 1,
              lastError: errorMsg,
            },
            update: {
              attempts: { increment: 1 },
              lastError: errorMsg,
              status: 'FAILED',
            },
          });
        }
      }
    }

    this.logger.log(
      `Batch TB account creation for ${assetCode}: total=${customers.length * 2}, succeeded=${succeeded}, failed=${failed}`,
    );
    return { total: customers.length * 2, succeeded, failed };
  }

  async retryFailed(
    assetCode?: string,
  ): Promise<{ total: number; succeeded: number; failed: number }> {
    const where: { status: string; assetCode?: string } = { status: 'FAILED' };
    if (assetCode) where.assetCode = assetCode;

    const entries = await this.prisma.tbAccountBacklog.findMany({ where });
    let succeeded = 0;
    let failed = 0;

    for (const entry of entries) {
      try {
        const existing = await this.registryService.resolve({
          code: entry.code,
          ledger: entry.ledger,
          ownerType: 'CUSTOMER',
          ownerUuid: entry.customerId,
        });

        if (existing) {
          await this.prisma.tbAccountBacklog.update({
            where: { id: entry.id },
            data: { status: 'COMPLETED' },
          });
          succeeded++;
          continue;
        }

        const codeName =
          entry.code === TB_ACCOUNT_CODES.CLIENT_CREDIT ? 'CLIENT_CREDIT' : 'CLIENT_AUDIT';
        const flags = entry.code === TB_ACCOUNT_CODES.CLIENT_CREDIT ? 0x02 : 0;

        const params: CreateTbAccountParams = {
          code: entry.code,
          ledger: entry.ledger,
          ownerType: 'CUSTOMER',
          ownerUuid: entry.customerId,
          ownerNo: entry.customerNo,
          assetCode: entry.assetCode,
          description: `${codeName} for ${entry.customerNo} / ${entry.assetCode}`,
          flags,
        };

        await this.accountingService.createAccounts([params]);

        await this.prisma.tbAccountBacklog.update({
          where: { id: entry.id },
          data: { status: 'COMPLETED' },
        });
        succeeded++;
      } catch (error) {
        failed++;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        await this.prisma.tbAccountBacklog.update({
          where: { id: entry.id },
          data: {
            attempts: { increment: 1 },
            lastError: errorMsg,
          },
        });
      }
    }

    return { total: entries.length, succeeded, failed };
  }
}
