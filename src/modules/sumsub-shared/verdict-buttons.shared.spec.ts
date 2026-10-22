import { buildOrderVerdictButtons } from './verdict-buttons.shared';

describe('buildOrderVerdictButtons', () => {
  const dep = buildOrderVerdictButtons('DEPOSIT');
  const wd = buildOrderVerdictButtons('WITHDRAW');

  it('两域各 12 个按钮，键集合完全一致', () => {
    expect(Object.keys(dep)).toHaveLength(12);
    expect(Object.keys(wd).sort()).toEqual(Object.keys(dep).sort());
  });

  // 对手方波二 Task 6：第 12 键。形状同制裁命中——Sumsub 侧引擎打的拒绝裁决，
  // 但处置 tag 是新的 VASP_UNQUALIFIED（区别于 V10 的 RETURN_TO_SENDER / V11 的无 tag）。
  it('V12 对手方 VASP 不合格：ENGINE 组、rejected、tag=VASP_UNQUALIFIED，两域同码同义', () => {
    for (const table of [dep, wd]) {
      const b = (table as any).V12_VASP_UNQUALIFIED;
      expect(b).toBeDefined();
      expect(b.key).toBe('V12_VASP_UNQUALIFIED');
      expect(b.label).toBe('⑫ Rejected · Counterparty VASP unqualified');
      expect(b.source).toBe('ENGINE');
      expect(b.webhookType).toBe('applicantKytTxnRejected');
      expect(b.verdict.reviewAnswer).toBe('RED');
      expect((b.verdict.typedTags ?? []).map((t: any) => t.label)).toEqual(['VASP_UNQUALIFIED']);
    }
  });

  it('两域唯一的差异是 ⑩ 的处置 tag', () => {
    const tagOf = (b: any) => (b.verdict.typedTags ?? []).map((t: any) => t.label).sort();
    for (const key of Object.keys(dep)) {
      if (key === 'V10_REJECTED_DISPOSITION') continue;
      expect({ key, tags: tagOf(wd[key]) }).toEqual({ key, tags: tagOf(dep[key]) });
    }
    expect(tagOf(dep.V10_REJECTED_DISPOSITION)).toEqual(['RETURN_TO_SENDER']);
    expect(tagOf(wd.V10_REJECTED_DISPOSITION)).toEqual(['FINAL_REJECTED']);
  });

  it('PEP 已分主体，且没有未分主体的裸 PEP', () => {
    const allTags = Object.values(dep).flatMap((b: any) =>
      (b.verdict.typedTags ?? []).map((t: any) => t.label));
    expect(allTags).toContain('PEP_APPLICANT');
    expect(allTags).toContain('PEP_COUNTERPARTY');
    expect(allTags).not.toContain('PEP');
  });

  it('SLA breach 按钮已删除（真 SLA 走 simulate-sla-timeout 端点）', () => {
    const labels = Object.values(dep).map((b: any) => b.label);
    expect(labels.some((l) => /SLA/i.test(l))).toBe(false);
  });

  it('每个按钮标了是引擎打的还是合规官手工打的', () => {
    for (const b of Object.values(dep) as any[]) {
      expect(['ENGINE', 'OFFICER']).toContain(b.source);
    }
    expect(dep.V9_REJECTED_MLRO_FREEZE.source).toBe('OFFICER');
    expect(dep.V10_REJECTED_DISPOSITION.source).toBe('OFFICER');
    expect(dep.V1_APPROVED.source).toBe('ENGINE');
  });

  it('每个 awaitUser 按钮每次读 applicantActions 都拿到新的 externalActionId', () => {
    const a = (dep.V2_AWAIT_USER.verdict as any).applicantActions[0].externalActionId;
    const b = (dep.V2_AWAIT_USER.verdict as any).applicantActions[0].externalActionId;
    expect(a).not.toEqual(b);
  });
});
