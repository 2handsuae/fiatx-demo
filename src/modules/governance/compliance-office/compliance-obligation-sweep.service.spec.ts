import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ComplianceObligationSweepService } from './compliance-obligation-sweep.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ComplianceObligationsService } from './compliance-obligations.service';
import { RegulatoryFilingService } from '../regulatory-filings/regulatory-filing.service';
import { ObligationStatus, advanceDueDate } from './compliance-office.constants';
import { addBusinessDays } from '../regulatory-filings/business-days';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

/** 行为化内存行 mock（照 compliance-obligations.service.spec.ts 的 makePrisma 先例，同一条
 *  纪律：本目录单测全走 mock、不碰真库）。claimDue/recordGenerated 也做成真按 obligationNo
 *  读写内存行的行为化 mock——不是无脑 resolve，「mock 无视 where 会假绿」是本仓判例；这里
 *  尤其要紧：「翻期后同一 now 再跑零命中」这条断言必须靠 claimDue 真的把 nextDueAt 往前
 *  翻，sweep 第二次 findMany 才会读到翻后的值从而不再命中——不是靠 mock 调用次数断言。 */
function makeFixtures() {
  const rows = new Map<string, any>();

  function addObligation(overrides: Partial<{
    status: string; leadBusinessDays: number; nextDueAt: Date; frequency: string;
  }> = {}): string {
    const obligationNo = `OBL_SWEEP_${randomUUID().slice(0, 8).toUpperCase()}`;
    rows.set(obligationNo, {
      obligationNo, name: 'VARA quarterly prudential return', authority: 'VARA', basisNote: 'spec §9 row 3',
      frequency: overrides.frequency ?? 'QUARTERLY',
      leadBusinessDays: overrides.leadBusinessDays ?? 5,
      nextDueAt: overrides.nextDueAt ?? new Date('2026-09-30T00:00:00.000Z'),
      status: overrides.status ?? ObligationStatus.ACTIVE,
      lastFilingNo: null,
    });
    return obligationNo;
  }

  const prisma = {
    complianceObligation: {
      findMany: jest.fn(async ({ where }: any) =>
        [...rows.values()].filter((r) => (where?.status ? r.status === where.status : true))),
    },
  };

  const obligationsService = {
    claimDue: jest.fn(async (obligationNo: string, now: Date) => {
      const row = rows.get(obligationNo);
      if (!row) throw new Error(`no such row: ${obligationNo}`);
      const dueAt = row.nextDueAt;
      row.nextDueAt = advanceDueDate(dueAt, row.frequency);
      return { dueAt, obligation: { ...row } };
    }),
    recordGenerated: jest.fn(async (obligationNo: string, filingNo: string) => {
      const row = rows.get(obligationNo);
      if (row) row.lastFilingNo = filingNo;
    }),
  };

  const filingsService = {
    openForObligation: jest.fn(async (
      _obligation: { obligationNo: string; name: string; authority: string; basisNote: string },
      _dueAt: Date,
    ) => ({ filingNo: generateReferenceNo('FIL') })),
  };

  return { rows, prisma, obligationsService, filingsService, addObligation };
}

