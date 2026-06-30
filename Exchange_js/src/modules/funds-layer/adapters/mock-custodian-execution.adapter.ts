import { Injectable } from '@nestjs/common';
import { fakeChainTxHash } from '../../../common/utils/fake-external-refs.util';

@Injectable()
export class MockCustodianExecutionAdapter {
  /** mock：返回一个确定性的假 txHash，真实 HexTrust 对接在后续轮次替换 */
  async broadcast(internalFundNo: string): Promise<{ txHash: string }> {
    return { txHash: fakeChainTxHash(internalFundNo) };
  }
}
