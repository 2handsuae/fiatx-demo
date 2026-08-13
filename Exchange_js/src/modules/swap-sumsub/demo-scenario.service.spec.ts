import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SwapDemoScenarioService } from './demo-scenario.service';
import { MockSumsubTxnClient } from '../deposit-sumsub/sumsub-txn-client.mock';
import { HttpSumsubTxnClient } from '../deposit-sumsub/sumsub-txn-client.http';
import { AuditActions } from '../audit-logging/constants/audit-actions.constant';

describe('SwapDemoScenarioService', () => {
  let swapService: { findByIdInternal: jest.Mock };
  let ingestionService: { ingest: jest.Mock };
  let auditLogsService: { recordByActor: jest.Mock };
  let mockClient: MockSumsubTxnClient;

  const swap = {
    id: 'swap-1',
    swapNo: 'SWP001',
    ownerType: 'CUSTOMER',
    ownerId: 'cust-1',
    traceId: 'trace-1',
    status: 'COMPLIANCE_PENDING',
    fromAmount: '500',
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    customer: {
      sumsubApplicantId: '68a1f3c47b2e9d0154cc81ab',
      customerNo: 'CU2601019430',
      pendingActionExternalId: null,
    },
    fromAsset: { type: 'FIAT', currency: 'AED' },
    sumsubTxnIdOut: null,
  };

  /** 24 位小写 hex(Sumsub ObjectId 形态)—— 断言形态而非硬编码具体号 */
  const OBJECT_ID = /^[0-9a-f]{24}$/;

  const actor = { actorId: 'admin-1', actorNo: 'AD1', actorRole: 'OPS_OFFICER' };

  beforeEach(() => {
    swapService = {
      findByIdInternal: jest.fn().mockResolvedValue(swap),
    };
    ingestionService = { ingest: jest.fn().mockResolvedValue({ event: {} }) };
    auditLogsService = { recordByActor: jest.fn().mockResolvedValue(undefined) };
    mockClient = new MockSumsubTxnClient();
  });

  function buildService(client: unknown = mockClient) {
    return new SwapDemoScenarioService(
      swapService as any,
      ingestionService as any,
      auditLogsService as any,
      client as any,
    );
  }

  it('rejects an unknown verdict key and lists the valid keys', async () => {
    const service = buildService();
    await expect(service.runVerdict('s1', 'NOPE', actor)).rejects.toThrow(/Valid keys/);
    expect(swapService.findByIdInternal).not.toHaveBeenCalled();
  });

  it('rejects when SUMSUB_TXN_CLIENT is not the mock client (SUMSUB_MOCK_MODE off)', async () => {
    const service = buildService(new HttpSumsubTxnClient());
    await expect(service.runVerdict('s1', 'V1_APPROVED', actor)).rejects.toThrow(
      /SUMSUB_MOCK_MODE/,
    );
  });

  it('throws NotFoundException when the swap does not exist', async () => {
    swapService.findByIdInternal.mockResolvedValue(null);
    const service = buildService();
    await expect(service.runVerdict('missing', 'V1_APPROVED', actor)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('V2_REJECTED_HARD: feeds applicantKytTxnRejected with zero applicantActions and audits the run', async () => {
    swapService.findByIdInternal
      .mockResolvedValueOnce(swap)
      .mockResolvedValueOnce({ ...swap, status: 'REJECTED' });
    const service = buildService();

    const result = await service.runVerdict('swap-1', 'V2_REJECTED_HARD', actor);

    expect(ingestionService.ingest).toHaveBeenCalledTimes(1);
    expect(ingestionService.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'applicantKytTxnRejected',
        applicantId: '68a1f3c47b2e9d0154cc81ab',
        externalUserId: 'CU2601019430',
      }),
      { isSimulated: true },
    );

    expect(auditLogsService.recordByActor).toHaveBeenCalledTimes(1);
    const [eventArg, actorArg] = auditLogsService.recordByActor.mock.calls[0];
    expect(eventArg.action).toBe(AuditActions.SWAP_DEMO_SCENARIO_RUN);
    expect(eventArg.entityId).toBe('swap-1');
    expect(eventArg.metadata).toMatchObject({
      verdict: 'V2_REJECTED_HARD',
      webhookType: 'applicantKytTxnRejected',
      statusBefore: 'COMPLIANCE_PENDING',
      statusAfter: 'REJECTED',
    });
    expect(actorArg).toMatchObject({ actorType: 'ADMIN', actorId: 'admin-1' });

    expect(result).toEqual({
      verdict: 'V2_REJECTED_HARD',
      label: expect.any(String),
      swapId: 'swap-1',
      swapNo: 'SWP001',
      statusBefore: 'COMPLIANCE_PENDING',
      statusAfter: 'REJECTED',
    });
  });

  it('V1_APPROVED: 该单已过同步提交(sumsubTxnIdOut 有值)——复用真号,不铸新号也不 primeSubmit', async () => {
    const submitted = { ...swap, sumsubTxnIdOut: '68c0aa11bb22cc33dd44ee55' };
    swapService.findByIdInternal.mockResolvedValue(submitted);
    const primeSubmitSpy = jest.spyOn(mockClient, 'primeSubmit');
    const primeTxnSpy = jest.spyOn(mockClient, 'primeTxn');
    const service = buildService();

    await service.runVerdict('swap-1', 'V1_APPROVED', actor);

    expect(primeSubmitSpy).not.toHaveBeenCalled();
    expect(primeTxnSpy).toHaveBeenCalledWith(
      '68c0aa11bb22cc33dd44ee55',
      expect.objectContaining({ txnId: '68c0aa11bb22cc33dd44ee55', verdict: 'approved' }),
    );
    expect(ingestionService.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'applicantKytTxnApproved', kytTxnId: '68c0aa11bb22cc33dd44ee55' }),
      { isSimulated: true },
    );
  });

  it('未提交的单(sumsubTxnIdOut 为空):现铸真实形态 txnId 并 primeSubmit', async () => {
    const primeSubmitSpy = jest.spyOn(mockClient, 'primeSubmit');
    const service = buildService();

    await service.runVerdict('swap-1', 'V4_REJECTED_SANCTION', actor);

    expect(primeSubmitSpy).toHaveBeenCalledWith('SWP001-OUT', expect.stringMatching(OBJECT_ID));
    const mintedTxnId = primeSubmitSpy.mock.calls[0][1];
    expect(ingestionService.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ kytTxnId: mintedTxnId, type: 'applicantKytTxnRejected' }),
      { isSimulated: true },
    );
  });

  it('V5_ONHOLD: webhookType 是 applicantKytOnHold(官方无 Txn 命名)', async () => {
    const service = buildService();

    await service.runVerdict('swap-1', 'V5_ONHOLD', actor);

    expect(ingestionService.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'applicantKytOnHold' }),
      { isSimulated: true },
    );
  });

  it('V6_AWAIT_USER: webhookType 是 applicantKytTxnAwaitingUser', async () => {
    const service = buildService();

    await service.runVerdict('swap-1', 'V6_AWAIT_USER', actor);

    expect(ingestionService.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'applicantKytTxnAwaitingUser' }),
      { isSimulated: true },
    );
  });

  it('铸出的 txnId 跨单绝不重号(2026-07-29 撞号事故的回归防线)', async () => {
    const primeSubmitSpy = jest.spyOn(mockClient, 'primeSubmit');
    const service = buildService();

    await service.runVerdict('swap-1', 'V4_REJECTED_SANCTION', actor);

    swapService.findByIdInternal.mockResolvedValue({ ...swap, id: 'swap-2', swapNo: 'SWP002' });
    await service.runVerdict('swap-2', 'V4_REJECTED_SANCTION', actor);

    const [firstId, secondId] = primeSubmitSpy.mock.calls.map((c) => c[1]);
    expect(firstId).toMatch(OBJECT_ID);
    expect(secondId).toMatch(OBJECT_ID);
    expect(firstId).not.toBe(secondId);
  });

  it('同单同按钮重放铸出同一个 txnId(幂等)', async () => {
    const primeSubmitSpy = jest.spyOn(mockClient, 'primeSubmit');
    const service = buildService();

    await service.runVerdict('swap-1', 'V4_REJECTED_SANCTION', actor);
    await service.runVerdict('swap-1', 'V4_REJECTED_SANCTION', actor);

    const [firstId, secondId] = primeSubmitSpy.mock.calls.map((c) => c[1]);
    expect(firstId).toBe(secondId);
  });

  describe('V7/V8: applicantActionReviewed (person-level — closes the loop as of Task 13)', () => {
    it('V7_ACTION_GREEN: feeds applicantActionReviewed for real via ingest(), does NOT prime any KYT txn, and swap status is untouched (this event acts on the customer, not the swap)', async () => {
      const primeTxnSpy = jest.spyOn(mockClient, 'primeTxn');
      const primeSubmitSpy = jest.spyOn(mockClient, 'primeSubmit');
      // swap 已终态(REJECTED)——applicantActionReviewed 作用于人,不作用于这笔单。
      swapService.findByIdInternal.mockResolvedValue({ ...swap, status: 'REJECTED' });
      const service = buildService();

      const result = await service.runVerdict('swap-1', 'V7_ACTION_GREEN', actor);

      expect(primeTxnSpy).not.toHaveBeenCalled();
      expect(primeSubmitSpy).not.toHaveBeenCalled();
      expect(ingestionService.ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'applicantActionReviewed',
          applicantId: '68a1f3c47b2e9d0154cc81ab',
          reviewResult: { reviewAnswer: 'GREEN' },
        }),
        { isSimulated: true },
      );
      // applicantActionReviewed 清的是客户的 restrictions,不是这笔 swap 单的
      // 状态 —— statusBefore===statusAfter 是这条链路的正确行为,不是缺口。
      // (真正的"清限制生效"由 applicant-action.handler.spec.ts 覆盖,这里的
      // ingestionService 是 mock,不走真实的 SwapApplicantActionHandler。)
      expect(result.statusBefore).toBe('REJECTED');
      expect(result.statusAfter).toBe('REJECTED');
    });

    it('V8_ACTION_RED: reviewResult carries RED', async () => {
      swapService.findByIdInternal.mockResolvedValue({ ...swap, status: 'REJECTED' });
      const service = buildService();

      await service.runVerdict('swap-1', 'V8_ACTION_RED', actor);

      expect(ingestionService.ingest).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'applicantActionReviewed', reviewResult: { reviewAnswer: 'RED' } }),
        { isSimulated: true },
      );
    });

    it('uses the customer\'s pending action id when one is on file (left by an earlier soft-line rejection) — sent as externalActionId, the field SwapApplicantActionHandler claims by', async () => {
      swapService.findByIdInternal.mockResolvedValue({
        ...swap,
        status: 'REJECTED',
        customer: { ...swap.customer, pendingActionExternalId: 'demo-ext-1' },
      });
      const service = buildService();

      await service.runVerdict('swap-1', 'V7_ACTION_GREEN', actor);

      expect(ingestionService.ingest).toHaveBeenCalledWith(
        expect.objectContaining({ externalActionId: 'demo-ext-1' }),
        { isSimulated: true },
      );
    });
  });
});
