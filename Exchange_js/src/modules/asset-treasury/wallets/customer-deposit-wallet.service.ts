import { Injectable, Inject, Logger, BadGatewayException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditOutcome } from '../../audit-logging/dto/audit-log.dto';
import { CUSTODIAN_ADAPTER, CustodianAdapter } from './custodian-adapter.interface';
import { WalletStatus } from './dto/wallet.dto';
import { WalletsService } from './wallets.service';
import { WalletQueryService } from './wallet-query.service';
import { customerRoleForNetworkKind } from './system-wallet.util';
import { CustomerAccessService } from '../../identity/customers/customer-access.service';
import { assertNetwork } from '../../../config/manifests/networks.manifest';

/** 钱包表唯一保留的写路径（spec §4）：客户在某条网络上要一个收款地址。
 *  同网络第二次直接复用——一个客户在一条网络上只有一个地址（HexTrust：一 vault 一链一地址）。 */
@Injectable()
export class CustomerDepositWalletService {
  private readonly logger = new Logger(CustomerDepositWalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly walletsService: WalletsService,
    private readonly queryService: WalletQueryService,
    @Inject(CUSTODIAN_ADAPTER) private readonly custodianAdapter: CustodianAdapter,
    private readonly customerAccess: CustomerAccessService,
  ) {}

  async createOrReturn(customerId: string, networkCode: string) {
    const network = assertNetwork(networkCode);

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { id: true, customerNo: true, lifecycle: true },
    });
    if (!customer) throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' });
    if (customer.lifecycle !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'CUSTOMER_NOT_ACTIVE', message: 'Customer is not active' });
    }

    const walletRole = customerRoleForNetworkKind(network.kind);
    const whereExisting = {
      ownerType: 'CUSTOMER',
      ownerId: customerId,
      vaultCode: 'CLIENT_DEPOSIT',
      network: network.code,
      status: WalletStatus.ACTIVE,
    };

    // 只在"要开新地址"时过交易就绪门；已有地址的取回路径不过门（否则停用提现地址会把客户锁在自己的地址外）
    const existingActive = await this.prisma.wallet.findFirst({ where: whereExisting });
    if (!existingActive) {
      await this.customerAccess.assertTradingReady(customerId);
    }

    const txResult = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.wallet.findFirst({ where: whereExisting });
      if (existing) return { kind: 'existing' as const, wallet: existing };
      const wallet = await this.walletsService.createWalletRecord(
        {
          ownerType: 'CUSTOMER',
          ownerId: customerId,
          ownerNo: customer.customerNo,
          vaultCode: 'CLIENT_DEPOSIT',
          walletRole,
          network: network.code,
          status: 'CREATING',
        },
        tx,
      );
      return { kind: 'created' as const, wallet };
    });

    if (txResult.kind === 'existing') return this.queryService.findOne(txResult.wallet.id);

    const wallet = txResult.wallet;
    const traceId = randomUUID();
    const actor = {
      actorType: 'CUSTOMER' as const,
      actorNo: customer.customerNo,
      actorDisplayName: customer.customerNo,
      actorRolesAtTime: ['CUSTOMER'],
    };

    try {
      const result = await this.custodianAdapter.createAddress({
        vaultCode: 'CLIENT_DEPOSIT',
        network: network.code,
        ownerNo: customer.customerNo,
      });
      await this.walletsService.transitionStatus(wallet.walletNo, 'CREATING', 'ACTIVE', {
        custodianRef: result.custodianRef,
        address: result.address ?? null,
        iban: result.iban ?? null,
      });

      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.CUSTOMER_DEPOSIT_ADDRESS_CREATED,
          actionDomain: 'DEPOSIT',
          primarySubjectType: AuditEntityTypes.WALLET,
          primarySubjectNo: wallet.walletNo,
          ownerCustomerNo: customer.customerNo,
          subjects: [
            { subjectType: AuditEntityTypes.WALLET, subjectNo: wallet.walletNo, subjectRole: 'PRIMARY' as any },
            { subjectType: 'CUSTOMER', subjectNo: customer.customerNo, subjectRole: 'OWNER' as any },
          ],
          requestId: `CUSTOMER_DEPOSIT_ADDRESS_CREATED_${wallet.walletNo}`,
          traceId,
          outcome: AuditOutcome.SUCCESS,
          afterData: { walletNo: wallet.walletNo, network: network.code, walletRole, address: result.address ?? null, iban: result.iban ?? null, custodianRef: result.custodianRef },
          sourcePlatform: 'CLIENT_API',
        },
        actor,
      );

      this.logger.log(`Deposit address ${wallet.walletNo} opened for ${customer.customerNo} on ${network.code}`);
      return this.queryService.findOne(wallet.id);
    } catch (err: any) {
      await this.walletsService.transitionStatus(wallet.walletNo, 'CREATING', 'FAILED');
      // 双结局：失败不单独起名——同码 outcome=FAILED + reasonCode
      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.CUSTOMER_DEPOSIT_ADDRESS_CREATED,
          actionDomain: 'DEPOSIT',
          primarySubjectType: AuditEntityTypes.WALLET,
          primarySubjectNo: wallet.walletNo,
          ownerCustomerNo: customer.customerNo,
          subjects: [
            { subjectType: AuditEntityTypes.WALLET, subjectNo: wallet.walletNo, subjectRole: 'PRIMARY' as any },
            { subjectType: 'CUSTOMER', subjectNo: customer.customerNo, subjectRole: 'OWNER' as any },
          ],
          requestId: `CUSTOMER_DEPOSIT_ADDRESS_CREATED_${wallet.walletNo}`,
          traceId,
          outcome: AuditOutcome.FAILED,
          reasonCode: 'PROVISION_ERROR',
          reason: err?.message ?? 'custodian error',
          metadata: { network: network.code, walletRole },
          sourcePlatform: 'CLIENT_API',
        },
        actor,
      );
      this.logger.error(`Deposit address creation failed for ${customer.customerNo} on ${network.code}: ${err?.message}`);
      throw new BadGatewayException({ code: 'CUSTODIAN_CREATE_FAILED', message: 'Failed to create deposit address' });
    }
  }
}
