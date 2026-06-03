export const WAVE8_TREASURY_DEMO_SEED = 'wave8-treasury-demo';
export const WAVE8_TREASURY_DEMO_TRACE_PREFIX = 'W8-TREASURY-DEMO:';
export const WAVE8_TREASURY_DEMO_METADATA_MARKER = `"seed":"${WAVE8_TREASURY_DEMO_SEED}"`;
export const WAVE8_TREASURY_DEMO_DEPOSIT_NO_PREFIX = 'W8-TREASURY-DEMO-DEP-';
export const WAVE8_TREASURY_DEMO_WALLET_NO_PREFIX = 'W8-TREASURY-DEMO-WALLET-';

type DeleteManyCapableDelegate = {
  deleteMany?: (args?: Record<string, unknown>) => Promise<{ count: number }>;
};

type TreasuryDemoCleanupCapablePrisma = {
  reimbursementObligation?: DeleteManyCapableDelegate;
  depositTransaction?: DeleteManyCapableDelegate;
  wallet?: DeleteManyCapableDelegate;
};

export function buildWave8TreasuryDemoTraceId(suffix: string) {
  return `${WAVE8_TREASURY_DEMO_TRACE_PREFIX}${suffix}`;
}

export function buildWave8TreasuryDemoMetadata(scenario: string) {
  return {
    demo: true,
    seed: WAVE8_TREASURY_DEMO_SEED,
    scenario,
  };
}

function buildDemoRecordWhere() {
  return {
    OR: [
      {
        traceId: {
          startsWith: WAVE8_TREASURY_DEMO_TRACE_PREFIX,
        },
      },
      {
        metadata: {
          contains: WAVE8_TREASURY_DEMO_METADATA_MARKER,
        },
      },
    ],
  };
}

async function deleteMany(
  delegate: DeleteManyCapableDelegate | undefined,
  where?: Record<string, unknown>,
) {
  if (!delegate?.deleteMany) return 0;
  const result = await delegate.deleteMany(where ? { where } : undefined);
  return result.count ?? 0;
}

export async function cleanupWave8TreasuryDemoData(
  prisma: TreasuryDemoCleanupCapablePrisma,
) {
  const demoRecordWhere = buildDemoRecordWhere();

  const deleted = {
    reimbursement_obligations: 0,
    deposit_transactions: 0,
    wallets: 0,
  };

  deleted.reimbursement_obligations = await deleteMany(
    prisma.reimbursementObligation,
    demoRecordWhere,
  );

  deleted.deposit_transactions = await deleteMany(prisma.depositTransaction, {
    depositNo: {
      startsWith: WAVE8_TREASURY_DEMO_DEPOSIT_NO_PREFIX,
    },
  });

  deleted.wallets = await deleteMany(prisma.wallet, {
    walletNo: {
      startsWith: WAVE8_TREASURY_DEMO_WALLET_NO_PREFIX,
    },
  });

  return deleted;
}
