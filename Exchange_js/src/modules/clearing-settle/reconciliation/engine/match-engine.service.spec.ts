import { Prisma } from '@prisma/client';
import { MatchEngineService, InternalAction, ExternalTx } from './match-engine.service';

const D = (n: string | number) => new Prisma.Decimal(n);

describe('MatchEngineService', () => {
  const svc = new MatchEngineService();
  const internal: InternalAction[] = [
    { sourceType: 'PAYIN', sourceId: 'p1', sourceNo: 'DEP-1', amount: D('100'), direction: 'IN', txHash: '0xaaa' },
    { sourceType: 'INTERNAL_FUND', sourceId: 'f1', sourceNo: 'ITX-1', amount: D('61.20'), direction: 'IN', txHash: '0xbbb' },
  ];
  const external: ExternalTx[] = [
    { source: 'HEXTRUST', txId: 'e1', txHash: '0xaaa', amount: D('100'), direction: 'IN', timestamp: new Date() },
  ];

  it('matches by txHash+amount+direction; leaves unmatched on both sides', () => {
    const res = svc.match(internal, external);
    expect(res.matched.length).toBe(1);
    expect(res.orphanInternal.length).toBe(1);        // f1 内部有外部无
    expect(res.orphanInternal[0].sourceNo).toBe('ITX-1');
    expect(res.orphanExternal.length).toBe(0);
  });
});
