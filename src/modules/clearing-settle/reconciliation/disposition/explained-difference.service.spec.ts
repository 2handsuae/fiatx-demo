import { ExplainedDifferenceService } from './explained-difference.service';

// 平账一期半 T6 / 戊波二 T9b：解释锚点清单的圈定范围与来源。
// indexForWallet 是「差异已被解释」这条链路的唯一入口——匹配器第 0 轮靠它把调账 / 记短缺流水与差异配成对，
// 圈错范围 = 案子永远不自愈。来源两路：POSTED 调账单（改记单两个钱包都认）、已记短缺的认损补缺单。
describe('ExplainedDifferenceService.indexForWallet', () => {
  const CASH = 'cafe0000000000000000000000000001';

  // mock 真按 where 过滤（照 engine/v2/wallet-flow-matcher.service.spec.ts 的现成写法）。
  // 恒返回固定行的 mock 测不出圈定范围——把 where 退回单 walletRef 它照样绿，
  // 实际只测到了 rows→锚点那段既有的映射循环（评审 Minor，本仓栽过的老模式）。
  const makeSvc = (opts: { adjustments?: any[]; transfers?: any[]; flows?: any[] } = {}) => {
    const { adjustments = [], transfers = [], flows = [] } = opts;
    const prisma: any = {
      reconciliationAdjustment: {
        findMany: jest.fn(async ({ where }: any) => adjustments.filter((r) => {
          if (where.status && r.status !== where.status) return false;
          const conds = where.OR ?? [where];
          return conds.some((c: any) =>
            (c.walletRef === undefined || r.walletRef === c.walletRef)
            && (c.toWalletRef === undefined || r.toWalletRef === c.toWalletRef));
        })),
      },
      internalTransfer: {
        findMany: jest.fn(async ({ where }: any) => transfers.filter((r) =>
          r.toWalletId === where.toWalletId
          && r.purpose === where.purpose
          && (where.recognizedTbTransferId?.not === undefined || r.recognizedTbTransferId !== null))),
      },
      accountFlow: {
        findMany: jest.fn(async ({ where }: any) => flows.filter((f) => {
          if (f.tbAccountId !== where.tbAccountId) return false;
          if (where.transferType && (f.transferType ?? 'POSTED') !== where.transferType) return false;
          return where.OR.some((c: any) =>
            f.sourceType === c.sourceType
            && (c.eventCode === undefined || f.eventCode === c.eventCode)
            && c.sourceNo.in.includes(f.sourceNo));
        })),
      },
    };
    return { svc: new ExplainedDifferenceService(prisma), prisma };
  };
  const adj = (over: any) => ({
    status: 'POSTED', walletRef: 'wallet-from', toWalletRef: null, explainedFlowId: null, explainedExternalLineId: null, ...over,
  });
  const flow = (over: any) => ({ tbAccountId: CASH, sourceType: 'RECON_ADJUSTMENT', eventCode: 'RECON_ADJUSTMENT_POSTED', transferType: 'POSTED', ...over });

  it('indexForWallet 也收 toWalletRef 命中的改记单——正主方钱包能查到解释锚（spec §6 ⚠）', async () => {
    const { svc, prisma } = makeSvc();
    await svc.indexForWallet('wallet-to', CASH);
    // 改记单挂在错记方名下（walletRef = 错记方钱包），锚的却是正主方的外部行；
    // 按单一 walletRef 圈定时，正主方那一轮查不到这张单，两案只愈一半。
    expect(prisma.reconciliationAdjustment.findMany.mock.calls[0][0].where).toEqual({
      OR: [{ walletRef: 'wallet-to' }, { toWalletRef: 'wallet-to' }],
      status: 'POSTED',
    });
  });

  it('正主方那一轮捞得到挂在错记方名下的改记单：供出落在**自己**现金户上的那条流水，带两个锚与单号（双案同愈的机制）', async () => {
    // 库里两张单：一张普通调账单挂在别的钱包上，一张改记单挂在错记方名下、toWalletRef 指向正主方钱包。
    // 现在跑的是**正主方**那个钱包的这一轮——只有第二张单该被捞到。
    const { svc } = makeSvc({
      adjustments: [
        adj({ adjustmentNo: 'ADJ_PLAIN_1', walletRef: 'wallet-other', explainedFlowId: 'flow-other' }),
        adj({ adjustmentNo: 'ADJ_REATTR_1', walletRef: 'wallet-from', toWalletRef: 'wallet-to', explainedFlowId: 'flow-from', explainedExternalLineId: 'ext-to' }),
      ],
      flows: [
        // 改记的现金对：正主方现金户（本钱包）一条 IN；错记方现金户另有一条 OUT，不在本钱包现金户上
        flow({ id: 'f-to-in', sourceNo: 'ADJ_REATTR_1' }),
        flow({ id: 'f-from-out', sourceNo: 'ADJ_REATTR_1', tbAccountId: 'beef0000000000000000000000000002' }),
        flow({ id: 'f-plain', sourceNo: 'ADJ_PLAIN_1' }),
      ],
    });

    const anchors = await svc.indexForWallet('wallet-to', CASH);
    // 按单一 walletRef 圈定时这张单会落空：正主方那条「外有我无」永远配不上，案子只愈一半。
    expect(anchors).toEqual([
      { flowId: 'f-to-in', anchorFlowId: 'flow-from', anchorExternalLineId: 'ext-to', byNo: 'ADJ_REATTR_1' },
    ]);
  });

  it('只认 POSTED：草稿/待审的改记单不算解释——账还没动，差异当然还在', async () => {
    const { svc } = makeSvc({
      adjustments: [
        adj({ adjustmentNo: 'ADJ_REATTR_DRAFT', status: 'PENDING_APPROVAL', toWalletRef: 'wallet-to', explainedFlowId: 'flow-from', explainedExternalLineId: 'ext-to' }),
      ],
      flows: [flow({ id: 'f-draft', sourceNo: 'ADJ_REATTR_DRAFT' })],
    });
    expect(await svc.indexForWallet('wallet-to', CASH)).toEqual([]);
  });

  it('两个锚都空的调账单不供（它的流水只进余额、不进匹配——裁定 16）', async () => {
    const { svc } = makeSvc({
      adjustments: [adj({ adjustmentNo: 'ADJ_BARE', walletRef: 'wallet-w' })],
      flows: [flow({ id: 'f-bare', sourceNo: 'ADJ_BARE' })],
    });
    expect(await svc.indexForWallet('wallet-w', CASH)).toEqual([]);
  });

  it('认损补缺单：已记短缺（recognizedTbTransferId 有值）的单供出它的码 91 流水，带锚与 ITR 号', async () => {
    const { svc } = makeSvc({
      transfers: [{
        transferNo: 'ITR1', purpose: 'SHORTFALL_TOPUP', toWalletId: 'wallet-c', recognizedTbTransferId: 'ab12',
        explainedFlowId: 'flow-amt', explainedExternalLineId: 'ext-amt',
      }],
      flows: [
        flow({ id: 'f-91', sourceType: 'INTERNAL_TRANSFER', eventCode: 'INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED', sourceNo: 'ITR1' }),
        // 同一张单后来补款到货的腿（83 借 1·客户钱包）也落在这个现金户上，但不是记短缺那一条——不供
        flow({ id: 'f-83', sourceType: 'INTERNAL_TRANSFER', eventCode: 'INTERNAL_TRANSFER_SHORTFALL_TOPUP_IN', sourceNo: 'ITR1' }),
      ],
    });
    expect(await svc.indexForWallet('wallet-c', CASH)).toEqual([
      { flowId: 'f-91', anchorFlowId: 'flow-amt', anchorExternalLineId: 'ext-amt', byNo: 'ITR1' },
    ]);
  });

  it('认损补缺单：只带事故路外部行锚时，只供外部行锚', async () => {
    const { svc } = makeSvc({
      transfers: [{
        transferNo: 'ITR2', purpose: 'SHORTFALL_TOPUP', toWalletId: 'wallet-c', recognizedTbTransferId: 'cd34',
        explainedFlowId: null, explainedExternalLineId: 'ext-ghost',
      }],
      flows: [flow({ id: 'f-91b', sourceType: 'INTERNAL_TRANSFER', eventCode: 'INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED', sourceNo: 'ITR2' })],
    });
    expect(await svc.indexForWallet('wallet-c', CASH)).toEqual([
      { flowId: 'f-91b', anchorExternalLineId: 'ext-ghost', byNo: 'ITR2' },
    ]);
  });

  it('认损补缺单：还没记短缺（recognizedTbTransferId 为空，待批 / 驳回 / 记短缺失败）的单不供', async () => {
    const { svc } = makeSvc({
      transfers: [{
        transferNo: 'ITR3', purpose: 'SHORTFALL_TOPUP', toWalletId: 'wallet-c', recognizedTbTransferId: null,
        explainedFlowId: 'flow-x', explainedExternalLineId: null,
      }],
      flows: [],
    });
    expect(await svc.indexForWallet('wallet-c', CASH)).toEqual([]);
  });

  it('钱包没有现金户（未归属的外部账户）→ 空清单，不查库', async () => {
    const { svc, prisma } = makeSvc();
    expect(await svc.indexForWallet('EXT-ACCT-1', null)).toEqual([]);
    expect(prisma.reconciliationAdjustment.findMany).not.toHaveBeenCalled();
  });
});
