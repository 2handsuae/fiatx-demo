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
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };

    service = new ReimbursementObligationsService(prisma, {} as any);
    (service as any).auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue({ id: 'audit-log-1' }),
    };
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
});
