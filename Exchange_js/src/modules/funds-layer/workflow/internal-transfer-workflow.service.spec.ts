import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { WhitelistGuard } from '../guards/whitelist.guard';
import { InternalTransferService } from '../domain/internal-transfer.service';
import { FundsFlowService } from '../domain/funds-flow.service';
import { FundsAccountingService } from '../accounting/funds-accounting.service';
import { InternalTransferWorkflowService } from './internal-transfer-workflow.service';

describe('InternalTransferWorkflowService', () => {
  let service: InternalTransferWorkflowService;
  let transfers: any;
  let fundsFlow: any;
  let accounting: any;
  let auditLogsService: any;
  let txMock: any;

  beforeEach(async () => {
    txMock = { __tx: true };

    transfers = {
      createTransfer: jest.fn(),
    };
    fundsFlow = {
      createFromInternalTransaction: jest.fn().mockResolvedValue({ id: 'f1' }),
    };
    accounting = {
      applyAccounting: jest.fn().mockResolvedValue({ tbApplied: false }),
      mirrorPhysicalTransfer: jest.fn().mockResolvedValue({ tbApplied: false }),
    };
    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      recordSystem: jest.fn().mockResolvedValue({ id: 'audit-2' }),
    };
    const prisma = {
      $transaction: jest.fn((fn: any) => fn(txMock)),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        InternalTransferWorkflowService,
        { provide: PrismaService, useValue: prisma },
        { provide: WhitelistGuard, useValue: new WhitelistGuard() },
        { provide: InternalTransferService, useValue: transfers },
        { provide: FundsFlowService, useValue: fundsFlow },
        { provide: FundsAccountingService, useValue: accounting },
        { provide: AuditLogsService, useValue: auditLogsService },
      ],
    }).compile();

    service = moduleRef.get(InternalTransferWorkflowService);
    jest.clearAllMocks();
  });

  const baseInput = {
    sourceType: 'CRON_JOB',
    sourceId: 'job-1',
    sourceNo: 'JOB001',
    ownerType: 'CUSTOMER',
    ownerId: 'cust-1',
    ownerNo: 'C0001',
    assetId: 'asset-1',
    amount: '10',
    fromWalletId: 'w-from',
    toWalletId: 'w-to',
    triggerSource: 'CRON',
  };

  it('rejects a non-whitelisted path before creating anything', async () => {
    await expect(
      service.initiate({ ...baseInput, fromRole: 'C_DEP', toRole: 'F_LIQ' }),
    ).rejects.toThrow(/not a whitelisted/);

    expect(transfers.createTransfer).not.toHaveBeenCalled();
    expect(fundsFlow.createFromInternalTransaction).not.toHaveBeenCalled();
    expect(accounting.applyAccounting).not.toHaveBeenCalled();
    // automatic deny must be audited
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'TRANSFER_WHITELIST_REJECTED' }),
    );
  });

  it('happy path (AGGREGATE): creates transfer + funds flow + A-class accounting', async () => {
    transfers.createTransfer.mockResolvedValue({
      id: 't1',
      internalTxNo: 'ITX-1',
      traceId: 'tr',
      accountingClass: 'A',
    });

    const result = await service.initiate(
      { ...baseInput, fromRole: 'C_DEP', toRole: 'C_MAIN' },
      'SYSTEM',
    );

    expect(transfers.createTransfer).toHaveBeenCalledTimes(1);
    const [createArgs, operatorId, txArg] = transfers.createTransfer.mock.calls[0];
    expect(createArgs.path).toBe('CRYPTO_DEPOSIT_SWEEP');
    expect(createArgs.accountingClass).toBe('A');
    expect(operatorId).toBe('SYSTEM');
    expect(txArg).toBe(txMock);

    expect(fundsFlow.createFromInternalTransaction).toHaveBeenCalledWith(
      { internalTransactionId: 't1' },
      'SYSTEM',
      txMock,
    );
    // initiate no longer calls applyAccounting (mirror fires on CLEAR event instead)
    expect(accounting.applyAccounting).not.toHaveBeenCalled();

    // journey REQUESTED audit written by the workflow
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'REQUESTED',
        entityId: 't1',
        entityNo: 'ITX-1',
        traceId: 'tr',
      }),
      expect.any(Object),
      txMock,
    );

    expect(result.internalTxNo).toBe('ITX-1');
  });

  it('persists input.note as the REQUESTED audit reason when supplied', async () => {
    transfers.createTransfer.mockResolvedValue({
      id: 't1',
      internalTxNo: 'ITX-1',
      traceId: 'tr',
      accountingClass: 'A',
    });

    await service.initiate(
      { ...baseInput, fromRole: 'C_DEP', toRole: 'C_MAIN', note: 'payout aborted' },
      'ADMIN',
    );

    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'REQUESTED',
        reason: 'payout aborted',
      }),
      expect.any(Object),
      txMock,
    );
  });

  it('falls back to the default REQUESTED audit reason when no note is supplied', async () => {
    transfers.createTransfer.mockResolvedValue({
      id: 't1',
      internalTxNo: 'ITX-1',
      traceId: 'tr',
      accountingClass: 'A',
    });

    await service.initiate(
      { ...baseInput, fromRole: 'C_DEP', toRole: 'C_MAIN' },
      'SYSTEM',
    );

    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'REQUESTED',
        reason: 'Internal transfer requested on path CRYPTO_DEPOSIT_SWEEP',
      }),
      expect.any(Object),
      txMock,
    );
  });

  // neutered in Phase A (real-time inline accounting) — mirrorPhysicalTransfer is deprecated
  it('onFundsFlowStatusChanged is a no-op (neutered Phase A)', async () => {
    await expect(
      service.onFundsFlowStatusChanged({
        fundsFlowId: 'f1',
        internalTransferId: 't1',
        oldStatus: 'CONFIRMED',
        newStatus: 'CLEAR',
      }),
    ).resolves.toBeUndefined();

    expect(accounting.mirrorPhysicalTransfer).not.toHaveBeenCalled();
    expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
  });

  describe('Spec #4: INTERNAL_TRANSFER short-name audit actions', () => {
    it('emits REQUESTED short name on requestTransfer', async () => {
      transfers.createTransfer.mockResolvedValue({
        id: 't1',
        internalTxNo: 'ITX-1',
        traceId: 'tr',
        accountingClass: 'A',
      });

      await service.initiate(
        { ...baseInput, fromRole: 'C_DEP', toRole: 'C_MAIN' },
        'SYSTEM',
      );

      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REQUESTED' }),
        expect.anything(),
        expect.anything(),
      );
    });

    // neutered in Phase A — onFundsFlowStatusChanged is a no-op
    it('onFundsFlowStatusChanged CLEAR is a no-op (neutered Phase A)', async () => {
      await service.onFundsFlowStatusChanged({
        fundsFlowId: 'f1',
        internalTransferId: 't1',
        oldStatus: 'CONFIRMED',
        newStatus: 'CLEAR',
      });
      expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
    });

    it('onFundsFlowStatusChanged FAILED is a no-op (neutered Phase A)', async () => {
      await service.onFundsFlowStatusChanged({
        fundsFlowId: 'f1',
        internalTransferId: 't1',
        oldStatus: 'CONFIRMING',
        newStatus: 'FAILED',
      });
      expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
    });
  });
});
