import { computeStage } from './compute-stage';

describe('computeStage', () => {
  it('FRESH when > 30 days before expiry', () => {
    expect(computeStage(60)).toBe('FRESH');
    expect(computeStage(31)).toBe('FRESH');
  });

  it('NOTIFIED when 7 < days <= 30', () => {
    expect(computeStage(30)).toBe('NOTIFIED');
    expect(computeStage(8)).toBe('NOTIFIED');
  });

  it('URGENT when 0 < days <= 7', () => {
    expect(computeStage(7)).toBe('URGENT');
    expect(computeStage(1)).toBe('URGENT');
  });

  it('BLOCKING when -30 < days <= 0', () => {
    expect(computeStage(0)).toBe('BLOCKING');
    expect(computeStage(-10)).toBe('BLOCKING');
    expect(computeStage(-29)).toBe('BLOCKING');
  });

  it('GRACE_EXPIRED when days <= -30', () => {
    expect(computeStage(-30)).toBe('GRACE_EXPIRED');
    expect(computeStage(-100)).toBe('GRACE_EXPIRED');
  });
});
