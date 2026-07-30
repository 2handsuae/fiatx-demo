import { BadRequestException } from '@nestjs/common';
import { DepositDemoScenarioService } from './demo-scenario.service';
import { MockSumsubTxnClient } from './sumsub-txn-client.mock';
import { HttpSumsubTxnClient } from './sumsub-txn-client.http';
import { AuditActions } from '../audit-logging/constants/audit-actions.constant';

describe('DepositDemoScenarioService', () => {
  let depositService: { findOne: jest.Mock; setSlaDeadline: jest.Mock };
  let slaService: { checkSlaBreaches: jest.Mock };
  let ingestionService: { ingest: jest.Mock };
  let auditLogsService: { recordByActor: jest.Mock };
  let mockClient: MockSumsubTxnClient;

  const deposit = {
    id: 'deposit-1',
    depositNo: 'DEPT1',
    ownerType: 'CUSTOMER',
    ownerId: 'cust-1',
    traceId: 'trace-1',
    status: 'COMPLIANCE_PENDING',
    createdAt: new Date('2026-07-29T18:23:16.426Z'),
    customer: { sumsubApplicantId: '68a1f3c47b2e9d0154cc81ab', customerNo: 'CU2601019430' },
  };

  /** 24 位小写 hex(Sumsub ObjectId 形态)—— 断言形态而非硬编码具体号 */
  const OBJECT_ID = /^[0-9a-f]{24}$/;

  const actor = { actorId: 'admin-1', actorNo: 'AD1', actorRole: 'OPS_OFFICER' };

  beforeEach(() => {
    depositService = {
      findOne: jest.fn().mockResolvedValue(deposit),
      setSlaDeadline: jest.fn().mockResolvedValue(undefined),
    };
    slaService = { checkSlaBreaches: jest.fn().mockResolvedValue(undefined) };
    ingestionService = { ingest: jest.fn().mockResolvedValue({ event: {} }) };
    auditLogsService = { recordByActor: jest.fn().mockResolvedValue(undefined) };
    mockClient = new MockSumsubTxnClient();
  });

  function buildService(client: unknown = mockClient) {
    return new DepositDemoScenarioService(
      depositService as any,
      slaService as any,
      ingestionService as any,
      auditLogsService as any,
      client as any,
    );
  }

  it('rejects an unknown scenario key', async () => {
    const service = buildService();
    await expect(service.runScenario('deposit-1', 'NOT_A_SCENARIO', actor)).rejects.toThrow(
      BadRequestException,
    );
    expect(depositService.findOne).not.toHaveBeenCalled();
  });

  it('rejects when SUMSUB_TXN_CLIENT is not the mock client (SUMSUB_MOCK_MODE off)', async () => {
    const service = buildService(new HttpSumsubTxnClient());
    await expect(service.runScenario('deposit-1', 'S1_HAPPY_FIAT', actor)).rejects.toThrow(
      'requires SUMSUB_MOCK_MODE=true',
    );
  });

  it('S1_HAPPY_FIAT: primes submit, feeds both webhook steps, and audits the run', async () => {
    depositService.findOne
      .mockResolvedValueOnce(deposit)
      .mockResolvedValueOnce({ ...deposit, status: 'SUCCESS' });
    const primeSubmitSpy = jest.spyOn(mockClient, 'primeSubmit');
    const service = buildService();

    const result = await service.runScenario('deposit-1', 'S1_HAPPY_FIAT', actor);

    // fixture 里的 'T1' 只是槽位名 —— 实际喂进去的必须是现铸的真实形态 txnId
    expect(primeSubmitSpy).toHaveBeenCalledWith('DEPT1', expect.stringMatching(OBJECT_ID));
    const mintedTxnId = primeSubmitSpy.mock.calls[0][1];
    expect(mintedTxnId).not.toBe('T1');

    expect(ingestionService.ingest).toHaveBeenCalledTimes(2);
    expect(ingestionService.ingest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'applicantKytTxnCreated',
        kytTxnId: mintedTxnId,
        applicantId: '68a1f3c47b2e9d0154cc81ab',
        externalUserId: 'CU2601019430',
      }),
      { isSimulated: true },
    );
    expect(ingestionService.ingest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: 'applicantKytTxnApproved', kytTxnId: mintedTxnId }),
      { isSimulated: true },
    );

    expect(auditLogsService.recordByActor).toHaveBeenCalledTimes(1);
    const [eventArg, actorArg] = auditLogsService.recordByActor.mock.calls[0];
    expect(eventArg.action).toBe(AuditActions.DEPOSIT_DEMO_SCENARIO_RUN);
    expect(eventArg.entityId).toBe('deposit-1');
    expect(eventArg.metadata).toMatchObject({
      scenario: 'S1_HAPPY_FIAT',
      expectedFinalStatus: 'SUCCESS',
      actualStatus: 'SUCCESS',
      stepsFed: 2,
    });
    expect(actorArg).toMatchObject({ actorType: 'ADMIN', actorId: 'admin-1' });

    expect(result).toEqual({
      scenario: 'S1_HAPPY_FIAT',
      description: expect.any(String),
      depositId: 'deposit-1',
      depositNo: 'DEPT1',
      expectedFinalStatus: 'SUCCESS',
      actualStatus: 'SUCCESS',
      matchedExpectation: true,
      stepsFed: 2,
    });
  });

  it('S3_SANCTIONS: primeTxn 喂料时,raw.id 被同步成实际铸出的 txnId,而非 fixture 槽位名', async () => {
    // demo-scenario.service.ts:93-102 —— fixture 的 raw 报文自带一个 `id` 字段(真 Sumsub
    // getTxn 形态),值是槽位名(如 'T3')而非现铸的真实 txnId;runner 必须把它同步成
    // mintedId,否则详情页折叠原文里的号和 Sumsub References 卡片上的号对不上。
    const service = buildService();
    const primeTxnSpy = jest.spyOn(mockClient, 'primeTxn');

    await service.runScenario('deposit-1', 'S3_SANCTIONS', actor);

    expect(primeTxnSpy).toHaveBeenCalledTimes(1);
    const [mintedId, detail] = primeTxnSpy.mock.calls[0];
    expect(mintedId).toMatch(OBJECT_ID);
    expect(mintedId).not.toBe('T3');
    expect(detail.txnId).toBe(mintedId);
    expect((detail.raw as Record<string, unknown>).id).toBe(mintedId);
    expect((detail.raw as Record<string, unknown>).id).not.toBe('T3');
  });

  it('已过 Gate 0 的单:复用该单自己的 txnId,不铸新号(否则 webhook 全成孤儿)', async () => {
    depositService.findOne.mockResolvedValue({
      ...deposit,
      sumsubTxnId: '68c0aa11bb22cc33dd44ee55',
    });
    const service = buildService();
    const primeSubmitSpy = jest.spyOn(mockClient, 'primeSubmit');

    await service.runScenario('deposit-1', 'S3_SANCTIONS', actor);

    expect(primeSubmitSpy).toHaveBeenCalledWith('DEPT1', '68c0aa11bb22cc33dd44ee55');
    expect(ingestionService.ingest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kytTxnId: '68c0aa11bb22cc33dd44ee55' }),
      { isSimulated: true },
    );
  });

  it('喂完没走到预期终态 → matchedExpectation=false(别把空转当成功)', async () => {
    // findOne 恒返回 COMPLIANCE_PENDING,即 webhook 没驱动任何东西
    const service = buildService();

    const result = await service.runScenario('deposit-1', 'S3_SANCTIONS', actor);

    expect(result.expectedFinalStatus).toBe('FROZEN');
    expect(result.actualStatus).toBe('COMPLIANCE_PENDING');
    expect(result.matchedExpectation).toBe(false);
  });

  it('S9_ONHOLD_SLA: drives the SLA timer step (setSlaDeadline + checkSlaBreaches)', async () => {
    const service = buildService();

    await service.runScenario('deposit-1', 'S9_ONHOLD_SLA', actor);

    expect(depositService.setSlaDeadline).toHaveBeenCalledTimes(1);
    expect(depositService.setSlaDeadline.mock.calls[0][0]).toBe('deposit-1');
    expect(slaService.checkSlaBreaches).toHaveBeenCalledTimes(1);
    // 2 webhook steps + 1 SLA-timer step
    expect(ingestionService.ingest).toHaveBeenCalledTimes(2);
  });

  it('铸出的 txnId 跨单绝不重号(2026-07-29 撞号事故的回归防线)', async () => {
    const service = buildService();
    const primeSubmitSpy = jest.spyOn(mockClient, 'primeSubmit');

    await service.runScenario('deposit-1', 'S3_SANCTIONS', actor);

    depositService.findOne.mockResolvedValue({
      ...deposit,
      id: 'deposit-2',
      depositNo: 'DEPT2',
    });
    await service.runScenario('deposit-2', 'S3_SANCTIONS', actor);

    const [firstId, secondId] = primeSubmitSpy.mock.calls.map((c) => c[1]);
    expect(firstId).toMatch(OBJECT_ID);
    expect(secondId).toMatch(OBJECT_ID);
    expect(firstId).not.toBe(secondId);
  });

  it('同单同场景重放铸出同一个 txnId(幂等)', async () => {
    const service = buildService();
    const primeSubmitSpy = jest.spyOn(mockClient, 'primeSubmit');

    await service.runScenario('deposit-1', 'S3_SANCTIONS', actor);
    await service.runScenario('deposit-1', 'S3_SANCTIONS', actor);

    const [firstId, secondId] = primeSubmitSpy.mock.calls.map((c) => c[1]);
    expect(firstId).toBe(secondId);
  });

  it('createdAt 缺失也必须铸出合法 24 位 hex,不能拼出 NaN', async () => {
    const { createdAt, ...noCreatedAt } = deposit;
    depositService.findOne.mockResolvedValue(noCreatedAt);
    const service = buildService();
    const primeSubmitSpy = jest.spyOn(mockClient, 'primeSubmit');

    await service.runScenario('deposit-1', 'S3_SANCTIONS', actor);

    expect(primeSubmitSpy.mock.calls[0][1]).toMatch(OBJECT_ID);
  });
});
