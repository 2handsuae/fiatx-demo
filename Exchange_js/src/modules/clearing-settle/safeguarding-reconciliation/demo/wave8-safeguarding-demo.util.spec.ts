import {
  DEMO_BUSINESS_DATE,
  DEMO_SCENARIOS,
  parseDemoFiatStatementCsv,
} from './wave8-safeguarding-demo.util';

describe('wave8 safeguarding demo util', () => {
  it('parses fiat statement fixture and derives closing balance', () => {
    const parsed = parseDemoFiatStatementCsv(
      [
        'valueDate,referenceNo,description,amount,balance',
        '2026-04-01,AED-DEMO-OPEN,Opening balance,120.00,120.00',
        '2026-04-01,AED-DEMO-ADJ,Reserved hold,-20.00,100.00',
      ].join('\n'),
    );

    expect(parsed.closingBalance).toBe('100.00');
    expect(parsed.rows).toEqual([
      expect.objectContaining({
        lineNo: 1,
        referenceNo: 'AED-DEMO-OPEN',
        amount: '120.00',
        balance: '120.00',
      }),
      expect.objectContaining({
        lineNo: 2,
        referenceNo: 'AED-DEMO-ADJ',
        amount: '-20.00',
        balance: '100.00',
      }),
    ]);
  });

  it('defines a warning-only deterministic demo scenario', () => {
    expect(DEMO_BUSINESS_DATE).toBe('2026-04-01');
    expect(DEMO_SCENARIOS.BTC.targetLiability).toBe('7');
    expect(DEMO_SCENARIOS.BTC.poolTargets).toEqual({
      deposit: '2',
      master: '0',
      payout: '5',
    });
    expect(DEMO_SCENARIOS.USDT.poolTargets).toEqual({
      master: '100',
      payout: '0',
    });
    expect(DEMO_SCENARIOS.AED.statementClosingBalance).toBe('100.00');
  });
});
