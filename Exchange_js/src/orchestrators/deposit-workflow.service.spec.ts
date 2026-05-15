import { DepositWorkflowService } from './deposit-workflow.service';
import { DepositTransactionsService } from '../modules/trading/deposit-transactions/deposit-transactions.service';
import { PayinsService } from '../modules/asset-treasury/payins/payins.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../core/prisma/prisma.service';
import {
  DepositOwnerType,
  DepositTransactionStatus,
} from '../modules/trading/deposit-transactions/dto/deposit-transaction.dto';
import { PayinStatus } from '../modules/asset-treasury/payins/dto/payin.dto';
import { TransactionComplianceService } from '../modules/risk-engine/transaction-compliance/transaction-compliance.service';
import { AuditActions } from '../modules/audit-logging/constants/audit-actions.constant';

describe('DepositWorkflowService', () => {
  const mockDepositService = {
    updateStatus: jest.fn(),
    findOne: jest.fn(),
    createFromPayin: jest.fn(),
  };

  const mockPayinsService = {
    findOne: jest.fn(),
    updateStatus: jest.fn(),
    linkDeposit: jest.fn(),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  const mockTransactionComplianceService = {
    ensureDepositMainCasesOnPayinConfirmed: jest.fn(),
    ensureInteractiveDepositMainCasesOnPayinConfirmed: jest.fn(),
  };

  const mockTx = {
    auditLogEvent: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve(data)),
    },
    depositTransaction: {
      findUnique: jest.fn(),
    },
    payin: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    payinAuditLog: {
      create: jest.fn(),
    },
  };

  const mockPrisma = {
    auditLogEvent: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve(data)),
    },
    acctEvent: {
      findFirst: jest.fn(),
    },
    depositTransaction: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(async (callback: (tx: any) => Promise<any>) =>
      callback(mockTx),
    ),
  };

  let service: DepositWorkflowService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DepositWorkflowService(
      mockDepositService as unknown as DepositTransactionsService,
      mockPayinsService as unknown as PayinsService,
      mockEventEmitter as unknown as EventEmitter2,
      mockPrisma as unknown as PrismaService,
      mockTransactionComplianceService as unknown as TransactionComplianceService,
      {} as any,
    );
  });

  it('payin confirmed should record accounting blocked (V2 accounting removed)', async () => {
    mockPrisma.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-1',
      status: DepositTransactionStatus.PAYIN_PENDING,
      ownerType: DepositOwnerType.CUSTOMER,
      ownerId: 'cust-1',
      assetId: 'asset-1',
      amount: { toString: () => '100.00' },
      depositNo: 'DEP001',
      toWalletId: 'wallet-1',
    });
    mockPayinsService.findOne.mockResolvedValue({
      id: 'payin-1',
      status: PayinStatus.CONFIRMED,
      type: 'crypto',
    });
    mockDepositService.updateStatus.mockResolvedValue({
      status: DepositTransactionStatus.COMPLIANCE_PENDING,
    });

    const result = await service.handlePayinStatusChanged({
      payinId: 'payin-1',
      newStatus: PayinStatus.CONFIRMED,
    } as any);

    expect(
      mockTransactionComplianceService.ensureDepositMainCasesOnPayinConfirmed,
    ).toHaveBeenCalledWith('dep-1', 'payin-1');
    // V2 accounting removed — always returns blocked
    expect(result?.created_or_reversed_journal_entry_ids).toEqual([]);
  });

  it('fiat payin confirmed should invoke tx-case hook as no-op', async () => {
    mockPrisma.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-fiat-1',
      status: DepositTransactionStatus.PAYIN_PENDING,
      ownerType: DepositOwnerType.CUSTOMER,
      ownerId: 'cust-1',
      assetId: 'asset-fiat-1',
      amount: { toString: () => '100.00' },
      depositNo: 'DEPFIAT001',
      toWalletId: 'wallet-fiat-1',
    });
    mockPayinsService.findOne.mockResolvedValue({
      id: 'payin-fiat-1',
      status: PayinStatus.CONFIRMED,
      type: 'fiat',
    });
    mockDepositService.updateStatus.mockResolvedValue({
      status: DepositTransactionStatus.COMPLIANCE_PENDING,
    });
    mockPayinsService.updateStatus.mockResolvedValue({ status: PayinStatus.CLEARED });
    mockTransactionComplianceService.ensureDepositMainCasesOnPayinConfirmed.mockResolvedValue(
      null,
    );

    await service.handlePayinStatusChanged({
      payinId: 'payin-fiat-1',
      newStatus: PayinStatus.CONFIRMED,
    } as any);

    expect(
      mockTransactionComplianceService.ensureDepositMainCasesOnPayinConfirmed,
    ).toHaveBeenCalledWith('dep-fiat-1', 'payin-fiat-1');
  });

  it('interactive payin confirm should create pending compliance containers instead of auto-mock completion', async () => {
    mockPrisma.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-interactive-1',
      status: DepositTransactionStatus.PAYIN_PENDING,
      ownerType: DepositOwnerType.CUSTOMER,
      ownerId: 'cust-1',
      assetId: 'asset-1',
      amount: { toString: () => '100.00' },
      depositNo: 'DEP-INTERACTIVE-1',
      toWalletId: 'wallet-1',
    });
    mockPayinsService.findOne.mockResolvedValue({
      id: 'payin-interactive-1',
      status: PayinStatus.CONFIRMED,
      type: 'crypto',
      payinNo: 'PI-INTERACTIVE-1',
    });
    mockDepositService.updateStatus.mockResolvedValue({
      status: DepositTransactionStatus.COMPLIANCE_PENDING,
    });
    mockPayinsService.updateStatus.mockResolvedValue({ status: PayinStatus.CLEARED });
    mockTransactionComplianceService.ensureInteractiveDepositMainCasesOnPayinConfirmed.mockResolvedValue(
      null,
    );

    await service.handlePayinStatusChanged({
      payinId: 'payin-interactive-1',
      newStatus: PayinStatus.CONFIRMED,
      simulationMode: 'INTERACTIVE',
    } as any);

    expect(
      mockTransactionComplianceService.ensureInteractiveDepositMainCasesOnPayinConfirmed,
    ).toHaveBeenCalledWith('dep-interactive-1', 'payin-interactive-1');
    expect(
      mockTransactionComplianceService.ensureDepositMainCasesOnPayinConfirmed,
    ).not.toHaveBeenCalledWith('dep-interactive-1', 'payin-interactive-1');
  });

  it('deposit success should record accounting blocked (V2 accounting removed)', async () => {
    mockDepositService.findOne.mockResolvedValue({
      id: 'dep-2',
      status: DepositTransactionStatus.SUCCESS,
      ownerType: DepositOwnerType.CUSTOMER,
      ownerId: 'cust-2',
      assetId: 'asset-2',
      amount: { toString: () => '55.50' },
      depositNo: 'DEP002',
      toWalletId: 'wallet-2',
      payinId: 'payin-2',
    });
    mockPayinsService.findOne.mockResolvedValue({
      id: 'payin-2',
      type: 'fiat',
      status: PayinStatus.CLEARED,
    });

    const result = await service.handleDepositStatusChanged({
      depositId: 'dep-2',
      oldStatus: DepositTransactionStatus.UNDER_REVIEW,
      newStatus: DepositTransactionStatus.SUCCESS,
      payinId: 'payin-2',
    } as any);

    // V2 accounting removed — no journal entries created
    expect(result?.created_or_reversed_journal_entry_ids).toEqual([]);
    expect(result?.updated_deposit_status).toBe(DepositTransactionStatus.SUCCESS);
  });

  it('deposit rejected should not post accounting but still clear payin', async () => {
    mockTx.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-3',
      payinId: 'payin-3',
    });
    mockTx.payin.findUnique.mockResolvedValue({
      id: 'payin-3',
      status: PayinStatus.CONFIRMED,
      statusHistory: '[]',
    });
    mockTx.payin.update.mockResolvedValue({ status: PayinStatus.CLEARED });
    mockTx.payinAuditLog.create.mockResolvedValue({ id: 'audit-1' });

    const result = await service.handleDepositStatusChanged({
      depositId: 'dep-3',
      oldStatus: DepositTransactionStatus.COMPLIANCE_PENDING,
      newStatus: DepositTransactionStatus.REJECTED,
      payinId: 'payin-3',
    } as any);

    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockTx.payin.update).toHaveBeenCalledWith({
      where: { id: 'payin-3' },
      data: expect.objectContaining({
        status: PayinStatus.CLEARED,
      }),
    });
    expect(result?.updated_payin_status).toBe(PayinStatus.CLEARED);
  });

  it('payin confirmed should record accounting blocked (V2 accounting removed) and keep payin uncleared', async () => {
    mockPrisma.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-block-1',
      status: DepositTransactionStatus.PAYIN_PENDING,
      ownerType: DepositOwnerType.CUSTOMER,
      ownerId: 'cust-1',
      assetId: 'asset-1',
      amount: { toString: () => '10.00' },
      depositNo: 'DEP-BLOCK-1',
      toWalletId: 'wallet-1',
    });
    mockPayinsService.findOne.mockResolvedValue({
      id: 'payin-block-1',
      status: PayinStatus.CONFIRMED,
      type: 'crypto',
    });
    mockDepositService.updateStatus.mockResolvedValue({
      status: DepositTransactionStatus.COMPLIANCE_PENDING,
    });

    const result = await service.handlePayinStatusChanged({
      payinId: 'payin-block-1',
      newStatus: PayinStatus.CONFIRMED,
    } as any);

    expect(mockPrisma.auditLogEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: AuditActions.DEPOSIT_ACCOUNTING_BLOCKED,
        }),
      }),
    );
    expect(result?.updated_deposit_status).toBe(
      DepositTransactionStatus.COMPLIANCE_PENDING,
    );
    expect(result?.updated_payin_status).toBeUndefined();
  });

  it('deposit success should record accounting blocked when posting returns null', async () => {
    mockDepositService.findOne.mockResolvedValue({
      id: 'dep-success-block',
      status: DepositTransactionStatus.SUCCESS,
      ownerType: DepositOwnerType.CUSTOMER,
      ownerId: 'cust-2',
      assetId: 'asset-2',
      amount: { toString: () => '55.50' },
      depositNo: 'DEP-S-BLOCK',
      toWalletId: 'wallet-2',
      payinId: 'payin-success-block',
    });
    mockPayinsService.findOne.mockResolvedValue({
      id: 'payin-success-block',
      type: 'fiat',
      status: PayinStatus.CLEARED,
    });
    const result = await service.handleDepositStatusChanged({
      depositId: 'dep-success-block',
      oldStatus: DepositTransactionStatus.UNDER_REVIEW,
      newStatus: DepositTransactionStatus.SUCCESS,
      payinId: 'payin-success-block',
    } as any);

    expect(mockPrisma.auditLogEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: AuditActions.DEPOSIT_ACCOUNTING_BLOCKED,
        }),
      }),
    );
    expect(result?.created_or_reversed_journal_entry_ids).toEqual([]);
    expect(result?.updated_deposit_status).toBe(DepositTransactionStatus.SUCCESS);
  });

  it('non-customer deposit should not trigger accounting on payin confirmed', async () => {
    mockPrisma.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-4',
      status: DepositTransactionStatus.PAYIN_PENDING,
      ownerType: DepositOwnerType.LP,
      ownerId: 'lp-1',
      assetId: 'asset-3',
      amount: { toString: () => '90.00' },
      depositNo: 'DEP004',
      toWalletId: 'wallet-3',
    });
    mockPayinsService.findOne.mockResolvedValue({
      id: 'payin-4',
      status: PayinStatus.CONFIRMED,
      type: 'crypto',
    });
    mockDepositService.updateStatus.mockResolvedValue({
      status: DepositTransactionStatus.COMPLIANCE_PENDING,
    });
    mockPayinsService.updateStatus.mockResolvedValue({ status: PayinStatus.CLEARED });

    await service.handlePayinStatusChanged({
      payinId: 'payin-4',
      newStatus: PayinStatus.CONFIRMED,
    } as any);

    expect(
      mockTransactionComplianceService.ensureDepositMainCasesOnPayinConfirmed,
    ).toHaveBeenCalledWith('dep-4', 'payin-4');
  });
});
