import { MaterialRequestOrderCancelListener } from './material-request-order-cancel.listener';

function row(over: Record<string, any> = {}) {
  return {
    requestNo: 'MRQ1', customerId: 'c1', restrictionNo: null,
    orderDomain: 'DEPOSIT', orderRef: 'DP1', status: 'PENDING_SUBMISSION',
    ...over,
  };
}

function deps(live: any[] = []) {
  const requests = {
    listLiveByOrder: jest.fn().mockResolvedValue(live),
    cancel: jest.fn().mockResolvedValue(undefined),
    unbindOrder: jest.fn().mockResolvedValue(undefined),
  } as any;
  return { requests };
}

const build = (d: ReturnType<typeof deps>) => new MaterialRequestOrderCancelListener(d.requests);

describe('订单进终态 → 材料请求处置', () => {
  it('没挂限制 → 作废，cancelReason=ORDER_TERMINAL', async () => {
    const d = deps([row()]);
    await build(d).onDepositStatusChanged({ depositNo: 'DP1', status: 'RETURNED' } as any);
    expect(d.requests.cancel).toHaveBeenCalledWith('MRQ1', 'ORDER_TERMINAL', expect.anything());
    expect(d.requests.unbindOrder).not.toHaveBeenCalled();
  });

  it('挂了限制 → 解绑不作废（从订单页撤下、留在客户级横幅）', async () => {
    const d = deps([row({ restrictionNo: 'RST1' })]);
    await build(d).onDepositStatusChanged({ depositNo: 'DP1', status: 'RETURNED' } as any);
    expect(d.requests.unbindOrder).toHaveBeenCalledWith('MRQ1', expect.anything());
    expect(d.requests.cancel).not.toHaveBeenCalled();
  });

  it('非终态一律不动（连查都不查）', async () => {
    const d = deps([row()]);
    await build(d).onDepositStatusChanged({ depositNo: 'DP1', status: 'COMPLIANCE_PENDING' } as any);
    expect(d.requests.listLiveByOrder).not.toHaveBeenCalled();
  });

  it('同一单上混着两种行 → 各走各的', async () => {
    const d = deps([row({ requestNo: 'MRQ1' }), row({ requestNo: 'MRQ2', restrictionNo: 'RST2' })]);
    await build(d).onDepositStatusChanged({ depositNo: 'DP1', status: 'SUCCESS' } as any);
    expect(d.requests.cancel).toHaveBeenCalledWith('MRQ1', 'ORDER_TERMINAL', expect.anything());
    expect(d.requests.unbindOrder).toHaveBeenCalledWith('MRQ2', expect.anything());
  });

  it('提现终态同样生效', async () => {
    const d = deps([row({ orderDomain: 'WITHDRAW', orderRef: 'WD1' })]);
    await build(d).onWithdrawStatusChanged({ withdrawNo: 'WD1', status: 'REJECTED' } as any);
    expect(d.requests.listLiveByOrder).toHaveBeenCalledWith('WITHDRAW', 'WD1');
    expect(d.requests.cancel).toHaveBeenCalled();
  });

  it('兑换终态同样生效（Q1 补的事件真的接上了）', async () => {
    const d = deps([row({ orderDomain: 'SWAP', orderRef: 'SW1' })]);
    await build(d).onSwapStatusChanged({ swapNo: 'SW1', status: 'REJECTED' } as any);
    expect(d.requests.listLiveByOrder).toHaveBeenCalledWith('SWAP', 'SW1');
    expect(d.requests.cancel).toHaveBeenCalled();
  });

  it('单笔失败不拖垮同单其余行', async () => {
    const d = deps([row({ requestNo: 'MRQ1' }), row({ requestNo: 'MRQ2' })]);
    d.requests.cancel.mockRejectedValueOnce(new Error('boom'));
    await expect(
      build(d).onDepositStatusChanged({ depositNo: 'DP1', status: 'SUCCESS' } as any),
    ).resolves.toBeUndefined();
    expect(d.requests.cancel).toHaveBeenCalledTimes(2);
  });
});
