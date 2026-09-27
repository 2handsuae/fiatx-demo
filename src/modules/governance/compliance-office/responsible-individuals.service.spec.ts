import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ResponsibleIndividualsService } from './responsible-individuals.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';

const mlro: ApprovalActorContext = { actorType: 'ADMIN', userId: 'uuid-mlro', userNo: 'ADM-MLRO', roleCodes: ['MLRO'] };

const baseSeatDto = {
  position: 'Compliance Officer',
  incumbentName: 'Alice Tan',
  effectiveFrom: '2026-01-01T00:00:00.000Z',
};

/** 行为化内存行 mock（照 outsourcing-vendors.service.spec.ts / compliance-obligations
 *  .service.spec.ts 的 makePrisma 先例）。 */
function makePrisma(): { responsibleIndividual: Record<string, jest.Mock> } {
  const rows = new Map<string, any>();
  return {
    responsibleIndividual: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...data };
        rows.set(row.riNo, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = rows.get(where.riNo);
        if (!existing) throw new Error(`no such row: ${where.riNo}`);
        const updated = { ...existing, ...data };
        rows.set(where.riNo, updated);
        return updated;
      }),
      findUnique: jest.fn(async ({ where }: any) => rows.get(where.riNo) ?? null),
    },
  };
}

describe('ResponsibleIndividualsService (Task 4)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: ResponsibleIndividualsService;
  let auditLogs: { recordByActor: jest.Mock; recordSystem: jest.Mock };

  beforeEach(async () => {
    prisma = makePrisma();
    auditLogs = { recordByActor: jest.fn(async () => ({})), recordSystem: jest.fn(async () => ({})) };
    const mod = await Test.createTestingModule({
      providers: [
        ResponsibleIndividualsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = mod.get(ResponsibleIndividualsService);
  });

  function actionsOf(): string[] {
    return [...auditLogs.recordByActor.mock.calls, ...auditLogs.recordSystem.mock.calls].map((c) => c[0].action);
  }

  async function createSeat(overrides: Partial<typeof baseSeatDto> = {}): Promise<string> {
    const { riNo } = await service.createSeat(mlro, { ...baseSeatDto, ...overrides });
    return riNo;
  }

  // ── createSeat ─────────────────────────────────────────────────────
  describe('createSeat', () => {
    it('writes an RI-prefixed row, ACTIVE, no pending replacement, and records RI_SEAT_REGISTERED with position', async () => {
      const riNo = await createSeat();
      expect(riNo).toMatch(/^RI\d{12}$/);
      const row = await service.findByNo(riNo);
      expect(row.status).toBe('ACTIVE');
      expect(row.incumbentName).toBe('Alice Tan');
      expect(row.pendingApprovalNo).toBeNull();

      expect(actionsOf()).toEqual(['RI_SEAT_REGISTERED']);
      const call = auditLogs.recordByActor.mock.calls[0][0];
      expect(call).toMatchObject({ actionDomain: 'GOVERNANCE', primarySubjectType: 'RESPONSIBLE_INDIVIDUAL', position: 'Compliance Officer' });
      // R5 修订：position 现在也镜像进 metadata——审计行本身可查建席位时刻的职位快照。
      expect(call.metadata).toMatchObject({ position: 'Compliance Officer' });
      expect(call.requestId).toEqual(expect.any(String));
    });
  });

  // ── assertNoPendingReplacement / recordProposal：一席一在途 ─────────────
  describe('assertNoPendingReplacement / recordProposal (one seat, one in-flight replacement)', () => {
    const proposeDto = { newIncumbentName: 'Bob Lee', effectiveFrom: '2026-06-01T00:00:00.000Z', reason: 'Alice resigned' };

    it('assertNoPendingReplacement passes silently when nothing is pending', async () => {
      const riNo = await createSeat();
      await expect(service.assertNoPendingReplacement(riNo)).resolves.toBeUndefined();
    });

    it('recordProposal sets pendingApprovalNo and records RI_REPLACEMENT_PROPOSED carrying approvalNo, without touching incumbentName yet', async () => {
      const riNo = await createSeat();
      const r = await service.recordProposal(mlro, riNo, 'APR260101000001', proposeDto);
      expect(r.riNo).toBe(riNo);

      const row = await service.findByNo(riNo);
      expect(row.pendingApprovalNo).toBe('APR260101000001');
      expect(row.incumbentName).toBe('Alice Tan'); // 未生效——apply 才真正换人

      const call = auditLogs.recordByActor.mock.calls.find((c) => c[0].action === 'RI_REPLACEMENT_PROPOSED')![0];
      expect(call).toMatchObject({ actionDomain: 'GOVERNANCE', approvalNo: 'APR260101000001' });
      // R5 修订：approvalNo/reason 现在也镜像进 metadata——审计行本身可查提的是哪单、为什么提。
      expect(call.metadata).toMatchObject({ approvalNo: 'APR260101000001', reason: 'Alice resigned' });
    });

    it('assertNoPendingReplacement now rejects with 400 once a proposal is pending', async () => {
      const riNo = await createSeat();
      await service.recordProposal(mlro, riNo, 'APR260101000001', proposeDto);
      await expect(service.assertNoPendingReplacement(riNo)).rejects.toThrow(BadRequestException);
    });

    it('a second recordProposal while one is already pending is rejected with 400 (in-flight duplicate)', async () => {
      const riNo = await createSeat();
      await service.recordProposal(mlro, riNo, 'APR260101000001', proposeDto);
      await expect(
        service.recordProposal(mlro, riNo, 'APR260101000002', { ...proposeDto, newIncumbentName: 'Carol Ng' }),
      ).rejects.toThrow(BadRequestException);

      // 第二次提案被拒绝，第一次提案的 pendingApprovalNo 原样保留（未被第二次调用覆盖）
      const row = await service.findByNo(riNo);
      expect(row.pendingApprovalNo).toBe('APR260101000001');
    });
  });

  // ── applyReplacement：换人三字段 + 清 pending，审计携真实 from/to ──────────
  describe('applyReplacement (swaps incumbent/effectiveFrom/varaRef, clears pending)', () => {
    it('changes incumbentName/effectiveFrom/varaRef, clears pendingApprovalNo, and records RI_REPLACEMENT_APPLIED via recordSystem with the real before/after names', async () => {
      const riNo = await createSeat();
      await service.recordProposal(mlro, riNo, 'APR260101000001', {
        newIncumbentName: 'Bob Lee', effectiveFrom: '2026-06-01T00:00:00.000Z', reason: 'Alice resigned',
      });
      auditLogs.recordByActor.mockClear();

      const r = await service.applyReplacement(riNo, 'APR260101000001', {
        newIncumbentName: 'Bob Lee', effectiveFrom: '2026-06-01T00:00:00.000Z', varaRef: 'VARA-REF-2026-0601',
      });
      expect(r.riNo).toBe(riNo);

      const row = await service.findByNo(riNo);
      expect(row.incumbentName).toBe('Bob Lee');
      expect(row.effectiveFrom.toISOString()).toBe('2026-06-01T00:00:00.000Z');
      expect(row.varaRef).toBe('VARA-REF-2026-0601');
      expect(row.pendingApprovalNo).toBeNull();

      expect(auditLogs.recordByActor).not.toHaveBeenCalled(); // applyReplacement 无 actor，走系统写
      expect(auditLogs.recordSystem).toHaveBeenCalledTimes(1);
      const call = auditLogs.recordSystem.mock.calls[0][0];
      expect(call).toMatchObject({
        action: 'RI_REPLACEMENT_APPLIED', actionDomain: 'GOVERNANCE',
        fromIncumbent: 'Alice Tan', toIncumbent: 'Bob Lee', approvalNo: 'APR260101000001',
      });
      // R5 修订（真缺陷修复）：fromIncumbent/toIncumbent/approvalNo 原先只在顶层 extra
      // （只供 assertActionSpec 的 requiredFields 校验读取一次，audit-logs.service.ts 建库
      // 时不落任何专列——审计行查不到"换的是谁、换成了谁"）。现在镜像进 metadata，行为化
      // 断言查的是真正会持久化的字段。
      expect(call.metadata).toMatchObject({ fromIncumbent: 'Alice Tan', toIncumbent: 'Bob Lee', approvalNo: 'APR260101000001' });
    });
  });

  // ── clearReplacement：只清不换人 ────────────────────────────────────
  describe('clearReplacement (rejected/withdrawn/expired path — clears pending, does NOT change incumbent)', () => {
    it('clears pendingApprovalNo while leaving incumbentName/effectiveFrom/varaRef untouched, and records RI_REPLACEMENT_REJECTED via recordSystem', async () => {
      const riNo = await createSeat();
      await service.recordProposal(mlro, riNo, 'APR260101000001', {
        newIncumbentName: 'Bob Lee', effectiveFrom: '2026-06-01T00:00:00.000Z', reason: 'Alice resigned',
      });
      const before = await service.findByNo(riNo);

      const r = await service.clearReplacement(riNo, 'APR260101000001', 'DECLINED');
      expect(r.riNo).toBe(riNo);

      const after = await service.findByNo(riNo);
      expect(after.pendingApprovalNo).toBeNull();
      expect(after.incumbentName).toBe(before.incumbentName); // 只清不换人
      expect(after.effectiveFrom.toISOString()).toBe(before.effectiveFrom.toISOString());

      expect(auditLogs.recordSystem).toHaveBeenCalledTimes(1);
      const call = auditLogs.recordSystem.mock.calls[0][0];
      expect(call).toMatchObject({ action: 'RI_REPLACEMENT_REJECTED', actionDomain: 'GOVERNANCE', approvalNo: 'APR260101000001', decision: 'DECLINED' });
      // R5 修订：approvalNo/decision 现在也镜像进 metadata——审计行本身可查清的是哪单、因何裁决。
      expect(call.metadata).toMatchObject({ approvalNo: 'APR260101000001', decision: 'DECLINED' });
    });

    it('after clearReplacement, a fresh proposal can be recorded again (pending flag genuinely released)', async () => {
      const riNo = await createSeat();
      await service.recordProposal(mlro, riNo, 'APR260101000001', {
        newIncumbentName: 'Bob Lee', effectiveFrom: '2026-06-01T00:00:00.000Z', reason: 'Alice resigned',
      });
      await service.clearReplacement(riNo, 'APR260101000001', 'DECLINED');
      await expect(service.assertNoPendingReplacement(riNo)).resolves.toBeUndefined();
      await expect(
        service.recordProposal(mlro, riNo, 'APR260101000002', { newIncumbentName: 'Carol Ng', effectiveFrom: '2026-07-01T00:00:00.000Z', reason: 'retry' }),
      ).resolves.toEqual({ riNo });
    });
  });

  // ── findByNo ───────────────────────────────────────────────────────
  describe('findByNo', () => {
    it('throws NotFoundException for an unknown riNo', async () => {
      await expect(service.findByNo('RI_DOES_NOT_EXIST')).rejects.toThrow(NotFoundException);
    });
  });

  // ── 审计信封真实过闸（真 AuditLogsService + 内存 mock Prisma，不碰真库）：同
  // compliance-obligations/outsourcing-vendors 先例——COMPLIANCE_OFFICE_AUDIT_ACTIONS
  // 的四个 RI_* 声明是否真的被本服务的调用点喂对，只有让真校验跑一遍才知道。
  describe('audit envelope satisfies the real COMPLIANCE_OFFICE_AUDIT_ACTIONS contract (real AuditLogsService, mocked Prisma)', () => {
    let realService: ResponsibleIndividualsService;

    function makeAuditPrisma() {
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
        auditLogSubject: { createMany: jest.fn(async () => ({ count: 0 })) },
        __events: events,
      };
    }

    let auditPrisma: ReturnType<typeof makeAuditPrisma>;

    beforeEach(async () => {
      auditPrisma = makeAuditPrisma();
      const mod = await Test.createTestingModule({
        providers: [
          ResponsibleIndividualsService,
          { provide: PrismaService, useValue: auditPrisma },
          AuditLogsService,
        ],
      }).compile();
      realService = mod.get(ResponsibleIndividualsService);
    });

    it('walks createSeat→recordProposal→applyReplacement (RI_REPLACEMENT_APPLIED requiredFields=[fromIncumbent,toIncumbent]) without rejection', async () => {
      const { riNo } = await realService.createSeat(mlro, baseSeatDto);
      await realService.recordProposal(mlro, riNo, 'APR260101000001', { newIncumbentName: 'Bob Lee', effectiveFrom: '2026-06-01T00:00:00.000Z', reason: 'Alice resigned' });
      await realService.applyReplacement(riNo, 'APR260101000001', { newIncumbentName: 'Bob Lee', effectiveFrom: '2026-06-01T00:00:00.000Z' });

      const actions = auditPrisma.__events.map((e: any) => e.action);
      expect(actions).toEqual(['RI_SEAT_REGISTERED', 'RI_REPLACEMENT_PROPOSED', 'RI_REPLACEMENT_APPLIED']);
      const correlationIds = new Set(auditPrisma.__events.map((e: any) => e.correlationId));
      expect(correlationIds.size).toBe(1); // 全部继承 RI_SEAT_REGISTERED 铸的 traceId
    });

    it('walks createSeat→recordProposal→clearReplacement (RI_REPLACEMENT_REJECTED requiredFields=[approvalNo]) without rejection', async () => {
      const { riNo } = await realService.createSeat(mlro, baseSeatDto);
      await realService.recordProposal(mlro, riNo, 'APR260101000001', { newIncumbentName: 'Bob Lee', effectiveFrom: '2026-06-01T00:00:00.000Z', reason: 'Alice resigned' });
      await realService.clearReplacement(riNo, 'APR260101000001', 'WITHDRAWN');

      const actions = auditPrisma.__events.map((e: any) => e.action);
      expect(actions).toEqual(['RI_SEAT_REGISTERED', 'RI_REPLACEMENT_PROPOSED', 'RI_REPLACEMENT_REJECTED']);
    });
  });
});
