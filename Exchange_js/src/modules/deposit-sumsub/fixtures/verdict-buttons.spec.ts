import { DEPOSIT_VERDICT_BUTTONS } from './verdict-buttons';
import { KYT_VERDICT_TYPES } from '../../sumsub-shared/kyt-webhook-types';

describe('DEPOSIT_VERDICT_BUTTONS', () => {
  const buttons = Object.values(DEPOSIT_VERDICT_BUTTONS);

  it('共 11 个按钮,key 与 map 键一致', () => {
    expect(buttons).toHaveLength(11);
    for (const [k, b] of Object.entries(DEPOSIT_VERDICT_BUTTONS)) expect(b.key).toBe(k);
  });

  it('每个按钮的 webhookType 都在 ingestion 认识的集合里(防拼错静默丢弃)', () => {
    for (const b of buttons) expect(KYT_VERDICT_TYPES.has(b.webhookType)).toBe(true);
  });

  it('② ③ 必须带 applicantActions —— 否则详情页 Applicant Action IDs 永远空', () => {
    expect(DEPOSIT_VERDICT_BUTTONS.V2_AWAIT_USER.verdict.applicantActions?.length).toBeGreaterThan(0);
    expect(DEPOSIT_VERDICT_BUTTONS.V3_AWAIT_USER_PEP.verdict.applicantActions?.length).toBeGreaterThan(0);
  });

  // 终审 Important #4：externalActionId 是材料请求账全表 @unique（不像旧子表
  // 按 (订单id, seq) 分段去重）——固定字面量会在两笔不同订单先后点同一个按钮时
  // 撞唯一约束（P2002），第二次 500。fixture 改成按调用现铸，这里钉住"连续取
  // 两次不同"，防止有人图省事把 getter 改回静态数组。
  it('② ③ ⑩ 的 applicantActions 每次读都现铸，连续两次访问 externalActionId 不同', () => {
    const first = DEPOSIT_VERDICT_BUTTONS.V2_AWAIT_USER.verdict.applicantActions;
    const second = DEPOSIT_VERDICT_BUTTONS.V2_AWAIT_USER.verdict.applicantActions;
    expect(first?.[0].externalActionId).toBeTruthy();
    expect(first?.[0].externalActionId).not.toBe(second?.[0].externalActionId);
    expect(first?.[0].applicantActionId).not.toBe(second?.[0].applicantActionId);

    const multiFirst = DEPOSIT_VERDICT_BUTTONS.V10_AWAIT_USER_MULTI.verdict.applicantActions;
    const multiSecond = DEPOSIT_VERDICT_BUTTONS.V10_AWAIT_USER_MULTI.verdict.applicantActions;
    expect(multiFirst).toHaveLength(3);
    // 三条互不相同,且与下一次读取的三条也互不相同
    const allIds = [...(multiFirst ?? []), ...(multiSecond ?? [])].map((a) => a.externalActionId);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('处置 tag 逐个对上 handler 的词表', () => {
    const tagOf = (k: string) =>
      (DEPOSIT_VERDICT_BUTTONS[k].verdict.typedTags ?? []).map((t) => t.label);
    expect(tagOf('V4_REJECTED_SANCTION_APPLICANT')).toEqual(['SANCTION_APPLICANT']);
    expect(tagOf('V4B_REJECTED_SANCTION_COUNTERPARTY')).toEqual(['SANCTION_COUNTERPARTY']);
    expect(tagOf('V5_REJECTED_FROZEN_MLRO')).toEqual(['FROZEN_BY_MLRO']);
    expect(tagOf('V6_REJECTED_RETURN')).toEqual(['RETURN_TO_SENDER']);
    expect(tagOf('V7_REJECTED_NO_TAG')).toEqual([]);
    expect(tagOf('V3_AWAIT_USER_PEP')).toEqual(['PEP']);
  });
});
