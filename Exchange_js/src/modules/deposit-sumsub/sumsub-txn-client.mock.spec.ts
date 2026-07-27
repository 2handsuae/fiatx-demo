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

    it('returns a default MOCK-prefixed txnId when nothing was primed', async () => {
      const result = await client.submitTxn({
        applicantId: 'app-1',
        clientTxnId: 'client-2',
        type: 'finance',
        direction: 'in',
        amount: 100,
        currencyCode: 'USD',
        currencyType: 'fiat',
      });

      expect(result).toEqual({ txnId: 'MOCK-client-2' });
    });
  });

  describe('rescore / reviewComplete', () => {
    it('resolves without throwing (no-op)', async () => {
      await expect(client.rescore('T1')).resolves.toBeUndefined();
      await expect(client.reviewComplete('T1', 'GREEN')).resolves.toBeUndefined();
    });
  });
});
