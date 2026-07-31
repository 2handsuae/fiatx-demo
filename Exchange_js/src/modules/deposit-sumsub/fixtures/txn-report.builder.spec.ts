import { buildTxnReport, TxnReportContext, TxnReportVerdict } from './txn-report.builder';

const baseCtx: TxnReportContext = {
  txnId: '66fbab2a916881505f61fd11',
  txnType: 'finance',
  applicantId: '6b1c47f0a2d38e5904bb7215',
  externalUserId: 'CU2601019430',
  clientTxnId: 'DEP2607314153',
  amount: 3000,
  currency: 'USDT',
  isCrypto: true,
  createdAtIso: '2026-07-31T09:39:41.000Z',
};

const approvedVerdict: TxnReportVerdict = {
  reviewStatus: 'completed',
  reviewAnswer: 'GREEN',
  action: 'score',
  score: 5,
};

describe('buildTxnReport', () => {
  it('产出官方顶层字段,且不含真实 Sumsub 没有的顶层 verdict', () => {
    const r = buildTxnReport(baseCtx, approvedVerdict) as any;
    expect(r.id).toBe('66fbab2a916881505f61fd11');
    expect(r.applicantId).toBe('6b1c47f0a2d38e5904bb7215');
    expect(r.externalUserId).toBe('CU2601019430');
    expect(r.score).toBe(5);
    expect(r.createdAt).toBe('2026-07-31T09:39:41.000Z');
    expect(r.verdict).toBeUndefined();
  });

  it('review.reviewStatus 落官方合法值,reviewResult 嵌在 review 下', () => {
    const r = buildTxnReport(baseCtx, approvedVerdict) as any;
    expect(r.review.reviewStatus).toBe('completed');
    expect(r.review.reviewResult.reviewAnswer).toBe('GREEN');
    expect(r.review.reviewResult.moderationComment).toBeUndefined();
  });

  it('scoringResult.action 是 verdict 的生产来源', () => {
    const r = buildTxnReport(baseCtx, { ...approvedVerdict, action: 'reject' }) as any;
    expect(r.scoringResult.action).toBe('reject');
    expect(r.scoringResult.matchedRules).toEqual([]);
    expect(r.scoringResult.applicantActions).toEqual([]);
    expect(r.scoringResult.failedRules).toEqual([]);
  });

  it('data.type 跟随 ctx.txnType', () => {
    expect((buildTxnReport(baseCtx, approvedVerdict) as any).data.type).toBe('finance');
    expect(
      (buildTxnReport({ ...baseCtx, txnType: 'travelRule' }, approvedVerdict) as any).data.type,
    ).toBe('travelRule');
  });

  it('travelRuleInfo 只在 travelRule 单出现', () => {
    expect((buildTxnReport(baseCtx, approvedVerdict) as any).travelRuleInfo).toBeUndefined();
    const tr = buildTxnReport({ ...baseCtx, txnType: 'travelRule' }, approvedVerdict) as any;
    expect(tr.travelRuleInfo.protocolName).toBe('trp');
    expect(tr.travelRuleInfo.status).toBe('completed');
    expect(tr.travelRuleInfo.counterpartyVaspId).toBeDefined();
  });

  it('cryptoTxnInfo 只在虚拟币单出现', () => {
    expect((buildTxnReport(baseCtx, approvedVerdict) as any).cryptoTxnInfo).toBeDefined();
    const fiat = buildTxnReport(
      { ...baseCtx, isCrypto: false, currency: 'AED' },
      approvedVerdict,
    ) as any;
    expect(fiat.cryptoTxnInfo).toBeUndefined();
  });

  it('typedTags / matchedRules / applicantActions 原样透传', () => {
    const r = buildTxnReport(baseCtx, {
      ...approvedVerdict,
      reviewAnswer: 'RED',
      action: 'reject',
      score: 98,
      typedTags: [{ label: 'SANCTION', type: 'userDefined' }],
      matchedRules: [
        { id: 'AML1', name: 'Sanctions match', revision: 3, title: 'Sanctions', score: 98, dryRun: false, action: 'reject' },
      ],
      applicantActions: [{ applicantActionId: 'act-1', externalActionId: 'ext-1' }],
    }) as any;
    expect(r.typedTags).toEqual([{ label: 'SANCTION', type: 'userDefined' }]);
    expect(r.scoringResult.matchedRules[0].name).toBe('Sanctions match');
    expect(r.scoringResult.applicantActions[0].applicantActionId).toBe('act-1');
  });

  it('reviewRejectType 传入时出现在 reviewResult 上', () => {
    const r = buildTxnReport(baseCtx, {
      ...approvedVerdict,
      reviewRejectType: 'FINAL',
    }) as any;
    expect(r.review.reviewResult.reviewRejectType).toBe('FINAL');
  });

  it('reviewRejectType 不传时不出现在 reviewResult 上', () => {
    const r = buildTxnReport(baseCtx, approvedVerdict) as any;
    expect(r.review.reviewResult.reviewRejectType).toBeUndefined();
  });
});
