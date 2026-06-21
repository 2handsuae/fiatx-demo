import { pairManifest } from './reconciliation-query.service';

describe('pairManifest', () => {
  it('pairs injected breaks vs detected line items by (currency,book,bucket,ref); reports missed & extra', () => {
    const breaks = [
      { currency: 'AED', book: 'CLIENT', bucket: 'ORPHAN_INTERNAL', targetRef: 'REF-DEMO-1-AED' },
      { currency: 'USDT', book: 'FIRM', bucket: 'ORPHAN_EXTERNAL', targetRef: '0xEXTORPHANUSDT' },
    ];
    const items = [
      {
        matchStatus: 'ORPHAN_INTERNAL',
        internalSourceNo: 'REF-DEMO-1-AED',
        externalTxId: null,
        externalTxHash: null,
        internalTxHash: null,
        _currency: 'AED',
        _book: 'CLIENT',
      },
      {
        // extra (not injected)
        matchStatus: 'AMOUNT_MISMATCH',
        internalSourceNo: 'REF-DEMO-2-AED',
        externalTxId: null,
        externalTxHash: null,
        internalTxHash: null,
        _currency: 'AED',
        _book: 'CLIENT',
      },
    ];
    const r = pairManifest(breaks as any, items as any);
    expect(r.matched).toHaveLength(1);
    expect(r.missed).toHaveLength(1); // the USDT FIRM orphan-external
    expect(r.extra).toHaveLength(1); // the AED amount-mismatch
  });

  it('matches on externalTxId when targetRef equals externalTxId', () => {
    const breaks = [{ currency: 'USDT', book: 'CLIENT', bucket: 'ORPHAN_EXTERNAL', targetRef: '0xEXT123' }];
    const items = [
      {
        matchStatus: 'ORPHAN_EXTERNAL',
        internalSourceNo: null,
        externalTxId: '0xEXT123',
        externalTxHash: null,
        internalTxHash: null,
        _currency: 'USDT',
        _book: 'CLIENT',
      },
    ];
    const r = pairManifest(breaks as any, items as any);
    expect(r.matched).toHaveLength(1);
    expect(r.missed).toHaveLength(0);
    expect(r.extra).toHaveLength(0);
  });

  it('matches on internalTxHash when targetRef equals internalTxHash', () => {
    const breaks = [{ currency: 'USDT', book: 'CLIENT', bucket: 'ORPHAN_INTERNAL', targetRef: '0xTXHASH1' }];
    const items = [
      {
        matchStatus: 'ORPHAN_INTERNAL',
        internalSourceNo: null,
        externalTxId: null,
        externalTxHash: null,
        internalTxHash: '0xTXHASH1',
        _currency: 'USDT',
        _book: 'CLIENT',
      },
    ];
    const r = pairManifest(breaks as any, items as any);
    expect(r.matched).toHaveLength(1);
    expect(r.missed).toHaveLength(0);
    expect(r.extra).toHaveLength(0);
  });

  it('returns all missed when no items exist', () => {
    const breaks = [
      { currency: 'AED', book: 'CLIENT', bucket: 'ORPHAN_INTERNAL', targetRef: 'REF-X' },
    ];
    const r = pairManifest(breaks as any, []);
    expect(r.matched).toHaveLength(0);
    expect(r.missed).toHaveLength(1);
    expect(r.extra).toHaveLength(0);
  });

  it('returns all extra when no breaks exist', () => {
    const items = [
      {
        matchStatus: 'AMOUNT_MISMATCH',
        internalSourceNo: 'REF-Y',
        externalTxId: null,
        externalTxHash: null,
        internalTxHash: null,
        _currency: 'AED',
        _book: 'CLIENT',
      },
    ];
    const r = pairManifest([], items as any);
    expect(r.matched).toHaveLength(0);
    expect(r.missed).toHaveLength(0);
    expect(r.extra).toHaveLength(1);
  });
});
