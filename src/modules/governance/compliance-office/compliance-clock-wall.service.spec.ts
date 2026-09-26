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
  };

  return { prisma, addFiling, addObligation };
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
});
