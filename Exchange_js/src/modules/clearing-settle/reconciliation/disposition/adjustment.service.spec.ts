import { PrismaClient } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { AdjustmentStatus } from '../constants/adjustment-transitions.constant';
import { AdjustmentService } from './adjustment.service';

describe('ReconciliationAdjustment schema', () => {
  const prisma = new PrismaClient();
  afterAll(async () => { await prisma.$disconnect(); });

  it('persists an adjustment row with the documented defaults', async () => {
    const row = await (prisma as any).reconciliationAdjustment.create({
      data: {
        adjustmentNo: 'ADJ_SCHEMA_SMOKE_1',
        caseNo: 'CASE_SMOKE', walletRef: 'W_SMOKE', book: 'CLIENT',
        direction: 'REDUCE', reasonCode: 'DEPOSIT_DUPLICATE_REVERSAL',
        assetCode: 'AED', amount: '1500', effectiveDate: '2026-08-28',
        reasonInternal: 'smoke', reasonCustomer: 'smoke',
        createdByUserId: 'U_SMOKE',
      },
    });
    expect(row.status).toBe('DRAFT');
    expect(row.postedAt).toBeNull();
    await (prisma as any).reconciliationAdjustment.delete({ where: { id: row.id } });
  });
});

describe('AdjustmentService.assertTransition', () => {
  const svc = new AdjustmentService(null as any, null as any, null as any, null as any);

  it('DRAFT → PENDING_APPROVAL 放行', () => {
    expect(() => svc.assertTransition(AdjustmentStatus.DRAFT, AdjustmentStatus.PENDING_APPROVAL)).not.toThrow();
  });
  it('POSTED 是终态，任何再迁移都被拒', () => {
    expect(() => svc.assertTransition(AdjustmentStatus.POSTED, AdjustmentStatus.REJECTED)).toThrow(BadRequestException);
  });
  it('DRAFT 不能跳过审批直接 POSTED', () => {
    expect(() => svc.assertTransition(AdjustmentStatus.DRAFT, AdjustmentStatus.POSTED)).toThrow(BadRequestException);
  });
});

describe('AdjustmentService.describeImpact —— 审批页看到的是后果，不是单号', () => {
  const svc = new AdjustmentService(null as any, null as any, null as any, null as any);
  it('客户账簿减钱，说清是谁、少多少、为什么', () => {
    const text = svc.describeImpact({
      book: 'CLIENT', ownerNo: 'C0042', amount: '1500', assetCode: 'AED',
      direction: 'REDUCE', reasonCode: 'DEPOSIT_DUPLICATE_REVERSAL', reasonInternal: '同一笔充值入账两次',
    } as any);
    expect(text).toContain('C0042');
    expect(text).toContain('减少');
    expect(text).toContain('1500');
    expect(text).toContain('同一笔充值入账两次');
  });
});
