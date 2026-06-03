import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

@Injectable()
export class MockCustodianExecutionAdapter {
  /** mock：返回一个确定性的假 txHash，真实 HexTrust 对接在后续轮次替换 */
  async broadcast(internalFundNo: string): Promise<{ txHash: string }> {
    return { txHash: `0xmock${internalFundNo}${randomUUID().slice(0, 8)}` };
  }
}
