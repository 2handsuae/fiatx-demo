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

  it('should route BULK_REVERSAL_BY_SOURCE events to reverseAllBySource', async () => {
    const mockClient: any = {
      acctEvent: {
        findFirst: jest.fn().mockResolvedValue({
          eventCode: 'EVT_WITHDRAWAL_FAILED__FIAT',
          postingMode: 'BULK_REVERSAL_BY_SOURCE',
        }),
      },
    };

    const service = new JournalsService({} as any);
    const reverseAllSpy = jest
      .spyOn(service as any, 'reverseAllBySource')
      .mockResolvedValue([{ id: 'REV_1' }, { id: 'REV_2' }]);

    const result = await service.triggerEvent(
      {
        entityType: 'WITHDRAW',
        triggerKey: 'status',
        toStatus: 'FAILED',
        assetType: 'FIAT',
        context: { src: { withdrawNo: 'WD001' } },
        sourceId: 'WD_1',
      },
      mockClient,
    );

    expect(reverseAllSpy).toHaveBeenCalledWith(
      {
        sourceType: 'WITHDRAW',
        sourceId: 'WD_1',
        context: { src: { withdrawNo: 'WD001' } },
      },
      mockClient,
    );
    expect(result).toEqual([{ id: 'REV_1' }, { id: 'REV_2' }]);
  });

  it('should reverse all original journals by source', async () => {
    const mockClient: any = {
      journal: {
        findMany: jest.fn().mockResolvedValue([
          { eventCode: 'EVT_WITHDRAWAL_CREATED' },
          { eventCode: 'EVT_WITHDRAWAL_SUCCESS__FIAT' },
        ]),
      },
    };

    const service = new JournalsService({} as any);
    const reverseSpy = jest
      .spyOn(service as any, 'reverseJournal')
      .mockResolvedValueOnce({ id: 'REV_A' })
      .mockResolvedValueOnce(null);

    const result = await (service as any).reverseAllBySource(
      {
        sourceType: 'WITHDRAW',
        sourceId: 'WD_2',
        context: { src: { withdrawNo: 'WD002' } },
      },
      mockClient,
    );

    expect(mockClient.journal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceType: 'WITHDRAW',
          sourceId: 'WD_2',
          reversalOfJournalId: null,
        }),
      }),
    );
    expect(reverseSpy).toHaveBeenCalledTimes(2);
    expect(reverseSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sourceType: 'WITHDRAW',
        sourceId: 'WD_2',
        targetEventCode: 'EVT_WITHDRAWAL_CREATED',
        reversalEventCode: 'REV_EVT_WITHDRAWAL_CREATED',
      }),
      mockClient,
    );
    expect(result).toEqual([{ id: 'REV_A' }]);
  });
});
