import { Injectable } from '@nestjs/common';
import { SumsubTxnClient, SubmitTxnInput } from './sumsub-txn-client.interface';
import { SumsubTxnDetail } from './sumsub-txn.types';

/**
 * 测试替身:不调真 Sumsub。测试预先 primeSubmit/primeTxn 塞好应答,
 * 状态机跑起来时按预置返回。供场景仿真器(Task 11)/e2e(Task 12)使用。
 */
@Injectable()
export class MockSumsubTxnClient implements SumsubTxnClient {
  private readonly txns = new Map<string, SumsubTxnDetail>();
  private readonly submitResults = new Map<string, string>();

  primeTxn(txnId: string, detail: SumsubTxnDetail): void {
    this.txns.set(txnId, detail);
  }

  primeSubmit(clientTxnId: string, txnId: string): void {
    this.submitResults.set(clientTxnId, txnId);
  }

  async submitTxn(input: SubmitTxnInput): Promise<{ txnId: string }> {
    const txnId = this.submitResults.get(input.clientTxnId) ?? `MOCK-${input.clientTxnId}`;
    return { txnId };
  }

  async getTxn(txnId: string): Promise<SumsubTxnDetail> {
    const detail = this.txns.get(txnId);
    if (!detail) {
      throw new Error(`Unknown txn: ${txnId}`);
    }
    return detail;
  }

  async rescore(_txnId: string): Promise<void> {
    // no-op: mock 无需真实重打分
  }

  async reviewComplete(_txnId: string, _answer: 'GREEN' | 'RED'): Promise<void> {
    // no-op: mock 无需真实 officer 复核
  }
}
