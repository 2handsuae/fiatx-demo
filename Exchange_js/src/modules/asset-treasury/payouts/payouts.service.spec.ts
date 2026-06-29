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
  let walletBalance: any;

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
      payoutAuditLog: {
        create: jest.fn(),
      },
      withdrawTransaction: {
        findUnique: jest.fn(),
      },
      wallet: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    eventEmitter = {
      emit: jest.fn(),
    };
    walletBalance = { adjust: jest.fn().mockResolvedValue(undefined) };
    service = new PayoutsService(
      prisma,
      eventEmitter as unknown as EventEmitter2,
      {} as any,
      walletBalance as any,
    );
    (service as any).auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue({ id: 'audit-log-1' }),
      recordSystem: jest.fn().mockResolvedValue({ id: 'audit-log-1' }),
    };
    jest.clearAllMocks();
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
    expect(prisma.payout.update).toHaveBeenCalled();
  });

  // Legacy extreme volatility check removed — no longer applies.

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
      payoutNo: 'POCLEAR2',
      withdrawId: 'WD_2',
      type: PayoutType.FIAT,
      status: PayoutStatus.CONFIRMED,
      statusHistory: '[]',
      sentAt: new Date(),
      // R3 invariant: CLEARED rows must carry referenceNo (FIAT) — pre-populated by CONFIRM upstream.
      referenceNo: 'BANK-POCLEAR2',
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

  // ── REORG transition ──────────────────────────────────────────────────────

  it('REORG: CONFIRMING + PayoutAction.REORG → payout.update receives status BROADCASTED', async () => {
    prisma.payout.findUnique.mockResolvedValue({
      id: 'PO_REORG_1',
      payoutNo: 'POREORG1',
      ownerId: 'CUST_1',
      withdrawId: 'WD_REORG_1',
      type: PayoutType.CRYPTO,
      status: PayoutStatus.CONFIRMING,
      statusHistory: '[]',
      sentAt: new Date(),
    });
    prisma.payout.update.mockResolvedValue({
      id: 'PO_REORG_1',
      status: PayoutStatus.BROADCASTED,
    });

    const updated = await service.updateStatus(
      'PO_REORG_1',
      { action: PayoutAction.REORG },
      'SYSTEM',
    );

    expect(updated.status).toBe(PayoutStatus.BROADCASTED);
    expect(prisma.payout.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: PayoutStatus.BROADCASTED }),
      }),
    );
  });

  // ── source-wallet snapshot on create ────────────────────────────────────

  it('create snapshot crypto: wallet.findFirst(C_OUT, PLATFORM) → payout.create data.fromAddress = Txyz', async () => {
    prisma.payout.findUnique.mockResolvedValue(null);
    prisma.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'WD_SNAP_C',
      ownerId: 'CUST_SNAP',
    });
    prisma.wallet = {
      findFirst: jest.fn().mockResolvedValue({ address: 'Txyz' }),
    };
    prisma.payout.create.mockResolvedValue({
      id: 'PO_SNAP_C',
      payoutNo: 'POSNAPC',
      ownerId: 'CUST_SNAP',
      withdrawId: 'WD_SNAP_C',
      fromAddress: 'Txyz',
      fromIban: null,
    });

    await service.create(
      {
        withdrawId: 'WD_SNAP_C',
        type: PayoutType.CRYPTO,
        amount: 50,
        assetId: 'asset-btc',
      },
      'SYSTEM',
    );

    expect(prisma.wallet.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          walletRole: 'C_OUT',
          ownerType: 'PLATFORM',
          status: 'ACTIVE',
        }),
      }),
    );
    expect(prisma.payout.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fromAddress: 'Txyz' }),
      }),
    );
  });

  it('create snapshot fiat: wallet.findFirst(C_VIBAN, CUSTOMER) → payout.create data.fromIban = AE07X', async () => {
    prisma.payout.findUnique.mockResolvedValue(null);
    prisma.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'WD_SNAP_F',
      ownerId: 'CUST_FIAT',
    });
    prisma.wallet = {
      findFirst: jest.fn().mockResolvedValue({ iban: 'AE07X' }),
    };
    prisma.payout.create.mockResolvedValue({
      id: 'PO_SNAP_F',
      payoutNo: 'POSNAPF',
      ownerId: 'CUST_FIAT',
      withdrawId: 'WD_SNAP_F',
      fromAddress: null,
      fromIban: 'AE07X',
    });

    await service.create(
      {
        withdrawId: 'WD_SNAP_F',
        type: PayoutType.FIAT,
        amount: 100,
        assetId: 'asset-aed',
      },
      'SYSTEM',
    );

    expect(prisma.wallet.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          walletRole: 'C_VIBAN',
          ownerType: 'CUSTOMER',
          ownerId: 'CUST_FIAT',
          status: 'ACTIVE',
        }),
      }),
    );
    expect(prisma.payout.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fromIban: 'AE07X' }),
      }),
    );
  });

  // ── detail fallback: resolve fromIban without update ────────────────────

  it('detail fallback: fromIban null fiat row → resolved from wallet, payout.update NOT called', async () => {
    prisma.payout.findUnique.mockResolvedValue({
      id: 'PO_FALL_1',
      payoutNo: 'POFALL1',
      ownerId: 'CUST_FALL',
      withdrawId: 'WD_FALL_1',
      type: PayoutType.FIAT,
      status: PayoutStatus.CONFIRMED,
      assetId: 'asset-aed',
      fromAddress: null,
      fromIban: null,
      asset: { code: 'AED', type: 'FIAT', network: null },
      withdraw: { withdrawNo: 'WDFALL1', ownerId: 'CUST_FALL' },
      customer: null,
    });
    prisma.wallet = {
      findFirst: jest.fn().mockResolvedValue({ iban: 'AE_FALLBACK' }),
    };

    const result = await service.findOne('PO_FALL_1');

    expect(result.fromIban).toBe('AE_FALLBACK');
    expect(prisma.payout.update).not.toHaveBeenCalled();
  });

  // ── gas fields on crypto confirm ─────────────────────────────────────────

  it('crypto confirm persists provided gasUsed/effectiveGasPrice', async () => {
    prisma.payout.findUnique.mockResolvedValue({
      id: 'PO_GAS_1',
      withdrawId: 'WD_GAS_1',
      type: PayoutType.CRYPTO,
      status: PayoutStatus.CONFIRMING,
      statusHistory: '[]',
      sentAt: new Date(),
      gasUsed: null,
      effectiveGasPrice: null,
    });
    prisma.payout.update.mockResolvedValue({
      id: 'PO_GAS_1',
      status: PayoutStatus.CONFIRMED,
    });

    await service.updateStatus(
      'PO_GAS_1',
      {
        action: PayoutAction.CONFIRM,
        gasUsed: '52341',
        effectiveGasPrice: '4200000000',
      },
      'SYSTEM',
    );

    expect(prisma.payout.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          gasUsed: '52341',
          effectiveGasPrice: '4200000000',
        }),
      }),
    );
  });

  it('mock-balance: payout CLEARED debits the resolved source wallet by amount', async () => {
    prisma.payout.findUnique.mockResolvedValue({
      id: 'PO_BAL_1',
      payoutNo: 'POBAL1',
      withdrawId: 'WD_BAL_1',
      type: PayoutType.CRYPTO,
      status: PayoutStatus.CONFIRMED,
      assetId: 'asset-usdt',
      ownerId: 'CUST_BAL',
      amount: '300',
      statusHistory: '[]',
      sentAt: new Date(),
      // R3 invariant: CLEARED rows must carry referenceNo + (CRYPTO) txHash — pre-populated by CONFIRM upstream.
      referenceNo: '0xbal1ref',
      txHash: '0xbal1tx',
    });
    prisma.payout.update.mockResolvedValue({
      id: 'PO_BAL_1',
      status: PayoutStatus.CLEARED,
    });
    // resolveSourceWalletId → C_OUT wallet
    prisma.wallet.findFirst.mockResolvedValue({ id: 'w-cout' });

    await service.updateStatus(
      'PO_BAL_1',
      { action: PayoutAction.CLEAR },
      'SYSTEM',
    );

    expect(walletBalance.adjust).toHaveBeenCalledTimes(1);
    const [walletId, delta] = walletBalance.adjust.mock.calls[0];
    expect(walletId).toBe('w-cout');
    expect(delta.toString()).toBe('-300');
  });

  it('crypto confirm without gas input → mock gas auto-generated (同 fiat referenceNo 兜底)', async () => {
    prisma.payout.findUnique.mockResolvedValue({
      id: 'PO_GAS_2',
      withdrawId: 'WD_GAS_2',
      type: PayoutType.CRYPTO,
      status: PayoutStatus.CONFIRMING,
      statusHistory: '[]',
      sentAt: new Date(),
      gasUsed: null,
      effectiveGasPrice: null,
    });
    prisma.payout.update.mockResolvedValue({
      id: 'PO_GAS_2',
      status: PayoutStatus.CONFIRMED,
    });

    await service.updateStatus(
      'PO_GAS_2',
      { action: PayoutAction.CONFIRM },
      'SYSTEM',
    );

    expect(prisma.payout.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          gasUsed: expect.any(String),
          effectiveGasPrice: expect.any(String),
        }),
      }),
    );
  });

  // ── R3 invariant: CLEARED rows must carry referenceNo + (CRYPTO) txHash ──

  it('R3: FIAT payout CLEAR throws when referenceNo is missing', async () => {
    prisma.payout.findUnique.mockResolvedValue({
      id: 'PO_r3_fiat_1',
      payoutNo: 'POR3F1',
      withdrawId: 'WD_r3_fiat_1',
      type: PayoutType.FIAT,
      status: PayoutStatus.CONFIRMED,
      statusHistory: '[]',
      sentAt: new Date(),
      referenceNo: null,
      txHash: null,
    });

    await expect(
      service.updateStatus(
        'PO_r3_fiat_1',
        { action: PayoutAction.CLEAR },
        'SYSTEM',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'R3_FINALIZATION_INCOMPLETE',
      }),
    });
    expect(prisma.payout.update).not.toHaveBeenCalled();
  });

  it('R3: CRYPTO payout CLEAR throws when txHash is missing', async () => {
    prisma.payout.findUnique.mockResolvedValue({
      id: 'PO_r3_crypto_1',
      payoutNo: 'POR3C1',
      withdrawId: 'WD_r3_crypto_1',
      type: PayoutType.CRYPTO,
      status: PayoutStatus.CONFIRMED,
      statusHistory: '[]',
      sentAt: new Date(),
      referenceNo: '0xpreserved',
      txHash: null,
    });

    await expect(
      service.updateStatus(
        'PO_r3_crypto_1',
        { action: PayoutAction.CLEAR },
        'SYSTEM',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'R3_FINALIZATION_INCOMPLETE',
      }),
    });
    expect(prisma.payout.update).not.toHaveBeenCalled();
  });

  it('R3: CLEAR passes when CRYPTO payout has both referenceNo and txHash', async () => {
    prisma.payout.findUnique.mockResolvedValue({
      id: 'PO_r3_crypto_ok',
      payoutNo: 'POR3COK',
      withdrawId: 'WD_r3_crypto_ok',
      ownerId: 'CU_1',
      assetId: 'asset-usdt',
      amount: '100',
      type: PayoutType.CRYPTO,
      status: PayoutStatus.CONFIRMED,
      statusHistory: '[]',
      sentAt: new Date(),
      referenceNo: '0xabc',
      txHash: '0xabc',
    });
    prisma.wallet.findFirst.mockResolvedValue({ id: 'w-dep' });
    prisma.payout.update.mockResolvedValue({
      id: 'PO_r3_crypto_ok',
      status: PayoutStatus.CLEARED,
    });

    const updated = await service.updateStatus(
      'PO_r3_crypto_ok',
      { action: PayoutAction.CLEAR },
      'SYSTEM',
    );
    expect(updated.status).toBe(PayoutStatus.CLEARED);
  });

  it('R3: CRYPTO payout CONFIRM auto-fills txHash when missing (mirror of FIAT CONFIRM ref fallback)', async () => {
    prisma.payout.findUnique.mockResolvedValue({
      id: 'PO_r3_crypto_confirm',
      payoutNo: 'POR3CCONF',
      withdrawId: 'WD_r3_crypto_confirm',
      assetId: 'asset-usdt',
      type: PayoutType.CRYPTO,
      status: PayoutStatus.CONFIRMING,
      statusHistory: '[]',
      sentAt: new Date(),
      txHash: null,
      gasUsed: null,
      effectiveGasPrice: null,
    });
    prisma.payout.update.mockResolvedValue({
      id: 'PO_r3_crypto_confirm',
      status: PayoutStatus.CONFIRMED,
    });

    await service.updateStatus(
      'PO_r3_crypto_confirm',
      { action: PayoutAction.CONFIRM },
      'SYSTEM',
    );

    expect(prisma.payout.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          txHash: expect.stringMatching(/^0x/),
        }),
      }),
    );
  });
});