describe('ComplianceObligationSweepService (Task 3)', () => {
  let fx: ReturnType<typeof makeFixtures>;
  let service: ComplianceObligationSweepService;

  beforeEach(async () => {
    fx = makeFixtures();
    const mod = await Test.createTestingModule({
      providers: [
        ComplianceObligationSweepService,
        { provide: PrismaService, useValue: fx.prisma },
        { provide: ComplianceObligationsService, useValue: fx.obligationsService },
        { provide: RegulatoryFilingService, useValue: fx.filingsService },
      ],
    }).compile();
    service = mod.get(ComplianceObligationSweepService);
  });

  const now = new Date('2026-09-24T09:00:00.000Z'); // 迪拜周四

  it('① 命中：ACTIVE 且 addBusinessDays(now, lead) >= nextDueAt（边界相等）→ 命中序 claimDue→openForObligation→recordGenerated 各一次', async () => {
    const boundary = addBusinessDays(now, 5);
    const obligationNo = fx.addObligation({ leadBusinessDays: 5, nextDueAt: boundary });

    const result = await service.sweep(now);

    expect(result.generated).toBe(1);
    expect(fx.obligationsService.claimDue).toHaveBeenCalledWith(obligationNo, now);
    expect(fx.filingsService.openForObligation).toHaveBeenCalledTimes(1);
    const [obligationArg, dueAtArg] = fx.filingsService.openForObligation.mock.calls[0];
    expect(obligationArg).toMatchObject({ obligationNo, name: 'VARA quarterly prudential return', authority: 'VARA' });
    expect(dueAtArg.toISOString()).toBe(boundary.toISOString());
    expect(fx.obligationsService.recordGenerated).toHaveBeenCalledWith(obligationNo, expect.stringMatching(/^FIL\d{12}$/));
  });

  it('② 一期一单：翻期落库后同一 now 再跑一次 sweep，零命中', async () => {
    const boundary = addBusinessDays(now, 5);
    fx.addObligation({ leadBusinessDays: 5, nextDueAt: boundary });

    const first = await service.sweep(now);
    expect(first.generated).toBe(1);

    fx.filingsService.openForObligation.mockClear();
    const second = await service.sweep(now);

    expect(second.generated).toBe(0);
    expect(fx.filingsService.openForObligation).not.toHaveBeenCalled();
  });

  it('③ DISABLED 不命中：即便落在到期窗口内，也被 status 过滤在外', async () => {
    const boundary = addBusinessDays(now, 5);
    fx.addObligation({ status: ObligationStatus.DISABLED, leadBusinessDays: 5, nextDueAt: boundary });

    const result = await service.sweep(now);

    expect(result.generated).toBe(0);
    expect(fx.obligationsService.claimDue).not.toHaveBeenCalled();
  });

  it('④ 窗外不命中：addBusinessDays(now, lead) < nextDueAt', async () => {
    const beyond = new Date(addBusinessDays(now, 5).getTime() + 24 * 3600 * 1000);
    fx.addObligation({ leadBusinessDays: 5, nextDueAt: beyond });

    const result = await service.sweep(now);

    expect(result.generated).toBe(0);
    expect(fx.obligationsService.claimDue).not.toHaveBeenCalled();
  });

  it('⑤ openForObligation 抛错不拖垮批次；该义务已翻期（claimDue 已落库，已知非原子窗口，如实断言不掩饰）', async () => {
    const boundary = addBusinessDays(now, 5);
    const failingNo = fx.addObligation({ leadBusinessDays: 5, nextDueAt: boundary });
    const okNo = fx.addObligation({ leadBusinessDays: 5, nextDueAt: boundary });
    const originalNextDueAt = fx.rows.get(failingNo).nextDueAt.getTime();

    fx.filingsService.openForObligation.mockImplementation(async (obligation: any) => {
      if (obligation.obligationNo === failingNo) throw new Error('boom');
      return { filingNo: generateReferenceNo('FIL') };
    });

    const result = await service.sweep(now);

    expect(result.generated).toBe(1); // 只有 okNo 那一笔计入 generated
    // 已知非原子窗口：claimDue 已经翻期落库，openForObligation 抛错也不回滚——该期静默漏单
    // （PRODUCTION-NOTES 已登记，不在此补偿）。
    expect(fx.rows.get(failingNo).nextDueAt.getTime()).not.toBe(originalNextDueAt);
    expect(fx.rows.get(failingNo).lastFilingNo).toBeNull(); // recordGenerated 从未跑到
    expect(fx.rows.get(okNo).lastFilingNo).toEqual(expect.stringMatching(/^FIL\d{12}$/));
  });
});
