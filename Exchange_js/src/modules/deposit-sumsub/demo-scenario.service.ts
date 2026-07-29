import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DepositTransactionsService } from '../trading/deposit-transactions/deposit-transactions.service';
import { DepositSlaService } from './deposit-sla.service';
import { SUMSUB_TXN_CLIENT, SumsubTxnClient } from './sumsub-txn-client.interface';
import { MockSumsubTxnClient } from './sumsub-txn-client.mock';
import { DEPOSIT_SCENARIOS } from './fixtures/scenarios';
import { SumsubIngestionService } from '../sumsub-ingestion/sumsub-ingestion.service';
import { AuditLogsService } from '../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes } from '../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../audit-logging/dto/audit-log.dto';

export interface DemoScenarioActor {
  actorId: string;
  actorNo?: string;
  actorRole?: string;
}

/**
 * Task 6(计划1 甲方案):demo-only 场景喂料。把 test/helpers/deposit-scenario-runner.ts
 * 的喂法搬进 src(controller 不能 import test/ 目录),驱动**真实** ingestionService.ingest()
 * 走完整的前置分流→router→handler→workflow 链路,不碰 fixture/workflow/handler 本身逻辑。
 *
 * 只在 SUMSUB_MOCK_MODE=true 时才会被实际使用 —— AdminDepositDemoController 只在该模式下
 * 才被注册(deposit-sumsub.module.ts),所以这里注入到的 SUMSUB_TXN_CLIENT 理应总是
 * MockSumsubTxnClient;仍做一次 instanceof 兜底,防止误配置下的静默错误。
 */
@Injectable()
export class DepositDemoScenarioService {
  constructor(
    private readonly depositService: DepositTransactionsService,
    private readonly slaService: DepositSlaService,
    private readonly ingestionService: SumsubIngestionService,
    private readonly auditLogsService: AuditLogsService,
    @Inject(SUMSUB_TXN_CLIENT) private readonly sumsubTxnClient: SumsubTxnClient,
  ) {}

  async runScenario(depositId: string, scenarioKey: string, actor: DemoScenarioActor) {
    const scenario = DEPOSIT_SCENARIOS[scenarioKey];
    if (!scenario) {
      throw new BadRequestException(
        `Unknown scenario "${scenarioKey}". Valid keys: ${Object.keys(DEPOSIT_SCENARIOS).join(', ')}`,
      );
    }

    if (!(this.sumsubTxnClient instanceof MockSumsubTxnClient)) {
      throw new BadRequestException(
        'Demo scenario runner requires SUMSUB_MOCK_MODE=true (SUMSUB_TXN_CLIENT is not the mock client)',
      );
    }
    const mockClient = this.sumsubTxnClient;

    const deposit = await this.depositService.findOne(depositId);

    mockClient.primeSubmit(deposit.depositNo, scenario.submit.financeTxnId);
    if (scenario.submit.travelRuleTxnId) {
      mockClient.primeSubmit(`${deposit.depositNo}-TR`, scenario.submit.travelRuleTxnId);
    }

    let stepsFed = 0;
    for (const step of scenario.steps) {
      if (step.primeTxn) {
        mockClient.primeTxn(step.primeTxn.txnId, step.primeTxn.detail);
      }

      if (step.webhook) {
        await this.ingestionService.ingest(
          { type: step.webhook.type, kytTxnId: step.webhook.kytTxnId },
          { isSimulated: true },
        );
        stepsFed += 1;
      }

      if (step.needsSlaTimer) {
        const pastDeadline = new Date(Date.now() - 24 * 60 * 60 * 1000);
        await this.depositService.setSlaDeadline(deposit.id, pastDeadline);
        await this.slaService.checkSlaBreaches();
        stepsFed += 1;
      }
    }

    const refreshed = await this.depositService.findOne(deposit.id);

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.DEPOSIT_DEMO_SCENARIO_RUN,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: deposit.id,
        entityNo: deposit.depositNo,
        entityOwnerType: deposit.ownerType,
        entityOwnerId: deposit.ownerId,
        traceId: deposit.traceId || undefined,
        workflowType: 'DEPOSIT',
        result: AuditResult.SUCCESS,
        reason: `Demo scenario ${scenario.key} fed into deposit ${deposit.depositNo}`,
        metadata: {
          scenario: scenario.key,
          expectedFinalStatus: scenario.expectedFinalStatus,
          actualStatus: refreshed.status,
          stepsFed,
        },
        requestId: `DEPOSIT_DEMO_SCENARIO_RUN_${deposit.depositNo}_${randomUUID()}`,
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorId: actor.actorId,
        actorNo: actor.actorNo,
        actorRole: actor.actorRole || 'ADMIN',
      },
    );

    return {
      scenario: scenario.key,
      description: scenario.description,
      depositId: deposit.id,
      depositNo: deposit.depositNo,
      expectedFinalStatus: scenario.expectedFinalStatus,
      actualStatus: refreshed.status,
      stepsFed,
    };
  }
}
