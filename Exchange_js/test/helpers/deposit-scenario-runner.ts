import { MockSumsubTxnClient } from '../../src/modules/deposit-sumsub/sumsub-txn-client.mock';
import { DepositScenario } from '../../src/modules/deposit-sumsub/fixtures/scenarios';

/**
 * Task 11 场景仿真器:把一个已存在的 deposit,按 fixture 剧本(scenarios.ts)驱动一遍。
 *
 * 喂 webhook 入口选择 —— `SumsubIngestionService.ingest(payload, { isSimulated: true })`:
 * 这是真实的摄入入口(controller 之下第一站),完整走
 *   前置分流(payload.type.startsWith('applicantKytTxn')) → DepositWebhookRouter.route()
 *   → DepositKytVerdictHandler.handle() → DepositWorkflowService.applyKytVerdict()
 * 不绕过 router/handler,也不直接调 workflow(那样就测不到路由+tag读取这段真实链路了)。
 *
 * isSimulated:true 是必须的,不是可选项:ingest() 的去重键(buildDedupeKey)只在
 * !options.isSimulated 时计算并拿去比对已 PROCESSED 的同 type+applicantId 事件。S5/S6/S9
 * 场景里同一个 kytTxnId 会先后收到两条 applicantKytTxnRejected、或 Created 之后再来一条
 * 其它事件——这些 payload 没有真实 Sumsub 的 reviewId/attemptId 区分,若不标 isSimulated 会
 * 被 dedupe 误判成"重复事件"而被吞掉,状态机就走不到第二步。isSimulated 分支是同步 dispatch
 * (`await this.dispatch(event)`),所以喂完这一步、下一步开始前,上一步已经落地。
 *
 * runner 本身不创建 deposit、不做断言(那是 Task 12 e2e 的事)——只负责按剧本顺序:
 *   1) primeSubmit:把 submit 预置的 txnId 注册到 clientTxnId 上,对应
 *      DepositWorkflowService.submitSumsubTxns() 提交时用的 clientTxnId
 *      (finance 腿 = deposit.depositNo,travelRule 腿 = `${deposit.depositNo}-TR`)。
 *   2) 逐步执行:若该步有 primeTxn,先(重)设 MockSumsubTxnClient 的 getTxn 应答;
 *      若有 webhook,喂进 ingestionService;若 needsSlaTimer,把 deposit.slaDeadline
 *      拨到过去(免得真等 7 天 SLA),再触发一次 SLA 扫描。
 */

export interface DepositScenarioRunnerCtx {
  /** 真实 webhook 入口(SumsubIngestionService)。只用到 ingest 一个方法,便于 smoke 场景传轻量替身 */
  ingestionService: {
    ingest(
      payload: Record<string, unknown>,
      options?: { isSimulated?: boolean },
    ): Promise<unknown>;
  };
  /** 供 primeSubmit/primeTxn 预置应答;DepositWorkflowService/DepositKytVerdictHandler 内部会读它 */
  mockSumsubTxnClient: MockSumsubTxnClient;
  /** 用于 S9:把 deposit.slaDeadline 拨到过去 */
  depositService: {
    setSlaDeadline(id: string, slaDeadline: Date): Promise<unknown>;
  };
  /** 用于 S9:onHold 之后手动触发一次 SLA 扫描,不等真实的定时 Cron 任务 */
  slaService: {
    checkSlaBreaches(): Promise<void>;
  };
}

export interface ScenarioDeposit {
  id: string;
  depositNo: string;
}

export async function runScenario(
  ctx: DepositScenarioRunnerCtx,
  scenario: DepositScenario,
  deposit: ScenarioDeposit,
): Promise<void> {
  const { mockSumsubTxnClient, ingestionService, depositService, slaService } = ctx;

  mockSumsubTxnClient.primeSubmit(deposit.depositNo, scenario.submit.financeTxnId);
  if (scenario.submit.travelRuleTxnId) {
    mockSumsubTxnClient.primeSubmit(`${deposit.depositNo}-TR`, scenario.submit.travelRuleTxnId);
  }

  for (const step of scenario.steps) {
    if (step.primeTxn) {
      mockSumsubTxnClient.primeTxn(step.primeTxn.txnId, step.primeTxn.detail);
    }

    if (step.webhook) {
      await ingestionService.ingest(
        { type: step.webhook.type, kytTxnId: step.webhook.kytTxnId },
        { isSimulated: true },
      );
    }

    if (step.needsSlaTimer) {
      const pastDeadline = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await depositService.setSlaDeadline(deposit.id, pastDeadline);
      await slaService.checkSlaBreaches();
    }
  }
}
