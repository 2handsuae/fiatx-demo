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
  };

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

    expect(primeSubmitSpy).toHaveBeenCalledWith('DEPT1', 'T1');
    expect(ingestionService.ingest).toHaveBeenCalledTimes(2);
    expect(ingestionService.ingest).toHaveBeenNthCalledWith(
      1,
      { type: 'applicantKytTxnCreated', kytTxnId: 'T1' },
      { isSimulated: true },
    );
    expect(ingestionService.ingest).toHaveBeenNthCalledWith(
      2,
      { type: 'applicantKytTxnApproved', kytTxnId: 'T1' },
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
      stepsFed: 2,
    });
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
});
