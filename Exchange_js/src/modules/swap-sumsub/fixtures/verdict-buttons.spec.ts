import { SWAP_VERDICT_BUTTONS } from './verdict-buttons';

/**
 * 终审 Important #4：externalActionId 是材料请求账全表 @unique（不像旧子表
 * 按 (订单id, seq) 分段去重）—— fixture 若把它写成固定字面量，两笔不同的
 * swap 单先后点同一个按钮就会在 issuer.register() 时撞唯一约束（P2002），
 * 第二次 500。V3/V4/V6 的 applicantActions 已改成按调用现铸（getter），这里
 * 钉住"连续两次读取不同"，防止有人图省事把 getter 改回静态数组。
 *
 * deposit-sumsub / withdraw-sumsub 两个姊妹域已有同款 fixtures/verdict-buttons.spec.ts，
 * 本文件是兑换域缺的那一份（此前不存在）。
 */
describe('SWAP_VERDICT_BUTTONS', () => {
  it('③④⑥ 带 applicantActions —— 否则详情页 Applicant Action IDs 永远空', () => {
    expect(SWAP_VERDICT_BUTTONS.V3_REJECTED_ACTION.verdict.applicantActions?.length).toBeGreaterThan(0);
    expect(SWAP_VERDICT_BUTTONS.V4_REJECTED_SANCTION.verdict.applicantActions?.length).toBeGreaterThan(0);
    expect(SWAP_VERDICT_BUTTONS.V6_AWAIT_USER.verdict.applicantActions?.length).toBeGreaterThan(0);
  });

  it('③④⑥ 的 applicantActions 每次读都现铸，连续两次访问 externalActionId 不同', () => {
    for (const key of ['V3_REJECTED_ACTION', 'V4_REJECTED_SANCTION', 'V6_AWAIT_USER'] as const) {
      const first = SWAP_VERDICT_BUTTONS[key].verdict.applicantActions;
      const second = SWAP_VERDICT_BUTTONS[key].verdict.applicantActions;
      expect(first?.[0].externalActionId).toBeTruthy();
      expect(first?.[0].externalActionId).not.toBe(second?.[0].externalActionId);
      expect(first?.[0].applicantActionId).not.toBe(second?.[0].applicantActionId);
    }
  });

  it('② 硬线场景保持零 action（无认证入口可下发）', () => {
    expect(SWAP_VERDICT_BUTTONS.V2_REJECTED_HARD.verdict.applicantActions).toEqual([]);
  });
});
