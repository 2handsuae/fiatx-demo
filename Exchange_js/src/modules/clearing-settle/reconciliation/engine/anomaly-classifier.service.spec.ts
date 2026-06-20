import { Prisma } from '@prisma/client';
import { AnomalyClassifierService } from './anomaly-classifier.service';
import { MatchV2Result, ExternalLine } from './match-engine-v2.service';
import { InternalLeg } from './leg-projection.service';

const leg = (o: Partial<InternalLeg> = {}): InternalLeg => ({
  source: 'PAYIN', sourceId: 'i', sourceNo: 'PI', account: 'acc', subAccount: 'sub',
  book: 'CLIENT', direction: 'IN', currency: 'USDT', amount: new Prisma.Decimal('100'),
  externalRef: '0xREF', datetime: new Date('2026-06-16T10:00:00Z'), ...o,
});
const line = (o: Partial<ExternalLine> = {}): ExternalLine => ({
  id: 'e', source: 'HEXTRUST', accountRef: 'acc', subAccount: 'sub', book: 'CLIENT',
  currency: 'USDT', direction: 'IN', amount: new Prisma.Decimal('100'), externalRef: '0xREF',
  channelRef: null, datetime: new Date('2026-06-16T10:00:00Z'), description: null, ...o,
});
const emptyResult = (): MatchV2Result => ({ matched: [], orphanInternal: [], orphanExternal: [], ambiguous: [] });

