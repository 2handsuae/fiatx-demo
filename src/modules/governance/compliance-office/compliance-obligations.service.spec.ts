import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ComplianceObligationsService } from './compliance-obligations.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import { advanceDueDate } from './compliance-office.constants';

const mlro: ApprovalActorContext = { actorType: 'ADMIN', userId: 'uuid-mlro', userNo: 'ADM-MLRO', roleCodes: ['MLRO'] };

const baseDto = {
  name: 'VARA quarterly prudential return',
  frequency: 'QUARTERLY' as const,
  authority: 'VARA',
  basisNote: 'spec §9 row 3',
  nextDueAt: '2026-03-31T00:00:00.000Z',
};

/** 行为化内存行 mock（照 regulatory-filing.service.spec.ts 的 makeAccessControl 先例：
 *  真按 where 子句读写，不是无脑 resolve——「mock 无视 where 会假绿」是本仓判例，Task 2
 *  的 brief 明确要求单测全走 mock、不碰真库（DATABASE_URL），故不用真 PrismaService。 */
function makePrisma(): { complianceObligation: Record<string, jest.Mock> } {
  const rows = new Map<string, any>();
  return {
    complianceObligation: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: randomUUID(), lastFilingNo: null, description: null, createdAt: new Date(), updatedAt: new Date(), ...data };
        rows.set(row.obligationNo, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = rows.get(where.obligationNo);
        if (!existing) throw new Error(`no such row: ${where.obligationNo}`);
        const updated = { ...existing, ...data };
        rows.set(where.obligationNo, updated);
        return updated;
      }),
      findUnique: jest.fn(async ({ where }: any) => rows.get(where.obligationNo) ?? null),
    },
  };
}

