import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PayoutsService } from './payouts.service';
import {
  PayoutAction,
  PayoutStatus,
  PayoutType,
} from './dto/payout.dto';
import { PayoutEvents } from './constants/payout-events.constant';

jest.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}));

describe('PayoutsService', () => {
  let service: PayoutsService;
  let prisma: any;
  let eventEmitter: { emit: jest.Mock };
  let transactionComplianceService: any;
  let pricingCenterService: any;
  let feeOccurrencesService: any;

  beforeEach(() => {
    prisma = {
      auditLogEvent: {
        findMany: jest.fn(),
      },
      payout: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      feeOccurrence: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      payoutAuditLog: {
        create: jest.fn(),
      },
      withdrawTransaction: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    eventEmitter = {
      emit: jest.fn(),
    };
    transactionComplianceService = {
      ensureWithdrawMainCasesBeforePayoutDispatch: jest.fn(),
    };
    pricingCenterService = {
      assertWithdrawExtremeVolatilityNotBlocked: jest.fn(),
    };
    feeOccurrencesService = {
      captureFromPayout: jest.fn().mockResolvedValue([]),
    };
    service = new PayoutsService(
      prisma,
      eventEmitter as unknown as EventEmitter2,
      transactionComplianceService,
      pricingCenterService,
      feeOccurrencesService,
    );
    (service as any).auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue({ id: 'audit-log-1' }),
      recordSystem: jest.fn().mockResolvedValue({ id: 'audit-log-1' }),
    };
    jest.clearAllMocks();
    pricingCenterService.assertWithdrawExtremeVolatilityNotBlocked.mockResolvedValue(
      undefined,
    );
    prisma.auditLogEvent.findMany.mockResolvedValue([]);
  });

  it('should emit payout failed event after commit', async () => {
    prisma.payout.findUnique.mockResolvedValue({
      id: 'PO_1',
      withdrawId: 'WD_1',
      type: PayoutType.FIAT,
      status: PayoutStatus.CONFIRMING,
      statusHistory: '[]',
      sentAt: null,
    });
    prisma.payout.update.mockResolvedValue({
      id: 'PO_1',
      status: PayoutStatus.FAILED,
    });
    prisma.payoutAuditLog.create.mockResolvedValue({ id: 'audit_1' });

    const updated = await service.updateStatus(
      'PO_1',
      { action: PayoutAction.FAIL },
      'SYSTEM',
    );

    expect(updated.status).toBe(PayoutStatus.FAILED);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      PayoutEvents.EVT_PAYOUT_FAILED,
      expect.objectContaining({
        payoutId: 'PO_1',
        withdrawId: 'WD_1',
        status: PayoutStatus.FAILED,
      }),
    );
  });

  it('should allow crypto payout dispatch without legacy withdraw final gate blocking', async () => {
    prisma.payout.findUnique.mockResolvedValue({
      id: 'PO_gate_1',
      payoutNo: 'POGATE1',
      ownerId: 'CUST_1',
      withdrawId: 'WD_gate_1',
      type: PayoutType.CRYPTO,
      status: PayoutStatus.CREATED,
      statusHistory: '[]',
      sentAt: null,
      withdraw: {
        id: 'WD_gate_1',
        ownerId: 'CUST_1',
        ownerNo: 'CU_0001',
        asset: {
          type: 'CRYPTO',
        },
      },
    });
    prisma.payout.update.mockResolvedValue({
      id: 'PO_gate_1',
      status: PayoutStatus.SIGNING,
    });
    prisma.payoutAuditLog.create.mockResolvedValue({ id: 'audit-gate-1' });

    const updated = await service.updateStatus(
      'PO_gate_1',
      { action: PayoutAction.SIGN },
      'SYSTEM',
    );

    expect(updated.status).toBe(PayoutStatus.SIGNING);
    expect(
      transactionComplianceService.ensureWithdrawMainCasesBeforePayoutDispatch,
    ).not.toHaveBeenCalled();
    expect(prisma.payout.update).toHaveBeenCalled();
  });

  it('should block payout dispatch when extreme volatility restriction is enabled', async () => {
    prisma.payout.findUnique.mockResolvedValue({
      id: 'PO_gate_2',
      payoutNo: 'POGATE2',
      ownerId: 'CUST_1',
      assetId: 'asset-btc',
      withdrawId: 'WD_gate_2',
      type: PayoutType.CRYPTO,
      status: PayoutStatus.CREATED,
      statusHistory: '[]',
      sentAt: null,
      withdraw: {
        id: 'WD_gate_2',
        ownerId: 'CUST_1',
        ownerNo: 'CU_0001',
        asset: {
          type: 'CRYPTO',
        },
      },
    });
    pricingCenterService.assertWithdrawExtremeVolatilityNotBlocked.mockRejectedValue(
      new BadRequestException({
        code: 'WITHDRAW_EXTREME_VOLATILITY_BLOCKED',
      }),
    );

    await expect(
      service.updateStatus(
        'PO_gate_2',
        { action: PayoutAction.SIGN },
        'SYSTEM',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'WITHDRAW_EXTREME_VOLATILITY_BLOCKED',
      }),
    });

    expect(
      transactionComplianceService.ensureWithdrawMainCasesBeforePayoutDispatch,
    ).not.toHaveBeenCalled();
    expect(prisma.payout.update).not.toHaveBeenCalled();
  });

  it('should block admin direct CLEAR action', async () => {
    await expect(
      service.updateStatus(
        'PO_clear_1',
        { action: PayoutAction.CLEAR },
        'admin-1',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'PAYOUT_CLEAR_SYSTEM_ONLY',
      }),
    });
  });

  it('should run payout status updates with extended transaction timeout', async () => {
    prisma.payout.findUnique.mockResolvedValue({
      id: 'PO_timeout_1',
      payoutNo: 'POTIMEOUT1',
      ownerId: 'CUST_1',
      assetId: 'asset-btc',
      withdrawId: 'WD_timeout_1',
      type: PayoutType.CRYPTO,
      status: PayoutStatus.CREATED,
      statusHistory: '[]',
      sentAt: null,
      withdraw: {
        id: 'WD_timeout_1',
        ownerId: 'CUST_1',
        ownerNo: 'CU_0001',
        asset: {
          type: 'CRYPTO',
        },
      },
    });
    prisma.payout.update.mockResolvedValue({
      id: 'PO_timeout_1',
      status: PayoutStatus.SIGNING,
    });

    await service.updateStatus(
      'PO_timeout_1',
      { action: PayoutAction.SIGN },
      'SYSTEM',
    );

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        timeout: 15000,
      }),
    );
  });

  it('should allow system CLEAR action', async () => {
    prisma.payout.findUnique.mockResolvedValue({
      id: 'PO_clear_2',
      withdrawId: 'WD_2',
      type: PayoutType.FIAT,
      status: PayoutStatus.CONFIRMED,
      statusHistory: '[]',
      sentAt: new Date(),
    });
    prisma.payout.update.mockResolvedValue({
      id: 'PO_clear_2',
      status: PayoutStatus.CLEARED,
    });

    const updated = await service.updateStatus(
      'PO_clear_2',
      { action: PayoutAction.CLEAR },
      'SYSTEM',
    );

    expect(updated.status).toBe(PayoutStatus.CLEARED);
  });

  it('should auto-generate referenceNo when confirming fiat payout without one', async () => {
    prisma.payout.findUnique.mockResolvedValue({
      id: 'PO_fiat_confirm_1',
      payoutNo: 'POFIAT1',
      withdrawId: 'WD_fiat_confirm_1',
      type: PayoutType.FIAT,
      status: PayoutStatus.CONFIRMING,
      statusHistory: '[]',
      sentAt: new Date(),
      referenceNo: null,
    });

    prisma.payout.update.mockResolvedValue({
      id: 'PO_fiat_confirm_1',
      status: PayoutStatus.CONFIRMED,
      referenceNo: 'BANK-POFIAT1',
    });

    const updated = await service.updateStatus(
      'PO_fiat_confirm_1',
      { action: PayoutAction.CONFIRM },
      'SYSTEM',
    );

    expect(updated.status).toBe(PayoutStatus.CONFIRMED);
    expect(prisma.payout.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          referenceNo: 'BANK-POFIAT1',
        }),
      }),
    );
  });

  it('should allow fiat confirm when referenceNo is already stored', async () => {
    prisma.payout.findUnique.mockResolvedValue({
      id: 'PO_fiat_confirm_2',
      payoutNo: 'POFIAT2',
      withdrawId: 'WD_fiat_confirm_2',
      type: PayoutType.FIAT,
      status: PayoutStatus.CONFIRMING,
      statusHistory: '[]',
      sentAt: new Date(),
      referenceNo: 'BANK-REF-001',
    });
    prisma.payout.update.mockResolvedValue({
      id: 'PO_fiat_confirm_2',
      status: PayoutStatus.CONFIRMED,
      referenceNo: 'BANK-REF-001',
    });

    const updated = await service.updateStatus(
      'PO_fiat_confirm_2',
      { action: PayoutAction.CONFIRM },
      'SYSTEM',
    );

    expect(updated.status).toBe(PayoutStatus.CONFIRMED);
    expect(prisma.payout.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          referenceNo: 'BANK-REF-001',
        }),
      }),
    );
  });

  it('should capture payout fee occurrences on confirmed', async () => {
    prisma.payout.findUnique.mockResolvedValue({
      id: 'PO_crypto_confirm_1',
      payoutNo: 'POC1',
      withdrawId: 'WD_crypto_confirm_1',
      ownerId: 'CUST_1',
      assetId: 'asset-usdt',
      type: PayoutType.CRYPTO,
      status: PayoutStatus.CONFIRMING,
      statusHistory: '[]',
      sentAt: new Date(),
      referenceNo: null,
      withdraw: {
        id: 'WD_crypto_confirm_1',
        ownerId: 'CUST_1',
        ownerNo: 'CU_0001',
        fromWalletId: 'wallet-pay-1',
        asset: {
          type: 'CRYPTO',
        },
      },
    });
    prisma.payout.update.mockResolvedValue({
      id: 'PO_crypto_confirm_1',
      payoutNo: 'POC1',
      status: PayoutStatus.CONFIRMED,
      withdrawId: 'WD_crypto_confirm_1',
      assetId: 'asset-usdt',
      type: PayoutType.CRYPTO,
      referenceNo: null,
      txHash: '0xhash',
      providerTxnId: null,
      fromAddress: 'Tsource',
      fromIban: null,
      withdraw: {
        id: 'WD_crypto_confirm_1',
        withdrawNo: 'WD-C1',
        fromWalletId: 'wallet-pay-1',
      },
      asset: { id: 'asset-usdt', code: 'USDT', type: 'CRYPTO', network: 'TRON', decimals: 6 },
    });

    const updated = await service.updateStatus(
      'PO_crypto_confirm_1',
      { action: PayoutAction.CONFIRM, txHash: '0xhash' },
      'SYSTEM',
    );

    expect(updated.status).toBe(PayoutStatus.CONFIRMED);
    expect(feeOccurrencesService.captureFromPayout).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'PO_crypto_confirm_1',
      }),
      'SYSTEM',
      prisma,
    );
  });

  it('should return canonical audit logs in payout detail payload', async () => {
    prisma.payout.findUnique.mockResolvedValue({
      id: 'PO_detail_1',
      payoutNo: 'PODET1',
      withdrawId: 'WD_detail_1',
      type: PayoutType.FIAT,
      status: 'CLEAR',
      asset: { code: 'AED', type: 'FIAT', network: null },
      withdraw: { withdrawNo: 'WDDET1', ownerId: 'CUST_1', status: 'SUCCESS' },
      customer: null,
      clearings: [],
      feeOccurrences: [
        {
          id: 'fee-1',
          feeNo: 'FEE-1',
          feeType: 'BANK_TRANSFER_FEE',
          amount: '12.50',
        },
      ],
    });
    prisma.auditLogEvent.findMany.mockResolvedValue([
      {
        id: 'audit-payout-1',
        action: 'PAYOUT_CONFIRMED_TO_CLEAR',
        statusFrom: 'CONFIRMED',
        statusTo: 'CLEAR',
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        reason: 'closeout',
        occurredAt: '2026-03-28T11:00:00.000Z',
        module: 'asset-treasury/payouts',
        result: 'SUCCESS',
      },
    ]);

    const result = await service.findOne('PO_detail_1');

    expect(result.auditLogs).toEqual([
      expect.objectContaining({
        id: 'audit-payout-1',
        action: 'PAYOUT_CONFIRMED_TO_CLEAR',
        oldStatus: 'CONFIRMED',
        newStatus: 'CLEARED',
        operatorId: 'SYSTEM',
      }),
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        ownerNo: null,
        transactionType: 'WITHDRAW',
        transactionId: 'WD_detail_1',
        transactionNo: 'WDDET1',
        type: 'FIAT',
        status: 'CLEARED',
        displayStatus: 'CLEARED',
        feeOccurrences: [
          expect.objectContaining({
            id: 'fee-1',
            feeType: 'BANK_TRANSFER_FEE',
          }),
        ],
      }),
    );
  });

  it('should expand canonical CLEARED filter to match legacy CLEAR rows', async () => {
    prisma.payout.findMany.mockResolvedValue([]);
    prisma.payout.count.mockResolvedValue(0);

    await service.findAll({ status: PayoutStatus.CLEARED });

    expect(prisma.payout.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: expect.objectContaining({
            in: [PayoutStatus.CLEARED, 'CLEAR'],
          }),
        }),
      }),
    );
  });

  it('should return normalized admin fields in payout list', async () => {
    prisma.payout.findMany.mockResolvedValue([
      {
        id: 'PO_list_1',
        payoutNo: 'POLIST1',
        withdrawId: 'WD_list_1',
        type: PayoutType.CRYPTO,
        status: 'CLEAR',
        amount: '10.50',
        assetId: 'asset-usdt',
        asset: { code: 'USDT', type: 'CRYPTO', network: 'TRON', decimals: 6 },
        toAddress: 'Tdest',
        toIban: null,
        txHash: '0xhash',
        referenceNo: null,
        providerTxnId: null,
        createdAt: '2026-03-28T12:00:00.000Z',
        sentAt: null,
        completedAt: null,
        withdraw: {
          withdrawNo: 'WDLIST1',
          ownerNo: 'CU0003',
        },
        customer: null,
      },
    ]);
    prisma.payout.count.mockResolvedValue(1);

    const result = await service.findAll({});

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        ownerNo: 'CU0003',
        transactionType: 'WITHDRAW',
        transactionId: 'WD_list_1',
        transactionNo: 'WDLIST1',
        type: 'CRYPTO',
        status: 'CLEARED',
        displayStatus: 'CLEARED',
      }),
    );
  });

  it('should not emit payout events when external tx is provided', async () => {
    const txClient: any = {
      payout: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'PO_2',
          withdrawId: 'WD_2',
          type: PayoutType.FIAT,
          status: PayoutStatus.CONFIRMED,
          statusHistory: '[]',
          sentAt: new Date(),
        }),
        update: jest.fn().mockResolvedValue({
          id: 'PO_2',
          status: PayoutStatus.RETURNED,
        }),
      },
      payoutAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit_2' }),
      },
    };

    const updated = await service.updateStatus(
      'PO_2',
      { action: PayoutAction.RETURN },
      'SYSTEM',
      txClient,
    );

    expect(updated.status).toBe(PayoutStatus.RETURNED);
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('should populate ownerId from withdraw when creating payout', async () => {
    prisma.payout.findUnique.mockResolvedValue(null);
    prisma.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'WD_3',
      ownerId: 'CUST_3',
    });
    prisma.payout.create.mockResolvedValue({
      id: 'PO_3',
      payoutNo: 'PO0003',
      ownerId: 'CUST_3',
      withdrawId: 'WD_3',
    });
    prisma.payoutAuditLog.create.mockResolvedValue({ id: 'audit_3' });

    await service.create(
      {
        withdrawId: 'WD_3',
        type: PayoutType.CRYPTO,
        amount: 100,
        assetId: 'AST_1',
      },
      'SYSTEM',
    );

    expect(prisma.payout.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: 'CUST_3',
        }),
      }),
    );
  });

  it('should return existing payout for same withdrawId', async () => {
    const existing = {
      id: 'PO_EXIST',
      withdrawId: 'WD_EXIST',
    };
    prisma.payout.findUnique.mockResolvedValue(existing);

    const created = await service.create(
      {
        withdrawId: 'WD_EXIST',
        type: PayoutType.FIAT,
        amount: 10,
        assetId: 'AST_2',
      },
      'SYSTEM',
    );

    expect(created).toBe(existing);
    expect(prisma.payout.create).not.toHaveBeenCalled();
  });
});
