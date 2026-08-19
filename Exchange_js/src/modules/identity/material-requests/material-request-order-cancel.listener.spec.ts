import { MaterialRequestOrderCancelListener } from './material-request-order-cancel.listener';
import { DepositStatusChangedEvent } from '../../trading/deposit-transactions/events/deposit-transaction.events';
import { DepositTransactionStatus } from '../../trading/deposit-transactions/dto/deposit-transaction.dto';
import type { WithdrawStatusChangedEvent } from '../../trading/withdraw-transactions/withdraw-transactions.service';

function row(over: Record<string, any> = {}) {
  return {
    requestNo: 'MRQ1', customerId: 'c1', restrictionNo: null,
    orderDomain: 'DEPOSIT', orderRef: 'DP1', status: 'PENDING_SUBMISSION',
    ...over,
  };
}

function withdrawEvent(over: Partial<WithdrawStatusChangedEvent> = {}): WithdrawStatusChangedEvent {
  return {
    withdrawId: 'wd-1', withdrawNo: 'WD1', ownerId: 'c1',
    previousStatus: 'COMPLIANCE_PENDING', status: 'REJECTED', traceId: null,
    ...over,
  };
}

function deps(live: any[] = [], depositRow: { depositNo: string } | null = { depositNo: 'DP1' }) {
  const requests = {
    listLiveByOrder: jest.fn().mockResolvedValue(live),
    cancel: jest.fn().mockResolvedValue(undefined),
    unbindOrder: jest.fn().mockResolvedValue(undefined),
  } as any;
  const prisma = {
    depositTransaction: {
      findUnique: jest.fn().mockResolvedValue(depositRow),
    },
  } as any;
  return { requests, prisma };
}

const build = (d: ReturnType<typeof deps>) => new MaterialRequestOrderCancelListener(d.requests, d.prisma);

describe('订单进终态 → 材料请求处置', () => {
  it('没挂限制 → 作废，cancelReason=ORDER_TERMINAL', async () => {
    const d = deps([row()]);
    const event = new DepositStatusChangedEvent('dep-1', DepositTransactionStatus.COMPLIANCE_PENDING, DepositTransactionStatus.RETURNED, 'CUSTOMER', 'c1', 'asset-1', '100');
    await build(d).onDepositStatusChanged(event);
    expect(d.prisma.depositTransaction.findUnique).toHaveBeenCalledWith({
      where: { id: 'dep-1' },
      select: { depositNo: true },
    });
    expect(d.requests.listLiveByOrder).toHaveBeenCalledWith('DEPOSIT', 'DP1');
    expect(d.requests.cancel).toHaveBeenCalledWith('MRQ1', 'ORDER_TERMINAL', expect.anything());
    expect(d.requests.unbindOrder).not.toHaveBeenCalled();
  });

  it('挂了限制 → 解绑不作废（从订单页撤下、留在客户级横幅）', async () => {
    const d = deps([row({ restrictionNo: 'RST1' })]);
    const event = new DepositStatusChangedEvent('dep-1', DepositTransactionStatus.COMPLIANCE_PENDING, DepositTransactionStatus.RETURNED, 'CUSTOMER', 'c1', 'asset-1', '100');
    await build(d).onDepositStatusChanged(event);
    expect(d.requests.unbindOrder).toHaveBeenCalledWith('MRQ1', expect.anything());
    expect(d.requests.cancel).not.toHaveBeenCalled();
  });

  it('非终态一律不动（连查都不查）', async () => {
    const d = deps([row()]);
    const event = new DepositStatusChangedEvent('dep-1', DepositTransactionStatus.PAYIN_PENDING, DepositTransactionStatus.COMPLIANCE_PENDING, 'CUSTOMER', 'c1', 'asset-1', '100');
    await build(d).onDepositStatusChanged(event);
    expect(d.prisma.depositTransaction.findUnique).not.toHaveBeenCalled();
    expect(d.requests.listLiveByOrder).not.toHaveBeenCalled();
  });

  it('同一单上混着两种行 → 各走各的', async () => {
    const d = deps([row({ requestNo: 'MRQ1' }), row({ requestNo: 'MRQ2', restrictionNo: 'RST2' })]);
    const event = new DepositStatusChangedEvent('dep-1', DepositTransactionStatus.COMPLIANCE_PENDING, DepositTransactionStatus.SUCCESS, 'CUSTOMER', 'c1', 'asset-1', '100');
    await build(d).onDepositStatusChanged(event);
    expect(d.requests.cancel).toHaveBeenCalledWith('MRQ1', 'ORDER_TERMINAL', expect.anything());
    expect(d.requests.unbindOrder).toHaveBeenCalledWith('MRQ2', expect.anything());
  });

  it('提现终态同样生效', async () => {
    const d = deps([row({ orderDomain: 'WITHDRAW', orderRef: 'WD1' })]);
    await build(d).onWithdrawStatusChanged(withdrawEvent({ withdrawNo: 'WD1', status: 'REJECTED' }));
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
    const event = new DepositStatusChangedEvent('dep-1', DepositTransactionStatus.COMPLIANCE_PENDING, DepositTransactionStatus.SUCCESS, 'CUSTOMER', 'c1', 'asset-1', '100');
    await expect(build(d).onDepositStatusChanged(event)).resolves.toBeUndefined();
    expect(d.requests.cancel).toHaveBeenCalledTimes(2);
  });

  it('depositId 反查不到 depositNo → 静默返回（防御性兜底）', async () => {
    const d = deps([row()], null);
    const event = new DepositStatusChangedEvent('dep-missing', DepositTransactionStatus.COMPLIANCE_PENDING, DepositTransactionStatus.SUCCESS, 'CUSTOMER', 'c1', 'asset-1', '100');
    await build(d).onDepositStatusChanged(event);
    expect(d.requests.listLiveByOrder).not.toHaveBeenCalled();
  });
});
