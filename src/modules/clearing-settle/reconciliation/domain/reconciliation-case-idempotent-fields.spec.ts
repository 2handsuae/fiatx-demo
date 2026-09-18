// T1: schema additions for idempotency tracking on ReconciliationCase.
// Asserts the 4 new optional fields can flow through prisma.create payload
// and that (walletRef, businessDate, status) composite where returns the row.
// T2 will add the real (walletRef, businessDate) upsert on top.
describe('ReconciliationCase — idempotent-tracking fields (T1)', () => {
  it('create accepts firstSeenRunId / lastUpdatedRunId / resolvedAt / resolutionReason / severity as optional', async () => {
    const created: any = {};
    const prisma: any = {
      reconciliationCase: {
        create: jest.fn().mockImplementation(({ data }: any) => {
          Object.assign(created, data);
          return Promise.resolve({ id: 'c-new', ...data });
        }),
      },
    };
    const resolvedAt = new Date('2026-06-27T10:00:00.000Z');
    const row = await prisma.reconciliationCase.create({
      data: {
        businessDate: '2026-06-27',
        assetId: 'a-aed',
        assetCode: 'AED',
        layer: 'FIAT',
        book: 'CLIENT',
        walletRef: 'C_CMA-AED-0001',
        openedByRunId: 'r1',
        // new optional fields
        firstSeenRunId: 'r1',
        lastUpdatedRunId: 'r2',
        resolvedAt,
        resolutionReason: 'AUTO_HEALED',
        severity: 'HIGH',
      },
    });
    expect(row.firstSeenRunId).toBe('r1');
    expect(row.lastUpdatedRunId).toBe('r2');
    expect(row.resolvedAt).toBe(resolvedAt);
    expect(row.resolutionReason).toBe('AUTO_HEALED');
    expect(row.severity).toBe('HIGH');
  });

  it('findMany filtered by composite (walletRef, businessDate, status) returns the matching case', async () => {
    const stored = [
      { id: 'c-1', walletRef: 'C_CMA-AED-0001', businessDate: '2026-06-27', status: 'OPEN' },
      { id: 'c-2', walletRef: 'C_CMA-AED-0001', businessDate: '2026-06-27', status: 'RESOLVED' },
      { id: 'c-3', walletRef: 'C_CMA-AED-0002', businessDate: '2026-06-27', status: 'OPEN' },
    ];
    const prisma: any = {
      reconciliationCase: {
        findMany: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(
            stored.filter(
              (r) =>
                r.walletRef === where.walletRef &&
                r.businessDate === where.businessDate &&
                r.status === where.status,
            ),
          ),
        ),
      },
    };
    const rows = await prisma.reconciliationCase.findMany({
      where: { walletRef: 'C_CMA-AED-0001', businessDate: '2026-06-27', status: 'OPEN' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('c-1');
  });
});
