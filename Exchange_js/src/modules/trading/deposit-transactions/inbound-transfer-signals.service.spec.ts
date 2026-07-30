import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { OnboardingService } from '../../identity/onboarding/onboarding.service';
import { DepositTransactionsService } from './deposit-transactions.service';
import { FundsOrderService } from '../../funds-orders/funds-order.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { InboundTransferSignalsService } from './inbound-transfer-signals.service';
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

describe('InboundTransferSignalsService', () => {
  let service: InboundTransferSignalsService;
  let prisma: any;
  let onboardingService: any;
  let depositService: any;
  let fundsOrderService: any;

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
        findUnique: jest.fn(),
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
      auditLogEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve(data)),
      },
    };

    prisma.customerMain.findUnique.mockResolvedValue({
      id: 'cust-1',
      onboardingStatus: 'APPROVED',
      adminStatus: 'ACTIVE',
      complianceStatus: 'ACTIVE',
      restrictions: null,
    });

    onboardingService = {
      assertTradingEligibility: jest.fn(),
    };

    depositService = {
      detected: jest.fn(),
    };

    fundsOrderService = {
      findById: jest.fn(),
      advance: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InboundTransferSignalsService,
        { provide: PrismaService, useValue: prisma },
        { provide: OnboardingService, useValue: onboardingService },
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
    onboardingService.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.wallet.findUnique.mockResolvedValue({
      id: 'wallet-1',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      direction: 'INBOUND',
      walletRole: 'C_DEP',
      status: 'ACTIVE',
      assetId: 'asset-1',
      asset: { type: 'CRYPTO' },
    });
    prisma.inboundTransferSignal.findUnique.mockResolvedValueOnce(null);
    prisma.inboundTransferSignal.create.mockResolvedValue({
      id: 'sig-1',
      signalNo: 'SIG0001',
      ownerId: 'cust-1',
      walletId: 'wallet-1',
      assetId: 'asset-1',
      status: InboundTransferSignalStatus.PENDING_SCAN,
    });
    prisma.inboundTransferSignal.findUnique.mockResolvedValueOnce({
      id: 'sig-1',
      signalNo: 'SIG0001',
      ownerId: 'cust-1',
      walletId: 'wallet-1',
      assetId: 'asset-1',
      status: InboundTransferSignalStatus.PENDING_SCAN,
    });

    const result = await service.createForCustomer('cust-1', {
      walletId: 'wallet-1',
      amount: '12.50',
      txHash: '0xabc',
      fromAddress: '0xfrom',
      counterpartyIsVasp: true,
    });

    expect(prisma.inboundTransferSignal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: 'cust-1',
          walletId: 'wallet-1',
          assetId: 'asset-1',
          status: InboundTransferSignalStatus.PENDING_SCAN,
          counterpartyIsVasp: true,
        }),
      }),
    );
    expect(result.id).toBe('sig-1');
  });

  it('should reject a crypto inbound signal missing counterpartyIsVasp', async () => {
    onboardingService.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.wallet.findUnique.mockResolvedValue({
      id: 'wallet-1',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      direction: 'INBOUND',
      walletRole: 'C_DEP',
      status: 'ACTIVE',
      assetId: 'asset-1',
      asset: { type: 'CRYPTO' },
    });

    await expect(
      service.createForCustomer('cust-1', {
        walletId: 'wallet-1',
        amount: '12.50',
        txHash: '0xabc',
        fromAddress: '0xfrom',
      }),
    ).rejects.toThrow('counterpartyIsVasp is required for crypto deposits');
    expect(prisma.inboundTransferSignal.create).not.toHaveBeenCalled();
  });

  it('should reject a fiat inbound signal that provides counterpartyIsVasp', async () => {
    onboardingService.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.wallet.findUnique.mockResolvedValue({
      id: 'wallet-fiat-1',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      direction: 'INBOUND',
      walletRole: 'C_DEP',
      status: 'ACTIVE',
      assetId: 'asset-fiat-1',
      asset: { type: 'FIAT' },
    });

    await expect(
      service.createForCustomer('cust-1', {
        walletId: 'wallet-fiat-1',
        amount: '88.10',
        referenceNo: 'REF-1001',
        fromIban: 'IBAN-001',
        counterpartyIsVasp: false,
      }),
    ).rejects.toThrow('counterpartyIsVasp must not be provided for fiat deposits');
    expect(prisma.inboundTransferSignal.create).not.toHaveBeenCalled();
  });

  it('should return existing inbound signal when dedupe key already exists', async () => {
    onboardingService.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.wallet.findUnique.mockResolvedValue({
      id: 'wallet-1',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      direction: 'INBOUND',
      walletRole: 'C_DEP',
      status: 'ACTIVE',
      assetId: 'asset-1',
      asset: { type: 'FIAT' },
    });
    prisma.inboundTransferSignal.findUnique.mockResolvedValue({
      id: 'sig-existing',
      signalNo: 'SIG0002',
      status: InboundTransferSignalStatus.PENDING_SCAN,
    });

    const result = await service.createForCustomer('cust-1', {
      walletId: 'wallet-1',
      amount: '88.10',
      referenceNo: 'REF-1001',
      fromIban: 'IBAN-001',
    });

    expect(prisma.inboundTransferSignal.create).not.toHaveBeenCalled();
    expect(result.id).toBe('sig-existing');
  });

  it('should accept fiat medium risk with large deposit profile mismatch', async () => {
    onboardingService.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.wallet.findUnique.mockResolvedValue({
      id: 'wallet-fiat-1',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      direction: 'INBOUND',
      walletRole: 'C_DEP',
      status: 'ACTIVE',
      assetId: 'asset-fiat-1',
      asset: { type: 'FIAT' },
    });
    prisma.inboundTransferSignal.findUnique.mockResolvedValueOnce(null);
    prisma.inboundTransferSignal.create.mockResolvedValue({
      id: 'sig-fiat-medium-1',
      signalNo: 'SIG-FIAT-MEDIUM-1',
      ownerId: 'cust-1',
      walletId: 'wallet-fiat-1',
      assetId: 'asset-fiat-1',
      status: InboundTransferSignalStatus.PENDING_SCAN,
      simulationRiskLevel: SimulationRiskLevel.MEDIUM,
      simulationRiskReason: SimulationRiskReason.LARGE_DEPOSIT_PROFILE_MISMATCH,
    });
    prisma.inboundTransferSignal.findUnique.mockResolvedValueOnce({
      id: 'sig-fiat-medium-1',
      signalNo: 'SIG-FIAT-MEDIUM-1',
      ownerId: 'cust-1',
      walletId: 'wallet-fiat-1',
      assetId: 'asset-fiat-1',
      status: InboundTransferSignalStatus.PENDING_SCAN,
      simulationRiskLevel: SimulationRiskLevel.MEDIUM,
      simulationRiskReason: SimulationRiskReason.LARGE_DEPOSIT_PROFILE_MISMATCH,
    });

    const result = await service.createForCustomer('cust-1', {
      walletId: 'wallet-fiat-1',
      amount: '12000.00',
      referenceNo: 'REF-FIAT-MEDIUM-1',
      fromIban: 'IBAN-FIAT-1',
      simulationRiskLevel: SimulationRiskLevel.MEDIUM,
      simulationRiskReason: SimulationRiskReason.LARGE_DEPOSIT_PROFILE_MISMATCH,
    });

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
    onboardingService.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.wallet.findUnique.mockResolvedValue({
      id: 'wallet-fiat-1',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      direction: 'INBOUND',
      walletRole: 'C_DEP',
      status: 'ACTIVE',
      assetId: 'asset-fiat-1',
      asset: { type: 'FIAT' },
    });

    await expect(
      service.createForCustomer('cust-1', {
        walletId: 'wallet-fiat-1',
        amount: '12000.00',
        referenceNo: 'REF-FIAT-BAD-1',
        fromIban: 'IBAN-FIAT-2',
        simulationRiskLevel: SimulationRiskLevel.MEDIUM,
        simulationRiskReason: SimulationRiskReason.KYT_ISSUE,
      }),
    ).rejects.toThrow(
      'FIAT MEDIUM simulation risk requires LARGE_DEPOSIT_PROFILE_MISMATCH.',
    );
  });

  it('should accept fiat high risk with sanctions hit', async () => {
    onboardingService.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.wallet.findUnique.mockResolvedValue({
      id: 'wallet-fiat-1',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      direction: 'INBOUND',
      walletRole: 'C_DEP',
      status: 'ACTIVE',
      assetId: 'asset-fiat-1',
      asset: { type: 'FIAT' },
    });
    prisma.inboundTransferSignal.findUnique.mockResolvedValueOnce(null);
    prisma.inboundTransferSignal.create.mockResolvedValue({
      id: 'sig-fiat-high-1',
      signalNo: 'SIG-FIAT-HIGH-1',
      ownerId: 'cust-1',
      walletId: 'wallet-fiat-1',
      assetId: 'asset-fiat-1',
      status: InboundTransferSignalStatus.PENDING_SCAN,
      simulationRiskLevel: SimulationRiskLevel.HIGH,
      simulationRiskReason: SimulationRiskReason.SANCTIONS_HIT,
    });
    prisma.inboundTransferSignal.findUnique.mockResolvedValueOnce({
      id: 'sig-fiat-high-1',
      signalNo: 'SIG-FIAT-HIGH-1',
      ownerId: 'cust-1',
      walletId: 'wallet-fiat-1',
      assetId: 'asset-fiat-1',
      status: InboundTransferSignalStatus.PENDING_SCAN,
      simulationRiskLevel: SimulationRiskLevel.HIGH,
      simulationRiskReason: SimulationRiskReason.SANCTIONS_HIT,
    });

    const result = await service.createForCustomer('cust-1', {
      walletId: 'wallet-fiat-1',
      amount: '35000.00',
      referenceNo: 'REF-FIAT-HIGH-1',
      fromIban: 'IBAN-FIAT-3',
      simulationRiskLevel: SimulationRiskLevel.HIGH,
      simulationRiskReason: SimulationRiskReason.SANCTIONS_HIT,
    });

    expect(result.id).toBe('sig-fiat-high-1');
  });

  it('should mark signals ignored when deposit trading gate is blocked during scan', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      id: 'wallet-1',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      direction: 'INBOUND',
      walletRole: 'C_DEP',
      status: 'ACTIVE',
      assetId: 'asset-1',
      asset: { type: 'CRYPTO' },
    });
    onboardingService.assertTradingEligibility.mockRejectedValue(
      new Error('DEPOSIT is blocked by onboarding gate'),
    );
    prisma.inboundTransferSignal.findMany.mockResolvedValue([
      {
        id: 'sig-1',
        signalNo: 'SIG0001',
        ownerId: 'cust-1',
        walletId: 'wallet-1',
        assetId: 'asset-1',
      },
    ]);
    prisma.inboundTransferSignal.update.mockResolvedValue({});

    const result = await service.scanForCustomer('cust-1', { walletId: 'wallet-1' });

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
    prisma.wallet.findUnique.mockResolvedValue({
      id: 'wallet-1',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      direction: 'INBOUND',
      walletRole: 'C_DEP',
      status: 'ACTIVE',
      assetId: 'asset-1',
      asset: { type: 'CRYPTO' },
    });
    onboardingService.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.inboundTransferSignal.findMany.mockResolvedValue([
      {
        id: 'sig-1',
        signalNo: 'SIG0001',
        ownerId: 'cust-1',
        walletId: 'wallet-1',
        assetId: 'asset-1',
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

    const result = await service.scanForCustomer('cust-1', { walletId: 'wallet-1' });

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

  it('should reuse an existing deposit funds order on repeated scan without creating duplicates', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      id: 'wallet-1',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      direction: 'INBOUND',
      walletRole: 'C_DEP',
      status: 'ACTIVE',
      assetId: 'asset-1',
      asset: { type: 'FIAT' },
    });
    onboardingService.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.inboundTransferSignal.findMany.mockResolvedValue([
      {
        id: 'sig-1',
        signalNo: 'SIG0001',
        ownerId: 'cust-1',
        walletId: 'wallet-1',
        assetId: 'asset-1',
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

    const result = await service.scanForCustomer('cust-1', { walletId: 'wallet-1' });

    expect(result.createdPayinCount).toBe(0);
    expect(result.reusedPayinCount).toBe(1);
    expect(depositService.detected).not.toHaveBeenCalled();
    expect(fundsOrderService.advance).not.toHaveBeenCalled();
    expect(result.depositIds).toEqual(['dep-existing']);
  });

  it('should stop at SUBMITTED funds order and PAYIN_PENDING deposit during interactive scan', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      id: 'wallet-1',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      direction: 'INBOUND',
      walletRole: 'C_DEP',
      status: 'ACTIVE',
      assetId: 'asset-1',
      asset: { type: 'CRYPTO' },
    });
    onboardingService.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.inboundTransferSignal.findMany.mockResolvedValue([
      {
        id: 'sig-interactive-1',
        signalNo: 'SIG-INTERACTIVE-1',
        ownerId: 'cust-1',
        walletId: 'wallet-1',
        assetId: 'asset-1',
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
      walletId: 'wallet-1',
      mode: InboundTransferScanMode.INTERACTIVE,
    });

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
    onboardingService.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.wallet.findUnique.mockResolvedValue({
      id: 'wallet-viban-1',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      direction: 'INBOUND',
      walletRole: 'C_VIBAN',
      status: 'ACTIVE',
      assetId: 'asset-fiat-1',
      asset: { type: 'FIAT' },
    });
    prisma.inboundTransferSignal.findUnique.mockResolvedValueOnce(null);
    prisma.inboundTransferSignal.create.mockResolvedValue({
      id: 'sig-viban-1',
      signalNo: 'SIG-VIBAN-1',
      ownerId: 'cust-1',
      walletId: 'wallet-viban-1',
      assetId: 'asset-fiat-1',
      status: InboundTransferSignalStatus.PENDING_SCAN,
    });
    prisma.inboundTransferSignal.findUnique.mockResolvedValueOnce({
      id: 'sig-viban-1',
      signalNo: 'SIG-VIBAN-1',
      ownerId: 'cust-1',
      walletId: 'wallet-viban-1',
      assetId: 'asset-fiat-1',
      status: InboundTransferSignalStatus.PENDING_SCAN,
    });

    const result = await service.createForCustomer('cust-1', {
      walletId: 'wallet-viban-1',
      amount: '500.00',
      referenceNo: 'REF-VIBAN-1',
      fromIban: 'IBAN-VIBAN-1',
    });

    expect(prisma.inboundTransferSignal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: 'cust-1',
          walletId: 'wallet-viban-1',
          assetId: 'asset-fiat-1',
          status: InboundTransferSignalStatus.PENDING_SCAN,
        }),
      }),
    );
    expect(result.id).toBe('sig-viban-1');
  });
});
