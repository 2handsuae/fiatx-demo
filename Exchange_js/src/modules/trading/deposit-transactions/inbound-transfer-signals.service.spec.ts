import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InboundTransferSignalsService } from './inbound-transfer-signals.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DepositTransactionsService } from './deposit-transactions.service';
import { FundsOrderService } from '../../funds-orders/funds-order.service';
import { CustomerAccessService } from '../../identity/customers/customer-access.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  InboundTransferScanMode,
  InboundTransferSignalStatus,
  SimulationRiskLevel,
  SimulationRiskReason,
} from './dto/inbound-transfer-signal.dto';
import {
  FundsOrderAction,
  FundsOrderStatus,
} from '../../funds-orders/dto/funds-order.dto';

describe('InboundTransferSignalsService · 按网络与合约找钥匙（波一）', () => {
  const prisma: any = {
    customerMain: { findUnique: jest.fn() },
    wallet: { findFirst: jest.fn() },
    asset: { findFirst: jest.fn() },
    inboundTransferSignal: { findUnique: jest.fn(), create: jest.fn() },
  };
  const audit = { recordSystem: jest.fn(), recordByActor: jest.fn() };
  const access = { assertTradingEligibility: jest.fn() };
  let service: InboundTransferSignalsService;

  const wallet = { id: 'w1', walletNo: 'WA1', ownerType: 'CUSTOMER', ownerId: 'c1', vaultCode: 'CLIENT_DEPOSIT', walletRole: 'C_DEP', network: 'TRON', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', status: 'ACTIVE' };
  const usdt = { id: 'a-usdt', code: 'USDT-TRON', type: 'CRYPTO', network: 'TRON', contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6 };
  const fiatWallet = { id: 'w-fiat-1', walletNo: 'WA-F1', ownerType: 'CUSTOMER', ownerId: 'c1', vaultCode: 'CLIENT_DEPOSIT', walletRole: 'C_VIBAN', network: 'AED_ZAND', iban: 'AE070331234567890123456', status: 'ACTIVE' };
  const aed = { id: 'a-aed', code: 'AED', type: 'FIAT', network: 'AED_ZAND', contractAddress: null, decimals: 2 };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        InboundTransferSignalsService,
        { provide: PrismaService, useValue: prisma },
        { provide: DepositTransactionsService, useValue: {} },
        { provide: FundsOrderService, useValue: {} },
        { provide: CustomerAccessService, useValue: access },
        { provide: AuditLogsService, useValue: audit },
      ],
    }).compile();
    service = mod.get(InboundTransferSignalsService);
    prisma.customerMain.findUnique.mockResolvedValue({ id: 'c1', customerNo: 'CU001' });
  });

  it('合约对不上任何资产：拒收 400 + DEPOSIT_SIGNAL_REJECTED（DENIED / UNKNOWN_ASSET），不落信号行', async () => {
    prisma.wallet.findFirst.mockResolvedValue(wallet);
    prisma.asset.findFirst.mockResolvedValue(null);
    await expect(service.createForCustomer('c1', {
      network: 'TRON', toAddress: wallet.address, contractAddress: 'TScamScamScamScamScamScamScamScamXX',
      amount: '100', txHash: 'ab'.repeat(32), fromAddress: 'TSender', counterpartyIsVasp: false,
    } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(audit.recordSystem).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DEPOSIT_SIGNAL_REJECTED', actionDomain: 'DEPOSIT', outcome: 'DENIED', reasonCode: 'UNKNOWN_ASSET', ownerCustomerNo: 'CU001',
    }));
    expect(prisma.inboundTransferSignal.create).not.toHaveBeenCalled();
  });

  it('地址不是本客户在该网络上的收款行：404', async () => {
    prisma.wallet.findFirst.mockResolvedValue(null);
    await expect(service.createForCustomer('c1', { network: 'TRON', toAddress: 'Tnobody', amount: '1', txHash: 'x', fromAddress: 'y', counterpartyIsVasp: false } as any))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('钥匙对上：信号行落 walletId / assetId（服务端解析，DTO 不再携带）', async () => {
    prisma.wallet.findFirst.mockResolvedValue(wallet);
    prisma.asset.findFirst.mockResolvedValue(usdt);
    prisma.inboundTransferSignal.findUnique.mockResolvedValue(null);
    prisma.inboundTransferSignal.create.mockImplementation(async ({ data }: any) => ({ id: 's1', ...data }));
    prisma.inboundTransferSignal.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 's1' });
    await service.createForCustomer('c1', {
      network: 'TRON', toAddress: wallet.address, contractAddress: usdt.contractAddress,
      amount: '100', txHash: 'ab'.repeat(32), fromAddress: 'TSender', counterpartyIsVasp: false,
    } as any);
    expect(prisma.inboundTransferSignal.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ walletId: 'w1', assetId: 'a-usdt', channelType: 'CRYPTO' }),
    }));
  });

  it('未注册网络：400', async () => {
    await expect(service.createForCustomer('c1', { network: 'FIAT', iban: 'AE1', amount: '1' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  // 评审发现：钥匙①(resolveDepositWalletOrThrow) 的 where 子句此前只在 404
  // 分支验证过"没查到"，从未验证过"查的时候到底带了什么条件"——删掉
  // ownerId 或 vaultCode 任一子句，全部用例仍然全绿(因为 findFirst 是
  // mock,不会真的按条件过滤)。这两条子句正是挡"客户 A 拿客户 B 的收款地址
  // 报入金信号"的唯一防线,必须锁精确 where。链上与银行通道分支的
  // destination key 不同(address vs iban),两条分支都要锁。
  it('钥匙①的 where 精确锁客户归属：链上带 network+address、银行通道带 network+iban，都必须挂 ownerId + vaultCode=CLIENT_DEPOSIT', async () => {
    prisma.wallet.findFirst.mockResolvedValueOnce(wallet);
    prisma.asset.findFirst.mockResolvedValueOnce(usdt);
    prisma.inboundTransferSignal.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 's-chain' });
    prisma.inboundTransferSignal.create.mockResolvedValueOnce({ id: 's-chain' });
    await service.createForCustomer('c1', {
      network: 'TRON', toAddress: wallet.address, contractAddress: usdt.contractAddress,
      amount: '100', txHash: 'ab'.repeat(32), fromAddress: 'TSender', counterpartyIsVasp: false,
    } as any);
    expect(prisma.wallet.findFirst).toHaveBeenLastCalledWith({
      where: {
        ownerType: 'CUSTOMER',
        ownerId: 'c1',
        vaultCode: 'CLIENT_DEPOSIT',
        network: 'TRON',
        address: wallet.address,
      },
    });

    prisma.wallet.findFirst.mockResolvedValueOnce(fiatWallet);
    prisma.asset.findFirst.mockResolvedValueOnce(aed);
    prisma.inboundTransferSignal.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 's-fiat' });
    prisma.inboundTransferSignal.create.mockResolvedValueOnce({ id: 's-fiat' });
    await service.createForCustomer('c1', {
      network: 'AED_ZAND', iban: fiatWallet.iban,
      amount: '100', referenceNo: 'REF-1', fromIban: 'IBAN-1',
    } as any);
    expect(prisma.wallet.findFirst).toHaveBeenLastCalledWith({
      where: {
        ownerType: 'CUSTOMER',
        ownerId: 'c1',
        vaultCode: 'CLIENT_DEPOSIT',
        network: 'AED_ZAND',
        iban: fiatWallet.iban,
      },
    });
  });

  // 评审发现：DEPOSIT_SIGNAL_REJECTED 这条拒收留痕此前只跟 mock 的
  // AuditLogsService 对过("有没有调用、带没带这几个字段"),从来没有真正跑过
  // audit-logs.service.ts 里那道硬闸(assertActionSpec)——actionDomain 抄
  // 错、reasonCode 掉了、以后这个码被重新登记成 INHERIT,这些漂移都不会
  // 让任何测试变红。这里把服务实际传出去的信封原样喂给真实校验函数
  // (不连库:assertActionSpec 是纯校验,不碰 prisma,与
  // adjustment.service.spec.ts 的 assertActionSpec 回归锁同款做法)。
  it('DEPOSIT_SIGNAL_REJECTED 拒收信封过真实 assertActionSpec 不拒写（不依赖真库）', async () => {
    prisma.wallet.findFirst.mockResolvedValue(wallet);
    prisma.asset.findFirst.mockResolvedValue(null);
    await expect(service.createForCustomer('c1', {
      network: 'TRON', toAddress: wallet.address, contractAddress: 'TScamScamScamScamScamScamScamScamXX',
      amount: '100', txHash: 'ab'.repeat(32), fromAddress: 'TSender', counterpartyIsVasp: false,
    } as any)).rejects.toBeInstanceOf(BadRequestException);

    expect(audit.recordSystem).toHaveBeenCalledTimes(1);
    const envelope = audit.recordSystem.mock.calls[0][0];
    const realAuditLogs = new AuditLogsService(null as any);
    expect(() => (realAuditLogs as any).assertActionSpec(envelope)).not.toThrow();
  });
});

