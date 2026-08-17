import { MaterialRequestReviewService } from './material-request-review.service';

const ACTOR = { actorType: 'ADMIN' as const, actorId: 'u1', actorNo: 'ADM001', actorRole: 'MLRO' };

function row(over: Record<string, any> = {}) {
  return {
    requestNo: 'MRQ2608170001', customerId: 'c1', materialType: 'SOURCE_OF_FUNDS',
    levelName: 'wave3-action-sof-refresh', applicantActionId: 'act-1', externalActionId: 'ext-1',
    orderDomain: 'DEPOSIT', orderRef: 'DP2608170001', restrictionNo: 'RST2608170001',
    origin: 'SUMSUB_PUSHED', status: 'SUBMITTED', reason: 'KYT requires SoF',
    issuedBy: 'SYSTEM', issuedAt: new Date(), submittedAt: new Date(),
    reviewedAt: null, reviewAnswer: null, reviewRejectType: null,
    cancelledAt: null, cancelReason: null, traceId: 'MATERIAL_REQUEST:t1',
    ...over,
  };
}

function deps(found: any = row()) {
  const requests = {
    findByExternalActionId: jest.fn().mockResolvedValue(found),
    markReviewed: jest.fn(async (_no: string, ans: string, rt: string | null) =>
      row({
        status: ans === 'GREEN' ? 'APPROVED' : rt === 'RETRY' ? 'PENDING_SUBMISSION' : 'REJECTED',
        reviewAnswer: ans, reviewRejectType: rt,
      })),
  } as any;
  const restrictions = {
    findByNo: jest.fn().mockResolvedValue({
      restrictionNo: 'RST2608170001', cause: 'PENDING_DOCUMENT', caseRef: 'MRQ2608170001',
    }),
  } as any;
  const restrictionWorkflow = { autoRelease: jest.fn().mockResolvedValue(undefined) } as any;
  const eventEmitter = { emit: jest.fn() } as any;
  return { requests, restrictions, restrictionWorkflow, eventEmitter };
}

const build = (d: ReturnType<typeof deps>) =>
  new MaterialRequestReviewService(d.requests, d.restrictions, d.restrictionWorkflow, d.eventEmitter);

describe('MaterialRequestReviewService.applyReview', () => {
  it('GREEN → APPROVED 且自动撕便签（caseRef 用 requestNo，releaseMode 由 autoRelease 定为 AUTO）', async () => {
    const d = deps();
    const out = await build(d).applyReview({ externalActionId: 'ext-1', reviewAnswer: 'GREEN', actor: ACTOR });
    expect(out).toEqual({ requestNo: 'MRQ2608170001', outcome: 'APPROVED' });
    expect(d.restrictionWorkflow.autoRelease).toHaveBeenCalledWith(
      'c1', 'PENDING_DOCUMENT', 'MRQ2608170001', 'SYSTEM',
    );
  });

  it('便签的 caseRef 不等于 requestNo 时（兑换域用 swapNo），按便签自己的 caseRef 撕', async () => {
    const d = deps();
    d.restrictions.findByNo.mockResolvedValue({
      restrictionNo: 'RST2608170001', cause: 'KYT_REJECTED_SOFT', caseRef: 'SW2608170001',
    });
    await build(d).applyReview({ externalActionId: 'ext-1', reviewAnswer: 'GREEN', actor: ACTOR });
    expect(d.restrictionWorkflow.autoRelease).toHaveBeenCalledWith(
      'c1', 'KYT_REJECTED_SOFT', 'SW2608170001', 'SYSTEM',
    );
  });

  it('GREEN 但这一行没挂便签 → 不调 autoRelease', async () => {
    const d = deps(row({ restrictionNo: null }));
    await build(d).applyReview({ externalActionId: 'ext-1', reviewAnswer: 'GREEN', actor: ACTOR });
    expect(d.restrictionWorkflow.autoRelease).not.toHaveBeenCalled();
  });

  it('RED+RETRY → outcome=RETRY，便签原地不动', async () => {
    const d = deps();
    const out = await build(d).applyReview({
      externalActionId: 'ext-1', reviewAnswer: 'RED', reviewRejectType: 'RETRY', actor: ACTOR,
    });
    expect(out).toEqual({ requestNo: 'MRQ2608170001', outcome: 'RETRY' });
    expect(d.restrictionWorkflow.autoRelease).not.toHaveBeenCalled();
  });

  it('RED+FINAL → outcome=REJECTED，便签同样原地不动（审不过就是没解开）', async () => {
    const d = deps();
    const out = await build(d).applyReview({
      externalActionId: 'ext-1', reviewAnswer: 'RED', reviewRejectType: 'FINAL', actor: ACTOR,
    });
    expect(out).toEqual({ requestNo: 'MRQ2608170001', outcome: 'REJECTED' });
    expect(d.restrictionWorkflow.autoRelease).not.toHaveBeenCalled();
  });

  it('三种结局都广播 MATERIAL_REQUEST_REVIEWED，带上绑的单', async () => {
    for (const [ans, rt, outcome] of [
      ['GREEN', undefined, 'APPROVED'], ['RED', 'RETRY', 'RETRY'], ['RED', 'FINAL', 'REJECTED'],
    ] as const) {
      const d = deps();
      await build(d).applyReview({
        externalActionId: 'ext-1', reviewAnswer: ans as any, reviewRejectType: rt as any, actor: ACTOR,
      });
      expect(d.eventEmitter.emit).toHaveBeenCalledWith(
        'material-request.reviewed',
        expect.objectContaining({
          requestNo: 'MRQ2608170001', customerId: 'c1',
          orderDomain: 'DEPOSIT', orderRef: 'DP2608170001', outcome,
        }),
      );
    }
  });

  it('externalActionId 不属于本账 → 返回 null，不抛、不发事件', async () => {
    const d = deps(null);
    const out = await build(d).applyReview({ externalActionId: 'someone-else', reviewAnswer: 'GREEN', actor: ACTOR });
    expect(out).toBeNull();
    expect(d.eventEmitter.emit).not.toHaveBeenCalled();
  });
});
