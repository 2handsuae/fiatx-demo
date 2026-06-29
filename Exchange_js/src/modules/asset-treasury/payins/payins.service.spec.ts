import { Test, TestingModule } from '@nestjs/testing';
import { PayinsService } from './payins.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { WalletBalanceService } from '../wallets/wallet-balance.service';
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
  let walletBalance: WalletBalanceService;
  let auditLogsService: AuditLogsService;

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
              findMany: jest.fn().mockResolvedValue([]),
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
        {
          provide: AuditLogsService,
          useValue: {
            recordByActor: jest.fn().mockResolvedValue({}),
            recordSystem: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: WalletBalanceService,
          useValue: { adjust: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<PayinsService>(PayinsService);
    prisma = module.get<PrismaService>(PrismaService);
    walletBalance = module.get<WalletBalanceService>(WalletBalanceService);
    auditLogsService = module.get<AuditLogsService>(AuditLogsService);
  });

  describe('updateStatus', () => {
    it('mock-balance: CONFIRMED -> CLEARED credits toWallet by amount', async () => {
      const mockPayin = {
        id: 'p-clr',
        type: 'crypto',
        status: PayinStatus.CONFIRMED,
        toWalletId: 'w-dep',
        amount: { toString: () => '1000' },
        statusHistory: '[]',
        depositId: 'd1',
        assetId: 'a1',
        referenceNo: 'REF-PRE-CLEARED',
        txHash: '0xpre',
      };
      ((prisma as any).payin.findUnique as jest.Mock).mockResolvedValue(
        mockPayin,
      );
      ((prisma as any).payin.update as jest.Mock).mockResolvedValue({
        ...mockPayin,
        status: PayinStatus.CLEARED,
        toWalletId: 'w-dep',
        amount: '1000',
      });

      await service.updateStatus('p-clr', PayinAction.CLEAR);

      expect(walletBalance.adjust).toHaveBeenCalledTimes(1);
      const [walletId, delta] = (walletBalance.adjust as jest.Mock).mock
        .calls[0];
      expect(walletId).toBe('w-dep');
      expect(delta.toString()).toBe('1000');
    });

    // ── R3 invariant: payin CLEARED rows must carry referenceNo + (CRYPTO) txHash ──

    it('R3: FIAT payin CLEAR throws when referenceNo is missing', async () => {
      const mockPayin = {
        id: 'p-r3-fiat',
        payinNo: 'PIR3F',
        type: 'fiat',
        status: PayinStatus.CONFIRMED,
        toWalletId: 'w-viban',
        amount: { toString: () => '500' },
        statusHistory: '[]',
        depositId: 'd-r3-f',
        assetId: 'a-aed',
        referenceNo: null,
        txHash: null,
      };
      ((prisma as any).payin.findUnique as jest.Mock).mockResolvedValue(
        mockPayin,
      );

      await expect(
        service.updateStatus('p-r3-fiat', PayinAction.CLEAR),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'R3_FINALIZATION_INCOMPLETE',
        }),
      });
      expect((prisma as any).payin.update).not.toHaveBeenCalled();
    });

    it('R3: CRYPTO payin CLEAR throws when txHash is missing', async () => {
      const mockPayin = {
        id: 'p-r3-crypto',
        payinNo: 'PIR3C',
        type: 'crypto',
        status: PayinStatus.CONFIRMED,
        toWalletId: 'w-dep',
        amount: { toString: () => '50' },
        statusHistory: '[]',
        depositId: 'd-r3-c',
        assetId: 'a-usdt',
        referenceNo: 'REF-OK',
        txHash: null,
      };
      ((prisma as any).payin.findUnique as jest.Mock).mockResolvedValue(
        mockPayin,
      );

      await expect(
        service.updateStatus('p-r3-crypto', PayinAction.CLEAR),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'R3_FINALIZATION_INCOMPLETE',
        }),
      });
      expect((prisma as any).payin.update).not.toHaveBeenCalled();
    });

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

    it('should transition CRYPTO DETECTED -> FAILED via fail (mempool dropped / RBF replaced)', async () => {
      const mockPayin = {
        id: '3',
        type: 'crypto',
        status: PayinStatus.DETECTED,
        amount: { toString: () => '300' },
        depositId: 'd3',
        assetId: 'a3',
        statusHistory: null,
      };
      ((prisma as any).payin.findUnique as jest.Mock).mockResolvedValue(mockPayin);
      ((prisma as any).payin.update as jest.Mock).mockResolvedValue({
        ...mockPayin,
        status: PayinStatus.FAILED,
      });

      const result = await service.updateStatus('3', PayinAction.FAIL);
      expect((prisma as any).payin.update).toHaveBeenCalledWith({
        where: { id: '3' },
        data: expect.objectContaining({ status: PayinStatus.FAILED }),
      });
      expect(result.status).toBe(PayinStatus.FAILED);
    });

    it('should transition CRYPTO CONFIRMING -> DETECTED via reorg (shallow reorg back to mempool)', async () => {
      const mockPayin = {
        id: '4',
        type: 'crypto',
        status: PayinStatus.CONFIRMING,
        amount: { toString: () => '400' },
        depositId: 'd4',
        assetId: 'a4',
        statusHistory: null,
      };
      ((prisma as any).payin.findUnique as jest.Mock).mockResolvedValue(mockPayin);
      ((prisma as any).payin.update as jest.Mock).mockResolvedValue({
        ...mockPayin,
        status: PayinStatus.DETECTED,
      });

      const result = await service.updateStatus('4', PayinAction.REORG);
      expect((prisma as any).payin.update).toHaveBeenCalledWith({
        where: { id: '4' },
        data: expect.objectContaining({ status: PayinStatus.DETECTED }),
      });
      expect(result.status).toBe(PayinStatus.DETECTED);
    });

    it('audit carries the payin.traceId from the table', async () => {
      // Drive a transition the existing tests already use: CRYPTO DETECTED → CONFIRMING via BLOCK.
      // Mock prisma.payin.findUnique (used by findOne) AND prisma.payin.update — both must
      // include traceId so the service reads it through to the audit call.
      (prisma as any).payin.findUnique = jest.fn().mockResolvedValue({
        id: 'p2', payinNo: 'PI2', status: 'DETECTED', type: 'CRYPTO',
        statusHistory: JSON.stringify([]), amount: '50', ownerId: 'c1',
        toWalletId: 'w1', assetId: 'a1', traceId: 'TRACE-FROM-TABLE',
      });
      (prisma as any).payin.update = jest.fn(() => Promise.resolve({
        id: 'p2', payinNo: 'PI2', status: 'CONFIRMING', type: 'CRYPTO',
        ownerId: 'c1', toWalletId: 'w1', assetId: 'a1', traceId: 'TRACE-FROM-TABLE',
        amount: '50',
      }));
      const capturedAudit: any[] = [];
      (auditLogsService as any).recordSystem = jest.fn((args: any) => {
        capturedAudit.push(args);
        return Promise.resolve();
      });

      await service.updateStatus('p2', PayinAction.BLOCK);

      expect(capturedAudit).toHaveLength(1);
      expect(capturedAudit[0].traceId).toBe('TRACE-FROM-TABLE');
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

    it('should reject REORG mock event for fiat payins (not supported)', async () => {
      ((prisma as any).payin.findUnique as jest.Mock).mockResolvedValue({
        id: 'payin-fiat-2',
        payinNo: 'PI-FIAT-2',
        type: 'fiat',
        status: PayinStatus.DETECTED,
        amount: { toString: () => '100' },
        depositId: 'd1',
        assetId: 'a1',
        statusHistory: null,
      });

      await expect(
        service.applyMockEvent('payin-fiat-2', {
          event: PayinMockEvent.REORG,
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

    it('generates a UUID traceId, persists it on the payin row, and passes it to audit', async () => {
      const capturedCreate: any[] = [];
      const capturedAudit: any[] = [];

      (prisma as any).wallet.findUnique = jest.fn().mockResolvedValue({
        id: 'w1', assetId: 'a1', ownerType: 'CUSTOMER', ownerId: 'c1', address: 'addr', iban: null,
      });
      (prisma as any).payin.create = jest.fn((args: any) => {
        capturedCreate.push(args.data);
        return Promise.resolve({ id: 'p1', payinNo: 'PI1', ...args.data });
      });
      (auditLogsService as any).recordSystem = jest.fn((args: any) => {
        capturedAudit.push(args);
        return Promise.resolve();
      });

      await service.createDetected({
        assetId: 'a1', toWalletId: 'w1', type: PayinType.CRYPTO, amount: '100',
      } as any);

      expect(capturedCreate).toHaveLength(1);
      expect(capturedCreate[0].traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

      expect(capturedAudit).toHaveLength(1);
      expect(capturedAudit[0].traceId).toBe(capturedCreate[0].traceId);
    });
  });

  describe('read models', () => {
    it('should expand canonical payin type filter to match legacy lowercase rows', async () => {
      ((prisma as any).payin.findMany as jest.Mock).mockResolvedValue([]);
      ((prisma as any).payin.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ type: PayinType.CRYPTO });

      expect((prisma as any).payin.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: expect.objectContaining({
              in: [PayinType.CRYPTO, 'crypto'],
            }),
          }),
        }),
      );
    });

    it('should return normalized admin fields in payin list', async () => {
      ((prisma as any).payin.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'payin-list-1',
          payinNo: 'PI0001',
          depositId: 'dep-1',
          status: PayinStatus.CLEARED,
          type: 'crypto',
          amount: '10.00',
          asset: { code: 'USDT', type: 'CRYPTO', network: 'TRON', decimals: 6 },
          toWallet: null,
          fromAddress: 'Tfrom',
          fromIban: null,
          txHash: '0xtx',
          referenceNo: null,
          deposit: {
            kytStatus: 'FINAL',
            travelRuleStatus: 'FINAL',
            depositNo: 'DP0001',
          },
          customer: {
            customerNo: 'CU0001',
            firstName: 'Shawn',
            lastName: 'Song',
          },
          receivedAt: null,
          confirmedAt: null,
        },
      ]);
      ((prisma as any).payin.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll({});

      expect(result.items[0]).toEqual(
        expect.objectContaining({
          ownerNo: 'CU0001',
          transactionType: 'DEPOSIT',
          transactionId: 'dep-1',
          transactionNo: 'DP0001',
          type: 'CRYPTO',
          displayStatus: 'CLEARED',
        }),
      );
    });

    it('should return canonical audit logs and normalized admin fields in payin detail', async () => {
      ((prisma as any).payin.findUnique as jest.Mock).mockResolvedValue({
        id: 'payin-detail-1',
        payinNo: 'PI0002',
        depositId: 'dep-2',
        type: 'fiat',
        status: PayinStatus.CONFIRMED,
        providerTxnId: null,
        asset: {
          code: 'AED',
          type: 'FIAT',
          network: null,
          decimals: 2,
          description: 'UAE Dirham',
        },
        toWallet: {
          ownerType: 'CUSTOMER',
          ownerId: 'cust-2',
          walletNo: 'WA0002',
          address: null,
          accountName: 'Cust Wallet',
        },
        fromWallet: null,
        deposit: {
          depositNo: 'DP0002',
        },
        customer: {
          customerNo: 'CU0002',
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
        },
      });
      ((prisma as any).auditLogEvent.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'audit-payin-1',
          action: 'PAYIN_PENDING_TO_CONFIRMED',
          statusFrom: 'CONFIRMING',
          statusTo: 'CONFIRMED',
          actorType: 'SYSTEM',
          actorId: 'SYSTEM',
          reason: 'payin confirmed',
          occurredAt: '2026-03-28T12:00:00.000Z',
          module: 'asset-treasury/payins',
          result: 'SUCCESS',
        },
      ]);

      const result = await service.findOne('payin-detail-1');

      expect(result).toEqual(
        expect.objectContaining({
          ownerNo: 'CU0002',
          transactionType: 'DEPOSIT',
          transactionId: 'dep-2',
          transactionNo: 'DP0002',
          type: 'FIAT',
          displayStatus: 'CONFIRMED',
          auditLogs: [
            expect.objectContaining({
              id: 'audit-payin-1',
              action: 'PAYIN_PENDING_TO_CONFIRMED',
              oldStatus: 'CONFIRMING',
              newStatus: 'CONFIRMED',
              operatorId: 'SYSTEM',
            }),
          ],
        }),
      );
    });
  });
});
