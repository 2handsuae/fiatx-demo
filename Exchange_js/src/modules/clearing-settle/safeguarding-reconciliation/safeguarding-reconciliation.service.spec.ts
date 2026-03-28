import { Prisma } from '@prisma/client';
import { SafeguardingReconciliationService } from './safeguarding-reconciliation.service';
import {
  ReconciliationBreakReasonCodes,
  ReconciliationBreakStatuses,
} from './constants/safeguarding-reconciliation.constant';
import {
  TRANSACTION_REVIEW_RULES,
  TRANSACTION_REVIEW_STAGES,
} from '../../risk-engine/constants/onboarding-compliance-workflow.constant';

describe('SafeguardingReconciliationService', () => {
  let service: SafeguardingReconciliationService;
  let prisma: any;
  let complianceAlertsService: { triggerSystemAlert: jest.Mock };
  let auditLogsService: { recordByActor: jest.Mock };

  const buildCandidate = (overrides: Partial<any> = {}) => ({
    id: 'withdraw-1',
    withdrawNo: 'WD2603270001',
    ownerType: 'CUSTOMER',
    ownerId: 'customer-1',
    status: 'SUCCESS',
    netAmount: new Prisma.Decimal('100.00'),
    assetId: 'asset-btc',
    completedAt: new Date('2026-03-27T10:00:00.000Z'),
    payoutId: 'payout-1',
    payoutNo: 'PO2603270001',
    asset: {
      id: 'asset-btc',
      code: 'BTC',
      type: 'CRYPTO',
    },
    payout: {
      id: 'payout-1',
      payoutNo: 'PO2603270001',
      status: 'CLEAR',
      amount: new Prisma.Decimal('100.00'),
      completedAt: new Date('2026-03-27T10:01:00.000Z'),
      clearings: [],
    },
    ...overrides,
  });

  const buildBreakRow = (overrides: Partial<any> = {}) => ({
    id: 'break-1',
    breakNo: 'RBR2603270001',
    businessDate: '2026-03-27',
    sourceType: 'WITHDRAW',
    sourceId: 'withdraw-1',
    sourceNo: 'WD2603270001',
    withdrawId: 'withdraw-1',
    withdrawNo: 'WD2603270001',
    payoutId: 'payout-1',
    payoutNo: 'PO2603270001',
    assetId: 'asset-btc',
    assetCode: 'BTC',
    expectedNetDelta: new Prisma.Decimal('100.00'),
    observedNetDelta: new Prisma.Decimal('110.00'),
    deltaAmount: new Prisma.Decimal('10.00'),
    reasonCode: ReconciliationBreakReasonCodes.DELTA_MISMATCH,
    status: ReconciliationBreakStatuses.OPEN,
    linkedAlertId: null,
    linkedCaseId: null,
    detailsJson: JSON.stringify({ observedSource: 'PAYOUT' }),
    detectedAt: new Date('2026-03-27T12:00:00.000Z'),
    resolvedAt: null,
    reopenedAt: null,
    createdAt: new Date('2026-03-27T12:00:00.000Z'),
    updatedAt: new Date('2026-03-27T12:00:00.000Z'),
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback(prisma)),
      withdrawTransaction: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      payout: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
      reconciliationBreak: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      complianceAlert: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      complianceIncident: {
        findMany: jest.fn(),
      },
    };
    complianceAlertsService = {
      triggerSystemAlert: jest.fn(),
    };
    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue(undefined),
    };

    service = new SafeguardingReconciliationService(
      prisma,
      complianceAlertsService as any,
      auditLogsService as any,
    );
  });

  it('should skip reconciled successful withdraws without creating breaks', async () => {
    prisma.withdrawTransaction.findMany.mockResolvedValue([
      buildCandidate(),
    ]);

    const result = await service.generateDailyDiff(
      { businessDate: '2026-03-27' },
      'admin-1',
    );

    expect(result.breakCount).toBe(0);
    expect(result.items).toEqual([]);
    expect(prisma.reconciliationBreak.create).not.toHaveBeenCalled();
    expect(complianceAlertsService.triggerSystemAlert).not.toHaveBeenCalled();
  });

  it('should create an OPEN delta-mismatch break and linked alert', async () => {
    prisma.withdrawTransaction.findMany.mockResolvedValue([
      buildCandidate({
        payout: {
          id: 'payout-1',
          payoutNo: 'PO2603270001',
          status: 'CLEAR',
          amount: new Prisma.Decimal('110.00'),
          completedAt: new Date('2026-03-27T10:01:00.000Z'),
          clearings: [],
        },
      }),
    ]);
    prisma.reconciliationBreak.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.reconciliationBreak.create.mockResolvedValue(
      buildBreakRow({
        linkedAlertId: null,
      }),
    );
    complianceAlertsService.triggerSystemAlert.mockResolvedValue({
      id: 'alert-1',
      linkedCaseIds: [],
    });
    prisma.reconciliationBreak.update.mockResolvedValue(
      buildBreakRow({
        linkedAlertId: 'alert-1',
      }),
    );
    prisma.complianceAlert.findUnique.mockResolvedValue(null);

    const result = await service.generateDailyDiff(
      { businessDate: '2026-03-27' },
      'admin-1',
    );

    expect(result.breakCount).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        withdrawId: 'withdraw-1',
        breakId: 'break-1',
        reasonCode: ReconciliationBreakReasonCodes.DELTA_MISMATCH,
        created: true,
      }),
    ]);
    expect(complianceAlertsService.triggerSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleCode: TRANSACTION_REVIEW_RULES.TX_RECONCILIATION_BREAK_DETECTED,
        stage: TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_RECONCILIATION,
        sourceType: 'WITHDRAW',
        sourceId: 'withdraw-1',
      }),
      prisma,
    );
    expect(prisma.reconciliationBreak.create).toHaveBeenCalledTimes(1);
  });

  it('should reopen a resolved break when the same mismatch persists on rerun', async () => {
    prisma.withdrawTransaction.findMany.mockResolvedValue([
      buildCandidate({
        status: 'FAILED',
        netAmount: new Prisma.Decimal('100.00'),
        payout: {
          id: 'payout-1',
          payoutNo: 'PO2603270001',
          status: 'FAILED',
          amount: new Prisma.Decimal('100.00'),
          completedAt: new Date('2026-03-27T10:01:00.000Z'),
          clearings: [
            {
              id: 'clr-1',
              clearingNo: 'CLR2603270001',
              sourceType: 'WITHDRAWAL',
              sourceId: 'withdraw-1',
              inAmount: new Prisma.Decimal('100.00'),
              outAmount: new Prisma.Decimal('100.00'),
              clearingStatus: 'OPEN',
              outPayoutId: 'payout-1',
              createdAt: new Date('2026-03-27T10:00:30.000Z'),
              updatedAt: new Date('2026-03-27T10:00:30.000Z'),
            },
          ],
        },
      }),
    ]);
    prisma.reconciliationBreak.findUnique
      .mockResolvedValueOnce({ id: 'break-1' })
      .mockResolvedValueOnce(
        buildBreakRow({
          expectedNetDelta: new Prisma.Decimal('0'),
          observedNetDelta: new Prisma.Decimal('100.00'),
          deltaAmount: new Prisma.Decimal('100.00'),
          reasonCode: ReconciliationBreakReasonCodes.COMPENSATION_INCOMPLETE,
          status: ReconciliationBreakStatuses.RESOLVED,
          resolvedAt: new Date('2026-03-27T12:30:00.000Z'),
        }),
      );
    complianceAlertsService.triggerSystemAlert.mockResolvedValue({
      id: 'alert-1',
      linkedCaseIds: [],
    });
    prisma.reconciliationBreak.update
      .mockResolvedValueOnce(
        buildBreakRow({
          expectedNetDelta: new Prisma.Decimal('0'),
          observedNetDelta: new Prisma.Decimal('100.00'),
          deltaAmount: new Prisma.Decimal('100.00'),
          reasonCode: ReconciliationBreakReasonCodes.COMPENSATION_INCOMPLETE,
          status: ReconciliationBreakStatuses.OPEN,
          resolvedAt: null,
          reopenedAt: new Date('2026-03-27T13:00:00.000Z'),
        }),
      )
      .mockResolvedValueOnce(
        buildBreakRow({
          expectedNetDelta: new Prisma.Decimal('0'),
          observedNetDelta: new Prisma.Decimal('100.00'),
          deltaAmount: new Prisma.Decimal('100.00'),
          reasonCode: ReconciliationBreakReasonCodes.COMPENSATION_INCOMPLETE,
          status: ReconciliationBreakStatuses.OPEN,
          linkedAlertId: 'alert-1',
          resolvedAt: null,
          reopenedAt: new Date('2026-03-27T13:00:00.000Z'),
        }),
      );
    prisma.complianceAlert.findUnique.mockResolvedValue(null);

    const result = await service.generateDailyDiff(
      { businessDate: '2026-03-27' },
      'admin-1',
    );

    expect(result.items).toEqual([
      expect.objectContaining({
        withdrawId: 'withdraw-1',
        reasonCode: ReconciliationBreakReasonCodes.COMPENSATION_INCOMPLETE,
        created: false,
      }),
    ]);
    expect(prisma.reconciliationBreak.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ReconciliationBreakStatuses.OPEN,
          resolvedAt: null,
          reopenedAt: expect.any(Date),
        }),
      }),
    );
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.stringContaining('TX_RECONCILIATION_BREAK_DETECTED'),
      }),
      expect.any(Object),
      prisma,
    );
  });

  it('should update break status without mutating withdraw or payout business states', async () => {
    prisma.reconciliationBreak.findUnique.mockResolvedValue(
      buildBreakRow({
        status: ReconciliationBreakStatuses.OPEN,
      }),
    );
    prisma.reconciliationBreak.update.mockResolvedValue(
      buildBreakRow({
        status: ReconciliationBreakStatuses.RESOLVED,
        resolvedAt: new Date('2026-03-27T14:00:00.000Z'),
      }),
    );
    prisma.withdrawTransaction.findUnique.mockResolvedValue(buildCandidate());
    prisma.complianceAlert.findMany.mockResolvedValue([]);
    prisma.complianceIncident.findMany.mockResolvedValue([]);
    prisma.withdrawTransaction.findMany.mockResolvedValue([
      {
        id: 'withdraw-1',
        withdrawNo: 'WD2603270001',
        status: 'SUCCESS',
        netAmount: new Prisma.Decimal('100.00'),
        completedAt: new Date('2026-03-27T10:00:00.000Z'),
      },
    ]);
    prisma.payout.findMany.mockResolvedValue([
      {
        id: 'payout-1',
        payoutNo: 'PO2603270001',
        status: 'CLEAR',
        amount: new Prisma.Decimal('100.00'),
        completedAt: new Date('2026-03-27T10:01:00.000Z'),
      },
    ]);

    const result = await service.updateStatus(
      'break-1',
      {
        status: ReconciliationBreakStatuses.RESOLVED,
        note: 'operator verified',
      },
      'admin-1',
    );

    expect(result.status).toBe(ReconciliationBreakStatuses.RESOLVED);
    expect(prisma.withdrawTransaction.update).not.toHaveBeenCalled();
    expect(prisma.payout.update).not.toHaveBeenCalled();
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.stringContaining('TX_RECONCILIATION_BREAK_RESOLVED'),
      }),
      expect.any(Object),
      prisma,
    );
  });
});
