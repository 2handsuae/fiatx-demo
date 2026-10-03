// 战役丙波四 T3：月结单生成器 + 出具 sweep。
// 全部 mock 走行为化（照波一判例「mock 无视 where 会假绿」）：
//   - customerMonthlyStatement.create 真按 (customerId, periodMonth) 唯一约束抛 P2002，
//     findMany 真按 where.customerId 过滤；
//   - tbAccountRegistry.findByOwner 真按 ownerUuid 过滤，并混入非 CLIENT_PAYABLE 户证明生成器只取 code=100；
//   - tbEvidence.getAccountStatement 真按 tbAccountId 取各自腿；
//   - asset.findFirst 真按 where.currency 查；customerMain.findMany 真按 onboardingApprovedAt not null 过滤；
//   - CustomerStatementService 用真实现（非 mock）——tipping-off 白名单继承是行为，不是调用次数。
import { NotFoundException } from '@nestjs/common';
import { MonthlyStatementService } from './monthly-statement.service';
import { MonthlyStatementSweepService } from './monthly-statement-sweep.service';
import { CustomerStatementService } from './customer-statement.service';
import { AuditActions, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';

type LegFixture = {
  tbTransferId: string;
  sourceType: string;
  sourceNo: string;
  eventCode: string;
  direction: 'IN' | 'OUT';
  amount: number;
  runningBalance: number;
  assetCode: string;
  memo: string | null;
  isExternalCrossing: boolean;
  externalRef: string | null;
  createdAt: string;
};

function leg(
  eventCode: string,
  direction: 'IN' | 'OUT',
  amount: number,
  runningBalance: number,
  createdAt: string,
  extra: Partial<LegFixture> = {},
): LegFixture {
  const sourceType = extra.sourceType ?? (
    eventCode.startsWith('DEPOSIT') ? 'DEPOSIT'
      : eventCode.startsWith('SWAP') ? 'SWAP'
        : eventCode.startsWith('WITHDRAW') ? 'WITHDRAWAL'
          : 'OTHER'
  );
  return {
    tbTransferId: `tx-${createdAt}-${eventCode}`,
    sourceType,
    sourceNo: extra.sourceNo ?? `${sourceType}-${createdAt.slice(0, 10)}`,
    eventCode,
    direction,
    amount,
    runningBalance,
    assetCode: 'AED',
    memo: null,
    isExternalCrossing: false,
    externalRef: null,
    createdAt,
    ...extra,
  };
}

const CLIENT_PAYABLE = 100;
const DEPOSIT_SUSPENSE = 101;

function makeHarness(opts: {
  legsByAccount?: Record<string, LegFixture[]>;
  registry?: Array<{ tbAccountId: string; code: number; ledger: number; ownerUuid: string }>;
  statements?: Array<{ customerId: string; periodMonth: string; statementNo: string; payload: string; issuedAt?: Date }>;
  customers?: Array<{ id: string; customerNo: string; onboardingApprovedAt: Date | null }>;
} = {}) {
  const statementRows: any[] = [...(opts.statements ?? [])];
  const callOrder: string[] = [];

  const prisma: any = {
    customerMonthlyStatement: {
      create: jest.fn(async ({ data }: any) => {
        callOrder.push('create');
        const dup = statementRows.find(
          (r) => r.customerId === data.customerId && r.periodMonth === data.periodMonth,
        );
        if (dup) {
          const err: any = new Error('Unique constraint failed on (customerId, periodMonth)');
          err.code = 'P2002';
          throw err;
        }
        const row = { id: `row-${statementRows.length + 1}`, issuedAt: new Date(), ...data };
        statementRows.push(row);
        return row;
      }),
      // 行为化：真按 where.customerId 过滤、真按 orderBy.periodMonth 排序、真按 select 投影——
      // T4 的"列表不带 payload / 降序"才有可能红。
      findMany: jest.fn(async ({ where, orderBy, select }: any = {}) => {
        let rows = statementRows.filter((r) => (where?.customerId ? r.customerId === where.customerId : true));
        if (orderBy?.periodMonth) {
          const dir = orderBy.periodMonth === 'desc' ? -1 : 1;
          rows = [...rows].sort((a, b) => dir * a.periodMonth.localeCompare(b.periodMonth));
        }
        if (select) {
          rows = rows.map((r) => Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, r[k]])));
        }
        return rows;
      }),
      // 真按 where.statementNo 与 where.customerId 同时匹配（缺任一键即查不到）。
      findFirst: jest.fn(async ({ where }: any) =>
        statementRows.find((r) =>
          (where?.statementNo ? r.statementNo === where.statementNo : true)
          && (where?.customerId ? r.customerId === where.customerId : true)) ?? null),
      update: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    asset: {
      findFirst: jest.fn(async ({ where }: any) => {
        const assets = [
          { currency: 'AED', type: 'FIAT', decimals: 2 },
          { currency: 'USDT', type: 'CRYPTO', decimals: 6 },
        ];
        return assets.find((a) => (where?.currency ? a.currency === where.currency : true)) ?? null;
      }),
      findMany: jest.fn(async () => [
        { currency: 'AED', decimals: 2 },
        { currency: 'USDT', decimals: 6 },
      ]),
    },
    customerMain: {
      findMany: jest.fn(async ({ where }: any) =>
        (opts.customers ?? []).filter((c) =>
          where?.onboardingApprovedAt?.not === null ? c.onboardingApprovedAt !== null : true)),
    },
    // CustomerStatementService 内部读：无平账调整、无 swap 币种表（标题走默认文案即可）
    reconciliationAdjustment: { findMany: jest.fn(async () => []) },
    swapTransaction: {
      findMany: jest.fn(async ({ where }: any) =>
        [{ swapNo: 'SWAP-2026-09-05', fromAssetCode: 'AED', toAssetCode: 'USDT' }]
          .filter((s) => (where?.swapNo?.in ? where.swapNo.in.includes(s.swapNo) : true))),
    },
  };

  const registryRows = opts.registry ?? [
    { tbAccountId: 'acc-aed', code: CLIENT_PAYABLE, ledger: 1, ownerUuid: 'c1' },
  ];
  const registry = {
    findByOwner: jest.fn(async (ownerUuid: string) => registryRows.filter((r) => r.ownerUuid === ownerUuid)),
  };

  const legsByAccount = opts.legsByAccount ?? {};
  const tbEvidence = {
    getAccountStatement: jest.fn(async (tbAccountId: string) => {
      const items = legsByAccount[tbAccountId] ?? [];
      return { items, currentBalance: items.length ? items[items.length - 1].runningBalance : 0 };
    }),
  };

  const auditLogs = {
    recordSystem: jest.fn(async () => { callOrder.push('audit'); return {}; }),
  };

  const notifications = { notifyStatementIssued: jest.fn(async () => undefined) };

  const statementReader = new CustomerStatementService(prisma);
  const service = new MonthlyStatementService(
    prisma, registry as any, tbEvidence as any, statementReader, auditLogs as any,
  );
  const sweep = new MonthlyStatementSweepService(prisma, service, notifications as any);

  return { prisma, registry, tbEvidence, auditLogs, notifications, service, sweep, statementRows, callOrder };
}

