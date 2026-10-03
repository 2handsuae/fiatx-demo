import { ComplianceClockWallService } from './compliance-clock-wall.service';

/** 行为化内存行 mock（照 compliance-obligation-sweep.service.spec.ts 的 makeFixtures
 *  先例）：findMany 的 mock 真的按 `where` 过滤内存行——「mock 无视 where 会假绿」
 *  是本仓判例，尤其要紧的是这里：SUBMITTED/DISABLED 两类"该下墙"的行必须真的被过滤掉，
 *  不是靠断言调用参数蒙混过关。 */
function makeFixtures() {
  const filingRows: any[] = [];
  const obligationRows: any[] = [];

  function addFiling(overrides: Partial<{
    filingNo: string; title: string; authority: string; status: string;
    deadlineAt: Date | null; overdueMarkedAt: Date | null;
  }> = {}) {
    filingRows.push({
      filingNo: overrides.filingNo ?? 'FIL260101000001',
      title: overrides.title ?? 'Quarterly compliance return — 2026 Q4',
      authority: overrides.authority ?? 'VARA',
      status: overrides.status ?? 'DRAFT',
      deadlineAt: overrides.deadlineAt !== undefined ? overrides.deadlineAt : new Date('2026-12-31T00:00:00.000Z'),
      overdueMarkedAt: overrides.overdueMarkedAt ?? null,
    });
  }

  function addObligation(overrides: Partial<{
    obligationNo: string; name: string; authority: string; status: string; nextDueAt: Date;
  }> = {}) {
    obligationRows.push({
      obligationNo: overrides.obligationNo ?? 'OBL260101000001',
      name: overrides.name ?? 'VARA quarterly report',
      authority: overrides.authority ?? 'VARA',
      status: overrides.status ?? 'ACTIVE',
      nextDueAt: overrides.nextDueAt ?? new Date('2026-12-31T00:00:00.000Z'),
    });
  }

  const complaintRows: any[] = [];

  function addComplaint(overrides: Partial<{
    complaintNo: string; subject: string; currentStatus: string;
    ackDeadlineAt: Date; acknowledgedAt: Date | null; resolveDeadlineAt: Date;
  }> = {}) {
    complaintRows.push({
      complaintNo: overrides.complaintNo ?? 'CMP260101000001',
      subject: overrides.subject ?? 'Order stuck in processing',
      currentStatus: overrides.currentStatus ?? 'RECEIVED',
      ackDeadlineAt: overrides.ackDeadlineAt ?? new Date('2026-12-31T00:00:00.000Z'),
      acknowledgedAt: overrides.acknowledgedAt !== undefined ? overrides.acknowledgedAt : null,
      resolveDeadlineAt: overrides.resolveDeadlineAt ?? new Date('2027-01-28T00:00:00.000Z'),
    });
  }

  const dsrRows: any[] = [];

  function addDsr(overrides: Partial<{
    requestNo: string; type: string; status: string; dueAt: Date;
  }> = {}) {
    dsrRows.push({
      requestNo: overrides.requestNo ?? 'DSR-260101-000001',
      type: overrides.type ?? 'ACCESS',
      status: overrides.status ?? 'SUBMITTED',
      dueAt: overrides.dueAt ?? new Date('2027-01-30T00:00:00.000Z'),
    });
  }

  const prisma = {
    regulatoryFiling: {
      findMany: jest.fn(async ({ where }: any) =>
        filingRows.filter((r) => {
          if (where?.deadlineAt?.not === null && r.deadlineAt == null) return false;
          if (where?.status?.in && !where.status.in.includes(r.status)) return false;
          return true;
        })),
    },
    complianceObligation: {
      findMany: jest.fn(async ({ where }: any) =>
        obligationRows.filter((r) => (where?.status ? r.status === where.status : true))),
    },
    complaint: {
      // 行为化 mock 真按 where 过滤（本仓判例）：currentStatus.not = 'RESOLVED' 时，
      // RESOLVED 行必须真的被滤掉，不是靠断言调用参数蒙混过关。
      findMany: jest.fn(async ({ where }: any) =>
        complaintRows.filter((r) => (where?.currentStatus?.not ? r.currentStatus !== where.currentStatus.not : true))),
    },
    // 战役丙波四 T10：第四张表。同样行为化——status.not='RESOLVED' 真的滤掉 RESOLVED 行。
    // 注意 Prisma 模型名是 DataSubjectRequest（表 data_subject_requests），不是 dsrRequest。
    dataSubjectRequest: {
      findMany: jest.fn(async ({ where }: any) =>
        dsrRows.filter((r) => (where?.status?.not ? r.status !== where.status.not : true))),
    },
  };

  return { prisma, addFiling, addObligation, addComplaint, addDsr };
}

