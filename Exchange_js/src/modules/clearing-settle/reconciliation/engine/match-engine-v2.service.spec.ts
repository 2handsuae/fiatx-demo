import { Prisma } from '@prisma/client';
import { MatchEngineV2Service, ExternalLine } from './match-engine-v2.service';
import { InternalLeg } from './leg-projection.service';

const leg = (o: Partial<InternalLeg>): InternalLeg => ({
  source: 'PAYIN', sourceId: 'i', sourceNo: 'PI', account: 'acc', subAccount: 'sub',
  book: 'CLIENT', direction: 'IN', currency: 'USDT', amount: new Prisma.Decimal('100'),
  externalRef: null, datetime: new Date('2026-06-16T10:00:00Z'), ...o,
});
const line = (o: Partial<ExternalLine>): ExternalLine => ({
  id: 'e', source: 'HEXTRUST', accountRef: 'acc', subAccount: 'sub', book: 'CLIENT',
  currency: 'USDT', direction: 'IN', amount: new Prisma.Decimal('100'), externalRef: null,
  channelRef: null, datetime: new Date('2026-06-16T10:00:00Z'), description: null, ...o,
});

describe('MatchEngineV2Service', () => {
  let svc: MatchEngineV2Service;
  beforeEach(() => { svc = new MatchEngineV2Service(); });

  describe('primary match: (direction, currency, external_ref) — NOT amount', () => {
    it('matches by external_ref ignoring amount difference (amount diff surfaces as matched pair, not two orphans)', () => {
      const i = [leg({ externalRef: '0xSEED51USDT', amount: new Prisma.Decimal('315.11') })];
      const e = [line({ externalRef: '0xSEED51USDT', amount: new Prisma.Decimal('315.05') })];
      const r = svc.match(i, e);
      // RED LINE: amount must NOT split the match — it stays ONE matched pair
      expect(r.matched).toHaveLength(1);
      expect(r.orphanInternal).toHaveLength(0);
      expect(r.orphanExternal).toHaveLength(0);
      expect(r.matched[0].internal.externalRef).toBe('0xSEED51USDT');
      expect(r.matched[0].external.amount.toString()).toBe('315.05');
    });

    it('matches across differing accounts when external_ref is unique (crypto synthetic pool account)', () => {
      // 内部腿 account=客户 vault；外部行 account=归集 vault（生成器合成）；txHash 唯一 → 仍配上。
      const i = [leg({ externalRef: '0xC', account: 'vault-cust' })];
      const e = [line({ externalRef: '0xC', accountRef: 'vault-main' })];
      const r = svc.match(i, e);
      expect(r.matched).toHaveLength(1);
    });

    it('does not match when direction differs (same ref, opposite leg)', () => {
      const i = [leg({ externalRef: '0xC', direction: 'IN' })];
      const e = [line({ externalRef: '0xC', direction: 'OUT' })];
      const r = svc.match(i, e);
      expect(r.matched).toHaveLength(0);
      expect(r.orphanInternal).toHaveLength(1);
      expect(r.orphanExternal).toHaveLength(1);
    });

    it('does not match when currency differs', () => {
      const i = [leg({ externalRef: 'R', currency: 'USDT' })];
      const e = [line({ externalRef: 'R', currency: 'AED' })];
      const r = svc.match(i, e);
      expect(r.matched).toHaveLength(0);
    });

    it('orphan-internal: internal ref with no external counterpart (omitted line)', () => {
      const i = [leg({ externalRef: '0xSEED55USDT', sourceNo: 'PI-OMIT' })];
      const r = svc.match(i, []);
      expect(r.orphanInternal).toHaveLength(1);
      expect(r.orphanInternal[0].sourceNo).toBe('PI-OMIT');
    });

    it('orphan-external: external ref with no internal counterpart (orphan deposit)', () => {
      const e = [line({ externalRef: '0xEXTORPHANUSDT' })];
      const r = svc.match([], e);
      expect(r.orphanExternal).toHaveLength(1);
      expect(r.orphanExternal[0].externalRef).toBe('0xEXTORPHANUSDT');
    });

    it('1:1 greedy: one external ref consumed by first internal leg only', () => {
      const i = [leg({ externalRef: 'DUP', sourceNo: 'A' }), leg({ externalRef: 'DUP', sourceNo: 'B' })];
      const e = [line({ externalRef: 'DUP' })];
      const r = svc.match(i, e);
      expect(r.matched).toHaveLength(1);
      expect(r.orphanInternal).toHaveLength(1); // second leg unmatched
    });
  });

  describe('fallback match: (sub_account, direction, currency, amount, datetime±window) for no-external_ref fiat deposits', () => {
    it('matches fiat deposit by sub_account+amount+direction within time window', () => {
      const i = [leg({ externalRef: null, currency: 'AED', subAccount: 'AE-VIBAN-1', amount: new Prisma.Decimal('2865.50'), datetime: new Date('2026-06-16T10:00:00Z') })];
      const e = [line({ externalRef: null, currency: 'AED', subAccount: 'AE-VIBAN-1', amount: new Prisma.Decimal('2865.50'), datetime: new Date('2026-06-16T10:05:00Z') })];
      const r = svc.match(i, e);
      expect(r.matched).toHaveLength(1);
      expect(r.matched[0].matchType).toBe('FALLBACK');
    });

    it('fallback DOES pair a sole candidate even when amount differs (key has no amount → amount-mismatch surfaces, not 2 orphans)', () => {
      // RED LINE §0 principle 6: amount must NOT be in the fallback KEY either; sole VIBAN/window candidate pairs,
      // amount diff becomes a matched pair for the classifier (fiat amount-mismatch), never two orphans.
      const i = [leg({ externalRef: null, currency: 'AED', subAccount: 'V', amount: new Prisma.Decimal('100') })];
      const e = [line({ externalRef: null, currency: 'AED', subAccount: 'V', amount: new Prisma.Decimal('101') })];
      const r = svc.match(i, e);
      expect(r.matched).toHaveLength(1);
      expect(r.matched[0].matchType).toBe('FALLBACK');
      expect(r.orphanInternal).toHaveLength(0);
      expect(r.orphanExternal).toHaveLength(0);
    });

    it('amount disambiguates only when MULTIPLE candidates share VIBAN/direction/window', () => {
      const i = [leg({ externalRef: null, currency: 'AED', subAccount: 'V', amount: new Prisma.Decimal('100'), datetime: new Date('2026-06-16T10:00:00Z') })];
      const e = [
        line({ id: 'e1', externalRef: null, currency: 'AED', subAccount: 'V', amount: new Prisma.Decimal('100'), datetime: new Date('2026-06-16T10:01:00Z') }),
        line({ id: 'e2', externalRef: null, currency: 'AED', subAccount: 'V', amount: new Prisma.Decimal('999'), datetime: new Date('2026-06-16T10:02:00Z') }),
      ];
      const r = svc.match(i, e);
      // exact-amount candidate (100) wins; the 999 stays orphan-external
      expect(r.matched).toHaveLength(1);
      expect(r.matched[0].external.id).toBe('e1');
      expect(r.orphanExternal.map((o) => o.id)).toEqual(['e2']);
    });

    it('does NOT fallback-match outside the datetime window', () => {
      const i = [leg({ externalRef: null, currency: 'AED', subAccount: 'V', amount: new Prisma.Decimal('100'), datetime: new Date('2026-06-16T10:00:00Z') })];
      const e = [line({ externalRef: null, currency: 'AED', subAccount: 'V', amount: new Prisma.Decimal('100'), datetime: new Date('2026-06-18T10:00:00Z') })];
      const r = svc.match(i, e, { fallbackWindowMs: 24 * 3600_000 });
      expect(r.matched).toHaveLength(0);
    });

    it('flags ambiguous fallback (2 external candidates for 1 internal) for manual review, does not auto-match', () => {
      const i = [leg({ externalRef: null, currency: 'AED', subAccount: 'V', amount: new Prisma.Decimal('100'), datetime: new Date('2026-06-16T10:00:00Z') })];
      const e = [
        line({ id: 'e1', externalRef: null, currency: 'AED', subAccount: 'V', amount: new Prisma.Decimal('100'), datetime: new Date('2026-06-16T10:01:00Z') }),
        line({ id: 'e2', externalRef: null, currency: 'AED', subAccount: 'V', amount: new Prisma.Decimal('100'), datetime: new Date('2026-06-16T10:02:00Z') }),
      ];
      const r = svc.match(i, e);
      expect(r.ambiguous).toHaveLength(1);
      expect(r.ambiguous[0].candidates).toHaveLength(2);
      expect(r.matched).toHaveLength(0);
      // the internal leg + both externals remain unconsumed (not silently orphaned)
      expect(r.orphanInternal).toHaveLength(0);
    });
  });

  describe('primary takes precedence over fallback', () => {
    it('uses external_ref match even if a fallback candidate also exists', () => {
      const i = [leg({ externalRef: '0xC', currency: 'USDT', subAccount: 'S', amount: new Prisma.Decimal('100') })];
      const e = [line({ externalRef: '0xC', currency: 'USDT', subAccount: 'S', amount: new Prisma.Decimal('100') })];
      const r = svc.match(i, e);
      expect(r.matched).toHaveLength(1);
      expect(r.matched[0].matchType).toBe('PRIMARY');
    });
  });
});
