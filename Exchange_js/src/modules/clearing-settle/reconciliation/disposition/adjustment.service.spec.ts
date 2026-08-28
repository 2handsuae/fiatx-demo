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
  it('公司账簿：文案显示"公司自有资金"', () => {
    const text = svc.describeImpact({
      book: 'FIRM', ownerNo: null, amount: '500', assetCode: 'AED',
      direction: 'REDUCE', reasonCode: 'BANK_CHARGE', reasonInternal: '银行手续费扣款',
    } as any);
    expect(text).toContain('公司自有资金');
  });
  it('方向 INCREASE 时文案显示"增加"', () => {
    const text = svc.describeImpact({
      book: 'CLIENT', ownerNo: 'C0099', amount: '800', assetCode: 'USDT',
      direction: 'INCREASE', reasonCode: 'WITHDRAW_VOID_REFUND', reasonInternal: '提现被驳回退回余额',
    } as any);
    expect(text).toContain('增加');
  });
});

describe('AdjustmentService.createDraft 两道闸 —— 门不可绕的落点，闸失效不能只靠人眼看代码', () => {
  const openClientCase = {
    caseNo: 'CASE_GATE', status: 'OPEN', book: 'CLIENT',
    walletRef: 'W_GATE', assetCode: 'AED', ownerNo: 'C0042', traceId: null,
  };

  const makeSvc = (kase: any, create = jest.fn().mockResolvedValue({ adjustmentNo: 'ADJ_X' })) => {
    const prisma: any = {
      reconciliationCase: { findUnique: jest.fn().mockResolvedValue(kase) },
      customer: { findUnique: jest.fn().mockResolvedValue({ id: 'uuid-cust' }) },
      reconciliationAdjustment: { create },
    };
    return { svc: new AdjustmentService(prisma, null as any, null as any, null as any), create };
  };

  it('闸二·边界线：客户账簿加钱不传关联原单号 → 拒', async () => {
    const { svc } = makeSvc(openClientCase);
    await expect(svc.createDraft({
      caseNo: 'CASE_GATE', lineItemId: 'LI_1', reasonCode: 'DEPOSIT_AMOUNT_CORRECTION',
      direction: 'INCREASE', amount: '1000', effectiveDate: '2026-08-28',
      reasonInternal: '充值金额记错，需向上更正', reasonCustomer: '充值金额更正',
    } as any, 'U_OP')).rejects.toThrow(BadRequestException);
  });

  it('闸二·放行：传了关联原单号 → 不拒，落库的 relatedOrderNo 是传进去的值', async () => {
    const { svc, create } = makeSvc(openClientCase);
    await svc.createDraft({
      caseNo: 'CASE_GATE', lineItemId: 'LI_1', reasonCode: 'DEPOSIT_AMOUNT_CORRECTION',
      direction: 'INCREASE', amount: '1000', effectiveDate: '2026-08-28',
      reasonInternal: '充值金额记错，需向上更正', reasonCustomer: '充值金额更正',
      relatedOrderNo: 'DEP2608280001',
    } as any, 'U_OP');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ relatedOrderNo: 'DEP2608280001' }),
    }));
  });

  it('闸一·成因非法组合：FIRM 专属成因配到 CLIENT 账簿的 case → 拒', async () => {
    const { svc } = makeSvc(openClientCase);
    await expect(svc.createDraft({
      caseNo: 'CASE_GATE', lineItemId: 'LI_1', reasonCode: 'BANK_INTEREST',
      direction: 'INCREASE', amount: '1000', effectiveDate: '2026-08-28',
      reasonInternal: '银行利息', reasonCustomer: '银行利息',
    } as any, 'U_OP')).rejects.toThrow(BadRequestException);
  });

  it('闸一·防绕过：落库的 book 来自 case，请求里塞 book 也带不进去', async () => {
    const { svc, create } = makeSvc(openClientCase);
    await svc.createDraft({
      caseNo: 'CASE_GATE', lineItemId: 'LI_1', reasonCode: 'DEPOSIT_DUPLICATE_REVERSAL',
      direction: 'REDUCE', amount: '1000', effectiveDate: '2026-08-28',
      reasonInternal: '同一笔充值入账两次', reasonCustomer: '重复入账撤销',
      book: 'FIRM',
    } as any, 'U_OP');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ book: 'CLIENT' }),
    }));
  });
});
