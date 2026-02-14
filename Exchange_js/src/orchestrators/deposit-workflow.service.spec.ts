import { DepositWorkflowService } from './deposit-workflow.service';
import { DepositTransactionsService } from '../modules/trading/deposit-transactions/deposit-transactions.service';
import { JournalsService } from '../modules/accounting/journals/journals.service';
import { PayinsService } from '../modules/asset-treasury/payins/payins.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../core/prisma/prisma.service';
import {
  DepositOwnerType,
  DepositTransactionStatus,
} from '../modules/trading/deposit-transactions/dto/deposit-transaction.dto';
import { PayinStatus } from '../modules/asset-treasury/payins/dto/payin.dto';
import { TransactionComplianceService } from '../modules/risk-engine/transaction-compliance/transaction-compliance.service';

describe('DepositWorkflowService', () => {
  const mockDepositService = {
    updateStatus: jest.fn(),
    findOne: jest.fn(),
    createFromPayin: jest.fn(),
  };

  const mockJournalsService = {
    triggerEvent: jest.fn(),
    createJournal: jest.fn(),
    reverseJournal: jest.fn(),
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
    ensureDepositComplianceCases: jest.fn(),
  };

  const mockTx = {
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
      mockJournalsService as unknown as JournalsService,
      mockPayinsService as unknown as PayinsService,
      mockEventEmitter as unknown as EventEmitter2,
      mockPrisma as unknown as PrismaService,
      mockTransactionComplianceService as unknown as TransactionComplianceService,
    );
  });

  it('payin confirmed should trigger DEPOSIT COMPLIANCE_PENDING accounting via triggerEvent', async () => {
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
    mockJournalsService.triggerEvent.mockResolvedValue({ id: 'je-1' });
    mockPayinsService.updateStatus.mockResolvedValue({ status: PayinStatus.CLEARED });

    const result = await service.handlePayinStatusChanged({
      payinId: 'payin-1',
      newStatus: PayinStatus.CONFIRMED,
    } as any);

    expect(mockJournalsService.triggerEvent).toHaveBeenCalledTimes(1);
    const [eventParams] = mockJournalsService.triggerEvent.mock.calls[0];
    expect(eventParams).toMatchObject({
      entityType: 'DEPOSIT',
      triggerKey: 'status',
      fromStatus: DepositTransactionStatus.PAYIN_PENDING,
      toStatus: DepositTransactionStatus.COMPLIANCE_PENDING,
      assetType: 'CRYPTO',
      sourceId: 'dep-1',
    });
    expect(mockJournalsService.createJournal).not.toHaveBeenCalled();
    expect(mockJournalsService.reverseJournal).not.toHaveBeenCalled();
    expect(
      mockTransactionComplianceService.ensureDepositComplianceCases,
    ).toHaveBeenCalledWith('dep-1');
    expect(result?.created_or_reversed_journal_entry_ids).toEqual(['je-1']);
  });

  it('deposit success should trigger DEPOSIT SUCCESS accounting via triggerEvent', async () => {
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
    mockJournalsService.triggerEvent.mockResolvedValue({ id: 'je-2' });

    await service.handleDepositStatusChanged({
      depositId: 'dep-2',
      oldStatus: DepositTransactionStatus.UNDER_REVIEW,
      newStatus: DepositTransactionStatus.SUCCESS,
      payinId: 'payin-2',
    } as any);

    expect(mockJournalsService.triggerEvent).toHaveBeenCalledTimes(1);
    const [eventParams] = mockJournalsService.triggerEvent.mock.calls[0];
    expect(eventParams).toMatchObject({
      entityType: 'DEPOSIT',
      triggerKey: 'status',
      fromStatus: DepositTransactionStatus.UNDER_REVIEW,
      toStatus: DepositTransactionStatus.SUCCESS,
      assetType: 'FIAT',
      sourceId: 'dep-2',
    });
    expect(mockJournalsService.createJournal).not.toHaveBeenCalled();
    expect(mockJournalsService.reverseJournal).not.toHaveBeenCalled();
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
    expect(mockJournalsService.triggerEvent).not.toHaveBeenCalled();
    expect(mockJournalsService.reverseJournal).not.toHaveBeenCalled();
    expect(mockTx.payin.update).toHaveBeenCalledWith({
      where: { id: 'payin-3' },
      data: expect.objectContaining({
        status: PayinStatus.CLEARED,
      }),
    });
    expect(result?.updated_payin_status).toBe(PayinStatus.CLEARED);
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

    expect(mockJournalsService.triggerEvent).not.toHaveBeenCalled();
    expect(
      mockTransactionComplianceService.ensureDepositComplianceCases,
    ).toHaveBeenCalledWith('dep-4');
  });
});
