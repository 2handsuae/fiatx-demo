import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { DepositTransactionsService } from '../trading/deposit-transactions/deposit-transactions.service';
import { SUMSUB_TXN_CLIENT, SumsubTxnClient } from './sumsub-txn-client.interface';
import { MockSumsubTxnClient } from './sumsub-txn-client.mock';
import { DEPOSIT_VERDICT_BUTTONS, DepositVerdictButton } from './fixtures/verdict-buttons';
import { buildTxnReport } from './fixtures/txn-report.builder';
import { KYT_ONHOLD_TYPE } from './kyt-webhook-types';
import { KytVerdict } from './sumsub-txn.types';
import { SumsubIngestionService } from '../sumsub-ingestion/sumsub-ingestion.service';
import { AuditLogsService } from '../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes } from '../audit-logging/constants/audit-actions.constant';
import { AuditOutcome } from '../audit-logging/dto/audit-log.dto';

export interface DemoScenarioActor {
  actorId: string;
  actorNo?: string;
  actorRole?: string;
}

/** webhookType → 归一 verdict,与 DepositKytVerdictHandler 的 VERDICT_BY_TYPE 同源同值 */
const VERDICT_OF: Record<string, KytVerdict> = {
  applicantKytTxnApproved: 'approved',
  applicantKytTxnRejected: 'rejected',
  applicantKytTxnAwaitingUser: 'awaitUser',
  [KYT_ONHOLD_TYPE]: 'onHold',
};

/**
 * Task 4(计划「充值仿真裁决按钮」):把此前 8 个多步场景剧本改成 9 个**单步**裁决按钮。
 * 驱动**真实** ingestionService.ingest() 走完整的前置分流→router→handler→workflow 链路,
 * 不碰 fixture/workflow/handler 本身逻辑。
 *
 * 只在 SUMSUB_MOCK_MODE=true 时才会被实际使用 —— AdminDepositDemoController 只在该模式下
 * 才被注册(deposit-sumsub.module.ts),所以这里注入到的 SUMSUB_TXN_CLIENT 理应总是
 * MockSumsubTxnClient;仍做一次 instanceof 兜底,防止误配置下的静默错误。
 */
@Injectable()
export class DepositDemoScenarioService {
  constructor(
    private readonly depositService: DepositTransactionsService,
    private readonly ingestionService: SumsubIngestionService,
    private readonly auditLogsService: AuditLogsService,
    @Inject(SUMSUB_TXN_CLIENT) private readonly sumsubTxnClient: SumsubTxnClient,
  ) {}

