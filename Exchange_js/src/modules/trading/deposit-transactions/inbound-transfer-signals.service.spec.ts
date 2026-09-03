import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CustomerAccessService } from '../../identity/customers/customer-access.service';
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
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { SupplementEvidenceService } from '../../clearing-settle/reconciliation/disposition/supplement-evidence.service';
import { DispositionService as ReconDispositionService } from '../../clearing-settle/reconciliation/disposition/disposition.service';

describe('InboundTransferSignalsService', () => {
  let service: InboundTransferSignalsService;
  let prisma: any;
  let customerAccess: any;
  let depositService: any;
  let fundsOrderService: any;
  let auditLogsService: any;
  let approvalsService: any;
  let supplementEvidence: any;
  let reconDisposition: any;

  beforeEach(async () => {
    prisma = {
      inboundTransferSignal: {
        findUnique: jest.fn(),
        findFirst: jest.fn(), // initiateSupplement 的"拒绝后复用同一行"分支用（评审 Critical，见该函数改动处的注释）；默认 undefined = 没有已存在的信号，走既有的建新行分支
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

    auditLogsService = {
      create: jest.fn().mockResolvedValue(undefined),
      recordSystem: jest.fn().mockResolvedValue(undefined),
      recordByActor: jest.fn().mockResolvedValue(undefined),
    };

    approvalsService = {
      createAndSubmit: jest.fn(),
    };

    supplementEvidence = {
      assertClaimable: jest.fn(),
    };

    reconDisposition = {
      linkSupplement: jest.fn(),
      replaceSupplement: jest.fn(),
      unlinkSupplement: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InboundTransferSignalsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CustomerAccessService, useValue: customerAccess },
        { provide: DepositTransactionsService, useValue: depositService },
        { provide: FundsOrderService, useValue: fundsOrderService },
        { provide: AuditLogsService, useValue: auditLogsService },
        { provide: ApprovalsService, useValue: approvalsService },
        { provide: SupplementEvidenceService, useValue: supplementEvidence },
        { provide: ReconDispositionService, useValue: reconDisposition },
      ],
    }).compile();

    service = module.get(InboundTransferSignalsService);
  });

  it('should create a pending inbound transfer signal for customer deposit wallet', async () => {
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
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
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
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

  it('should reject a crypto inbound signal with counterpartyIsVasp explicitly null', async () => {
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
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
        counterpartyIsVasp: null as any,
      }),
    ).rejects.toThrow('counterpartyIsVasp is required for crypto deposits');
    expect(prisma.inboundTransferSignal.create).not.toHaveBeenCalled();
  });

  it('should reject a fiat inbound signal that provides counterpartyIsVasp', async () => {
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
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
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
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
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
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
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
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
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
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
    customerAccess.assertTradingEligibility.mockRejectedValue(
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
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
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
      undefined,
      undefined,
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
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
    prisma.inboundTransferSignal.findMany.mockResolvedValue([
      {
        id: 'sig-frozen-1',
        signalNo: 'SIG-FROZEN-1',
        ownerId: 'cust-1',
        walletId: 'wallet-1',
        assetId: 'asset-1',
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

    const result = await service.scanForCustomer('cust-1', { walletId: 'wallet-1' });

    expect(depositService.toCustomerStatus).toHaveBeenCalledWith('FROZEN');
    expect(result.records).toEqual([
      expect.objectContaining({
        depositId: 'dep-frozen-1',
        depositStatus: 'COMPLIANCE_PENDING',
      }),
    ]);
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
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
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
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
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
    customerAccess.assertTradingEligibility.mockResolvedValue(undefined);
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

  describe('平账 B 批 ①：补录', () => {
    const line = { externalLineId: 'line-1', caseNo: 'REC1', caseId: 'c1', businessDate: '2026-09-01', dispositionNo: 'RCD1',
      walletId: 'w1', walletNo: 'W-1', walletAddress: null, walletIban: 'AE00', ownerId: 'cust-1', ownerNo: 'CUS1',
      assetId: 'a1', currency: 'AED', assetType: 'FIAT', decimals: 2, direction: 'IN', amountMinor: '120000', amountMajor: '1200.00',
      externalRef: 'REF-1', channelRef: null, datetime: '2026-09-01T10:00:00.000Z', description: 'Incoming', source: 'ZAND' };
    const actor = { actorType: 'ADMIN', userId: 'u1', userNo: 'ADM1', role: 'OPS_OFFICER', roleCodes: ['OPS_OFFICER'] } as any;

    it('发起：法币缺来源 IBAN → 400；链上缺来源地址 → 400', async () => {
      supplementEvidence.assertClaimable.mockResolvedValue(line);
      await expect(service.initiateSupplement({ externalLineId: 'line-1', caseNo: 'REC1', dispositionNo: 'RCD1', reason: 'x' }, actor)).rejects.toThrow(/IBAN/);
      supplementEvidence.assertClaimable.mockResolvedValue({ ...line, assetType: 'CRYPTO', externalRef: '0xabc' });
      await expect(service.initiateSupplement({ externalLineId: 'line-1', caseNo: 'REC1', dispositionNo: 'RCD1', reason: 'x' }, actor)).rejects.toThrow(/地址/);
    });

    it('发起：建 SUPPLEMENT_PENDING 信号（参考号 = 账单行参考号、金额换业务单位、生效日 = 案子业务日）→ 审批单 → 回挂 → 审计', async () => {
      supplementEvidence.assertClaimable.mockResolvedValue(line);
      prisma.inboundTransferSignal.create.mockResolvedValue({ id: 's1', signalNo: 'SIG1', walletId: 'w1' });
      approvalsService.createAndSubmit.mockResolvedValue({ approvalNo: 'APR1' });
      const r = await service.initiateSupplement({ externalLineId: 'line-1', caseNo: 'REC1', dispositionNo: 'RCD1', fromIban: 'AE11', reason: '银行看到了我们漏了' }, actor);
      const data = prisma.inboundTransferSignal.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ status: 'SUPPLEMENT_PENDING', channelType: 'FIAT', referenceNo: 'REF-1', fromIban: 'AE11',
        supplementOfExternalLineId: 'line-1', supplementReconCaseNo: 'REC1', supplementDispositionNo: 'RCD1', supplementEffectiveDate: '2026-09-01' });
      // Prisma.Decimal（真实 @prisma/client 导出，非 mock）在 toString() 时会规约掉小数尾零——
      // 直接 `node -e "new (require('@prisma/client').Prisma.Decimal)('1200.00').toString()"`
      // 验证过是 '1200'，不是 '1200.00'。这里断言的是数值换算对（120000 分 → 1200，不是误用
      // 分为单位的 120000），不是字符串格式化。
      expect(String(data.amount)).toBe('1200');
      expect(approvalsService.createAndSubmit.mock.calls[0][0]).toMatchObject({ actionType: 'DEPOSIT_SUPPLEMENT', entityRef: 'SIG1' });
      expect(reconDisposition.linkSupplement).toHaveBeenCalledWith('RCD1', 'SIG1', 'SUPPLEMENT_DEPOSIT');
      expect(auditLogsService.recordByActor.mock.calls[0][0]).toMatchObject({ action: 'DEPOSIT_SUPPLEMENT_REQUESTED', primarySubjectNo: 'SIG1' });
      expect(r).toEqual({ signalNo: 'SIG1', approvalNo: 'APR1', status: 'SUPPLEMENT_PENDING' });
    });

    it('批准：不翻 PENDING_SCAN（避免被自助扫描误捡），processSignal 带生效日，回挂改写为充值单号，STARTED/SUPPLEMENTED 审计顶层字段齐全', async () => {
      prisma.inboundTransferSignal.findUnique.mockResolvedValue({ id: 's1', signalNo: 'SIG1', status: 'SUPPLEMENT_PENDING', walletId: 'w1', channelType: 'FIAT',
        supplementDispositionNo: 'RCD1', supplementEffectiveDate: '2026-09-01', wallet: { id: 'w1', asset: { type: 'FIAT' } } });
      const spy = jest.spyOn(service as any, 'processSignal').mockResolvedValue({ depositNo: 'DEP7', depositId: 'd7' });
      await service.onSupplementDecided({ decision: 'APPROVED', entityRef: 'SIG1', approvalId: 'ap1', approvalNo: 'APR1' } as any);
      // 评审 Important 1（1）回归断言：processSignal 自己收尾，onSupplementDecided 不再
      // 抢先翻状态——processSignal 已被 mock 掉（不执行真实的 inboundTransferSignal.update），
      // 若 onSupplementDecided 还残留那次 PENDING_SCAN 翻牌，这里就会看到一次调用。
      expect(prisma.inboundTransferSignal.update).not.toHaveBeenCalled();
      expect(spy.mock.calls[0][3]).toEqual({ effectiveDate: '2026-09-01' });
      expect(reconDisposition.replaceSupplement).toHaveBeenCalledWith('RCD1', 'SIG1', 'DEP7');
      const calls = auditLogsService.recordSystem.mock.calls.map((c: any[]) => c[0]);
      const actions = calls.map((c: any) => c.action);
      expect(actions).toEqual(expect.arrayContaining(['DEPOSIT_SUPPLEMENT_STARTED', 'DEPOSIT_SUPPLEMENTED']));
      // 评审 Minor 1：顶层字段回归断言（不是 metadata 里有就算数——assertActionSpec()
      // 校验的是 input 对象自身的同名属性，见 audit-logs.service.ts）。
      const started = calls.find((c: any) => c.action === 'DEPOSIT_SUPPLEMENT_STARTED');
      expect(started.approvalNo).toBe('APR1');
      const supplemented = calls.find((c: any) => c.action === 'DEPOSIT_SUPPLEMENTED');
      expect(supplemented.depositNo).toBe('DEP7');
    });

    it('批准但 processSignal 失败：不留半截状态——信号收口 SUPPLEMENT_REJECTED、解挂、REJECTED 审计带 outcome:FAILED + reasonCode；不进 SUPPLEMENTED', async () => {
      prisma.inboundTransferSignal.findUnique.mockResolvedValue({ id: 's1', signalNo: 'SIG1', status: 'SUPPLEMENT_PENDING', walletId: 'w1', channelType: 'FIAT',
        supplementDispositionNo: 'RCD1', supplementEffectiveDate: '2026-09-01', wallet: { id: 'w1', asset: { type: 'FIAT' } } });
      jest.spyOn(service as any, 'processSignal').mockRejectedValue(new Error('Funds order fo-9 is FAILED'));
      await service.onSupplementDecided({ decision: 'APPROVED', entityRef: 'SIG1', approvalId: 'ap1', approvalNo: 'APR1' } as any);
      // 评审 Important 1（1）：失败路径下信号从未被翻成 PENDING_SCAN——不会被自助扫描误捡。
      expect(prisma.inboundTransferSignal.update).toHaveBeenCalledTimes(1);
      expect(prisma.inboundTransferSignal.update.mock.calls[0][0]).toMatchObject({ where: { id: 's1' }, data: { status: 'SUPPLEMENT_REJECTED' } });
      // 评审 Important 1（2）：解挂，让定性单不再悬空指向一个已死的信号。
      expect(reconDisposition.unlinkSupplement).toHaveBeenCalledWith('RCD1', 'SIG1');
      expect(reconDisposition.replaceSupplement).not.toHaveBeenCalled();
      const calls = auditLogsService.recordSystem.mock.calls.map((c: any[]) => c[0]);
      const actions = calls.map((c: any) => c.action);
      expect(actions).toContain('DEPOSIT_SUPPLEMENT_REJECTED');
      expect(actions).not.toContain('DEPOSIT_SUPPLEMENTED');
      const rejected = calls.find((c: any) => c.action === 'DEPOSIT_SUPPLEMENT_REJECTED');
      expect(rejected).toMatchObject({ approvalNo: 'APR1', outcome: 'FAILED', reasonCode: 'PAYIN_FAILED' });
    });

    it('拒绝：信号 → SUPPLEMENT_REJECTED，解挂，审计 REJECTED；不进通道', async () => {
      prisma.inboundTransferSignal.findUnique.mockResolvedValue({ id: 's1', signalNo: 'SIG1', status: 'SUPPLEMENT_PENDING', supplementDispositionNo: 'RCD1' });
      const spy = jest.spyOn(service as any, 'processSignal');
      await service.onSupplementDecided({ decision: 'DECLINED', entityRef: 'SIG1', approvalId: 'ap1', approvalNo: 'APR1' } as any);
      expect(spy).not.toHaveBeenCalled();
      expect(prisma.inboundTransferSignal.update.mock.calls[0][0].data.status).toBe('SUPPLEMENT_REJECTED');
      expect(reconDisposition.unlinkSupplement).toHaveBeenCalledWith('RCD1', 'SIG1');
    });
  });
});
