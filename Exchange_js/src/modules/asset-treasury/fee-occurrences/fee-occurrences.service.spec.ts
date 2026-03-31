import { Prisma } from '@prisma/client';
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
    );
  });

  it('captures direct cost from crypto internal fund and marks safeguarded pool impact', async () => {
    prisma.feeOccurrence.upsert.mockResolvedValue({
      id: 'fee-1',
      feeNo: 'FEE001',
      reimbursementImpact: 'SAFEGUARDED_POOL',
    });

    const result = await service.captureFromInternalFund(
      {
        id: 'ifd-1',
        internalFundNo: 'IFD001',
        feeAmount: new Prisma.Decimal('0.0003'),
        gasUsed: '21000',
        effectiveGasPrice: '12',
        txHash: '0xhash',
        providerTxnId: null,
        referenceNo: 'REF-1',
        assetId: 'asset-1',
        asset: { id: 'asset-1', type: 'CRYPTO' },
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

    expect(prisma.feeOccurrence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: 'INTERNAL_FUND:ifd-1:INTERNAL_TRANSFER_GAS' },
        create: expect.objectContaining({
          feeType: 'INTERNAL_TRANSFER_GAS',
          occurrenceType: 'DIRECT',
          reimbursementImpact: 'SAFEGUARDED_POOL',
          poolRole: 'PAYOUT',
          sourceEntityType: 'INTERNAL_FUND',
          sourceEntityId: 'ifd-1',
          relatedEntityType: 'INTERNAL_TRANSACTION',
          relatedEntityId: 'itx-1',
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
    expect(result.id).toBe('fee-1');
  });

  it('does not capture internal fund cost when no evidence exists', async () => {
    const result = await service.captureFromInternalFund(
      {
        id: 'ifd-2',
        feeAmount: new Prisma.Decimal('0'),
        gasUsed: null,
        effectiveGasPrice: null,
        asset: { type: 'CRYPTO' },
      } as any,
      'SYSTEM',
      prisma,
    );

    expect(result).toBeNull();
    expect(prisma.feeOccurrence.upsert).not.toHaveBeenCalled();
    expect(reimbursementObligationsService.syncForOccurrence).not.toHaveBeenCalled();
  });

  it('records manual period fee and opens reimbursement when poolRole is safeguarded', async () => {
    prisma.feeOccurrence.create.mockResolvedValue({
      id: 'fee-period-1',
      reimbursementImpact: 'SAFEGUARDED_POOL',
    });

    const result = await service.recordManual(
      {
        feeType: 'BANK_MONTHLY_FEE',
        occurrenceType: 'PERIOD',
        assetId: 'asset-aed',
        amount: '25.00',
        sourceAccountRef: 'BANK-ACC-1',
        poolRole: 'CUST_BANK',
        periodStart: '2026-03-01T00:00:00.000Z',
        periodEnd: '2026-03-31T23:59:59.999Z',
        evidenceRef: 'statement-2026-03.csv',
      } as any,
      'admin-1',
    );

    expect(prisma.feeOccurrence.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          feeType: 'BANK_MONTHLY_FEE',
          occurrenceType: 'PERIOD',
          reimbursementImpact: 'SAFEGUARDED_POOL',
          poolRole: 'CUST_BANK',
          payer: 'PLATFORM',
          chargedToCustomer: false,
        }),
      }),
    );
    expect(reimbursementObligationsService.syncForOccurrence).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fee-period-1' }),
      'admin-1',
      prisma,
    );
    expect(result.id).toBe('fee-period-1');
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
