import { WithdrawKytVerdictHandler } from './withdraw-kyt-verdict.handler';
import { WithdrawWorkflowService } from '../trading/withdraw-transactions/withdraw-workflow.service';
import { WithdrawTransactionsService } from '../trading/withdraw-transactions/withdraw-transactions.service';
import { SumsubTxnClient } from '../deposit-sumsub/sumsub-txn-client.interface';
import { SumsubTxnDetail } from '../deposit-sumsub/sumsub-txn.types';

describe('WithdrawKytVerdictHandler', () => {
  let workflow: jest.Mocked<WithdrawWorkflowService>;
  let withdrawService: jest.Mocked<WithdrawTransactionsService>;
  let sumsubTxnClient: jest.Mocked<SumsubTxnClient>;
  let handler: WithdrawKytVerdictHandler;

  const WITHDRAW_ID = 'WD-1';

  beforeEach(() => {
    workflow = {
      applyKytVerdict: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<WithdrawWorkflowService>;

    withdrawService = {
      findBySumsubTxnId: jest.fn().mockResolvedValue({ id: WITHDRAW_ID }),
    } as unknown as jest.Mocked<WithdrawTransactionsService>;

    sumsubTxnClient = {
      submitTxn: jest.fn(),
      getTxn: jest.fn(),
      rescore: jest.fn(),
      reviewComplete: jest.fn(),
    } as unknown as jest.Mocked<SumsubTxnClient>;

    handler = new WithdrawKytVerdictHandler(workflow, withdrawService, sumsubTxnClient);
  });

  function txnDetail(
    tags: { label: string; type?: 'system' | 'userDefined' }[],
    riskScore: number | null = 87,
    applicantActions?: { applicantActionId: string; externalActionId: string }[],
  ): SumsubTxnDetail {
    return {
      txnId: 'T1',
      verdict: 'rejected',
      reviewAnswer: 'RED',
      riskScore,
      typedTags: tags.map((t) => ({ label: t.label, type: t.type ?? 'userDefined' })),
      raw: { txnId: 'T1', reviewResult: { reviewAnswer: 'RED' } },
      ...(applicantActions && { applicantActions }),
    };
  }

  // ── 四态归一(含 applicantKytOnHold 无 Txn) ──

  it('Approved: calls getTxn (证据对齐), applies verdict=approved with riskScore + detailRaw, no tag reading, returns true', async () => {
    const detail = txnDetail([{ label: 'SANCTION' }], 92);
    sumsubTxnClient.getTxn.mockResolvedValue(detail);

    const result = await handler.handle({ type: 'applicantKytTxnApproved', kytTxnId: 'T1' });

    expect(sumsubTxnClient.getTxn).toHaveBeenCalledWith('T1');
    expect(withdrawService.findBySumsubTxnId).toHaveBeenCalledWith('T1');
    expect(workflow.applyKytVerdict).toHaveBeenCalledTimes(1);
    expect(workflow.applyKytVerdict).toHaveBeenCalledWith(WITHDRAW_ID, {
      verdict: 'approved',
      riskScore: 92,
      detailRaw: detail.raw,
    });
    expect(result).toBe(true);
  });

  it('Rejected: verdict=rejected, riskScore + detailRaw 透传', async () => {
    const detail = txnDetail([], 40);
    sumsubTxnClient.getTxn.mockResolvedValue(detail);

    const result = await handler.handle({ type: 'applicantKytTxnRejected', kytTxnId: 'T1' });

    expect(sumsubTxnClient.getTxn).toHaveBeenCalledWith('T1');
    expect(workflow.applyKytVerdict).toHaveBeenCalledWith(WITHDRAW_ID, {
      verdict: 'rejected',
      riskScore: 40,
      detailRaw: detail.raw,
    });
    expect(result).toBe(true);
  });

  it('AwaitingUser: verdict=awaitUser, riskScore + detailRaw 透传', async () => {
    const detail = txnDetail([], 10);
    sumsubTxnClient.getTxn.mockResolvedValue(detail);

    const result = await handler.handle({ type: 'applicantKytTxnAwaitingUser', kytTxnId: 'T1' });

    expect(workflow.applyKytVerdict).toHaveBeenCalledWith(WITHDRAW_ID, {
      verdict: 'awaitUser',
      riskScore: 10,
      detailRaw: detail.raw,
    });
    expect(result).toBe(true);
  });

  it('AwaitingUser + getTxn returns applicantActions → 透传进 applyKytVerdict 第二参数(mirrors deposit handler)', async () => {
    const actions = [{ applicantActionId: 'aa-1', externalActionId: 'EXT-1' }];
    const detail = txnDetail([], 10, actions);
    sumsubTxnClient.getTxn.mockResolvedValue(detail);

    await handler.handle({ type: 'applicantKytTxnAwaitingUser', kytTxnId: 'T1' });

    expect(workflow.applyKytVerdict).toHaveBeenCalledWith(WITHDRAW_ID, {
      verdict: 'awaitUser',
      riskScore: 10,
      detailRaw: detail.raw,
      applicantActions: actions,
    });
  });

  it('onHold(applicantKytOnHold,官方命名无 Txn): 也拉 getTxn 存证(分数+报文),但不读处置 tag', async () => {
    withdrawService.findBySumsubTxnId.mockResolvedValue({ id: WITHDRAW_ID } as any);
    sumsubTxnClient.getTxn.mockResolvedValue({
      txnId: 'T-oh',
      verdict: 'onHold',
      reviewAnswer: null,
      riskScore: 55,
      // fixture 故意塞了处置 tag —— onHold 不该读它
      typedTags: [{ label: 'FROZEN_BY_MLRO', type: 'userDefined' }],
      raw: { id: 'T-oh' },
    });

    const result = await handler.handle({ type: 'applicantKytOnHold', kytTxnId: 'T-oh' });

    expect(sumsubTxnClient.getTxn).toHaveBeenCalledWith('T-oh');
    expect(workflow.applyKytVerdict).toHaveBeenCalledWith(WITHDRAW_ID, {
      verdict: 'onHold',
      riskScore: 55,
      detailRaw: { id: 'T-oh' },
    });
    // onHold 不读处置 tag —— 上面 fixture 故意塞了 FROZEN_BY_MLRO,不应被解析出来
    expect(workflow.applyKytVerdict).not.toHaveBeenCalledWith(
      WITHDRAW_ID,
      expect.objectContaining({ dispoTag: 'FROZEN_BY_MLRO' }),
    );
    expect(result).toBe(true);
  });

  // ── rejected/awaitUser 才读 tag ──

  it('Rejected + getTxn returns [SANCTION] → sceneTag=SANCTION', async () => {
    const detail = txnDetail([{ label: 'SANCTION' }]);
    sumsubTxnClient.getTxn.mockResolvedValue(detail);

    await handler.handle({ type: 'applicantKytTxnRejected', kytTxnId: 'T1' });

    expect(workflow.applyKytVerdict).toHaveBeenCalledWith(WITHDRAW_ID, {
      verdict: 'rejected',
      riskScore: 87,
      sceneTag: 'SANCTION',
      detailRaw: detail.raw,
    });
  });

  it('AwaitingUser + getTxn returns [PEP] → sceneTag=PEP', async () => {
    const detail = txnDetail([{ label: 'PEP' }]);
    sumsubTxnClient.getTxn.mockResolvedValue(detail);

    await handler.handle({ type: 'applicantKytTxnAwaitingUser', kytTxnId: 'T1' });

    expect(workflow.applyKytVerdict).toHaveBeenCalledWith(WITHDRAW_ID, {
      verdict: 'awaitUser',
      riskScore: 87,
      sceneTag: 'PEP',
      detailRaw: detail.raw,
    });
  });

  it('onHold fixture 里塞 FROZEN_BY_MLRO 断言不被解析(重复断言,onHold 不进 TAG_LOOKUP_VERDICTS)', async () => {
    sumsubTxnClient.getTxn.mockResolvedValue({
      txnId: 'T-oh2',
      verdict: 'onHold',
      reviewAnswer: null,
      riskScore: 33,
      typedTags: [{ label: 'FROZEN_BY_MLRO', type: 'userDefined' }],
      raw: { id: 'T-oh2' },
    });

    await handler.handle({ type: 'applicantKytOnHold', kytTxnId: 'T-oh2' });

    const call = workflow.applyKytVerdict.mock.calls[0][1];
    expect(call).not.toHaveProperty('dispoTag');
    expect(call).not.toHaveProperty('sceneTag');
  });

  // ── 处置 tag 集合(与充值不同):FROZEN_BY_MLRO / REJECT_REFUND;RETURN_TO_SENDER 不识别 ──

  it('Rejected + getTxn returns [FROZEN_BY_MLRO] → dispoTag=FROZEN_BY_MLRO', async () => {
    const detail = txnDetail([{ label: 'FROZEN_BY_MLRO' }]);
    sumsubTxnClient.getTxn.mockResolvedValue(detail);

    await handler.handle({ type: 'applicantKytTxnRejected', kytTxnId: 'T1' });

    expect(workflow.applyKytVerdict).toHaveBeenCalledWith(WITHDRAW_ID, {
      verdict: 'rejected',
      riskScore: 87,
      dispoTag: 'FROZEN_BY_MLRO',
      detailRaw: detail.raw,
    });
  });

  it('Rejected + getTxn returns [REJECT_REFUND] → dispoTag=REJECT_REFUND (withdraw-specific, not deposit RETURN_TO_SENDER)', async () => {
    const detail = txnDetail([{ label: 'REJECT_REFUND' }]);
    sumsubTxnClient.getTxn.mockResolvedValue(detail);

    await handler.handle({ type: 'applicantKytTxnRejected', kytTxnId: 'T1' });

    expect(workflow.applyKytVerdict).toHaveBeenCalledWith(WITHDRAW_ID, {
      verdict: 'rejected',
      riskScore: 87,
      dispoTag: 'REJECT_REFUND',
      detailRaw: detail.raw,
    });
  });

  it('Rejected + getTxn returns [RETURN_TO_SENDER] (deposit-only tag) → NOT recognized as dispoTag in withdraw', async () => {
    const detail = txnDetail([{ label: 'RETURN_TO_SENDER' }]);
    sumsubTxnClient.getTxn.mockResolvedValue(detail);

    await handler.handle({ type: 'applicantKytTxnRejected', kytTxnId: 'T1' });

    const call = workflow.applyKytVerdict.mock.calls[0][1];
    expect(call).not.toHaveProperty('dispoTag');
  });

  // ── orphan / ignore ownership boolean ──

  it('orphan: no withdraw found for kytTxnId → does not call workflow, warns, returns false', async () => {
    withdrawService.findBySumsubTxnId.mockResolvedValue(null as any);
    const warnSpy = jest.spyOn((handler as any).logger, 'warn').mockImplementation(() => undefined);

    const result = await handler.handle({ type: 'applicantKytTxnApproved', kytTxnId: 'UNKNOWN' });

    expect(workflow.applyKytVerdict).not.toHaveBeenCalled();
    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('UNKNOWN'));
  });

  it('Reviewed (ignore type): no-op, does not call workflow, but DOES look up ownership → matched returns true', async () => {
    const result = await handler.handle({ type: 'applicantKytTxnReviewed', kytTxnId: 'T1' });

    expect(withdrawService.findBySumsubTxnId).toHaveBeenCalledWith('T1');
    expect(sumsubTxnClient.getTxn).not.toHaveBeenCalled();
    expect(workflow.applyKytVerdict).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('Created (ignore type): no-op, no withdraw owns it → returns false', async () => {
    withdrawService.findBySumsubTxnId.mockResolvedValue(null as any);

    const result = await handler.handle({ type: 'applicantKytTxnCreated', kytTxnId: 'UNKNOWN' });

    expect(sumsubTxnClient.getTxn).not.toHaveBeenCalled();
    expect(workflow.applyKytVerdict).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });
});