describe('ComplianceObligationsService (Task 2)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: ComplianceObligationsService;
  let auditLogs: { recordByActor: jest.Mock; recordSystem: jest.Mock };

  beforeEach(async () => {
    prisma = makePrisma();
    auditLogs = { recordByActor: jest.fn(async () => ({})), recordSystem: jest.fn(async () => ({})) };
    const mod = await Test.createTestingModule({
      providers: [
        ComplianceObligationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = mod.get(ComplianceObligationsService);
  });

  function actionsOf(): string[] {
    return [...auditLogs.recordByActor.mock.calls, ...auditLogs.recordSystem.mock.calls].map((c) => c[0].action);
  }

  async function createObligation(overrides: Partial<typeof baseDto> = {}): Promise<string> {
    const { obligationNo } = await service.create(mlro, { ...baseDto, ...overrides });
    return obligationNo;
  }

  // ── create ─────────────────────────────────────────────────────────
  describe('create', () => {
    it('writes an OBL-prefixed row, ACTIVE by default, and records OBLIGATION_REGISTERED with frequency', async () => {
      const obligationNo = await createObligation();
      expect(obligationNo).toMatch(/^OBL\d{12}$/);
      const row = await service.findByNo(obligationNo);
      expect(row.status).toBe('ACTIVE');
      expect(row.frequency).toBe('QUARTERLY');
      expect(row.nextDueAt.toISOString()).toBe('2026-03-31T00:00:00.000Z');
      expect(row.leadBusinessDays).toBe(5); // 未传时落 dto 默认值

      expect(actionsOf()).toEqual(['OBLIGATION_REGISTERED']);
      const call = auditLogs.recordByActor.mock.calls[0][0];
      expect(call).toMatchObject({ actionDomain: 'GOVERNANCE', primarySubjectType: 'COMPLIANCE_OBLIGATION', frequency: 'QUARTERLY' });
      expect(call.requestId).toEqual(expect.any(String));
      expect(call.requestId.length).toBeGreaterThan(0);
    });

    it('honours an explicit leadBusinessDays override', async () => {
      const obligationNo = await createObligation({ leadBusinessDays: 10 } as any);
      const row = await service.findByNo(obligationNo);
      expect(row.leadBusinessDays).toBe(10);
    });
  });

  // ── update ─────────────────────────────────────────────────────────
  describe('update', () => {
    it('updates a descriptive field, records OBLIGATION_UPDATED once, and leaves status/nextDueAt untouched', async () => {
      const obligationNo = await createObligation();
      const before = await service.findByNo(obligationNo);
      const r = await service.update(obligationNo, mlro, { basisNote: 'spec §9 row 3, revised clause number' });
      expect(r.obligationNo).toBe(obligationNo);
      const after = await service.findByNo(obligationNo);
      expect(after.basisNote).toBe('spec §9 row 3, revised clause number');
      expect(after.status).toBe(before.status);
      expect(after.nextDueAt.toISOString()).toBe(before.nextDueAt.toISOString());
      expect(actionsOf()).toEqual(['OBLIGATION_REGISTERED', 'OBLIGATION_UPDATED']);
    });

    it('rejects an unknown obligationNo with 404', async () => {
      await expect(service.update('OBL_NOPE', mlro, { name: 'x' })).rejects.toThrow(NotFoundException);
    });
  });

  // ── setStatus：铁律④显式迁移表，非法跃迁含同态自转一律 400 ────────────
  describe('setStatus (OBLIGATION_TRANSITIONS: ACTIVE ↔ DISABLED)', () => {
    it('ACTIVE → DISABLED succeeds and records fromStatus/toStatus', async () => {
      const obligationNo = await createObligation();
      const r = await service.setStatus(obligationNo, mlro, 'DISABLED');
      expect(r.obligationNo).toBe(obligationNo);
      const row = await service.findByNo(obligationNo);
      expect(row.status).toBe('DISABLED');
      const call = auditLogs.recordByActor.mock.calls.find((c) => c[0].action === 'OBLIGATION_STATUS_CHANGED')![0];
      expect(call).toMatchObject({ fromStatus: 'ACTIVE', toStatus: 'DISABLED' });
    });

    it('DISABLED → ACTIVE succeeds (the reverse edge)', async () => {
      const obligationNo = await createObligation();
      await service.setStatus(obligationNo, mlro, 'DISABLED');
      const r = await service.setStatus(obligationNo, mlro, 'ACTIVE');
      expect(r.obligationNo).toBe(obligationNo);
      const row = await service.findByNo(obligationNo);
      expect(row.status).toBe('ACTIVE');
    });

    it('rejects a same-state self-transition (ACTIVE → ACTIVE) with 400 — not in the explicit edge set', async () => {
      const obligationNo = await createObligation();
      await expect(service.setStatus(obligationNo, mlro, 'ACTIVE')).rejects.toThrow(BadRequestException);
      await expect(service.setStatus(obligationNo, mlro, 'ACTIVE')).rejects.toThrow(/Invalid obligation transition/);
    });

    it('rejects a transition to an unknown status with 400', async () => {
      const obligationNo = await createObligation();
      await expect(service.setStatus(obligationNo, mlro, 'RETIRED')).rejects.toThrow(BadRequestException);
    });
  });

  // ── claimDue：翻期落库 + 返回翻期前 dueAt + 系统审计 ────────────────
  describe('claimDue (spec §3.2: rollover happens at generation time, returns the pre-rollover dueAt)', () => {
    it('rolls QUARTERLY nextDueAt forward via advanceDueDate and returns the OLD dueAt for the caller to open a filing with', async () => {
      const obligationNo = await createObligation({ nextDueAt: '2026-11-30T00:00:00.000Z', frequency: 'QUARTERLY' } as any);
      const now = new Date('2026-12-01T00:00:00.000Z');
      const { dueAt, obligation } = await service.claimDue(obligationNo, now);

      expect(dueAt.toISOString()).toBe('2026-11-30T00:00:00.000Z'); // 翻期前
      const expectedNext = advanceDueDate(new Date('2026-11-30T00:00:00.000Z'), 'QUARTERLY');
      expect(obligation.nextDueAt.toISOString()).toBe(expectedNext.toISOString());
      expect(expectedNext.toISOString()).toBe('2027-02-28T00:00:00.000Z'); // 跨年+月末钳制

      const persisted = await service.findByNo(obligationNo);
      expect(persisted.nextDueAt.toISOString()).toBe('2027-02-28T00:00:00.000Z');
    });

    it('records OBLIGATION_FILING_GENERATED via recordSystem (no actor) carrying the OLD dueAt + fixed filingType, occurredAt=now', async () => {
      const obligationNo = await createObligation({ nextDueAt: '2026-01-31T00:00:00.000Z', frequency: 'MONTHLY' } as any);
      auditLogs.recordByActor.mockClear(); // create() 的 OBLIGATION_REGISTERED 是 actor 写，与本用例要断言的系统写分开算
      const now = new Date('2026-02-05T00:00:00.000Z');
      await service.claimDue(obligationNo, now);

      expect(auditLogs.recordByActor).not.toHaveBeenCalled(); // claimDue 本身不经 actor
      expect(auditLogs.recordSystem).toHaveBeenCalledTimes(1);
      const call = auditLogs.recordSystem.mock.calls[0][0];
      expect(call).toMatchObject({
        action: 'OBLIGATION_FILING_GENERATED',
        actionDomain: 'GOVERNANCE',
        dueAt: '2026-01-31T00:00:00.000Z',
        filingType: 'PERIODIC_RETURN',
        occurredAt: '2026-02-05T00:00:00.000Z',
      });
      expect(call.requestId).toEqual(expect.any(String));
    });

    it('one dueAt can only be claimed once (constructive one-period-one-filing: the second claim reads a different, rolled-forward nextDueAt)', async () => {
      const obligationNo = await createObligation({ nextDueAt: '2026-06-30T00:00:00.000Z', frequency: 'MONTHLY' } as any);
      const first = await service.claimDue(obligationNo, new Date('2026-07-01T00:00:00.000Z'));
      const second = await service.claimDue(obligationNo, new Date('2026-08-01T00:00:00.000Z'));
      expect(first.dueAt.toISOString()).not.toBe(second.dueAt.toISOString());
      expect(second.dueAt.toISOString()).toBe(first.obligation.nextDueAt.toISOString());
    });
  });

  // ── recordGenerated：只回填 lastFilingNo，不重记审计 ────────────────
  describe('recordGenerated', () => {
    it('backfills lastFilingNo without emitting any additional audit write', async () => {
      const obligationNo = await createObligation();
      await service.claimDue(obligationNo, new Date('2026-04-01T00:00:00.000Z'));
      const callsBefore = auditLogs.recordByActor.mock.calls.length + auditLogs.recordSystem.mock.calls.length;

      await service.recordGenerated(obligationNo, 'FIL260401000001');
      const row = await service.findByNo(obligationNo);
      expect(row.lastFilingNo).toBe('FIL260401000001');

      const callsAfter = auditLogs.recordByActor.mock.calls.length + auditLogs.recordSystem.mock.calls.length;
      expect(callsAfter).toBe(callsBefore);
    });
  });

  // ── simulateDue：⚡ 回拨 nextDueAt 到 now，actor 驱动 ────────────────
  describe('simulateDue (⚡ demo fast-forward)', () => {
    it('rewinds nextDueAt to "now" and records OBLIGATION_DUE_FASTFORWARDED via recordByActor', async () => {
      const obligationNo = await createObligation({ nextDueAt: '2027-01-01T00:00:00.000Z' } as any);
      const before = new Date();
      const r = await service.simulateDue(mlro, obligationNo);
      const after = new Date();
      expect(r.obligationNo).toBe(obligationNo);

      const row = await service.findByNo(obligationNo);
      expect(row.nextDueAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(row.nextDueAt.getTime()).toBeLessThanOrEqual(after.getTime());

      const call = auditLogs.recordByActor.mock.calls.find((c) => c[0].action === 'OBLIGATION_DUE_FASTFORWARDED')![0];
      expect(call.nextDueAt).toBe(row.nextDueAt.toISOString());
    });
  });

  // ── findByNo ───────────────────────────────────────────────────────
  describe('findByNo', () => {
    it('throws NotFoundException for an unknown obligationNo', async () => {
      await expect(service.findByNo('OBL_DOES_NOT_EXIST')).rejects.toThrow(NotFoundException);
    });
  });

  // ── 审计信封真实过闸（真 AuditLogsService + 内存 mock Prisma，不碰真库）：mock 版
  // recordByActor/recordSystem 是行为化 spy，不跑 assertActionSpec——COMPLIANCE_OFFICE_
  // AUDIT_ACTIONS 的 requiredFields/correlationMode 声明是否真的被本服务的调用点喂对，
  // 只有让真校验跑一遍才知道（CLAUDE.md 第二条纪律：报绿之前先确认检查真的会红）。
  // AuditLogsService 内部也只读写 prisma.auditLogEvent.*，同样接一份内存 mock，不需要
  // DATABASE_URL（brief 明确要求本任务单测全走 mock、不碰真库）。
  describe('audit envelope satisfies the real COMPLIANCE_OFFICE_AUDIT_ACTIONS contract (real AuditLogsService, mocked Prisma)', () => {
    let realService: ComplianceObligationsService;

    function makeAuditPrisma() {
      // 照 AuditLogsService#createEventWithUniqueNo/persistSubjects 的真实调用形状
      // （auditLogEvent.findUnique 查幂等键、auditLogEvent.create 落新行、
      // auditLogSubject.createMany 落子表）——行为化到能真让 assertActionSpec 和
      // idempotencyKey 幂等命中逻辑走一遍，不是盲目 resolve。
      const events: any[] = [];
      const byIdempotencyKey = new Map<string, any>();
      return {
        ...prisma,
        auditLogEvent: {
          findUnique: jest.fn(async ({ where }: any) => {
            if (where?.idempotencyKey) return byIdempotencyKey.get(where.idempotencyKey) ?? null;
            return null;
          }),
          create: jest.fn(async ({ data }: any) => {
            const row = { id: randomUUID(), seq: events.length + 1, ...data };
            events.push(row);
            if (row.idempotencyKey) byIdempotencyKey.set(row.idempotencyKey, row);
            return row;
          }),
        },
        auditLogSubject: {
          createMany: jest.fn(async () => ({ count: 0 })),
        },
        __events: events,
      };
    }

    let auditPrisma: ReturnType<typeof makeAuditPrisma>;

    beforeEach(async () => {
      auditPrisma = makeAuditPrisma();
      const mod = await Test.createTestingModule({
        providers: [
          ComplianceObligationsService,
          { provide: PrismaService, useValue: auditPrisma },
          AuditLogsService,
        ],
      }).compile();
      realService = mod.get(ComplianceObligationsService);
    });

    it('walks create→update→setStatus(ACTIVE→DISABLED)→setStatus(DISABLED→ACTIVE) without the real assertActionSpec rejecting any of the four codes', async () => {
      const { obligationNo } = await realService.create(mlro, baseDto);
      await realService.update(obligationNo, mlro, { basisNote: 'revised' });
      await realService.setStatus(obligationNo, mlro, 'DISABLED');
      await realService.setStatus(obligationNo, mlro, 'ACTIVE');

      const actions = auditPrisma.__events.map((e: any) => e.action);
      expect(actions).toEqual(['OBLIGATION_REGISTERED', 'OBLIGATION_UPDATED', 'OBLIGATION_STATUS_CHANGED', 'OBLIGATION_STATUS_CHANGED']);
      const correlationIds = new Set(auditPrisma.__events.map((e: any) => e.correlationId));
      expect(correlationIds.size).toBe(1); // 全部继承 OBLIGATION_REGISTERED 铸的 traceId
    });

    it('walks claimDue (OBLIGATION_FILING_GENERATED, requiredFields=[dueAt,filingType]) without rejection', async () => {
      const { obligationNo } = await realService.create(mlro, baseDto);
      await realService.claimDue(obligationNo, new Date('2026-04-01T00:00:00.000Z'));

      const events = auditPrisma.__events.filter((e: any) => e.primarySubjectNo === obligationNo);
      expect(events.map((e: any) => e.action)).toEqual(['OBLIGATION_REGISTERED', 'OBLIGATION_FILING_GENERATED']);
    });

    it('walks simulateDue (OBLIGATION_DUE_FASTFORWARDED, requiredFields=[nextDueAt]) without rejection', async () => {
      const { obligationNo } = await realService.create(mlro, baseDto);
      await realService.simulateDue(mlro, obligationNo);

      const events = auditPrisma.__events.filter((e: any) => e.primarySubjectNo === obligationNo);
      expect(events.map((e: any) => e.action)).toEqual(['OBLIGATION_REGISTERED', 'OBLIGATION_DUE_FASTFORWARDED']);
    });
  });
});
