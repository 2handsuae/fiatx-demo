import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LpProfileService } from './lp-profile.service';
import { LP_PROFILE_TRANSITIONS } from './constants/lp-profile-transitions.constant';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { CreateLpProfileDto, LpProfileStatus } from './dto/lp-profile.dto';

const treasury: ApprovalActorContext = { actorType: 'ADMIN', userId: 'uuid-treasury', userNo: 'ADM-TREASURY', roleCodes: ['TREASURY'] };

const baseCreateDto: CreateLpProfileDto = {
  name: 'Falcon Liquidity FZE',
  registeredIn: 'United Arab Emirates (DMCC)',
  registrationNo: 'DMCC-123456',
  licensingAuthority: 'VARA',
  licenceNo: 'VL/24/001',
  beneficialOwners: [
    { seq: 1, name: 'Khalid Al Mansoori', nationality: 'AE' },
    { seq: 2, name: 'Mei Lin Tan' },
  ],
  tradingTypes: ['SPOT_EXCHANGE', 'OTC_BLOCK'],
  expectedMonthlyVolume: '5000000',
  volumeCurrency: 'USD',
  applicationReason: 'Onboarding a new AED/USDT liquidity corridor',
  agreementRef: 'AGR-2026-LP-001',
  agreementStart: '2026-11-01',
  contactName: 'Layla Hassan',
  contactEmail: 'layla@falcon.example',
};

/** 行为化内存行 mock（照 responsible-individuals.service.spec.ts 的 makePrisma 先例）。
 *  clock 用递增计数器而非 `new Date()`——同一 tick 内连续两次 create 可能落在同一毫秒，
 *  会让 list() 的 createdAt desc 排序断言假红（时钟粒度伪象，不是被测行为的缺陷）。
 *  rows 一并导出：状态机用例直接把一行摆成任一出发态，不必走完整条弧。 */
function makePrisma() {
  const rows = new Map<string, any>();
  let clock = Date.parse('2026-09-29T00:00:00.000Z');
  const tick = () => new Date((clock += 1000));
  const liquidityProvider = {
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
    // 评审随轮小项：真按调用方传入的 orderBy 排序（不是硬编码 desc）——照本仓
    // 「mock 无视 where 直接吐行」假绿判例的同款教训,这里换成「mock 无视 orderBy」的
    // 对应修法,断言的是真行为而不是巧合对上的常量。
    findMany: jest.fn(async (args: any = {}) => {
      const list = [...rows.values()];
      const orderBy = args.orderBy;
      if (!orderBy) return list;
      const [field] = Object.keys(orderBy);
      const dir = orderBy[field] === 'asc' ? 1 : -1;
      return list.sort((a, b) => dir * (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0));
    }),
  };
  return { liquidityProvider, rows };
}

