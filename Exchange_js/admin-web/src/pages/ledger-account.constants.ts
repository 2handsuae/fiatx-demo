export const TB_CODE_LABELS: Record<number, string> = {
  1: 'BANK',
  10: 'CUSTODY',
  100: 'CLIENT_CREDIT',
  101: 'CLIENT_AUDIT',
  110: 'TRADE_CLEARING',
  120: 'FEE_RECEIVABLE',
};

export const TB_CODE_OPTIONS = [
  { value: '', label: 'All codes' },
  { value: '1', label: '1 · BANK' },
  { value: '10', label: '10 · CUSTODY' },
  { value: '100', label: '100 · CLIENT_CREDIT' },
  { value: '101', label: '101 · CLIENT_AUDIT' },
  { value: '110', label: '110 · TRADE_CLEARING' },
  { value: '120', label: '120 · FEE_RECEIVABLE' },
];
