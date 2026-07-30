import { DepositKytVerdictHandler } from './deposit-kyt-verdict.handler';
import { DepositWorkflowService } from '../trading/deposit-transactions/deposit-workflow.service';
import { DepositTransactionsService } from '../trading/deposit-transactions/deposit-transactions.service';
import { SumsubTxnClient } from './sumsub-txn-client.interface';
import { SumsubTxnDetail } from './sumsub-txn.types';

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
  ): SumsubTxnDetail {
    return {
      txnId: 'T1',
      verdict: 'rejected',
      reviewAnswer: 'RED',
      riskScore,
      typedTags: tags.map((t) => ({ label: t.label, type: t.type ?? 'userDefined' })),
      raw: { txnId: 'T1', reviewResult: { reviewAnswer: 'RED' } },
    };
  }

  it('Approved: calls getTxn (证据对齐), applies verdict=approved with riskScore + detailRaw, no tag reading', async () => {
    const detail = txnDetail([{ label: 'SANCTION' }], 92);
    sumsubTxnClient.getTxn.mockResolvedValue(detail);

    await handler.handle({ type: 'applicantKytTxnApproved', kytTxnId: 'T1' });

    expect(sumsubTxnClient.getTxn).toHaveBeenCalledWith('T1');
    expect(depositService.findBySumsubTxnId).toHaveBeenCalledWith('T1');
    expect(workflow.applyKytVerdict).toHaveBeenCalledTimes(1);
    expect(workflow.applyKytVerdict).toHaveBeenCalledWith(DEPOSIT_ID, {
      verdict: 'approved',
      riskScore: 92,
      detailRaw: detail.raw,
    });
  });

  it('Rejected + getTxn returns [SANCTION] → verdict=rejected, sceneTag=SANCTION, detailRaw 透传', async () => {
    const detail = txnDetail([{ label: 'SANCTION' }]);
    sumsubTxnClient.getTxn.mockResolvedValue(detail);

    await handler.handle({ type: 'applicantKytTxnRejected', kytTxnId: 'T1' });

    expect(sumsubTxnClient.getTxn).toHaveBeenCalledWith('T1');
    expect(workflow.applyKytVerdict).toHaveBeenCalledWith(DEPOSIT_ID, {
      verdict: 'rejected',
      riskScore: 87,
      sceneTag: 'SANCTION',
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

  it('Reviewed: no-op, does not call workflow', async () => {
    await handler.handle({ type: 'applicantKytTxnReviewed', kytTxnId: 'T1' });

    expect(depositService.findBySumsubTxnId).not.toHaveBeenCalled();
    expect(sumsubTxnClient.getTxn).not.toHaveBeenCalled();
    expect(workflow.applyKytVerdict).not.toHaveBeenCalled();
  });

  it('orphan: no deposit found for kytTxnId → does not call workflow', async () => {
    depositService.findBySumsubTxnId.mockResolvedValue(null as any);

    await handler.handle({ type: 'applicantKytTxnApproved', kytTxnId: 'UNKNOWN' });

    expect(workflow.applyKytVerdict).not.toHaveBeenCalled();
  });
});
