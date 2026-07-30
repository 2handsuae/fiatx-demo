import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
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
  private readonly logger = new Logger(DepositDemoScenarioService.name);

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

    // fixture 里的 T1/TF/T3 是**槽位名**,不是真 txnId。槽位 → 真 id 的解析规则:
    //
    //   该单已经过 Gate 0(库里已有真 txnId)→ **用它自己的号**;
    //   还没过 Gate 0                      → 铸一个新号并 prime,等 Gate 0 取用。
    //
    // 第一条是必须的:Gate 0 的提交对 sumsubFinanceTxnId 幂等,已提交的单不会因为
    // primeSubmit 而换号。若这里一律铸新号,喂出去的 webhook 全部是孤儿 —— handler
    // 只 warn 一行就丢掉,端点却照样返回 201 + stepsFed>0,看起来"跑成功了"而单子
    // 纹丝不动(2026-07-29 实测)。
    const slotIds = new Map<string, string>();
    slotIds.set(
      scenario.submit.financeTxnId,
      deposit.sumsubFinanceTxnId ?? this.mintTxnId(deposit, scenario.submit.financeTxnId),
    );
    if (scenario.submit.travelRuleTxnId) {
      slotIds.set(
        scenario.submit.travelRuleTxnId,
        deposit.sumsubTravelRuleTxnId ?? this.mintTxnId(deposit, scenario.submit.travelRuleTxnId),
      );
    }
    const txnIdFor = (slot: string) =>
      slotIds.get(slot) ?? this.mintTxnId(deposit, slot);

    mockClient.primeSubmit(deposit.depositNo, txnIdFor(scenario.submit.financeTxnId));
    if (scenario.submit.travelRuleTxnId) {
      mockClient.primeSubmit(
        `${deposit.depositNo}-TR`,
        txnIdFor(scenario.submit.travelRuleTxnId),
      );
    }

    let stepsFed = 0;
    for (const step of scenario.steps) {
      if (step.primeTxn) {
        const mintedId = txnIdFor(step.primeTxn.txnId);
        const { detail } = step.primeTxn;
        mockClient.primeTxn(mintedId, {
          ...detail,
          txnId: mintedId,
          // fixture 的 raw 报文自带一个 `id` 字段(真 Sumsub getTxn 形态),值是槽位名
          // (如 'T3')而非现铸的真实 txnId —— 同步成 mintedId,否则详情页折叠原文里的
          // 号和 Sumsub References 卡片上的号对不上。
          ...(detail.raw !== undefined && {
            raw: { ...(detail.raw as Record<string, unknown>), id: mintedId },
          }),
        });
      }

      if (step.webhook) {
        await this.ingestionService.ingest(
          this.buildWebhookPayload(deposit, step.webhook.type, txnIdFor(step.webhook.kytTxnId)),
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
    // 喂完了但没走到预期终态 —— 多半是 webhook 成了孤儿(txnId 对不上)。端点返回
    // 201 + stepsFed>0 会被误读成"跑成功了",所以显式标出来并打 warn。
    const matchedExpectation = refreshed.status === scenario.expectedFinalStatus;
    if (!matchedExpectation) {
      this.logger.warn(
        `Demo scenario ${scenario.key} on ${deposit.depositNo}: expected ${scenario.expectedFinalStatus} ` +
          `but deposit is ${refreshed.status} — webhooks likely orphaned (txnId mismatch), nothing was driven.`,
      );
    }

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
          matchedExpectation,
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
      matchedExpectation,
      stepsFed,
    };
  }

  /**
   * 把 fixture 的槽位名铸成一个真实形态的 Sumsub KYT txnId。
   *
   * Sumsub 的 txnId 是 24 位小写 hex(MongoDB ObjectId 形态:4 字节时间戳 + 8 字节
   * 随机/计数),不是 `T3` 这种。这里 4 字节时间戳取该 deposit 的创建时刻(报送时点
   * 就在建单之后,时间上也说得通),后 8 字节由 (depositNo, 槽位) 哈希而来。
   *
   * 三个性质缺一不可:
   *   ① **形态真实** —— 界面/日志/客服工单里贴出去和真 Sumsub 控制台对得上号;
   *   ② **同单同槽稳定** —— 同一场景重复喂是幂等重放,不会每次换号;
   *   ③ **跨单绝不重号** —— 此前 fixture 把 `T3` 当真 id 直接用,第二笔单跑同一场景时
   *      `findBySumsubTxnId('T3')` 会匹到**上一笔**单,端点照样返回 201 且事件全部
   *      PROCESSED、零报错,但驱动的是错误的单(2026-07-29 live demo 实测踩中)。
   */
  private mintTxnId(deposit: { depositNo: string; createdAt?: Date | string }, slot: string): string {
    const digest = createHash('sha1').update(`${deposit.depositNo}:${slot}`).digest('hex');
    const ms = deposit.createdAt ? new Date(deposit.createdAt).getTime() : NaN;
    // createdAt 缺失/非法时退回哈希段 —— 产出必须恒为 24 位合法 hex,
    // 否则会拼出 `00000NaN…` 这种既不像 Sumsub 也查不出东西的脏号。
    const tsHex = Number.isFinite(ms)
      ? Math.floor(ms / 1000).toString(16).padStart(8, '0').slice(-8)
      : digest.slice(16, 24);
    return `${tsHex}${digest.slice(0, 16)}`;
  }

  /**
   * 造一个字段齐全的 Sumsub webhook payload。handler 只读 type + kytTxnId,但
   * `SumsubIngestionService.ingest()` 会把 applicantId / externalUserId 落到
   * `sumsub_webhook_events` 表上(供 admin 详情页回看最近一次 webhook),留空则那张表
   * 全是空列。其余字段按 Sumsub 真实 webhook 形态补齐。
   */
  private buildWebhookPayload(
    deposit: any,
    type: string,
    kytTxnId: string,
  ): Record<string, unknown> {
    return {
      type,
      kytTxnId,
      applicantId: deposit.customer?.sumsubApplicantId ?? '',
      applicantType: 'individual',
      externalUserId: deposit.customer?.customerNo ?? deposit.ownerId,
      correlationId: `req-${randomUUID()}`,
      reviewStatus: 'completed',
      createdAtMs: new Date().toISOString(),
    };
  }
}
