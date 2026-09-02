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

  // ── 这条断言的统计依据（2026-09-02 改写，业主裁定「改断言」）──────────────
  // 原写法是 `expect(seen.size).toBe(1000)`，即「1000 次生成一次都不撞」。
  // 那是一条**自相矛盾**的断言：它要求的事情按设计就不该总成立。
  //   生日问题：N = 10⁶ 个坑（6 位随机），抽 n = 1000 次，
  //   碰撞对数的期望 λ = C(n,2)/N = 499,500 / 10⁶ ≈ 0.4995。
  //   「一次都不撞」的概率仅 e^(−λ) ≈ 61% —— 也就是说原断言约 **39% 会红**，
  //   而且红得毫无信息量（随机数就该偶尔撞）。
  //
  // 改成给碰撞数设上界。碰撞数近似服从 Poisson(0.5)：
  //   P(X ≥ 8) = Σ_{k≥8} e^(−0.5)·0.5^k/k! ≈ 6×10⁻⁸
  // 即本条的假阳性率约六千万分之一 —— 连跑一辈子也不该见它红一次。
  //
  // **判别力没有丢**，这才是关键：位宽若改回 4 位（N = 10⁴），
  //   λ = 499,500 / 10⁴ ≈ 50，实际碰撞数 ≈ n − N·(1−(1−1/N)ⁿ) ≈ 48，
  //   远超上界 8 → 当场红。这正是本条要守住的性质：
  //   **4 位那个量级必撞，6 位不会常撞。**
  //
  // 实测（2026-09-02，各 200 轮 × 1000 次抽样）：
  //   6 位：碰撞数均值 0.42、最大 3、**0/200 轮超过上界 8**
  //   4 位：碰撞数均值 49.19、最小 35、**200/200 轮超过上界 8**
  // 与上面的理论值一致，两侧都留着足够余量。
  //
  // （`randomUUID` 取 8 位十六进制再 % 10⁶ 有轻微取模偏斜：2³² / 10⁶ ≈ 4294.97，
  //   前 967,296 个值各多一个原像。这把 λ 抬高不到万分之一，对上界 8 无影响。）
  const SAMPLE = 1000;
  const MAX_COLLISIONS = 8;

  it(`${SAMPLE} 次生成的碰撞数 ≤ ${MAX_COLLISIONS}（6 位期望约 0.5；改窄回 4 位约 48，必被抓住）`, () => {
    const nos = Array.from({ length: SAMPLE }, () => generateReferenceNo('FO'));
    const collisions = SAMPLE - new Set(nos).size;
    expect(collisions).toBeLessThanOrEqual(MAX_COLLISIONS);
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
