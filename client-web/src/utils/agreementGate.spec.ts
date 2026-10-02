import { agreementGateState, shouldSuppressModal, type AgreementGateState } from './agreementGate';
import type { AgreementConsent, AgreementMe } from './agreementView';

// 四态判定只读 pending 是否存在 + consent 五键，不读版本正文——夹具只造这两块。
const consent = (patch: Partial<AgreementConsent>): AgreementConsent => ({
  acceptedVersionKey: null,
  acceptedAt: null,
  acceptedCurrent: false,
  acceptedPending: false,
  declinedCurrentAt: null,
  ...patch,
});

const pendingVersion = { versionKey: 'v2', effectiveAt: '2026-11-01T00:00:00.000Z', summary: 's', sections: [] };

const me = (hasPending: boolean, patch: Partial<AgreementConsent>): Pick<AgreementMe, 'pending' | 'consent'> => ({
  pending: hasPending ? pendingVersion : null,
  consent: consent(patch),
});

describe('agreementGateState', () => {
  it.each([
    ['①已同意生效版、无在途版 → NONE', me(false, { acceptedCurrent: true }), 'NONE'],
    [
      '②已同意生效版、在途版在、未提前同意 → PENDING_DISMISSIBLE（可关弹窗）',
      me(true, { acceptedCurrent: true, acceptedPending: false }),
      'PENDING_DISMISSIBLE',
    ],
    [
      '③已同意生效版、在途版在、已提前同意 → NONE（提前同意静默）',
      me(true, { acceptedCurrent: true, acceptedPending: true }),
      'NONE',
    ],
    [
      '④生效版未同意、从未拒绝 → EFFECTIVE_BLOCKING（强制弹窗）',
      me(false, { acceptedCurrent: false, declinedCurrentAt: null }),
      'EFFECTIVE_BLOCKING',
    ],
    [
      '⑤生效版未同意、拒绝过 → DECLINED_BANNER（横幅常驻）',
      me(false, { acceptedCurrent: false, declinedCurrentAt: '2026-10-03T00:00:00.000Z' }),
      'DECLINED_BANNER',
    ],
  ])('%s', (_name, input, expected) => {
    expect(agreementGateState(input)).toBe(expected);
  });

  it('生效版未同意时，在途版不改变结论（生效版优先：④⑤不被在途版掩盖）', () => {
    expect(agreementGateState(me(true, { acceptedCurrent: false }))).toBe('EFFECTIVE_BLOCKING');
    expect(
      agreementGateState(me(true, { acceptedCurrent: false, declinedCurrentAt: '2026-10-03T00:00:00.000Z' })),
    ).toBe('DECLINED_BANNER');
  });

  it('生效版未同意时，acceptedPending=true 也不能让它静默（不得把提前同意当成已同意生效版）', () => {
    expect(agreementGateState(me(true, { acceptedCurrent: false, acceptedPending: true }))).toBe(
      'EFFECTIVE_BLOCKING',
    );
  });

  it('acceptedCurrent=true 时旧的 declinedCurrentAt 不再触发横幅（拒绝后又同意）', () => {
    expect(
      agreementGateState(me(false, { acceptedCurrent: true, declinedCurrentAt: '2026-10-03T00:00:00.000Z' })),
    ).toBe('NONE');
  });

  it('pending 为空而 acceptedPending=false 的已同意客户 → NONE（没有在途版就没有可关弹窗）', () => {
    expect(agreementGateState(me(false, { acceptedCurrent: true, acceptedPending: false }))).toBe('NONE');
  });
});

describe('shouldSuppressModal（弹窗在 /agreement 阅读页让位，只豁免弹窗不豁免横幅）', () => {
  it.each<[string, AgreementGateState, string, boolean]>([
    ['强制弹窗 + /agreement → 让位', 'EFFECTIVE_BLOCKING', '/agreement', true],
    ['可关弹窗 + /agreement → 让位', 'PENDING_DISMISSIBLE', '/agreement', true],
    ['横幅 + /agreement → 不让位（横幅不是弹窗）', 'DECLINED_BANNER', '/agreement', false],
    ['NONE + /agreement → 无弹窗可让，false', 'NONE', '/agreement', false],
    ['强制弹窗 + 其它页 /swap → 照常弹', 'EFFECTIVE_BLOCKING', '/swap', false],
    ['强制弹窗 + 根路径 / → 照常弹', 'EFFECTIVE_BLOCKING', '/', false],
    ['可关弹窗 + 其它页 /deposit → 照常弹', 'PENDING_DISMISSIBLE', '/deposit', false],
    ['强制弹窗 + /agreement/ 尾斜杠 → 让位（路由同样匹配）', 'EFFECTIVE_BLOCKING', '/agreement/', true],
    ['强制弹窗 + /Agreement 大小写 → 让位（路由默认不分大小写）', 'EFFECTIVE_BLOCKING', '/Agreement', true],
    ['强制弹窗 + /agreements（前缀相近的别页）→ 照常弹', 'EFFECTIVE_BLOCKING', '/agreements', false],
    ['强制弹窗 + /agreement-history → 照常弹', 'EFFECTIVE_BLOCKING', '/agreement-history', false],
  ])('%s', (_name, state, pathname, expected) => {
    expect(shouldSuppressModal(state, pathname)).toBe(expected);
  });
});
