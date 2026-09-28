import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LpProfileService } from './lp-profile.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { CreateLpProfileDto, LpProfileStatus } from './dto/lp-profile.dto';

const treasury: ApprovalActorContext = { actorType: 'ADMIN', userId: 'uuid-treasury', userNo: 'ADM-TREASURY', roleCodes: ['TREASURY'] };

const baseCreateDto: CreateLpProfileDto = {
  name: 'Falcon Liquidity FZE',
  fiatBankName: 'Emirates NBD',
  fiatIban: 'AE070331234567890123456',
  cryptoNetwork: 'TRON',
  cryptoAddress: 'TXfake00000000000000000000000001',
  agreementRef: 'AGR-2026-LP-001',
  reason: 'Onboarding a new AED/USDT liquidity corridor',
};

/** 行为化内存行 mock（照 responsible-individuals.service.spec.ts 的 makePrisma 先例）。
 *  clock 用递增计数器而非 `new Date()`——同一 tick 内连续两次 create 可能落在同一毫秒，
 *  会让 list() 的 createdAt desc 排序断言假红（时钟粒度伪象，不是被测行为的缺陷）。 */
function makePrisma(): { liquidityProvider: Record<string, jest.Mock> } {
  const rows = new Map<string, any>();
  let clock = Date.parse('2026-09-29T00:00:00.000Z');
  const tick = () => new Date((clock += 1000));
  return {
    liquidityProvider: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: randomUUID(), approvalNo: null, createdAt: tick(), updatedAt: tick(), ...data };
        rows.set(row.lpNo, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = rows.get(where.lpNo);
        if (!existing) throw new Error(`no such row: ${where.lpNo}`);
        const updated = { ...existing, ...data, updatedAt: tick() };
        rows.set(where.lpNo, updated);
        return updated;
      }),
      findUnique: jest.fn(async ({ where }: any) => rows.get(where.lpNo) ?? null),
      findMany: jest.fn(async () => [...rows.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())),
    },
  };
}

