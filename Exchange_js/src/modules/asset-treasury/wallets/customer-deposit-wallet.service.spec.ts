import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { CustomerAccessService } from '../../identity/customers/customer-access.service';
import { CustomerDepositWalletService } from './customer-deposit-wallet.service';
import { CUSTODIAN_ADAPTER } from './custodian-adapter.interface';
import { WalletsService } from './wallets.service';
import { WalletQueryService } from './wallet-query.service';

describe('CustomerDepositWalletService（波一 · 按网络）', () => {
  let service: CustomerDepositWalletService;
  let prisma: any;
  let customerAccess: any;
  let walletsService: any;
  let queryService: any;
  let custodianAdapter: any;

  const customer = {
    id: 'cust-1',
    customerNo: 'CU1',
    lifecycle: 'ACTIVE',
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
      wallet: {
        // Pre-transaction existing-wallet probe (decides whether to run the gate).
        // Defaults to null → no existing wallet → creation path → gate runs.
        findFirst: jest.fn().mockResolvedValue(null),
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

    queryService = {
      findOne: jest.fn().mockResolvedValue({ ...createdWalletRecord, status: 'ACTIVE' }),
    };

    custodianAdapter = {
      createAddress: jest.fn().mockResolvedValue({ custodianRef: 'mock-hextrust-1', address: 'Tmockaddress00000000000000000000' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerDepositWalletService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: { recordByActor: jest.fn().mockResolvedValue(undefined) } },
        { provide: WalletsService, useValue: walletsService },
        { provide: WalletQueryService, useValue: queryService },
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

    await expect(service.createOrReturn('cust-1', 'TRON')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS' }),
    });

    expect(customerAccess.assertTradingReady).toHaveBeenCalledWith('cust-1');
    expect(prisma.wallet.findFirst).toHaveBeenCalledWith({
      where: { ownerType: 'CUSTOMER', ownerId: 'cust-1', vaultCode: 'CLIENT_DEPOSIT', network: 'TRON', status: 'ACTIVE' },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(walletsService.createWalletRecord).not.toHaveBeenCalled();
  });

  it('should create the wallet when customer is trading-ready (happy path)', async () => {
    const result = await service.createOrReturn('cust-1', 'TRON');

    expect(customerAccess.assertTradingReady).toHaveBeenCalledWith('cust-1');
    expect(walletsService.createWalletRecord).toHaveBeenCalled();
    expect(custodianAdapter.createAddress).toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'wallet-1', walletNo: 'WA0001' });
  });

  it('should return the existing ACTIVE wallet WITHOUT running the gate when one already exists (fetch path)', async () => {
    const existingWallet = {
      ...createdWalletRecord,
      status: 'ACTIVE',
    };
    // An existing ACTIVE wallet is found by the pre-transaction probe.
    prisma.wallet.findFirst.mockResolvedValue(existingWallet);
    // The idempotent tx re-check also returns it (race-safe short-circuit).
    prisma.$transaction.mockImplementation(async (cb: any) =>
      cb({ wallet: { findFirst: jest.fn().mockResolvedValue(existingWallet) } }),
    );
    queryService.findOne.mockResolvedValue(existingWallet);
    // Customer is NOT trading-ready: if the gate ran, it would throw.
    customerAccess.assertTradingReady.mockRejectedValue(
      new ForbiddenException({ code: 'NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS' }),
    );

    const result = await service.createOrReturn('cust-1', 'TRON');

    expect(result).toMatchObject({ id: 'wallet-1', walletNo: 'WA0001', status: 'ACTIVE' });
    expect(customerAccess.assertTradingReady).not.toHaveBeenCalled();
    expect(walletsService.createWalletRecord).not.toHaveBeenCalled();
  });

  it('should reject unregistered network with BadRequestException', async () => {
    await expect(service.createOrReturn('cust-1', 'FIAT')).rejects.toBeInstanceOf(BadRequestException);
  });
});
