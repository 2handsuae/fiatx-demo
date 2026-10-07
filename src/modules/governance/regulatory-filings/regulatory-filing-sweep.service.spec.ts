import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { RegulatoryFilingSweepService } from './regulatory-filing-sweep.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { FilingStatus } from './regulatory-filing.constants';

describe('RegulatoryFilingSweepService (Task 7)', () => {
  let prisma: PrismaService;
  let service: RegulatoryFilingSweepService;
  let auditLogs: { recordSystem: jest.Mock };
  const createdFilingNos: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    if (createdFilingNos.length) {
      await prisma.auditLogEvent.deleteMany({ where: { primarySubjectType: 'REGULATORY_FILING', primarySubjectNo: { in: createdFilingNos } } });
      await prisma.regulatoryFiling.deleteMany({ where: { filingNo: { in: createdFilingNos } } });
    }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    auditLogs = { recordSystem: jest.fn(async () => ({})) };
    const mod = await Test.createTestingModule({
      providers: [
        RegulatoryFilingSweepService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = mod.get(RegulatoryFilingSweepService);
  });

  async function makeFiling(overrides: Partial<{
    status: string; deadlineAt: Date | null; overdueMarkedAt: Date | null;
  }> = {}): Promise<string> {
    const filingNo = generateReferenceNo('FIL');
    await prisma.regulatoryFiling.create({
      data: {
        filingNo, direction: 'OUTBOUND', type: 'MATERIAL_CHANGE_NOTIFICATION',
        authority: 'VARA', title: 'T7 sweep fixture',
        status: overrides.status ?? FilingStatus.DRAFT,
        deadlineAt: overrides.deadlineAt ?? null,
        overdueMarkedAt: overrides.overdueMarkedAt ?? null,
        createdByUserId: 'U_T7', traceId: randomUUID(),
      },
    });
    createdFilingNos.push(filingNo);
    return filingNo;
  }

  const now = new Date('2026-09-26T12:00:00.000Z');
  const past = new Date('2026-09-24T12:00:00.000Z');
  const future = new Date('2026-09-28T12:00:00.000Z');

  it('① deadline 已过、未标、DRAFT → 标记 overdueMarkedAt=now + 审计 FILING_OVERDUE_MARKED', async () => {
    const filingNo = await makeFiling({ status: FilingStatus.DRAFT, deadlineAt: past });

    const result = await service.sweep(now);

    expect(result.marked).toBe(1);
    const row = await prisma.regulatoryFiling.findUnique({ where: { filingNo } });
    expect(row?.overdueMarkedAt?.toISOString()).toBe(now.toISOString());

    expect(auditLogs.recordSystem).toHaveBeenCalledTimes(1);
    const call = auditLogs.recordSystem.mock.calls[0][0];
    expect(call).toMatchObject({
      action: 'FILING_OVERDUE_MARKED',
      actionDomain: 'GOVERNANCE',
      primarySubjectType: 'REGULATORY_FILING',
      primarySubjectNo: filingNo,
      deadlineAt: past.toISOString(),
    });
    // 整备波 T3 · C：deadlineAt 同时镜像进 metadata（顶层形态保留给 assertActionSpec）——
    // 审计行本身可查"超的是哪个截止时刻"。
    expect(call.metadata).toMatchObject({ filingNo, deadlineAt: past.toISOString() });
  });

  it('② 已 SUBMITTED（按时交）→ 不标（SUBMITTED 不在扫描状态集合内）', async () => {
    await makeFiling({ status: FilingStatus.SUBMITTED, deadlineAt: past });

    const result = await service.sweep(now);

    expect(result.marked).toBe(0);
    expect(auditLogs.recordSystem).not.toHaveBeenCalled();
  });

  it('③ 已标过 → 不重复标（overdueMarkedAt 非空天然不再匹配）', async () => {
    const markedAt = new Date('2026-09-25T00:00:00.000Z');
    const filingNo = await makeFiling({ status: FilingStatus.DRAFT, deadlineAt: past, overdueMarkedAt: markedAt });

    const result = await service.sweep(now);

    expect(result.marked).toBe(0);
    expect(auditLogs.recordSystem).not.toHaveBeenCalled();
    const row = await prisma.regulatoryFiling.findUnique({ where: { filingNo } });
    expect(row?.overdueMarkedAt?.toISOString()).toBe(markedAt.toISOString());
  });

  it('deadline 未过（未来）→ 不标', async () => {
    await makeFiling({ status: FilingStatus.PENDING_SIGNOFF, deadlineAt: future });

    const result = await service.sweep(now);

    expect(result.marked).toBe(0);
    expect(auditLogs.recordSystem).not.toHaveBeenCalled();
  });

  it('deadline 为 null（无钟义务）→ 不标', async () => {
    await makeFiling({ status: FilingStatus.SIGNED_OFF, deadlineAt: null });

    const result = await service.sweep(now);

    expect(result.marked).toBe(0);
    expect(auditLogs.recordSystem).not.toHaveBeenCalled();
  });

  it('④ 单笔失败不拖垮批次：一单审计写入抛错，其余照标', async () => {
    const failingFilingNo = await makeFiling({ status: FilingStatus.DRAFT, deadlineAt: past });
    const okFilingNo = await makeFiling({ status: FilingStatus.PENDING_SIGNOFF, deadlineAt: past });

    auditLogs.recordSystem.mockImplementation(async (input: any) => {
      if (input.primarySubjectNo === failingFilingNo) throw new Error('boom');
      return {};
    });

    const result = await service.sweep(now);

    expect(result.marked).toBe(1);
    const failingRow = await prisma.regulatoryFiling.findUnique({ where: { filingNo: failingFilingNo } });
    const okRow = await prisma.regulatoryFiling.findUnique({ where: { filingNo: okFilingNo } });
    // 失败单：审计抛错发生在 update 之后（同本模块 regulatory-filing.service.ts（T3）的
    // 先例——先落库、审计序列另写，状态变了但审计写入失败也不回滚；逐笔 try/catch 只防止
    // 拖垮批次，不做跨行原子性。swap-sla.service.ts 不是同款先例——它把状态更新与审计写入
    // 包在同一个 $transaction 里，审计失败会连状态一起回滚，是相反的模式，勿再误引）。
    expect(failingRow?.overdueMarkedAt).not.toBeNull();
    expect(okRow?.overdueMarkedAt?.toISOString()).toBe(now.toISOString());
  });

  it('全同一批扫描按时提交状态集合 status IN (DRAFT, PENDING_SIGNOFF, SIGNED_OFF)：三态各标一单', async () => {
    await makeFiling({ status: FilingStatus.DRAFT, deadlineAt: past });
    await makeFiling({ status: FilingStatus.PENDING_SIGNOFF, deadlineAt: past });
    await makeFiling({ status: FilingStatus.SIGNED_OFF, deadlineAt: past });
    await makeFiling({ status: FilingStatus.CLOSED, deadlineAt: past });
    await makeFiling({ status: FilingStatus.CANCELLED, deadlineAt: past });

    const result = await service.sweep(now);

    expect(result.marked).toBe(3);
  });

  // ── 审计信封真实过闸（真 AuditLogsService，不 mock）：证明 FILING_OVERDUE_MARKED
  // 的 requiredFields=['deadlineAt'] 声明真的被本 service 的调用点喂对——顶层展开，
  // assertActionSpec 不拒（第 2 条纪律：报绿之前先确认检查真的会红）。
  describe('audit envelope satisfies the real REG_FILING_AUDIT_ACTIONS contract (real AuditLogsService, no mock)', () => {
    let realService: RegulatoryFilingSweepService;

    beforeEach(async () => {
      const mod = await Test.createTestingModule({
        providers: [
          RegulatoryFilingSweepService,
          { provide: PrismaService, useValue: prisma },
          AuditLogsService,
        ],
      }).compile();
      realService = mod.get(RegulatoryFilingSweepService);
    });

    it('marks an overdue DRAFT filing without the real assertActionSpec rejecting FILING_OVERDUE_MARKED', async () => {
      const filingNo = await makeFiling({ status: FilingStatus.DRAFT, deadlineAt: past });

      const result = await realService.sweep(now);

      expect(result.marked).toBeGreaterThanOrEqual(1);
      const events = await prisma.auditLogEvent.findMany({ where: { primarySubjectType: 'REGULATORY_FILING', primarySubjectNo: filingNo } });
      expect(events.map((e) => e.action)).toEqual(['FILING_OVERDUE_MARKED']);
      expect(events[0].correlationId).toBeTruthy();
      // 整备波 T3 · C：持久化的审计行 metadata 里真的有 deadlineAt（不只是 mock 入参）。
      expect(JSON.parse(events[0].metadata as string)).toMatchObject({ deadlineAt: past.toISOString() });
    });
  });
});