  /**
   * 投递一次裁决:按 deposit 当前的 sumsubTxnType 生成官方形状报文 → prime mock 的
   * getTxn 应答 → 把 webhook 喂进真实 ingestion 链路。
   *
   * 与旧 runScenario 的区别:不再有"剧本/预期终态"概念。状态去哪由 handler 决定,
   * 这里只如实回报投递前后的状态,不做 matchedExpectation 判定。
   */
  async runVerdict(depositId: string, buttonKey: string, actor: DemoScenarioActor) {
    const button = DEPOSIT_VERDICT_BUTTONS[buttonKey];
    if (!button) {
      throw new BadRequestException(
        `Unknown verdict "${buttonKey}". Valid keys: ${Object.keys(DEPOSIT_VERDICT_BUTTONS).join(', ')}`,
      );
    }
    if (!(this.sumsubTxnClient instanceof MockSumsubTxnClient)) {
      throw new BadRequestException(
        'Demo verdict runner requires SUMSUB_MOCK_MODE=true (SUMSUB_TXN_CLIENT is not the mock client)',
      );
    }
    const mockClient = this.sumsubTxnClient;

    const deposit = await this.depositService.findOne(depositId);
    const statusBefore = deposit.status;

    // 该单已过 Gate 0 → 用它自己的真号;还没过 → 现铸一个并 prime,等 Gate 0 取用。
    const txnId = deposit.sumsubTxnId ?? this.mintTxnId(deposit, button.key);
    if (!deposit.sumsubTxnId) mockClient.primeSubmit(deposit.depositNo, txnId);

    const txnType = (deposit.sumsubTxnType as 'finance' | 'travelRule') ?? 'finance';
    const isCrypto = deposit.asset?.type === 'CRYPTO';

    const raw = buildTxnReport(
      {
        txnId,
        txnType,
        applicantId: deposit.customer?.sumsubApplicantId ?? '',
        externalUserId: deposit.customer?.customerNo ?? deposit.ownerId,
        clientTxnId: deposit.depositNo,
        amount: Number(deposit.amount),
        currency: deposit.asset?.currency ?? '',
        isCrypto,
        createdAtIso: new Date(deposit.createdAt).toISOString(),
      },
      button.verdict,
    );

    mockClient.primeTxn(txnId, {
      txnId,
      verdict: VERDICT_OF[button.webhookType],
      reviewAnswer: button.verdict.reviewAnswer,
      riskScore: button.verdict.score,
      typedTags: button.verdict.typedTags ?? [],
      raw,
    });

    await this.ingestionService.ingest(
      this.buildWebhookPayload(deposit, button, txnId, txnType),
      { isSimulated: true },
    );

    const refreshed = await this.depositService.findOne(deposit.id);

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.DEPOSIT_DEMO_SCENARIO_RUN,
        primarySubjectType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        primarySubjectNo: deposit.depositNo,
        traceId: deposit.traceId || undefined,
        outcome: AuditOutcome.SUCCESS,
        reason: `Demo verdict ${button.key} fed into deposit ${deposit.depositNo}`,
        metadata: {
          verdict: button.key,
          webhookType: button.webhookType,
          txnType,
          statusBefore,
          statusAfter: refreshed.status,
        },
        requestId: `DEPOSIT_DEMO_VERDICT_${deposit.depositNo}_${randomUUID()}`,
        sourcePlatform: 'SCRIPT',
      },
      {
        actorType: 'ADMIN',
        actorNo: actor.actorNo || 'UNKNOWN',
        actorDisplayName: actor.actorNo || 'UNKNOWN',
        actorRolesAtTime: [actor.actorRole || 'ADMIN'],
      },
    );

    return {
      verdict: button.key,
      label: button.label,
      depositId: deposit.id,
      depositNo: deposit.depositNo,
      txnType,
      statusBefore,
      statusAfter: refreshed.status,
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
   *   ② **同单同槽稳定** —— 同一按钮重复喂是幂等重放,不会每次换号;
   *   ③ **跨单绝不重号** —— 此前 fixture 把 `T3` 当真 id 直接用,第二笔单跑同一场景时
   *      `findBySumsubTxnId('T3')` 会匹到**上一笔**单,端点照样返回 201 且事件全部
   *      PROCESSED、零报错,但驱动的是错误的单(2026-07-29 live demo 实测踩中)。
   *
   * ⚠️ 本方法与 runVerdict() 里的 createdAtIso 同样依赖「createdAt 是非空且带
   * @default(now()) 的 DB 列」这一不变量(prisma/schema.prisma 保证),所以不做
   * 运行时兜底;若将来该列变可空,两处要一起改。
   */
  private mintTxnId(deposit: { depositNo: string; createdAt: Date | string }, slot: string): string {
    const digest = createHash('sha1').update(`${deposit.depositNo}:${slot}`).digest('hex');
    const ms = new Date(deposit.createdAt).getTime();
    const tsHex = Math.floor(ms / 1000).toString(16).padStart(8, '0').slice(-8);
    return `${tsHex}${digest.slice(0, 16)}`;
  }

  /**
   * 按官方 Transaction Monitoring webhook 形状生成 payload
   * (2026-07-31 查证 docs.sumsub.com/reference/transaction-monitoring-webhooks)。
   * handler 只读 type + kytTxnId,其余字段供 sumsub_webhook_events 落库回看,
   * 并让演示报文与真实报文形状一致。
   */
  private buildWebhookPayload(
    deposit: any,
    button: DepositVerdictButton,
    kytTxnId: string,
    txnType: 'finance' | 'travelRule',
  ): Record<string, unknown> {
    return {
      type: button.webhookType,
      kytTxnId,
      kytDataTxnId: deposit.depositNo,
      kytTxnType: txnType,
      applicantId: deposit.customer?.sumsubApplicantId ?? '',
      applicantType: 'individual',
      externalUserId: deposit.customer?.customerNo ?? deposit.ownerId,
      clientId: 'fiatx',
      correlationId: `req-${randomUUID()}`,
      reviewStatus: button.verdict.reviewStatus,
      reviewResult: {
        reviewAnswer: button.verdict.reviewAnswer,
        ...(button.verdict.reviewRejectType && { reviewRejectType: button.verdict.reviewRejectType }),
      },
      sandboxMode: true,
      createdAtMs: new Date().toISOString(),
    };
  }
}
