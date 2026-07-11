import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { OnboardingService } from '../../identity/onboarding/onboarding.service';
import { CustomerDepositWalletService } from './customer-deposit-wallet.service';
import { CUSTODIAN_ADAPTER } from './custodian-adapter.interface';
import { WalletsService } from './wallets.service';
import { WalletRole, WalletStatus } from './dto/wallet.dto';

describe('CustomerDepositWalletService', () => {
  let service: CustomerDepositWalletService;
  let prisma: any;
  let onboardingService: any;
  let walletsService: any;
  let custodianAdapter: any;

  const customer = {
    id: 'cust-1',
    customerNo: 'CU1',
    onboardingStatus: 'APPROVED',
    adminStatus: 'ACTIVE',
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

    onboardingService = {
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
        { provide: OnboardingService, useValue: onboardingService },
      ],
    }).compile();

    service = module.get<CustomerDepositWalletService>(CustomerDepositWalletService);
  });

  it('should reject with NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS and create no wallet when customer is not trading-ready', async () => {
    onboardingService.assertTradingReady.mockRejectedValue(
      new ForbiddenException({
        code: 'NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS',
        message: '需要先创建并激活一个法币提现地址才能开展业务',
        customerId: 'cust-1',
      }),
    );

    await expect(service.createOrReturn('cust-1', 'asset-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS' }),
    });

    expect(onboardingService.assertTradingReady).toHaveBeenCalledWith('cust-1');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(walletsService.createWalletRecord).not.toHaveBeenCalled();
  });

  it('should create the wallet when customer is trading-ready (happy path)', async () => {
    const result = await service.createOrReturn('cust-1', 'asset-1');

    expect(onboardingService.assertTradingReady).toHaveBeenCalledWith('cust-1');
    expect(walletsService.createWalletRecord).toHaveBeenCalled();
    expect(custodianAdapter.createVault).toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'wallet-1', walletNo: 'WA0001' });
  });
});