describe('LpProfileService (乙波一 T2)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: LpProfileService;
  let auditLogs: { recordByActor: jest.Mock; recordSystem: jest.Mock };

  beforeEach(async () => {
    prisma = makePrisma();
    auditLogs = { recordByActor: jest.fn(async () => ({})), recordSystem: jest.fn(async () => ({})) };
    const mod = await Test.createTestingModule({
      providers: [
        LpProfileService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = mod.get(LpProfileService);
  });

  function actionsOf(): string[] {
    return [...auditLogs.recordByActor.mock.calls, ...auditLogs.recordSystem.mock.calls].map((c) => c[0].action);
  }

  async function createProfile(overrides: Partial<CreateLpProfileDto> = {}): Promise<string> {
    const row = await service.create(treasury, { ...baseCreateDto, ...overrides });
    return row.lpNo;
  }

  /** 走完整批准弧：PENDING_APPROVAL → ACTIVE（系统写审计，同 Task 3 的裁决回调）。 */
  async function activate(lpNo: string, approvalNo = 'APR260101000001'): Promise<void> {
    await service.transition(lpNo, LpProfileStatus.ACTIVE, {}, { approvalNo, causationId: randomUUID() });
  }

  // ── create ──────────────────────────────────────────────────────────
  describe('create', () => {
    it('writes an LPP-prefixed row, PENDING_APPROVAL, and records LP_PROFILE_CREATED carrying reason (actor-driven)', async () => {
      const lpNo = await createProfile();
      expect(lpNo).toMatch(/^LPP\d{12}$/);

      const row = await service.findByNo(lpNo);
      expect(row.status).toBe(LpProfileStatus.PENDING_APPROVAL);
      expect(row.name).toBe('Falcon Liquidity FZE');
      expect(row.createdByUserId).toBe('ADM-TREASURY');
      expect(row.approvalNo).toBeNull();

      expect(actionsOf()).toEqual(['LP_PROFILE_CREATED']);
      expect(auditLogs.recordSystem).not.toHaveBeenCalled();
      const call = auditLogs.recordByActor.mock.calls[0][0];
      expect(call).toMatchObject({
        actionDomain: 'TREASURY',
        primarySubjectType: 'LIQUIDITY_PROVIDER',
        primarySubjectNo: lpNo,
        reason: 'Onboarding a new AED/USDT liquidity corridor',
      });
      expect(call.correlationId).toBeUndefined(); // CREATED 起旅程（NONE），不传 correlationId
      expect(call.requestId).toEqual(expect.stringContaining(`LP_PROFILE_CREATED_${lpNo}_`));
      expect(call.subjects).toEqual([{ subjectType: 'LIQUIDITY_PROVIDER', subjectNo: lpNo, subjectRole: 'PRIMARY' }]);
    });

    it('findByNo throws NotFoundException for an unknown lpNo', async () => {
      await expect(service.findByNo('LPP000000000000')).rejects.toThrow(NotFoundException);
    });
  });

  // ── transition：四态四边 + 失败测试（简报 Step 6，禁扫文本，走真迁移表） ─────
  describe('transition (real LP_PROFILE_TRANSITIONS table)', () => {
    it('rejects PENDING_APPROVAL → SUSPENDED', async () => {
      const lpNo = await createProfile();
      await expect(service.transition(lpNo, LpProfileStatus.SUSPENDED)).rejects.toThrow(/Illegal/);
    });

    it('rejects settlement change while SUSPENDED', async () => {
      const lpNo = await createProfile();
      await activate(lpNo);
      await service.transition(lpNo, LpProfileStatus.SUSPENDED, {}, { actor: treasury, reason: 'Underperforming this quarter' });
      await expect(
        service.applySettlementChange(lpNo, { fiatIban: 'AE070331234567890999999', approvalNo: 'APR260101000002' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('REJECTED is terminal (no out-edges)', async () => {
      const lpNo = await createProfile();
      await service.transition(lpNo, LpProfileStatus.REJECTED, {}, { approvalNo: 'APR260101000001', causationId: randomUUID() });
      const row = await service.findByNo(lpNo);
      expect(row.status).toBe(LpProfileStatus.REJECTED);
      await expect(service.transition(lpNo, LpProfileStatus.ACTIVE)).rejects.toThrow(/Illegal/);
    });

    it('assertActiveByNo throws for SUSPENDED profile', async () => {
      const lpNo = await createProfile();
      await activate(lpNo);
      await service.transition(lpNo, LpProfileStatus.SUSPENDED, {}, { actor: treasury, reason: 'Underperforming this quarter' });
      await expect(service.assertActiveByNo(lpNo)).rejects.toThrow(BadRequestException);
    });

    it('assertActiveByNo resolves silently for an ACTIVE profile', async () => {
      const lpNo = await createProfile();
      await activate(lpNo);
      await expect(service.assertActiveByNo(lpNo)).resolves.toBeUndefined();
    });

    it('PENDING_APPROVAL → ACTIVE records LP_PROFILE_APPROVED via recordSystem with approvalNo/causationId and correlationId=lpNo', async () => {
      const lpNo = await createProfile();
      auditLogs.recordByActor.mockClear();
      await activate(lpNo, 'APR260101000099');

      expect(auditLogs.recordByActor).not.toHaveBeenCalled(); // 裁决回调无 actor,走系统写
      const call = auditLogs.recordSystem.mock.calls.find((c) => c[0].action === 'LP_PROFILE_APPROVED')![0];
      expect(call).toMatchObject({
        actionDomain: 'TREASURY', fromStatus: 'PENDING_APPROVAL', toStatus: 'ACTIVE',
        approvalNo: 'APR260101000099', correlationId: lpNo,
      });
      expect(call.causationId).toEqual(expect.any(String));
      expect(call.subjects).toEqual(expect.arrayContaining([
        { subjectType: 'APPROVAL_CASE', subjectNo: 'APR260101000099', subjectRole: 'INSTRUMENT' },
      ]));
    });

    it('PENDING_APPROVAL → REJECTED records LP_PROFILE_REJECTED and the row stays REJECTED', async () => {
      const lpNo = await createProfile();
      await service.transition(lpNo, LpProfileStatus.REJECTED, {}, { approvalNo: 'APR260101000001', causationId: randomUUID() });
      const row = await service.findByNo(lpNo);
      expect(row.status).toBe(LpProfileStatus.REJECTED);
      expect(actionsOf()).toEqual(['LP_PROFILE_CREATED', 'LP_PROFILE_REJECTED']);
    });

    it('ACTIVE → SUSPENDED → ACTIVE round-trips via actor (SUSPENDED then REACTIVATED, both recordByActor)', async () => {
      const lpNo = await createProfile();
      await activate(lpNo);
      auditLogs.recordByActor.mockClear();
      auditLogs.recordSystem.mockClear();

      await service.transition(lpNo, LpProfileStatus.SUSPENDED, {}, { actor: treasury, reason: 'Underperforming this quarter' });
      expect((await service.findByNo(lpNo)).status).toBe(LpProfileStatus.SUSPENDED);

      await service.transition(lpNo, LpProfileStatus.ACTIVE, {}, { actor: treasury, reason: 'Back in good standing' });
      expect((await service.findByNo(lpNo)).status).toBe(LpProfileStatus.ACTIVE);

      const calls = auditLogs.recordByActor.mock.calls.map((c) => c[0]);
      expect(calls.map((c) => c.action)).toEqual(['LP_PROFILE_SUSPENDED', 'LP_PROFILE_REACTIVATED']);
      expect(calls[0]).toMatchObject({ reason: 'Underperforming this quarter', fromStatus: 'ACTIVE', toStatus: 'SUSPENDED' });
      expect(calls[1]).toMatchObject({ reason: 'Back in good standing', fromStatus: 'SUSPENDED', toStatus: 'ACTIVE' });
      expect(auditLogs.recordSystem).not.toHaveBeenCalled(); // suspend/reactivate 全走 actor
    });
  });

  // ── stampApprovalNo ─────────────────────────────────────────────────
  describe('stampApprovalNo', () => {
    it('回填 approvalNo,不写审计(照划转单同名方法先例)', async () => {
      const lpNo = await createProfile();
      await service.stampApprovalNo(lpNo, 'APR260101000001');
      expect((await service.findByNo(lpNo)).approvalNo).toBe('APR260101000001');
      expect(actionsOf()).toEqual(['LP_PROFILE_CREATED']); // 未多写一条审计
    });
  });

  // ── applySettlementChange：只许 ACTIVE ───────────────────────────────
  describe('applySettlementChange', () => {
    it('rejects while PENDING_APPROVAL (profile not yet ACTIVE)', async () => {
      const lpNo = await createProfile();
      await expect(
        service.applySettlementChange(lpNo, { fiatIban: 'AE070331234567890999999', approvalNo: 'APR260101000002' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('while ACTIVE: patches only the given coordinate fields, stamps approvalNo, and records LP_PROFILE_CHANGE_APPLIED with before/after in metadata', async () => {
      const lpNo = await createProfile();
      await activate(lpNo);
      const causationId = randomUUID();

      const updated = await service.applySettlementChange(lpNo, {
        fiatIban: 'AE070331234567890999999',
        approvalNo: 'APR260101000002',
        causationId,
      });
      expect(updated.fiatIban).toBe('AE070331234567890999999');
      expect(updated.fiatBankName).toBe('Emirates NBD'); // 未传的坐标字段原样不动
      expect(updated.cryptoAddress).toBe('TXfake00000000000000000000000001');
      expect(updated.approvalNo).toBe('APR260101000002');
      expect(updated.status).toBe(LpProfileStatus.ACTIVE); // 改坐标不动状态

      const call = auditLogs.recordSystem.mock.calls.find((c) => c[0].action === 'LP_PROFILE_CHANGE_APPLIED')![0];
      expect(call).toMatchObject({ approvalNo: 'APR260101000002', causationId });
      expect(call.metadata.before).toMatchObject({ fiatIban: 'AE070331234567890123456' });
      expect(call.metadata.after).toMatchObject({ fiatIban: 'AE070331234567890999999' });
    });
  });

  // ── toView / list：零 UUID 投影 ───────────────────────────────────────
  describe('toView / list', () => {
    it('toView projects business fields only — no id key present', async () => {
      const lpNo = await createProfile();
      const row = await service.findByNo(lpNo);
      const view = service.toView(row);
      expect(view).toEqual({
        lpNo, name: 'Falcon Liquidity FZE',
        fiatBankName: 'Emirates NBD', fiatIban: 'AE070331234567890123456',
        cryptoNetwork: 'TRON', cryptoAddress: 'TXfake00000000000000000000000001',
        agreementRef: 'AGR-2026-LP-001', status: LpProfileStatus.PENDING_APPROVAL,
        approvalNo: null, createdBy: 'ADM-TREASURY', createdAt: row.createdAt.toISOString(),
      });
      expect('id' in view).toBe(false);
    });

    it('list returns projected views ordered by createdAt desc', async () => {
      const lpNo1 = await createProfile({ name: 'Falcon Liquidity FZE' });
      const lpNo2 = await createProfile({ name: 'Dune OTC DMCC' });
      const views = await service.list();
      expect(views.map((v) => v.lpNo)).toEqual([lpNo2, lpNo1]);
      expect(views.every((v) => !('id' in v))).toBe(true);
    });
  });
});
