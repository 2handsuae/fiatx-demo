import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { SumsubTxnClient, SubmitTxnInput } from './sumsub-txn-client.interface';
import { SumsubTxnDetail } from './sumsub-txn.types';

/**
 * 测试替身:不调真 Sumsub。测试预先 primeSubmit/primeTxn 塞好应答,
 * 状态机跑起来时按预置返回。供场景仿真器(Task 11)/e2e(Task 12)使用。
 */
@Injectable()
export class MockSumsubTxnClient implements SumsubTxnClient {
  private readonly logger = new Logger(MockSumsubTxnClient.name);
  private readonly txns = new Map<string, SumsubTxnDetail>();
  private readonly submitResults = new Map<string, string>();

  primeTxn(txnId: string, detail: SumsubTxnDetail): void {
    this.txns.set(txnId, detail);
  }

  primeSubmit(clientTxnId: string, txnId: string): void {
    this.submitResults.set(clientTxnId, txnId);
  }

  async submitTxn(input: SubmitTxnInput): Promise<{ txnId: string }> {
    const txnId =
      this.submitResults.get(input.clientTxnId) ?? MockSumsubTxnClient.fallbackTxnId(input.clientTxnId);
    return { txnId };
  }

  /**
   * 没被 primeSubmit 预置时的兜底 txnId。曾经是 `MOCK-${clientTxnId}` —— 那个值会
   * 一路显示到 admin 详情页的 "Sumsub References",跟真 Sumsub 的号(24 位小写 hex,
   * ObjectId 形态)完全不是一回事,演示/截图里一眼假。这里改成同样形态的确定性哈希:
   * 仍然是可预测、可重放的测试替身值,只是长得像真的。
   */
  private static fallbackTxnId(clientTxnId: string): string {
    return createHash('sha1').update(`mock-sumsub-txn:${clientTxnId}`).digest('hex').slice(0, 24);
  }

  async getTxn(txnId: string): Promise<SumsubTxnDetail> {
    const detail = this.txns.get(txnId);
    if (!detail) {
      throw new Error(`Unknown txn: ${txnId}`);
    }
    // applicantActions 从 raw(fixture 报告,buildTxnReport 现生成)的
    // scoringResult.applicantActions 透传,与 HttpSumsubTxnClient 读法对称。
    const body = detail.raw as any;
    return {
      ...detail,
      applicantActions: Array.isArray(body?.scoringResult?.applicantActions)
        ? body.scoringResult.applicantActions.map((a: any) => ({
            applicantActionId: String(a.applicantActionId ?? ''),
            externalActionId: String(a.externalActionId ?? ''),
          }))
        : undefined,
    };
  }

  async rescore(_txnId: string): Promise<void> {
    // no-op: mock 无需真实重打分
  }

  async reviewComplete(_txnId: string, _answer: 'GREEN' | 'RED'): Promise<void> {
    // no-op: mock 无需真实 officer 复核
  }

  async archiveTxHash(txnId: string, txHash: string): Promise<void> {
    // no-op: mock 无需真调 Sumsub KYT 归档
    this.logger.debug(`archiveTxHash no-op: txnId=${txnId} txHash=${txHash}`);
  }
}
