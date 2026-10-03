import { DSR_OUTCOME_HEADLINE, DSR_PROFILE_LABELS, getDsrStatusView, humanizeCode, profileRows } from './dsrView';

describe('getDsrStatusView', () => {
  it('translates the three backend statuses into plain customer words', () => {
    expect(getDsrStatusView('SUBMITTED')).toEqual({ label: 'Submitted', tone: 'neutral' });
    expect(getDsrStatusView('IN_REVIEW')).toEqual({ label: 'In review', tone: 'warning' });
    expect(getDsrStatusView('RESOLVED')).toEqual({ label: 'Resolved', tone: 'positive' });
  });

  it('falls back to a neutral Processing badge for an unknown status instead of leaking the raw code', () => {
    expect(getDsrStatusView('SOMETHING_NEW')).toEqual({ label: 'Processing', tone: 'neutral' });
  });
});

describe('profileRows', () => {
  const profile = {
    customerNo: 'CU0001', firstName: 'Henry', lastName: 'Lau', companyName: null, email: 'henry@example.com',
    phone: '+971500000001', dateOfBirth: '1990-05-01', nationality: 'AE', idDocType: 'EMIRATES_ID',
    idDocNumber: '784-1990-1234567-1', residentialAddress: 'Dubai Marina, Dubai', tradingTier: 'BASIC',
    lifecycle: 'ACTIVE', onboardingApprovedAt: '2026-08-01T08:00:00.000Z',
  };

  it('returns one row per whitelisted profile field in the fixed display order', () => {
    const rows = profileRows(profile);
    expect(rows.map((r) => r.label)).toEqual(DSR_PROFILE_LABELS.map((l) => l.label));
    expect(rows).toHaveLength(14);
    expect(rows[0]).toEqual({ label: 'Member ID', value: 'CU0001' });
  });

  it('shows an em dash for empty values and leaves a plain date string untouched (no Date round-trip)', () => {
    const rows = Object.fromEntries(profileRows(profile).map((r) => [r.label, r.value]));
    expect(rows['Company name']).toBe('—');
    expect(rows['Date of birth']).toBe('1990-05-01');
  });

  it('formats the approval timestamp as a local date', () => {
    const rows = Object.fromEntries(profileRows(profile).map((r) => [r.label, r.value]));
    expect(rows['Approved on']).toBe(new Date('2026-08-01T08:00:00.000Z').toLocaleDateString());
  });

  it('ignores any key outside the whitelist (an unexpected internal field is never rendered)', () => {
    const rows = profileRows({ ...profile, riskRating: 'HIGH' });
    expect(JSON.stringify(rows)).not.toContain('HIGH');
  });
});

describe('copy tables', () => {
  it('has a headline for each of the four resolution outcomes', () => {
    for (const code of ['ACCESS_SUMMARY_PROVIDED', 'RECTIFICATION_REVERIFY', 'RECTIFICATION_SELF_SERVICE', 'ERASURE_REFUSED_RETENTION']) {
      expect(DSR_OUTCOME_HEADLINE[code]).toBeTruthy();
    }
  });

  it('humanizeCode turns a snake-case code into a sentence-cased phrase', () => {
    expect(humanizeCode('ID_DOCUMENT')).toBe('Id document');
    expect(humanizeCode('PENDING')).toBe('Pending');
  });
});
