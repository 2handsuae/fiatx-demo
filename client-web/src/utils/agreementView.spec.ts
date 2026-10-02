import { agreementStatusLines, type AgreementConsent, type AgreementMe } from './agreementView';

const fmt = (iso: string) => `<${iso}>`;

const version = (versionKey: string, effectiveAt: string | null) => ({
  versionKey,
  effectiveAt,
  summary: `${versionKey} summary`,
  sections: [],
});

const consent = (patch: Partial<AgreementConsent>): AgreementConsent => ({
  acceptedVersionKey: null,
  acceptedAt: null,
  acceptedCurrent: false,
  acceptedPending: false,
  declinedCurrentAt: null,
  ...patch,
});

const me = (patch: { pending?: boolean; consent: Partial<AgreementConsent> }): AgreementMe => ({
  current: version('v1', '2026-01-01T00:00:00.000Z'),
  pending: patch.pending ? version('v2', '2026-11-01T00:00:00.000Z') : null,
  consent: consent(patch.consent),
});

describe('agreementStatusLines', () => {
  it('已同意生效版、无在途版 → 单行 ACCEPTED（版本与时刻取 consent）', () => {
    const lines = agreementStatusLines(
      me({ consent: { acceptedCurrent: true, acceptedVersionKey: 'v1', acceptedAt: '2026-02-02T00:00:00.000Z' } }),
      fmt,
    );
    expect(lines).toEqual([
      { kind: 'ACCEPTED', text: 'You accepted version v1 on <2026-02-02T00:00:00.000Z>.' },
    ]);
  });

  it('生效版未表态 → AWAITING_CONSENT，带同意按钮目标版本', () => {
    const lines = agreementStatusLines(me({ consent: {} }), fmt);
    expect(lines).toEqual([
      {
        kind: 'AWAITING_CONSENT',
        text: 'Version v1 is in effect and still needs your acceptance.',
        acceptVersionKey: 'v1',
      },
    ]);
  });

  it('生效版已拒绝 → AWAITING_CONSENT 追加拒绝时刻，按钮仍在', () => {
    const lines = agreementStatusLines(
      me({ consent: { declinedCurrentAt: '2026-03-03T00:00:00.000Z' } }),
      fmt,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'AWAITING_CONSENT', acceptVersionKey: 'v1' });
    expect(lines[0].text).toContain('You declined it on <2026-03-03T00:00:00.000Z>.');
  });

  it('已同意生效版 + 在途新版未提前同意 → ACCEPTED + PENDING_NOTICE（带生效日，无已同意尾句）', () => {
    const lines = agreementStatusLines(
      me({
        pending: true,
        consent: { acceptedCurrent: true, acceptedVersionKey: 'v1', acceptedAt: '2026-02-02T00:00:00.000Z' },
      }),
      fmt,
    );
    expect(lines.map((l) => l.kind)).toEqual(['ACCEPTED', 'PENDING_NOTICE']);
    expect(lines[1].text).toBe('A new version v2 takes effect on <2026-11-01T00:00:00.000Z>.');
  });

  it('在途新版已提前同意 → PENDING_NOTICE 追加已同意尾句；ACCEPTED 行取最近一次同意（v2）', () => {
    const lines = agreementStatusLines(
      me({
        pending: true,
        consent: {
          acceptedCurrent: true,
          acceptedPending: true,
          acceptedVersionKey: 'v2',
          acceptedAt: '2026-10-10T00:00:00.000Z',
        },
      }),
      fmt,
    );
    expect(lines[0].text).toBe('You accepted version v2 on <2026-10-10T00:00:00.000Z>.');
    expect(lines[1].text).toBe(
      'A new version v2 takes effect on <2026-11-01T00:00:00.000Z>. You have already accepted it.',
    );
  });

  it('生效版未表态且有在途版 → AWAITING_CONSENT + PENDING_NOTICE 并存', () => {
    const lines = agreementStatusLines(me({ pending: true, consent: {} }), fmt);
    expect(lines.map((l) => l.kind)).toEqual(['AWAITING_CONSENT', 'PENDING_NOTICE']);
  });
});
