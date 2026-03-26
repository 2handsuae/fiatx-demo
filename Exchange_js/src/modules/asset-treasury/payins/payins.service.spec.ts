import { Test, TestingModule } from '@nestjs/testing';
import { PayinsService } from './payins.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  PayinAction,
  PayinMockEvent,
  PayinStatus,
  PayinType,
} from './dto/payin.dto';
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
            auditLogEvent: {
              findUnique: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve(data)),
            },
            wallet: {
              findUnique: jest.fn(),
            },
            inboundTransferSignal: {
              findUnique: jest.fn().mockResolvedValue(null),
            },
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
            emitAsync: jest.fn().mockResolvedValue([]),
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

  describe('applyMockEvent', () => {
    it('should map CHAIN_CONFIRMED to interactive confirm for crypto payin', async () => {
      const mockPayin = {
        id: 'payin-crypto-1',
        payinNo: 'PI-1',
        type: 'crypto',
        status: PayinStatus.CONFIRMING,
        amount: { toString: () => '200' },
        depositId: 'd2',
        assetId: 'a2',
        providerTxnId: 'sig-1',
      };
      ((prisma as any).payin.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockPayin)
        .mockResolvedValueOnce(mockPayin)
        .mockResolvedValueOnce({
          ...mockPayin,
          status: PayinStatus.CONFIRMED,
        })
        .mockResolvedValue({
          ...mockPayin,
          status: PayinStatus.CONFIRMED,
        });
      ((prisma as any).payin.update as jest.Mock).mockResolvedValue({
        ...mockPayin,
        status: PayinStatus.CONFIRMED,
      });

      const spy = jest.spyOn(service, 'updateStatus');

      const result = await service.applyMockEvent('payin-crypto-1', {
        event: PayinMockEvent.CHAIN_CONFIRMED,
      });

      expect(spy).toHaveBeenCalledWith('payin-crypto-1', PayinAction.CONFIRM, {
        simulationMode: 'INTERACTIVE',
      });
      expect(result.status).toBe(PayinStatus.CONFIRMED);
    });

    it('should reject crypto-only mock events for fiat payins', async () => {
      ((prisma as any).payin.findUnique as jest.Mock).mockResolvedValue({
        id: 'payin-fiat-1',
        payinNo: 'PI-FIAT-1',
        type: 'fiat',
        status: PayinStatus.DETECTED,
        amount: { toString: () => '100' },
        depositId: 'd1',
        assetId: 'a1',
      });

      await expect(
        service.applyMockEvent('payin-fiat-1', {
          event: PayinMockEvent.MEMPOOL_SEEN,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createDetected', () => {
    it('should create detected payin and emit payin.created asynchronously when available', async () => {
      ((prisma as any).wallet.findUnique as jest.Mock).mockResolvedValue({
        id: 'wallet-1',
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        assetId: 'asset-1',
        address: '0xwallet',
        iban: null,
      });
      ((prisma as any).payin.create as jest.Mock).mockResolvedValue({
        id: 'payin-1',
        payinNo: 'PI0001',
        status: PayinStatus.DETECTED,
        type: PayinType.CRYPTO,
        assetId: 'asset-1',
        depositId: null,
        amount: { toString: () => '10.00' },
        providerTxnId: 'sig-1',
      });

      const result = await service.createDetected({
        assetId: 'asset-1',
        toWalletId: 'wallet-1',
        type: PayinType.CRYPTO,
        amount: '10.00',
        txHash: '0xabc',
        fromAddress: '0xfrom',
        providerTxnId: 'sig-1',
      });

      expect((prisma as any).payin.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: PayinStatus.DETECTED,
            providerTxnId: 'sig-1',
            toAddress: '0xwallet',
          }),
        }),
      );
      expect(result.id).toBe('payin-1');
    });
  });
});
