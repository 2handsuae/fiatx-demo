import { DispositionService, DispositionSpec } from './disposition.service';
import { deterministicTransferId } from '../accounting/tigerbeetle/utils/tb-id.util';
import { FundsOrderAction } from './dto/funds-order.dto';

/**
 * 处置动词引擎机制测试（地基站 T5）——从充值工作流六件套时代的机制断言迁入：
 * 决定性转账号跨 pend/settle/void 同 attempt 复算、legIndex=attempt 消歧、
 * 3× 瞬时重试、POST 语义补记携外部参考号、腿收口幂等。编排层（状态/审计）断言
 * 在 deposit-workflow.service.spec.ts 的「处置弧编排」块。
 */
describe('DispositionService', () => {
  let fundsOrders: any;
  let accounting: any;
  let tbEvidence: any;
  let svc: DispositionService;

  const spec = (overrides: Partial<DispositionSpec> = {}): DispositionSpec => ({
    kind: 'CONFISCATE',
    sourceType: 'DEPOSIT',
    sourceNo: 'DEP-ENG-001',
    traceId: 'trace-eng-1',
    ledger: 2,
    currency: 'USDT',
    decimals: 6,
    amount: '5',
    legSeq: 2,
    buildLegInput: (attempt: number) => ({ depositTransactionId: 'dep-eng-1', legSeq: 2, attempt } as any),
    tbLegs: [
      {
        transferCode: 41, eventCode: 'EC_ONE', voidEventCode: 'EC_ONE_VOID',
        debit: { code: 101, ownerType: 'CUSTOMER', ownerUuid: 'cust-1' },
        credit: { code: 1, ownerType: 'SYSTEM' },
        debitCoa: 'L.DEPOSIT_SUSPENSE', creditCoa: 'A.CLIENT_ASSET',
        memo: 'leg one (pending)', debitWalletRef: 'w1', creditWalletRef: 'w1', isExternalCrossing: false,
      },
      {
        transferCode: 42, eventCode: 'EC_TWO', voidEventCode: 'EC_TWO_VOID',
        debit: { code: 50, ownerType: 'SYSTEM' },
        credit: { code: 212, ownerType: 'SYSTEM' },
        debitCoa: 'A.FIRM_ASSET', creditCoa: 'E.INCOME_OTHER',
        memo: 'leg two (pending)', debitWalletRef: null, creditWalletRef: 'fee-w', isExternalCrossing: false,
      },
    ],
    ...overrides,
  });

  beforeEach(() => {
    fundsOrders = {
      findByParent: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ fundsOrderNo: 'FO-ENG-NEW', attempt: 1 }),
      findById: jest.fn().mockResolvedValue({ txHash: '0xabc', asset: { type: 'CRYPTO' } }),
      resolveExternalRef: jest.fn().mockReturnValue('0xabc'),
      advance: jest.fn().mockResolvedValue(undefined),
    };
    accounting = {
      resolveTbAccountId: jest.fn().mockResolvedValue('tb-acc'),
      executePendingTransfer: jest.fn().mockResolvedValue({ tbTransferId: 1n }),
      postPendingTransfer: jest.fn().mockResolvedValue(undefined),
      voidPendingTransfer: jest.fn().mockResolvedValue(undefined),
    };
    tbEvidence = { enrichForPost: jest.fn().mockResolvedValue(undefined) };
    svc = new DispositionService(fundsOrders, accounting, tbEvidence);
  });

  it('initiate：无既有腿则建 attempt 1，逐腿 pend（legIndex=attempt，金额按精度转整数）', async () => {
    const r = await svc.initiate(spec());
    expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ legSeq: 2, attempt: 1 }));
    expect(r).toEqual({ fundsOrderNo: 'FO-ENG-NEW', attempt: 1 });
    expect(accounting.executePendingTransfer).toHaveBeenCalledTimes(2);
    const first = accounting.executePendingTransfer.mock.calls[0][0];
    expect(first).toMatchObject({ code: 41, legIndex: 1, amount: 5000000n, ledger: 2 });
    expect(first.evidence).toMatchObject({ eventCode: 'EC_ONE', memo: 'leg one (pending)', isExternalCrossing: false });
  });

  it('initiate：已有同 legSeq 腿则复用（防重复发起），attempt 延续既有值', async () => {
    fundsOrders.findByParent.mockResolvedValue([{ fundsOrderNo: 'FO-ENG-OLD', attempt: 2 }]);
    const r = await svc.initiate(spec());
    expect(fundsOrders.create).not.toHaveBeenCalled();
    expect(r).toEqual({ fundsOrderNo: 'FO-ENG-OLD', attempt: 2 });
    expect(accounting.executePendingTransfer.mock.calls[0][0].legIndex).toBe(2);
  });

  it('settle：post 用与 pend 同源的决定性 id（sourceType+sourceNo+eventCode+attempt）', async () => {
    await svc.settle(spec(), 'fo-1', 3);
    const expected1 = deterministicTransferId('DEPOSIT', 'DEP-ENG-001', 'EC_ONE', 3);
    const expected2 = deterministicTransferId('DEPOSIT', 'DEP-ENG-001', 'EC_TWO', 3);
    expect(accounting.postPendingTransfer.mock.calls[0][0].pendingTransferId).toBe(expected1);
    expect(accounting.postPendingTransfer.mock.calls[1][0].pendingTransferId).toBe(expected2);
  });

  it('settle：postEnrich 弧对首腿 LOCK 行补记 POST 语义并携外部参考号', async () => {
    const s = spec({ postEnrich: { eventCode: 'EC_POST', memo: 'confirmed externally', isExternalCrossing: true } });
    const r = await svc.settle(s, 'fo-1', 1);
    expect(r).toEqual({ ok: true, externalRef: '0xabc' });
    expect(tbEvidence.enrichForPost).toHaveBeenCalledWith(expect.any(String),
      expect.objectContaining({ eventCode: 'EC_POST', externalRef: '0xabc', isExternalCrossing: true }));
  });

  it('settle：瞬时失败 3× 重试，第三次成功则 ok；三次全败返回 ok:false 与末次错误', async () => {
    accounting.postPendingTransfer
      .mockRejectedValueOnce(new Error('blip1')).mockRejectedValueOnce(new Error('blip2'))
      .mockResolvedValue(undefined);
    const ok = await svc.settle(spec(), 'fo-1', 1);
    expect(ok.ok).toBe(true);
    jest.clearAllMocks();
    fundsOrders.findById.mockResolvedValue(null);
    fundsOrders.resolveExternalRef.mockReturnValue(null);
    accounting.postPendingTransfer.mockRejectedValue(new Error('tb hard down'));
    const bad = await svc.settle(spec(), 'fo-1', 1);
    expect(bad).toEqual({ ok: false, error: 'tb hard down' });
  });

  it('voidAttempt：逐腿 void，同源决定性 id，evidence 用 voidEventCode 标签', async () => {
    await svc.voidAttempt(spec(), 2);
    const expected1 = deterministicTransferId('DEPOSIT', 'DEP-ENG-001', 'EC_ONE', 2);
    const call1 = accounting.voidPendingTransfer.mock.calls[0][0];
    expect(call1.pendingTransferId).toBe(expected1);
    expect(call1.evidence.eventCode).toBe('EC_ONE_VOID');
    expect(accounting.voidPendingTransfer).toHaveBeenCalledTimes(2);
  });

  it('rebuild：按 nextAttempt 建新腿并重挂 pending（旧单留档不改）', async () => {
    await svc.rebuild(spec(), 3);
    expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ attempt: 3 }));
    expect(accounting.executePendingTransfer.mock.calls[0][0].legIndex).toBe(3);
  });

  it('clearLeg：正常推 CLEAR；already terminal 幂等成功返 null；其余失败返错误串不抛', async () => {
    expect(await svc.clearLeg('fo-1')).toBeNull();
    expect(fundsOrders.advance).toHaveBeenCalledWith('fo-1', FundsOrderAction.CLEAR, 'SYSTEM');
    fundsOrders.advance.mockRejectedValue(new Error('Funds order already terminal'));
    expect(await svc.clearLeg('fo-1')).toBeNull();
    fundsOrders.advance.mockRejectedValue(new Error('db offline'));
    expect(await svc.clearLeg('fo-1')).toBe('db offline');
  });
});
