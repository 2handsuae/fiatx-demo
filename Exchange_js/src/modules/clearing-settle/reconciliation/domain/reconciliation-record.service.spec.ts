import { Prisma } from '@prisma/client';
import { ReconciliationRecordService } from './reconciliation-record.service';

describe('ReconciliationRecordService', () => {
  let prisma: any;
  let svc: ReconciliationRecordService;
  beforeEach(() => {
    prisma = {
      reconciliationInvariantCheck: { create: jest.fn() },
      reconciliationLineItem: { create: jest.fn() },
    };
    svc = new ReconciliationRecordService(prisma);
  });
  it('saveInvariantCheck persists row', async () => {
    await svc.saveInvariantCheck('r1', {
      invariantCode: 'I1', currency: 'USDT', lhsLabel: 'a', lhsValue: new Prisma.Decimal(1),
      rhsLabel: 'b', rhsValue: new Prisma.Decimal(1), delta: new Prisma.Decimal(0), status: 'PASS', severity: 'SAFEGUARDING',
    } as any);
    expect(prisma.reconciliationInvariantCheck.create).toHaveBeenCalled();
  });
});
