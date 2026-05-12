import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { SystemWalletProvisioningService } from './system-wallet-provisioning.service';
import { WalletRole } from './dto/wallet.dto';
import { CRYPTO_SYSTEM_WALLET_ROLES, FIAT_SYSTEM_WALLET_ROLES } from './system-wallet.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { AuditGovernanceActions } from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';

describe('SystemWalletProvisioningService', () => {
  let service: SystemWalletProvisioningService;
  let prisma: any;
  let auditLogs: any;

  const prismaMock = {
    asset: { findFirst: jest.fn() },
    wallet: { findFirst: jest.fn(), create: jest.fn() },
  };

  const auditMock = {
    recordByActor: jest.fn().mockResolvedValue(undefined),
  };

  const actor: ApprovalActorContext = {
    actorType: 'ADMIN',
    userId: 'admin-user-1',
    userNo: 'ADM0001',
    role: 'CISO',
    roleCodes: ['CISO'],
  };

  const cryptoAsset = {
    id: 'asset-crypto-1',
    assetNo: 'AST001',
    type: 'CRYPTO',
    status: 'PROVISIONING',
  };

  const fiatAsset = {
    id: 'asset-fiat-1',
    assetNo: 'AST002',
    type: 'FIAT',
    status: 'ACTIVE',
  };

  // Helper to build a wallet stub for a given role
  function makeWallet(role: WalletRole, idx: number) {
    return {
      id: `wallet-${role}-${idx}`,
      walletNo: `WA260512000${idx}`,
      walletRole: role,
    };
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemWalletProvisioningService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditLogsService, useValue: auditMock },
      ],
    }).compile();

    service = module.get<SystemWalletProvisioningService>(SystemWalletProvisioningService);
    prisma = module.get<PrismaService>(PrismaService);
    auditLogs = module.get<AuditLogsService>(AuditLogsService);

    jest.clearAllMocks();
  });

  // ─── Test 1: Creates 4 wallets for CRYPTO asset ────────────────────────────

  describe('CRYPTO asset', () => {
    it('creates 4 system wallets (C_MAIN, C_OUT, F_LIQ, F_OPS) when none exist', async () => {
      prismaMock.asset.findFirst.mockResolvedValue(cryptoAsset);
      prismaMock.wallet.findFirst.mockResolvedValue(null); // no existing wallets
      let callIdx = 0;
      prismaMock.wallet.create.mockImplementation(({ data }: any) => {
        callIdx++;
        return Promise.resolve(makeWallet(data.walletRole, callIdx));
      });

      const result = await service.provisionSystemWallets('AST001', actor);

      expect(result.created).toHaveLength(4);
      expect(result.skipped).toHaveLength(0);

      const createdRoles = result.created.map((w: any) => w.role);
      expect(createdRoles).toEqual(CRYPTO_SYSTEM_WALLET_ROLES);

      // All created wallets should be CRYPTO_ADDRESS type
      const createCalls = prismaMock.wallet.create.mock.calls;
      createCalls.forEach((call: any[]) => {
        expect(call[0].data.type).toBe('CRYPTO_ADDRESS');
        expect(call[0].data.ownerType).toBe('PLATFORM');
        expect(call[0].data.direction).toBe('BIDIRECTIONAL');
        expect(call[0].data.status).toBe('ACTIVE');
        expect(call[0].data.assetId).toBe(cryptoAsset.id);
      });
    });
  });

  // ─── Test 2: Creates 3 wallets for FIAT asset ──────────────────────────────

  describe('FIAT asset', () => {
    it('creates 3 system wallets (C_CMA, F_LIQ, F_OPS) when none exist', async () => {
      prismaMock.asset.findFirst.mockResolvedValue(fiatAsset);
      prismaMock.wallet.findFirst.mockResolvedValue(null);
      let callIdx = 0;
      prismaMock.wallet.create.mockImplementation(({ data }: any) => {
        callIdx++;
        return Promise.resolve(makeWallet(data.walletRole, callIdx));
      });

      const result = await service.provisionSystemWallets('AST002', actor);

      expect(result.created).toHaveLength(3);
      expect(result.skipped).toHaveLength(0);

      const createdRoles = result.created.map((w: any) => w.role);
      expect(createdRoles).toEqual(FIAT_SYSTEM_WALLET_ROLES);

      // All created wallets should be FIAT_BANK type
      const createCalls = prismaMock.wallet.create.mock.calls;
      createCalls.forEach((call: any[]) => {
        expect(call[0].data.type).toBe('FIAT_BANK');
        expect(call[0].data.assetId).toBe(fiatAsset.id);
      });
    });
  });

  // ─── Test 3: Idempotent — skips existing wallets ───────────────────────────

  describe('idempotency', () => {
    it('skips C_MAIN if it already exists and creates the other 3', async () => {
      prismaMock.asset.findFirst.mockResolvedValue(cryptoAsset);

      const existingCMain = makeWallet(WalletRole.C_MAIN, 99);

      // First findFirst call (for C_MAIN) returns existing; rest return null
      prismaMock.wallet.findFirst
        .mockResolvedValueOnce(existingCMain)  // C_MAIN exists
        .mockResolvedValue(null);               // others do not

      let callIdx = 0;
      prismaMock.wallet.create.mockImplementation(({ data }: any) => {
        callIdx++;
        return Promise.resolve(makeWallet(data.walletRole, callIdx));
      });

      const result = await service.provisionSystemWallets('AST001', actor);

      expect(result.created).toHaveLength(3);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].role).toBe(WalletRole.C_MAIN);
      expect(result.skipped[0].walletNo).toBe(existingCMain.walletNo);

      const createdRoles = result.created.map((w: any) => w.role);
      expect(createdRoles).not.toContain(WalletRole.C_MAIN);
    });

    it('skips all wallets if all already exist', async () => {
      prismaMock.asset.findFirst.mockResolvedValue(cryptoAsset);

      let callIdx = 0;
      prismaMock.wallet.findFirst.mockImplementation(() => {
        callIdx++;
        return Promise.resolve(makeWallet(WalletRole.C_MAIN, callIdx)); // always return an existing wallet
      });

      const result = await service.provisionSystemWallets('AST001', actor);

      expect(result.created).toHaveLength(0);
      expect(result.skipped).toHaveLength(4);
      expect(prismaMock.wallet.create).not.toHaveBeenCalled();
    });
  });

  // ─── Test 4: Rejects asset in invalid status ───────────────────────────────

  describe('status validation', () => {
    it('throws BadRequestException if asset status is PENDING', async () => {
      prismaMock.asset.findFirst.mockResolvedValue({
        ...cryptoAsset,
        status: 'PENDING',
      });

      await expect(service.provisionSystemWallets('AST001', actor)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException if asset status is DRAFT', async () => {
      prismaMock.asset.findFirst.mockResolvedValue({
        ...cryptoAsset,
        status: 'DRAFT',
      });

      await expect(service.provisionSystemWallets('AST001', actor)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('does NOT throw for PROVISIONING status', async () => {
      prismaMock.asset.findFirst.mockResolvedValue({ ...cryptoAsset, status: 'PROVISIONING' });
      prismaMock.wallet.findFirst.mockResolvedValue(null);
      prismaMock.wallet.create.mockImplementation(({ data }: any) =>
        Promise.resolve(makeWallet(data.walletRole, 1)),
      );

      await expect(service.provisionSystemWallets('AST001', actor)).resolves.not.toThrow();
    });

    it('does NOT throw for ACTIVE status', async () => {
      prismaMock.asset.findFirst.mockResolvedValue({ ...cryptoAsset, status: 'ACTIVE' });
      prismaMock.wallet.findFirst.mockResolvedValue(null);
      prismaMock.wallet.create.mockImplementation(({ data }: any) =>
        Promise.resolve(makeWallet(data.walletRole, 1)),
      );

      await expect(service.provisionSystemWallets('AST001', actor)).resolves.not.toThrow();
    });
  });

  // ─── Test 5: Rejects asset not found ──────────────────────────────────────

  describe('asset not found', () => {
    it('throws NotFoundException if asset does not exist', async () => {
      prismaMock.asset.findFirst.mockResolvedValue(null);

      await expect(service.provisionSystemWallets('NONEXISTENT', actor)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── Test 6: Audit log is recorded ────────────────────────────────────────

  describe('audit logging', () => {
    it('records audit log after provisioning', async () => {
      prismaMock.asset.findFirst.mockResolvedValue(cryptoAsset);
      prismaMock.wallet.findFirst.mockResolvedValue(null);
      let idx = 0;
      prismaMock.wallet.create.mockImplementation(({ data }: any) => {
        idx++;
        return Promise.resolve(makeWallet(data.walletRole, idx));
      });

      const result = await service.provisionSystemWallets('AST001', actor);

      expect(auditMock.recordByActor).toHaveBeenCalledTimes(1);

      const [auditInput, auditActor] = auditMock.recordByActor.mock.calls[0];

      expect(auditInput.action).toBe(
        AuditGovernanceActions.ASSET_LISTING.SYSTEM_WALLETS_PROVISIONED,
      );
      expect(auditInput.entityId).toBe(cryptoAsset.id);
      expect(auditInput.entityNo).toBe('AST001');
      expect(auditInput.result).toBe(AuditResult.SUCCESS);
      expect(auditInput.metadata.created).toHaveLength(result.created.length);
      expect(auditInput.metadata.skipped).toHaveLength(result.skipped.length);

      expect(auditActor.actorType).toBe('ADMIN');
      expect(auditActor.actorId).toBe(actor.userId);
      expect(auditActor.actorNo).toBe(actor.userNo);
      expect(auditActor.actorRole).toBe(actor.role);
    });

    it('records audit log even when all wallets are skipped', async () => {
      prismaMock.asset.findFirst.mockResolvedValue(cryptoAsset);
      prismaMock.wallet.findFirst.mockResolvedValue(makeWallet(WalletRole.C_MAIN, 1));

      await service.provisionSystemWallets('AST001', actor);

      expect(auditMock.recordByActor).toHaveBeenCalledTimes(1);
      const [auditInput] = auditMock.recordByActor.mock.calls[0];
      expect(auditInput.result).toBe(AuditResult.SUCCESS);
    });

    it('uses role fallback from roleCodes when actor.role is undefined', async () => {
      prismaMock.asset.findFirst.mockResolvedValue(cryptoAsset);
      prismaMock.wallet.findFirst.mockResolvedValue(null);
      let idx = 0;
      prismaMock.wallet.create.mockImplementation(({ data }: any) => {
        idx++;
        return Promise.resolve(makeWallet(data.walletRole, idx));
      });

      const actorNoRole: ApprovalActorContext = {
        actorType: 'ADMIN',
        userId: 'admin-user-2',
        userNo: 'ADM0002',
        roleCodes: ['COMPLIANCE_OFFICER'],
      };

      await service.provisionSystemWallets('AST001', actorNoRole);

      const [, auditActor] = auditMock.recordByActor.mock.calls[0];
      expect(auditActor.actorRole).toBe('COMPLIANCE_OFFICER');
    });

    it('uses UNKNOWN when actor has no role and no roleCodes', async () => {
      prismaMock.asset.findFirst.mockResolvedValue(cryptoAsset);
      prismaMock.wallet.findFirst.mockResolvedValue(null);
      let idx = 0;
      prismaMock.wallet.create.mockImplementation(({ data }: any) => {
        idx++;
        return Promise.resolve(makeWallet(data.walletRole, idx));
      });

      const actorNoRoleCodes: ApprovalActorContext = {
        actorType: 'ADMIN',
        userId: 'admin-user-3',
        roleCodes: [],
      };

      await service.provisionSystemWallets('AST001', actorNoRoleCodes);

      const [, auditActor] = auditMock.recordByActor.mock.calls[0];
      expect(auditActor.actorRole).toBe('UNKNOWN');
    });
  });
});
