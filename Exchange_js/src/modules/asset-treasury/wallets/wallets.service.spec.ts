import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { WalletsService } from './wallets.service';
import {
  CreateWalletDto,
  OwnerType,
  WalletDirection,
  WalletRole,
  WalletStatus,
  WalletType,
} from './dto/wallet.dto';

describe('WalletsService', () => {
  let service: WalletsService;
  let prisma: PrismaService;

  const prismaMock = {
    asset: { findUnique: jest.fn() },
    customerMain: { findUnique: jest.fn() },
    liquidityProvider: { findUnique: jest.fn() },
    wallet: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const auditMock = {
    recordSystem: jest.fn().mockResolvedValue(undefined),
  };

  const cryptoAsset = { id: 'asset-1', type: 'CRYPTO', code: 'USDT' };
  const fiatAsset = { id: 'asset-fiat', type: 'FIAT', code: 'AED' };

  const customerInboundDto: CreateWalletDto = {
    ownerType: OwnerType.CUSTOMER,
    ownerId: 'cust-1',
    type: WalletType.CRYPTO_ADDRESS,
    direction: WalletDirection.INBOUND,
    assetId: 'asset-1',
  };

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
    (prisma as any).asset.findUnique.mockResolvedValue(cryptoAsset);
    (prisma as any).customerMain.findUnique.mockResolvedValue({ id: 'cust-1' });
    (prisma as any).liquidityProvider.findUnique.mockResolvedValue({
      id: 'lp-1',
    });
    (prisma as any).wallet.findFirst.mockResolvedValue(null);
    (prisma as any).wallet.create.mockResolvedValue({
      id: 'wallet-1',
      walletNo: 'WA2605120001',
      ownerType: OwnerType.CUSTOMER,
      ownerId: 'cust-1',
      ownerNo: null,
    });
    (prisma as any).wallet.findUnique.mockResolvedValue(null);
    (prisma as any).wallet.update.mockResolvedValue({
      id: 'wallet-1',
      walletNo: 'WA2605120001',
      ownerType: OwnerType.CUSTOMER,
      ownerId: 'cust-1',
      ownerNo: null,
    });
  });

  // ── create() ──────────────────────────────────────────────────────

  describe('create()', () => {
    it('should reject PLATFORM wallet with ownerId', async () => {
      await expect(
        service.create({
          ownerType: OwnerType.PLATFORM,
          ownerId: 'not-allowed',
          type: WalletType.CRYPTO_ADDRESS,
          direction: WalletDirection.OUTBOUND,
          assetId: 'asset-1',
          walletRole: WalletRole.C_DEP,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject CUSTOMER wallet without ownerId', async () => {
      await expect(
        service.create({
          ...customerInboundDto,
          ownerId: undefined,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject LIQUIDITY_PROVIDER wallet with invalid ownerId', async () => {
      (prisma as any).liquidityProvider.findUnique.mockResolvedValue(null);

      await expect(
        service.create({
          ownerType: OwnerType.LIQUIDITY_PROVIDER,
          ownerId: 'lp-x',
          type: WalletType.CRYPTO_ADDRESS,
          direction: WalletDirection.OUTBOUND,
          assetId: 'asset-1',
          walletRole: WalletRole.C_DEP,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return existing CUSTOMER INBOUND wallet when duplicate creation requested', async () => {
      const existing = {
        id: 'wallet-existing',
        ownerType: OwnerType.CUSTOMER,
        ownerId: 'cust-1',
        direction: WalletDirection.INBOUND,
      };
      (prisma as any).wallet.findFirst.mockResolvedValue(existing);

      const result = await service.create(customerInboundDto);

      expect(result).toEqual(existing);
      expect((prisma as any).wallet.create).not.toHaveBeenCalled();
    });

    it('should map unique constraint violation (P2002) to friendly error', async () => {
      (prisma as any).wallet.create.mockRejectedValue({ code: 'P2002' });

      await expect(service.create(customerInboundDto)).rejects.toThrow(
        'Inbound customer wallet already exists for this asset and type',
      );
    });

    it('should retry on walletNo unique constraint collision', async () => {
      (prisma as any).wallet.create
        .mockRejectedValueOnce({
          code: 'P2002',
          meta: { target: ['walletNo'] },
        })
        .mockResolvedValueOnce({
          id: 'wallet-retry',
          walletNo: 'WA2605120002',
          ownerType: OwnerType.CUSTOMER,
          ownerId: 'cust-1',
          ownerNo: null,
        });

      const result = await service.create(customerInboundDto);

      expect(result.id).toBe('wallet-retry');
      expect((prisma as any).wallet.create).toHaveBeenCalledTimes(2);
    });

    it('should generate walletNo via generateReferenceNo("WA")', async () => {
      await service.create(customerInboundDto);

      expect((prisma as any).wallet.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            walletNo: expect.stringMatching(/^WA\d{10}$/),
          }),
        }),
      );
    });

    it('should assign C_DEP role for CUSTOMER INBOUND crypto wallet', async () => {
      await service.create(customerInboundDto);

      expect((prisma as any).wallet.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            walletRole: WalletRole.C_DEP,
          }),
        }),
      );
    });

    it('should assign C_VIBAN role for CUSTOMER INBOUND fiat wallet', async () => {
      (prisma as any).asset.findUnique.mockResolvedValue(fiatAsset);

      await service.create({
        ownerType: OwnerType.CUSTOMER,
        ownerId: 'cust-1',
        type: WalletType.FIAT_BANK,
        direction: WalletDirection.INBOUND,
        assetId: 'asset-fiat',
      });

      expect((prisma as any).wallet.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            walletRole: WalletRole.C_VIBAN,
          }),
        }),
      );
    });

    it('should reject manual creation of protected system wallet roles', async () => {
      for (const role of [
        WalletRole.C_MAIN,
        WalletRole.C_OUT,
        WalletRole.C_CMA,
        WalletRole.F_LIQ,
        WalletRole.F_OPS,
      ]) {
        await expect(
          service.create({
            ownerType: OwnerType.PLATFORM,
            type: WalletType.CRYPTO_ADDRESS,
            direction: WalletDirection.BIDIRECTIONAL,
            assetId: 'asset-1',
            walletRole: role,
          }),
        ).rejects.toThrow('system-provisioned and cannot be created manually');
      }
    });

    it('should reject CUSTOMER BIDIRECTIONAL direction', async () => {
      await expect(
        service.create({
          ...customerInboundDto,
          direction: WalletDirection.BIDIRECTIONAL,
          walletRole: WalletRole.C_DEP,
        }),
      ).rejects.toThrow(
        'Customer wallets cannot be created with BIDIRECTIONAL direction',
      );
    });

    it('should require walletRole for non-customer-inbound wallets', async () => {
      await expect(
        service.create({
          ownerType: OwnerType.PLATFORM,
          type: WalletType.CRYPTO_ADDRESS,
          direction: WalletDirection.OUTBOUND,
          assetId: 'asset-1',
          // no walletRole
        }),
      ).rejects.toThrow('walletRole is required');
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
        service.changeStatus('wallet-protected', WalletStatus.DISABLED),
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

      await service.changeStatus('wallet-normal', WalletStatus.DISABLED);

      expect((prisma as any).wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-normal' },
        data: { status: WalletStatus.DISABLED },
      });
    });

    it('should throw NotFoundException when wallet does not exist', async () => {
      (prisma as any).wallet.findUnique.mockResolvedValue(null);

      await expect(
        service.changeStatus('nonexistent', WalletStatus.DISABLED),
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

      await service.changeStatus('wallet-audit', WalletStatus.FROZEN);

      expect(auditMock.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WALLET_STATUS_UPDATED',
          entityId: expect.any(String),
          result: 'SUCCESS',
        }),
      );
    });
  });
});
