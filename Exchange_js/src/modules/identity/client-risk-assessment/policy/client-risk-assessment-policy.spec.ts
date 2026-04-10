import { applyPolicy, PolicyInput } from './client-risk-assessment-policy';
import { ClientRiskAssessmentPolicyLoader } from './policy-loader';

describe('applyPolicy', () => {
  const policy = new ClientRiskAssessmentPolicyLoader().getPolicy();

  function makeInput(overrides: Partial<PolicyInput> = {}): PolicyInput {
    return {
      amlAnswer: 'GREEN',
      amlLabels: [],
      holdings: [],
      previousTier: 'LOW',
      previousPepStatus: 'NONE',
      ...overrides,
    };
  }

  it('P1 sanctions: → HIGH + FREEZE + ESCALATED', () => {
    const r = applyPolicy(makeInput({ amlAnswer: 'RED', amlLabels: ['SANCTIONS_UN'] }), policy);
    expect(r.resultingTier).toBe('HIGH');
    expect(r.signoffMethod).toBe('ESCALATED');
    expect(r.immediateEffect).toBe('FREEZE');
    expect(r.matchedRule).toBe(1);
  });

  it('P1 > P2: sanctions + PEP both present → sanctions wins', () => {
    const r = applyPolicy(
      makeInput({ amlAnswer: 'RED', amlLabels: ['SANCTIONS_UN', 'PEP_CLASS_1'] }),
      policy,
    );
    expect(r.matchedRule).toBe(1);
  });

  it('P2 PEP: → HIGH + RESTRICT + DUAL_MLRO_SENIOR', () => {
    const r = applyPolicy(
      makeInput({ amlAnswer: 'RED', amlLabels: ['PEP_CLASS_1_DOMESTIC'] }),
      policy,
    );
    expect(r.resultingTier).toBe('HIGH');
    expect(r.signoffMethod).toBe('DUAL_MLRO_SENIOR');
    expect(r.immediateEffect).toBe('RESTRICT');
    expect(r.matchedRule).toBe(2);
  });

  it('P3 adverse media: → HIGH + MANUAL_MLRO', () => {
    const r = applyPolicy(
      makeInput({ amlAnswer: 'RED', amlLabels: ['ADVERSE_MEDIA_FRAUD'] }),
      policy,
    );
    expect(r.resultingTier).toBe('HIGH');
    expect(r.signoffMethod).toBe('MANUAL_MLRO');
    expect(r.matchedRule).toBe(3);
  });

  it('P4 red_other: keeps previous tier + MANUAL_MLRO', () => {
    const r = applyPolicy(
      makeInput({ amlAnswer: 'RED', amlLabels: ['OTHER_FLAG'], previousTier: 'MEDIUM' }),
      policy,
    );
    expect(r.resultingTier).toBe('MEDIUM');
    expect(r.signoffMethod).toBe('MANUAL_MLRO');
    expect(r.matchedRule).toBe(4);
  });

  it('P5 stale material: → UNKNOWN + REQUEST_REFRESH', () => {
    const r = applyPolicy(
      makeInput({
        amlAnswer: 'GREEN',
        holdings: [{ materialType: 'PROOF_OF_ADDRESS', status: 'EXPIRED', expiresAt: new Date(2026, 0, 1) }],
      }),
      policy,
    );
    expect(r.resultingTier).toBe('UNKNOWN');
    expect(r.recommendedAction).toBe('REQUEST_REFRESH');
    expect(r.matchedRule).toBe(5);
  });

  it('P6 green stable LOW → LOW AUTO_R2', () => {
    const r = applyPolicy(
      makeInput({
        amlAnswer: 'GREEN',
        holdings: [{ materialType: 'PROOF_OF_ADDRESS', status: 'FRESH', expiresAt: new Date(2099, 0, 1) }],
        previousTier: 'LOW',
      }),
      policy,
    );
    expect(r.resultingTier).toBe('LOW');
    expect(r.signoffMethod).toBe('AUTO_R2');
    expect(r.matchedRule).toBe(6);
  });

  it('downgradeForbidden: HIGH previous + green stable → keep HIGH + MANUAL_MLRO', () => {
    const r = applyPolicy(
      makeInput({
        amlAnswer: 'GREEN',
        holdings: [{ materialType: 'PROOF_OF_ADDRESS', status: 'FRESH', expiresAt: new Date(2099, 0, 1) }],
        previousTier: 'HIGH',
      }),
      policy,
    );
    expect(r.resultingTier).toBe('HIGH');
    expect(r.signoffMethod).toBe('MANUAL_MLRO');
    expect(r.scoreSuggestedTier).toBe('LOW');
  });
});
