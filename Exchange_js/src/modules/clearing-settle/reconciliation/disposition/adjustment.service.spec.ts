import { PrismaClient } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { AdjustmentStatus } from '../constants/adjustment-transitions.constant';
import { AdjustmentService } from './adjustment.service';
import { TB_ACCOUNT_CODES } from '../../../accounting/tigerbeetle/constants/tb-account-codes.constant';

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
      reasonInternal: '银行利息', reasonCustomer: '银行利息', relatedOrderNo: 'X',
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

describe('AdjustmentService.onRejected —— 驳回落库 + 终态闸（Task 4 补测 B）', () => {
  it('PENDING_APPROVAL 单被驳回：status 变 REJECTED，decidedByUserId 是传入的人', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma: any = {
      reconciliationAdjustment: {
        findUnique: jest.fn().mockResolvedValue({ adjustmentNo: 'ADJ_R1', status: 'PENDING_APPROVAL' }),
        update,
      },
    };
    const svc = new AdjustmentService(prisma, null as any, null as any, null as any);
    await svc.onRejected('ADJ_R1', 'U_OPS_7');
    expect(update).toHaveBeenCalledWith({
      where: { adjustmentNo: 'ADJ_R1' },
      data: { status: AdjustmentStatus.REJECTED, decidedByUserId: 'U_OPS_7' },
    });
  });

  it('POSTED 单已是终态：onRejected 抛 BadRequestException，且不写库', async () => {
    const update = jest.fn();
    const prisma: any = {
      reconciliationAdjustment: {
        findUnique: jest.fn().mockResolvedValue({ adjustmentNo: 'ADJ_R2', status: 'POSTED' }),
        update,
      },
    };
    const svc = new AdjustmentService(prisma, null as any, null as any, null as any);
    await expect(svc.onRejected('ADJ_R2', 'U_OPS_7')).rejects.toThrow(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('AdjustmentService.onApproved 落账', () => {
  const makeSvc = (row: any, accounting: any, update = jest.fn()) => {
    const prisma: any = {
      reconciliationAdjustment: { findUnique: jest.fn().mockResolvedValue(row), update },
    };
    return new AdjustmentService(prisma, null as any, accounting, { recordByActor: jest.fn() } as any);
  };

  const clientRow = {
    adjustmentNo: 'ADJ2608280001', status: 'PENDING_APPROVAL', book: 'CLIENT',
    direction: 'REDUCE', reasonCode: 'DEPOSIT_DUPLICATE_REVERSAL',
    walletRef: 'W_CUST_1', assetCode: 'AED', amount: '1500', effectiveDate: '2026-08-15',
    ownerNo: 'C0042', ownerId: 'uuid-cust', caseNo: 'RC26082800001',
    reasonInternal: '同一笔充值入账两次', traceId: 'T1', relatedOrderNo: 'DP2608150042',
  };

  it('evidence 必须带该 case 的 walletRef 且 isExternalCrossing=false', async () => {
    const executeTransfer = jest.fn().mockResolvedValue({ tbTransferId: 7n });
    const accounting = { executeTransfer, resolveTbAccountId: jest.fn().mockResolvedValue(1n) };
    await makeSvc(clientRow, accounting).onApproved('ADJ2608280001', 'U_OPS');

    const evidence = executeTransfer.mock.calls[0][0].evidence;
    expect(evidence.debitWalletRef).toBe('W_CUST_1');
    expect(evidence.creditWalletRef).toBe('W_CUST_1');
    expect(evidence.isExternalCrossing).toBe(false);
    expect(evidence.effectiveDate).toBe('2026-08-15');
  });

  it('客户账簿减钱走「借客户应付 / 贷客户托管」', async () => {
    const resolveTbAccountId = jest.fn().mockResolvedValue(1n);
    const accounting = { executeTransfer: jest.fn().mockResolvedValue({ tbTransferId: 1n }), resolveTbAccountId };
    await makeSvc(clientRow, accounting).onApproved('ADJ2608280001', 'U_OPS');
    const codes = resolveTbAccountId.mock.calls.map((c: any[]) => c[0].code);
    expect(codes).toEqual([TB_ACCOUNT_CODES.CLIENT_PAYABLE, TB_ACCOUNT_CODES.CLIENT_ASSET]);
  });

  it('落账后置 POSTED 并记下 tbTransferId', async () => {
    const update = jest.fn();
    const accounting = {
      executeTransfer: jest.fn().mockResolvedValue({ tbTransferId: 42n }),
      resolveTbAccountId: jest.fn().mockResolvedValue(1n),
    };
    await makeSvc(clientRow, accounting, update).onApproved('ADJ2608280001', 'U_OPS');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'POSTED', tbTransferId: '42', decidedByUserId: 'U_OPS' }),
    }));
  });

  it('已 POSTED 的单再落一次被状态机拒绝，且不碰账本', async () => {
    const executeTransfer = jest.fn();
    const accounting = { executeTransfer, resolveTbAccountId: jest.fn() };
    await expect(
      makeSvc({ ...clientRow, status: 'POSTED' }, accounting).onApproved('ADJ2608280001', 'U_OPS'),
    ).rejects.toThrow(BadRequestException);
    expect(executeTransfer).not.toHaveBeenCalled();
  });

  // 补测（业主要求）：四种分录组合里，上面三条只端到端断言过 CLIENT 账簿一种；
  // 公司账簿两种（BANK_CHARGE 减/BANK_INTEREST 加）在本任务完全没被覆盖，而它们正是
  // 演示破口场景 5/7（银行杂费/银行利息）要走的路。这条覆盖 FIRM+INCREASE。
  // 一并断言 ownerType：自审时发现公司科目（FIRM_ASSET/INCOME_OTHER）在 TbAccountRegistry
  // 里的真实登记值是 'SYSTEM'（见 asset-provisioning.service.ts:46、
  // tb-account-registry.service.ts resolve() 的严格 where 等值匹配），不是 'FIRM'——
  // 若只断言 code 不断言 ownerType，这处会在 mock 测试下全绿、真实环境里
  // resolveTbAccountId 却因查不到注册行而抛 NotFoundException。
  it('公司账簿加钱走「借公司资产 / 贷其他收入」，且科目 ownerType 是 SYSTEM 不是 FIRM', async () => {
    const resolveTbAccountId = jest.fn().mockResolvedValue(1n);
    const accounting = { executeTransfer: jest.fn().mockResolvedValue({ tbTransferId: 1n }), resolveTbAccountId };
    const firmRow = {
      ...clientRow, book: 'FIRM', direction: 'INCREASE', reasonCode: 'BANK_INTEREST',
      ownerNo: null, ownerId: null, walletRef: 'W_FIRM_AED',
    };
    await makeSvc(firmRow, accounting).onApproved('ADJ2608280001', 'U_OPS');
    const calls = resolveTbAccountId.mock.calls.map((c: any[]) => c[0]);
    expect(calls.map((c) => c.code)).toEqual([TB_ACCOUNT_CODES.FIRM_ASSET, TB_ACCOUNT_CODES.INCOME_OTHER]);
    expect(calls.map((c) => c.ownerType)).toEqual(['SYSTEM', 'SYSTEM']);
  });
});
