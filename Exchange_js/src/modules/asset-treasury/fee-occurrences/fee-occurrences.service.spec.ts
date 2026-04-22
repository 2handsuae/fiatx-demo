import { FeeOccurrencesService } from './fee-occurrences.service';

describe('FeeOccurrencesService', () => {
  let service: FeeOccurrencesService;
  let prisma: any;
  let reimbursementObligationsService: any;

  beforeEach(() => {
    prisma = {
      auditLogEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }: any) => Promise.resolve(data)),
      },
      feeOccurrence: {
        upsert: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };

    reimbursementObligationsService = {
      syncForOccurrence: jest.fn(),
      cancelOpenForOccurrence: jest.fn(),
    };

    service = new FeeOccurrencesService(
      prisma,
      reimbursementObligationsService,
      {} as any,
    );
  });

  it('captures deterministic costs from confirmed crypto internal fund and marks safeguarded pool impact', async () => {
    prisma.feeOccurrence.upsert
      .mockResolvedValueOnce({
        id: 'fee-1',
        feeNo: 'FEE001',
        feeType: 'INTERNAL_TRANSFER_GAS',
        reimbursementImpact: 'SAFEGUARDED_POOL',
      })
      .mockResolvedValueOnce({
        id: 'fee-2',
        feeNo: 'FEE002',
        feeType: 'CUSTODY_FEE',
        reimbursementImpact: 'SAFEGUARDED_POOL',
      });

    const result = await service.captureFromInternalFund(
      {
        id: 'ifd-1',
        internalFundNo: 'IFD001',
        status: 'CONFIRMED',
        txHash: '0xhash',
        providerTxnId: null,
        referenceNo: 'REF-1',
        assetId: 'asset-1',
        asset: { id: 'asset-1', code: 'BTC', type: 'CRYPTO', decimals: 8 },
        fromWalletId: 'wallet-1',
        fromAddress: '0xfrom',
        fromIban: null,
        fromWallet: {
          id: 'wallet-1',
          walletRole: 'PAYOUT',
          ownerType: 'CUSTOMER',
          ownerId: null,
          ownerNo: 'CUSTOMER_POOL',
          direction: 'BIDIRECTIONAL',
        },
        internalTransaction: {
          id: 'itx-1',
          internalTxNo: 'ITX001',
          sourceType: 'WITHDRAW',
          sourceId: 'wd-1',
          sourceNo: 'WD001',
        },
      } as any,
      'SYSTEM',
      prisma,
    );

    expect(prisma.feeOccurrence.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { idempotencyKey: 'INTERNAL_FUND:ifd-1:INTERNAL_TRANSFER_GAS' },
        create: expect.objectContaining({
          feeType: 'INTERNAL_TRANSFER_GAS',
          reimbursementImpact: 'SAFEGUARDED_POOL',
          poolRole: 'PAYOUT',
          sourceEntityType: 'INTERNAL_FUND',
          sourceEntityId: 'ifd-1',
          relatedEntityType: 'INTERNAL_TRANSACTION',
          relatedEntityId: 'itx-1',
        }),
      }),
    );
    expect(prisma.feeOccurrence.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { idempotencyKey: 'INTERNAL_FUND:ifd-1:CUSTODY_FEE' },
        create: expect.objectContaining({
          feeType: 'CUSTODY_FEE',
          reimbursementImpact: 'SAFEGUARDED_POOL',
          poolRole: 'PAYOUT',
        }),
      }),
    );
    expect(reimbursementObligationsService.syncForOccurrence).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'fee-1',
        reimbursementImpact: 'SAFEGUARDED_POOL',
      }),
      'SYSTEM',
      prisma,
    );
    expect(reimbursementObligationsService.syncForOccurrence).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'fee-2',
        reimbursementImpact: 'SAFEGUARDED_POOL',
      }),
      'SYSTEM',
      prisma,
    );
    expect(result).toEqual([
      expect.objectContaining({ id: 'fee-1', feeType: 'INTERNAL_TRANSFER_GAS' }),
      expect.objectContaining({ id: 'fee-2', feeType: 'CUSTODY_FEE' }),
    ]);
  });

  it('captures deterministic cost from confirmed fiat internal fund', async () => {
    prisma.feeOccurrence.upsert.mockResolvedValue({
      id: 'fee-fiat-1',
      feeNo: 'FEE-FIAT-1',
      feeType: 'INTERNAL_BANK_FEE',
      reimbursementImpact: 'NONE',
    });

    const result = await service.captureFromInternalFund(
      {
        id: 'ifd-2',
        status: 'CONFIRMED',
        referenceNo: 'BANK-REF-1',
        assetId: 'asset-aed',
        asset: { id: 'asset-aed', code: 'AED', type: 'FIAT', decimals: 2 },
        fromWalletId: 'wallet-liq-bank',
        fromIban: 'AE0001',
        fromWallet: {
          id: 'wallet-liq-bank',
          walletRole: 'LIQ_BANK',
          ownerType: 'PLATFORM',
        },
        internalTransaction: {
          id: 'itx-2',
          internalTxNo: 'ITX002',
          sourceType: 'MANUAL',
          sourceId: 'manual-1',
          sourceNo: 'MANUAL001',
        },
      } as any,
      'SYSTEM',
      prisma,
    );

    expect(prisma.feeOccurrence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: 'INTERNAL_FUND:ifd-2:INTERNAL_BANK_FEE' },
        create: expect.objectContaining({
          feeType: 'INTERNAL_BANK_FEE',
          reimbursementImpact: 'NONE',
        }),
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({ id: 'fee-fiat-1', feeType: 'INTERNAL_BANK_FEE' }),
    ]);
  });

  it('records manual fee and opens reimbursement when poolRole is safeguarded', async () => {
    prisma.feeOccurrence.create.mockResolvedValue({
      id: 'fee-manual-1',
      reimbursementImpact: 'SAFEGUARDED_POOL',
    });

    const result = await service.recordManual(
      {
        feeType: 'BANK_MONTHLY_FEE',
        assetId: 'asset-aed',
        amount: '25.00',
        sourceAccountRef: 'BANK-ACC-1',
        poolRole: 'CUST_BANK',
        evidenceRef: 'statement-2026-03.csv',
      } as any,
      'admin-1',
    );

    expect(prisma.feeOccurrence.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          feeType: 'BANK_MONTHLY_FEE',
          reimbursementImpact: 'SAFEGUARDED_POOL',
          poolRole: 'CUST_BANK',
          payer: 'PLATFORM',
          chargedToCustomer: false,
        }),
      }),
    );
    expect(reimbursementObligationsService.syncForOccurrence).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fee-manual-1' }),
      'admin-1',
      prisma,
    );
    expect(result.id).toBe('fee-manual-1');
  });

  it('captures confirmed payout costs and links them back to withdraw', async () => {
    prisma.feeOccurrence.upsert
      .mockResolvedValueOnce({
        id: 'fee-payout-1',
        feeNo: 'FEE-PAYOUT-1',
        feeType: 'NETWORK_GAS',
        reimbursementImpact: 'SAFEGUARDED_POOL',
      })
      .mockResolvedValueOnce({
        id: 'fee-payout-2',
        feeNo: 'FEE-PAYOUT-2',
        feeType: 'CUSTODY_FEE',
        reimbursementImpact: 'SAFEGUARDED_POOL',
      });

    const result = await service.captureFromPayout(
      {
        id: 'po-1',
        payoutNo: 'PO001',
        assetId: 'asset-usdt',
        fromAddress: 'Tsource',
        fromIban: null,
        withdrawId: 'wd-1',
        withdraw: {
          id: 'wd-1',
          withdrawNo: 'WD001',
          fromWalletId: 'wallet-1',
        },
        asset: { id: 'asset-usdt', type: 'CRYPTO' },
        sourceWallet: {
          id: 'wallet-1',
          walletRole: 'PAYOUT',
          ownerType: 'CUSTOMER',
          ownerId: null,
          ownerNo: 'CUSTOMER_POOL',
          direction: 'BIDIRECTIONAL',
        },
        evidenceRef: '0xpayouthash',
        traceId: 'WITHDRAW:wd-1',
        metadata: {
          generatedBy: 'stable-pseudo-random',
        },
      } as any,
      'SYSTEM',
      prisma,
    );

    expect(prisma.feeOccurrence.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { idempotencyKey: 'PAYOUT:po-1:NETWORK_GAS' },
        create: expect.objectContaining({
          feeType: 'NETWORK_GAS',
          sourceEntityType: 'PAYOUT',
          sourceEntityId: 'po-1',
          relatedEntityType: 'WITHDRAW_TRANSACTION',
          relatedEntityId: 'wd-1',
          sourceWalletId: 'wallet-1',
          reimbursementImpact: 'SAFEGUARDED_POOL',
          poolRole: 'PAYOUT',
        }),
      }),
    );
    expect(prisma.feeOccurrence.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { idempotencyKey: 'PAYOUT:po-1:CUSTODY_FEE' },
        create: expect.objectContaining({
          feeType: 'CUSTODY_FEE',
          sourceEntityType: 'PAYOUT',
        }),
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({ id: 'fee-payout-1', feeType: 'NETWORK_GAS' }),
      expect.objectContaining({ id: 'fee-payout-2', feeType: 'CUSTODY_FEE' }),
    ]);
  });

  it('cancels fee occurrence and cancels linked open reimbursement obligation', async () => {
    prisma.feeOccurrence.findUnique.mockResolvedValue({
      id: 'fee-cancel-1',
      feeNo: 'FEE-CANCEL-1',
      status: 'RECORDED',
    });
    prisma.feeOccurrence.update.mockResolvedValue({
      id: 'fee-cancel-1',
      status: 'CANCELLED',
    });

    const result = await service.cancel('fee-cancel-1', 'duplicate', 'admin-1');

    expect(prisma.feeOccurrence.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fee-cancel-1' },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    );
    expect(
      reimbursementObligationsService.cancelOpenForOccurrence,
    ).toHaveBeenCalledWith('fee-cancel-1', 'duplicate', 'admin-1', prisma);
    expect(result.status).toBe('CANCELLED');
  });
});
