import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { CustomerAccessService } from '../../identity/customers/customer-access.service';
import { CustomerDepositWalletService } from './customer-deposit-wallet.service';
import { CUSTODIAN_ADAPTER } from './custodian-adapter.interface';
import { WalletsService } from './wallets.service';
import { WalletRole, WalletStatus } from './dto/wallet.dto';

describe('CustomerDepositWalletService', () => {
  let service: CustomerDepositWalletService;
  let prisma: any;
  let customerAccess: any;
  let walletsService: any;
  let custodianAdapter: any;

  const customer = {
    id: 'cust-1',
    customerNo: 'CU1',
    lifecycle: 'ACTIVE',
  };

  const fiatAsset = {
    id: 'asset-1',
    status: 'ACTIVE',
    type: 'FIAT',
    currency: 'USD',
    network: null,
  };

  const createdWalletRecord = {
    id: 'wallet-1',
    walletNo: 'WA0001',
    ownerType: 'CUSTOMER',
    ownerId: 'cust-1',
  };

  beforeEach(async () => {
    prisma = {
      customerMain: {
        findUnique: jest.fn().mockResolvedValue(customer),
      },
      asset: {
        findUnique: jest.fn().mockResolvedValue(fiatAsset),
      },
      wallet: {
        // Pre-transaction existing-wallet probe (decides whether to run the gate).
        // Defaults to null → no existing wallet → creation path → gate runs.
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          ...createdWalletRecord,
          status: 'ACTIVE',
          asset: { code: 'USD', type: 'FIAT', decimals: 2 },
        }),
      },
      $transaction: jest.fn(async (cb: any) =>
        cb({
          wallet: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
        }),
      ),
    };

    customerAccess = {
      assertTradingReady: jest.fn().mockResolvedValue(undefined),
    };

    walletsService = {
      createWalletRecord: jest.fn().mockResolvedValue(createdWalletRecord),
      transitionStatus: jest.fn().mockResolvedValue(undefined),
    };

    custodianAdapter = {
      createVault: jest.fn().mockResolvedValue({ vaultId: 'vault-1', iban: 'IBAN123' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerDepositWalletService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: { recordSystem: jest.fn().mockResolvedValue(undefined) } },
        { provide: WalletsService, useValue: walletsService },
        { provide: CUSTODIAN_ADAPTER, useValue: custodianAdapter },
        { provide: CustomerAccessService, useValue: customerAccess },
      ],
    }).compile();

    service = module.get<CustomerDepositWalletService>(CustomerDepositWalletService);
  });

  it('should reject with NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS and create no wallet when customer is not trading-ready', async () => {
    customerAccess.assertTradingReady.mockRejectedValue(
      new ForbiddenException({
        code: 'NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS',
        message: '需要先创建并激活一个法币提现地址才能开展业务',
        customerId: 'cust-1',
      }),
    );

    await expect(service.createOrReturn('cust-1', 'asset-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS' }),
    });

    expect(customerAccess.assertTradingReady).toHaveBeenCalledWith('cust-1');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(walletsService.createWalletRecord).not.toHaveBeenCalled();
  });

  it('should create the wallet when customer is trading-ready (happy path)', async () => {
    const result = await service.createOrReturn('cust-1', 'asset-1');

    expect(customerAccess.assertTradingReady).toHaveBeenCalledWith('cust-1');
    expect(walletsService.createWalletRecord).toHaveBeenCalled();
    expect(custodianAdapter.createVault).toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'wallet-1', walletNo: 'WA0001' });
  });

  it('should return the existing ACTIVE wallet WITHOUT running the gate when one already exists (fetch path)', async () => {
    const existingWallet = {
      ...createdWalletRecord,
      status: 'ACTIVE',
      asset: { code: 'USD', type: 'FIAT', decimals: 2 },
    };
    // An existing ACTIVE wallet is found by the pre-transaction probe.
    prisma.wallet.findFirst.mockResolvedValue(existingWallet);
    // The idempotent tx re-check also returns it (race-safe short-circuit).
    prisma.$transaction.mockImplementation(async (cb: any) =>
      cb({ wallet: { findFirst: jest.fn().mockResolvedValue(existingWallet) } }),
    );
    // Customer is NOT trading-ready: if the gate ran, it would throw.
    customerAccess.assertTradingReady.mockRejectedValue(
      new ForbiddenException({ code: 'NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS' }),
    );

    const result = await service.createOrReturn('cust-1', 'asset-1');

    expect(result).toMatchObject({ id: 'wallet-1', walletNo: 'WA0001', status: 'ACTIVE' });
    expect(customerAccess.assertTradingReady).not.toHaveBeenCalled();
    expect(walletsService.createWalletRecord).not.toHaveBeenCalled();
  });
});
