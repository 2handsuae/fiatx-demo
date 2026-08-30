import { SwapKytVerdictHandler } from './swap-kyt-verdict.handler';
import { SwapWorkflowService } from '../trading/swap-transactions/swap-workflow.service';
import { SwapTransactionsService } from '../trading/swap-transactions/swap-transactions.service';
import { SumsubTxnClient } from '../sumsub-shared/sumsub-txn-client.interface';
import { SumsubTxnDetail } from '../sumsub-shared/sumsub-txn.types';

/**
 * Task 5: mirrors deposit-kyt-verdict.handler.spec.ts / withdraw-kyt-verdict.handler.spec.ts
 * (deliberate fork — hand-rolled mocks, bypasses Nest DI, same lightweight style).
 *
 * The one semantic difference under test here: swap has no waiting states.
 * onHold/awaitingUser collapse into 'rejected' (see task-5-brief.md) instead of
 * carrying their own verdict values the way withdraw's 'onHold'/'awaitUser' do.
 */
describe('SwapKytVerdictHandler', () => {
  let workflow: jest.Mocked<SwapWorkflowService>;
  let swapService: jest.Mocked<SwapTransactionsService>;
  let sumsubTxnClient: jest.Mocked<SumsubTxnClient>;
  let handler: SwapKytVerdictHandler;

  const SWAP_ID = 's1';

  beforeEach(() => {
    workflow = {
      applyKytVerdict: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SwapWorkflowService>;

    swapService = {
      findBySumsubTxnId: jest
        .fn()
        .mockResolvedValue({ id: SWAP_ID, status: 'COMPLIANCE_PENDING' }),
    } as unknown as jest.Mocked<SwapTransactionsService>;

    sumsubTxnClient = {
      submitTxn: jest.fn(),
      getTxn: jest.fn(),
      rescore: jest.fn(),
      reviewComplete: jest.fn(),
      archiveTxHash: jest.fn(),
    } as unknown as jest.Mocked<SumsubTxnClient>;

    handler = new SwapKytVerdictHandler(swapService, workflow, sumsubTxnClient);
  });

  function txnDetail(
    tags: { label: string; type?: 'system' | 'userDefined' }[],
  ): SumsubTxnDetail {
    return {
      txnId: 'T1',
      verdict: 'rejected',
      reviewAnswer: 'RED',
      riskScore: 40,
      typedTags: tags.map((t) => ({
        label: t.label,
        type: t.type ?? 'userDefined',
      })),
      raw: { txnId: 'T1', reviewResult: { reviewAnswer: 'RED' } },
    };
  }

  it('Approved → 也拉 getTxn 落证据（parity 2026-08-14），applyKytVerdict 收到 riskScore+detailRaw', async () => {
    // 与提现 DETAIL_LOOKUP_VERDICTS 对齐：approved 也拉一次 getTxn——否则放行单的
    // score/raw 彻底丢失，运营在详情页看不到风险分（此前正是这个坑）。
    sumsubTxnClient.getTxn.mockResolvedValue({
      txnId: 'T1',
      verdict: 'approved',
      reviewAnswer: 'GREEN',
      riskScore: 10,
      typedTags: [],
      raw: { txnId: 'T1', scoringResult: { score: 10, action: 'score' } },
    } as SumsubTxnDetail);

    const hit = await handler.handle({
      type: 'applicantKytTxnApproved',
      kytTxnId: 'T1',
    });

    expect(hit).toBe(true);
    expect(sumsubTxnClient.getTxn).toHaveBeenCalledWith('T1');
    expect(workflow.applyKytVerdict).toHaveBeenCalledWith(
      SWAP_ID,
      expect.objectContaining({
        verdict: 'approved',
        riskScore: 10,
        detailRaw: expect.objectContaining({ txnId: 'T1' }),
      }),
    );
    // approved 不驱动处置分支：tag/action 不该被传递
    const arg = workflow.applyKytVerdict.mock.calls[0][1];
    expect(arg).not.toHaveProperty('typedTags');
    expect(arg).not.toHaveProperty('applicantActions');
  });

  it('Rejected → 调 applyKytVerdict(verdict=rejected)，拉 getTxn 读 sceneTag（Task A6：不再原样透传 typedTags）', async () => {
    sumsubTxnClient.getTxn.mockResolvedValue(
      txnDetail([{ label: 'SANCTION_APPLICANT' }]),
    );

    const hit = await handler.handle({
      type: 'applicantKytTxnRejected',
      kytTxnId: 'T1',
    });

    expect(hit).toBe(true);
    expect(sumsubTxnClient.getTxn).toHaveBeenCalledWith('T1');
    expect(workflow.applyKytVerdict).toHaveBeenCalledWith(
      SWAP_ID,
      expect.objectContaining({ verdict: 'rejected', sceneTag: 'SANCTION_APPLICANT' }),
    );
    // typedTags 不再是 applyKytVerdict 契约的一部分——分流后只传 sceneTag/dispoTag。
    const arg = workflow.applyKytVerdict.mock.calls[0][1];
    expect(arg).not.toHaveProperty('typedTags');
  });

  it('awaitingUser 一律归一为 rejected（兑换无"等客户"的语义）', async () => {
    sumsubTxnClient.getTxn.mockResolvedValue(txnDetail([]));

    const hit = await handler.handle({
      type: 'applicantKytTxnAwaitingUser',
      kytTxnId: 'T1',
    });

    expect(hit).toBe(true);
    expect(sumsubTxnClient.getTxn).toHaveBeenCalledWith('T1');
    expect(workflow.applyKytVerdict).toHaveBeenCalledWith(
      SWAP_ID,
      expect.objectContaining({ verdict: 'rejected' }),
    );
  });

  it('onHold(applicantKytOnHold，官方命名无 Txn) 一律归一为 rejected（兑换无"等官员"的语义）', async () => {
    sumsubTxnClient.getTxn.mockResolvedValue(txnDetail([]));

    const hit = await handler.handle({
      type: 'applicantKytOnHold',
      kytTxnId: 'T1',
    });

    expect(hit).toBe(true);
    expect(workflow.applyKytVerdict).toHaveBeenCalledWith(
      SWAP_ID,
      expect.objectContaining({ verdict: 'rejected' }),
    );
  });

  it('Reviewed / Created 不推进状态机，但已认领 → 返回 true', async () => {
    const reviewedHit = await handler.handle({
      type: 'applicantKytTxnReviewed',
      kytTxnId: 'T1',
    });
    expect(reviewedHit).toBe(true);
    expect(workflow.applyKytVerdict).not.toHaveBeenCalled();
    expect(sumsubTxnClient.getTxn).not.toHaveBeenCalled();

    const createdHit = await handler.handle({
      type: 'applicantKytTxnCreated',
      kytTxnId: 'T1',
    });
    expect(createdHit).toBe(true);
    expect(workflow.applyKytVerdict).not.toHaveBeenCalled();
  });

  it('认领不到 swap → 返回 false 让级联继续，并记录 warn', async () => {
    swapService.findBySumsubTxnId.mockResolvedValue(null);
    const warnSpy = jest
      .spyOn((handler as any).logger, 'warn')
      .mockImplementation(() => undefined);

    const hit = await handler.handle({
      type: 'applicantKytTxnApproved',
      kytTxnId: 'ZZZ',
    });

    expect(hit).toBe(false);
    expect(workflow.applyKytVerdict).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ZZZ'));
  });

  it('认领不到 swap 时，ignore 类型也返回 false（先认领后判断类型）', async () => {
    swapService.findBySumsubTxnId.mockResolvedValue(null);

    const hit = await handler.handle({
      type: 'applicantKytTxnReviewed',
      kytTxnId: 'ZZZ',
    });

    expect(hit).toBe(false);
    expect(workflow.applyKytVerdict).not.toHaveBeenCalled();
  });

  it('Rejected + getTxn 返回 applicantActions → 透传进 applyKytVerdict', async () => {
    const actions = [{ applicantActionId: 'aa-1', externalActionId: 'EXT-1' }];
    sumsubTxnClient.getTxn.mockResolvedValue({
      ...txnDetail([]),
      applicantActions: actions,
    });

    await handler.handle({ type: 'applicantKytTxnRejected', kytTxnId: 'T1' });

    expect(workflow.applyKytVerdict).toHaveBeenCalledWith(
      SWAP_ID,
      expect.objectContaining({ applicantActions: actions }),
    );
  });

  // ── Task A6: 兑换 workflow 认 tag（PEP / MLRO freeze / 多条材料）─────────
  // 此前 handler 只把 typedTags 原样往 workflow 传，不分流 sceneTag/dispoTag——
  // 上一个任务新增的 ③ PEP / ⑤ 多条材料 / ⑨ MLRO freeze 三个按钮都要求兑换
  // 真的读 tag 才有效果。照抄 deposit-kyt-verdict.handler.ts 的分流段。
  describe('兑换域读 tag', () => {
    it('⑨ MLRO freeze：getTxn 返回 FROZEN_BY_MLRO → dispoTag 透传给 workflow（不再是 typedTags）', async () => {
      sumsubTxnClient.getTxn.mockResolvedValue(
        txnDetail([{ label: 'FROZEN_BY_MLRO' }]),
      );

      await handler.handle({ type: 'applicantKytTxnRejected', kytTxnId: 'T1' });

      expect(workflow.applyKytVerdict).toHaveBeenCalledWith(
        SWAP_ID,
        expect.objectContaining({ verdict: 'rejected', dispoTag: 'FROZEN_BY_MLRO' }),
      );
      const arg = workflow.applyKytVerdict.mock.calls[0][1];
      expect(arg).not.toHaveProperty('sceneTag');
    });

    it('③ PEP 客户本人：awaitingUser（归一为 rejected）+ PEP_APPLICANT → sceneTag 透传给 workflow', async () => {
      sumsubTxnClient.getTxn.mockResolvedValue(
        txnDetail([{ label: 'PEP_APPLICANT' }]),
      );

      await handler.handle({ type: 'applicantKytTxnAwaitingUser', kytTxnId: 'T1' });

      expect(workflow.applyKytVerdict).toHaveBeenCalledWith(
        SWAP_ID,
        expect.objectContaining({ verdict: 'rejected', sceneTag: 'PEP_APPLICANT' }),
      );
      const arg = workflow.applyKytVerdict.mock.calls[0][1];
      expect(arg).not.toHaveProperty('dispoTag');
    });

    it('同时命中 SANCTION_APPLICANT 与 PEP_APPLICANT → 优先级更高的 SANCTION_APPLICANT 赢（复用 A2 的 SCENE_TAG_PRIORITY）', async () => {
      sumsubTxnClient.getTxn.mockResolvedValue(
        txnDetail([{ label: 'PEP_APPLICANT' }, { label: 'SANCTION_APPLICANT' }]),
      );

      await handler.handle({ type: 'applicantKytTxnRejected', kytTxnId: 'T1' });

      expect(workflow.applyKytVerdict).toHaveBeenCalledWith(
        SWAP_ID,
        expect.objectContaining({ sceneTag: 'SANCTION_APPLICANT' }),
      );
    });

    it('场景 tag 与处置 tag 各自独立判定，互不覆盖（PEP_APPLICANT + FROZEN_BY_MLRO 同时命中）', async () => {
      sumsubTxnClient.getTxn.mockResolvedValue(
        txnDetail([{ label: 'PEP_APPLICANT' }, { label: 'FROZEN_BY_MLRO' }]),
      );

      await handler.handle({ type: 'applicantKytTxnRejected', kytTxnId: 'T1' });

      expect(workflow.applyKytVerdict).toHaveBeenCalledWith(
        SWAP_ID,
        expect.objectContaining({ sceneTag: 'PEP_APPLICANT', dispoTag: 'FROZEN_BY_MLRO' }),
      );
    });
  });
});
