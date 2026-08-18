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
  // 保留」审计——非 SWAP 域 / 未硬线的行内部 no-op，这里只需要一个可断言调用的桩。
  const swapApplicantActionHandler = { noteHardLineHeld: jest.fn().mockResolvedValue(undefined) } as any;
  return { prisma, requests, restrictions, restrictionWorkflow, eventEmitter, swapApplicantActionHandler };
}

const build = (d: ReturnType<typeof deps>) =>
  new MaterialRequestReviewService(
    d.prisma, d.requests, d.restrictions, d.restrictionWorkflow, d.eventEmitter, d.swapApplicantActionHandler,
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

  // ── Task 10：GREEN 落地后回调兑换域，让它记「被硬线客户 GREEN 到过、限制仍
  // ── 被刻意保留」那条审计——非兑换域 / 未硬线的行由 handler 自己 no-op，这里
  // ── 只需要证明「GREEN 才回调，RETRY/REJECTED 不回调」这条边界。
  it('GREEN → 回调 swapApplicantActionHandler.noteHardLineHeld(requestNo)', async () => {
    const d = deps();
    await build(d).applyReview({ externalActionId: 'ext-1', reviewAnswer: 'GREEN', actor: ACTOR });
    expect(d.swapApplicantActionHandler.noteHardLineHeld).toHaveBeenCalledWith('MRQ2608170001');
  });

  it('RED（RETRY 或 FINAL）→ 不回调 noteHardLineHeld（没 GREEN 过，没什么可记的）', async () => {
    const d = deps();
    await build(d).applyReview({
      externalActionId: 'ext-1', reviewAnswer: 'RED', reviewRejectType: 'RETRY', actor: ACTOR,
    });
    expect(d.swapApplicantActionHandler.noteHardLineHeld).not.toHaveBeenCalled();

    const d2 = deps();
    await build(d2).applyReview({
      externalActionId: 'ext-1', reviewAnswer: 'RED', reviewRejectType: 'FINAL', actor: ACTOR,
    });
    expect(d2.swapApplicantActionHandler.noteHardLineHeld).not.toHaveBeenCalled();
  });

  it('回调发生在事务提交之后（noteHardLineHeld 自己另起一次非事务读写，不能塞进上面的 $transaction）', async () => {
    const d = deps();
    await build(d).applyReview({ externalActionId: 'ext-1', reviewAnswer: 'GREEN', actor: ACTOR });
    const txCallOrder = d.prisma.$transaction.mock.invocationCallOrder[0];
    const noteOrder = d.swapApplicantActionHandler.noteHardLineHeld.mock.invocationCallOrder[0];
    expect(noteOrder).toBeGreaterThan(txCallOrder);
  });
});
