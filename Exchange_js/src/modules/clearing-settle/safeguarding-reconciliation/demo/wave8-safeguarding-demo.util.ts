export const DEMO_BUSINESS_DATE = '2026-04-01';

export const DEMO_SCENARIOS = {
  BTC: {
    assetCurrency: 'BTC',
    network: 'BITCOIN',
    targetLiability: '7',
    poolTargets: {
      deposit: '2',
      master: '0',
      payout: '5',
    },
    policies: {
      depositThresholdAmount: '1',
      depositMaxAgeMinutes: 60,
      payoutTargetMax: '2',
    },
  },
  USDT: {
    assetCurrency: 'USDT',
    network: 'TRON',
    targetLiability: '100',
    poolTargets: {
      master: '100',
      payout: '0',
    },
    policies: {
      payoutTargetMin: '10',
    },
  },
  AED: {
    assetCurrency: 'AED',
    network: '',
    targetLiability: '100',
    poolTargets: {
      custBank: '100',
    },
    statementClosingBalance: '100.00',
  },
} as const;

export type DemoStatementRow = {
  lineNo: number;
  valueDate: string;
  referenceNo: string;
  description: string;
  amount: string;
  balance: string;
  rawRowJson: string;
};

export type ParsedDemoStatement = {
  closingBalance: string;
  rows: DemoStatementRow[];
};

function normalizeCsvHeader(value: string) {
  return value.trim().toLowerCase();
}

export function parseDemoFiatStatementCsv(csv: string): ParsedDemoStatement {
  const trimmed = csv.trim();
  if (!trimmed) {
    throw new Error('Demo fiat statement fixture is empty');
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error('Demo fiat statement fixture must contain header and rows');
  }

  const headers = lines[0].split(',').map(normalizeCsvHeader);
  const requiredHeaders = [
    'valuedate',
    'referenceno',
    'description',
    'amount',
    'balance',
  ];
  for (const header of requiredHeaders) {
    if (!headers.includes(header)) {
      throw new Error(`Demo fiat statement fixture missing header: ${header}`);
    }
  }

  const rows: DemoStatementRow[] = lines.slice(1).map((line, index) => {
    const values = line.split(',').map((value) => value.trim());
    const row = Object.fromEntries(
      headers.map((header, valueIndex) => [header, values[valueIndex] || '']),
    );
    return {
      lineNo: index + 1,
      valueDate: row.valuedate,
      referenceNo: row.referenceno,
      description: row.description,
      amount: row.amount,
      balance: row.balance,
      rawRowJson: JSON.stringify(row),
    };
  });

  return {
    closingBalance: rows[rows.length - 1].balance,
    rows,
  };
}
