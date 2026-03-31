import {
  WAVE8_TREASURY_DEMO_DEPOSIT_NO_PREFIX,
  WAVE8_TREASURY_DEMO_METADATA_MARKER,
  WAVE8_TREASURY_DEMO_SEED,
  WAVE8_TREASURY_DEMO_TRACE_PREFIX,
  WAVE8_TREASURY_DEMO_WALLET_NO_PREFIX,
  buildWave8TreasuryDemoMetadata,
  buildWave8TreasuryDemoTraceId,
  cleanupWave8TreasuryDemoData,
} from './wave8-treasury-demo.util';

describe('wave8 treasury demo util', () => {
  it('builds deterministic demo trace ids and metadata', () => {
    expect(buildWave8TreasuryDemoTraceId('FEE')).toBe(
      `${WAVE8_TREASURY_DEMO_TRACE_PREFIX}FEE`,
    );
    expect(buildWave8TreasuryDemoMetadata('open-reimbursement')).toEqual({
      demo: true,
      seed: WAVE8_TREASURY_DEMO_SEED,
      scenario: 'open-reimbursement',
    });
    expect(WAVE8_TREASURY_DEMO_METADATA_MARKER).toContain(
      WAVE8_TREASURY_DEMO_SEED,
    );
  });

  it('cleans only demo-tagged treasury data in dependency-safe order', async () => {
    const prisma: any = {
      feeOccurrence: {
        findMany: jest.fn().mockResolvedValue([{ id: 'fee-1' }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      reimbursementObligation: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      depositTransaction: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      wallet: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const deleted = await cleanupWave8TreasuryDemoData(prisma);

    expect(prisma.feeOccurrence.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              traceId: expect.objectContaining({
                startsWith: WAVE8_TREASURY_DEMO_TRACE_PREFIX,
              }),
            }),
            expect.objectContaining({
              metadata: expect.objectContaining({
                contains: WAVE8_TREASURY_DEMO_METADATA_MARKER,
              }),
            }),
          ]),
        }),
      }),
    );
    expect(prisma.reimbursementObligation.deleteMany).toHaveBeenCalledWith({
      where: { feeOccurrenceId: { in: ['fee-1'] } },
    });
    expect(prisma.feeOccurrence.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['fee-1'] } },
    });
    expect(prisma.depositTransaction.deleteMany).toHaveBeenCalledWith({
      where: {
        depositNo: {
          startsWith: WAVE8_TREASURY_DEMO_DEPOSIT_NO_PREFIX,
        },
      },
    });
    expect(prisma.wallet.deleteMany).toHaveBeenCalledWith({
      where: {
        walletNo: {
          startsWith: WAVE8_TREASURY_DEMO_WALLET_NO_PREFIX,
        },
      },
    });
    expect(deleted).toEqual({
      reimbursement_obligations: 1,
      fee_occurrences: 1,
      deposit_transactions: 1,
      wallets: 1,
    });
  });
});
