import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { WalletsService } from './wallets.service';
import {
  OwnerType,
  WalletRole,
  WalletStatus,
} from './dto/wallet.dto';

describe('WalletsService', () => {
  let service: WalletsService;
  let prisma: PrismaService;

  const prismaMock = {
    wallet: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const auditMock = {
    recordSystem: jest.fn().mockResolvedValue(undefined),
    recordByActor: jest.fn().mockResolvedValue(undefined),
  };

  const mockActor = { actorId: 'admin-1', actorNo: 'ADM001', actorRole: 'TECH_OFFICER' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditLogsService, useValue: auditMock },
      ],
    }).compile();

    service = module.get<WalletsService>(WalletsService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
    (prisma as any).wallet.findUnique.mockResolvedValue(null);
    (prisma as any).wallet.update.mockResolvedValue({
      id: 'wallet-1',
      walletNo: 'WA2605120001',
      ownerType: OwnerType.CUSTOMER,
      ownerId: 'cust-1',
      ownerNo: null,
    });
  });

  // ── changeStatus() ────────────────────────────────────────────────

  describe('changeStatus()', () => {
    it('should reject status changes for protected system wallet roles', async () => {
      (prisma as any).wallet.findUnique.mockResolvedValue({
        id: 'wallet-protected',
        walletNo: 'WA-SYS-001',
        walletRole: WalletRole.C_MAIN,
        ownerType: OwnerType.PLATFORM,
        ownerId: null,
        ownerNo: null,
        status: WalletStatus.ACTIVE,
      });

      await expect(
        service.changeStatus('wallet-protected', WalletStatus.DISABLED, mockActor),
      ).rejects.toThrow(
        'C_MAIN wallets are system-provisioned and cannot be manually disabled',
      );
      expect((prisma as any).wallet.update).not.toHaveBeenCalled();
    });

    it('should allow status change on non-protected wallet', async () => {
      (prisma as any).wallet.findUnique.mockResolvedValue({
        id: 'wallet-normal',
        walletNo: 'WA2605120099',
        walletRole: WalletRole.C_DEP,
        ownerType: OwnerType.CUSTOMER,
        ownerId: 'cust-1',
        ownerNo: 'CUST-0001',
        status: WalletStatus.ACTIVE,
      });

      await service.changeStatus('wallet-normal', WalletStatus.DISABLED, mockActor);

      expect((prisma as any).wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-normal' },
        data: { status: WalletStatus.DISABLED },
      });
    });

    it('should throw NotFoundException when wallet does not exist', async () => {
      (prisma as any).wallet.findUnique.mockResolvedValue(null);

      await expect(
        service.changeStatus('nonexistent', WalletStatus.DISABLED, mockActor),
      ).rejects.toThrow(NotFoundException);
    });

    it('should write audit log on successful status change', async () => {
      (prisma as any).wallet.findUnique.mockResolvedValue({
        id: 'wallet-audit',
        walletNo: 'WA2605120088',
        walletRole: WalletRole.C_DEP,
        ownerType: OwnerType.CUSTOMER,
        ownerId: 'cust-1',
        ownerNo: 'CUST-0001',
        status: WalletStatus.ACTIVE,
      });

      await service.changeStatus('wallet-audit', WalletStatus.FROZEN, mockActor);

      expect(auditMock.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WALLET_STATUS_UPDATED',
          entityId: expect.any(String),
          result: 'SUCCESS',
        }),
        expect.objectContaining({
          actorType: 'ADMIN',
          actorId: mockActor.actorId,
        }),
      );
    });
  });
});
