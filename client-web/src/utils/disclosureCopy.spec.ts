import { DISCLOSURE_COPY, fillRateDisclosure } from './disclosureCopy';

it('第二句填入来源/时刻/点差', () => {
  expect(fillRateDisclosure('BINANCE', '2026-10-02T10:02:05.000Z', 0.5))
    .toMatch(/market reference rate \(BINANCE, .+\) adjusted by our 0\.5% spread/);
});

it('登记处五族文案齐全', () => {
  for (const k of ['principal', 'rateTemplate', 'conflict', 'retainedLabel', 'principalPast', 'figuresFixed', 'riskChain', 'riskFiat', 'riskDeposit'] as const)
    expect(DISCLOSURE_COPY[k]).toBeTruthy();
});
