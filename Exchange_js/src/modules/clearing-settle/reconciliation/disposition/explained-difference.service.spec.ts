import { ExplainedDifferenceService } from './explained-difference.service';

// 平账一期半 T6：解释索引的圈定范围。
// 本文件此前不存在——indexForWallet 是「差异已被解释」这条链路的唯一入口，
// 引擎靠它把已解释的异常从计数里摘掉，圈错范围 = 案子永远不自愈，而这一步
// 之前一条测试都没有。
describe('ExplainedDifferenceService.indexForWallet', () => {
  const makeSvc = (rows: any[] = []) => {
    const prisma: any = { reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue(rows) } };
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

  it('一张改记单两个锚各自入表——同一张单同时解释错记方的内部流水与正主方的外部行（双案同愈的机制）', async () => {
    const { svc } = makeSvc([
      { adjustmentNo: 'ADJ_REATTR_1', explainedFlowId: 'flow-from', explainedExternalLineId: 'ext-to' },
    ]);
    const index = await svc.indexForWallet('wallet-to');
    expect(index.byFlowId.get('flow-from')).toBe('ADJ_REATTR_1');
    expect(index.byExternalLineId.get('ext-to')).toBe('ADJ_REATTR_1');
  });
});
