import { SWAP_VERDICT_BUTTONS } from './verdict-buttons';
import { buildOrderVerdictButtons } from '../../sumsub-shared/verdict-buttons.shared';

describe('SWAP_VERDICT_BUTTONS', () => {
  it('8 个按钮，键是充值域的子集（同码同义）', () => {
    const keys = Object.keys(SWAP_VERDICT_BUTTONS);
    expect(keys).toHaveLength(8);
    const depKeys = new Set(Object.keys(buildOrderVerdictButtons('DEPOSIT')));
    for (const k of keys) expect(depKeys.has(k)).toBe(true);
  });

  it('缺的三个各有真实理由：兑换无对手方、无处置弧', () => {
    expect(SWAP_VERDICT_BUTTONS.V4_AWAIT_USER_PEP_COUNTERPARTY).toBeUndefined();
    expect(SWAP_VERDICT_BUTTONS.V8_REJECTED_SANCTION_COUNTERPARTY).toBeUndefined();
    expect(SWAP_VERDICT_BUTTONS.V10_REJECTED_DISPOSITION).toBeUndefined();
  });

  it('认证复核按钮已删（材料审核不属交易层）', () => {
    const types = Object.values(SWAP_VERDICT_BUTTONS).map((b: any) => b.webhookType);
    expect(types).not.toContain('applicantActionReviewed');
  });

  it('报文形状与充值域一致：四个字段都在', () => {
    const dep = buildOrderVerdictButtons('DEPOSIT');
    for (const [key, b] of Object.entries(SWAP_VERDICT_BUTTONS) as [string, any][]) {
      const ref = (dep as any)[key];
      expect(Object.keys(b.verdict).sort()).toEqual(Object.keys(ref.verdict).sort());
    }
  });
});