describe('InboundTransferSignalsService · 既有行为回归（钥匙改按网络/合约解析，波一 T5）', () => {
  let service: InboundTransferSignalsService;
  let prisma: any;
  let customerAccess: any;
  let depositService: any;
  let fundsOrderService: any;

  // 三个固定钱包行(one-address-per-row，Task 4 终态)：链上收款地址 / 法币 vIBAN(C_DEP 语境) /
  // 法币 vIBAN(C_VIBAN 语境，覆盖两种客户收款行角色都要放行的既有用例)。
  const cryptoWallet = { id: 'wallet-1', walletNo: 'WA-C1', ownerType: 'CUSTOMER', ownerId: 'cust-1', vaultCode: 'CLIENT_DEPOSIT', walletRole: 'C_DEP', network: 'TRON', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', status: 'ACTIVE' };
  const fiatWallet = { id: 'wallet-fiat-1', walletNo: 'WA-F1', ownerType: 'CUSTOMER', ownerId: 'cust-1', vaultCode: 'CLIENT_DEPOSIT', walletRole: 'C_VIBAN', network: 'AED_ZAND', iban: 'AE070331234567890123456', status: 'ACTIVE' };
  const vibanWallet = { id: 'wallet-viban-1', walletNo: 'WA-F2', ownerType: 'CUSTOMER', ownerId: 'cust-1', vaultCode: 'CLIENT_DEPOSIT', walletRole: 'C_VIBAN', network: 'AED_ZAND', iban: 'AE070331234567890999999', status: 'ACTIVE' };
  const usdtAsset = { id: 'asset-1', code: 'USDT-TRON', type: 'CRYPTO', network: 'TRON', contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6 };
  const aedAsset = { id: 'asset-fiat-1', code: 'AED', type: 'FIAT', network: 'AED_ZAND', contractAddress: null, decimals: 2 };

  beforeEach(async () => {
    prisma = {
      inboundTransferSignal: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      wallet: {
        findFirst: jest.fn(),
      },
      asset: {
        findFirst: jest.fn(),
      },
      fundsOrder: {
        findFirst: jest.fn(),
      },
      depositTransaction: {
        findUnique: jest.fn(),
      },
      customerMain: {
        findUnique: jest.fn(),
      },
    };

    prisma.customerMain.findUnique.mockResolvedValue({
      id: 'cust-1',
      customerNo: 'CU-CUST-1',
    });

    customerAccess = {
      assertTradingEligibility: jest.fn(),
    };

    depositService = {
      detected: jest.fn(),
      // 复审 Critical 2：processSignal() 的 depositStatus 收敛复用
      // DepositTransactionsService#toCustomerStatus 这同一个判据（见
      // deposit-transactions.service.ts 的 CUSTOMER_STATUS_PASSTHROUGH 白
      // 名单）。这里原样照抄同一份白名单，而不是随便返回原值/固定值——
      // 否则测不出"服务真的调用并使用了收敛结果"，也测不出白名单本身对不对。
      toCustomerStatus: jest.fn((status: string) =>
        [
          'PAYIN_PENDING',
          'COMPLIANCE_PENDING',
          'ACTION_PENDING',
          'SUCCESS',
          'FAILED',
          'RETURNING',
          'RETURNED',
        ].includes(status)
          ? status
          : 'COMPLIANCE_PENDING',
      ),
    };

    fundsOrderService = {
      findById: jest.fn(),
      advance: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InboundTransferSignalsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CustomerAccessService, useValue: customerAccess },
        { provide: DepositTransactionsService, useValue: depositService },
        { provide: FundsOrderService, useValue: fundsOrderService },
        {
          provide: AuditLogsService,
          useValue: {
            create: jest.fn().mockResolvedValue(undefined),
            recordSystem: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(InboundTransferSignalsService);
  });

  it('should create a pending inbound transfer signal for customer deposit wallet', async () => {
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.wallet.findFirst.mockResolvedValue(cryptoWallet);
    prisma.asset.findFirst.mockResolvedValue(usdtAsset);
    prisma.inboundTransferSignal.findUnique.mockResolvedValueOnce(null);
    prisma.inboundTransferSignal.create.mockResolvedValue({
      id: 'sig-1',
      signalNo: 'SIG0001',
      ownerId: 'cust-1',
      walletId: cryptoWallet.id,
      assetId: usdtAsset.id,
      status: InboundTransferSignalStatus.PENDING_SCAN,
    });
    prisma.inboundTransferSignal.findUnique.mockResolvedValueOnce({
      id: 'sig-1',
      signalNo: 'SIG0001',
      ownerId: 'cust-1',
      walletId: cryptoWallet.id,
      assetId: usdtAsset.id,
      status: InboundTransferSignalStatus.PENDING_SCAN,
    });

    const result = await service.createForCustomer('cust-1', {
      network: 'TRON',
      toAddress: cryptoWallet.address,
      contractAddress: usdtAsset.contractAddress,
      amount: '12.50',
      txHash: '0xabc',
      fromAddress: '0xfrom',
      counterpartyIsVasp: true,
    } as any);

    expect(prisma.inboundTransferSignal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: 'cust-1',
          walletId: cryptoWallet.id,
          assetId: usdtAsset.id,
          status: InboundTransferSignalStatus.PENDING_SCAN,
          counterpartyIsVasp: true,
        }),
      }),
    );
    expect(result.id).toBe('sig-1');
  });

  it('should reject a crypto inbound signal missing counterpartyIsVasp', async () => {
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.wallet.findFirst.mockResolvedValue(cryptoWallet);
    prisma.asset.findFirst.mockResolvedValue(usdtAsset);

    await expect(
      service.createForCustomer('cust-1', {
        network: 'TRON',
        toAddress: cryptoWallet.address,
        contractAddress: usdtAsset.contractAddress,
        amount: '12.50',
        txHash: '0xabc',
        fromAddress: '0xfrom',
      } as any),
    ).rejects.toThrow('counterpartyIsVasp is required for crypto deposits');
    expect(prisma.inboundTransferSignal.create).not.toHaveBeenCalled();
  });

  it('should reject a crypto inbound signal with counterpartyIsVasp explicitly null', async () => {
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.wallet.findFirst.mockResolvedValue(cryptoWallet);
    prisma.asset.findFirst.mockResolvedValue(usdtAsset);

    await expect(
      service.createForCustomer('cust-1', {
        network: 'TRON',
        toAddress: cryptoWallet.address,
        contractAddress: usdtAsset.contractAddress,
        amount: '12.50',
        txHash: '0xabc',
        fromAddress: '0xfrom',
        counterpartyIsVasp: null as any,
      } as any),
    ).rejects.toThrow('counterpartyIsVasp is required for crypto deposits');
    expect(prisma.inboundTransferSignal.create).not.toHaveBeenCalled();
  });

  it('should reject a fiat inbound signal that provides counterpartyIsVasp', async () => {
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.wallet.findFirst.mockResolvedValue(fiatWallet);
    prisma.asset.findFirst.mockResolvedValue(aedAsset);

    await expect(
      service.createForCustomer('cust-1', {
        network: 'AED_ZAND',
        iban: fiatWallet.iban,
        amount: '88.10',
        referenceNo: 'REF-1001',
        fromIban: 'IBAN-001',
        counterpartyIsVasp: false,
      } as any),
    ).rejects.toThrow('counterpartyIsVasp must not be provided for fiat deposits');
    expect(prisma.inboundTransferSignal.create).not.toHaveBeenCalled();
  });

  it('should return existing inbound signal when dedupe key already exists', async () => {
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.wallet.findFirst.mockResolvedValue(fiatWallet);
    prisma.asset.findFirst.mockResolvedValue(aedAsset);
    prisma.inboundTransferSignal.findUnique.mockResolvedValue({
      id: 'sig-existing',
      signalNo: 'SIG0002',
      status: InboundTransferSignalStatus.PENDING_SCAN,
    });

    const result = await service.createForCustomer('cust-1', {
      network: 'AED_ZAND',
      iban: fiatWallet.iban,
      amount: '88.10',
      referenceNo: 'REF-1001',
      fromIban: 'IBAN-001',
    } as any);

    expect(prisma.inboundTransferSignal.create).not.toHaveBeenCalled();
    expect(result.id).toBe('sig-existing');
  });

  it('should accept fiat medium risk with large deposit profile mismatch', async () => {
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.wallet.findFirst.mockResolvedValue(fiatWallet);
    prisma.asset.findFirst.mockResolvedValue(aedAsset);
    prisma.inboundTransferSignal.findUnique.mockResolvedValueOnce(null);
    prisma.inboundTransferSignal.create.mockResolvedValue({
      id: 'sig-fiat-medium-1',
      signalNo: 'SIG-FIAT-MEDIUM-1',
      ownerId: 'cust-1',
      walletId: fiatWallet.id,
      assetId: aedAsset.id,
      status: InboundTransferSignalStatus.PENDING_SCAN,
      simulationRiskLevel: SimulationRiskLevel.MEDIUM,
      simulationRiskReason: SimulationRiskReason.LARGE_DEPOSIT_PROFILE_MISMATCH,
    });
    prisma.inboundTransferSignal.findUnique.mockResolvedValueOnce({
      id: 'sig-fiat-medium-1',
      signalNo: 'SIG-FIAT-MEDIUM-1',
      ownerId: 'cust-1',
      walletId: fiatWallet.id,
      assetId: aedAsset.id,
      status: InboundTransferSignalStatus.PENDING_SCAN,
      simulationRiskLevel: SimulationRiskLevel.MEDIUM,
      simulationRiskReason: SimulationRiskReason.LARGE_DEPOSIT_PROFILE_MISMATCH,
    });

    const result = await service.createForCustomer('cust-1', {
      network: 'AED_ZAND',
      iban: fiatWallet.iban,
      amount: '12000.00',
      referenceNo: 'REF-FIAT-MEDIUM-1',
      fromIban: 'IBAN-FIAT-1',
      simulationRiskLevel: SimulationRiskLevel.MEDIUM,
      simulationRiskReason: SimulationRiskReason.LARGE_DEPOSIT_PROFILE_MISMATCH,
    } as any);

    expect(prisma.inboundTransferSignal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          simulationRiskLevel: SimulationRiskLevel.MEDIUM,
          simulationRiskReason:
            SimulationRiskReason.LARGE_DEPOSIT_PROFILE_MISMATCH,
        }),
      }),
    );
    expect(result.id).toBe('sig-fiat-medium-1');
  });

  it('should reject fiat medium risk reasons that rely on crypto-only enums', async () => {
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.wallet.findFirst.mockResolvedValue(fiatWallet);
    prisma.asset.findFirst.mockResolvedValue(aedAsset);

    await expect(
      service.createForCustomer('cust-1', {
        network: 'AED_ZAND',
        iban: fiatWallet.iban,
        amount: '12000.00',
        referenceNo: 'REF-FIAT-BAD-1',
        fromIban: 'IBAN-FIAT-2',
        simulationRiskLevel: SimulationRiskLevel.MEDIUM,
        simulationRiskReason: SimulationRiskReason.KYT_ISSUE,
      } as any),
    ).rejects.toThrow(
      'FIAT MEDIUM simulation risk requires LARGE_DEPOSIT_PROFILE_MISMATCH.',
    );
  });

  it('should accept fiat high risk with sanctions hit', async () => {
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.wallet.findFirst.mockResolvedValue(fiatWallet);
    prisma.asset.findFirst.mockResolvedValue(aedAsset);
    prisma.inboundTransferSignal.findUnique.mockResolvedValueOnce(null);
    prisma.inboundTransferSignal.create.mockResolvedValue({
      id: 'sig-fiat-high-1',
      signalNo: 'SIG-FIAT-HIGH-1',
      ownerId: 'cust-1',
      walletId: fiatWallet.id,
      assetId: aedAsset.id,
      status: InboundTransferSignalStatus.PENDING_SCAN,
      simulationRiskLevel: SimulationRiskLevel.HIGH,
      simulationRiskReason: SimulationRiskReason.SANCTIONS_HIT,
    });
    prisma.inboundTransferSignal.findUnique.mockResolvedValueOnce({
      id: 'sig-fiat-high-1',
      signalNo: 'SIG-FIAT-HIGH-1',
      ownerId: 'cust-1',
      walletId: fiatWallet.id,
      assetId: aedAsset.id,
      status: InboundTransferSignalStatus.PENDING_SCAN,
      simulationRiskLevel: SimulationRiskLevel.HIGH,
      simulationRiskReason: SimulationRiskReason.SANCTIONS_HIT,
    });

    const result = await service.createForCustomer('cust-1', {
      network: 'AED_ZAND',
      iban: fiatWallet.iban,
      amount: '35000.00',
      referenceNo: 'REF-FIAT-HIGH-1',
      fromIban: 'IBAN-FIAT-3',
      simulationRiskLevel: SimulationRiskLevel.HIGH,
      simulationRiskReason: SimulationRiskReason.SANCTIONS_HIT,
    } as any);

    expect(result.id).toBe('sig-fiat-high-1');
  });

  it('should mark signals ignored when deposit trading gate is blocked during scan', async () => {
    prisma.wallet.findFirst.mockResolvedValue(cryptoWallet);
    customerAccess.assertTradingEligibility.mockRejectedValue(
      new Error('DEPOSIT is blocked by onboarding gate'),
    );
    prisma.inboundTransferSignal.findMany.mockResolvedValue([
      {
        id: 'sig-1',
        signalNo: 'SIG0001',
        ownerId: 'cust-1',
        walletId: cryptoWallet.id,
        assetId: usdtAsset.id,
      },
    ]);
    prisma.inboundTransferSignal.update.mockResolvedValue({});

    const result = await service.scanForCustomer('cust-1', {
      network: 'TRON',
      toAddress: cryptoWallet.address,
    } as any);

    expect(result.blockedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(prisma.inboundTransferSignal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sig-1' },
        data: expect.objectContaining({
          status: InboundTransferSignalStatus.IGNORED,
        }),
      }),
    );
  });

  it('should create and advance a crypto funds order to deposit compliance pending during scan', async () => {
    prisma.wallet.findFirst.mockResolvedValue(cryptoWallet);
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.inboundTransferSignal.findMany.mockResolvedValue([
      {
        id: 'sig-1',
        signalNo: 'SIG0001',
        ownerId: 'cust-1',
        walletId: cryptoWallet.id,
        assetId: usdtAsset.id,
        amount: { toString: () => '100.00' },
        channelType: 'CRYPTO',
        txHash: '0xabc',
        fromAddress: '0xfrom',
        counterpartyIsVasp: true,
        submittedAt: new Date(),
      },
    ]);
    // no existing deposit funds_order → dedup misses on both providerTxnId + wallet lookups
    prisma.fundsOrder.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    depositService.detected.mockResolvedValue({
      deposit: { id: 'dep-1', depositNo: 'DEP0001', status: 'PAYIN_PENDING' },
      fundsOrder: { id: 'fo-1', fundsOrderNo: 'FO0001', status: FundsOrderStatus.SUBMITTED },
    });
    // crypto drive: SUBMITTED → (OBSERVE_CONFIRMING) → CONFIRMING → (CONFIRM) → CONFIRMED,
    // then the workflow handler drives CONFIRMED → CLEARED off-band.
    fundsOrderService.findById
      .mockResolvedValueOnce({ id: 'fo-1', fundsOrderNo: 'FO0001', status: FundsOrderStatus.SUBMITTED })
      .mockResolvedValueOnce({ id: 'fo-1', fundsOrderNo: 'FO0001', status: FundsOrderStatus.CONFIRMING })
      .mockResolvedValueOnce({ id: 'fo-1', fundsOrderNo: 'FO0001', status: FundsOrderStatus.CONFIRMED });
    fundsOrderService.advance.mockResolvedValue({});
    prisma.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-1',
      depositNo: 'DEP0001',
      status: 'COMPLIANCE_PENDING',
    });
    prisma.inboundTransferSignal.update.mockResolvedValue({});

    const result = await service.scanForCustomer('cust-1', {
      network: 'TRON',
      toAddress: cryptoWallet.address,
    } as any);

    expect(result.scannedCount).toBe(1);
    expect(result.createdPayinCount).toBe(1);
    expect(result.reusedPayinCount).toBe(0);
    expect(result.depositIds).toEqual(['dep-1']);
    expect(result.records).toEqual([
      expect.objectContaining({
        signalId: 'sig-1',
        payinId: 'fo-1',
        depositId: 'dep-1',
      }),
    ]);
    expect(fundsOrderService.advance).toHaveBeenNthCalledWith(
      1,
      'fo-1',
      FundsOrderAction.OBSERVE_CONFIRMING,
      'SYSTEM',
    );
    expect(fundsOrderService.advance).toHaveBeenNthCalledWith(
      2,
      'fo-1',
      FundsOrderAction.CONFIRM,
      'SYSTEM',
    );
    expect(depositService.detected).toHaveBeenCalledWith(
      expect.objectContaining({ counterpartyIsVasp: true }),
    );
  });

  // 复审 Critical 2（规则 A，tipping-off 防线）：POST
  // /deposit-transactions/my/inbound-signals/scan 直接面向客户浏览器。驱动
  // 后重读拿到的 deposit 行如果真实状态是 FROZEN（例如驱动过程中撞上了
  // KYT/制裁复核），返回体里的 depositStatus 必须经收敛，不能把
  // 'FROZEN' 原样吐给客户——那会绕开 DepositTransactionsService
  // #toCustomerDepositView 那道防线（Deposit.tsx 此前是 `Status:
  // {summary.depositStatus}` 裸显，完全绕开视图层）。
  it('scan 返回的 depositStatus 必须经收敛——重读到的 FROZEN 不能原样下发', async () => {
    prisma.wallet.findFirst.mockResolvedValue(cryptoWallet);
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.inboundTransferSignal.findMany.mockResolvedValue([
      {
        id: 'sig-frozen-1',
        signalNo: 'SIG-FROZEN-1',
        ownerId: 'cust-1',
        walletId: cryptoWallet.id,
        assetId: usdtAsset.id,
        amount: { toString: () => '100.00' },
        channelType: 'CRYPTO',
        txHash: '0xfrozen',
        fromAddress: '0xfrom',
        counterpartyIsVasp: true,
        submittedAt: new Date(),
      },
    ]);
    prisma.fundsOrder.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    depositService.detected.mockResolvedValue({
      deposit: { id: 'dep-frozen-1', depositNo: 'DEP-FROZEN-1', status: 'PAYIN_PENDING' },
      fundsOrder: { id: 'fo-frozen-1', fundsOrderNo: 'FO-FROZEN-1', status: FundsOrderStatus.SUBMITTED },
    });
    fundsOrderService.findById
      .mockResolvedValueOnce({ id: 'fo-frozen-1', fundsOrderNo: 'FO-FROZEN-1', status: FundsOrderStatus.SUBMITTED })
      .mockResolvedValueOnce({ id: 'fo-frozen-1', fundsOrderNo: 'FO-FROZEN-1', status: FundsOrderStatus.CONFIRMING })
      .mockResolvedValueOnce({ id: 'fo-frozen-1', fundsOrderNo: 'FO-FROZEN-1', status: FundsOrderStatus.CONFIRMED });
    fundsOrderService.advance.mockResolvedValue({});
    // 驱动后重读——真实状态是 FROZEN（撞上制裁/KYT 复核），不是正常的
    // COMPLIANCE_PENDING。
    prisma.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-frozen-1',
      depositNo: 'DEP-FROZEN-1',
      status: 'FROZEN',
    });
    prisma.inboundTransferSignal.update.mockResolvedValue({});

    const result = await service.scanForCustomer('cust-1', {
      network: 'TRON',
      toAddress: cryptoWallet.address,
    } as any);

    expect(depositService.toCustomerStatus).toHaveBeenCalledWith('FROZEN');
    expect(result.records).toEqual([
      expect.objectContaining({
        depositId: 'dep-frozen-1',
        depositStatus: 'COMPLIANCE_PENDING',
      }),
    ]);
  });

  it('should reuse an existing deposit funds order on repeated scan without creating duplicates', async () => {
    prisma.wallet.findFirst.mockResolvedValue(fiatWallet);
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.inboundTransferSignal.findMany.mockResolvedValue([
      {
        id: 'sig-1',
        signalNo: 'SIG0001',
        ownerId: 'cust-1',
        walletId: fiatWallet.id,
        assetId: aedAsset.id,
        amount: { toString: () => '50.00' },
        channelType: 'FIAT',
        referenceNo: 'REF-1',
        fromIban: 'IBAN-1',
        submittedAt: new Date(),
      },
    ]);
    // dedup hit on providerTxnId → existing deposit funds_order, already CLEARED
    prisma.fundsOrder.findFirst.mockResolvedValueOnce({
      id: 'fo-existing',
      fundsOrderNo: 'FO0009',
      status: FundsOrderStatus.CLEARED,
      depositTransactionId: 'dep-existing',
    });
    // fiat CLEARED order needs no drive; findById returns it unchanged
    fundsOrderService.findById.mockResolvedValue({
      id: 'fo-existing',
      fundsOrderNo: 'FO0009',
      status: FundsOrderStatus.CLEARED,
    });
    prisma.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-existing',
      depositNo: 'DEP0009',
      status: 'COMPLIANCE_PENDING',
    });
    prisma.inboundTransferSignal.update.mockResolvedValue({});

    const result = await service.scanForCustomer('cust-1', {
      network: 'AED_ZAND',
      iban: fiatWallet.iban,
    } as any);

    expect(result.createdPayinCount).toBe(0);
    expect(result.reusedPayinCount).toBe(1);
    expect(depositService.detected).not.toHaveBeenCalled();
    expect(fundsOrderService.advance).not.toHaveBeenCalled();
    expect(result.depositIds).toEqual(['dep-existing']);
  });

  it('should stop at SUBMITTED funds order and PAYIN_PENDING deposit during interactive scan', async () => {
    prisma.wallet.findFirst.mockResolvedValue(cryptoWallet);
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.inboundTransferSignal.findMany.mockResolvedValue([
      {
        id: 'sig-interactive-1',
        signalNo: 'SIG-INTERACTIVE-1',
        ownerId: 'cust-1',
        walletId: cryptoWallet.id,
        assetId: usdtAsset.id,
        amount: { toString: () => '75.00' },
        channelType: 'CRYPTO',
        txHash: '0xinteractive',
        fromAddress: '0xfrom',
        submittedAt: new Date(),
      },
    ]);
    prisma.fundsOrder.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    depositService.detected.mockResolvedValue({
      deposit: { id: 'dep-interactive-1', depositNo: 'DEP-INTERACTIVE-1', status: 'PAYIN_PENDING' },
      fundsOrder: { id: 'fo-interactive-1', fundsOrderNo: 'FO-INTERACTIVE-1', status: FundsOrderStatus.SUBMITTED },
    });
    prisma.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-interactive-1',
      depositNo: 'DEP-INTERACTIVE-1',
      status: 'PAYIN_PENDING',
    });
    prisma.inboundTransferSignal.update.mockResolvedValue({});

    const result = await service.scanForCustomer('cust-1', {
      network: 'TRON',
      toAddress: cryptoWallet.address,
      mode: InboundTransferScanMode.INTERACTIVE,
    } as any);

    expect(fundsOrderService.advance).not.toHaveBeenCalled();
    expect(result.records).toEqual([
      expect.objectContaining({
        payinId: 'fo-interactive-1',
        payinStatus: FundsOrderStatus.SUBMITTED,
        depositId: 'dep-interactive-1',
        depositStatus: 'PAYIN_PENDING',
      }),
    ]);
  });

  it('should accept C_VIBAN wallet role for fiat deposit signal creation', async () => {
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.wallet.findFirst.mockResolvedValue(vibanWallet);
    prisma.asset.findFirst.mockResolvedValue(aedAsset);
    prisma.inboundTransferSignal.findUnique.mockResolvedValueOnce(null);
    prisma.inboundTransferSignal.create.mockResolvedValue({
      id: 'sig-viban-1',
      signalNo: 'SIG-VIBAN-1',
      ownerId: 'cust-1',
      walletId: vibanWallet.id,
      assetId: aedAsset.id,
      status: InboundTransferSignalStatus.PENDING_SCAN,
    });
    prisma.inboundTransferSignal.findUnique.mockResolvedValueOnce({
      id: 'sig-viban-1',
      signalNo: 'SIG-VIBAN-1',
      ownerId: 'cust-1',
      walletId: vibanWallet.id,
      assetId: aedAsset.id,
      status: InboundTransferSignalStatus.PENDING_SCAN,
    });

    const result = await service.createForCustomer('cust-1', {
      network: 'AED_ZAND',
      iban: vibanWallet.iban,
      amount: '500.00',
      referenceNo: 'REF-VIBAN-1',
      fromIban: 'IBAN-VIBAN-1',
    } as any);

    expect(prisma.inboundTransferSignal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: 'cust-1',
          walletId: vibanWallet.id,
          assetId: aedAsset.id,
          status: InboundTransferSignalStatus.PENDING_SCAN,
        }),
      }),
    );
    expect(result.id).toBe('sig-viban-1');
  });
});
