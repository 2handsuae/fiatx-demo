// src/modules/accounting/tigerbeetle/tb-evidence.service.spec.ts
import { TbEvidenceService } from './tb-evidence.service';

describe('TbEvidenceService', () => {
  let service: TbEvidenceService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      tbTransferEvidence: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
      },
      tbEvidenceBacklog: {
        create: jest.fn(),
      },
    };
    service = new TbEvidenceService(mockPrisma);
  });

  describe('writeEvidence', () => {
    const params = {
      tbTransferId: 'abc123',
      sourceType: 'DEPOSIT',
      sourceNo: 'DEP-001',
      eventCode: 'EVT_DEPOSIT_SUCCESS',
      debitCode: 'A.CLIENT_CUSTODY',
      creditCode: 'L.CLIENT_CREDIT',
      amount: 100.00,
      assetCurrency: 'AED',
      traceId: 'trace-uuid-1',
      actorType: 'SYSTEM',
      actorId: 'SYSTEM',
      transferType: 'POSTED',
    };

    it('should write evidence to TbTransferEvidence', async () => {
      mockPrisma.tbTransferEvidence.create.mockResolvedValue(params);

      await service.writeEvidence(params);

      expect(mockPrisma.tbTransferEvidence.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tbTransferId: 'abc123',
          sourceType: 'DEPOSIT',
          sourceNo: 'DEP-001',
        }),
      });
    });

    it('should write to backlog on Prisma failure instead of throwing', async () => {
      mockPrisma.tbTransferEvidence.create.mockRejectedValue(new Error('DB error'));
      mockPrisma.tbEvidenceBacklog.create.mockResolvedValue({});

      // Should not throw
      await service.writeEvidence(params);

      expect(mockPrisma.tbEvidenceBacklog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tbTransferId: 'abc123',
          errorMessage: 'DB error',
          status: 'PENDING',
        }),
      });
    });
  });

  describe('findBySource', () => {
    it('should query by sourceType and sourceNo', async () => {
      mockPrisma.tbTransferEvidence.findMany.mockResolvedValue([]);

      await service.findBySource('DEPOSIT', 'DEP-001');

      expect(mockPrisma.tbTransferEvidence.findMany).toHaveBeenCalledWith({
        where: { sourceType: 'DEPOSIT', sourceNo: 'DEP-001' },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('findByTraceId', () => {
    it('should query by traceId', async () => {
      mockPrisma.tbTransferEvidence.findMany.mockResolvedValue([]);

      await service.findByTraceId('trace-uuid-1');

      expect(mockPrisma.tbTransferEvidence.findMany).toHaveBeenCalledWith({
        where: { traceId: 'trace-uuid-1' },
        orderBy: { createdAt: 'asc' },
      });
    });
  });
});