describe('LpProfileService (乙波一 T2 / 甲波六 T4)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: LpProfileService;
  let audits: Array<{ via: 'actor' | 'system'; input: any }>;
  let auditLogs: { recordByActor: jest.Mock; recordSystem: jest.Mock };

  beforeEach(async () => {
    prisma = makePrisma();
    audits = [];
    // 生产那道词表校验亲自跑一遍每条信封（缺必填 / 缺 causation / 域不符都会当场抛，同生产）
    const realSpec = new AuditLogsService(null as any);
    auditLogs = {
      recordByActor: jest.fn(async (input: any) => { (realSpec as any).assertActionSpec(input); audits.push({ via: 'actor', input }); return {}; }),
      recordSystem: jest.fn(async (input: any) => { (realSpec as any).assertActionSpec(input); audits.push({ via: 'system', input }); return {}; }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        LpProfileService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = mod.get(LpProfileService);
  });

  const actionsOf = (): string[] => audits.map((a) => a.input.action);

  async function createProfile(overrides: Partial<CreateLpProfileDto> = {}): Promise<string> {
    const row = await service.create(treasury, { ...baseCreateDto, ...overrides });
    return row.lpNo;
  }

  /** 把一行直接摆成给定状态（状态机用例的出发态；审计清零，让断言只看被测那一步）。 */
  async function profileIn(status: LpProfileStatus): Promise<string> {
    const lpNo = await createProfile();
    prisma.rows.set(lpNo, { ...prisma.rows.get(lpNo), status });
    audits.length = 0;
    auditLogs.recordByActor.mockClear();
    auditLogs.recordSystem.mockClear();
    return lpNo;
  }

  // ── create ──────────────────────────────────────────────────────────
  describe('create', () => {
    it('writes an LPP-prefixed row in PENDING_ASSESSMENT with the whole application, and records one LP_PROFILE_CREATED (actor-driven)', async () => {
      const lpNo = await createProfile();
      expect(lpNo).toMatch(/^LPP\d{12}$/);

      const row = await service.findByNo(lpNo);
      expect(row.status).toBe(LpProfileStatus.PENDING_ASSESSMENT);
      expect(row.createdByUserId).toBe('ADM-TREASURY');
      expect(row.approvalNo).toBeNull();
      expect(row).toMatchObject({
        name: 'Falcon Liquidity FZE', registeredIn: 'United Arab Emirates (DMCC)', registrationNo: 'DMCC-123456',
        licensingAuthority: 'VARA', licenceNo: 'VL/24/001',
        tradingTypes: 'SPOT_EXCHANGE,OTC_BLOCK', expectedMonthlyVolume: '5000000', volumeCurrency: 'USD',
        applicationReason: 'Onboarding a new AED/USDT liquidity corridor',
        agreementRef: 'AGR-2026-LP-001', contactName: 'Layla Hassan', contactEmail: 'layla@falcon.example',
      });
      expect(JSON.parse(row.beneficialOwners)).toEqual([
        { seq: 1, name: 'Khalid Al Mansoori', nationality: 'AE' },
        { seq: 2, name: 'Mei Lin Tan' },
      ]);
      expect(row.agreementStart).toEqual(new Date('2026-11-01'));

      // 建档只留一条审计：申请提交。实体背调 mock 已退役，不再有「建档即筛」那条留痕。
      expect(actionsOf()).toEqual(['LP_PROFILE_CREATED']);
      expect(audits[0].via).toBe('actor');
      const call = audits[0].input;
      expect(call).toMatchObject({
        actionDomain: 'TREASURY',
        primarySubjectType: 'LIQUIDITY_PROVIDER',
        primarySubjectNo: lpNo,
        reason: 'Onboarding a new AED/USDT liquidity corridor', // 词表必填 reason = 申请理由
        registeredIn: 'United Arab Emirates (DMCC)', // 词表必填 registeredIn 顶层展开
        metadata: expect.objectContaining({
          registeredIn: 'United Arab Emirates (DMCC)', licensingAuthority: 'VARA', tradingTypes: ['SPOT_EXCHANGE', 'OTC_BLOCK'],
        }),
      });
      expect(call.correlationId).toBeUndefined(); // CREATED 起旅程（NONE），不传 correlationId
      expect(call.requestId).toEqual(expect.stringContaining(`LP_PROFILE_CREATED_${lpNo}_`));
      expect(call.subjects).toEqual([{ subjectType: 'LIQUIDITY_PROVIDER', subjectNo: lpNo, subjectRole: 'PRIMARY' }]);
    });

    it('defaults beneficialOwners to an empty list when the applicant names none, and omits agreementStart', async () => {
      const lpNo = await createProfile({ beneficialOwners: undefined, agreementStart: undefined });
      const row = await service.findByNo(lpNo);
      expect(row.beneficialOwners).toBe('[]');
      expect(row.agreementStart).toBeNull();
      expect(service.beneficialOwnersOf(row)).toEqual([]);
    });

    it('the LP_PROFILE_CREATED envelope is held to its registered contract: registeredIn is required (the gate really bites)', async () => {
      const realSpec = new AuditLogsService(null as any);
      const lpNo = await createProfile();
      const envelope = { ...audits[0].input };
      expect(() => (realSpec as any).assertActionSpec(envelope)).not.toThrow();
      delete envelope.registeredIn;
      expect(() => (realSpec as any).assertActionSpec(envelope)).toThrow(/missing required field\(s\): registeredIn/);
      expect(lpNo).toBeTruthy();
    });

    it('findByNo throws NotFoundException for an unknown lpNo', async () => {
      await expect(service.findByNo('LPP000000000000')).rejects.toThrow(NotFoundException);
    });
  });

  // ── beneficialOwnersOf ──────────────────────────────────────────────
  describe('beneficialOwnersOf', () => {
    it('parses the stored JSON down to {seq, name} — the identity DDA matches screening records against', async () => {
      const lpNo = await createProfile();
      expect(service.beneficialOwnersOf(await service.findByNo(lpNo))).toEqual([
        { seq: 1, name: 'Khalid Al Mansoori' },
        { seq: 2, name: 'Mei Lin Tan' },
      ]);
    });
  });

  // ── transition：六态九边，每条边一条审计码，metadata 带 from/to ─────────────
  describe('transition (real LP_PROFILE_TRANSITIONS table)', () => {
    // 期望表是本测试自己的「状态机说明书」：出发态、目标态、必须写出的审计码、该边的调用口径
    // （人手动作带 actor + reason；裁决回调是系统写，带 approvalNo + causationId）。
    const manual = { actor: treasury, reason: 'because' };
    const decided = { approvalNo: 'APR260101000099', causationId: 'cause-1' };
    const EDGES: Array<[LpProfileStatus, LpProfileStatus, string, 'actor' | 'system', Record<string, unknown>]> = [
      [LpProfileStatus.PENDING_ASSESSMENT, LpProfileStatus.RETURNED, 'LP_PROFILE_RETURNED', 'actor', manual],
      [LpProfileStatus.RETURNED, LpProfileStatus.PENDING_ASSESSMENT, 'LP_PROFILE_RESUBMITTED', 'actor', manual],
      [LpProfileStatus.PENDING_ASSESSMENT, LpProfileStatus.REJECTED, 'LP_PROFILE_REJECTED', 'actor', manual],
      [LpProfileStatus.PENDING_ASSESSMENT, LpProfileStatus.PENDING_APPROVAL, 'LP_PROFILE_SENT_FOR_APPROVAL', 'actor', manual],
      [LpProfileStatus.PENDING_APPROVAL, LpProfileStatus.ACTIVE, 'LP_PROFILE_APPROVED', 'system', decided],
      [LpProfileStatus.PENDING_APPROVAL, LpProfileStatus.REJECTED, 'LP_PROFILE_REJECTED', 'system', { ...decided, reason: 'Declined by CFO' }],
      [LpProfileStatus.PENDING_APPROVAL, LpProfileStatus.PENDING_ASSESSMENT, 'LP_PROFILE_APPROVAL_CANCELLED', 'system', { ...decided, reason: 'Approval cancelled' }],
      [LpProfileStatus.ACTIVE, LpProfileStatus.SUSPENDED, 'LP_PROFILE_SUSPENDED', 'actor', manual],
      [LpProfileStatus.SUSPENDED, LpProfileStatus.ACTIVE, 'LP_PROFILE_REACTIVATED', 'actor', manual],
    ];

    it('the oracle above covers exactly the edges of LP_PROFILE_TRANSITIONS — no edge without a test, none invented', () => {
      const real = Object.entries(LP_PROFILE_TRANSITIONS).flatMap(([from, tos]) => tos.map((to) => `${from}->${to}`)).sort();
      expect(EDGES.map(([f, t]) => `${f}->${t}`).sort()).toEqual(real);
      expect(real).toHaveLength(9);
    });

    it.each(EDGES)('%s → %s writes %s (via %s) carrying fromStatus/toStatus, and passes the registered contract', async (from, to, action, via, audit) => {
      const lpNo = await profileIn(from);
      const updated = await service.transition(lpNo, to, {}, audit);

      expect(updated.status).toBe(to);
      expect((await service.findByNo(lpNo)).status).toBe(to);
      expect(actionsOf()).toEqual([action]);
      expect(audits[0].via).toBe(via);
      expect(audits[0].input).toMatchObject({ actionDomain: 'TREASURY', fromStatus: from, toStatus: to, correlationId: lpNo, primarySubjectNo: lpNo });
    });

    it.each([
      [LpProfileStatus.PENDING_ASSESSMENT, LpProfileStatus.ACTIVE],
      [LpProfileStatus.PENDING_ASSESSMENT, LpProfileStatus.SUSPENDED],
      [LpProfileStatus.RETURNED, LpProfileStatus.REJECTED],
      [LpProfileStatus.RETURNED, LpProfileStatus.PENDING_APPROVAL],
      [LpProfileStatus.PENDING_APPROVAL, LpProfileStatus.RETURNED],
      [LpProfileStatus.PENDING_APPROVAL, LpProfileStatus.SUSPENDED],
      [LpProfileStatus.ACTIVE, LpProfileStatus.PENDING_ASSESSMENT],
      [LpProfileStatus.ACTIVE, LpProfileStatus.REJECTED],
      [LpProfileStatus.SUSPENDED, LpProfileStatus.REJECTED],
      [LpProfileStatus.REJECTED, LpProfileStatus.ACTIVE],
      [LpProfileStatus.REJECTED, LpProfileStatus.PENDING_ASSESSMENT],
    ])('rejects the illegal edge %s → %s with "Illegal LP profile status transition", row and audit untouched', async (from, to) => {
      const lpNo = await profileIn(from);
      await expect(service.transition(lpNo, to, {}, { actor: treasury, reason: 'x' })).rejects.toThrow(/Illegal LP profile status transition/);
      expect((await service.findByNo(lpNo)).status).toBe(from);
      expect(audits).toEqual([]);
    });

    it('PENDING_APPROVAL → ACTIVE records LP_PROFILE_APPROVED via recordSystem with approvalNo/causationId and an APPROVAL_CASE instrument subject', async () => {
      const lpNo = await profileIn(LpProfileStatus.PENDING_APPROVAL);
      await service.transition(lpNo, LpProfileStatus.ACTIVE, {}, { approvalNo: 'APR260101000099', causationId: 'cause-1' });

      expect(auditLogs.recordByActor).not.toHaveBeenCalled(); // 裁决回调无 actor,走系统写
      expect(audits[0].input).toMatchObject({ approvalNo: 'APR260101000099', causationId: 'cause-1' });
      expect(audits[0].input.subjects).toEqual(expect.arrayContaining([
        { subjectType: 'APPROVAL_CASE', subjectNo: 'APR260101000099', subjectRole: 'INSTRUMENT' },
      ]));
    });

    it('a resubmit-style patch rides the same update as the status (one row write, patch fields land)', async () => {
      const lpNo = await profileIn(LpProfileStatus.RETURNED);
      await service.transition(lpNo, LpProfileStatus.PENDING_ASSESSMENT, { name: 'Renamed Liquidity FZE' }, manual);
      const row = await service.findByNo(lpNo);
      expect(row).toMatchObject({ name: 'Renamed Liquidity FZE', status: LpProfileStatus.PENDING_ASSESSMENT });
    });

    it('REJECTED is terminal (no out-edges)', async () => {
      const lpNo = await profileIn(LpProfileStatus.PENDING_ASSESSMENT);
      await service.transition(lpNo, LpProfileStatus.REJECTED, {}, manual);
      await expect(service.transition(lpNo, LpProfileStatus.ACTIVE)).rejects.toThrow(/Illegal/);
      await expect(service.transition(lpNo, LpProfileStatus.PENDING_ASSESSMENT)).rejects.toThrow(/Illegal/);
    });

    it('assertActiveByNo throws for every non-ACTIVE status and resolves for ACTIVE', async () => {
      for (const status of [LpProfileStatus.PENDING_ASSESSMENT, LpProfileStatus.RETURNED, LpProfileStatus.PENDING_APPROVAL, LpProfileStatus.SUSPENDED, LpProfileStatus.REJECTED]) {
        const lpNo = await profileIn(status);
        await expect(service.assertActiveByNo(lpNo)).rejects.toThrow(BadRequestException);
      }
      const active = await profileIn(LpProfileStatus.ACTIVE);
      await expect(service.assertActiveByNo(active)).resolves.toBeUndefined();
    });
  });

  // ── resubmit：RETURNED 态金库改申请重提 ───────────────────────────────
  describe('resubmit', () => {
    const revised: CreateLpProfileDto = {
      ...baseCreateDto,
      name: 'Falcon Liquidity FZE (renamed)',
      registrationNo: 'DMCC-654321',
      beneficialOwners: [{ seq: 1, name: 'Khalid Al Mansoori' }, { seq: 3, name: 'Omar Farouk' }],
      tradingTypes: ['SPOT_EXCHANGE'],
      expectedMonthlyVolume: '7500000.5',
      applicationReason: 'Added corridor scope after compliance feedback',
      agreementStart: undefined,
    };

    it('overwrites the whole application row and walks RETURNED → PENDING_ASSESSMENT with LP_PROFILE_RESUBMITTED', async () => {
      const lpNo = await profileIn(LpProfileStatus.RETURNED);

      const row = await service.resubmit(lpNo, treasury, revised);

      expect(row.status).toBe(LpProfileStatus.PENDING_ASSESSMENT);
      const stored = await service.findByNo(lpNo);
      expect(stored).toMatchObject({
        name: 'Falcon Liquidity FZE (renamed)', registrationNo: 'DMCC-654321', tradingTypes: 'SPOT_EXCHANGE',
        expectedMonthlyVolume: '7500000.5', applicationReason: 'Added corridor scope after compliance feedback',
        status: LpProfileStatus.PENDING_ASSESSMENT, createdByUserId: 'ADM-TREASURY',
      });
      expect(service.beneficialOwnersOf(stored)).toEqual([{ seq: 1, name: 'Khalid Al Mansoori' }, { seq: 3, name: 'Omar Farouk' }]);
      expect(stored.agreementStart).toBeNull(); // 整行覆盖：这次没填起始日就清空
      expect(actionsOf()).toEqual(['LP_PROFILE_RESUBMITTED']);
      expect(audits[0].via).toBe('actor');
      expect(audits[0].input).toMatchObject({ fromStatus: 'RETURNED', toStatus: 'PENDING_ASSESSMENT' });
    });

    it.each([
      LpProfileStatus.PENDING_ASSESSMENT, LpProfileStatus.PENDING_APPROVAL, LpProfileStatus.ACTIVE, LpProfileStatus.SUSPENDED, LpProfileStatus.REJECTED,
    ])('is refused in %s — only a RETURNED application can be resubmitted (PENDING_APPROVAL → PENDING_ASSESSMENT is the approval-cancel edge, not a resubmit)', async (status) => {
      const lpNo = await profileIn(status);
      await expect(service.resubmit(lpNo, treasury, revised)).rejects.toThrow(BadRequestException);
      const stored = await service.findByNo(lpNo);
      expect(stored.status).toBe(status);
      expect(stored.name).toBe('Falcon Liquidity FZE'); // 申请没被覆盖
      expect(audits).toEqual([]);
    });

    it('resubmitting an unknown lpNo is a 404', async () => {
      await expect(service.resubmit('LPP000000000000', treasury, revised)).rejects.toThrow(NotFoundException);
    });
  });

  // ── stampApprovalNo ─────────────────────────────────────────────────
  describe('stampApprovalNo', () => {
    it('回填 approvalNo,不写审计(照划转单同名方法先例)', async () => {
      const lpNo = await createProfile();
      audits.length = 0;
      await service.stampApprovalNo(lpNo, 'APR260101000001');
      expect((await service.findByNo(lpNo)).approvalNo).toBe('APR260101000001');
      expect(audits).toEqual([]);
    });
  });

  // ── toView / list：零 UUID 投影 ───────────────────────────────────────
  describe('toView / list', () => {
    it('toView projects the application as business values only — no id, arrays and plain strings, none of the retired screening keys', async () => {
      const lpNo = await createProfile();
      const row = await service.findByNo(lpNo);
      const view = service.toView(row);
      expect(view).toEqual({
        lpNo, name: 'Falcon Liquidity FZE',
        registeredIn: 'United Arab Emirates (DMCC)', registrationNo: 'DMCC-123456',
        licensingAuthority: 'VARA', licenceNo: 'VL/24/001',
        beneficialOwners: [
          { seq: 1, name: 'Khalid Al Mansoori', nationality: 'AE' },
          { seq: 2, name: 'Mei Lin Tan' },
        ],
        tradingTypes: ['SPOT_EXCHANGE', 'OTC_BLOCK'],
        expectedMonthlyVolume: '5000000', volumeCurrency: 'USD',
        applicationReason: 'Onboarding a new AED/USDT liquidity corridor',
        agreementRef: 'AGR-2026-LP-001', agreementStart: new Date('2026-11-01').toISOString(),
        contactName: 'Layla Hassan', contactEmail: 'layla@falcon.example',
        status: LpProfileStatus.PENDING_ASSESSMENT, approvalNo: null,
        createdBy: 'ADM-TREASURY', createdAt: row.createdAt.toISOString(),
      });
      expect('id' in view).toBe(false);
      // 键集精确钉死：旧的三个背调键（结论 / 时间 / 尽调引用号）不在其中，也没有悄悄多出别的键
      expect(Object.keys(view).sort()).toEqual([
        'agreementRef', 'agreementStart', 'applicationReason', 'approvalNo', 'beneficialOwners', 'contactEmail', 'contactName',
        'createdAt', 'createdBy', 'expectedMonthlyVolume', 'licenceNo', 'licensingAuthority', 'lpNo', 'name',
        'registeredIn', 'registrationNo', 'status', 'tradingTypes', 'volumeCurrency',
      ]);
    });

    it('toView renders a Decimal volume as a plain decimal string and a missing agreementStart as null', async () => {
      const lpNo = await createProfile({ expectedMonthlyVolume: '1250000.75', agreementStart: undefined });
      const stored = await service.findByNo(lpNo);
      // Prisma 读回来的是 Decimal 对象，不是字符串——用真 Decimal 过一遍投影
      const { Prisma } = jest.requireActual('@prisma/client');
      const view = service.toView({ ...stored, expectedMonthlyVolume: new Prisma.Decimal('1250000.75') });
      expect(view.expectedMonthlyVolume).toBe('1250000.75');
      expect(view.agreementStart).toBeNull();
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
