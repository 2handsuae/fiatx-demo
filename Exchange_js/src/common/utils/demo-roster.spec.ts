// 实现在 scripts/demo-roster.ts（花名册的自然归属：demo:all 等造数脚本都在 scripts/）。
// spec 挪到这里而非同目录，是因为 jest.config.js 的 roots 只覆盖
// src/、admin-web/src/、client-web/src/ —— scripts/ 下的 *.spec.ts 会被 0 匹配，
// 静默/报错不跑（"No tests found"），而不是真的执行断言。src/common/utils/ 已经
// 是本仓库放"确定性、面向 demo 的纯函数"测试的地方（对照同目录的
// fake-external-refs.util.spec.ts），故复用这里，不新建目录、不改 jest 配置。
import { DEMO_ROSTER, printAnswerKey } from '../../../scripts/demo-roster';

describe('DEMO_ROSTER', () => {
  it('三域全覆盖、seq 唯一且连续', () => {
    // ⚠️ 这条**刻意不断言"共几笔"**。原来写死 `toHaveLength(21)`，2026-08-30 花名册
    // 加 8 行素材单时它当场变红——而加行是正常演进，不是缺陷。写死行数等于每次
    // 加行都要有人记得回来改这里，跟 runDeposits 那个缺 default 的 switch 是同一类陷阱。
    //
    // 但换法**不是纯赚，是一次交换**（2026-08-30 复审实测，不是推断）：
    //   旧写法  能抓任何一行被删（含删最后一行）；代价是每次合法加行都要手动改数字
    //   新写法  加行免维护、且能抓住 seq 重复与中间缺号（旧的抓不到）；
    //          代价是**抓不住"删掉当前最后一行"**——剩下的 1..N-1 是个合法序列，
    //          结构上与"本来就该有 N-1 行"无法区分。这是同类不变量的数学必然。
    // 下面那条单调下限就是为补这个盲区加的。
    // 「承诺的终态都有样本」由本文件后面三条（处置弧 / 在途单）覆盖。
    const byDomain = DEMO_ROSTER.reduce<Record<string, number>>((a, r) => {
      a[r.domain] = (a[r.domain] ?? 0) + 1; return a;
    }, {});
    expect(Object.keys(byDomain).sort()).toEqual(['DEPOSIT', 'SWAP', 'WITHDRAW']);

    const seqs = DEMO_ROSTER.map((r) => r.seq).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(seqs.length);        // 无重复
    expect(seqs[0]).toBe(1);                              // 从 1 起
    expect(seqs[seqs.length - 1]).toBe(seqs.length);      // 无空洞

    // 单调下限：补上上面那组不变量的盲区——"删掉当前最后一行"会留下一个
    // 合法的 1..N-1 序列，结构检查看不出来。下限只在**变少**时报警，
    // 加行永远不会误报，所以不会退回"每次加行都要手动改精确值"的老路。
    // 代价：下限本身会慢慢过时（将来加到 40 行时它不会主动提醒你抬高），
    // 但**过时的下限仍然好过没有下限**。
    expect(DEMO_ROSTER.length).toBeGreaterThanOrEqual(29);
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
