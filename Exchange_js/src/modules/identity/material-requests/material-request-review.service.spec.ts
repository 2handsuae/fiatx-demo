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
  const prisma = { $transaction: jest.fn((cb: any) => cb({ __tx: true })) } as any;
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
  // Task 10: GREEN 落地后回调兑换域的「被硬线客户 GREEN 到过、限制仍被刻意
  return { prisma, requests, restrictions, restrictionWorkflow, eventEmitter };
}

const build = (d: ReturnType<typeof deps>) =>
  new MaterialRequestReviewService(
    d.prisma, d.requests, d.restrictions, d.restrictionWorkflow, d.eventEmitter,
  );

describe('MaterialRequestReviewService.applyReview', () => {
  it('GREEN → APPROVED 且自动撕便签（caseRef 用 requestNo，releaseMode 由 autoRelease 定为 AUTO）', async () => {
    const d = deps();
    const out = await build(d).applyReview({ externalActionId: 'ext-1', reviewAnswer: 'GREEN', actor: ACTOR });
    expect(out).toEqual({ requestNo: 'MRQ2608170001', outcome: 'APPROVED' });
    // Task 4：applyReview 现在把落章与自动撕便签包进同一个事务，autoRelease 因此
    // 多收到一个末位 tx（事务体内的 client），不再是 undefined。
    expect(d.restrictionWorkflow.autoRelease).toHaveBeenCalledWith(
      'c1', 'PENDING_DOCUMENT', 'MRQ2608170001', 'SYSTEM', { __tx: true },
    );
  });

  it('便签的 caseRef 不等于 requestNo 时（兑换域用 swapNo），按便签自己的 caseRef 撕', async () => {
    const d = deps();
    d.restrictions.findByNo.mockResolvedValue({
      restrictionNo: 'RST2608170001', cause: 'KYT_REJECTED_SOFT', caseRef: 'SW2608170001',
    });
    await build(d).applyReview({ externalActionId: 'ext-1', reviewAnswer: 'GREEN', actor: ACTOR });
    expect(d.restrictionWorkflow.autoRelease).toHaveBeenCalledWith(
      'c1', 'KYT_REJECTED_SOFT', 'SW2608170001', 'SYSTEM', { __tx: true },
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

  it('落章与自动撕便签同处一个事务（半成品——单落了 APPROVED、便签还卡在 OPEN——是运营发现不了的脏数据）', async () => {
    const d = deps();
    await build(d).applyReview({ externalActionId: 'ext-1', reviewAnswer: 'GREEN', actor: ACTOR });
    expect(d.prisma.$transaction).toHaveBeenCalledTimes(1);
    // 光断言 $transaction 被调用一次测不出「撕便签是不是真在这个事务里跑」——
    // autoRelease 收到的 tx 必须与 markReviewed 收到的是同一个引用，否则撕便签
    // 实际是在一个独立的第二事务里提交的（本条曾是假阳性，同款坑见 issuer spec）。
    const txPassedToMarkReviewed = d.requests.markReviewed.mock.calls[0][4];
    const txPassedToAutoRelease = d.restrictionWorkflow.autoRelease.mock.calls[0][4];
    expect(txPassedToMarkReviewed).toBeDefined();
    expect(txPassedToAutoRelease).toBe(txPassedToMarkReviewed);
  });

  it('事件广播在事务提交之后才发生（回滚了的话，事件早发出去就是在广播一个从未发生过的事实）', async () => {
    const d = deps();
    await build(d).applyReview({ externalActionId: 'ext-1', reviewAnswer: 'GREEN', actor: ACTOR });
    const txCallOrder = d.prisma.$transaction.mock.invocationCallOrder[0];
    const emitCallOrder = d.eventEmitter.emit.mock.invocationCallOrder[0];
    expect(emitCallOrder).toBeGreaterThan(txCallOrder);
  });

  // 站3-α2：原「GREEN 直调 swapApplicantActionHandler.noteHardLineHeld」已事件化，
  // 四条钉直调行为的用例随之搬家：GREEN/RED 边界与「旁路审计失败不阻断」现由
  // applicant-action.handler.spec.ts 的 onMaterialRequestReviewed 用例钉住；
  // 「回调在事务后」由事件本身的广播位置（事务提交后）结构性保证，无需再钉。
});
