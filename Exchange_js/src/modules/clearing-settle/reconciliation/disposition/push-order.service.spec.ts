import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PushOrderService } from './push-order.service';
import { FundsOrderStatus, FundsOrderAction } from '../../../funds-orders/dto/funds-order.dto';

// Real funds-order row shape (columns per prisma schema): deposit/withdraw FK derives
// direction, fromWalletId/toWalletId is the physical wallet, referenceNo is the external ref.
const makeOrder = (over: any = {}) => ({
  id: 'id-1',
  fundsOrderNo: 'FO-1',
  status: FundsOrderStatus.CONFIRMING,
  depositTransactionId: 'dep-1',
  withdrawTransactionId: null,
  swapTransactionId: null,
  fromWalletId: null,
  toWalletId: 'w-1',
  amount: 100,
  referenceNo: '0xabc',
  createdAt: new Date('2026-06-29T00:00:00Z'),
  ...over,
});

function build(opts: { order?: any; lookup?: any } = {}) {
  const order = opts.order ?? makeOrder();
  // A3(2026-08-13):此前这个 mock 写死 [CONFIRMED, CLEARED] 的行进序列、**完全不看传进来的
  // 是什么动作**——所以 HAPPY_ACTIONS 里有没有 CLEAR 它都绿,对"推单尝试了哪些动作"完全是瞎的
  // (正是这个盲区让"推单抢跑结算"活到了今天)。改成按 action 决定下一状态,动作语义真正参与判定。
  const NEXT_BY_ACTION: Record<string, string> = {
    [FundsOrderAction.SUBMIT]: FundsOrderStatus.SUBMITTED,
    [FundsOrderAction.OBSERVE_CONFIRMING]: FundsOrderStatus.CONFIRMING,
    [FundsOrderAction.CONFIRM]: FundsOrderStatus.CONFIRMED,
    [FundsOrderAction.CLEAR]: FundsOrderStatus.CLEARED,
  };
  let currentStatus = order.status; // shared row status; advance() moves it, findById() reads it
  const fundsOrders = {
    findByNo: jest.fn(async () => order),
    findById: jest.fn(async () => ({ ...order, status: currentStatus })),
    advance: jest.fn(async (_id: string, action: string) => {
      const next = NEXT_BY_ACTION[action];
      // 只有"当前态的下一步"才合法,其余抛 invalid transition(与真实状态机同措辞,
      // 服务据此跳到下一个候选动作)。这样 HAPPY_ACTIONS 的内容真正参与判定。
      const LEGAL_NEXT: Record<string, string> = {
        [FundsOrderStatus.CREATED]: FundsOrderStatus.SUBMITTED,
        [FundsOrderStatus.SUBMITTED]: FundsOrderStatus.CONFIRMING,
        [FundsOrderStatus.CONFIRMING]: FundsOrderStatus.CONFIRMED,
        [FundsOrderStatus.CONFIRMED]: FundsOrderStatus.CLEARED,
      };
      if (!next || LEGAL_NEXT[currentStatus] !== next) {
        throw new BadRequestException(`Invalid transition: ${currentStatus} --${action}-->`);
      }
      currentStatus = next;
      return { ...order, status: currentStatus };
    }),
  } as any;
  const lookup = {
    findUniqueReceipt: jest.fn(
      async () => opts.lookup ?? ({ kind: 'HIT', lineId: 'ext-1', effectiveDate: '2026-06-30' }),
    ),
  } as any;
  const audit = { recordByActor: jest.fn(async () => ({})), recordSystem: jest.fn() } as any;
  return { svc: new PushOrderService(fundsOrders, lookup, audit), fundsOrders, lookup, audit };
}

