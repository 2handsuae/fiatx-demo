import { ExplainedDifferenceService } from './explained-difference.service';

// 平账一期半 T6：解释索引的圈定范围。
// 本文件此前不存在——indexForWallet 是「差异已被解释」这条链路的唯一入口，
// 引擎靠它把已解释的异常从计数里摘掉，圈错范围 = 案子永远不自愈，而这一步
// 之前一条测试都没有。
describe('ExplainedDifferenceService.indexForWallet', () => {
  // mock 真按 where 过滤（照 engine/v2/wallet-flow-matcher.service.spec.ts 的现成写法）。
  // 恒返回固定行的 mock 测不出圈定范围——把 where 退回单 walletRef 它照样绿，
  // 实际只测到了 rows→Map 那段既有的映射循环（评审 Minor，本仓栽过的老模式）。
  const makeSvc = (rows: any[] = []) => {
    const prisma: any = {
      reconciliationAdjustment: {
        findMany: jest.fn(async ({ where }: any) => rows.filter((r) => {
          if (where.status && r.status !== where.status) return false;
          const conds = where.OR ?? [where];
          return conds.some((c: any) =>
            (c.walletRef === undefined || r.walletRef === c.walletRef)
            && (c.toWalletRef === undefined || r.toWalletRef === c.toWalletRef));
        })),
      },
    };
    return { svc: new ExplainedDifferenceService(prisma), prisma };
  };

  it('indexForWallet 也收 toWalletRef 命中的改记单——正主方钱包能查到解释锚（spec §6 ⚠）', async () => {
    const { svc, prisma } = makeSvc();
    await svc.indexForWallet('wallet-to');
    // 改记单挂在错记方名下（walletRef = 错记方钱包），锚的却是正主方的外部行；
    // 按单一 walletRef 圈定时，正主方那一轮查不到这张单，两案只愈一半。
    expect(prisma.reconciliationAdjustment.findMany.mock.calls[0][0].where).toEqual({
      OR: [{ walletRef: 'wallet-to' }, { toWalletRef: 'wallet-to' }],
      status: 'POSTED',
    });
  });

  it('正主方那一轮捞得到挂在错记方名下的改记单，两个锚各自入表（双案同愈的机制）', async () => {
    // 库里两张单：一张普通调账单挂在错记方钱包上（walletRef 命中），
    // 一张改记单也挂在错记方名下、但 toWalletRef 指向正主方钱包。
    // 现在跑的是**正主方**那个钱包的这一轮——只有第二张单该被捞到。
    const { svc } = makeSvc([
      {
        adjustmentNo: 'ADJ_PLAIN_1', status: 'POSTED',
        walletRef: 'wallet-other', toWalletRef: null,
        explainedFlowId: 'flow-other', explainedExternalLineId: null,
      },
      {
        adjustmentNo: 'ADJ_REATTR_1', status: 'POSTED',
        walletRef: 'wallet-from', toWalletRef: 'wallet-to',
        explainedFlowId: 'flow-from', explainedExternalLineId: 'ext-to',
      },
    ]);

    const index = await svc.indexForWallet('wallet-to');
    // 按单一 walletRef 圈定时这两条都会落空：正主方那条「外有我无」永远算不上
    // 已解释，案子只愈一半。
    expect(index.byExternalLineId.get('ext-to')).toBe('ADJ_REATTR_1');
    expect(index.byFlowId.get('flow-from')).toBe('ADJ_REATTR_1');
    // 别的钱包上的单不该被捎进来。
    expect(index.byFlowId.has('flow-other')).toBe(false);
  });

  it('只认 POSTED：草稿/待审的改记单不算解释——账还没动，差异当然还在', async () => {
    const { svc } = makeSvc([
      {
        adjustmentNo: 'ADJ_REATTR_DRAFT', status: 'PENDING_APPROVAL',
        walletRef: 'wallet-from', toWalletRef: 'wallet-to',
        explainedFlowId: 'flow-from', explainedExternalLineId: 'ext-to',
      },
    ]);
    const index = await svc.indexForWallet('wallet-to');
    expect(index.byExternalLineId.size).toBe(0);
    expect(index.byFlowId.size).toBe(0);
  });
});
