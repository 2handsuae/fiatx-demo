import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JournalsService } from './journals.service';

describe('JournalsService', () => {
  it('should block imbalanced journal lines by asset', async () => {
    const mockClient: any = {
      journal: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      journalHeaderTemplate: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'tpl-1',
          templateCode: 'TPL_TEST',
          description: 'test',
          baseAssetId: 'A1',
          journalLineTemplates: [
            {
              id: 'lt-1',
              lineNo: 1,
              accountCode: 'L.CLIENT_CREDIT',
              drCr: 'DR',
              amountSource: 'AMOUNT',
              assetSource: 'ASSET_ID',
              ownerTypeSource: 'CUSTOMER',
            },
            {
              id: 'lt-2',
              lineNo: 2,
              accountCode: 'L.CLIENT_HELD',
              drCr: 'CR',
              amountSource: 'AMOUNT',
              assetSource: 'TO_ASSET_ID',
              ownerTypeSource: 'CUSTOMER',
            },
          ],
        }),
      },
      journalLine: {
        createMany: jest.fn(),
      },
    };

    const service = new JournalsService({} as any);

    await expect(
      service.createJournal(
        {
          sourceType: 'DEPOSIT',
          sourceId: 'dep-1',
          eventCode: 'EVT_TEST',
          context: {
            src: {
              amount: '100',
              assetId: 'A1',
              toAssetId: 'A2',
              ownerId: 'C1',
              depositNo: 'DEP001',
            },
          },
        },
        mockClient,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(mockClient.journal.create).not.toHaveBeenCalled();
  });

  it('should aggregate customer liability balances', async () => {
    const mockPrisma: any = {
      journalLine: {
        aggregate: jest
          .fn()
          .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal(200) } }) // credit CR
          .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal(80) } }) // credit DR
          .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal(50) } }) // held CR
          .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal(20) } }), // held DR
      },
    };

    const service = new JournalsService(mockPrisma);
    const balances = await service.getCustomerLiabilityBalance({
      ownerId: 'C1',
      assetId: 'A1',
    });

    expect(balances.creditBalance.toString()).toBe('120');
    expect(balances.heldBalance.toString()).toBe('30');
    expect(balances.availableBalance.toString()).toBe('120');
  });
});
