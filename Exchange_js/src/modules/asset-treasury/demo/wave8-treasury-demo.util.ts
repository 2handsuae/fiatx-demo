export const WAVE8_TREASURY_DEMO_SEED = 'wave8-treasury-demo';
export const WAVE8_TREASURY_DEMO_TRACE_PREFIX = 'W8-TREASURY-DEMO:';
export const WAVE8_TREASURY_DEMO_METADATA_MARKER = `"seed":"${WAVE8_TREASURY_DEMO_SEED}"`;
export const WAVE8_TREASURY_DEMO_DEPOSIT_NO_PREFIX = 'W8-TREASURY-DEMO-DEP-';
export const WAVE8_TREASURY_DEMO_WALLET_NO_PREFIX = 'W8-TREASURY-DEMO-WALLET-';

type DeleteManyCapableDelegate = {
  deleteMany?: (args?: Record<string, unknown>) => Promise<{ count: number }>;
  findMany?: (args?: Record<string, unknown>) => Promise<Array<{ id: string }>>;
};

type TreasuryDemoCleanupCapablePrisma = {
  feeOccurrence?: DeleteManyCapableDelegate;
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

async function findIds(
  delegate: DeleteManyCapableDelegate | undefined,
  where: Record<string, unknown>,
) {
  if (!delegate?.findMany) return [] as string[];
  const rows = await delegate.findMany({
    where,
    select: { id: true },
  });
  return rows.map((item) => item.id);
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
  const [feeOccurrenceIds] = await Promise.all([
    findIds(prisma.feeOccurrence, demoRecordWhere),
  ]);

  const deleted = {
    reimbursement_obligations: 0,
    fee_occurrences: 0,
    deposit_transactions: 0,
    wallets: 0,
  };

  if (feeOccurrenceIds.length) {
    deleted.reimbursement_obligations = await deleteMany(
      prisma.reimbursementObligation,
      {
        feeOccurrenceId: {
          in: feeOccurrenceIds,
        },
      },
    );
    deleted.fee_occurrences = await deleteMany(prisma.feeOccurrence, {
      id: {
        in: feeOccurrenceIds,
      },
    });
  }

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
