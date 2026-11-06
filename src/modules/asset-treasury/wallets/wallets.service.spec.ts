import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { WalletsService, WALLET_STATUS_TRANSITIONS } from './wallets.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { WalletCashAccountService } from '../../accounting/tigerbeetle/wallet-cash-account.service';

const prismaMock = {
  wallet: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
};
const walletCashMock = { ensureForWallet: jest.fn() };

describe('WalletsService（波一 · 地址行）', () => {
  let service: WalletsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: WalletCashAccountService, useValue: walletCashMock },
      ],
    }).compile();
    service = module.get(WalletsService);
  });

  describe('迁移表', () => {
    it('只有 CREATING → ACTIVE | FAILED 两条边，ACTIVE / FAILED 是终态', () => {
      expect(WALLET_STATUS_TRANSITIONS).toEqual({ CREATING: ['ACTIVE', 'FAILED'], ACTIVE: [], FAILED: [] });
    });
    it('transitionStatus 拒绝 ACTIVE → FAILED（409 Invalid / Illegal transition）', async () => {
      await expect(service.transitionStatus('WA1', 'ACTIVE', 'FAILED')).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.wallet.update).not.toHaveBeenCalled();
    });
    it('transitionStatus 的 from 绑定 DB 读值：行是 ACTIVE 却声称 CREATING → 409', async () => {
      prismaMock.wallet.findFirst.mockResolvedValue({ id: 'w1', walletNo: 'WA1', status: 'ACTIVE' });
      await expect(service.transitionStatus('WA1', 'CREATING', 'ACTIVE')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('createWalletRecord', () => {
    const base = { ownerType: 'CUSTOMER' as const, ownerId: 'c1', ownerNo: 'CU001', vaultCode: 'CLIENT_DEPOSIT', walletRole: 'C_DEP', network: 'TRON', status: 'CREATING' as const };

    it('拒绝未注册网络', async () => {
      await expect(service.createWalletRecord({ ...base, network: 'FIAT' })).rejects.toBeInstanceOf(BadRequestException);
    });
    it('拒绝 vault 在该网络没有槽位（F_SET × TRON）', async () => {
      await expect(service.createWalletRecord({ ...base, ownerType: 'PLATFORM', ownerNo: 'PLATFORM', vaultCode: 'F_SET', walletRole: 'F_SET' })).rejects.toThrow(/no address slot/);
    });
    it('拒绝 vault 归属类型与 ownerType 不符（客户开 F_OPS）', async () => {
      await expect(service.createWalletRecord({ ...base, vaultCode: 'F_OPS', walletRole: 'F_OPS' })).rejects.toThrow(/PLATFORM-owned/);
    });
    it('合法输入：写入 WA 开头的 walletNo，平台行 ownerId 置 null', async () => {
      prismaMock.wallet.create.mockImplementation(async ({ data }: any) => data);
      const row: any = await service.createWalletRecord({ ...base, ownerType: 'PLATFORM', ownerId: 'should-be-dropped', ownerNo: 'PLATFORM', vaultCode: 'F_OPS', walletRole: 'F_OPS', status: 'ACTIVE' });
      expect(row.walletNo).toMatch(/^WA\d{12}$/);
      expect(row.ownerId).toBeNull();
      expect(row.network).toBe('TRON');
    });
  });

  // 戊波一 §2.3：钱包到 ACTIVE 才有现金户。两个建 ACTIVE 的口子（直接建 ACTIVE / CREATING→ACTIVE）都开户，同一事务。
  describe('现金户开户钩子', () => {
    const base = { ownerType: 'CUSTOMER' as const, ownerId: 'c1', ownerNo: 'CU001', vaultCode: 'CLIENT_DEPOSIT', walletRole: 'C_DEP', network: 'TRON' };

    it('createWalletRecord 以 ACTIVE 建行 → 用建出的行与同一 tx 调 ensureForWallet', async () => {
      prismaMock.wallet.create.mockImplementation(async ({ data }: any) => ({ id: 'w-new', ...data }));
      const tx: any = { wallet: { create: prismaMock.wallet.create } };
      const row: any = await service.createWalletRecord({ ...base, status: 'ACTIVE' }, tx);
      expect(walletCashMock.ensureForWallet).toHaveBeenCalledTimes(1);
      expect(walletCashMock.ensureForWallet).toHaveBeenCalledWith(row, tx);
      expect(row.id).toBe('w-new');
    });

    it('createWalletRecord 以 CREATING 建行 → 不开户', async () => {
      prismaMock.wallet.create.mockImplementation(async ({ data }: any) => ({ id: 'w-new', ...data }));
      await service.createWalletRecord({ ...base, status: 'CREATING' });
      expect(walletCashMock.ensureForWallet).not.toHaveBeenCalled();
    });

    it('transitionStatus CREATING → ACTIVE → 用更新后的行（含 custodian 回写的地址）与 tx 调 ensureForWallet', async () => {
      prismaMock.wallet.findFirst.mockResolvedValue({ id: 'w1', walletNo: 'WA1', status: 'CREATING' });
      prismaMock.wallet.update.mockImplementation(async ({ data }: any) => ({ id: 'w1', walletNo: 'WA1', ownerType: 'CUSTOMER', ...data }));
      const tx: any = { wallet: { findFirst: prismaMock.wallet.findFirst, update: prismaMock.wallet.update } };
      const row: any = await service.transitionStatus('WA1', 'CREATING', 'ACTIVE', { address: 'Tabc' }, tx);
      expect(walletCashMock.ensureForWallet).toHaveBeenCalledTimes(1);
      expect(walletCashMock.ensureForWallet).toHaveBeenCalledWith(row, tx);
      expect(row.address).toBe('Tabc');
    });

    it('transitionStatus CREATING → FAILED → 不开户', async () => {
      prismaMock.wallet.findFirst.mockResolvedValue({ id: 'w1', walletNo: 'WA1', status: 'CREATING' });
      prismaMock.wallet.update.mockImplementation(async ({ data }: any) => ({ id: 'w1', walletNo: 'WA1', ...data }));
      await service.transitionStatus('WA1', 'CREATING', 'FAILED');
      expect(walletCashMock.ensureForWallet).not.toHaveBeenCalled();
    });
  });

  describe('findCustomerWalletByDestination', () => {
    it('链上按 (network, address) 找，法币按 (network, iban) 找，只认 CLIENT_DEPOSIT', async () => {
      prismaMock.wallet.findFirst.mockResolvedValue(null);
      await service.findCustomerWalletByDestination('TRON', { address: 'Tabc' });
      expect(prismaMock.wallet.findFirst).toHaveBeenLastCalledWith({ where: { network: 'TRON', ownerType: 'CUSTOMER', vaultCode: 'CLIENT_DEPOSIT', address: 'Tabc' } });
      await service.findCustomerWalletByDestination('AED_ZAND', { iban: 'AE07086' });
      expect(prismaMock.wallet.findFirst).toHaveBeenLastCalledWith({ where: { network: 'AED_ZAND', ownerType: 'CUSTOMER', vaultCode: 'CLIENT_DEPOSIT', iban: 'AE07086' } });
    });
  });
});
