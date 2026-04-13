import { applyPolicy, PolicyInput } from './client-risk-assessment-policy';

// Load the actual policy JSON
const policy = require('../../../../../config/client-risk-assessment-policy.json');

describe('HIGH→HIGH label comparison', () => {
  const baseHigh: PolicyInput = {
    amlAnswer: 'GREEN',
    amlLabels: [],
    holdings: [],
    previousTier: 'HIGH',
    previousPepStatus: 'CONFIRMED',
    previousLabels: ['PEP_TIER_1'],
  };

  it('HIGH→HIGH same labels → HIGH_TO_HIGH_STABLE (auto)', () => {
    const result = applyPolicy(
      { ...baseHigh, amlAnswer: 'RED', amlLabels: ['PEP_TIER_1'], previousLabels: ['PEP_TIER_1'] },
      policy,
    );
    expect(result.scenarioType).toBe('HIGH_TO_HIGH_STABLE');
    expect(result.signoffMethod).toBe('AUTO_R2');
  });

  it('HIGH→HIGH GREEN result (downgrade blocked) + same labels → HIGH_TO_HIGH_STABLE', () => {
    const result = applyPolicy(
      { ...baseHigh, amlAnswer: 'GREEN', amlLabels: [], previousLabels: ['PEP_TIER_1'] },
      policy,
    );
    expect(result.scenarioType).toBe('HIGH_TO_HIGH_STABLE');
    expect(result.signoffMethod).toBe('AUTO_R2');
    expect(result.resultingTier).toBe('HIGH'); // downgrade blocked
  });

  it('HIGH→HIGH new label → HIGH_TO_HIGH_UPGRADE (MLRO)', () => {
    const result = applyPolicy(
      {
        ...baseHigh,
        amlAnswer: 'RED',
        amlLabels: ['PEP_TIER_1', 'ADVERSE_MEDIA'],
        previousLabels: ['PEP_TIER_1'],
      },
      policy,
    );
    expect(result.scenarioType).toBe('HIGH_TO_HIGH_UPGRADE');
    expect(result.signoffMethod).toBe('MANUAL_MLRO');
  });

  it('HIGH→HIGH no previousLabels provided → HIGH_TO_HIGH_UPGRADE (conservative)', () => {
    const result = applyPolicy(
      { ...baseHigh, amlAnswer: 'RED', amlLabels: ['PEP_TIER_1'], previousLabels: undefined },
      policy,
    );
    expect(result.scenarioType).toBe('HIGH_TO_HIGH_UPGRADE');
  });

  it('HIGH→HIGH previousLabels=[] + amlLabels=[] → HIGH_TO_HIGH_STABLE (no new labels)', () => {
    const result = applyPolicy(
      {
        amlAnswer: 'GREEN',
        amlLabels: [],
        holdings: [],
        previousTier: 'HIGH',
        previousLabels: [],
      },
      policy,
    );
    expect(result.scenarioType).toBe('HIGH_TO_HIGH_STABLE');
    expect(result.signoffMethod).toBe('AUTO_R2');
    expect(result.resultingTier).toBe('HIGH');
  });

  it('LOW→LOW still works', () => {
    const result = applyPolicy(
      { amlAnswer: 'GREEN', amlLabels: [], holdings: [], previousTier: 'LOW', previousPepStatus: 'NONE' },
      policy,
    );
    expect(result.scenarioType).toBe('LOW_TO_LOW');
    expect(result.signoffMethod).toBe('AUTO_R2');
  });

  it('LOW→HIGH still works', () => {
    const result = applyPolicy(
      { amlAnswer: 'RED', amlLabels: ['PEP_TIER_1'], holdings: [], previousTier: 'LOW', previousPepStatus: 'NONE' },
      policy,
    );
    expect(result.scenarioType).toBe('LOW_TO_HIGH');
    expect(result.signoffMethod).toBe('PHASE1_MLRO');
  });
});
