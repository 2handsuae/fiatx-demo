import { MockSumsubTxnClient } from './sumsub-txn-client.mock';
import { SumsubTxnDetail } from './sumsub-txn.types';

describe('MockSumsubTxnClient', () => {
  let client: MockSumsubTxnClient;

  beforeEach(() => {
    client = new MockSumsubTxnClient();
  });

  describe('getTxn', () => {
    it('returns the primed detail for a primed txnId', async () => {
      const detail: SumsubTxnDetail = {
        txnId: 'T1',
        verdict: 'rejected',
        reviewAnswer: 'RED',
        riskScore: 91,
        typedTags: [{ label: 'SANCTION', type: 'userDefined' }],
      };
      client.primeTxn('T1', detail);

      await expect(client.getTxn('T1')).resolves.toEqual(detail);
    });

    it('throws for an unprimed txnId', async () => {
      await expect(client.getTxn('X')).rejects.toThrow('Unknown txn');
    });
  });

  describe('submitTxn', () => {
    it('returns the primed txnId for a primed clientTxnId', async () => {
      client.primeSubmit('client-1', 'T-primed');

      const result = await client.submitTxn({
        applicantId: 'app-1',
        clientTxnId: 'client-1',
        type: 'finance',
        direction: 'in',
        amount: 100,
        currencyCode: 'USD',
        currencyType: 'fiat',
      });

      expect(result).toEqual({ txnId: 'T-primed' });
    });

    it('falls back to a Sumsub-shaped 24-hex txnId when nothing was primed', async () => {
      const result = await client.submitTxn({
        applicantId: 'app-1',
        clientTxnId: 'client-2',
        type: 'finance',
        direction: 'in',
        amount: 100,
        currencyCode: 'USD',
        currencyType: 'fiat',
      });

      // 形态必须与真 Sumsub 一致(24 位小写 hex),不能是 `MOCK-xxx` —— 这个值会一路
      // 显示到 admin 详情页的 Sumsub References,演示/截图里一眼假。
      expect(result.txnId).toMatch(/^[0-9a-f]{24}$/);
      // 确定性:同一 clientTxnId 恒得同一个号(可重放)
      const again = await client.submitTxn({
        applicantId: 'app-1',
        clientTxnId: 'client-2',
        type: 'finance',
        direction: 'in',
        amount: 100,
        currencyCode: 'USD',
        currencyType: 'fiat',
      });
      expect(again.txnId).toBe(result.txnId);
    });
  });

  describe('rescore / reviewComplete', () => {
    it('resolves without throwing (no-op)', async () => {
      await expect(client.rescore('T1')).resolves.toBeUndefined();
      await expect(client.reviewComplete('T1', 'GREEN')).resolves.toBeUndefined();
    });
  });
});
