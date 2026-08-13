import { SwapKytVerdictHandler } from './swap-kyt-verdict.handler';
import { SwapWorkflowService } from '../trading/swap-transactions/swap-workflow.service';
import { SwapTransactionsService } from '../trading/swap-transactions/swap-transactions.service';
import { SumsubTxnClient } from '../deposit-sumsub/sumsub-txn-client.interface';
import { SumsubTxnDetail } from '../deposit-sumsub/sumsub-txn.types';

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

  it('Approved → 调 applyKytVerdict(verdict=approved)，approved 不拉 getTxn', async () => {
    const hit = await handler.handle({
      type: 'applicantKytTxnApproved',
      kytTxnId: 'T1',
    });

    expect(hit).toBe(true);
    expect(sumsubTxnClient.getTxn).not.toHaveBeenCalled();
    expect(workflow.applyKytVerdict).toHaveBeenCalledWith(
      SWAP_ID,
      expect.objectContaining({ verdict: 'approved' }),
    );
  });

  it('Rejected → 调 applyKytVerdict(verdict=rejected)，拉 getTxn 读 typedTags', async () => {
    sumsubTxnClient.getTxn.mockResolvedValue(
      txnDetail([{ label: 'SANCTION' }]),
    );

    const hit = await handler.handle({
      type: 'applicantKytTxnRejected',
      kytTxnId: 'T1',
    });

    expect(hit).toBe(true);
    expect(sumsubTxnClient.getTxn).toHaveBeenCalledWith('T1');
    expect(workflow.applyKytVerdict).toHaveBeenCalledWith(
      SWAP_ID,
      expect.objectContaining({ verdict: 'rejected', typedTags: ['SANCTION'] }),
    );
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
});