describe('PushOrderService', () => {
  it('sync: unique receipt → advances to CONFIRMED (A3: 停手不 CLEAR) with back-valued effectiveDate on every step', async () => {
    const { svc, fundsOrders } = build();
    const res = await svc.syncPush('FO-1', 'admin-1');
    // A3:推单的终点是 CONFIRMED,结清交还 workflow(它记完账才 CLEAR)
    expect(res.finalStatus).toBe(FundsOrderStatus.CONFIRMED);
    expect(fundsOrders.advance).toHaveBeenCalled();
    for (const call of fundsOrders.advance.mock.calls) {
      // advance(id, action, operatorId, tx, opts) — opts is arg index 4
      expect(call[4]).toEqual({ effectiveDate: '2026-06-30' });
    }
  });

  // A3 守则性断言:推单永远不得自己发 CLEAR。发了就会绕过 onFeeLegConfirmed 的结算
  // (其防重入判据是「状态不是 CONFIRMED = 别人结算过了」),手续费永久锁死、提现永停
  // PAYOUT_PENDING,而单据显示"已结清"。
  it('A3: 推单绝不发 CLEAR —— 结清是 workflow 记完账后的产物,不是可外部驱动的动作', async () => {
    const { svc, fundsOrders } = build();
    await svc.syncPush('FO-1', 'admin-1');
    const actions = fundsOrders.advance.mock.calls.map((c: any[]) => c[1]);
    expect(actions).not.toContain(FundsOrderAction.CLEAR);
  });

  it('sync: maps deposit → IN direction + toWalletId when locating a receipt', async () => {
    const { svc, lookup } = build();
    await svc.syncPush('FO-1', 'admin-1');
    const view = lookup.findUniqueReceipt.mock.calls[0][0];
    expect(view.direction).toBe('IN');
    expect(view.walletId).toBe('w-1');
    expect(view.externalRefs).toEqual(['0xabc']);
  });

  it('sync: coalesces txHash + referenceNo + providerTxnId into externalRefs (aligns with matcher refsOf)', async () => {
    // On-chain order: txHash present, referenceNo null, providerTxnId present → both non-null refs
    // must reach the lookup so tier-1 can match a statement line keyed by txHash.
    const order = makeOrder({ txHash: '0xTX', referenceNo: null, providerTxnId: 'PSP-9' });
    const { svc, lookup } = build({ order });
    await svc.syncPush('FO-1', 'admin-1');
    const view = lookup.findUniqueReceipt.mock.calls[0][0];
    expect(view.externalRefs).toEqual(['0xTX', 'PSP-9']);
  });

  it('sync: maps withdraw → OUT direction + fromWalletId', async () => {
    const order = makeOrder({
      depositTransactionId: null,
      withdrawTransactionId: 'wd-1',
      fromWalletId: 'wout-9',
      toWalletId: null,
    });
    const { svc, lookup } = build({ order });
    await svc.syncPush('FO-1', 'admin-1');
    const view = lookup.findUniqueReceipt.mock.calls[0][0];
    expect(view.direction).toBe('OUT');
    expect(view.walletId).toBe('wout-9');
  });

  it('sync: records a RECON_PUSH_ORDER_SYNCED audit via recordByActor', async () => {
    const { svc, audit } = build();
    await svc.syncPush('FO-1', 'admin-1');
    expect(audit.recordByActor).toHaveBeenCalledTimes(1);
    const [input, actor] = audit.recordByActor.mock.calls[0];
    expect(input.action).toBe('RECON_PUSH_ORDER_SYNCED');
    expect(input.primarySubjectType).toBe('INTERNAL_FUND');
    expect(input.primarySubjectNo).toBe('FO-1');
    expect(input.metadata.manualConfirm).toBe(false);
    expect(actor.actorNo).toBe('admin-1');
    expect(actor.actorType).toBe('ADMIN');
  });

  it('sync: MISS → no advance, reports candidate count', async () => {
    const { svc, fundsOrders } = build({ lookup: { kind: 'MISS', candidates: 3 } });
    await expect(svc.syncPush('FO-1', 'admin-1')).rejects.toThrow(/3/);
    expect(fundsOrders.advance).not.toHaveBeenCalled();
  });

  it('manual: validates evidence dates (future / before order creation rejected)', async () => {
    const { svc } = build();
    await expect(
      svc.manualPush('FO-1', 'admin-1', { receiptRef: 'R-1', externalDate: '2099-01-01', reason: 'x' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      svc.manualPush('FO-1', 'admin-1', { receiptRef: 'R-1', externalDate: '2026-06-01', reason: 'x' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('manual: missing evidence triple rejected', async () => {
    const { svc } = build();
    await expect(
      svc.manualPush('FO-1', 'admin-1', { receiptRef: '  ', externalDate: '2026-06-30', reason: 'x' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      svc.manualPush('FO-1', 'admin-1', { receiptRef: 'R-1', externalDate: '2026-06-30', reason: '' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('manual: valid evidence → advances with operator-supplied effectiveDate + manual audit flag', async () => {
    const { svc, fundsOrders, audit } = build();
    const res = await svc.manualPush('FO-1', 'admin-1', {
      receiptRef: 'R-1',
      externalDate: '2026-06-30',
      reason: '银行后台已见到账',
    });
    // A3:推单止于 CONFIRMED,结清交还 workflow
    expect(res.finalStatus).toBe(FundsOrderStatus.CONFIRMED);
    expect(fundsOrders.advance.mock.calls[0][4]).toEqual({ effectiveDate: '2026-06-30' });
    const [input] = audit.recordByActor.mock.calls[0];
    expect(input.action).toBe('RECON_PUSH_ORDER_MANUAL');
    expect(input.metadata.manualConfirm).toBe(true);
    expect(input.metadata.receiptRef).toBe('R-1');
  });

  it('rejects swap-leg and terminal orders', async () => {
    const { svc: s1 } = build({ order: makeOrder({ swapTransactionId: 'swap-1' }) });
    await expect(s1.syncPush('FO-1', 'a')).rejects.toThrow(BadRequestException);
    const { svc: s2 } = build({ order: makeOrder({ status: FundsOrderStatus.CLEARED }) });
    await expect(s2.syncPush('FO-1', 'a')).rejects.toThrow(BadRequestException);
  });

  it('driveToCleared rethrows non-transition advance errors (e.g. row deleted) — not masked as "无合法推进动作"', async () => {
    // M-1: a narrowed catch only continues on "Invalid transition"; a NotFound (row vanished mid-drive)
    // must propagate verbatim, not be swallowed into the generic "no legal advance" BadRequest.
    const order = makeOrder();
    const fundsOrders = {
      findByNo: jest.fn(async () => order),
      findById: jest.fn(async () => order), // still CONFIRMING — not the concurrent-CLEARED case
      advance: jest.fn(async () => {
        throw new NotFoundException(`FundsOrder ${order.id} not found`);
      }),
    } as any;
    const lookup = {
      findUniqueReceipt: jest.fn(async () => ({ kind: 'HIT', lineId: 'ext-1', effectiveDate: '2026-06-30' })),
    } as any;
    const audit = { recordByActor: jest.fn(async () => ({})) } as any;
    const svc = new PushOrderService(fundsOrders, lookup, audit);
    await expect(svc.syncPush('FO-1', 'admin-1')).rejects.toThrow(NotFoundException);
  });

  it('tolerates a concurrent workflow handler driving the order to CLEARED (loop loses the CLEAR race)', async () => {
    // Terminal-state guard (funds-order.service.ts:91) throws "already terminal (CLEARED) — invalid
    // transition" (LOWERCASE "invalid transition"). If a deposit/withdraw @OnEvent handler self-drives
    // CONFIRMED→CLEARED first, the loop's own advance(CLEAR) hits already-terminal. That must be treated
    // as SUCCESS (order is CLEARED) and audit must STILL be written — not rethrown after money moved.
    const order = makeOrder();
    let rowStatus = FundsOrderStatus.CONFIRMING;
    let advanceCalls = 0;
    const fundsOrders = {
      findByNo: jest.fn(async () => order),
      // findById reflects what the concurrent handler already did to the shared row.
      findById: jest.fn(async () => ({ ...order, status: rowStatus })),
      advance: jest.fn(async () => {
        advanceCalls += 1;
        if (advanceCalls === 1) {
          // loop's CONFIRM succeeds; but BEFORE returning, the concurrent handler drives it to CLEARED.
          rowStatus = FundsOrderStatus.CLEARED;
          return { ...order, status: FundsOrderStatus.CONFIRMED };
        }
        // loop's next attempt (CLEAR) loses the race → already-terminal guard (lowercase message).
        throw new BadRequestException(
          `FundsOrder ${order.id} already terminal (CLEARED) — invalid transition`,
        );
      }),
    } as any;
    const lookup = {
      findUniqueReceipt: jest.fn(async () => ({ kind: 'HIT', lineId: 'ext-1', effectiveDate: '2026-06-30' })),
    } as any;
    const audit = { recordByActor: jest.fn(async () => ({})) } as any;
    const svc = new PushOrderService(fundsOrders, lookup, audit);

    const res = await svc.syncPush('FO-1', 'admin-1');
    expect(res.finalStatus).toBe(FundsOrderStatus.CLEARED);
    // The compliance-critical assertion: audit is written even though the loop lost the CLEAR race.
    expect(audit.recordByActor).toHaveBeenCalledTimes(1);
    expect(audit.recordByActor.mock.calls[0][0].metadata.toStatus).toBe(FundsOrderStatus.CLEARED);
  });
});