describe('ComplianceClockWallService.getWall (Task 5, spec §2)', () => {
  it('FILING 行：DRAFT/PENDING_SIGNOFF/SIGNED_OFF 且 deadlineAt 非空 → 上墙', async () => {
    const fx = makeFixtures();
    fx.addFiling({ filingNo: 'FIL_DRAFT', status: 'DRAFT' });
    fx.addFiling({ filingNo: 'FIL_PENDING', status: 'PENDING_SIGNOFF' });
    fx.addFiling({ filingNo: 'FIL_SIGNED', status: 'SIGNED_OFF' });
    const service = new ComplianceClockWallService(fx.prisma as any);

    const rows = await service.getWall();
    const filingRefNos = rows.filter((r) => r.kind === 'FILING').map((r) => r.refNo);
    expect(filingRefNos.sort()).toEqual(['FIL_DRAFT', 'FIL_PENDING', 'FIL_SIGNED'].sort());
  });

  it('按时提交的单不上墙（SUBMITTED 被过滤掉，即便 deadlineAt 非空）', async () => {
    const fx = makeFixtures();
    fx.addFiling({ filingNo: 'FIL_SUBMITTED', status: 'SUBMITTED' });
    const service = new ComplianceClockWallService(fx.prisma as any);

    const rows = await service.getWall();
    expect(rows.some((r) => r.refNo === 'FIL_SUBMITTED')).toBe(false);
  });

  it('办结/作废的终态单不上墙', async () => {
    const fx = makeFixtures();
    fx.addFiling({ filingNo: 'FIL_CLOSED', status: 'CLOSED' });
    fx.addFiling({ filingNo: 'FIL_CANCELLED', status: 'CANCELLED' });
    const service = new ComplianceClockWallService(fx.prisma as any);

    const rows = await service.getWall();
    expect(rows.some((r) => r.refNo === 'FIL_CLOSED')).toBe(false);
    expect(rows.some((r) => r.refNo === 'FIL_CANCELLED')).toBe(false);
  });

  it('deadlineAt 为空的单不上墙（尚无时限依据）', async () => {
    const fx = makeFixtures();
    fx.addFiling({ filingNo: 'FIL_NO_DEADLINE', status: 'DRAFT', deadlineAt: null });
    const service = new ComplianceClockWallService(fx.prisma as any);

    const rows = await service.getWall();
    expect(rows.some((r) => r.refNo === 'FIL_NO_DEADLINE')).toBe(false);
  });

  it('overdue 红标位：已被 sweep 标过 overdueMarkedAt 的单仍在三态之一——红着留墙', async () => {
    const fx = makeFixtures();
    fx.addFiling({ filingNo: 'FIL_OVERDUE', status: 'DRAFT', overdueMarkedAt: new Date('2026-10-01T00:00:00.000Z') });
    fx.addFiling({ filingNo: 'FIL_ON_TIME', status: 'DRAFT', overdueMarkedAt: null });
    const service = new ComplianceClockWallService(fx.prisma as any);

    const rows = await service.getWall();
    const overdue = rows.find((r) => r.refNo === 'FIL_OVERDUE');
    const onTime = rows.find((r) => r.refNo === 'FIL_ON_TIME');
    expect(overdue!.overdue).toBe(true);
    expect(onTime!.overdue).toBe(false);
  });

  it('OBLIGATION 行：ACTIVE 上墙，overdue 恒 false（红色由生成的工单行承担）', async () => {
    const fx = makeFixtures();
    fx.addObligation({ obligationNo: 'OBL_ACTIVE', status: 'ACTIVE' });
    const service = new ComplianceClockWallService(fx.prisma as any);

    const rows = await service.getWall();
    const row = rows.find((r) => r.refNo === 'OBL_ACTIVE');
    expect(row).toBeDefined();
    expect(row!.kind).toBe('OBLIGATION');
    expect(row!.overdue).toBe(false);
  });

  it('DISABLED 义务不上墙', async () => {
    const fx = makeFixtures();
    fx.addObligation({ obligationNo: 'OBL_DISABLED', status: 'DISABLED' });
    const service = new ComplianceClockWallService(fx.prisma as any);

    const rows = await service.getWall();
    expect(rows.some((r) => r.refNo === 'OBL_DISABLED')).toBe(false);
  });

  it('归一行形状：含 refNo/kind/deadlineAt/overdue/title/authority/status/linkKey', async () => {
    const fx = makeFixtures();
    fx.addFiling({ filingNo: 'FIL_SHAPE', status: 'DRAFT', authority: 'UAE_FIU', title: 'Shape check filing' });
    fx.addObligation({ obligationNo: 'OBL_SHAPE', authority: 'VARA', name: 'Shape check obligation' });
    const service = new ComplianceClockWallService(fx.prisma as any);

    const rows = await service.getWall();
    const filingRow = rows.find((r) => r.refNo === 'FIL_SHAPE')!;
    expect(filingRow).toEqual({
      kind: 'FILING', refNo: 'FIL_SHAPE', title: 'Shape check filing', authority: 'UAE_FIU',
      deadlineAt: '2026-12-31T00:00:00.000Z', overdue: false, status: 'DRAFT', linkKey: 'FIL_SHAPE',
    });
    const obligationRow = rows.find((r) => r.refNo === 'OBL_SHAPE')!;
    expect(obligationRow).toEqual({
      kind: 'OBLIGATION', refNo: 'OBL_SHAPE', title: 'Shape check obligation', authority: 'VARA',
      deadlineAt: '2026-12-31T00:00:00.000Z', overdue: false, status: 'ACTIVE', linkKey: 'OBL_SHAPE',
    });
  });

  // 战役甲波五 T5（brief §clock-wall）：COMPLAINT 分支——先测后写。
  describe('COMPLAINT 分支（战役甲波五 T5）', () => {
    it('未确认件（acknowledgedAt=null）走确认钟：deadlineAt=ackDeadlineAt，clockLabel=ACK (1w)', async () => {
      const fx = makeFixtures();
      const ackDeadlineAt = new Date(Date.now() + 6 * 86400000);
      const resolveDeadlineAt = new Date(Date.now() + 27 * 86400000);
      fx.addComplaint({
        complaintNo: 'CMP_UNACKED', currentStatus: 'RECEIVED', acknowledgedAt: null,
        ackDeadlineAt, resolveDeadlineAt,
      });
      const service = new ComplianceClockWallService(fx.prisma as any);

      const rows = await service.getWall();
      const row = rows.find((r) => r.refNo === 'CMP_UNACKED')!;
      expect(row).toBeDefined();
      expect(row.kind).toBe('COMPLAINT');
      expect(row.deadlineAt).toBe(ackDeadlineAt.toISOString());
      expect((row as any).clockLabel).toBe('ACK (1w)');
    });

    it('已确认件（acknowledgedAt 非空）走裁决钟：deadlineAt=resolveDeadlineAt，clockLabel=RESOLVE (4w/8w)', async () => {
      const fx = makeFixtures();
      const ackDeadlineAt = new Date(Date.now() + 6 * 86400000);
      const resolveDeadlineAt = new Date(Date.now() + 20 * 86400000);
      fx.addComplaint({
        complaintNo: 'CMP_ACKED', currentStatus: 'INVESTIGATING', acknowledgedAt: new Date(Date.now() - 86400000),
        ackDeadlineAt, resolveDeadlineAt,
      });
      const service = new ComplianceClockWallService(fx.prisma as any);

      const rows = await service.getWall();
      const row = rows.find((r) => r.refNo === 'CMP_ACKED')!;
      expect(row).toBeDefined();
      expect(row.deadlineAt).toBe(resolveDeadlineAt.toISOString());
      expect((row as any).clockLabel).toBe('RESOLVE (4w/8w)');
    });

    it('RESOLVED 不上墙', async () => {
      const fx = makeFixtures();
      fx.addComplaint({ complaintNo: 'CMP_RESOLVED', currentStatus: 'RESOLVED', acknowledgedAt: new Date() });
      const service = new ComplianceClockWallService(fx.prisma as any);

      const rows = await service.getWall();
      expect(rows.some((r) => r.refNo === 'CMP_RESOLVED')).toBe(false);
    });

    it('overdue 红标位：deadline < now 为真才红——不复用他表的 overdueMarkedAt 列名，现算', async () => {
      const fx = makeFixtures();
      fx.addComplaint({
        complaintNo: 'CMP_OVERDUE', currentStatus: 'RECEIVED', acknowledgedAt: null,
        ackDeadlineAt: new Date(Date.now() - 3600 * 1000), // 已过期 1 小时（同 simulateTimeout ⚡ 拨法）
      });
      fx.addComplaint({
        complaintNo: 'CMP_ON_TIME', currentStatus: 'RECEIVED', acknowledgedAt: null,
        ackDeadlineAt: new Date(Date.now() + 3600 * 1000),
      });
      const service = new ComplianceClockWallService(fx.prisma as any);

      const rows = await service.getWall();
      const overdue = rows.find((r) => r.refNo === 'CMP_OVERDUE');
      const onTime = rows.find((r) => r.refNo === 'CMP_ON_TIME');
      expect(overdue!.overdue).toBe(true);
      expect(onTime!.overdue).toBe(false);
    });

    it('归一行形状：kind=COMPLAINT，refNo=complaintNo，title=subject，linkKey=complaintNo', async () => {
      const fx = makeFixtures();
      const ackDeadlineAt = new Date(Date.now() + 6 * 86400000);
      fx.addComplaint({
        complaintNo: 'CMP_SHAPE', subject: 'Fee dispute', currentStatus: 'RECEIVED',
        acknowledgedAt: null, ackDeadlineAt,
      });
      const service = new ComplianceClockWallService(fx.prisma as any);

      const rows = await service.getWall();
      const row = rows.find((r) => r.refNo === 'CMP_SHAPE')!;
      expect(row.kind).toBe('COMPLAINT');
      expect(row.refNo).toBe('CMP_SHAPE');
      expect(row.title).toBe('Fee dispute');
      expect(row.linkKey).toBe('CMP_SHAPE');
      expect(row.status).toBe('RECEIVED');
    });
  });

  // 战役丙波四 T10：DSR 第四类灯（单钟 30 自然日；overdue 读时现算，投诉同款，不存标记不加 sweep）。
  describe('DSR 分支（战役丙波四 T10）', () => {
    it('未办结 DSR 上墙：SUBMITTED / IN_REVIEW 各一行，带 clockLabel=RESPOND (30d)', async () => {
      const fx = makeFixtures();
      fx.addDsr({ requestNo: 'DSR_SUBMITTED', status: 'SUBMITTED' });
      fx.addDsr({ requestNo: 'DSR_IN_REVIEW', status: 'IN_REVIEW' });
      const service = new ComplianceClockWallService(fx.prisma as any);

      const rows = await service.getWall();
      const dsrRows = rows.filter((r) => r.kind === 'DSR');
      expect(dsrRows.map((r) => r.refNo).sort()).toEqual(['DSR_IN_REVIEW', 'DSR_SUBMITTED']);
      expect(dsrRows.every((r) => r.clockLabel === 'RESPOND (30d)')).toBe(true);
    });

    it('RESOLVED 不上墙', async () => {
      const fx = makeFixtures();
      fx.addDsr({ requestNo: 'DSR_RESOLVED', status: 'RESOLVED' });
      const service = new ComplianceClockWallService(fx.prisma as any);

      const rows = await service.getWall();
      expect(rows.some((r) => r.refNo === 'DSR_RESOLVED')).toBe(false);
    });

    it('overdue 红标位：dueAt < now 为真才红——读时现算（同 simulateTimeout ⚡ 拨到 now−1h）', async () => {
      const fx = makeFixtures();
      fx.addDsr({ requestNo: 'DSR_OVERDUE', status: 'IN_REVIEW', dueAt: new Date(Date.now() - 3600 * 1000) });
      fx.addDsr({ requestNo: 'DSR_ON_TIME', status: 'IN_REVIEW', dueAt: new Date(Date.now() + 3600 * 1000) });
      const service = new ComplianceClockWallService(fx.prisma as any);

      const rows = await service.getWall();
      expect(rows.find((r) => r.refNo === 'DSR_OVERDUE')!.overdue).toBe(true);
      expect(rows.find((r) => r.refNo === 'DSR_ON_TIME')!.overdue).toBe(false);
    });

    it('归一行形状：kind=DSR，refNo=linkKey=requestNo，title=Data request · <type>，authority=DPO，deadlineAt=dueAt', async () => {
      const fx = makeFixtures();
      const dueAt = new Date(Date.now() + 29 * 86400000);
      fx.addDsr({ requestNo: 'DSR_SHAPE', type: 'ERASURE', status: 'SUBMITTED', dueAt });
      const service = new ComplianceClockWallService(fx.prisma as any);

      const rows = await service.getWall();
      expect(rows.find((r) => r.refNo === 'DSR_SHAPE')).toEqual({
        kind: 'DSR', refNo: 'DSR_SHAPE', title: 'Data request · ERASURE', authority: 'DPO',
        deadlineAt: dueAt.toISOString(), overdue: false, status: 'SUBMITTED', linkKey: 'DSR_SHAPE',
        clockLabel: 'RESPOND (30d)',
      });
    });
  });
});
