import { BadRequestException } from '@nestjs/common';
import { WithdrawDemoScenarioService } from './demo-scenario.service';
import { MockSumsubTxnClient } from '../sumsub-shared/sumsub-txn-client.mock';
import { HttpSumsubTxnClient } from '../sumsub-shared/sumsub-txn-client.http';
import { AuditActions } from '../audit-logging/constants/audit-actions.constant';

describe('WithdrawDemoScenarioService', () => {
  let withdrawService: { findOneInternal: jest.Mock };
  let ingestionService: { ingest: jest.Mock };
  let auditLogsService: { recordByActor: jest.Mock };
  let mockClient: MockSumsubTxnClient;

  const withdraw = {
    id: 'withdraw-1',
    withdrawNo: 'WD001',
    ownerType: 'CUSTOMER',
    ownerId: 'cust-1',
    traceId: 'trace-1',
    status: 'COMPLIANCE_PENDING',
    amount: '500',
    createdAt: new Date('2026-07-29T18:23:16.426Z'),
    customer: { sumsubApplicantId: '68a1f3c47b2e9d0154cc81ab', customerNo: 'CU2601019430' },
    asset: { type: 'FIAT', currency: 'AED' },
    sumsubTxnType: 'finance',
  };

  /** 24 位小写 hex(Sumsub ObjectId 形态)—— 断言形态而非硬编码具体号 */
  const OBJECT_ID = /^[0-9a-f]{24}$/;

  const actor = { actorId: 'admin-1', actorNo: 'AD1', actorRole: 'OPS_OFFICER' };

  beforeEach(() => {
    withdrawService = {
      findOneInternal: jest.fn().mockResolvedValue(withdraw),
    };
    ingestionService = { ingest: jest.fn().mockResolvedValue({ event: {} }) };
    auditLogsService = { recordByActor: jest.fn().mockResolvedValue(undefined) };
    mockClient = new MockSumsubTxnClient();
  });

  function buildService(client: unknown = mockClient) {
    return new WithdrawDemoScenarioService(
      withdrawService as any,
      ingestionService as any,
      auditLogsService as any,
      client as any,
    );
  }

  it('rejects an unknown verdict key', async () => {
    const service = buildService();
    await expect(service.runVerdict('withdraw-1', 'NOT_A_VERDICT', actor)).rejects.toThrow(
      BadRequestException,
    );
    expect(withdrawService.findOneInternal).not.toHaveBeenCalled();
  });

  it('rejects when SUMSUB_TXN_CLIENT is not the mock client (SUMSUB_MOCK_MODE off)', async () => {
    const service = buildService(new HttpSumsubTxnClient());
    await expect(service.runVerdict('withdraw-1', 'V1_APPROVED', actor)).rejects.toThrow(
      'requires SUMSUB_MOCK_MODE=true',
    );
  });

  it('V1_APPROVED: primes submit + txn, feeds one webhook, and audits the run', async () => {
    withdrawService.findOneInternal
      .mockResolvedValueOnce(withdraw)
      .mockResolvedValueOnce({ ...withdraw, status: 'PAYOUT_PENDING' });
    const primeSubmitSpy = jest.spyOn(mockClient, 'primeSubmit');
    const primeTxnSpy = jest.spyOn(mockClient, 'primeTxn');
    const service = buildService();

    const result = await service.runVerdict('withdraw-1', 'V1_APPROVED', actor);

    // 该单尚未提交(withdraw.sumsubTxnId 为空)—— 现铸的必须是真实形态 txnId,
    // 不是按钮 key 字面量。
    expect(primeSubmitSpy).toHaveBeenCalledWith('WD001', expect.stringMatching(OBJECT_ID));
    const mintedTxnId = primeSubmitSpy.mock.calls[0][1];

    expect(primeTxnSpy).toHaveBeenCalledWith(
      mintedTxnId,
      expect.objectContaining({ txnId: mintedTxnId, verdict: 'approved' }),
    );

    expect(ingestionService.ingest).toHaveBeenCalledTimes(1);
    expect(ingestionService.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'applicantKytTxnApproved',
        kytTxnId: mintedTxnId,
        applicantId: '68a1f3c47b2e9d0154cc81ab',
        externalUserId: 'CU2601019430',
      }),
      { isSimulated: true },
    );

    expect(auditLogsService.recordByActor).toHaveBeenCalledTimes(1);
    const [eventArg, actorArg] = auditLogsService.recordByActor.mock.calls[0];
    expect(eventArg.action).toBe(AuditActions.WITHDRAW_DEMO_SCENARIO_RUN);
    expect(eventArg.primarySubjectNo).toBe('WD001');
    expect(eventArg.metadata).toMatchObject({
      verdict: 'V1_APPROVED',
      webhookType: 'applicantKytTxnApproved',
      txnType: 'finance',
      statusBefore: 'COMPLIANCE_PENDING',
      statusAfter: 'PAYOUT_PENDING',
    });
    expect(actorArg).toMatchObject({ actorType: 'ADMIN', actorNo: 'AD1' });

    expect(result).toEqual({
      verdict: 'V1_APPROVED',
      label: expect.any(String),
      withdrawId: 'withdraw-1',
      withdrawNo: 'WD001',
      txnType: 'finance',
      statusBefore: 'COMPLIANCE_PENDING',
      statusAfter: 'PAYOUT_PENDING',
    });
  });

  it('已提交的单:复用该单自己的 txnId,不铸新号(否则 webhook 全成孤儿)', async () => {
    withdrawService.findOneInternal.mockResolvedValue({
      ...withdraw,
      sumsubTxnId: '68c0aa11bb22cc33dd44ee55',
    });
    const service = buildService();
    const primeSubmitSpy = jest.spyOn(mockClient, 'primeSubmit');

    await service.runVerdict('withdraw-1', 'V8_REJECTED_SANCTION_COUNTERPARTY', actor);

    expect(primeSubmitSpy).not.toHaveBeenCalled();
    expect(ingestionService.ingest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kytTxnId: '68c0aa11bb22cc33dd44ee55' }),
      { isSimulated: true },
    );
  });

  it('V10_REJECTED_DISPOSITION: 处置 tag 是 FINAL_REJECTED(提现独有,非充值的 RETURN_TO_SENDER)', async () => {
    const service = buildService();

    await service.runVerdict('withdraw-1', 'V10_REJECTED_DISPOSITION', actor);

    expect(ingestionService.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'applicantKytTxnRejected' }),
      { isSimulated: true },
    );
  });

  it('V6_ONHOLD: webhookType 是 applicantKytOnHold(官方无 Txn 命名)', async () => {
    const service = buildService();

    await service.runVerdict('withdraw-1', 'V6_ONHOLD', actor);

    expect(ingestionService.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'applicantKytOnHold' }),
      { isSimulated: true },
    );
  });

  it('铸出的 txnId 跨单绝不重号(2026-07-29 撞号事故的回归防线)', async () => {
    const service = buildService();
    const primeSubmitSpy = jest.spyOn(mockClient, 'primeSubmit');

    await service.runVerdict('withdraw-1', 'V8_REJECTED_SANCTION_COUNTERPARTY', actor);

    withdrawService.findOneInternal.mockResolvedValue({
      ...withdraw,
      id: 'withdraw-2',
      withdrawNo: 'WD002',
    });
    await service.runVerdict('withdraw-2', 'V8_REJECTED_SANCTION_COUNTERPARTY', actor);

    const [firstId, secondId] = primeSubmitSpy.mock.calls.map((c) => c[1]);
    expect(firstId).toMatch(OBJECT_ID);
    expect(secondId).toMatch(OBJECT_ID);
    expect(firstId).not.toBe(secondId);
  });

  it('同单同按钮重放铸出同一个 txnId(幂等)', async () => {
    const service = buildService();
    const primeSubmitSpy = jest.spyOn(mockClient, 'primeSubmit');

    await service.runVerdict('withdraw-1', 'V8_REJECTED_SANCTION_COUNTERPARTY', actor);
    await service.runVerdict('withdraw-1', 'V8_REJECTED_SANCTION_COUNTERPARTY', actor);

    const [firstId, secondId] = primeSubmitSpy.mock.calls.map((c) => c[1]);
    expect(firstId).toBe(secondId);
  });
});
