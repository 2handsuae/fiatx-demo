import { ReimbursementObligationsService } from './reimbursement-obligations.service';

describe('ReimbursementObligationsService', () => {
  let service: ReimbursementObligationsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      auditLogEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }: any) => Promise.resolve(data)),
      },
      reimbursementObligation: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };

    service = new ReimbursementObligationsService(prisma);
  });

  it('opens reimbursement obligation for safeguarded pool occurrence', async () => {
    prisma.reimbursementObligation.upsert.mockResolvedValue({
      id: 'obl-1',
      status: 'OPEN',
    });

    const result = await service.syncForOccurrence(
      {
        id: 'fee-1',
        feeNo: 'FEE001',
        assetId: 'asset-1',
        amount: '3.00',
        reimbursementImpact: 'SAFEGUARDED_POOL',
        poolRole: 'PAYOUT',
        sourceWalletId: 'wallet-1',
        sourceAccountRef: null,
        traceId: 'WITHDRAW:wd-1',
      } as any,
      'SYSTEM',
      prisma,
    );

    expect(prisma.reimbursementObligation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { feeOccurrenceId: 'fee-1' },
        create: expect.objectContaining({
          feeOccurrenceId: 'fee-1',
          status: 'OPEN',
          poolRole: 'PAYOUT',
        }),
      }),
    );
    expect(result.id).toBe('obl-1');
  });

  it('skips non-safeguarded fee occurrence', async () => {
    const result = await service.syncForOccurrence(
      {
        id: 'fee-2',
        reimbursementImpact: 'NONE',
      } as any,
      'SYSTEM',
      prisma,
    );

    expect(result).toBeNull();
    expect(prisma.reimbursementObligation.upsert).not.toHaveBeenCalled();
  });

  it('marks reimbursement obligation as reimbursed with settlement reference', async () => {
    prisma.reimbursementObligation.findUnique.mockResolvedValue({
      id: 'obl-2',
      obligationNo: 'ROB001',
      status: 'OPEN',
    });
    prisma.reimbursementObligation.update.mockResolvedValue({
      id: 'obl-2',
      status: 'REIMBURSED',
      settlementReferenceNo: 'ITX-REF-1',
    });

    const result = await service.updateStatus(
      'obl-2',
      {
        status: 'REIMBURSED',
        settlementReferenceNo: 'ITX-REF-1',
      } as any,
      'admin-1',
    );

    expect(prisma.reimbursementObligation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'obl-2' },
        data: expect.objectContaining({
          status: 'REIMBURSED',
          settlementReferenceNo: 'ITX-REF-1',
        }),
      }),
    );
    expect(result.status).toBe('REIMBURSED');
  });

  it('cancels open reimbursement obligation for cancelled fee occurrence', async () => {
    prisma.reimbursementObligation.findUnique.mockResolvedValue({
      id: 'obl-3',
      status: 'OPEN',
    });
    prisma.reimbursementObligation.update.mockResolvedValue({
      id: 'obl-3',
      status: 'CANCELLED',
    });

    const result = await service.cancelOpenForOccurrence(
      'fee-3',
      'fee cancelled',
      'admin-1',
      prisma,
    );

    expect(prisma.reimbursementObligation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { feeOccurrenceId: 'fee-3' },
        data: expect.objectContaining({
          status: 'CANCELLED',
        }),
      }),
    );
    expect(result?.status).toBe('CANCELLED');
  });
});
