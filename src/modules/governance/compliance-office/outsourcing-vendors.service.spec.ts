import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OutsourcingVendorsService } from './outsourcing-vendors.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';

const mlro: ApprovalActorContext = { actorType: 'ADMIN', userId: 'uuid-mlro', userNo: 'ADM-MLRO', roleCodes: ['MLRO'] };

const baseDto = {
  name: 'Acme Custody Services',
  serviceDescription: 'Cold storage custody for BTC/ETH',
  criticality: 'MATERIAL' as const,
  contractStart: '2026-01-01T00:00:00.000Z',
};

/** 行为化内存行 mock（照 compliance-obligations.service.spec.ts 的 makePrisma 先例：
 *  真按 where 子句读写，不是无脑 resolve）。 */
function makePrisma(): { outsourcingVendor: Record<string, jest.Mock> } {
  const rows = new Map<string, any>();
  return {
    outsourcingVendor: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: randomUUID(), contractEnd: null, notes: null, createdAt: new Date(), updatedAt: new Date(), ...data };
        rows.set(row.vendorNo, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = rows.get(where.vendorNo);
        if (!existing) throw new Error(`no such row: ${where.vendorNo}`);
        const updated = { ...existing, ...data };
        rows.set(where.vendorNo, updated);
        return updated;
      }),
      findUnique: jest.fn(async ({ where }: any) => rows.get(where.vendorNo) ?? null),
    },
  };
}