describe('AnomalyClassifierService', () => {
  let svc: AnomalyClassifierService;
  beforeEach(() => { svc = new AnomalyClassifierService(); });

  describe('bucket 1 — i有 e有 金额等 → PASS', () => {
    it('equal amounts classified as PASS (not an anomaly)', () => {
      const m = emptyResult();
      m.matched.push({ internal: leg({ amount: new Prisma.Decimal('315.11') }), external: line({ amount: new Prisma.Decimal('315.11') }), matchType: 'PRIMARY' });
      const r = svc.classify(m);
      expect(r.pass).toHaveLength(1);
      expect(r.amountMismatch).toHaveLength(0);
      expect(r.pass[0].bucket).toBe('PASS');
      expect(r.pass[0].signedDelta.toString()).toBe('0');
    });
  });

  describe('bucket 2 — i有 e有 金额异 → AMOUNT_MISMATCH', () => {
    it('unequal amounts classified as AMOUNT_MISMATCH with signedDelta = internal − external', () => {
      const m = emptyResult();
      m.matched.push({ internal: leg({ amount: new Prisma.Decimal('315.11') }), external: line({ amount: new Prisma.Decimal('315.05') }), matchType: 'PRIMARY' });
      const r = svc.classify(m);
      expect(r.amountMismatch).toHaveLength(1);
      expect(r.amountMismatch[0].bucket).toBe('AMOUNT_MISMATCH');
      expect(r.amountMismatch[0].signedDelta.toString()).toBe('0.06');
      expect(r.amountMismatch[0].qualifier).toBe('AMOUNT_DIFF'); // 银行扣费/部分到账/汇率差
    });

    it('respects tolerance (sub-tolerance diff stays PASS)', () => {
      const m = emptyResult();
      m.matched.push({ internal: leg({ amount: new Prisma.Decimal('100.0000001') }), external: line({ amount: new Prisma.Decimal('100') }), matchType: 'PRIMARY' });
      const r = svc.classify(m);
      expect(r.pass).toHaveLength(1);
      expect(r.amountMismatch).toHaveLength(0);
    });
  });

  describe('bucket 3 — i有 e无 → ORPHAN_INTERNAL', () => {
    it('terminal internal leg with no external → real break (内部有外部无)', () => {
      const m = emptyResult();
      m.orphanInternal.push(leg({ sourceNo: 'PI-OMIT', amount: new Prisma.Decimal('481.75') }));
      const r = svc.classify(m);
      expect(r.orphanInternal).toHaveLength(1);
      expect(r.orphanInternal[0].bucket).toBe('ORPHAN_INTERNAL');
      // 投影只取终态 → 必为 TERMINAL_BREAK（在途不投影）
      expect(r.orphanInternal[0].qualifier).toBe('TERMINAL_BREAK');
      // signedδ 对 (内部 − 外部) 的贡献：内部有外部无 → +amount
      expect(r.orphanInternal[0].signedDelta.toString()).toBe('481.75');
      expect(r.orphanInternal[0].internalSourceNo).toBe('PI-OMIT');
    });
  });

  describe('bucket 4 — i无 e有 → ORPHAN_EXTERNAL', () => {
    it('external line with no internal → 外部有内部无 (bank fee unrecorded / orphan deposit / missed)', () => {
      const m = emptyResult();
      m.orphanExternal.push(line({ id: 'ex1', externalRef: '0xEXTORPHANUSDT', amount: new Prisma.Decimal('10') }));
      const r = svc.classify(m);
      expect(r.orphanExternal).toHaveLength(1);
      expect(r.orphanExternal[0].bucket).toBe('ORPHAN_EXTERNAL');
      expect(r.orphanExternal[0].qualifier).toBe('ORPHAN_DEPOSIT');
      // signedδ：外部有内部无 → −amount
      expect(r.orphanExternal[0].signedDelta.toString()).toBe('-10');
      expect(r.orphanExternal[0].externalRef).toBe('0xEXTORPHANUSDT');
    });

    it('orphan-external classified as RETURN when description=Return, linking channel_ref to original payout', () => {
      const m = emptyResult();
      m.orphanExternal.push(line({ id: 'ex2', direction: 'IN', description: 'Return of failed outgoing', channelRef: 'CHN-WDR-1', amount: new Prisma.Decimal('1500') }));
      const r = svc.classify(m);
      expect(r.orphanExternal[0].qualifier).toBe('RETURN');
      expect(r.orphanExternal[0].channelRef).toBe('CHN-WDR-1'); // 关联回原出金
    });
  });

  describe('internal_fund book-leg (sibling matched) → not a break', () => {
    it('IN leg matched + OUT leg orphan with same sourceId → OUT goes to internalBookLeg, not orphanInternal', () => {
      const m = emptyResult();
      // IN leg matched external (settlement/on-chain leg)
      m.matched.push({
        internal: leg({ source: 'INTERNALFUND', sourceId: 'f1', sourceNo: 'IF-1', direction: 'IN', externalRef: '0xFUND1' }),
        external: line({ direction: 'IN', externalRef: '0xFUND1' }), matchType: 'PRIMARY',
      });
      // OUT leg orphan (book side, no external mirror)
      m.orphanInternal.push(leg({ source: 'INTERNALFUND', sourceId: 'f1', sourceNo: 'IF-1', direction: 'OUT', externalRef: '0xFUND1' }));
      const r = svc.classify(m);
      expect(r.orphanInternal).toHaveLength(0); // not a break
      expect(r.internalBookLeg).toHaveLength(1);
      expect(r.internalBookLeg[0].qualifier).toBe('INTERNAL_BOOK_LEG');
      expect(r.internalBookLeg[0].signedDelta.toString()).toBe('0'); // 0 闭合贡献
      expect(r.summary.orphanInternal).toBe(0);
    });

    it('internal_fund with NEITHER leg matched → both legs are genuine orphan-internal breaks', () => {
      const m = emptyResult();
      m.orphanInternal.push(leg({ source: 'INTERNALFUND', sourceId: 'f2', sourceNo: 'IF-2', direction: 'OUT' }));
      m.orphanInternal.push(leg({ source: 'INTERNALFUND', sourceId: 'f2', sourceNo: 'IF-2', direction: 'IN' }));
      const r = svc.classify(m);
      expect(r.orphanInternal).toHaveLength(2);
      expect(r.internalBookLeg).toHaveLength(0);
    });
  });

  describe('ambiguous fallback → flagged for manual', () => {
    it('emits MANUAL line items for ambiguous matches', () => {
      const m = emptyResult();
      m.ambiguous.push({ internal: leg({ externalRef: null, sourceNo: 'PI-AMBIG' }), candidates: [line({ id: 'a' }), line({ id: 'b' })] });
      const r = svc.classify(m);
      expect(r.manual).toHaveLength(1);
      expect(r.manual[0].bucket).toBe('MANUAL');
      expect(r.manual[0].candidateCount).toBe(2);
    });
  });

  describe('book propagation (per-book case split)', () => {
    it('tags each classified item with its book (external for matched/orphan-ext, internal for orphan-int/ambiguous)', () => {
      const m = emptyResult();
      // matched mismatch → external book
      m.matched.push({ internal: leg({ book: 'CLIENT', amount: new Prisma.Decimal('99') }), external: line({ book: 'FIRM' }), matchType: 'PRIMARY' });
      // orphan internal → internal book
      m.orphanInternal.push(leg({ book: 'FIRM', sourceNo: 'OI' }));
      // orphan external → external book
      m.orphanExternal.push(line({ id: 'oe', book: 'FIRM' }));
      // ambiguous → internal book
      m.ambiguous.push({ internal: leg({ book: 'CLIENT', externalRef: null, sourceNo: 'AMB' }), candidates: [line({ id: 'c1' }), line({ id: 'c2' })] });
      const r = svc.classify(m);
      expect(r.amountMismatch[0].book).toBe('FIRM'); // external authoritative on matched pair
      expect(r.orphanInternal[0].book).toBe('FIRM');
      expect(r.orphanExternal[0].book).toBe('FIRM');
      expect(r.manual[0].book).toBe('CLIENT');
    });
  });

  describe('summary counts', () => {
    it('produces a bucket count summary', () => {
      const m = emptyResult();
      m.matched.push({ internal: leg(), external: line(), matchType: 'PRIMARY' }); // pass
      m.matched.push({ internal: leg({ amount: new Prisma.Decimal('99') }), external: line(), matchType: 'PRIMARY' }); // mismatch
      m.orphanInternal.push(leg({ sourceNo: 'X' }));
      m.orphanExternal.push(line({ id: 'y' }));
      const r = svc.classify(m);
      expect(r.summary).toEqual({ pass: 1, amountMismatch: 1, orphanInternal: 1, orphanExternal: 1, manual: 0 });
    });
  });
});
