import {
  agreementDrawerByline,
  agreementStatusLines,
  agreementVersionTabs,
  DRAWER_BYLINE_FALLBACK,
  type AgreementConsent,
  type AgreementMe,
} from './agreementView';

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
  previous: null,
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

describe('agreementVersionTabs', () => {
  const v1 = version('v1', '2025-01-01T00:00:00.000Z');
  const v2 = version('v2', '2026-01-01T00:00:00.000Z');
  const v3 = version('v3', '2027-01-01T00:00:00.000Z');

  it('只有生效版 → 单项（调用方据 length<2 不出切换钮）', () => {
    expect(agreementVersionTabs({ previous: null, current: v1, pending: null }).map((t) => t.key)).toEqual(['current']);
  });

  it('⚡生效后（v1 退位、v2 生效、无在途）→ [previous=v1 Superseded, current=v2 In effect]', () => {
    const tabs = agreementVersionTabs({ previous: v1, current: v2, pending: null });
    expect(tabs.map((t) => [t.key, t.version.versionKey, t.tag])).toEqual([
      ['previous', 'v1', 'Superseded'],
      ['current', 'v2', 'In effect'],
    ]);
  });

  it('通知期（v1 生效、v2 在途、无退位版）→ [current, pending]，与旧行为一致', () => {
    expect(agreementVersionTabs({ previous: null, current: v1, pending: v2 }).map((t) => t.key)).toEqual(['current', 'pending']);
  });

  it('三版齐全 → 按 [previous, current, pending] 顺序', () => {
    const tabs = agreementVersionTabs({ previous: v1, current: v2, pending: v3 });
    expect(tabs.map((t) => [t.key, t.version.versionKey])).toEqual([
      ['previous', 'v1'],
      ['current', 'v2'],
      ['pending', 'v3'],
    ]);
  });
});

describe('agreementDrawerByline（注册页条款抽屉页眉）', () => {
  it('取到生效版 → Version {versionKey} + Effective · 本地日（YYYY.MM.DD，补零）', () => {
    // 正午 UTC：-12..+11 任何机器时区下本地日都是 2026-03-05，硬编码期望串不随机器时区漂。
    const out = agreementDrawerByline({ versionKey: 'v2', effectiveAt: '2026-03-05T12:00:00.000Z' });
    expect(out).toEqual({ issued: 'Effective · 2026.03.05 · Dubai, UAE', version: 'Version v2' });
  });

  it('没取回（null）→ 原样回落原字面', () => {
    expect(agreementDrawerByline(null)).toEqual({ issued: 'Issued · 2025.IV · Dubai, UAE', version: 'Version 1.0' });
    expect(DRAWER_BYLINE_FALLBACK.version).toBe('Version 1.0');
  });

  it('生效日缺失（理论上不会）→ 版本号用实值，日期位回落原字面，不出现 Invalid Date', () => {
    const out = agreementDrawerByline({ versionKey: 'v3', effectiveAt: null });
    expect(out.version).toBe('Version v3');
    expect(out.issued).toBe('Issued · 2025.IV · Dubai, UAE');
  });
});
