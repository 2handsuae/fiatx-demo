import { Test, TestingModule } from '@nestjs/testing';
import { PayinsService } from './payins.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { PayinAction, PayinStatus, PayinType } from './dto/payin.dto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('PayinsService', () => {
  let service: PayinsService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayinsService,
        {
          provide: PrismaService,
          useValue: {
            payin: {
              findMany: jest.fn(),
              count: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              create: jest.fn(),
            },
            payinAuditLog: {
              create: jest.fn(),
            },
            wallet: {
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PayinsService>(PayinsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('updateStatus', () => {
    it('should transition FIAT DETECTED -> CONFIRMED via confirm', async () => {
      const mockPayin = {
        id: '1',
        type: 'fiat',
        status: PayinStatus.DETECTED,
        amount: { toString: () => '100' },
        depositId: 'd1',
        assetId: 'a1',
      };
      ((prisma as any).payin.findUnique as jest.Mock).mockResolvedValue(
        mockPayin,
      );
      ((prisma as any).payin.update as jest.Mock).mockResolvedValue({
        ...mockPayin,
        status: PayinStatus.CONFIRMED,
      });

      const result = await service.updateStatus('1', PayinAction.CONFIRM);
      expect((prisma as any).payin.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: expect.objectContaining({ status: PayinStatus.CONFIRMED }),
      });
      expect(result.status).toBe(PayinStatus.CONFIRMED);
    });

    it('should transition CRYPTO DETECTED -> CONFIRMING via block', async () => {
      const mockPayin = {
        id: '2',
        type: 'crypto',
        status: PayinStatus.DETECTED,
        amount: { toString: () => '200' },
        depositId: 'd2',
        assetId: 'a2',
      };
      ((prisma as any).payin.findUnique as jest.Mock).mockResolvedValue(
        mockPayin,
      );
      ((prisma as any).payin.update as jest.Mock).mockResolvedValue({
        ...mockPayin,
        status: PayinStatus.CONFIRMING,
      });

      const result = await service.updateStatus('2', PayinAction.BLOCK);
      expect((prisma as any).payin.update).toHaveBeenCalledWith({
        where: { id: '2' },
        data: expect.objectContaining({ status: PayinStatus.CONFIRMING }),
      });
      expect(result.status).toBe(PayinStatus.CONFIRMING);
    });

    it('should transition CRYPTO CONFIRMING -> CONFIRMED via confirm', async () => {
      const mockPayin = {
        id: '2',
        type: 'crypto',
        status: PayinStatus.CONFIRMING,
        amount: { toString: () => '200' },
        depositId: 'd2',
        assetId: 'a2',
      };
      ((prisma as any).payin.findUnique as jest.Mock).mockResolvedValue(
        mockPayin,
      );
      ((prisma as any).payin.update as jest.Mock).mockResolvedValue({
        ...mockPayin,
        status: PayinStatus.CONFIRMED,
      });

      const result = await service.updateStatus('2', PayinAction.CONFIRM);
      expect((prisma as any).payin.update).toHaveBeenCalledWith({
        where: { id: '2' },
        data: expect.objectContaining({ status: PayinStatus.CONFIRMED }),
      });
    });

    it('should throw error for invalid transition', async () => {
      const mockPayin = { id: '1', type: 'fiat', status: PayinStatus.DETECTED };
      ((prisma as any).payin.findUnique as jest.Mock).mockResolvedValue(
        mockPayin,
      );

      await expect(
        service.updateStatus('1', PayinAction.CLEAR),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
