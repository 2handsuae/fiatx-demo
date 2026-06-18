import { Prisma } from '@prisma/client';
import { ClassifierService } from './classifier.service';
import { MatchResult } from './match-engine.service';

const D = (n: string | number) => new Prisma.Decimal(n);

describe('ClassifierService', () => {
  const svc = new ClassifierService();

  it('signs: ORPHAN_INTERNAL +, ORPHAN_EXTERNAL -, AMOUNT_MISMATCH internal-external; Σ closes', () => {
    const m: MatchResult = {
      matched: [],
      amountMismatch: [{
        internal: { sourceType: 'PAYIN', sourceId: 'p1', sourceNo: 'DEP-1', amount: D('315.11'), direction: 'IN', txHash: '0xaaa' },
        external: { source: 'HEXTRUST', txId: 'e1', txHash: '0xaaa', amount: D('315.05'), direction: 'IN', timestamp: new Date() },
      }],
      orphanInternal: [{ sourceType: 'INTERNAL_FUND', sourceId: 'f1', sourceNo: 'ITX-1', amount: D('61.20'), direction: 'IN', txHash: '0xbbb' }],
      orphanExternal: [{ source: 'HEXTRUST', txId: 'e9', txHash: '0xzzz', amount: D('10'), direction: 'IN', timestamp: new Date() }],
    };
    const drafts = svc.classify(m);
    expect(drafts.find(d => d.matchStatus === 'ORPHAN_INTERNAL')!.signedDelta.toString()).toBe('61.2');
    expect(drafts.find(d => d.matchStatus === 'ORPHAN_EXTERNAL')!.signedDelta.toString()).toBe('-10');
    expect(drafts.find(d => d.matchStatus === 'AMOUNT_MISMATCH')!.signedDelta.toString()).toBe('0.06');
    const sum = drafts.reduce((s, d) => s.plus(d.signedDelta), D(0));
    expect(sum.toString()).toBe('51.26'); // 61.2 - 10 + 0.06
  });
});