describe('MonthlyStatementService', () => {
  describe('issue', () => {
    it('期初=窗口前最后腿 runningBalance、期末=窗口内最后腿；窗口外的 8 月腿不入行', async () => {
      const h = makeHarness({
        legsByAccount: {
          'acc-aed': [
            leg('DEPOSIT_SUSPENSE_TO_PAYABLE', 'IN', 50000, 50000, '2026-08-15T08:00:00.000Z'),
            leg('SWAP_SELL_CLIENT', 'OUT', 10000, 40000, '2026-09-05T08:00:00.000Z', { sourceNo: 'SWAP-2026-09-05' }),
            leg('WITHDRAW_NET_POST', 'OUT', 5000, 35000, '2026-09-20T08:00:00.000Z'),
          ],
        },
      });

      const no = await h.service.issue({ id: 'c1', customerNo: 'CU1' }, '2026-09');

      const row = h.prisma.customerMonthlyStatement.create.mock.calls[0][0].data;
      const aed = JSON.parse(row.payload).sections.find((s: any) => s.assetCode === 'AED');
      expect(no).toBe('STM-CU1-202609');
      expect(row.statementNo).toBe('STM-CU1-202609');
      expect(row.customerId).toBe('c1');
      expect(row.periodMonth).toBe('2026-09');
      expect(aed.isFiat).toBe(true);
      expect(aed.openingBalance).toBe('50000');
      expect(aed.closingBalance).toBe('35000');
      expect(aed.rows).toHaveLength(2); // swap 行 + 提现行，8 月腿不入窗口
      expect(aed.rows.map((r: any) => r.kind).sort()).toEqual(['SWAP', 'WITHDRAWAL']);
      // 行号金额为最小单位整数字符串
      expect(aed.rows.map((r: any) => r.amount).sort()).toEqual(['-10000', '-5000']);
    });

    it('窗口边界按迪拜业务月：UTC 8/31 20:00 起属 9 月，UTC 9/30 20:00 起属 10 月', async () => {
      const h = makeHarness({
        legsByAccount: {
          'acc-aed': [
            // 迪拜 8/31 23:59 → 8 月（窗口前，进期初）
            leg('DEPOSIT_SUSPENSE_TO_PAYABLE', 'IN', 1000, 1000, '2026-08-31T19:59:59.000Z'),
            // 迪拜 9/1 00:00 → 9 月（窗口内）
            leg('DEPOSIT_SUSPENSE_TO_PAYABLE', 'IN', 200, 1200, '2026-08-31T20:00:00.000Z', { sourceNo: 'DEPOSIT-B' }),
            // 迪拜 10/1 00:00 → 10 月（窗口后，不进期末也不进行）
            leg('DEPOSIT_SUSPENSE_TO_PAYABLE', 'IN', 300, 1500, '2026-09-30T20:00:00.000Z', { sourceNo: 'DEPOSIT-C' }),
          ],
        },
      });

      await h.service.issue({ id: 'c1', customerNo: 'CU1' }, '2026-09');

      const aed = JSON.parse(h.prisma.customerMonthlyStatement.create.mock.calls[0][0].data.payload)
        .sections.find((s: any) => s.assetCode === 'AED');
      expect(aed.openingBalance).toBe('1000');
      expect(aed.closingBalance).toBe('1200');
      expect(aed.rows).toHaveLength(1);
      expect(aed.rows[0].amount).toBe('200');
    });

    it('零腿币种照样出节：期初=期末=0 且无行；只取 CLIENT_PAYABLE 户（暂扣户不入）', async () => {
      const h = makeHarness({
        registry: [
          { tbAccountId: 'acc-aed', code: CLIENT_PAYABLE, ledger: 1, ownerUuid: 'c1' },
          { tbAccountId: 'acc-usdt', code: CLIENT_PAYABLE, ledger: 2, ownerUuid: 'c1' },
          { tbAccountId: 'acc-susp', code: DEPOSIT_SUSPENSE, ledger: 1, ownerUuid: 'c1' },
          // 别的客户的户不能串进来
          { tbAccountId: 'acc-other', code: CLIENT_PAYABLE, ledger: 1, ownerUuid: 'c2' },
        ],
        legsByAccount: {
          'acc-aed': [leg('DEPOSIT_SUSPENSE_TO_PAYABLE', 'IN', 7000, 7000, '2026-09-02T08:00:00.000Z')],
          'acc-susp': [leg('DEPOSIT_SUSPENSE_IN', 'IN', 999, 999, '2026-09-03T08:00:00.000Z')],
          'acc-other': [leg('DEPOSIT_SUSPENSE_TO_PAYABLE', 'IN', 123, 123, '2026-09-03T08:00:00.000Z')],
        },
      });

      await h.service.issue({ id: 'c1', customerNo: 'CU1' }, '2026-09');

      const sections = JSON.parse(h.prisma.customerMonthlyStatement.create.mock.calls[0][0].data.payload).sections;
      expect(sections.map((s: any) => s.assetCode)).toEqual(['AED', 'USDT']);
      const usdt = sections.find((s: any) => s.assetCode === 'USDT');
      expect(usdt.isFiat).toBe(false);
      expect(usdt.openingBalance).toBe('0');
      expect(usdt.closingBalance).toBe('0');
      expect(usdt.rows).toEqual([]);
      const aed = sections.find((s: any) => s.assetCode === 'AED');
      expect(aed.closingBalance).toBe('7000');
      expect(aed.rows).toHaveLength(1);
      // 暂扣户与他人户的腿从未被读取
      const readIds = h.tbEvidence.getAccountStatement.mock.calls.map((c: any[]) => c[0]).sort();
      expect(readIds).toEqual(['acc-aed', 'acc-usdt']);
    });

    it('窗口无腿但窗口前有腿：期末=期初（承上月余额）', async () => {
      const h = makeHarness({
        legsByAccount: {
          'acc-aed': [leg('DEPOSIT_SUSPENSE_TO_PAYABLE', 'IN', 50000, 50000, '2026-08-15T08:00:00.000Z')],
        },
      });

      await h.service.issue({ id: 'c1', customerNo: 'CU1' }, '2026-09');

      const aed = JSON.parse(h.prisma.customerMonthlyStatement.create.mock.calls[0][0].data.payload).sections[0];
      expect(aed.openingBalance).toBe('50000');
      expect(aed.closingBalance).toBe('50000');
      expect(aed.rows).toEqual([]);
    });

    it('无任何币种账户的客户照样出单（空 sections）——无活动月结单是真实银行行为', async () => {
      const h = makeHarness({ registry: [] });

      const no = await h.service.issue({ id: 'c1', customerNo: 'CU1' }, '2026-09');

      expect(no).toBe('STM-CU1-202609');
      expect(h.prisma.customerMonthlyStatement.create).toHaveBeenCalledTimes(1);
      expect(JSON.parse(h.prisma.customerMonthlyStatement.create.mock.calls[0][0].data.payload)).toEqual({ sections: [] });
    });

    it('审计：落库之后恰一次 recordSystem(STATEMENT_ISSUED)，requestId=statementNo，必填字段顶层展开', async () => {
      const h = makeHarness();

      await h.service.issue({ id: 'c1', customerNo: 'CU1' }, '2026-09');

      expect(h.callOrder).toEqual(['create', 'audit']); // 持久物先于留痕
      expect(h.auditLogs.recordSystem).toHaveBeenCalledTimes(1);
      const arg = (h.auditLogs.recordSystem.mock.calls[0] as any[])[0];
      expect(arg.action).toBe(AuditActions.STATEMENT_ISSUED);
      expect(arg.action).toBe('STATEMENT_ISSUED');
      expect(arg.actionDomain).toBe('GOVERNANCE');
      expect(arg.primarySubjectType).toBe(AuditEntityTypes.MONTHLY_STATEMENT);
      expect(arg.primarySubjectNo).toBe('STM-CU1-202609');
      expect(arg.ownerCustomerNo).toBe('CU1');
      expect(arg.requestId).toBe('STM-CU1-202609');
      expect(arg.statementNo).toBe('STM-CU1-202609');
      expect(arg.periodMonth).toBe('2026-09');
      expect(arg.metadata).toEqual({ statementNo: 'STM-CU1-202609', periodMonth: '2026-09' });
    });

    it('同客户同月二次 issue 抛（唯一约束路径），首单 payload 不被改写、不再写第二条审计', async () => {
      const h = makeHarness({
        legsByAccount: {
          'acc-aed': [leg('DEPOSIT_SUSPENSE_TO_PAYABLE', 'IN', 50000, 50000, '2026-09-02T08:00:00.000Z')],
        },
      });

      await h.service.issue({ id: 'c1', customerNo: 'CU1' }, '2026-09');
      const firstPayload = h.statementRows[0].payload;

      // 账本在两次出具之间又动了（后月平账调整回溯之类）——第二次若能写就会得到不同 payload
      h.tbEvidence.getAccountStatement.mockResolvedValueOnce({
        items: [leg('DEPOSIT_SUSPENSE_TO_PAYABLE', 'IN', 99999, 99999, '2026-09-10T08:00:00.000Z')],
        currentBalance: 99999,
      });
      await expect(h.service.issue({ id: 'c1', customerNo: 'CU1' }, '2026-09')).rejects.toMatchObject({ code: 'P2002' });

      expect(h.statementRows).toHaveLength(1);
      expect(h.statementRows[0].payload).toBe(firstPayload); // 快照不可变
      expect(h.prisma.customerMonthlyStatement.update).not.toHaveBeenCalled();
      expect(h.prisma.customerMonthlyStatement.upsert).not.toHaveBeenCalled();
      expect(h.prisma.customerMonthlyStatement.updateMany).not.toHaveBeenCalled();
      expect(h.auditLogs.recordSystem).toHaveBeenCalledTimes(1); // 第二次没写成，不得留"已出具"的痕
    });

    it('未知事件码 SEIZE_X 走 FALLBACK 标题 Balance adjustment，原始码不外泄（白名单继承行为证明）', async () => {
      const h = makeHarness({
        legsByAccount: {
          'acc-aed': [
            leg('SEIZE_X', 'OUT', 3000, 47000, '2026-09-12T08:00:00.000Z', { sourceType: 'CONFISCATION', sourceNo: 'CFS-9' }),
          ],
        },
      });

      await h.service.issue({ id: 'c1', customerNo: 'CU1' }, '2026-09');

      const payloadText = h.prisma.customerMonthlyStatement.create.mock.calls[0][0].data.payload as string;
      const aed = JSON.parse(payloadText).sections[0];
      expect(aed.rows).toHaveLength(1);
      expect(aed.rows[0].title).toBe('Balance adjustment');
      expect(aed.rows[0].kind).toBe('ADJUSTMENT');
      expect(aed.rows[0].subtitle).toBeNull();
      // tipping-off：快照里任何位置都不得出现原始事件码（refs 只带 sourceType/sourceNo）
      expect(payloadText).not.toContain('SEIZE_X');
    });
  });

  // 战役丙波四 T4：读面（客户面两端 + 管理台详情节）。数据源 = 真 issue 出的快照或等价 fixture。
  describe('read faces', () => {
    const row = (kind: string, amount: string, balanceAfter: string, postedAt: string) => ({
      postedAt, kind, title: kind, subtitle: null, amount, feeAmount: null, balanceAfter, refs: [],
    });
    const payloadOf = (closing: string) => JSON.stringify({
      sections: [
        {
          assetCode: 'AED', isFiat: true, openingBalance: '1000', closingBalance: closing,
          // 新→旧序（buildStatement 的原序），读面不得反转
          rows: [row('WITHDRAWAL', '-200', closing, '2026-09-20T08:00:00.000Z'), row('DEPOSIT', '1000', '1200', '2026-09-05T08:00:00.000Z')],
        },
        { assetCode: 'USDT', isFiat: false, openingBalance: '0', closingBalance: '5000000', rows: [] },
      ],
    });
    const statements = [
      { customerId: 'c1', periodMonth: '2026-07', statementNo: 'STM-CU1-202607', payload: payloadOf('900'), issuedAt: new Date('2026-08-01T20:05:00.000Z') },
      { customerId: 'c1', periodMonth: '2026-09', statementNo: 'STM-CU1-202609', payload: payloadOf('1000'), issuedAt: new Date('2026-10-01T20:05:00.000Z') },
      { customerId: 'c1', periodMonth: '2026-08', statementNo: 'STM-CU1-202608', payload: payloadOf('950'), issuedAt: new Date('2026-09-01T20:05:00.000Z') },
      { customerId: 'c2', periodMonth: '2026-09', statementNo: 'STM-CU2-202609', payload: payloadOf('777'), issuedAt: new Date('2026-10-01T20:05:00.000Z') },
    ];

    it('客户列表：只有本人的单、业务月降序、恰三键（不带 payload / customerId / id）', async () => {
      const h = makeHarness({ statements });

      const { items } = await h.service.listForCustomer('c1');

      expect(items.map((i) => i.statementNo)).toEqual(['STM-CU1-202609', 'STM-CU1-202608', 'STM-CU1-202607']);
      expect(items.map((i) => i.periodMonth)).toEqual(['2026-09', '2026-08', '2026-07']);
      for (const item of items) expect(Object.keys(item).sort()).toEqual(['issuedAt', 'periodMonth', 'statementNo']);
      expect(items[0].issuedAt).toEqual(new Date('2026-10-01T20:05:00.000Z'));
    });

    it('客户列表：没有月结单 → 空数组', async () => {
      const h = makeHarness({ statements });
      expect(await h.service.listForCustomer('c3')).toEqual({ items: [] });
    });

    it('客户详情：本人单返回 sections 快照，行序保持新→旧不反转，响应不带内部 id / customerId / payload', async () => {
      const h = makeHarness({ statements });

      const detail = await h.service.getForCustomer('c1', 'STM-CU1-202609');

      expect(Object.keys(detail).sort()).toEqual(['issuedAt', 'periodMonth', 'sections', 'statementNo']);
      expect(detail.statementNo).toBe('STM-CU1-202609');
      expect(detail.periodMonth).toBe('2026-09');
      expect(detail.sections.map((sec) => sec.assetCode)).toEqual(['AED', 'USDT']);
      expect(detail.sections[0].openingBalance).toBe('1000');
      expect(detail.sections[0].closingBalance).toBe('1000');
      expect(detail.sections[0].rows.map((r) => r.kind)).toEqual(['WITHDRAWAL', 'DEPOSIT']);
    });

    it('客户详情：别人的单号 → 404（c2 去取 c1 的单；归属校验是业务规则）', async () => {
      const h = makeHarness({ statements });
      await expect(h.service.getForCustomer('c2', 'STM-CU1-202609')).rejects.toThrow(NotFoundException);
      // 对照：本人取自己的单仍通
      await expect(h.service.getForCustomer('c2', 'STM-CU2-202609')).resolves.toMatchObject({ statementNo: 'STM-CU2-202609' });
    });

    it('客户详情：不存在的单号 → 404', async () => {
      const h = makeHarness({ statements });
      await expect(h.service.getForCustomer('c1', 'STM-CU1-209901')).rejects.toThrow(NotFoundException);
    });

    it('出具后可读：issue 落库的快照经 getForCustomer 原样读回（期初/期末/行），列表随之出现新月', async () => {
      const h = makeHarness({
        legsByAccount: {
          'acc-aed': [
            leg('DEPOSIT_SUSPENSE_TO_PAYABLE', 'IN', 50000, 50000, '2026-08-15T08:00:00.000Z'),
            leg('WITHDRAW_NET_POST', 'OUT', 5000, 45000, '2026-09-20T08:00:00.000Z'),
          ],
        },
      });
      expect((await h.service.listForCustomer('c1')).items).toEqual([]);

      const no = await h.service.issue({ id: 'c1', customerNo: 'CU1' }, '2026-09');

      const list = await h.service.listForCustomer('c1');
      expect(list.items.map((i) => i.statementNo)).toEqual([no]);
      const detail = await h.service.getForCustomer('c1', no);
      const aed = detail.sections.find((sec) => sec.assetCode === 'AED')!;
      expect(aed.openingBalance).toBe('50000');
      expect(aed.closingBalance).toBe('45000');
      expect(aed.rows.map((r) => r.amount)).toEqual(['-5000']);
    });

    // spec §13.1：快照不漂入库。出具后账本在该月窗口内又多一条腿（如平账调整回溯入账），读面不得重查账本。
    it('快照不漂：出具后往账本追加一条落在该月窗口内的腿，getForCustomer 读回的快照与出具时完全一致（行数 / 期末不变）', async () => {
      const aedLegs = [
        leg('DEPOSIT_SUSPENSE_TO_PAYABLE', 'IN', 50000, 50000, '2026-08-15T08:00:00.000Z'),
        leg('WITHDRAW_NET_POST', 'OUT', 5000, 45000, '2026-09-20T08:00:00.000Z'),
      ];
      const h = makeHarness({ legsByAccount: { 'acc-aed': aedLegs } });
      const no = await h.service.issue({ id: 'c1', customerNo: 'CU1' }, '2026-09');
      const atIssue = await h.service.getForCustomer('c1', no);
      const aedAtIssue = atIssue.sections.find((sec) => sec.assetCode === 'AED')!;
      expect(aedAtIssue.closingBalance).toBe('45000');
      expect(aedAtIssue.rows).toHaveLength(1);

      // 出具之后：9 月窗口内再入账一腿（账本真的变了——对照断言证明 mock 账本确实多了一腿）
      aedLegs.push(leg('DEPOSIT_SUSPENSE_TO_PAYABLE', 'IN', 7770, 52770, '2026-09-25T08:00:00.000Z'));
      expect((await h.tbEvidence.getAccountStatement('acc-aed')).items).toHaveLength(3);

      const later = await h.service.getForCustomer('c1', no);
      expect(later).toEqual(atIssue);
      const aedLater = later.sections.find((sec) => sec.assetCode === 'AED')!;
      expect(aedLater.rows).toHaveLength(1);
      expect(aedLater.closingBalance).toBe('45000');
      // 管理台读面同样读快照：期末仍是出具时的 45000
      const admin = await h.service.listForAdmin('c1');
      expect(admin.items[0].balances.find((b) => b.assetCode === 'AED')!.closingBalance).toBe('45000');
    });

    it('管理台列表：业务月降序、三键 + 逐币种期末余额与精度（精度取自资产表），不带行', async () => {
      const h = makeHarness({ statements });

      const { items } = await h.service.listForAdmin('c1');

      expect(items.map((i) => i.periodMonth)).toEqual(['2026-09', '2026-08', '2026-07']);
      expect(Object.keys(items[0]).sort()).toEqual(['balances', 'issuedAt', 'periodMonth', 'statementNo']);
      expect(items[0].balances).toEqual([
        { assetCode: 'AED', decimals: 2, closingBalance: '1000' },
        { assetCode: 'USDT', decimals: 6, closingBalance: '5000000' },
      ]);
      expect(items[2].balances[0].closingBalance).toBe('900');
      // 别的客户的单不进来
      expect(items.some((i) => i.statementNo === 'STM-CU2-202609')).toBe(false);
    });
  });

  describe('listMissingMonths', () => {
    const c = { id: 'c1', onboardingApprovedAt: new Date('2026-06-15T08:00:00.000Z') };
    const now = new Date('2026-10-03T08:00:00.000Z');

    it('6/15 开户、now=10/3 → [06,07,08,09] 升序；当月（10）不出', async () => {
      const h = makeHarness();
      expect(await h.service.listMissingMonths(c, now)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09']);
    });

    it('已出具月剔除；别的客户的同月单不影响本客户（mock 尊重 where.customerId）', async () => {
      const h = makeHarness({
        statements: [
          { customerId: 'c1', periodMonth: '2026-06', statementNo: 'STM-CU1-202606', payload: '{}' },
          { customerId: 'c2', periodMonth: '2026-07', statementNo: 'STM-CU2-202607', payload: '{}' },
        ],
      });
      expect(await h.service.listMissingMonths(c, now)).toEqual(['2026-07', '2026-08', '2026-09']);
    });

    it('开户当月即 now 所在月 → 无待出月', async () => {
      const h = makeHarness();
      expect(await h.service.listMissingMonths(
        { id: 'c1', onboardingApprovedAt: new Date('2026-10-02T08:00:00.000Z') }, now,
      )).toEqual([]);
    });

    it('开户月按迪拜业务月：UTC 6/30 21:00 = 迪拜 7/1 01:00 → 自 7 月起', async () => {
      const h = makeHarness();
      expect(await h.service.listMissingMonths(
        { id: 'c1', onboardingApprovedAt: new Date('2026-06-30T21:00:00.000Z') }, now,
      )).toEqual(['2026-07', '2026-08', '2026-09']);
    });

    it('now 按迪拜业务月：UTC 9/30 21:00 已是迪拜 10/1 → 9 月入待出', async () => {
      const h = makeHarness();
      expect(await h.service.listMissingMonths(
        { id: 'c1', onboardingApprovedAt: new Date('2026-08-10T08:00:00.000Z') },
        new Date('2026-09-30T21:00:00.000Z'),
      )).toEqual(['2026-08', '2026-09']);
    });

    it('跨年：2025-11 开户、now=2026-02 → 11、12、01', async () => {
      const h = makeHarness();
      expect(await h.service.listMissingMonths(
        { id: 'c1', onboardingApprovedAt: new Date('2025-11-05T08:00:00.000Z') },
        new Date('2026-02-03T08:00:00.000Z'),
      )).toEqual(['2025-11', '2025-12', '2026-01']);
    });
  });
});

describe('MonthlyStatementSweepService', () => {
  const now = new Date('2026-10-03T08:00:00.000Z');

  it('单轮补出多月：全部出具，但仅最新月调 notifyStatementIssued 且参数为该月', async () => {
    const h = makeHarness({
      customers: [{ id: 'c1', customerNo: 'CU1', onboardingApprovedAt: new Date('2026-06-15T08:00:00.000Z') }],
    });

    await h.sweep.sweep(now);

    expect(h.statementRows.map((r) => r.periodMonth)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09']);
    expect(h.auditLogs.recordSystem).toHaveBeenCalledTimes(4);
    expect(h.notifications.notifyStatementIssued).toHaveBeenCalledTimes(1);
    expect(h.notifications.notifyStatementIssued).toHaveBeenCalledWith({
      customerId: 'c1', statementNo: 'STM-CU1-202609', periodMonth: '2026-09',
    });
  });

  it('通知在快照落库+审计之后调（持久物先于信号）', async () => {
    const h = makeHarness({
      customers: [{ id: 'c1', customerNo: 'CU1', onboardingApprovedAt: new Date('2026-09-05T08:00:00.000Z') }],
    });
    h.notifications.notifyStatementIssued.mockImplementation(async () => { h.callOrder.push('notify'); });

    await h.sweep.sweep(now);

    expect(h.callOrder).toEqual(['create', 'audit', 'notify']);
  });

  it('追赶已完成后再跑一轮：零出具、零通知（listMissingMonths 以库为准）', async () => {
    const h = makeHarness({
      customers: [{ id: 'c1', customerNo: 'CU1', onboardingApprovedAt: new Date('2026-08-15T08:00:00.000Z') }],
    });

    await h.sweep.sweep(now);
    h.notifications.notifyStatementIssued.mockClear();
    h.auditLogs.recordSystem.mockClear();
    h.prisma.customerMonthlyStatement.create.mockClear();
    await h.sweep.sweep(now);

    expect(h.prisma.customerMonthlyStatement.create).not.toHaveBeenCalled();
    expect(h.auditLogs.recordSystem).not.toHaveBeenCalled();
    expect(h.notifications.notifyStatementIssued).not.toHaveBeenCalled();
    expect(h.statementRows).toHaveLength(2); // 8、9 月各一张
  });

  it('跨月再跑：下月新出一张，仅为新月单发通知', async () => {
    const h = makeHarness({
      customers: [{ id: 'c1', customerNo: 'CU1', onboardingApprovedAt: new Date('2026-08-15T08:00:00.000Z') }],
    });
    await h.sweep.sweep(now);
    h.notifications.notifyStatementIssued.mockClear();

    await h.sweep.sweep(new Date('2026-11-01T08:00:00.000Z')); // 迪拜 11 月 → 10 月单到期

    expect(h.statementRows.map((r) => r.periodMonth)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(h.notifications.notifyStatementIssued).toHaveBeenCalledTimes(1);
    expect(h.notifications.notifyStatementIssued).toHaveBeenCalledWith({
      customerId: 'c1', statementNo: 'STM-CU1-202610', periodMonth: '2026-10',
    });
  });

  it('无 onboardingApprovedAt 的客户不出单（mock 尊重 where.onboardingApprovedAt）', async () => {
    const h = makeHarness({
      customers: [
        { id: 'c1', customerNo: 'CU1', onboardingApprovedAt: new Date('2026-08-15T08:00:00.000Z') },
        { id: 'c9', customerNo: 'CU9', onboardingApprovedAt: null },
      ],
    });

    await h.sweep.sweep(now);

    expect(h.statementRows.every((r) => r.customerId === 'c1')).toBe(true);
    expect(h.notifications.notifyStatementIssued).toHaveBeenCalledTimes(1);
  });

  it('单月出具失败不拖垮批次：其余月照出，通知取成功出具的最新月；整客户失败不影响下一客户', async () => {
    const h = makeHarness({
      registry: [
        { tbAccountId: 'acc-aed', code: CLIENT_PAYABLE, ledger: 1, ownerUuid: 'c1' },
        { tbAccountId: 'acc-aed-2', code: CLIENT_PAYABLE, ledger: 1, ownerUuid: 'c2' },
      ],
      customers: [
        { id: 'c1', customerNo: 'CU1', onboardingApprovedAt: new Date('2026-07-15T08:00:00.000Z') },
        { id: 'c2', customerNo: 'CU2', onboardingApprovedAt: new Date('2026-09-02T08:00:00.000Z') },
      ],
    });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    // c1 的 2026-09 单出具时记账读取抛错（最新月失败）
    const realIssue = h.service.issue.bind(h.service);
    jest.spyOn(h.service, 'issue').mockImplementation(async (cust: any, month: string) => {
      if (cust.customerNo === 'CU1' && month === '2026-09') throw new Error('boom');
      return realIssue(cust, month);
    });

    await expect(h.sweep.sweep(now)).resolves.toBeUndefined();

    expect(h.statementRows.map((r) => `${r.customerId}/${r.periodMonth}`)).toEqual([
      'c1/2026-07', 'c1/2026-08', 'c2/2026-09',
    ]);
    const calls = h.notifications.notifyStatementIssued.mock.calls.map((c: any[]) => c[0]);
    expect(calls).toEqual([
      { customerId: 'c1', statementNo: 'STM-CU1-202608', periodMonth: '2026-08' },
      { customerId: 'c2', statementNo: 'STM-CU2-202609', periodMonth: '2026-09' },
    ]);
    errSpy.mockRestore();
  });

  it('通知抛错被吞：不影响后续客户', async () => {
    const h = makeHarness({
      registry: [],
      customers: [
        { id: 'c1', customerNo: 'CU1', onboardingApprovedAt: new Date('2026-09-02T08:00:00.000Z') },
        { id: 'c2', customerNo: 'CU2', onboardingApprovedAt: new Date('2026-09-02T08:00:00.000Z') },
      ],
    });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    h.notifications.notifyStatementIssued.mockRejectedValueOnce(new Error('signal down'));

    await h.sweep.sweep(now);

    expect(h.statementRows.map((r) => r.customerId)).toEqual(['c1', 'c2']);
    expect(h.notifications.notifyStatementIssued).toHaveBeenCalledTimes(2);
    errSpy.mockRestore();
  });
});