describe('OutsourcingVendorsService (Task 4)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: OutsourcingVendorsService;
  let auditLogs: { recordByActor: jest.Mock; recordSystem: jest.Mock };

  beforeEach(async () => {
    prisma = makePrisma();
    auditLogs = { recordByActor: jest.fn(async () => ({})), recordSystem: jest.fn(async () => ({})) };
    const mod = await Test.createTestingModule({
      providers: [
        OutsourcingVendorsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = mod.get(OutsourcingVendorsService);
  });

  function actionsOf(): string[] {
    return [...auditLogs.recordByActor.mock.calls, ...auditLogs.recordSystem.mock.calls].map((c) => c[0].action);
  }

  async function registerVendor(overrides: Partial<typeof baseDto> = {}): Promise<string> {
    const { vendorNo } = await service.register(mlro, { ...baseDto, ...overrides });
    return vendorNo;
  }

  // ── register ───────────────────────────────────────────────────────
  describe('register', () => {
    it('writes a VEN-prefixed row, ACTIVE by default, and records VENDOR_REGISTERED with criticality', async () => {
      const vendorNo = await registerVendor();
      expect(vendorNo).toMatch(/^VEN\d{12}$/);
      const row = await service.findByNo(vendorNo);
      expect(row.status).toBe('ACTIVE');
      expect(row.criticality).toBe('MATERIAL');
      expect(row.contractStart.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(row.contractEnd).toBeNull();

      expect(actionsOf()).toEqual(['VENDOR_REGISTERED']);
      const call = auditLogs.recordByActor.mock.calls[0][0];
      expect(call).toMatchObject({ actionDomain: 'GOVERNANCE', primarySubjectType: 'OUTSOURCING_VENDOR', criticality: 'MATERIAL' });
      // R5 修订：criticality 现在也镜像进 metadata——审计行本身可查登记时刻的关键性快照。
      expect(call.metadata).toMatchObject({ criticality: 'MATERIAL' });
      expect(call.requestId).toEqual(expect.any(String));
      expect(call.requestId.length).toBeGreaterThan(0);
    });

    it('honours an explicit contractEnd and notes', async () => {
      const vendorNo = await registerVendor({ contractEnd: '2027-12-31T00:00:00.000Z', notes: 'renewal pending' } as any);
      const row = await service.findByNo(vendorNo);
      expect(row.contractEnd?.toISOString()).toBe('2027-12-31T00:00:00.000Z');
      expect(row.notes).toBe('renewal pending');
    });
  });

  // ── update ─────────────────────────────────────────────────────────
  describe('update', () => {
    it('updates a descriptive field, records VENDOR_UPDATED once, and leaves status untouched', async () => {
      const vendorNo = await registerVendor();
      const before = await service.findByNo(vendorNo);
      const r = await service.update(vendorNo, mlro, { serviceDescription: 'Cold + warm storage custody' });
      expect(r.vendorNo).toBe(vendorNo);
      const after = await service.findByNo(vendorNo);
      expect(after.serviceDescription).toBe('Cold + warm storage custody');
      expect(after.status).toBe(before.status);
      expect(actionsOf()).toEqual(['VENDOR_REGISTERED', 'VENDOR_UPDATED']);
    });

    it('rejects an unknown vendorNo with 404', async () => {
      await expect(service.update('VEN_NOPE', mlro, { name: 'x' })).rejects.toThrow(NotFoundException);
    });
  });

  // ── terminate：铁律④显式迁移表，终态零出边，无硬删 ────────────────────
  describe('terminate (VENDOR_TRANSITIONS: ACTIVE → TERMINATED, terminal has no outgoing edge)', () => {
    it('ACTIVE → TERMINATED succeeds and records fromStatus/toStatus', async () => {
      const vendorNo = await registerVendor();
      const r = await service.terminate(vendorNo, mlro, {});
      expect(r.vendorNo).toBe(vendorNo);
      const row = await service.findByNo(vendorNo);
      expect(row.status).toBe('TERMINATED');
      const call = auditLogs.recordByActor.mock.calls.find((c) => c[0].action === 'VENDOR_TERMINATED')![0];
      expect(call).toMatchObject({ fromStatus: 'ACTIVE', toStatus: 'TERMINATED' });
    });

    it('rejects a second terminate on an already-TERMINATED vendor with 400 — terminal state has zero outgoing edges', async () => {
      const vendorNo = await registerVendor();
      await service.terminate(vendorNo, mlro, {});
      await expect(service.terminate(vendorNo, mlro, {})).rejects.toThrow(BadRequestException);
      await expect(service.terminate(vendorNo, mlro, {})).rejects.toThrow(/Invalid vendor transition/);
    });

    it('has no hard-delete method on the service — the only way out of ACTIVE is the explicit transition table', () => {
      expect((OutsourcingVendorsService.prototype as any).delete).toBeUndefined();
      expect((OutsourcingVendorsService.prototype as any).remove).toBeUndefined();
    });
  });

  // ── findByNo ───────────────────────────────────────────────────────
  describe('findByNo', () => {
    it('throws NotFoundException for an unknown vendorNo', async () => {
      await expect(service.findByNo('VEN_DOES_NOT_EXIST')).rejects.toThrow(NotFoundException);
    });
  });

  // ── assertActiveByNo（战役乙波二 T4 消费：付款单开单守卫）────────────────
  describe('assertActiveByNo', () => {
    it('resolves for an ACTIVE vendor', async () => {
      const vendorNo = await registerVendor();
      await expect(service.assertActiveByNo(vendorNo)).resolves.toBeUndefined();
    });

    it('rejects a TERMINATED vendor with 400', async () => {
      const vendorNo = await registerVendor();
      await service.terminate(vendorNo, mlro, {});
      await expect(service.assertActiveByNo(vendorNo)).rejects.toThrow(BadRequestException);
      await expect(service.assertActiveByNo(vendorNo)).rejects.toThrow(/not ACTIVE/);
    });

    it('rejects an unknown vendorNo with 404', async () => {
      await expect(service.assertActiveByNo('VEN_DOES_NOT_EXIST')).rejects.toThrow(NotFoundException);
    });
  });

  // ── 审计信封真实过闸（真 AuditLogsService + 内存 mock Prisma，不碰真库）：同
  // compliance-obligations.service.spec.ts 先例——mock 版 recordByActor 是行为化 spy，
  // 不跑 assertActionSpec，COMPLIANCE_OFFICE_AUDIT_ACTIONS 的三个 VENDOR_* 声明是否真的
  // 被本服务的调用点喂对，只有让真校验跑一遍才知道。
  describe('audit envelope satisfies the real COMPLIANCE_OFFICE_AUDIT_ACTIONS contract (real AuditLogsService, mocked Prisma)', () => {
    let realService: OutsourcingVendorsService;

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
          OutsourcingVendorsService,
          { provide: PrismaService, useValue: auditPrisma },
          AuditLogsService,
        ],
      }).compile();
      realService = mod.get(OutsourcingVendorsService);
    });

    it('walks register→update→terminate without the real assertActionSpec rejecting any of the three codes', async () => {
      const { vendorNo } = await realService.register(mlro, baseDto);
      await realService.update(vendorNo, mlro, { notes: 'annual review done' });
      await realService.terminate(vendorNo, mlro, {});

      const actions = auditPrisma.__events.map((e: any) => e.action);
      expect(actions).toEqual(['VENDOR_REGISTERED', 'VENDOR_UPDATED', 'VENDOR_TERMINATED']);
      const correlationIds = new Set(auditPrisma.__events.map((e: any) => e.correlationId));
      expect(correlationIds.size).toBe(1); // 全部继承 VENDOR_REGISTERED 铸的 traceId
    });
  });
});
