import { DepositKytVerdictHandler } from './deposit-kyt-verdict.handler';
import { DepositWorkflowService } from '../trading/deposit-transactions/deposit-workflow.service';
import { DepositTransactionsService } from '../trading/deposit-transactions/deposit-transactions.service';
import { SumsubTxnClient } from '../sumsub-shared/sumsub-txn-client.interface';
import { SumsubTxnDetail } from '../sumsub-shared/sumsub-txn.types';

describe('DepositKytVerdictHandler', () => {
  let workflow: jest.Mocked<DepositWorkflowService>;
  let depositService: jest.Mocked<DepositTransactionsService>;
  let sumsubTxnClient: jest.Mocked<SumsubTxnClient>;
  let handler: DepositKytVerdictHandler;

  const DEPOSIT_ID = 'DEP-1';

  beforeEach(() => {
    workflow = {
      applyKytVerdict: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DepositWorkflowService>;

    depositService = {
      findBySumsubTxnId: jest.fn().mockResolvedValue({ id: DEPOSIT_ID }),
    } as unknown as jest.Mocked<DepositTransactionsService>;

    sumsubTxnClient = {
      submitTxn: jest.fn(),
      getTxn: jest.fn(),
      rescore: jest.fn(),
      reviewComplete: jest.fn(),
    } as unknown as jest.Mocked<SumsubTxnClient>;

    handler = new DepositKytVerdictHandler(workflow, depositService, sumsubTxnClient);
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

  it('Approved: calls getTxn (证据对齐), applies verdict=approved with riskScore + detailRaw, no tag reading', async () => {
    const detail = txnDetail([{ label: 'SANCTION' }], 92);
    sumsubTxnClient.getTxn.mockResolvedValue(detail);

    const result = await handler.handle({ type: 'applicantKytTxnApproved', kytTxnId: 'T1' });

    expect(sumsubTxnClient.getTxn).toHaveBeenCalledWith('T1');
    expect(depositService.findBySumsubTxnId).toHaveBeenCalledWith('T1');
    expect(workflow.applyKytVerdict).toHaveBeenCalledTimes(1);
    expect(workflow.applyKytVerdict).toHaveBeenCalledWith(DEPOSIT_ID, {
      verdict: 'approved',
      riskScore: 92,
      detailRaw: detail.raw,
    });
    expect(result).toBe(true);
  });

  it('Rejected + getTxn returns [SANCTION_COUNTERPARTY] → verdict=rejected, sceneTag=SANCTION_COUNTERPARTY, detailRaw 透传', async () => {
    const detail = txnDetail([{ label: 'SANCTION_COUNTERPARTY' }]);
    sumsubTxnClient.getTxn.mockResolvedValue(detail);

    await handler.handle({ type: 'applicantKytTxnRejected', kytTxnId: 'T1' });

    expect(sumsubTxnClient.getTxn).toHaveBeenCalledWith('T1');
    expect(workflow.applyKytVerdict).toHaveBeenCalledWith(DEPOSIT_ID, {
      verdict: 'rejected',
      riskScore: 87,
      sceneTag: 'SANCTION_COUNTERPARTY',
      detailRaw: detail.raw,
    });
  });

  it('Rejected + getTxn returns [FROZEN_BY_MLRO] → verdict=rejected, dispoTag=FROZEN_BY_MLRO, detailRaw 透传', async () => {
    const detail = txnDetail([{ label: 'FROZEN_BY_MLRO' }]);
    sumsubTxnClient.getTxn.mockResolvedValue(detail);

    await handler.handle({ type: 'applicantKytTxnRejected', kytTxnId: 'T1' });

    expect(workflow.applyKytVerdict).toHaveBeenCalledWith(DEPOSIT_ID, {
      verdict: 'rejected',
      riskScore: 87,
      dispoTag: 'FROZEN_BY_MLRO',
      detailRaw: detail.raw,
    });
  });

  it('AwaitingUser + getTxn returns [PEP] → verdict=awaitUser, sceneTag=PEP, detailRaw 透传', async () => {
    const detail = txnDetail([{ label: 'PEP' }]);
    sumsubTxnClient.getTxn.mockResolvedValue(detail);

    await handler.handle({ type: 'applicantKytTxnAwaitingUser', kytTxnId: 'T1' });

    expect(sumsubTxnClient.getTxn).toHaveBeenCalledWith('T1');
    expect(workflow.applyKytVerdict).toHaveBeenCalledWith(DEPOSIT_ID, {
      verdict: 'awaitUser',
      riskScore: 87,
      sceneTag: 'PEP',
      detailRaw: detail.raw,
    });
  });

  it('AwaitingUser + getTxn returns applicantActions → 透传进 applyKytVerdict 第二参数(此前误删两行测不出来)', async () => {
    const actions = [{ applicantActionId: 'aa-1', externalActionId: 'EXT-1' }];
    const detail = txnDetail([{ label: 'PEP' }], 87, actions);
    sumsubTxnClient.getTxn.mockResolvedValue(detail);

    await handler.handle({ type: 'applicantKytTxnAwaitingUser', kytTxnId: 'T1' });

    expect(workflow.applyKytVerdict).toHaveBeenCalledWith(DEPOSIT_ID, {
      verdict: 'awaitUser',
      riskScore: 87,
      sceneTag: 'PEP',
      detailRaw: detail.raw,
      applicantActions: actions,
    });
  });

  it('Reviewed: no-op, does not call workflow, but DOES look up ownership (boolean hit-flag)', async () => {
    const result = await handler.handle({ type: 'applicantKytTxnReviewed', kytTxnId: 'T1' });

    expect(depositService.findBySumsubTxnId).toHaveBeenCalledWith('T1');
    expect(sumsubTxnClient.getTxn).not.toHaveBeenCalled();
    expect(workflow.applyKytVerdict).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('Reviewed + no deposit owns this kytTxnId: still no-op, returns false', async () => {
    depositService.findBySumsubTxnId.mockResolvedValue(null as any);

    const result = await handler.handle({ type: 'applicantKytTxnReviewed', kytTxnId: 'UNKNOWN' });

    expect(workflow.applyKytVerdict).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('Created: 归一为 ignore,不调用 getTxn / applyKytVerdict,按 ownership 返回布尔', async () => {
    const result = await handler.handle({ type: 'applicantKytTxnCreated', kytTxnId: 'T1' });

    expect(sumsubTxnClient.getTxn).not.toHaveBeenCalled();
    expect(workflow.applyKytVerdict).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('onHold 也拉 getTxn 存证(分数+报文),但不读处置 tag', async () => {
    depositService.findBySumsubTxnId.mockResolvedValue({ id: 'dep-1' });
    sumsubTxnClient.getTxn.mockResolvedValue({
      txnId: 'T-oh',
      verdict: 'onHold',
      reviewAnswer: null,
      riskScore: 55,
      typedTags: [{ label: 'FROZEN_BY_MLRO', type: 'userDefined' }],
      raw: { id: 'T-oh' },
    });

    await handler.handle({ type: 'applicantKytOnHold', kytTxnId: 'T-oh' });

    expect(sumsubTxnClient.getTxn).toHaveBeenCalledWith('T-oh');
    expect(workflow.applyKytVerdict).toHaveBeenCalledWith('dep-1', {
      verdict: 'onHold',
      riskScore: 55,
      detailRaw: { id: 'T-oh' },
    });
    // onHold 不读处置 tag —— 上面 fixture 故意塞了 FROZEN_BY_MLRO,不应被解析出来
    expect(workflow.applyKytVerdict).not.toHaveBeenCalledWith(
      'dep-1',
      expect.objectContaining({ dispoTag: 'FROZEN_BY_MLRO' }),
    );
  });

  it('orphan: no deposit found for kytTxnId → does not call workflow, returns false', async () => {
    depositService.findBySumsubTxnId.mockResolvedValue(null as any);

    const result = await handler.handle({ type: 'applicantKytTxnApproved', kytTxnId: 'UNKNOWN' });

    expect(workflow.applyKytVerdict).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('同时命中 APPLICANT 与 COUNTERPARTY 时，APPLICANT 优先（不受报文顺序影响）', async () => {
    // COUNTERPARTY 排在前面 —— 旧的标量覆盖写法会让 APPLICANT 赢；
    // 反序（见下一个 expect）则会让 COUNTERPARTY 赢。两次都必须是 APPLICANT。
    sumsubTxnClient.getTxn.mockResolvedValue(
      txnDetail([{ label: 'SANCTION_COUNTERPARTY' }, { label: 'SANCTION_APPLICANT' }]),
    );
    await handler.handle({ type: 'applicantKytTxnRejected', kytTxnId: 'T1' });
    expect(workflow.applyKytVerdict).toHaveBeenLastCalledWith(
      DEPOSIT_ID,
      expect.objectContaining({ sceneTag: 'SANCTION_APPLICANT' }),
    );

    sumsubTxnClient.getTxn.mockResolvedValue(
      txnDetail([{ label: 'SANCTION_APPLICANT' }, { label: 'SANCTION_COUNTERPARTY' }]),
    );
    await handler.handle({ type: 'applicantKytTxnRejected', kytTxnId: 'T1' });
    expect(workflow.applyKytVerdict).toHaveBeenLastCalledWith(
      DEPOSIT_ID,
      expect.objectContaining({ sceneTag: 'SANCTION_APPLICANT' }),
    );
  });

  it('只命中 COUNTERPARTY 时原样传下去', async () => {
    sumsubTxnClient.getTxn.mockResolvedValue(txnDetail([{ label: 'SANCTION_COUNTERPARTY' }]));
    await handler.handle({ type: 'applicantKytTxnRejected', kytTxnId: 'T1' });
    expect(workflow.applyKytVerdict).toHaveBeenLastCalledWith(
      DEPOSIT_ID,
      expect.objectContaining({ sceneTag: 'SANCTION_COUNTERPARTY' }),
    );
  });

  it('COUNTERPARTY 与 PEP 同时命中时 COUNTERPARTY 优先（不受报文顺序影响）', async () => {
    for (const order of [
      ['SANCTION_COUNTERPARTY', 'PEP'],
      ['PEP', 'SANCTION_COUNTERPARTY'],
    ]) {
      sumsubTxnClient.getTxn.mockResolvedValue(txnDetail(order.map((label) => ({ label }))));
      await handler.handle({ type: 'applicantKytTxnRejected', kytTxnId: 'T1' });
      expect(workflow.applyKytVerdict).toHaveBeenLastCalledWith(
        DEPOSIT_ID,
        expect.objectContaining({ sceneTag: 'SANCTION_COUNTERPARTY' }),
      );
    }
  });
});
