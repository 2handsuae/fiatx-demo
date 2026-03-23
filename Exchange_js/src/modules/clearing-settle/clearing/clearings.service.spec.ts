import { BadRequestException } from '@nestjs/common';
import { ClearingsService } from './clearings.service';

describe('ClearingsService', () => {
  it('should calculate clearing amounts from template expressions', async () => {
    const mockTx: any = {
      clearing: {
        create: jest.fn().mockResolvedValue({ id: 'CL-1' }),
      },
      clearingLine: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const mockPrisma: any = {
      clearing: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      acctEvent: {
        findUnique: jest.fn().mockResolvedValue({
          eventCode: 'EVT_WITHDRAWAL_APPROVED__CRYPTO',
          clearingTemplateCode: 'WITHDRAWAL_STANDARD_V1',
        }),
      },
      clearingTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          code: 'WITHDRAWAL_STANDARD_V1',
          feeMethod: 'CONFIGURED_FEE',
          outAssetSource: 'src.assetId',
          outAmountSource: 'src.amount',
          inAssetSource: 'source.assetId',
          inAmountSource: 'source.netAmount',
          feeAssetSource: 'src.assetId',
          feeAmountSource: 'source.feeAmount',
          lineTemplates: [
            {
              lineNo: 1,
              lineType: 'FEE',
              partyType: 'PLATFORM',
              assetSource: 'src.assetId',
              amountSource: 'src.feeAmount',
              partyIdSource: null,
              refTypeConst: null,
              refIdSource: null,
            },
            {
              lineNo: 2,
              lineType: 'OUTGOING',
              partyType: 'CUSTOMER',
              partyIdSource: 'source.ownerId',
              assetSource: 'source.assetId',
              amountSource: 'source.netAmount',
              refTypeConst: null,
              refIdSource: null,
            },
          ],
        }),
      },
      $transaction: jest.fn(async (cb: any) => cb(mockTx)),
    };

    const service = new ClearingsService(mockPrisma);
    await service.triggerClearing({
      sourceType: 'WITHDRAWAL',
      sourceId: 'WD-1',
      eventCode: 'EVT_WITHDRAWAL_APPROVED__CRYPTO',
      context: {
        src: {
          assetId: 'A1',
          amount: '100',
          netAmount: '99',
          feeAmount: '1',
          ownerId: 'C1',
        },
      },
    });

    const clearingCreateArgs = mockTx.clearing.create.mock.calls[0][0];
    expect(clearingCreateArgs.data.outAmount.toString()).toBe('100');
    expect(clearingCreateArgs.data.inAmount.toString()).toBe('99');
    expect(clearingCreateArgs.data.feeAmount.toString()).toBe('1');
    expect(mockTx.clearingLine.create).toHaveBeenCalledTimes(2);
  });

  it('should fail when template expression cannot be resolved', async () => {
    const mockTx: any = {
      clearing: {
        create: jest.fn().mockResolvedValue({ id: 'CL-1' }),
      },
      clearingLine: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const mockPrisma: any = {
      clearing: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      acctEvent: {
        findUnique: jest.fn().mockResolvedValue({
          eventCode: 'EVT_WITHDRAWAL_APPROVED__CRYPTO',
          clearingTemplateCode: 'WITHDRAWAL_STANDARD_V1',
        }),
      },
      clearingTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          code: 'WITHDRAWAL_STANDARD_V1',
          feeMethod: 'CONFIGURED_FEE',
          outAssetSource: 'src.assetId',
          outAmountSource: 'src.amount',
          inAssetSource: 'src.assetId',
          inAmountSource: 'src.netAmount',
          feeAssetSource: 'src.assetId',
          feeAmountSource: 'src.feeAmount',
          lineTemplates: [
            {
              lineNo: 1,
              lineType: 'OUTGOING',
              partyType: 'CUSTOMER',
              partyIdSource: 'src.ownerId',
              assetSource: 'src.assetId',
              amountSource: 'source.missing',
              refTypeConst: null,
              refIdSource: null,
            },
          ],
        }),
      },
      $transaction: jest.fn(async (cb: any) => cb(mockTx)),
    };

    const service = new ClearingsService(mockPrisma);
    await expect(
      service.triggerClearing({
        sourceType: 'WITHDRAWAL',
        sourceId: 'WD-1',
        eventCode: 'EVT_WITHDRAWAL_APPROVED__CRYPTO',
        context: {
          src: {
            assetId: 'A1',
            amount: '100',
            netAmount: '99',
            feeAmount: '1',
            ownerId: 'C1',
          },
        },
      }),
    ).rejects.toThrow(BadRequestException);

    expect(mockTx.clearingLine.create).not.toHaveBeenCalled();
  });
});
