// 实现在 scripts/demo-roster.ts（花名册的自然归属：demo:all 等造数脚本都在 scripts/）。
// spec 挪到这里而非同目录，是因为 jest.config.js 的 roots 只覆盖
// src/、admin-web/src/、client-web/src/ —— scripts/ 下的 *.spec.ts 会被 0 匹配，
// 静默/报错不跑（"No tests found"），而不是真的执行断言。src/common/utils/ 已经
// 是本仓库放"确定性、面向 demo 的纯函数"测试的地方（对照同目录的
// fake-external-refs.util.spec.ts），故复用这里，不新建目录、不改 jest 配置。
import { DEMO_ROSTER, printAnswerKey } from '../../../scripts/demo-roster';

describe('DEMO_ROSTER', () => {
  it('20 笔单，覆盖三域', () => {
    expect(DEMO_ROSTER).toHaveLength(20);
    const byDomain = DEMO_ROSTER.reduce<Record<string, number>>((a, r) => {
      a[r.domain] = (a[r.domain] ?? 0) + 1; return a;
    }, {});
    expect(byDomain).toEqual({ DEPOSIT: 10, SWAP: 3, WITHDRAW: 7 });
  });

  it('金额全部写死，没有随机', () => {
    for (const r of DEMO_ROSTER) expect(r.amount).toMatch(/^\d+(\.\d+)?$/);
    // 两次 import 拿到同一批值
    const snapshot = JSON.stringify(DEMO_ROSTER);
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    expect(JSON.stringify(require('../../../scripts/demo-roster').DEMO_ROSTER)).toEqual(snapshot);
  });

  it('三条处置弧都在花名册里', () => {
    const states = DEMO_ROSTER.map((r) => r.expectedStatus);
    expect(states).toContain('CONFISCATED');
    expect(states).toContain('RETURNED');
    expect(states).toContain('SEIZED');
  });

  it('在途单是花名册的一行，不是特例', () => {
    const inTransit = DEMO_ROSTER.find((r) => r.expectedStatus === 'PAYOUT_PENDING');
    expect(inTransit).toBeDefined();
    expect(inTransit!.domain).toBe('WITHDRAW');
  });

  it('printAnswerKey：全部符合预期 → pass', () => {
    const actual = DEMO_ROSTER.map((r) => ({ seq: r.seq, orderNo: `NO${r.seq}`, status: r.expectedStatus }));
    expect(printAnswerKey(actual).pass).toBe(true);
  });

  it('printAnswerKey：有一笔状态不符 → fail，且指出是哪一笔', () => {
    const actual = DEMO_ROSTER.map((r) => ({ seq: r.seq, orderNo: `NO${r.seq}`, status: r.expectedStatus }));
    actual[7].status = 'SUCCESS';
    const res = printAnswerKey(actual);
    expect(res.pass).toBe(false);
    expect(res.lines.join('\n')).toContain(DEMO_ROSTER[7].label);
  });
});
