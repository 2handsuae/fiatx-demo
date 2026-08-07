import { WITHDRAW_VERDICT_BUTTONS } from './verdict-buttons';
import { KYT_VERDICT_TYPES } from '../../deposit-sumsub/kyt-webhook-types';

describe('WITHDRAW_VERDICT_BUTTONS', () => {
  const buttons = Object.values(WITHDRAW_VERDICT_BUTTONS);

  it('共 10 个按钮,key 与 map 键一致', () => {
    expect(buttons).toHaveLength(10);
    for (const [k, b] of Object.entries(WITHDRAW_VERDICT_BUTTONS)) expect(b.key).toBe(k);
  });

  it('每个按钮的 webhookType 都在 ingestion 认识的集合里(防拼错静默丢弃)', () => {
    for (const b of buttons) expect(KYT_VERDICT_TYPES.has(b.webhookType)).toBe(true);
  });

  it('② ③ 必须带 applicantActions —— 否则详情页 Applicant Action IDs 永远空', () => {
    expect(WITHDRAW_VERDICT_BUTTONS.V2_AWAIT_USER.verdict.applicantActions?.length).toBeGreaterThan(0);
    expect(WITHDRAW_VERDICT_BUTTONS.V3_AWAIT_USER_PEP.verdict.applicantActions?.length).toBeGreaterThan(0);
  });

  // 提现的处置 tag 词表与充值不同:WithdrawKytVerdictHandler 的 DISPO_TAGS =
  // {FROZEN_BY_MLRO, REJECT_REFUND}(没有充值那边的 RETURN_TO_SENDER)。
  it('处置 tag 逐个对上 WithdrawKytVerdictHandler 的词表', () => {
    const tagOf = (k: string) =>
      (WITHDRAW_VERDICT_BUTTONS[k].verdict.typedTags ?? []).map((t) => t.label);
    expect(tagOf('V4_REJECTED_SANCTION')).toEqual(['SANCTION']);
    expect(tagOf('V5_REJECTED_FROZEN_MLRO')).toEqual(['FROZEN_BY_MLRO']);
    expect(tagOf('V6_REJECTED_REFUND_TAG')).toEqual(['REJECT_REFUND']);
    expect(tagOf('V7_REJECTED_NO_TAG')).toEqual([]);
    expect(tagOf('V3_AWAIT_USER_PEP')).toEqual(['PEP']);
  });
});
