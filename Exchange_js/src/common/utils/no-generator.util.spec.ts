import { generateReferenceNo, buildDeterministicNo } from './no-generator.util';

/**
 * 守则性断言：锁住单号的随机位宽。
 *
 * 2026-09-01 之前是 `Math.random() * 10000`——同一天同一前缀只有 1 万个坑，
 * 而一次 `demo:all` 要造几十张资金单，按生日问题约 7–20% 撞 `fundsOrderNo`
 * 的唯一约束（当天连撞两次实测），挡住的是造演示数据本身。
 *
 * 这几条测试存在的唯一目的，是让"有人把随机位改窄"这件事当场被抓住。
 */
describe('generateReferenceNo —— 单号随机位宽（业主 2026-09-01 定：6 位）', () => {
  it('格式 = 前缀 + 6 位日期(YYMMDD) + 6 位随机', () => {
    const no = generateReferenceNo('DEP');
    expect(no).toMatch(/^DEP\d{6}\d{6}$/);

    const d = new Date();
    const yymmdd =
      d.getFullYear().toString().slice(-2) +
      (d.getMonth() + 1).toString().padStart(2, '0') +
      d.getDate().toString().padStart(2, '0');
    expect(no.slice(3, 9)).toBe(yymmdd);
  });

  it('随机段恰好 6 位——改窄回 4 位会在这里被抓住', () => {
    for (const prefix of ['DEP', 'WD', 'SWP', 'FO']) {
      const suffix = generateReferenceNo(prefix).slice(prefix.length + 6);
      expect(suffix).toHaveLength(6);
    }
  });

  it('前导零不被吃掉（padStart 生效）', () => {
    // 直接断言小值也补满 6 位：随机段永远是 6 个字符，不会因为数值小而变短
    const lengths = new Set(
      // 随机段起点 = 前缀长度 + 6 位日期（'FO' 是 2 字符，不是 3——原写死 slice(9) 会多切一位）
      Array.from({ length: 500 }, () => generateReferenceNo('FO').slice('FO'.length + 6).length),
    );
    expect([...lengths]).toEqual([6]);
  });

  it('1000 次生成撞号 ≤ 5 次（6 位位宽期望 0.5 次；4 位位宽期望约 50 次，必超）', () => {
    // 同一天同前缀的号池是 10^6：抽 1000 个按生日问题约 39% 概率至少撞一次，
    // 断言「零撞号」本身每三轮就假红一轮（2026-09-02 十连跑实测 2 红）。
    // 阈值 5 两边都远离期望：6 位下 P(撞>5)≈2×10⁻⁵，4 位下 P(撞≤5)≈10⁻¹⁵——
    // 抓「改窄位宽」的判别力不变，假红率降到可忽略。
    const nos = Array.from({ length: 1000 }, () => generateReferenceNo('FO'));
    const collisions = nos.length - new Set(nos).size;
    expect(collisions).toBeLessThanOrEqual(5);
  });
});

describe('buildDeterministicNo —— 确定性生成（种子幂等靠它，刻意不动）', () => {
  it('同输入同输出', () => {
    expect(buildDeterministicNo('CU', 'a@b.com')).toBe(buildDeterministicNo('CU', 'a@b.com'));
  });

  it('不同输入不同输出', () => {
    expect(buildDeterministicNo('CU', 'a@b.com')).not.toBe(buildDeterministicNo('CU', 'c@d.com'));
  });

  it('日期段恒为 260101——它不是"今天"，是固定锚，重铺后种子单号才不变', () => {
    expect(buildDeterministicNo('AS', 'FIAT', 'AED', '')).toMatch(/^AS260101\d{4}$/);
  });
});
