import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { WithdrawalAddressService } from './withdrawal-address.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

describe('WithdrawalAddressService', () => {
  let service: WithdrawalAddressService;
  let prisma: any;

  const prismaMock = {
    withdrawalAddress: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    fundsOrder: {
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WithdrawalAddressService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get(WithdrawalAddressService);
    prisma = module.get(PrismaService);
  });

  const COOLING_MS = 24 * 60 * 60 * 1000;
  const THREE_STATE_SET = ['PENDING_VERIFICATION', 'PENDING_ACTIVATION', 'ACTIVE'];
  /** create 的 mock：回显入库实参 data —— 断言落在「写进库的是什么」，不是返回值 */
  const echoCreate = () => prismaMock.withdrawalAddress.create.mockImplementation(async ({ data }: any) => ({ id: 'wa-x', ...data }));
  const createdData = () => prismaMock.withdrawalAddress.create.mock.calls[0][0].data;
  const expectBetween = (d: Date, lo: number, hi: number) => {
    expect(d).toBeInstanceOf(Date);
    expect(d.getTime()).toBeGreaterThanOrEqual(lo);
    expect(d.getTime()).toBeLessThanOrEqual(hi);
  };

  describe('create', () => {
    const cryptoInput = (over: Record<string, unknown> = {}) => ({
      customerId: 'cust-1', customerNo: 'CUS001',
      network: 'TRON',
      address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      addressType: 'SELF_CUSTODY',
      ownerType: 'SELF', declaredHosting: 'SELF_CUSTODY', hostingMismatch: false, screeningAnswer: 'GREEN',
      traceId: 'trace-1',
      ...over,
    }) as any;

    beforeEach(() => {
      prismaMock.withdrawalAddress.count.mockResolvedValue(0);
      echoCreate();
    });

    // 2×2 落点：托管 × 受益人 → (证据档, 落点)，由主体层一次算出
    it.each([
      ['SELF_CUSTODY × SELF', 'SIGNATURE', 'PENDING_VERIFICATION', { ownerType: 'SELF', declaredHosting: 'SELF_CUSTODY' }],
      ['VASP × SELF', 'DECLARATION', 'PENDING_ACTIVATION', { ownerType: 'SELF', declaredHosting: 'VASP', addressType: 'VASP' }],
      ['SELF_CUSTODY × THIRD_PARTY', 'ATTESTATION', 'PENDING_ACTIVATION', { ownerType: 'THIRD_PARTY', declaredHosting: 'SELF_CUSTODY', beneficiaryName: 'Li Hua', beneficiaryRelationship: 'Spouse' }],
      ['VASP × THIRD_PARTY', 'ATTESTATION', 'PENDING_ACTIVATION', { ownerType: 'THIRD_PARTY', declaredHosting: 'VASP', addressType: 'VASP', beneficiaryName: 'Li Hua', beneficiaryRelationship: 'Spouse' }],
    ])('2x2 落点 %s → create 实参 proofType=%s status=%s', async (_label, proofType, status, over) => {
      await service.create(cryptoInput(over));

      const data = createdData();
      expect(data.ownershipProofType).toBe(proofType);
      expect(data.status).toBe(status);
      expect(data.ownerType).toBe((over as any).ownerType);
      expect(data.declaredHosting).toBe((over as any).declaredHosting);
      expect(data.screeningAnswer).toBe('GREEN');
      expect(data.ownershipVerifiedAt).toBeUndefined(); // 登记时未验证：仅 SIGNATURE 路径验证后才写
    });

    it('登记时刻落账：ownershipDeclaredAt / screenedAt = 登记时刻（调用方不再传 proofType / declaredAt）', async () => {
      const before = Date.now();
      await service.create(cryptoInput());
      const after = Date.now();

      const data = createdData();
      expectBetween(data.ownershipDeclaredAt, before, after);
      expectBetween(data.screenedAt, before, after);
    });

    it('PENDING_ACTIVATION 落点 activatesAt = 登记时刻 + 24h 冷却', async () => {
      const before = Date.now();
      await service.create(cryptoInput({ declaredHosting: 'VASP', addressType: 'VASP' }));
      const after = Date.now();

      const data = createdData();
      expect(data.status).toBe('PENDING_ACTIVATION');
      expectBetween(data.activatesAt, before + COOLING_MS, after + COOLING_MS);
    });

    it('screeningAnswer 原样透传（YELLOW 放行，落点仍照 2×2）', async () => {
      await service.create(cryptoInput({ screeningAnswer: 'YELLOW' }));

      const data = createdData();
      expect(data.screeningAnswer).toBe('YELLOW');
      expect(data.status).toBe('PENDING_VERIFICATION');
    });

    it('hostingMismatch / beneficiaryRelationship / 归因产物 原样入库', async () => {
      await service.create(cryptoInput({
        ownerType: 'THIRD_PARTY', beneficiaryName: 'Li Hua', beneficiaryRelationship: 'Spouse',
        hostingMismatch: true, addressType: 'VASP',
        counterpartyVaspName: 'Mock VASP Exchange', counterpartyVaspDid: 'did:mock:vasp-exchange-001',
      }));

      const data = createdData();
      expect(data.hostingMismatch).toBe(true);
      expect(data.beneficiaryName).toBe('Li Hua');
      expect(data.beneficiaryRelationship).toBe('Spouse');
      expect(data.addressType).toBe('VASP');
      expect(data.counterpartyVaspName).toBe('Mock VASP Exchange');
      expect(data.counterpartyVaspDid).toBe('did:mock:vasp-exchange-001');
    });

    it('RED → 登记即 REJECTED（插入即终态，非边）：无 activatedAt，screeningAnswer=RED、screenedAt 落账', async () => {
      const before = Date.now();
      await service.create(cryptoInput({ screeningAnswer: 'RED' }));
      const after = Date.now();

      const data = createdData();
      expect(data.status).toBe('REJECTED');
      expect(data.activatedAt ?? null).toBeNull();
      expect(data.screeningAnswer).toBe('RED');
      expectBetween(data.screenedAt, before, after);
    });

    it('RED 优先级压过 2×2 其余落点（VASP × SELF 本应进冷却，RED 仍 REJECTED）', async () => {
      await service.create(cryptoInput({ screeningAnswer: 'RED', declaredHosting: 'VASP', addressType: 'VASP' }));
      expect(createdData().status).toBe('REJECTED');
    });

    it('rejects when address limit reached，且上限计数集合 = 三个占坑态（PENDING_VERIFICATION 不漏数）', async () => {
      prismaMock.withdrawalAddress.count.mockResolvedValue(3);
      await expect(service.create(cryptoInput())).rejects.toThrow(BadRequestException);
      expect(prismaMock.withdrawalAddress.count).toHaveBeenCalledWith({
        where: { customerId: 'cust-1', network: 'TRON', status: { in: THREE_STATE_SET } },
      });
      expect(prismaMock.withdrawalAddress.create).not.toHaveBeenCalled();
    });

    it('上限行为：计数集合漏 PENDING_VERIFICATION 就会放行 → 满 3 条拒绝第 4 条', async () => {
      prismaMock.withdrawalAddress.count.mockImplementation(async ({ where }: any) => (where.status.in.includes('PENDING_VERIFICATION') ? 3 : 2));
      await expect(service.create(cryptoInput())).rejects.toMatchObject({ response: { code: 'ADDRESS_LIMIT_REACHED' } });
      expect(prismaMock.withdrawalAddress.create).not.toHaveBeenCalled();
    });

    it('rejects invalid address format', async () => {
      await expect(service.create(cryptoInput({ address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18' }))).rejects.toThrow(BadRequestException);
      expect(prismaMock.withdrawalAddress.create).not.toHaveBeenCalled();
    });

    it('rejects a bank-rail network for on-chain registration (NETWORK_NOT_CHAIN)', async () => {
      await expect(service.create(cryptoInput({ network: 'AED_ZAND', address: 'AE070860000000000000001' })))
        .rejects.toMatchObject({ response: { code: 'NETWORK_NOT_CHAIN' } });
    });
  });

  describe('createBankAccount', () => {
    const baseInput = (over: Record<string, unknown> = {}) => ({
      customerId: 'cust-1', customerNo: 'CUS001',
      iban: 'DE89370400440532013000',
      swiftBic: 'DEUTDEFF',
      bankName: 'Deutsche Bank',
      beneficiaryName: 'Alice Happy',
      ownerType: 'SELF', screeningAnswer: 'GREEN',
      traceId: 'trace-1',
      ...over,
    }) as any;

    beforeEach(() => {
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
      echoCreate();
    });

    it('first bank address (count→0) auto-activates: 回归钉——create 实参 status ACTIVE、activatedAt 非空、网络 AED_ZAND', async () => {
      prismaMock.withdrawalAddress.count.mockResolvedValue(0);

      const before = Date.now();
      const result = await service.createBankAccount(baseInput());
      const after = Date.now();

      const data = createdData();
      expect(data.status).toBe('ACTIVE');
      expectBetween(data.activatedAt, before, after);
      expectBetween(data.activatesAt, before, after); // 免冷却：activatesAt = 登记时刻
      expect(data.network).toBe('AED_ZAND');
      expect(data.ownershipProofType).toBe('DECLARATION');
      expect(data.ownerType).toBe('SELF');
      expect(data.screeningAnswer).toBe('GREEN');
      expectBetween(data.screenedAt, before, after);
      expectBetween(data.ownershipDeclaredAt, before, after);
      expect(result.status).toBe('ACTIVE');
    });

    it('second bank address (count→1) keeps PENDING_ACTIVATION with 24h cooling', async () => {
      prismaMock.withdrawalAddress.count.mockResolvedValue(1);

      const before = Date.now();
      await service.createBankAccount(baseInput());
      const after = Date.now();

      const data = createdData();
      expect(data.status).toBe('PENDING_ACTIVATION');
      expect(data.activatedAt).toBeNull();
      expectBetween(data.activatesAt, before + COOLING_MS, after + COOLING_MS);
    });

    it('RED 登记即 REJECTED 且压过首法币规则（首条传 RED 不得短路成 ACTIVE）', async () => {
      prismaMock.withdrawalAddress.count.mockResolvedValue(0);

      await service.createBankAccount(baseInput({ screeningAnswer: 'RED' }));

      const data = createdData();
      expect(data.status).toBe('REJECTED');
      expect(data.activatedAt ?? null).toBeNull();
      expect(data.screeningAnswer).toBe('RED');
      expect(data.screenedAt).toBeInstanceOf(Date);
    });

    it('第三方银行：ATTESTATION，beneficiaryRelationship 入库；首法币规则不区分受益人 → 首条仍 ACTIVE', async () => {
      prismaMock.withdrawalAddress.count.mockResolvedValue(0);

      await service.createBankAccount(baseInput({ ownerType: 'THIRD_PARTY', beneficiaryName: 'Li Hua', beneficiaryRelationship: 'Spouse' }));

      const data = createdData();
      expect(data.ownershipProofType).toBe('ATTESTATION');
      expect(data.ownerType).toBe('THIRD_PARTY');
      expect(data.beneficiaryName).toBe('Li Hua');
      expect(data.beneficiaryRelationship).toBe('Spouse');
      expect(data.status).toBe('ACTIVE');
    });

    it('银行 × 本人：DECLARATION；YELLOW 原样透传，不影响落点', async () => {
      prismaMock.withdrawalAddress.count.mockResolvedValue(1);

      await service.createBankAccount(baseInput({ screeningAnswer: 'YELLOW' }));

      const data = createdData();
      expect(data.ownershipProofType).toBe('DECLARATION');
      expect(data.screeningAnswer).toBe('YELLOW');
      expect(data.status).toBe('PENDING_ACTIVATION');
    });

    it('每网络上限计数集合 = 三个占坑态（与 crypto 同改）；首法币判定集合保持两态（银行不会落 PENDING_VERIFICATION）', async () => {
      prismaMock.withdrawalAddress.count.mockResolvedValue(0);

      await service.createBankAccount(baseInput());

      expect(prismaMock.withdrawalAddress.count).toHaveBeenCalledWith({
        where: { customerId: 'cust-1', network: 'AED_ZAND', status: { in: THREE_STATE_SET } },
      });
      expect(prismaMock.withdrawalAddress.count).toHaveBeenCalledWith({
        where: { customerId: 'cust-1', addressType: 'BANK', status: { in: ['PENDING_ACTIVATION', 'ACTIVE'] } },
      });
    });

    it('上限行为：计数集合漏 PENDING_VERIFICATION 就会放行 → 满 3 条拒绝', async () => {
      prismaMock.withdrawalAddress.count.mockImplementation(async ({ where }: any) => (where.status.in.includes('PENDING_VERIFICATION') ? 3 : 2));
      await expect(service.createBankAccount(baseInput())).rejects.toMatchObject({ response: { code: 'ADDRESS_LIMIT_REACHED' } });
      expect(prismaMock.withdrawalAddress.create).not.toHaveBeenCalled();
    });
  });

  describe('activate', () => {
    it('activates an expired PENDING_ACTIVATION address', async () => {
      const pastDate = new Date(Date.now() - 86400001);
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'PENDING_ACTIVATION', activatesAt: pastDate,
      });
      prismaMock.withdrawalAddress.update.mockResolvedValue({
        id: 'wa-1', status: 'ACTIVE', activatedAt: expect.any(Date),
      });
      const result = await service.activate('WAD001');
      expect(result.status).toBe('ACTIVE');
    });

    it('rejects activating an ACTIVE address (409 Invalid transition)', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'ACTIVE',
      });
      await expect(service.activate('WAD001')).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.withdrawalAddress.update).not.toHaveBeenCalled();
    });

    it('rejects activation before cooling period expires', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'PENDING_ACTIVATION', activatesAt: futureDate,
      });
      await expect(service.activate('WAD001')).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancel', () => {
    it('cancels a PENDING_ACTIVATION address', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'PENDING_ACTIVATION', customerId: 'cust-1',
      });
      prismaMock.withdrawalAddress.update.mockResolvedValue({ id: 'wa-1', status: 'CANCELLED' });
      const result = await service.cancel('WAD001', 'cust-1');
      expect(result.status).toBe('CANCELLED');
    });

    it('rejects cancel from wrong customer', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'PENDING_ACTIVATION', customerId: 'cust-1',
      });
      await expect(service.cancel('WAD001', 'cust-OTHER')).rejects.toThrow(ForbiddenException);
    });

    it('rejects cancel of non-PENDING address', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'ACTIVE', customerId: 'cust-1',
      });
      await expect(service.cancel('WAD001', 'cust-1')).rejects.toBeInstanceOf(ConflictException);
      await expect(service.cancel('WAD001', 'cust-1')).rejects.toThrow(/Invalid transition/);
    });
  });

  describe('suspend', () => {
    it('suspends an ACTIVE address', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'ACTIVE',
      });
      prismaMock.withdrawalAddress.update.mockResolvedValue({ id: 'wa-1', status: 'SUSPENDED' });
      const result = await service.suspend('WAD001', 'ADM001', 'Sanctioned address');
      expect(result.status).toBe('SUSPENDED');
    });

    it('rejects suspend of non-ACTIVE address', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'PENDING_ACTIVATION',
      });
      await expect(service.suspend('WAD001', 'ADM001', 'reason')).rejects.toBeInstanceOf(ConflictException);
      await expect(service.suspend('WAD001', 'ADM001', 'reason')).rejects.toThrow(/Invalid transition/);
    });
  });

  describe('unsuspend', () => {
    it('SUSPENDED → ACTIVE，清空三个 suspend 字段', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ addressNo: 'WAD1', status: 'SUSPENDED' });
      prismaMock.withdrawalAddress.update.mockResolvedValue({ addressNo: 'WAD1', status: 'ACTIVE' });
      const r = await service.unsuspend('WAD1');
      expect(r.status).toBe('ACTIVE');
      expect(prismaMock.withdrawalAddress.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { status: 'ACTIVE', suspendedAt: null, suspendedBy: null, suspendReason: null },
      }));
    });
    it('ACTIVE 不能 unsuspend → 409', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ addressNo: 'WAD1', status: 'ACTIVE' });
      await expect(service.unsuspend('WAD1')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('releaseToCooling', () => {
    // activatesAt 故意是 25h 前的旧值：release 必须自己重算，不能沿用登记时刻的值（否则拖 24h 后签名 = 零冷却）
    const pendingVerification = () => ({ addressNo: 'WAD1', status: 'PENDING_VERIFICATION', activatesAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });

    beforeEach(() => {
      prismaMock.withdrawalAddress.update.mockImplementation(async ({ data }: any) => ({ addressNo: 'WAD1', ...data }));
    });

    it('PENDING_VERIFICATION → PENDING_ACTIVATION，activatesAt 自 release 起重算 now+24h', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue(pendingVerification());

      const before = Date.now();
      const result = await service.releaseToCooling('WAD1');
      const after = Date.now();

      expect(prismaMock.withdrawalAddress.update).toHaveBeenCalledTimes(1);
      const call = prismaMock.withdrawalAddress.update.mock.calls[0][0];
      expect(call.where).toEqual({ addressNo: 'WAD1' });
      expect(Object.keys(call.data).sort()).toEqual(['activatesAt', 'status']);
      expect(call.data.status).toBe('PENDING_ACTIVATION');
      expectBetween(call.data.activatesAt, before + COOLING_MS, after + COOLING_MS);
      expect(result.status).toBe('PENDING_ACTIVATION');
    });

    it.each(['PENDING_ACTIVATION', 'ACTIVE', 'REJECTED'])('%s 不能 release → 409，不写库', async (status) => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ ...pendingVerification(), status });
      await expect(service.releaseToCooling('WAD1')).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.withdrawalAddress.update).not.toHaveBeenCalled();
    });

    it('带 tx 时读写全走 tx，不碰 this.prisma', async () => {
      const tx = {
        withdrawalAddress: {
          findUnique: jest.fn().mockResolvedValue(pendingVerification()),
          update: jest.fn().mockResolvedValue({ addressNo: 'WAD1', status: 'PENDING_ACTIVATION' }),
        },
      };
      await service.releaseToCooling('WAD1', tx);
      expect(tx.withdrawalAddress.update).toHaveBeenCalledTimes(1);
      expect(prismaMock.withdrawalAddress.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.withdrawalAddress.update).not.toHaveBeenCalled();
    });
  });

  describe('rejectByScreening', () => {
    it.each(['PENDING_VERIFICATION', 'PENDING_ACTIVATION'])('%s → REJECTED，并写 screeningAnswer=RED / screenedAt', async (status) => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ addressNo: 'WAD1', status });
      prismaMock.withdrawalAddress.update.mockImplementation(async ({ data }: any) => ({ addressNo: 'WAD1', ...data }));

      const result = await service.rejectByScreening('WAD1');

      expect(prismaMock.withdrawalAddress.update).toHaveBeenCalledWith({
        where: { addressNo: 'WAD1' },
        data: { status: 'REJECTED', screeningAnswer: 'RED', screenedAt: expect.any(Date) },
      });
      expect(result.status).toBe('REJECTED');
    });

    it.each(['ACTIVE', 'SUSPENDED', 'CANCELLED', 'REJECTED'])('%s 不能 reject → 409（⚡不能把非 pending 态直写成 REJECTED）', async (status) => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ addressNo: 'WAD1', status });
      await expect(service.rejectByScreening('WAD1')).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.withdrawalAddress.update).not.toHaveBeenCalled();
    });

    it('带 tx 时读写全走 tx', async () => {
      const tx = {
        withdrawalAddress: {
          findUnique: jest.fn().mockResolvedValue({ addressNo: 'WAD1', status: 'PENDING_VERIFICATION' }),
          update: jest.fn().mockResolvedValue({ addressNo: 'WAD1', status: 'REJECTED' }),
        },
      };
      await service.rejectByScreening('WAD1', tx);
      expect(tx.withdrawalAddress.update).toHaveBeenCalledTimes(1);
      expect(prismaMock.withdrawalAddress.update).not.toHaveBeenCalled();
    });
  });

  describe('recordScreening', () => {
    it.each([
      ['PENDING_VERIFICATION', 'GREEN'],
      ['PENDING_ACTIVATION', 'YELLOW'],
    ])('%s 行喂 %s：只写 screeningAnswer / screenedAt，不迁移状态', async (status, answer) => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ addressNo: 'WAD1', status });
      prismaMock.withdrawalAddress.update.mockImplementation(async ({ data }: any) => ({ addressNo: 'WAD1', status, ...data }));

      const result = await service.recordScreening('WAD1', answer as 'GREEN' | 'YELLOW');

      expect(prismaMock.withdrawalAddress.update).toHaveBeenCalledWith({
        where: { addressNo: 'WAD1' },
        data: { screeningAnswer: answer, screenedAt: expect.any(Date) },
      });
      expect(result.status).toBe(status);
    });

    it.each(['ACTIVE', 'SUSPENDED', 'CANCELLED', 'DEACTIVATED', 'REJECTED'])('%s 非 pending → 409 ADDRESS_NOT_PENDING，不写库', async (status) => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ addressNo: 'WAD1', status });
      const attempt = service.recordScreening('WAD1', 'GREEN');
      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toMatchObject({ response: { code: 'ADDRESS_NOT_PENDING' } });
      expect(prismaMock.withdrawalAddress.update).not.toHaveBeenCalled();
    });
  });

  describe('verifyOwnershipSignature', () => {
    const row = (over: Record<string, unknown> = {}) => ({
      addressNo: 'WAD1', customerId: 'cust-1', status: 'PENDING_VERIFICATION',
      ownershipProofType: 'SIGNATURE', ownershipVerifiedAt: null,
      activatesAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      ...over,
    });

    beforeEach(() => {
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
      prismaMock.withdrawalAddress.update.mockImplementation(async ({ data }: any) => ({ addressNo: 'WAD1', ...data }));
    });

    it('本人签名：先写 ownershipVerifiedAt，再走 RELEASE 边进冷却（activatesAt 重算），返回更新行', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue(row());

      const before = Date.now();
      const result = await service.verifyOwnershipSignature('WAD1', 'cust-1');
      const after = Date.now();

      expect(prismaMock.withdrawalAddress.update).toHaveBeenCalledTimes(2);
      expect(prismaMock.withdrawalAddress.update.mock.calls[0][0]).toEqual({
        where: { addressNo: 'WAD1' },
        data: { ownershipVerifiedAt: expect.any(Date) },
      });
      const release = prismaMock.withdrawalAddress.update.mock.calls[1][0];
      expect(release.where).toEqual({ addressNo: 'WAD1' });
      expect(release.data.status).toBe('PENDING_ACTIVATION');
      expectBetween(release.data.activatesAt, before + COOLING_MS, after + COOLING_MS);
      expect(result.status).toBe('PENDING_ACTIVATION');
      expectBetween(prismaMock.withdrawalAddress.update.mock.calls[0][0].data.ownershipVerifiedAt, before, after);
    });

    it('非本人 → 403 NOT_OWNER，不写库', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue(row({ customerId: 'cust-OTHER' }));
      await expect(service.verifyOwnershipSignature('WAD1', 'cust-1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.withdrawalAddress.update).not.toHaveBeenCalled();
    });

    // 守卫三条各自独立：每个用例只破坏一条，漏掉任何一条守卫都会变红
    it.each([
      ['证据档非 SIGNATURE（ATTESTATION）', { ownershipProofType: 'ATTESTATION' }],
      ['证据档非 SIGNATURE（DECLARATION）', { ownershipProofType: 'DECLARATION' }],
      ['已不在 PENDING_VERIFICATION（已 release 过）', { status: 'PENDING_ACTIVATION' }],
      ['已验证过', { ownershipVerifiedAt: new Date() }],
    ])('%s → 409 SIGNATURE_NOT_APPLICABLE，不写库', async (_label, over) => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue(row(over));
      const attempt = service.verifyOwnershipSignature('WAD1', 'cust-1');
      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toMatchObject({ response: { code: 'SIGNATURE_NOT_APPLICABLE' } });
      expect(prismaMock.withdrawalAddress.update).not.toHaveBeenCalled();
    });
  });

  describe('updateDetails', () => {
    it('只改 label：update 实参 data 恰为 {label}，地址本身不动', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ addressNo: 'WAD1', customerId: 'cust-1', status: 'ACTIVE', label: 'old' });
      prismaMock.withdrawalAddress.update.mockResolvedValue({ addressNo: 'WAD1', label: 'Ledger' });
      await service.updateDetails('WAD1', 'cust-1', { label: 'Ledger' });
      expect(prismaMock.withdrawalAddress.update).toHaveBeenCalledWith({ where: { addressNo: 'WAD1' }, data: { label: 'Ledger' } });
    });

    it('patch 夹带 beneficiaryName（越过类型收窄）也不落库——申报证据字段登记后冻结', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ addressNo: 'WAD1', customerId: 'cust-1', status: 'ACTIVE', label: 'old' });
      prismaMock.withdrawalAddress.update.mockResolvedValue({ addressNo: 'WAD1', label: 'Ledger' });
      await service.updateDetails('WAD1', 'cust-1', { label: 'Ledger', beneficiaryName: 'Evil Rewrite' } as any);
      expect(prismaMock.withdrawalAddress.update).toHaveBeenCalledWith({ where: { addressNo: 'WAD1' }, data: { label: 'Ledger' } });
    });

    it('PENDING_VERIFICATION（未终态）仍可改 label', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ addressNo: 'WAD1', customerId: 'cust-1', status: 'PENDING_VERIFICATION' });
      prismaMock.withdrawalAddress.update.mockResolvedValue({ addressNo: 'WAD1', label: 'x' });
      await service.updateDetails('WAD1', 'cust-1', { label: 'x' });
      expect(prismaMock.withdrawalAddress.update).toHaveBeenCalledTimes(1);
    });

    it.each(['CANCELLED', 'DEACTIVATED', 'REJECTED'])('终态 %s 不可改 → 409 ADDRESS_TERMINAL，不写库', async (status) => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ addressNo: 'WAD1', customerId: 'cust-1', status });
      const attempt = service.updateDetails('WAD1', 'cust-1', { label: 'x' });
      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toMatchObject({ response: { code: 'ADDRESS_TERMINAL' } });
      expect(prismaMock.withdrawalAddress.update).not.toHaveBeenCalled();
    });

    it('别人的地址 → 403', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ addressNo: 'WAD1', customerId: 'cust-2', status: 'ACTIVE' });
      await expect(service.updateDetails('WAD1', 'cust-1', { label: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.withdrawalAddress.update).not.toHaveBeenCalled();
    });

    it('没给 label → 400，不写库', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ addressNo: 'WAD1', customerId: 'cust-1', status: 'ACTIVE' });
      await expect(service.updateDetails('WAD1', 'cust-1', {})).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.withdrawalAddress.update).not.toHaveBeenCalled();
    });
  });

  describe('listAll', () => {
    it('q → OR[addressNo/address/iban contains],customerName 由 customer 关联铺平', async () => {
      prisma.withdrawalAddress.findMany.mockResolvedValue([
        { id: 'a1', addressNo: 'ADDR1', customerNo: 'CU1', label: 'My Binance',
          customer: { firstName: 'Alice', lastName: 'Happy' } },
        { id: 'a2', addressNo: 'ADDR2', customerNo: 'CU2', label: null,
          customer: { firstName: null, lastName: null } },
      ]);
      prisma.withdrawalAddress.count.mockResolvedValue(2);

      const result = await service.listAll({ q: 'TVx9', take: 50, skip: 0 } as any);
      const where = prisma.withdrawalAddress.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { addressNo: { contains: 'TVx9' } },
        { address: { contains: 'TVx9' } },
        { iban: { contains: 'TVx9' } },
      ]);
      expect(result.items[0].customerName).toBe('Alice Happy');
      expect(result.items[1].customerName).toBeNull();
      expect(result.items[0].customer).toBeUndefined(); // 关联对象不泄给前端
    });
  });

  describe('hasActiveFiatWithdrawalAddress', () => {
    it('returns true when customer has ≥1 active BANK address', async () => {
      prismaMock.withdrawalAddress.count.mockResolvedValue(1);
      const result = await service.hasActiveFiatWithdrawalAddress('cust-1');
      expect(result).toBe(true);
      expect(prismaMock.withdrawalAddress.count).toHaveBeenCalledWith({
        where: { customerId: 'cust-1', status: 'ACTIVE', addressType: 'BANK' },
      });
    });

    it('returns false when customer has no active BANK address', async () => {
      prismaMock.withdrawalAddress.count.mockResolvedValue(0);
      const result = await service.hasActiveFiatWithdrawalAddress('cust-1');
      expect(result).toBe(false);
    });
  });

  describe('countActiveFiatAddresses', () => {
    it('returns the count of active BANK addresses', async () => {
      prismaMock.withdrawalAddress.count.mockResolvedValue(3);
      const result = await service.countActiveFiatAddresses('cust-1');
      expect(result).toBe(3);
      expect(prismaMock.withdrawalAddress.count).toHaveBeenCalledWith({
        where: { customerId: 'cust-1', status: 'ACTIVE', addressType: 'BANK' },
      });
    });
  });

  describe('deactivate', () => {
    const activeBankAddr = {
      id: 'wa-1', addressNo: 'WAD001', customerId: 'cust-1',
      status: 'ACTIVE', addressType: 'BANK', iban: 'DE89370400440532013000', address: 'DE89370400440532013000',
    };
    const activeCryptoAddr = {
      id: 'wa-2', addressNo: 'WAD002', customerId: 'cust-1',
      status: 'ACTIVE', addressType: 'SELF_CUSTODY', iban: null, address: '0xabc123',
    };

    it('rejects deactivating the last active fiat (BANK) address', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue(activeBankAddr);
      prismaMock.withdrawalAddress.count.mockResolvedValue(1); // countActiveFiatAddresses <= 1

      await expect(service.deactivate('WAD001', 'cust-1')).rejects.toThrow(BadRequestException);
      await expect(service.deactivate('WAD001', 'cust-1')).rejects.toMatchObject({
        response: { code: 'LAST_ACTIVE_FIAT_ADDRESS' },
      });
      expect(prismaMock.withdrawalAddress.update).not.toHaveBeenCalled();
    });

    it('rejects deactivating an address with an in-flight withdrawal', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue(activeCryptoAddr);
      prismaMock.fundsOrder.count.mockResolvedValue(1);

      await expect(service.deactivate('WAD002', 'cust-1')).rejects.toThrow(BadRequestException);
      await expect(service.deactivate('WAD002', 'cust-1')).rejects.toMatchObject({
        response: { code: 'ADDRESS_HAS_INFLIGHT_WITHDRAWAL' },
      });
      expect(prismaMock.withdrawalAddress.update).not.toHaveBeenCalled();
    });

    it('deactivates an ACTIVE non-last address with no in-flight withdrawal', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue(activeCryptoAddr);
      prismaMock.fundsOrder.count.mockResolvedValue(0);
      prismaMock.withdrawalAddress.update.mockResolvedValue({
        id: 'wa-2', addressNo: 'WAD002', status: 'DEACTIVATED', deactivatedAt: new Date(), deactivatedBy: 'CUSTOMER',
      });

      const result = await service.deactivate('WAD002', 'cust-1');

      expect(result.status).toBe('DEACTIVATED');
      expect(result.deactivatedBy).toBe('CUSTOMER');
      expect(prismaMock.withdrawalAddress.update).toHaveBeenCalledWith({
        where: { id: 'wa-2' },
        data: { status: 'DEACTIVATED', deactivatedAt: expect.any(Date), deactivatedBy: 'CUSTOMER' },
      });
    });

    it('rejects deactivating a non-ACTIVE address', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        ...activeCryptoAddr, status: 'PENDING_ACTIVATION',
      });

      await expect(service.deactivate('WAD002', 'cust-1')).rejects.toBeInstanceOf(ConflictException);
      await expect(service.deactivate('WAD002', 'cust-1')).rejects.toThrow(/Invalid transition/);
      expect(prismaMock.withdrawalAddress.update).not.toHaveBeenCalled();
    });

    it('rejects when address not found or not owned by customer', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue(null);
      await expect(service.deactivate('WAD999', 'cust-1')).rejects.toThrow(NotFoundException);

      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ ...activeCryptoAddr, customerId: 'cust-OTHER' });
      await expect(service.deactivate('WAD002', 'cust-1')).rejects.toThrow(NotFoundException);
    });
  });
});
