// Task 8：buildCaseConclusion 英文三口径回归测试——前端 .spec 不在闸门覆盖内，
// 随代码写是防漂移（brief 环境说明第 7 条）。fmt 用真实 formatAmount 等价的简化
// 实现（最小单位整数字符串 → 千分位小数），与页面实际传入的 formatter 行为一致。
import { buildCaseConclusion, type CaseConclusionInput } from './caseConclusion';

const fmt = (v: string): string => {
  const neg = v.startsWith('-');
  const body = neg ? v.slice(1) : v;
  const padded = body.padStart(3, '0');
  const intPart = padded.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fracPart = padded.slice(-2);
  return `${neg ? '-' : ''}${intPart}.${fracPart}`;
};

const base: CaseConclusionInput = {
  bucket: 'BREAK',
  status: 'OPEN',
  assetCode: 'AED',
  walletRef: 'wallet-ref-1',
  walletNo: 'WA2601019534',
  coaCode: 'L.CLIENT_PAYABLE',
  deltaAmount: '-73550',
  actualExternal: '2426450',
};

describe('buildCaseConclusion', () => {
  it('bucket=null（历史 case）不渲染结论', () => {
    expect(buildCaseConclusion({ ...base, bucket: null }, fmt)).toBeNull();
  });

  it('无主外部账户 → 规则1', () => {
    const c = buildCaseConclusion({ ...base, walletNo: null, coaCode: null }, fmt);
    expect(c).toEqual({
      text: 'External account wallet-ref-1 cannot be attributed to any wallet — balance 24,264.50 AED pending claim.',
      tone: 'red',
    });
  });

  it('BREAK + 无已解释行 → 全额未解释模板', () => {
    const c = buildCaseConclusion({ ...base, explainedSum: '0' }, fmt);
    expect(c).toEqual({
      text: 'External balance is 735.50 AED short of our books — no in-transit cover, full amount unexplained.',
      tone: 'red',
    });
  });

  it('BREAK + explainedSum 未传（undefined）同样落全额未解释模板', () => {
    const c = buildCaseConclusion(base, fmt);
    expect(c?.text).toContain('full amount unexplained.');
  });

  it('BREAK + 存在已解释行 → 已解释模板（不出现"全额未解释"字样）', () => {
    const c = buildCaseConclusion({ ...base, explainedSum: '22800' }, fmt);
    expect(c).toEqual({
      text: 'External balance is 735.50 AED short of our books — no in-transit cover; 228.00 explained, awaiting re-reconcile.',
      tone: 'red',
    });
    expect(c?.text).not.toContain('full amount unexplained');
  });

  it('BREAK + deltaAmount 正值（盈余案，外部多于账上）→ in excess of，不说反话', () => {
    const c = buildCaseConclusion({ ...base, deltaAmount: '73550', explainedSum: '0' }, fmt);
    expect(c).toEqual({
      text: 'External balance is 735.50 AED in excess of our books — no in-transit cover, full amount unexplained.',
      tone: 'red',
    });
    expect(c?.text).not.toContain('short of');
  });

  it('BREAK + 在途非零 → 部分覆盖措辞（不重复金额数字），且不已解释分支同样适用', () => {
    const c = buildCaseConclusion({ ...base, explain: { inTransitSigned: '5000', residual: '0' }, explainedSum: '0' }, fmt);
    expect(c).toEqual({
      text: 'External balance is 735.50 AED short of our books — partly covered by in-transit orders, full amount unexplained.',
      tone: 'red',
    });
    expect(c?.text).not.toContain('no in-transit cover');
  });

  it('BREAK + 在途非零 + 存在已解释行 → 部分覆盖措辞落已解释模板分支', () => {
    const c = buildCaseConclusion({ ...base, explain: { inTransitSigned: '5000', residual: '0' }, explainedSum: '22800' }, fmt);
    expect(c).toEqual({
      text: 'External balance is 735.50 AED short of our books — partly covered by in-transit orders; 228.00 explained, awaiting re-reconcile.',
      tone: 'red',
    });
  });

  it('IN_TRANSIT → 在途全覆盖模板', () => {
    const c = buildCaseConclusion({ ...base, bucket: 'IN_TRANSIT' }, fmt);
    expect(c).toEqual({
      text: 'External balance is 735.50 AED short of our books — fully covered by in-transit orders.',
      tone: 'blue',
    });
  });

  it('COMPENSATING → 假匹配待核', () => {
    const c = buildCaseConclusion({
      ...base, bucket: 'COMPENSATING',
      flowSummary: { orphanInternal: 1, orphanExternal: 1, mismatch: 0 },
    }, fmt);
    expect(c).toEqual({
      text: "Balances are matched, but 2 flows don't line up — false match pending review.",
      tone: 'amber',
    });
  });

  it('COMPENSATING 单数 flow 不加 s', () => {
    const c = buildCaseConclusion({
      ...base, bucket: 'COMPENSATING',
      flowSummary: { orphanInternal: 1, orphanExternal: 0, mismatch: 0 },
    }, fmt);
    expect(c?.text).toContain("1 flow don't line up");
  });

  it('RESOLVED 状态在任意 bucket 结论前加 "Resolved · " 且 tone 归 neutral', () => {
    const c = buildCaseConclusion({ ...base, status: 'RESOLVED', explainedSum: '0' }, fmt);
    expect(c?.text.startsWith('Resolved · External balance is')).toBe(true);
    expect(c?.tone).toBe('neutral');
  });
});
