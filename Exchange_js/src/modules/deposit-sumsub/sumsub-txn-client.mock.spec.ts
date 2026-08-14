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

    it('passes through raw when primed with it', async () => {
      const raw = { id: 'T2', scoringResult: { score: 42 } };
      const detail: SumsubTxnDetail = {
        txnId: 'T2',
        verdict: 'approved',
        reviewAnswer: 'GREEN',
        riskScore: 42,
        typedTags: [],
        raw,
      };
      client.primeTxn('T2', detail);

      const result = await client.getTxn('T2');
      expect(result.raw).toEqual(raw);
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

  describe('primeSubmitResult', () => {
    it('primeSubmitResult 让 submitTxn 带回 scoringResult', async () => {
      const c = new MockSumsubTxnClient();
      c.primeSubmitResult('SWP-001', {
        txnId: 'abc123def456abc123def456',
        scoringResult: { action: 'reject', score: 90, matchedRuleNames: ['r1'], applicantActions: [] },
      });
      const r = await c.submitTxn({
        applicantId: 'a1', clientTxnId: 'SWP-001', type: 'finance', direction: 'out',
        amount: 100, currencyCode: 'USDT', currencyType: 'crypto',
        orderId: 'SWP-001', props: { txType: 'exchange' }, infoType: 'exchange',
      });
      expect(r.txnId).toBe('abc123def456abc123def456');
      expect(r.scoringResult?.action).toBe('reject');
    });

    it('未 prime 时 scoringResult 为 undefined，txnId 走确定性哈希兜底', async () => {
      const c = new MockSumsubTxnClient();
      const r = await c.submitTxn({
        applicantId: 'a1', clientTxnId: 'SWP-002', type: 'finance', direction: 'out',
        amount: 1, currencyCode: 'AED', currencyType: 'fiat',
      });
      expect(r.txnId).toMatch(/^[0-9a-f]{24}$/);
      expect(r.scoringResult).toBeUndefined();
    });
  });
});
