// 戊波二 T10：案件页 Internal 格副行 + 跑批页 Internal check 列的纯函数回归。
// fmt 用与页面 formatAmount 等价的简化实现（最小单位整数字符串 → 千分位两位小数）。
import { buildInternalCheckLine, hasInternalBreak, internalCheckCell, listBooksDelta } from './caseInternalCheck';

const fmt = (v: string): string => {
  const neg = v.startsWith('-');
  const body = neg ? v.slice(1) : v;
  const padded = body.padStart(3, '0');
  const intPart = padded.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${intPart}.${padded.slice(-2)}`;
};

describe('buildInternalCheckLine', () => {
  it('Δ = 0：Cash + Shortfall ｜ Payable + Held ｜ Δ 0.00，deltaZero', () => {
    const l = buildInternalCheckLine({ cash: '100000', shortfall: '25000', payable: '120000', suspense: '5000', delta: '0' }, fmt);
    expect(l.text).toBe('Cash 1,000.00 + Shortfall 250.00 ｜ Payable 1,200.00 + Held 50.00 ｜ Δ 0.00');
    expect(l.deltaZero).toBe(true);
    expect(l.delta).toBe('0.00');
  });

  it('Δ > 0 带正号、Δ < 0 带负号，都不是 deltaZero（这两个才上红）', () => {
    const up = buildInternalCheckLine({ cash: '100500', shortfall: '0', payable: '100000', suspense: '0', delta: '500' }, fmt);
    expect(up.delta).toBe('+5.00');
    expect(up.deltaZero).toBe(false);
    expect(up.text.endsWith('｜ Δ +5.00')).toBe(true);
    const down = buildInternalCheckLine({ cash: '100000', shortfall: '0', payable: '125000', suspense: '0', delta: '-25000' }, fmt);
    expect(down.delta).toBe('-250.00');
    expect(down.deltaZero).toBe(false);
  });

  it('head 恰好是不含 Δ 的前两段（JSX 在其后单独渲染 Δ）', () => {
    const l = buildInternalCheckLine({ cash: '1', shortfall: '2', payable: '3', suspense: '4', delta: '0' }, fmt);
    expect(l.text).toBe(`${l.head} ｜ Δ ${l.delta}`);
    expect(l.head).toBe('Cash 0.01 + Shortfall 0.02 ｜ Payable 0.03 + Held 0.04');
  });
});

describe('internalCheckCell', () => {
  it('null / undefined（公司钱包、老快照行）→ na', () => {
    expect(internalCheckCell(null, fmt)).toEqual({ kind: 'na' });
    expect(internalCheckCell(undefined, fmt)).toEqual({ kind: 'na' });
  });
  it("'0' → ok（✓）；'-0' 也算 0", () => {
    expect(internalCheckCell('0', fmt)).toEqual({ kind: 'ok' });
    expect(internalCheckCell('-0', fmt)).toEqual({ kind: 'ok' });
  });
  it('非零 → break，带符号的差额', () => {
    expect(internalCheckCell('25000', fmt)).toEqual({ kind: 'break', text: '+250.00' });
    expect(internalCheckCell('-25000', fmt)).toEqual({ kind: 'break', text: '-250.00' });
  });
});

describe('hasInternalBreak', () => {
  const b = (delta: string) => ({ cash: '1', shortfall: '0', payable: '1', suspense: '0', delta });
  it('Δ ≠ 0（正负都算）→ true；Δ = 0 / 无副行（公司钱包案）→ false', () => {
    expect(hasInternalBreak(b('25000'))).toBe(true);
    expect(hasInternalBreak(b('-25000'))).toBe(true);
    expect(hasInternalBreak(b('0'))).toBe(false);
    expect(hasInternalBreak(b('-0'))).toBe(false);
    expect(hasInternalBreak(null)).toBe(false);
    expect(hasInternalBreak(undefined)).toBe(false);
  });
});

describe('listBooksDelta（案件列表 Δ 格的账内 Δ）', () => {
  it('开着的案子对内差额 ≠ 0 → 带符号文本（正 +、负 -）', () => {
    expect(listBooksDelta({ status: 'OPEN', internalDeltaAmount: '25000' }, fmt)).toBe('+250.00');
    expect(listBooksDelta({ status: 'OPEN', internalDeltaAmount: '-25000' }, fmt)).toBe('-250.00');
  });
  it('0 / null / 缺省（公司钱包案、老案）→ null', () => {
    expect(listBooksDelta({ status: 'OPEN', internalDeltaAmount: '0' }, fmt)).toBeNull();
    expect(listBooksDelta({ status: 'OPEN', internalDeltaAmount: null }, fmt)).toBeNull();
    expect(listBooksDelta({ status: 'OPEN' }, fmt)).toBeNull();
  });
  it('已结案（库里留着破口那一刻的值，账早已更正）→ null，不能再亮红 Δ', () => {
    expect(listBooksDelta({ status: 'RESOLVED', internalDeltaAmount: '25000' }, fmt)).toBeNull();
  });
});
