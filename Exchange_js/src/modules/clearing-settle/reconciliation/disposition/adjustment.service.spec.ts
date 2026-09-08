import { Prisma, PrismaClient } from '@prisma/client';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdjustmentStatus } from '../constants/adjustment-transitions.constant';
import { AdjustmentService } from './adjustment.service';
import { DispositionService } from './disposition.service';
import { TB_ACCOUNT_CODES } from '../../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { V8_RECON_AUDIT_ACTIONS } from '../../../audit-logging/constants/audit-actions.constant';
import { AuditLogsService } from '../../../audit-logging/audit-logs.service';
import { REASON_SPECS, assertReasonAllowed } from './adjustment-rules';

describe('ReconciliationAdjustment schema', () => {
  const prisma = new PrismaClient();
  afterAll(async () => { await prisma.$disconnect(); });

  it('persists an adjustment row with the documented defaults', async () => {
    const row = await (prisma as any).reconciliationAdjustment.create({
      data: {
        adjustmentNo: 'ADJ_SCHEMA_SMOKE_1',
        caseNo: 'CASE_SMOKE', walletRef: 'W_SMOKE', book: 'CLIENT',
        direction: 'REDUCE', reasonCode: 'DUP_BOOKING',
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
  // T5：构造器新增第 5 个依赖 DispositionService（改记开单收尾要用）——
  // 本 describe 只测纯同步方法，不碰任何依赖，占位 null 即可。
  const svc = new AdjustmentService(null as any, null as any, null as any, null as any, null as any);

  it('DRAFT → PENDING_APPROVAL allowed', () => {
    expect(() => svc.assertTransition(AdjustmentStatus.DRAFT, AdjustmentStatus.PENDING_APPROVAL)).not.toThrow();
  });
  it('POSTED is terminal, any further transition is rejected', () => {
    expect(() => svc.assertTransition(AdjustmentStatus.POSTED, AdjustmentStatus.REJECTED)).toThrow(BadRequestException);
  });
  it('DRAFT cannot skip approval and jump straight to POSTED', () => {
    expect(() => svc.assertTransition(AdjustmentStatus.DRAFT, AdjustmentStatus.POSTED)).toThrow(BadRequestException);
  });
});

describe('AdjustmentService.describeImpact —— the approval page sees the consequence, not the order number', () => {
  const svc = new AdjustmentService(null as any, null as any, null as any, null as any, null as any);
  it('client-book reduction: states who, how much, and why — amount scaled by decimals to a human-readable number, cause shows the internal label rather than the raw enum', () => {
    const text = svc.describeImpact({
      book: 'CLIENT', ownerNo: 'C0042', amount: '1500', assetCode: 'AED',
      direction: 'REDUCE', reasonCode: 'DUP_BOOKING', reasonInternal: 'Same deposit recorded twice',
    } as any, 2);
    expect(text).toContain('C0042');
    expect(text).toContain('decrease');
    // Fix 1b: 1500 minor units at decimals=2 is 15.00 AED, not the raw 1500 printed as-is —
    // the latter is a two-order-of-magnitude misread on the one screen where the approver reads the amount (200.00 AED read as 20000).
    expect(text).toContain('15.00');
    expect(text).not.toContain('1500');
    // describeImpact's generic branch always uses internalLabel, never customerLabel (adjustment.service.ts
    // comment: customerLabel is null for the two firm-side causes, so borrowing it here would print the
    // raw enum for those). DUP_BOOKING's internalLabel is "Duplicate posting (twin)" — unlike the retired
    // DEPOSIT_DUPLICATE_REVERSAL code this test used to carry, where customerLabel and internalLabel happened
    // to share the same text, masking that this branch never reads customerLabel at all.
    expect(text).toContain('Duplicate posting (twin)');
    expect(text).not.toContain('DUP_BOOKING');
    expect(text).toContain('Same deposit recorded twice');
  });
  it('firm book: copy reads "the firm\'s balance"', () => {
    const text = svc.describeImpact({
      book: 'FIRM', ownerNo: null, amount: '500', assetCode: 'AED',
      direction: 'REDUCE', reasonCode: 'BANK_CHARGE_UNBOOKED', reasonInternal: 'Bank fee deduction',
    } as any, 2);
    expect(text).toContain("the firm's balance");
    expect(text).toContain('5.00'); // 500 minor → 5.00 AED
    // Final-stage Minor 1: the two firm-side causes have customerLabel deliberately null (customer
    // cannot see firm-side adjustments) — reusing it here used to fall back to printing the raw enum
    // "cause: BANK_CHARGE_UNBOOKED" (the five client-side causes were all in Chinese, only the firm side was
    // half English half Chinese). Now uses internalLabel.
    expect(text).toContain('Bank charges');
    expect(text).not.toContain('BANK_CHARGE_UNBOOKED');
  });
  it('direction INCREASE: copy reads "increase"', () => {
    const text = svc.describeImpact({
      book: 'CLIENT', ownerNo: 'C0099', amount: '800', assetCode: 'USDT',
      direction: 'INCREASE', reasonCode: 'PAYOUT_NOT_EXECUTED', reasonInternal: 'Withdrawal rejected, balance refunded',
    } as any, 6);
    expect(text).toContain('increase');
    expect(text).toContain('0.000800'); // 800 minor units → USDT at 6 decimals
  });
});

describe('AdjustmentService.createDraft two gates —— where the gate cannot be bypassed, a gate failure must not rely on eyeballing the code', () => {
  const openClientCase = {
    caseNo: 'CASE_GATE', status: 'OPEN', book: 'CLIENT',
    walletRef: 'W_GATE', assetCode: 'AED', ownerNo: 'C0042', traceId: null,
    // ① 生效日守卫按它比对——调账单修的是案件那一天的账。
    businessDate: '2026-08-28',
  };
  // Fix 2：createDraft 第二参数从裸字符串改 ApprovalActorContext；这里两个字段
  // 都设成同一个值，与改前 operatorId='U_OP' 的落库结果等价（createdByUserId
  // 取 actor.userNo ?? actor.userId，见 adjustment.service.ts）。
  const OP = { actorType: 'ADMIN' as const, userId: 'U_OP', userNo: 'U_OP', roleCodes: ['ADMIN'] };

  const makeSvc = (kase: any, create = jest.fn().mockResolvedValue({ adjustmentNo: 'ADJ_X' })) => {
    const prisma: any = {
      reconciliationCase: { findUnique: jest.fn().mockResolvedValue(kase) },
      // Task 6 修复：真实 Prisma 委托是 customerMain，不是 customer——旧 mock 键写错
      // 与实现的旧错法凑巧对齐，掩盖了「客户账簿开单必崩」的真 bug（见 adjustment.service.ts）。
      customerMain: { findUnique: jest.fn().mockResolvedValue({ id: 'uuid-cust' }) },
      reconciliationAdjustment: { create },
      // Fix 3：闸二第二步要按 relatedOrderNo 查三张原单表是否真实存在。默认全部
      // "查无此单"——只有 direction=INCREASE 且传了非空 relatedOrderNo 的用例才会
      // 走到这三条查询，需要放行的测试自己覆盖对应表（见下面"闸二·放行"）。
      depositTransaction: { findUnique: jest.fn().mockResolvedValue(null) },
      withdrawTransaction: { findUnique: jest.fn().mockResolvedValue(null) },
      swapTransaction: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    // T5：createDraft 成功路径新增 afterDraftCreated 收尾，会调 auditLogs.recordByActor——
    // 旧版这里传 null 是因为旧版 createDraft 从不碰它；不换成能接住调用的桩，本
    // describe 里"放行"类用例会在这一步 TypeError 而不是走到下面的断言。
    return {
      svc: new AdjustmentService(prisma, null as any, null as any, { recordByActor: jest.fn() } as any, null as any),
      create,
      prisma,
    };
  };

  it('gate 2 · boundary line: adding funds to a client-book account without a related order number → rejected', async () => {
    const { svc } = makeSvc(openClientCase);
    await expect(svc.createDraft({
      caseNo: 'CASE_GATE', lineItemId: 'LI_1', reasonCode: 'AMT_MISBOOKED',
      direction: 'INCREASE', amount: '1000', effectiveDate: '2026-08-28',
      reasonInternal: 'Deposit amount recorded incorrectly, needs correcting upward', reasonCustomer: 'Deposit amount correction',
    } as any, OP)).rejects.toThrow(BadRequestException);
  });

  it('gate 2 · allowed: a related order number is given and the order really exists (a deposit) → not rejected, the persisted relatedOrderNo is the value passed in', async () => {
    const { svc, create, prisma } = makeSvc(openClientCase);
    prisma.depositTransaction.findUnique.mockResolvedValue({ id: 'dep-uuid' });
    await svc.createDraft({
      caseNo: 'CASE_GATE', lineItemId: 'LI_1', reasonCode: 'AMT_MISBOOKED',
      direction: 'INCREASE', amount: '1000', effectiveDate: '2026-08-28',
      reasonInternal: 'Deposit amount recorded incorrectly, needs correcting upward', reasonCustomer: 'Deposit amount correction',
      relatedOrderNo: 'DEP2608280001',
    } as any, OP);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ relatedOrderNo: 'DEP2608280001' }),
    }));
    // Anti-masking: the lookup must query by the number passed in, not any wildcard.
    expect(prisma.depositTransaction.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { depositNo: 'DEP2608280001' } }),
    );
  });

  it('gate 2 · allowed: an original order that is a withdrawal rather than a deposit is also accepted — all three tables are checked in turn, not only the deposit table', async () => {
    const { svc, create, prisma } = makeSvc(openClientCase);
    prisma.withdrawTransaction.findUnique.mockResolvedValue({ id: 'wd-uuid' });
    await svc.createDraft({
      caseNo: 'CASE_GATE', reasonCode: 'PAYOUT_NOT_EXECUTED',
      direction: 'INCREASE', amount: '1000', effectiveDate: '2026-08-28',
      reasonInternal: 'Withdrawal was voided but the books were not reversed', reasonCustomer: 'Withdrawal refund',
      relatedOrderNo: 'WD2608280001',
    } as any, OP);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ relatedOrderNo: 'WD2608280001' }),
    }));
  });

  it('gate 2 · boundary line (Fix 3): relatedOrderNo is non-empty, but none of the deposit/withdrawal/swap tables have it → rejected — a made-up order number cannot bypass the boundary-line guard', async () => {
    const { svc, create, prisma } = makeSvc(openClientCase);
    await expect(svc.createDraft({
      caseNo: 'CASE_GATE', reasonCode: 'AMT_MISBOOKED',
      direction: 'INCREASE', amount: '1000', effectiveDate: '2026-08-28',
      reasonInternal: 'Deposit amount recorded incorrectly, needs correcting upward', reasonCustomer: 'Deposit amount correction',
      relatedOrderNo: 'DEP_DOES_NOT_EXIST',
    } as any, OP)).rejects.toThrow(BadRequestException);
    // Rejected cleanly: never reached the persistence step.
    expect(create).not.toHaveBeenCalled();
    // Anti-masking: all three tables were actually queried (not short-circuited earlier for some other reason).
    expect(prisma.depositTransaction.findUnique).toHaveBeenCalled();
    expect(prisma.withdrawTransaction.findUnique).toHaveBeenCalled();
    expect(prisma.swapTransaction.findUnique).toHaveBeenCalled();
  });

  it('gate 1 · illegal cause combination: a FIRM-only cause paired with a case on the CLIENT book → rejected', async () => {
    const { svc } = makeSvc(openClientCase);
    await expect(svc.createDraft({
      caseNo: 'CASE_GATE', lineItemId: 'LI_1', reasonCode: 'BANK_INTEREST_UNBOOKED',
      direction: 'INCREASE', amount: '1000', effectiveDate: '2026-08-28',
      reasonInternal: 'Bank interest', reasonCustomer: 'Bank interest', relatedOrderNo: 'X',
    } as any, OP)).rejects.toThrow(BadRequestException);
  });

  it('gate 1 · anti-bypass: the persisted book comes from the case, stuffing a book into the request does not get through', async () => {
    const { svc, create } = makeSvc(openClientCase);
    await svc.createDraft({
      caseNo: 'CASE_GATE', lineItemId: 'LI_1', reasonCode: 'DUP_BOOKING',
      direction: 'REDUCE', amount: '1000', effectiveDate: '2026-08-28',
      reasonInternal: 'Same deposit recorded twice', reasonCustomer: 'Duplicate deposit reversal',
      book: 'FIRM',
    } as any, OP);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ book: 'CLIENT' }),
    }));
  });

  // Anchor ④: which difference this adjustment explains is anchored to a real evidence id (internal
  // flow / external statement line), not ReconciliationLineItem.id (each run deletes and reinserts,
  // anchoring to it would go stale). It must be persisted, otherwise the next reconciliation run
  // cannot clear this difference and the case never balances.
  it('opening from a difference line: both explanation anchors are persisted as-is', async () => {
    const { svc, create } = makeSvc(openClientCase);
    await svc.createDraft({
      caseNo: 'CASE_GATE', reasonCode: 'DUP_BOOKING',
      direction: 'REDUCE', amount: '1000', effectiveDate: '2026-08-28',
      reasonInternal: 'Same deposit recorded twice', reasonCustomer: 'Duplicate deposit reversal',
      explainedFlowId: 'FLOW_9', explainedExternalLineId: 'EXTLINE_9',
    } as any, OP);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ explainedFlowId: 'FLOW_9', explainedExternalLineId: 'EXTLINE_9' }),
    }));
  });

  // Opening from the case-level entry point (a pure balance difference, no difference line to point at): both anchors are empty, the adjustment opens as usual.
  it('no explanation anchor (case-level entry point): createDraft opens the adjustment as usual, both anchors land null', async () => {
    const { svc, create } = makeSvc(openClientCase);
    await svc.createDraft({
      caseNo: 'CASE_GATE', reasonCode: 'DUP_BOOKING',
      direction: 'REDUCE', amount: '1000', effectiveDate: '2026-08-28',
      reasonInternal: 'Same deposit recorded twice', reasonCustomer: 'Duplicate deposit reversal',
    } as any, OP);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ explainedFlowId: null, explainedExternalLineId: null }),
    }));
  });

  // Anchor ①, effective-date guard: later than the case's business date = a rerun of that business
  // day's reconciliation would not see this entry, and the difference would never reach zero. The
  // frontend default has been changed to the case's business date; this lock is the backend backstop.
  it('effective date later than the case business date → 400, no adjustment opened', async () => {
    const { svc, create } = makeSvc(openClientCase);   // openClientCase.businessDate = '2026-08-28'
    await expect(svc.createDraft({
      caseNo: 'CASE_GATE', reasonCode: 'DUP_BOOKING',
      direction: 'REDUCE', amount: '1000', effectiveDate: '2026-08-29',
      reasonInternal: 'Same deposit recorded twice', reasonCustomer: 'Duplicate deposit reversal',
    } as any, OP)).rejects.toThrow(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('effective date equal to the case business date (normal case) and earlier than it → both allowed', async () => {
    for (const effectiveDate of ['2026-08-28', '2026-08-01']) {
      const { svc, create } = makeSvc(openClientCase);
      await svc.createDraft({
        caseNo: 'CASE_GATE', reasonCode: 'DUP_BOOKING',
        direction: 'REDUCE', amount: '1000', effectiveDate,
        reasonInternal: 'Same deposit recorded twice', reasonCustomer: 'Duplicate deposit reversal',
      } as any, OP);
      expect(create).toHaveBeenCalled();
    }
  });

  // Recon wave 2 Task 4: client pool write-off unlocked as "loss recognition" — UNEXPLAINED_CLIENT_LOSS
  // only allows REDUCE, excess funds (INCREASE) are routed to deposit backfill instead; book × reason
  // code pairing does not allow cross-using codes. This describe's existing makeSvc(kase, create) takes
  // two positional args, unlike the three named sub-objects (kase/disposition/asset) used here, so this
  // is a separate same-named local factory (shadowed within this nested describe's scope, does not affect other cases in this describe).
  describe('Client pool loss recognition (recon wave 2 Task 4) —— UNEXPLAINED_CLIENT_LOSS allowed / rejected', () => {
    const treasury = { actorType: 'ADMIN' as const, userId: 'U_TREASURY', userNo: 'U_TREASURY', roleCodes: ['TREASURY_OFFICER'] };

    const makeSvc = (opts: { kase: any; disposition: any; asset: any }) => {
      const prisma: any = {
        reconciliationCase: { findUnique: jest.fn().mockResolvedValue(opts.kase) },
        reconciliationDisposition: { findFirst: jest.fn().mockResolvedValue(opts.disposition) },
        asset: { findUnique: jest.fn().mockResolvedValue(opts.asset) },
        customerMain: { findUnique: jest.fn().mockResolvedValue({ id: 'uuid-cu' }) },
        reconciliationAdjustment: { create: jest.fn(({ data }: any) => Promise.resolve({ ...data })) },
      };
      const svc = new AdjustmentService(
        prisma, {} as any, {} as any, { recordByActor: jest.fn() } as any, { linkAdjustment: jest.fn() } as any,
      );
      return { svc, prisma };
    };

    it('client pool loss recognition · allowed: overdue + investigating + small amount + REDUCE + code UNEXPLAINED_CLIENT_LOSS → adjustment opened', async () => {
      const { svc, prisma } = makeSvc({
        kase: { caseNo: 'REC-C1', status: 'OPEN', book: 'CUSTOMER', assetCode: 'USDT-TRON', walletRef: 'w-1', ownerNo: 'CU-1', slaBreached: true, businessDate: '2026-09-05' },
        disposition: { dispositionNo: 'RCD-1', outlet: 'HOLD_INVESTIGATING', adjustmentNo: null },
        asset: { currency: 'USDT', decimals: 6 },
      });
      const r = await svc.createDraft({ caseNo: 'REC-C1', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', direction: 'REDUCE', amount: '7500000', effectiveDate: '2026-09-05', explainedFlowId: 'f-1', reasonInternal: 'x', reasonCustomer: 'x' } as any, treasury);
      expect(r.adjustmentNo).toMatch(/^ADJ/);
      expect(prisma.reconciliationAdjustment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ book: 'CLIENT', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', direction: 'REDUCE' }) }));
    });
    it('client pool · excess funds (INCREASE) → 400 pointing to deposit backfill', async () => {
      const { svc } = makeSvc({ kase: { caseNo: 'REC-C2', status: 'OPEN', book: 'CUSTOMER', assetCode: 'AED', walletRef: 'w-2', ownerNo: 'CU-2', slaBreached: true, businessDate: '2026-09-05' }, disposition: { dispositionNo: 'RCD-2', outlet: 'HOLD_INVESTIGATING', adjustmentNo: null }, asset: { currency: 'AED', decimals: 2 } });
      await expect(svc.createDraft({ caseNo: 'REC-C2', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', direction: 'INCREASE', amount: '100', effectiveDate: '2026-09-05', explainedExternalLineId: 'x-1', reasonInternal: 'x', reasonCustomer: 'x' } as any, treasury)).rejects.toThrow(/backfill/);
    });
    it('client pool using the firm pool code / firm pool using the client pool code → 400', async () => {
      const { svc } = makeSvc({ kase: { caseNo: 'REC-C3', status: 'OPEN', book: 'CUSTOMER', assetCode: 'AED', walletRef: 'w-3', ownerNo: 'CU-3', slaBreached: true, businessDate: '2026-09-05' }, disposition: { dispositionNo: 'RCD-3', outlet: 'HOLD_INVESTIGATING', adjustmentNo: null }, asset: { currency: 'AED', decimals: 2 } });
      await expect(svc.createDraft({ caseNo: 'REC-C3', reasonCode: 'UNEXPLAINED_WRITE_OFF', direction: 'REDUCE', amount: '100', effectiveDate: '2026-09-05', explainedFlowId: 'f-3', reasonInternal: 'x', reasonCustomer: 'x' } as any, treasury)).rejects.toThrow(/Client pool loss recognition/);

      // The other way around: a firm-book case using the client pool's loss-recognition code → 400, copy points to the firm's own write-off code.
      const { svc: svcFirm } = makeSvc({ kase: { caseNo: 'REC-C4', status: 'OPEN', book: 'FIRM', assetCode: 'AED', walletRef: 'w-4', ownerNo: null, slaBreached: true, businessDate: '2026-09-05' }, disposition: { dispositionNo: 'RCD-4', outlet: 'HOLD_INVESTIGATING', adjustmentNo: null }, asset: { currency: 'AED', decimals: 2 } });
      await expect(svcFirm.createDraft({ caseNo: 'REC-C4', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', direction: 'REDUCE', amount: '100', effectiveDate: '2026-09-05', explainedFlowId: 'f-4', reasonInternal: 'x', reasonCustomer: 'x' } as any, treasury)).rejects.toThrow(/Firm pool unexplained differences use/);
    });
  });
});

// 写端翻转（Task 3）：createDraft 原子入口——行未定性（无 dispositionNo）+ dto 带
// causeCode/findingNote → 先调 DispositionService.record()（真实实例 + 独立 prisma
// mock，同"Incident-path loss recognition"那组的范式，不用假 stub 盖住 record() 自己
// 的矩阵/挂单锁校验）落一条定性，再照常开单、挂号；两个描述块共用一个 audit mock，
// 让 record() 与 afterDraftCreated 的两条审计落进同一个 mock.calls 数组里能一并断言。
describe('createDraft atomic finding (Task 3: write-side flip) — causeCode + findingNote with no existing disposition', () => {
  const ACTOR = { actorType: 'ADMIN' as const, userId: 'U_ATOMIC', userNo: 'U_ATOMIC', roleCodes: ['ADMIN'] };
  const kase = {
    caseNo: 'CASE_ATOMIC', status: 'OPEN', book: 'CUSTOMER',
    walletRef: 'W_ATOMIC', assetCode: 'AED', ownerNo: 'C0099', traceId: null,
    businessDate: '2026-09-08',
  };
  // AMT_FEE_NETTED：单码制下 causeCode 与 reasonCode 同码（family=CORRECT），cell
  // AMOUNT_MISMATCH×CLIENT——internalSourceType='DEPOSIT' 满足 dispositionsFor 的
  // sourceAdjustable 门槛（否则 CORRECT 连矩阵都进不了）；direction=REDUCE 免闸二
  // 边界线（只有 CLIENT×INCREASE 才要求 relatedOrderNo）。
  const draftDto = {
    caseNo: 'CASE_ATOMIC', reasonCode: 'AMT_FEE_NETTED', direction: 'REDUCE',
    amount: '500', effectiveDate: '2026-09-08', reasonInternal: 'x', reasonCustomer: 'y',
    explainedFlowId: 'FLOW_ATOMIC_1', explainedExternalLineId: 'EXT_ATOMIC_1',
    matchType: 'AMOUNT_MISMATCH', internalSourceType: 'DEPOSIT',
  };

  it('createDraft 带 causeCode+findingNote 且行无定性 → 先 record 再 draft 再 link，两审计各一条', async () => {
    const audit = { recordByActor: jest.fn() };
    const dispositionPrisma: any = {
      reconciliationCase: { findUnique: jest.fn().mockResolvedValue(kase) },
      reconciliationDisposition: {
        findFirst: jest.fn().mockResolvedValue(null), // 无既有定性
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...data, id: 'd-atomic' })),
        findUnique: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve({ dispositionNo: where.dispositionNo, outlet: 'ADJUST_CORRECT', adjustmentNo: null })),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...data })),
      },
      wallet: { findUnique: jest.fn() },
    };
    const dispositions = new DispositionService(dispositionPrisma, audit as any);
    const prisma: any = {
      reconciliationCase: { findUnique: jest.fn().mockResolvedValue(kase) },
      customerMain: { findUnique: jest.fn().mockResolvedValue({ id: 'uuid-cu-atomic' }) },
      reconciliationAdjustment: { create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...data, adjustmentNo: 'ADJ_ATOMIC' })) },
    };
    const svc = new AdjustmentService(prisma, {} as any, {} as any, audit as any, dispositions as any);

    await svc.createDraft({ ...draftDto, causeCode: 'AMT_FEE_NETTED', findingNote: 'bank receipt shows net' } as any, ACTOR);
    const actions = audit.recordByActor.mock.calls.map((c: any) => c[0].action);
    // 评审修复（Minor 4）：换成两码各自的调用次数断言（各恰一次）——原先的
    // arrayContaining 只查"至少各出现一次"，两条审计中任一条被意外重复写（双写）
    // 也照样通过，逮不到这类缺陷。
    expect(actions.filter((a: string) => a === 'RECON_DISPOSITION_RECORDED')).toHaveLength(1);
    expect(actions.filter((a: string) => a === 'RECON_ADJUSTMENT_DRAFTED')).toHaveLength(1);
  });

  it('行已挂未走完的单 → 原子路径拒 400（沿用挂单锁）', async () => {
    // held.adjustmentNo 非空：这条证据的定性早已挂了另一张单，record() 自己的挂单锁
    // （与标准两步流程同一条校验）在原子路径里原样生效，不被 createDraft 绕过。
    const held = { dispositionNo: 'RCD-HELD', explainedFlowId: 'FLOW_ATOMIC_1', explainedExternalLineId: 'EXT_ATOMIC_1', adjustmentNo: 'ADJ_OLD' };
    const dispositionPrisma: any = {
      reconciliationCase: { findUnique: jest.fn().mockResolvedValue(kase) },
      reconciliationDisposition: { findFirst: jest.fn().mockResolvedValue(held) },
    };
    const dispositions = new DispositionService(dispositionPrisma, { recordByActor: jest.fn() } as any);
    const prisma: any = { reconciliationCase: { findUnique: jest.fn().mockResolvedValue(kase) } };
    const svc = new AdjustmentService(prisma, {} as any, {} as any, { recordByActor: jest.fn() } as any, dispositions as any);

    await expect(svc.createDraft({ ...draftDto, causeCode: 'AMT_FEE_NETTED', findingNote: 'x' } as any, ACTOR))
      .rejects.toThrow(/already linked to adjustment ADJ_OLD/);
  });

  // 评审修复（Important 1）：残缺对不再静默跳过定性——只带 causeCode 或只带
  // findingNote 都必须 400，且 record() 绝不能被调用（不能先斩后奏地半落定性）。
  it('评审修复：只带 causeCode 不带 findingNote → 400，record() 不被调用', async () => {
    const prisma: any = { reconciliationCase: { findUnique: jest.fn().mockResolvedValue(kase) } };
    const record = jest.fn();
    const svc = new AdjustmentService(prisma, {} as any, {} as any, { recordByActor: jest.fn() } as any, { record } as any);

    await expect(svc.createDraft({ ...draftDto, causeCode: 'AMT_FEE_NETTED' } as any, ACTOR))
      .rejects.toThrow(/requires both causeCode and findingNote/);
    expect(record).not.toHaveBeenCalled();
  });

  it('评审修复：只带 findingNote 不带 causeCode → 400，record() 不被调用', async () => {
    const prisma: any = { reconciliationCase: { findUnique: jest.fn().mockResolvedValue(kase) } };
    const record = jest.fn();
    const svc = new AdjustmentService(prisma, {} as any, {} as any, { recordByActor: jest.fn() } as any, { record } as any);

    await expect(svc.createDraft({ ...draftDto, findingNote: 'bank receipt shows net' } as any, ACTOR))
      .rejects.toThrow(/requires both causeCode and findingNote/);
    expect(record).not.toHaveBeenCalled();
  });

  // 评审修复（Minor 3，单码制一致闸）：CORRECT/REVERSE/RECORD 三族下 causeCode 必须
  // 等于 reasonCode——防审计里一件事记两个因。
  it('评审修复：causeCode ≠ reasonCode（CORRECT 族）→ 400，record() 不被调用', async () => {
    const prisma: any = { reconciliationCase: { findUnique: jest.fn().mockResolvedValue(kase) } };
    const record = jest.fn();
    const svc = new AdjustmentService(prisma, {} as any, {} as any, { recordByActor: jest.fn() } as any, { record } as any);

    // draftDto.reasonCode = 'AMT_FEE_NETTED'（family=CORRECT）；causeCode 换成同族
    // 但不同码的 'AMT_MISBOOKED'——单码制下这必须拒。
    await expect(svc.createDraft({ ...draftDto, causeCode: 'AMT_MISBOOKED', findingNote: 'x' } as any, ACTOR))
      .rejects.toThrow(/finding cause and the adjustment reason code must be the same code/);
    expect(record).not.toHaveBeenCalled();
  });

  // Task 8 评审修复：family 判定此前只有 kindOfFamily(reasonCode) 一条回落——
  // reasonCode='OTHER' 时 REASON_SPECS.OTHER.family 是占位 'CORRECT'（cause-registry.ts
  // 顶部注释：OTHER 不真的属于冲正族，只是留痕分组要有个桶放）。财务点「Reversal」按钮、
  // 选 Other 码时，旧逻辑会把定性判死成 ADJUST_CORRECT，与财务实际点的按钮对不上。
  // 修复：createDraft 优先信前端随按钮带上的 dto.disposition。
  it('Task 8：OTHER 码 + disposition=REVERSE → 定性落 ADJUST_REVERSE（不因占位族误判成 ADJUST_CORRECT）', async () => {
    const audit = { recordByActor: jest.fn() };
    const dispositionPrisma: any = {
      reconciliationCase: { findUnique: jest.fn().mockResolvedValue(kase) },
      reconciliationDisposition: {
        findFirst: jest.fn().mockResolvedValue(null), // 无既有定性
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...data, id: 'd-other' })),
        findUnique: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve({ dispositionNo: where.dispositionNo, outlet: 'ADJUST_REVERSE', adjustmentNo: null })),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...data })),
      },
      wallet: { findUnique: jest.fn() },
    };
    const dispositions = new DispositionService(dispositionPrisma, audit as any);
    const prisma: any = {
      reconciliationCase: { findUnique: jest.fn().mockResolvedValue(kase) },
      customerMain: { findUnique: jest.fn().mockResolvedValue({ id: 'uuid-cu-atomic' }) },
      reconciliationAdjustment: { create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...data, adjustmentNo: 'ADJ_OTHER' })) },
    };
    const svc = new AdjustmentService(prisma, {} as any, {} as any, audit as any, dispositions as any);

    // cell = ORPHAN_INTERNAL × CLIENT，sourceAdjustable('DEPOSIT') → dispositionsFor
    // 里包含 REVERSE；causesFor('REVERSE', ...) 对任意格都包含 OTHER（cells=ALL_CELLS）。
    await svc.createDraft({
      ...draftDto, reasonCode: 'OTHER', direction: 'REDUCE',
      matchType: 'ORPHAN_INTERNAL', internalSourceType: 'DEPOSIT', internalDirection: 'IN',
      causeCode: 'OTHER', findingNote: 'Other: manual review note', disposition: 'REVERSE',
    } as any, ACTOR);

    expect(dispositionPrisma.reconciliationDisposition.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outlet: 'ADJUST_REVERSE', causeCode: 'OTHER' }) }),
    );
  });
});

// Recon wave 3 Task 10: the loss-recognition adjustment incident branch. When the anchored finding
// line's outlet='INCIDENT' (cause-registry UNAUTHORIZED_OUTFLOW, a large unauthorized outflow), it
// skips the "unexplained" four preconditions and instead checks the incident's assessment conclusion —
// the aging threshold / small-amount threshold are for small "unexplained" differences; a large
// unauthorized outflow going through the incident path is precisely meant to bypass those two lines,
// and instead waits on the incident-side assessment conclusion (status + basis + locked amount), not time or amount.
describe('Incident-path loss recognition (recon wave 3 Task 10) —— outlet=INCIDENT branch: assessment basis + amount lock + status', () => {
  const treasury = { actorType: 'ADMIN' as const, userId: 'U_TREASURY', userNo: 'U_TREASURY', roleCodes: ['TREASURY_OFFICER'] };
  const kase = {
    caseNo: 'REC-INC-1', status: 'OPEN', book: 'CUSTOMER', assetCode: 'AED',
    walletRef: 'w-inc-1', ownerNo: 'CU-9', slaBreached: false, businessDate: '2026-09-06',
  };
  const disposition = { dispositionNo: 'RCD-INC-1', outlet: 'INCIDENT', incidentNo: 'INC-0001', adjustmentNo: null };
  const dto = {
    caseNo: 'REC-INC-1', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', direction: 'REDUCE',
    amount: '123456', // 1234.56 AED (minor units) — well past the small-amount threshold (100.00 AED), deliberately verifies the threshold is not checked
    effectiveDate: '2026-09-06', explainedFlowId: 'f-inc-1',
    reasonInternal: 'Unauthorized outflow loss recognition', reasonCustomer: '(firm side, not visible to customer)',
  };

  // Task 10 评审 Fix 1（Critical）回归锁：此前这里用一颗「永远 resolve」的假
  // linkAdjustment stub（`jest.fn().mockResolvedValue(undefined)`），会把
  // disposition.service.ts 白名单里的真实拒绝语义整个盖住——outlet 白名单当时
  // 不认 'INCIDENT'，事故路 createDraft 全链本该在 linkAdjustment 这步 400，
  // 挂着这颗 stub 却"通过"，是一次被 stub 形状骗绿的假绿灯。改成注入真实
  // DispositionService 实例 + 它自己独立的 prisma mock，用 jest.spyOn 只做调用
  // 记录、不覆盖实现——linkAdjustment 走的是文件里真实的白名单判断代码，
  // Fix 1 前用这套跑"放行"用例会真实 400（见下方用例注释与 Fix Round 1 报告）。
  const makeSvc = (opts: { kase?: any; disposition?: any; incident: any; asset?: any }) => {
    const dispositionRow = opts.disposition ?? disposition;
    const create = jest.fn(({ data }: any) => Promise.resolve({ ...data, adjustmentNo: 'ADJ_INC' }));
    const prisma: any = {
      reconciliationCase: { findUnique: jest.fn().mockResolvedValue(opts.kase ?? kase) },
      reconciliationDisposition: { findFirst: jest.fn().mockResolvedValue(dispositionRow) },
      incident: { findUnique: jest.fn().mockResolvedValue(opts.incident) },
      asset: { findUnique: jest.fn().mockResolvedValue(opts.asset ?? { currency: 'AED', decimals: 2 }) },
      customerMain: { findUnique: jest.fn().mockResolvedValue({ id: 'uuid-cu-9' }) },
      reconciliationAdjustment: { create },
    };
    const dispositionPrisma: any = {
      reconciliationDisposition: {
        findUnique: jest.fn().mockResolvedValue(dispositionRow),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...dispositionRow, ...data })),
      },
    };
    const dispositions = new DispositionService(dispositionPrisma, { recordByActor: jest.fn() } as any);
    jest.spyOn(dispositions, 'linkAdjustment');
    const svc = new AdjustmentService(prisma, {} as any, {} as any, { recordByActor: jest.fn() } as any, dispositions as any);
    return { svc, prisma, create, dispositions, dispositionPrisma };
  };

  it('allowed: aging threshold not reached + large amount past the small-amount threshold, incident ASSESSED + FIRM_LOSS + amount = assessed amount (after conversion) → adjustment opened, the finding line is genuinely linked to the adjustment number', async () => {
    const { svc, create, dispositions, dispositionPrisma } = makeSvc({
      incident: { incidentNo: 'INC-0001', status: 'ASSESSED', assessmentBasis: 'FIRM_LOSS', assessedAmount: new Prisma.Decimal('1234.56') },
    });
    const r = await svc.createDraft(dto as any, treasury);
    expect(r.adjustmentNo).toBe('ADJ_INC');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ book: 'CLIENT', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', direction: 'REDUCE', amount: '123456' }),
    }));
    expect(dispositions.linkAdjustment).toHaveBeenCalledWith('RCD-INC-1', 'ADJ_INC', { family: 'WRITE_OFF' });
    // Evidence that the real allowlist actually let it through: the finding line was genuinely linked
    // to the adjustment number (by a real DispositionService instance), not passed by a pretending
    // stub. Before Fix 1, disposition.service.ts's allowlist did not recognize outlet='INCIDENT', so
    // this await itself would throw a BadRequestException (this finding's outlet is INCIDENT, it does
    // not route to an adjustment) — the whole createDraft chain would genuinely 400 at this step.
    expect(dispositionPrisma.reconciliationDisposition.update).toHaveBeenCalledWith({
      where: { dispositionNo: 'RCD-INC-1' }, data: { adjustmentNo: 'ADJ_INC' },
    });
  });

  it('incident status RESOLVING (already being resolved) is likewise allowed', async () => {
    const { svc } = makeSvc({
      incident: { incidentNo: 'INC-0001', status: 'RESOLVING', assessmentBasis: 'FIRM_LOSS', assessedAmount: new Prisma.Decimal('1234.56') },
    });
    await expect(svc.createDraft(dto as any, treasury)).resolves.toEqual(expect.objectContaining({ adjustmentNo: 'ADJ_INC' }));
  });

  it('incident not yet assessed (INVESTIGATING) → 400 "has not been assessed yet"', async () => {
    const { svc } = makeSvc({ incident: { incidentNo: 'INC-0001', status: 'INVESTIGATING', assessmentBasis: null, assessedAmount: null } });
    await expect(svc.createDraft(dto as any, treasury)).rejects.toThrow(/has not been assessed/);
  });

  it('the assessment conclusion is not "firm bears the loss" (e.g. RECOVERED) → 400', async () => {
    const { svc } = makeSvc({
      incident: { incidentNo: 'INC-0001', status: 'ASSESSED', assessmentBasis: 'RECOVERED', assessedAmount: new Prisma.Decimal('1234.56') },
    });
    await expect(svc.createDraft(dto as any, treasury)).rejects.toThrow(/Firm bears the loss/);
  });

  it('amount ≠ assessed amount → 400 (amount is locked, the loss-recognition amount cannot be over- or under-reported)', async () => {
    const { svc } = makeSvc({
      incident: { incidentNo: 'INC-0001', status: 'ASSESSED', assessmentBasis: 'FIRM_LOSS', assessedAmount: new Prisma.Decimal('999.00') },
    });
    await expect(svc.createDraft(dto as any, treasury)).rejects.toThrow(/must exactly equal the assessed amount/);
  });

  it('the finding is "Incident · Pending" but has no incident number attached yet (incidentNo empty) → 400', async () => {
    const { svc } = makeSvc({
      disposition: { dispositionNo: 'RCD-INC-2', outlet: 'INCIDENT', incidentNo: null, adjustmentNo: null },
      incident: null,
    });
    await expect(svc.createDraft(dto as any, treasury)).rejects.toThrow(/no incident number attached/);
  });

  // Task 10 评审 Fix 2（Important）：linkAdjustment 的挂单锁在 createDraft **落库
  // 之后**才跑（afterDraftCreated），三重闸全过、reconciliationAdjustment.create
  // 已经写库才轮到它拒绝——没有这条前置复检，同一条已挂单的事故定性行还能再走完
  // 三重闸建出第二张 DRAFT（孤儿草稿：定性行挂不上号，单却已经落库、还能被提交过账）。
  it('the finding is already linked to an adjustment → 400, cannot open another loss-recognition adjustment (pre-persistence recheck, blocks orphan drafts)', async () => {
    const { svc, prisma } = makeSvc({
      disposition: { dispositionNo: 'RCD-INC-1', outlet: 'INCIDENT', incidentNo: 'INC-0001', adjustmentNo: 'ADJ_OLD' },
      incident: { incidentNo: 'INC-0001', status: 'ASSESSED', assessmentBasis: 'FIRM_LOSS', assessedAmount: new Prisma.Decimal('1234.56') },
    });
    await expect(svc.createDraft(dto as any, treasury)).rejects.toThrow(/already linked to adjustment ADJ_OLD — cannot open another loss-recognition adjustment/);
    // Rejected before persistence: neither the incident lookup nor reconciliationAdjustment.create should be touched.
    expect(prisma.incident.findUnique).not.toHaveBeenCalled();
    expect(prisma.reconciliationAdjustment.create).not.toHaveBeenCalled();
  });

  it('reason code pairing unchanged: the client pool still requires UNEXPLAINED_CLIENT_LOSS + REDUCE, excess funds (INCREASE) → 400 pointing to deposit backfill', async () => {
    const { svc } = makeSvc({
      incident: { incidentNo: 'INC-0001', status: 'ASSESSED', assessmentBasis: 'FIRM_LOSS', assessedAmount: new Prisma.Decimal('1234.56') },
    });
    await expect(svc.createDraft({ ...dto, direction: 'INCREASE' } as any, treasury)).rejects.toThrow(/backfill/);
  });
});

// Recon disposition rework Task 4 (dead-end fix): the LARGE_UNEXPLAINED escalation path
// (Hold · Investigating → aged out → Escalate → incident registered via
// DispositionService.attachIncident) never changes the finding line's outlet away from
// HOLD_INVESTIGATING — attachIncident only ever writes the incidentNo column (see
// disposition.service.ts). Before this fix, assertWriteOffAllowed only routed to the incident
// three-gate check when outlet==='INCIDENT' (a different, static outlet used solely by the
// UNAUTHORIZED_OUTFLOW cause registered directly at record() time) — so an escalated
// HOLD_INVESTIGATING+incidentNo row fell straight through to the old "unexplained" four
// preconditions, which reject it on the aging/small-amount lines a large assessed loss can never
// pass. Loss recognition could never be opened for this path — the registered BACKLOG dead end.
// The fix reroutes on `held?.incidentNo` regardless of outlet; assertIncidentWriteOffAllowed
// itself is unchanged (it never reads `outlet`), so both paths share the same three-gate check.
describe('Incident-path loss recognition also covers the LARGE_UNEXPLAINED escalation path (outlet stays HOLD_INVESTIGATING, only incidentNo is attached)', () => {
  const treasury = { actorType: 'ADMIN' as const, userId: 'U_TREASURY', userNo: 'U_TREASURY', roleCodes: ['TREASURY_OFFICER'] };
  const kase = {
    caseNo: 'REC-ESC-1', status: 'OPEN', book: 'CUSTOMER', assetCode: 'AED',
    walletRef: 'w-esc-1', ownerNo: 'CU-9', slaBreached: false, businessDate: '2026-09-06',
  };
  // outlet stays HOLD_INVESTIGATING — attachIncident() only ever writes the incidentNo column.
  const disposition = { dispositionNo: 'RCD-ESC-1', outlet: 'HOLD_INVESTIGATING', incidentNo: 'INC-ESC-1', adjustmentNo: null };
  const dto = {
    caseNo: 'REC-ESC-1', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', direction: 'REDUCE',
    amount: '123456', // well past the small-amount threshold (100.00 AED) — precisely why it escalated
    effectiveDate: '2026-09-06', explainedFlowId: 'f-esc-1',
    reasonInternal: 'Large unexplained difference, assessed via incident', reasonCustomer: '(firm side, not visible to customer)',
  };
  const makeSvc = (opts: { disposition?: any; incident: any }) => {
    const dispositionRow = opts.disposition ?? disposition;
    const create = jest.fn(({ data }: any) => Promise.resolve({ ...data, adjustmentNo: 'ADJ_ESC' }));
    const prisma: any = {
      reconciliationCase: { findUnique: jest.fn().mockResolvedValue(kase) },
      reconciliationDisposition: { findFirst: jest.fn().mockResolvedValue(dispositionRow) },
      incident: { findUnique: jest.fn().mockResolvedValue(opts.incident) },
      asset: { findUnique: jest.fn().mockResolvedValue({ currency: 'AED', decimals: 2 }) },
      customerMain: { findUnique: jest.fn().mockResolvedValue({ id: 'uuid-cu-9' }) },
      reconciliationAdjustment: { create },
    };
    const dispositionPrisma: any = {
      reconciliationDisposition: {
        findUnique: jest.fn().mockResolvedValue(dispositionRow),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...dispositionRow, ...data })),
      },
    };
    const dispositions = new DispositionService(dispositionPrisma, { recordByActor: jest.fn() } as any);
    jest.spyOn(dispositions, 'linkAdjustment');
    const svc = new AdjustmentService(prisma, {} as any, {} as any, { recordByActor: jest.fn() } as any, dispositions as any);
    return { svc, prisma, create, dispositions };
  };

  it('HOLD_INVESTIGATING row with an already-assessed incident (LARGE_UNEXPLAINED escalation) → loss recognition is allowed, amount locked to the assessed amount, the small-amount/aging lines are never checked (kase.slaBreached is false here)', async () => {
    const { svc, create, dispositions } = makeSvc({
      incident: { incidentNo: 'INC-ESC-1', status: 'ASSESSED', assessmentBasis: 'FIRM_LOSS', assessedAmount: new Prisma.Decimal('1234.56') },
    });
    const r = await svc.createDraft(dto as any, treasury);
    expect(r.adjustmentNo).toBe('ADJ_ESC');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ book: 'CLIENT', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', direction: 'REDUCE', amount: '123456' }),
    }));
    expect(dispositions.linkAdjustment).toHaveBeenCalledWith('RCD-ESC-1', 'ADJ_ESC', { family: 'WRITE_OFF' });
  });

  it('the incident is attached but not yet assessed (still INVESTIGATING) → 400 "has not been assessed yet" (incident three-gate ①, not the old aging-threshold rejection)', async () => {
    const { svc } = makeSvc({ incident: { incidentNo: 'INC-ESC-1', status: 'INVESTIGATING', assessmentBasis: null, assessedAmount: null } });
    await expect(svc.createDraft(dto as any, treasury)).rejects.toThrow(/has not been assessed/);
  });
});

describe('AdjustmentService.onRejected —— rejection persistence + terminal-state gate (Task 4 supplementary test B)', () => {
  it('a PENDING_APPROVAL adjustment is rejected: status becomes REJECTED, decidedByUserId is the person passed in', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma: any = {
      reconciliationAdjustment: {
        findUnique: jest.fn().mockResolvedValue({ adjustmentNo: 'ADJ_R1', status: 'PENDING_APPROVAL' }),
        update,
      },
    };
    const svc = new AdjustmentService(prisma, null as any, null as any, null as any, null as any);
    await svc.onRejected('ADJ_R1', 'U_OPS_7');
    expect(update).toHaveBeenCalledWith({
      where: { adjustmentNo: 'ADJ_R1' },
      data: { status: AdjustmentStatus.REJECTED, decidedByUserId: 'U_OPS_7' },
    });
  });

  it('a POSTED adjustment is already terminal: onRejected throws BadRequestException, and writes nothing', async () => {
    const update = jest.fn();
    const prisma: any = {
      reconciliationAdjustment: {
        findUnique: jest.fn().mockResolvedValue({ adjustmentNo: 'ADJ_R2', status: 'POSTED' }),
        update,
      },
    };
    const svc = new AdjustmentService(prisma, null as any, null as any, null as any, null as any);
    await expect(svc.onRejected('ADJ_R2', 'U_OPS_7')).rejects.toThrow(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('AdjustmentService.onApproved posting', () => {
  const makeSvc = (row: any, accounting: any, update = jest.fn(), recordByActor = jest.fn()) => {
    const prisma: any = {
      reconciliationAdjustment: { findUnique: jest.fn().mockResolvedValue(row), update },
      // onApproved 按 asset.currency 取 ledger（不是 assetCode——加密币 code 是
      // 'USDT-TRON'、currency 是 'USDT'，见 adjustment.service.ts:288 上方注释）。
      // ⚠ 2026-08-29 补：这个委托在加 currency 解析那次（eaaf5eae）漏了，本 describe
      // 下 11 个用例从那时起全在 asset.findUnique 上抛 TypeError——e2e 验了、单测红了
      // 没人看。row.assetCode 同名回落，法币/加密币两种 fixture 都取得到。
      asset: {
        findUnique: jest.fn(async ({ where }: any) => ({
          currency: where?.code === 'USDT-TRON' ? 'USDT' : where?.code,
        })),
      },
    };
    return new AdjustmentService(prisma, null as any, accounting, { recordByActor } as any, null as any);
  };

  const clientRow = {
    adjustmentNo: 'ADJ2608280001', status: 'PENDING_APPROVAL', book: 'CLIENT',
    direction: 'REDUCE', reasonCode: 'DUP_BOOKING',
    walletRef: 'W_CUST_1', assetCode: 'AED', amount: '1500', effectiveDate: '2026-08-15',
    ownerNo: 'C0042', ownerId: 'uuid-cust', caseNo: 'RC26082800001',
    reasonInternal: 'Same deposit recorded twice', traceId: 'T1', relatedOrderNo: 'DP2608150042',
  };

  it('evidence must carry the case\'s walletRef and isExternalCrossing=false', async () => {
    const executeTransfer = jest.fn().mockResolvedValue({ tbTransferId: 7n });
    const accounting = { executeTransfer, resolveTbAccountId: jest.fn().mockResolvedValue(1n) };
    await makeSvc(clientRow, accounting).onApproved('ADJ2608280001', 'U_OPS');

    const evidence = executeTransfer.mock.calls[0][0].evidence;
    expect(evidence.debitWalletRef).toBe('W_CUST_1');
    expect(evidence.creditWalletRef).toBe('W_CUST_1');
    expect(evidence.isExternalCrossing).toBe(false);
    expect(evidence.effectiveDate).toBe('2026-08-15');
  });

  it('client-book reduction posts "debit client payable / credit client asset"', async () => {
    const resolveTbAccountId = jest.fn().mockResolvedValue(1n);
    const accounting = { executeTransfer: jest.fn().mockResolvedValue({ tbTransferId: 1n }), resolveTbAccountId };
    await makeSvc(clientRow, accounting).onApproved('ADJ2608280001', 'U_OPS');
    const codes = resolveTbAccountId.mock.calls.map((c: any[]) => c[0].code);
    expect(codes).toEqual([TB_ACCOUNT_CODES.CLIENT_PAYABLE, TB_ACCOUNT_CODES.CLIENT_ASSET]);
  });

  it('after posting, status becomes POSTED and tbTransferId is recorded', async () => {
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

  it('an already-POSTED adjustment posted again is rejected by the status machine, and touches no ledger', async () => {
    const executeTransfer = jest.fn();
    const update = jest.fn();
    const accounting = { executeTransfer, resolveTbAccountId: jest.fn() };
    await expect(
      makeSvc({ ...clientRow, status: 'POSTED' }, accounting, update).onApproved('ADJ2608280001', 'U_OPS'),
    ).rejects.toThrow(BadRequestException);
    expect(executeTransfer).not.toHaveBeenCalled();
    // Symmetry fix (review Minor 5): same as onRejected's terminal-state test, the gate rejection must not touch persistence at all.
    expect(update).not.toHaveBeenCalled();
  });

  // 补测（业主要求）：四种分录组合里，上面三条只端到端断言过 CLIENT 账簿一种；
  // 公司账簿两种（BANK_CHARGE_UNBOOKED 减/BANK_INTEREST_UNBOOKED 加）在本任务完全没被覆盖，而它们正是
  // 演示破口场景 5/7（银行杂费/银行利息）要走的路。这条覆盖 FIRM+INCREASE。
  // 一并断言 ownerType：自审时发现公司科目（FIRM_ASSET/INCOME_OTHER）在 TbAccountRegistry
  // 里的真实登记值是 'SYSTEM'（见 asset-provisioning.service.ts:46、
  // tb-account-registry.service.ts resolve() 的严格 where 等值匹配），不是 'FIRM'——
  // 若只断言 code 不断言 ownerType，这处会在 mock 测试下全绿、真实环境里
  // resolveTbAccountId 却因查不到注册行而抛 NotFoundException。
  it('firm-book increase posts "debit firm asset / credit other income", and the account ownerType is SYSTEM, not FIRM', async () => {
    const resolveTbAccountId = jest.fn().mockResolvedValue(1n);
    const accounting = { executeTransfer: jest.fn().mockResolvedValue({ tbTransferId: 1n }), resolveTbAccountId };
    const firmRow = {
      ...clientRow, book: 'FIRM', direction: 'INCREASE', reasonCode: 'BANK_INTEREST_UNBOOKED',
      ownerNo: null, ownerId: null, walletRef: 'W_FIRM_AED',
    };
    await makeSvc(firmRow, accounting).onApproved('ADJ2608280001', 'U_OPS');
    const calls = resolveTbAccountId.mock.calls.map((c: any[]) => c[0]);
    expect(calls.map((c) => c.code)).toEqual([TB_ACCOUNT_CODES.FIRM_ASSET, TB_ACCOUNT_CODES.INCOME_OTHER]);
    expect(calls.map((c) => c.ownerType)).toEqual(['SYSTEM', 'SYSTEM']);
  });

  // 评审 Minor 4：四组合此前只端到端断言过 CLIENT/REDUCE + FIRM/INCREASE 两种，
  // 剩下两种（镜像方向）在接线层完全没测过。补齐后四组合两两科目对都不同
  // （注意 CLIENT 两条码集合相同、顺序相反——toEqual 对数组顺序敏感，
  // 硬编码答案没法同时通过这两条）。
  it('posting-legs coverage · CLIENT/INCREASE: posts "debit client asset / credit client payable" (withdrawal-refund scenario)', async () => {
    const resolveTbAccountId = jest.fn().mockResolvedValue(1n);
    const accounting = { executeTransfer: jest.fn().mockResolvedValue({ tbTransferId: 1n }), resolveTbAccountId };
    const row = { ...clientRow, direction: 'INCREASE', reasonCode: 'PAYOUT_NOT_EXECUTED' };
    await makeSvc(row, accounting).onApproved('ADJ2608280001', 'U_OPS');
    const codes = resolveTbAccountId.mock.calls.map((c: any[]) => c[0].code);
    expect(codes).toEqual([TB_ACCOUNT_CODES.CLIENT_ASSET, TB_ACCOUNT_CODES.CLIENT_PAYABLE]);
  });

  it('posting-legs coverage · FIRM/REDUCE: posts "debit firm ops / credit firm asset" (demo scenario 5: bank charges)', async () => {
    const resolveTbAccountId = jest.fn().mockResolvedValue(1n);
    const accounting = { executeTransfer: jest.fn().mockResolvedValue({ tbTransferId: 1n }), resolveTbAccountId };
    const row = {
      ...clientRow, book: 'FIRM', direction: 'REDUCE', reasonCode: 'BANK_CHARGE_UNBOOKED',
      ownerNo: null, ownerId: null, walletRef: 'W_FIRM_AED',
    };
    await makeSvc(row, accounting).onApproved('ADJ2608280001', 'U_OPS');
    const codes = resolveTbAccountId.mock.calls.map((c: any[]) => c[0].code);
    expect(codes).toEqual([TB_ACCOUNT_CODES.FIRM_OPS, TB_ACCOUNT_CODES.FIRM_ASSET]);
  });

  // ── 评审 Critical 的回归锁：audit-logs.service.ts 的 assertActionSpec 读的是
  // input 顶层字段，不是 metadata；上一版把 reasonCode/direction/amount/effectiveDate
  // 全塞进了 metadata，顶层一个没传，真实 AuditLogsService 会在账已过、单已 POSTED
  // 之后拒写——而这条拒写异常在 @OnEvent handler 里被吞，运营看到成功、审计里零记录。
  // 5 条测试全程 mock `{ recordByActor: jest.fn() }`，从未真正跑过这道校验——跟
  // ownerType 那只 bug 是同一个根因（mock 掩盖了真契约）。这里补两层锁：
  //   a) 动态比对合同表 requiredFields 与信封顶层字段（防未来两侧改动失步）；
  //   b) 直接拿真实 AuditLogsService 的校验函数验一遍捕获到的信封（防「a 写的字段
  //      清单本身抄错」这层自证风险——不是照抄合同表再断言一次，是让生产用的那个
  //      函数亲自跑，评审就是这样抓到 bug 的）。
  describe('audit envelope contract consistency (review Critical regression lock)', () => {
    const captureEnvelope = async (row: any) => {
      const recordByActor = jest.fn();
      const accounting = { executeTransfer: jest.fn().mockResolvedValue({ tbTransferId: 1n }), resolveTbAccountId: jest.fn().mockResolvedValue(1n) };
      await makeSvc(row, accounting, jest.fn(), recordByActor).onApproved('ADJ2608280001', 'U_OPS');
      expect(recordByActor).toHaveBeenCalledTimes(1);
      return recordByActor.mock.calls[0][0];
    };

    it('a) the envelope\'s top-level fields cover every item in the contract table RECON_ADJUSTMENT_POSTED.requiredFields', async () => {
      const envelope = await captureEnvelope(clientRow);
      const required = V8_RECON_AUDIT_ACTIONS.RECON_ADJUSTMENT_POSTED.requiredFields;
      // Guard the contract table itself isn't emptied out — an empty array would make the loop below test nothing, i.e. the test would be a no-op.
      expect(required.length).toBeGreaterThan(0);
      for (const field of required) {
        expect(envelope[field as keyof typeof envelope]).not.toBeUndefined();
        expect(envelope[field as keyof typeof envelope]).not.toBeNull();
      }
    });

    it('b) the real AuditLogsService.assertActionSpec validates the captured envelope — does not throw (no real DB needed: assertActionSpec is a pure check, never touches prisma)', async () => {
      const envelope = await captureEnvelope(clientRow);
      const realAuditLogs = new AuditLogsService(null as any);
      expect(() => (realAuditLogs as any).assertActionSpec(envelope)).not.toThrow();
    });

    it('correlationId fallback: no rejection when the case has no traceId (an empty correlationId under the INHERIT code would be rejected by the real check), the fallback value matches the evidence side\'s (row.traceId||row.adjustmentNo already at :181)', async () => {
      const envelope = await captureEnvelope({ ...clientRow, traceId: null });
      expect(envelope.correlationId).toBe('ADJ2608280001');

      const realAuditLogs = new AuditLogsService(null as any);
      expect(() => (realAuditLogs as any).assertActionSpec(envelope)).not.toThrow();
    });

    it('the case in subjects uses the word-table registered name RECONCILIATION_CASE, not the unregistered made-up word RECON_CASE (looking up this adjustment by case relies on it, the same module\'s case-opening audit in wallet-recon-run.service.ts uses this word too)', async () => {
      const envelope = await captureEnvelope(clientRow);
      expect(envelope.subjects).toEqual(expect.arrayContaining([
        expect.objectContaining({ subjectType: 'RECONCILIATION_CASE', subjectNo: 'RC26082800001', subjectRole: 'RELATED' }),
      ]));
    });
  });
});

// Task 7（admin 详情页）：getAdjustment 详情读模型补两样——decimals（分→元 显示
// 缩放，与 getCase 同款惯例）与借/贷分录预览助记码（(book,direction) 纯函数推导，
// 复用 onApproved 落账时已经在用的同一对工具函数 resolvePostingLegs/TB_CODE_TO_COA，
// 两处科目对不能各说各话——这条断言直接跟 onApproved 分录接线测试里的科目对呼应）。
describe('AdjustmentService.getAdjustment —— detail read model (Task 7)', () => {
  const makeSvc = (row: any, assetRow: any = { decimals: 2 }, walletRow: any = null) => {
    const prisma: any = {
      reconciliationAdjustment: { findUnique: jest.fn().mockResolvedValue(row) },
      wallet: { findUnique: jest.fn().mockResolvedValue(walletRow) },
      asset: { findUnique: jest.fn().mockResolvedValue(assetRow) },
    };
    return new AdjustmentService(prisma, null as any, null as any, null as any, null as any);
  };

  const baseRow = {
    id: 'uuid-row', adjustmentNo: 'ADJ2608280002', caseNo: 'RC26082800001',
    explainedFlowId: null, explainedExternalLineId: null, walletRef: 'W_CUST_1', book: 'CLIENT', direction: 'REDUCE',
    reasonCode: 'DUP_BOOKING', assetCode: 'AED', amount: '1500',
    effectiveDate: '2026-08-15', reasonInternal: 'Same deposit recorded twice', reasonCustomer: 'Duplicate deposit reversal',
    status: 'DRAFT', approvalCaseId: null, approvalNo: null, ownerNo: 'C0042', ownerId: 'uuid-cust',
    traceId: null, createdByUserId: 'U_OP', decidedByUserId: null, postedAt: null, tbTransferId: null,
  };

  it('the response body carries no UUID (principle ⑥): id/ownerId/approvalCaseId/both explanation anchors/walletRef are stripped, the business number adjustmentNo is kept', async () => {
    const svc = makeSvc(baseRow);
    const result: any = await svc.getAdjustment('ADJ2608280002');
    expect(result.id).toBeUndefined();
    expect(result.ownerId).toBeUndefined();
    expect(result.approvalCaseId).toBeUndefined();
    expect(result.explainedFlowId).toBeUndefined();
    expect(result.explainedExternalLineId).toBeUndefined();
    expect(result.walletRef).toBeUndefined();
    expect(result.adjustmentNo).toBe('ADJ2608280002');
  });

  it('decimals comes from the asset table; falls back to 0 when no asset row is found (does not throw, same fallback as getCase)', async () => {
    const svcHit = makeSvc(baseRow, { decimals: 2 });
    expect((await svcHit.getAdjustment('ADJ2608280002') as any).decimals).toBe(2);

    const svcMiss = makeSvc(baseRow, null);
    expect((await svcMiss.getAdjustment('ADJ2608280002') as any).decimals).toBe(0);
  });

  it('client-book reduction (DUP_BOOKING/REDUCE): the posting preview is "debit L.CLIENT_PAYABLE / credit A.CLIENT_ASSET"', async () => {
    const svc = makeSvc(baseRow);
    const result: any = await svc.getAdjustment('ADJ2608280002');
    expect(result.debitAccountCode).toBe('L.CLIENT_PAYABLE');
    expect(result.creditAccountCode).toBe('A.CLIENT_ASSET');
  });

  it('firm-book increase (BANK_INTEREST_UNBOOKED/INCREASE): the posting preview is "debit A.FIRM_ASSET / credit E.INCOME_OTHER" — matches the account pair in the onApproved posting-legs test, the two must not disagree', async () => {
    const firmRow = { ...baseRow, book: 'FIRM', direction: 'INCREASE', reasonCode: 'BANK_INTEREST_UNBOOKED', ownerNo: null, ownerId: null };
    const svc = makeSvc(firmRow);
    const result: any = await svc.getAdjustment('ADJ2608280002');
    expect(result.debitAccountCode).toBe('A.FIRM_ASSET');
    expect(result.creditAccountCode).toBe('E.INCOME_OTHER');
  });
});

// 平账一期半 T5：第四族改记开单 + 定性联动 + DRAFTED 审计。
// ⚠ afterDraftCreated（四族通用收尾）现在会在 createDraft 成功路径上调
// auditLogs.recordByActor——别的 describe 的 makeSvc 已经在各自的 4/5 号参数位
// 补上了能接住调用的桩（见"两道闸"describe 的改动）；这里自己起一套 mock
// 台架，不跨 describe 复用私有 makeSvc（block 作用域出不去）。
describe('createDraft fourth family (reattribution, spec §6) + finding link-back + DRAFTED audit', () => {
  // Same convention as the OP in the "two gates" describe: userId/userNo share a value, createdByUserId lands the business number.
  const ACTOR = { actorType: 'ADMIN' as const, userId: 'U_OP', userNo: 'U_OP', roleCodes: ['ADMIN'] };

  it('reattribution: both cases must share the same business date, the rightful owner requires an original order, direction lands REATTRIBUTE, toWalletRef/toOwnerNo are persisted', async () => {
    // fromCase = 错记方（我有外无，dto.caseNo 传的是它）；
    // toCase   = 正主方（外有我无，dto.toCaseNo 传的是它）。
    const fromCase = {
      caseNo: 'REC-FROM', status: 'OPEN', book: 'CLIENT',
      walletRef: 'wallet-from-uuid', assetCode: 'AED', ownerNo: 'CU-FROM', traceId: null,
      businessDate: '2026-09-01',
    };
    const toCase = {
      caseNo: 'REC-TO', status: 'OPEN', book: 'CLIENT',
      walletRef: 'wallet-to-uuid', assetCode: 'AED', ownerNo: 'CU-TO', traceId: null,
      businessDate: '2026-09-01',
    };
    const dispositionMock = { linkAdjustment: jest.fn() };
    const prismaMock: any = {
      // 按 caseNo 分流：createDraft 先查 dto.caseNo 拿 fromCase，
      // createReattributionDraft 再查 dto.toCaseNo 拿 toCase。
      reconciliationCase: {
        findUnique: jest.fn(({ where }: any) => Promise.resolve(
          where.caseNo === 'REC-FROM' ? fromCase : where.caseNo === 'REC-TO' ? toCase : null,
        )),
      },
      // owner 只查 fromCase 那一侧的客户——toOwnerNo 直接取 toCase.ownerNo，不必再查一次。
      customerMain: { findUnique: jest.fn().mockResolvedValue({ id: 'uuid-from-cust' }) },
      // 原单守卫命中充值表——正主方是"加钱"，必须指向一张已存在的原单（KYT 已对它跑过）。
      depositTransaction: { findUnique: jest.fn().mockResolvedValue({ id: 'dep-uuid' }) },
      withdrawTransaction: { findUnique: jest.fn().mockResolvedValue(null) },
      swapTransaction: { findUnique: jest.fn().mockResolvedValue(null) },
      reconciliationAdjustment: { create: jest.fn().mockResolvedValue({ adjustmentNo: 'ADJ_REATTR_1' }) },
    };
    const service = new AdjustmentService(
      prismaMock, null as any, null as any, { recordByActor: jest.fn() } as any, dispositionMock as any,
    );

    const r = await service.createDraft({
      caseNo: 'REC-FROM', toCaseNo: 'REC-TO',
      reasonCode: 'CUSTOMER_REATTRIBUTION', direction: 'REDUCE',   // direction 入参被忽略
      amount: '730000', effectiveDate: '2026-09-01',
      explainedFlowId: 'flow-from', explainedExternalLineId: 'ext-to',
      relatedOrderNo: 'DEP001', reasonInternal: 'x', reasonCustomer: 'y',
      dispositionNo: 'RCD001',
    } as any, ACTOR);

    const created = prismaMock.reconciliationAdjustment.create.mock.calls[0][0].data;
    expect(created.direction).toBe('REATTRIBUTE');
    expect(created.toWalletRef).toBe('wallet-to-uuid');
    expect(created.toOwnerNo).toBe('CU-TO');
    // 平账 A 批：afterDraftCreated 现在四族通用地带第三参 { family }——这条走的是
    // 第四族改记，本用例的 create() mock 没回填 reasonCode，family 求不出来不是
    // 本用例要锁的行为，用 objectContaining 只认「带了第三个参数」。
    expect(dispositionMock.linkAdjustment).toHaveBeenCalledWith('RCD001', r.adjustmentNo, expect.objectContaining({}));
  });

  it('reattribution with mismatched business dates → 400 (cross-day reattribution not supported this round)', async () => {
    const fromCase = {
      caseNo: 'REC-FROM', status: 'OPEN', book: 'CLIENT', businessDate: '2026-09-01',
      assetCode: 'AED', walletRef: 'wallet-from-uuid', ownerNo: 'CU-FROM', traceId: null,
    };
    // 只让 businessDate 不同——其余维度（book/assetCode/status）都对齐，确保
    // 测试卡在"业务日不同"这一条守卫上，不是被前面别的守卫提前拦下。
    const toCase = { ...fromCase, caseNo: 'REC-TO', businessDate: '2026-08-31' };
    const prismaMock: any = {
      reconciliationCase: {
        findUnique: jest.fn(({ where }: any) => Promise.resolve(
          where.caseNo === 'REC-FROM' ? fromCase : where.caseNo === 'REC-TO' ? toCase : null,
        )),
      },
    };
    const service = new AdjustmentService(
      prismaMock, null as any, null as any, { recordByActor: jest.fn() } as any, { linkAdjustment: jest.fn() } as any,
    );
    await expect(service.createDraft({
      caseNo: 'REC-FROM', toCaseNo: 'REC-TO',
      reasonCode: 'CUSTOMER_REATTRIBUTION', direction: 'REDUCE',
      amount: '1000', effectiveDate: '2026-08-31',
      reasonInternal: 'x', reasonCustomer: 'y',
    } as any, ACTOR)).rejects.toThrow(/different business dates/);
  });

  it('reattribution missing toCaseNo / missing relatedOrderNo → each 400', async () => {
    const fromCase = {
      caseNo: 'REC-FROM', status: 'OPEN', book: 'CLIENT', businessDate: '2026-09-01',
      assetCode: 'AED', walletRef: 'wallet-from-uuid', ownerNo: 'CU-FROM', traceId: null,
    };
    const toCase = { ...fromCase, caseNo: 'REC-TO', walletRef: 'wallet-to-uuid', ownerNo: 'CU-TO' };
    const makeService = () => {
      const prismaMock: any = {
        reconciliationCase: {
          findUnique: jest.fn(({ where }: any) => Promise.resolve(
            where.caseNo === 'REC-FROM' ? fromCase : where.caseNo === 'REC-TO' ? toCase : null,
          )),
        },
      };
      return new AdjustmentService(
        prismaMock, null as any, null as any, { recordByActor: jest.fn() } as any, { linkAdjustment: jest.fn() } as any,
      );
    };

    // Assertion 1: toCaseNo not passed — the rightful owner is unknown, the adjustment should never open.
    await expect(makeService().createDraft({
      caseNo: 'REC-FROM',
      reasonCode: 'CUSTOMER_REATTRIBUTION', direction: 'REDUCE',
      amount: '1000', effectiveDate: '2026-09-01',
      reasonInternal: 'x', reasonCustomer: 'y',
    } as any, ACTOR)).rejects.toThrow(/toCaseNo|rightful-owner case number/);

    // Assertion 2: toCaseNo given, but relatedOrderNo missing — the rightful owner is "adding funds", no original order means crediting funds out of thin air.
    await expect(makeService().createDraft({
      caseNo: 'REC-FROM', toCaseNo: 'REC-TO',
      reasonCode: 'CUSTOMER_REATTRIBUTION', direction: 'REDUCE',
      amount: '1000', effectiveDate: '2026-09-01',
      reasonInternal: 'x', reasonCustomer: 'y',
    } as any, ACTOR)).rejects.toThrow(/reference an existing order/);
  });

  // afterDraftCreated 是四族通用的收尾——用既有三族里最简单的一条路径（客户账簿
  // 减钱、不触发原单守卫）验证它接上了，不必借第四族才能测到这条通用行为。
  it('every createDraft (common to all four families) records RECON_ADJUSTMENT_DRAFTED, with an explicit requestId', async () => {
    const openCase = {
      caseNo: 'CASE_DRAFTED_1', status: 'OPEN', book: 'CLIENT',
      walletRef: 'W_DRAFTED', assetCode: 'AED', ownerNo: 'C0042', traceId: null,
      businessDate: '2026-08-28',
    };
    const recordByActor = jest.fn();
    // afterDraftCreated 读的是 create() 落库后拿回的 row，不是 dto——
    // mock 只需给出审计信封会用到的那几列。
    const createdRow = {
      adjustmentNo: 'ADJ2608280099', reasonCode: 'DUP_BOOKING', amount: '1000',
      ownerNo: 'C0042', caseNo: 'CASE_DRAFTED_1', direction: 'REDUCE', book: 'CLIENT',
      reasonInternal: 'Same deposit recorded twice',
    };
    const prismaMock: any = {
      reconciliationCase: { findUnique: jest.fn().mockResolvedValue(openCase) },
      customerMain: { findUnique: jest.fn().mockResolvedValue({ id: 'uuid-cust' }) },
      reconciliationAdjustment: { create: jest.fn().mockResolvedValue(createdRow) },
    };
    const service = new AdjustmentService(
      prismaMock, null as any, null as any, { recordByActor } as any, { linkAdjustment: jest.fn() } as any,
    );

    await service.createDraft({
      caseNo: 'CASE_DRAFTED_1', reasonCode: 'DUP_BOOKING',
      direction: 'REDUCE', amount: '1000', effectiveDate: '2026-08-28',
      reasonInternal: 'Same deposit recorded twice', reasonCustomer: 'Duplicate deposit reversal',
    } as any, ACTOR);

    expect(recordByActor).toHaveBeenCalledTimes(1);
    const envelope = recordByActor.mock.calls[0][0];
    expect(envelope.action).toBe('RECON_ADJUSTMENT_DRAFTED');
    // requiredFields 顶层——assertActionSpec 读的是信封顶层字段，不是 metadata。
    expect(envelope.reasonCode).toBe('DUP_BOOKING');
    expect(envelope.amount).toBe('1000');
    // 漏了显式 requestId 会被静默去重、审计直接消失（本仓踩过）。
    expect(envelope.requestId).toMatch(/^RECON_ADJUSTMENT_DRAFTED_ADJ/);
  });
});

// 平账一期半 T6：第四族落账（改记）。这是本批唯一真动账本的一段，
// 会计正确性是核心——四条断言各自锁住一处「mock 下会全绿、真环境里会炸/会算错」
// 的坑（ledger 取 currency、CLIENT_PAYABLE 的 ownerType、evidence.assetCurrency、
// 两腿钱包各落各的）。
describe('AdjustmentService.onApproved fourth-family posting (reattribution, spec §6)', () => {
  const makeSvc = (row: any, accounting: any, update = jest.fn(), recordByActor = jest.fn()) => {
    const prisma: any = {
      reconciliationAdjustment: { findUnique: jest.fn().mockResolvedValue(row), update },
      asset: {
        findUnique: jest.fn(async ({ where }: any) => ({
          currency: where?.code === 'USDT-TRON' ? 'USDT' : where?.code,
        })),
      },
      // 正主方只有业务号（toOwnerNo），落账要 UUID 才能定位它的客户负债户——
      // 这一次查询就是「负债换主人」的机制本身。
      customerMain: {
        findUnique: jest.fn(async ({ where }: any) => (where?.customerNo === 'CU-TO' ? { id: 'uuid-to' } : null)),
      },
    };
    return new AdjustmentService(prisma, null as any, accounting, { recordByActor } as any, null as any);
  };

  const reattrRow = {
    adjustmentNo: 'ADJ2609010001', status: 'PENDING_APPROVAL', book: 'CLIENT',
    direction: 'REATTRIBUTE', reasonCode: 'CUSTOMER_REATTRIBUTION',
    walletRef: 'wallet-from', toWalletRef: 'wallet-to',
    assetCode: 'AED', amount: '730000', effectiveDate: '2026-09-01',
    ownerNo: 'CU-FROM', ownerId: 'uuid-from', toOwnerNo: 'CU-TO',
    caseNo: 'RC26090100001', reasonInternal: 'Misattributed customer', traceId: 'T-REATTR',
    relatedOrderNo: 'DP2609010001',
  };

  it('debit from-payable / credit to-payable: both legs share the account CLIENT_PAYABLE, ownerType is CUSTOMER on both, ownerUuid is each side\'s own; the client asset leg never appears', async () => {
    const resolveTbAccountId = jest.fn().mockResolvedValue(1n);
    const accounting = { executeTransfer: jest.fn().mockResolvedValue({ tbTransferId: 9n }), resolveTbAccountId };
    await makeSvc(reattrRow, accounting).onApproved('ADJ2609010001', 'U_OPS');

    const calls = resolveTbAccountId.mock.calls.map((c: any[]) => c[0]);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.code)).toEqual([TB_ACCOUNT_CODES.CLIENT_PAYABLE, TB_ACCOUNT_CODES.CLIENT_PAYABLE]);
    // CLIENT_PAYABLE 在 TbAccountRegistry 里按客户 UUID 登记——传 'SYSTEM' 会查不到
    // 注册行而抛 NotFoundException（只断言 code 不断言 ownerType 时，这类错在 mock 下全绿）。
    expect(calls.map((c) => c.ownerType)).toEqual(['CUSTOMER', 'CUSTOMER']);
    // 同科目、不同 ownerUuid —— 这正是「把负债换个主人」的机制。
    expect(calls.map((c) => c.ownerUuid)).toEqual(['uuid-from', 'uuid-to']);
    // 钱在托管里一分没动：客户资产腿绝不许出现在改记分录里。
    expect(calls.map((c) => c.code)).not.toContain(TB_ACCOUNT_CODES.CLIENT_ASSET);
  });

  it('evidence: each leg posts to its own wallet (misattributed party down / rightful owner up), isExternalCrossing=false, effective date follows the adjustment', async () => {
    const executeTransfer = jest.fn().mockResolvedValue({ tbTransferId: 9n });
    const accounting = { executeTransfer, resolveTbAccountId: jest.fn().mockResolvedValue(1n) };
    await makeSvc(reattrRow, accounting).onApproved('ADJ2609010001', 'U_OPS');

    const params = executeTransfer.mock.calls[0][0];
    expect(params.amount).toBe(730000n);
    const evidence = params.evidence;
    // 两腿钱包写反或写成同一个，两案的差额就不会各自归零，重对账时案子无法自愈。
    expect(evidence.debitWalletRef).toBe('wallet-from');
    expect(evidence.creditWalletRef).toBe('wallet-to');
    expect(evidence.isExternalCrossing).toBe(false);
    expect(evidence.effectiveDate).toBe('2026-09-01');
    expect(evidence.debitCode).toBe('L.CLIENT_PAYABLE');
    expect(evidence.creditCode).toBe('L.CLIENT_PAYABLE');
  });

  it('crypto reattribution: both ledger and evidence.assetCurrency use asset.currency (USDT-TRON → USDT), not assetCode', async () => {
    const executeTransfer = jest.fn().mockResolvedValue({ tbTransferId: 9n });
    const accounting = { executeTransfer, resolveTbAccountId: jest.fn().mockResolvedValue(1n) };
    await makeSvc({ ...reattrRow, assetCode: 'USDT-TRON' }, accounting).onApproved('ADJ2609010001', 'U_OPS');

    const params = executeTransfer.mock.calls[0][0];
    // 拿 assetCode 索引 TB_LEDGERS 会得到 undefined → 抛 NotFoundException，
    // 而 handler 的异常本仓现状不外传：所有加密币改记单会永远停在 PENDING_APPROVAL。
    expect(params.ledger).toBe(2);
    // 传错 assetCurrency 会让这笔分录在管理台按币种筛选时消失（本仓已付过一次学费）。
    expect(params.evidence.assetCurrency).toBe('USDT');
  });

  it('after posting, status becomes POSTED, tbTransferId recorded, the decider lands as a business number (principle ⑥)', async () => {
    const update = jest.fn();
    const accounting = {
      executeTransfer: jest.fn().mockResolvedValue({ tbTransferId: 88n }),
      resolveTbAccountId: jest.fn().mockResolvedValue(1n),
    };
    await makeSvc(reattrRow, accounting, update).onApproved('ADJ2609010001', 'U_OPS_UUID', 'OPS-001', 'OPS_OFFICER');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'POSTED', tbTransferId: '88', decidedByUserId: 'OPS-001' }),
    }));
  });

  it('an already-POSTED reattribution posted again is rejected by the status machine (principle ④), and touches no ledger, writes nothing', async () => {
    const executeTransfer = jest.fn();
    const update = jest.fn();
    const accounting = { executeTransfer, resolveTbAccountId: jest.fn() };
    await expect(
      makeSvc({ ...reattrRow, status: 'POSTED' }, accounting, update).onApproved('ADJ2609010001', 'U_OPS'),
    ).rejects.toThrow(BadRequestException);
    expect(executeTransfer).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('the rightful owner\'s customer cannot be resolved → throws NotFoundException, ledger stays untouched (better to not post than to credit a liability to an unresolvable account)', async () => {
    const executeTransfer = jest.fn();
    const accounting = { executeTransfer, resolveTbAccountId: jest.fn().mockResolvedValue(1n) };
    await expect(
      makeSvc({ ...reattrRow, toOwnerNo: 'CU-NOBODY' }, accounting).onApproved('ADJ2609010001', 'U_OPS'),
    ).rejects.toThrow(NotFoundException);
    expect(executeTransfer).not.toHaveBeenCalled();
  });

  it('the audit envelope matches the main path\'s shape: RECON_ADJUSTMENT_POSTED, requiredFields at the top level, explicit requestId, the real assertActionSpec does not reject; metadata carries an extra rightful-owner clue', async () => {
    const recordByActor = jest.fn();
    const accounting = {
      executeTransfer: jest.fn().mockResolvedValue({ tbTransferId: 9n }),
      resolveTbAccountId: jest.fn().mockResolvedValue(1n),
    };
    await makeSvc(reattrRow, accounting, jest.fn(), recordByActor).onApproved('ADJ2609010001', 'U_OPS');

    expect(recordByActor).toHaveBeenCalledTimes(1);
    const envelope = recordByActor.mock.calls[0][0];
    expect(envelope.action).toBe('RECON_ADJUSTMENT_POSTED');
    // 顶层缺字段会被 assertActionSpec 拒写：账已过、单已 POSTED，这一步再拒
    // 就是「落了账却没留痕」，静默踩铁律①。
    for (const field of V8_RECON_AUDIT_ACTIONS.RECON_ADJUSTMENT_POSTED.requiredFields) {
      expect(envelope[field as keyof typeof envelope]).not.toBeUndefined();
      expect(envelope[field as keyof typeof envelope]).not.toBeNull();
    }
    // 让生产用的那个校验函数亲自跑一遍——不是照抄合同表再断言一次。
    const realAuditLogs = new AuditLogsService(null as any);
    expect(() => (realAuditLogs as any).assertActionSpec(envelope)).not.toThrow();
    // 漏了显式 requestId 会被静默去重、审计直接消失（本仓踩过）。
    expect(envelope.requestId).toMatch(/^RECON_ADJUSTMENT_POSTED_ADJ2609010001_/);
    // 改记单只从错记方名下看得出「少了一笔」，钱去了哪必须在留痕里查得到。
    expect(envelope.metadata.toOwnerNo).toBe('CU-TO');
    expect(envelope.subjects).toEqual(expect.arrayContaining([
      expect.objectContaining({ subjectType: 'CUSTOMER', subjectNo: 'CU-FROM', subjectRole: 'OWNER' }),
      expect.objectContaining({ subjectType: 'RECONCILIATION_CASE', subjectNo: 'RC26090100001', subjectRole: 'RELATED' }),
    ]));
  });

  // 评审 Important：改记贷记的是**正主方**的客户负债，B 的余额真的变了。审计子表
  // 按 subjects 建索引、metadata 不进索引——正主方只写进 metadata 的话，「按客户号
  // 查审计」查 B 时这条事件根本不出现，等于「改了 B 的钱、按 B 查不到」，踩铁律①。
  // 这是本仓第一个双 OWNER 事件，所以断言两个 OWNER **同时存在**，不断言数组长度
  // （长度断言会在未来往 subjects 里加任何一条无关主体时误红，也测不出少的是哪一个）。
  it('both customers land in subjects: one CUSTOMER/OWNER entry each for the misattributed party and the rightful owner (this reattribution must also be findable by the rightful owner\'s customer number)', async () => {
    const recordByActor = jest.fn();
    const accounting = {
      executeTransfer: jest.fn().mockResolvedValue({ tbTransferId: 9n }),
      resolveTbAccountId: jest.fn().mockResolvedValue(1n),
    };
    await makeSvc(reattrRow, accounting, jest.fn(), recordByActor).onApproved('ADJ2609010001', 'U_OPS');

    const subjects = recordByActor.mock.calls[0][0].subjects;
    const owners = subjects.filter((s: any) => s.subjectType === 'CUSTOMER' && s.subjectRole === 'OWNER');
    expect(owners.map((s: any) => s.subjectNo).sort()).toEqual(['CU-FROM', 'CU-TO']);
    // PRIMARY 仍只有一个——persistSubjects 对多于一个 PRIMARY 是直接抛错的。
    expect(subjects.filter((s: any) => s.subjectRole === 'PRIMARY')).toHaveLength(1);
  });
});

describe('AdjustmentService.describeImpact fourth family —— the approver must see whose name the money moved from and to', () => {
  const svc = new AdjustmentService(null as any, null as any, null as any, null as any, null as any);

  it('outputs "reattributed from A to B; total customer assets unchanged"', () => {
    const text = svc.describeImpact({
      book: 'CLIENT', ownerNo: 'CU-FROM', amount: '730000', assetCode: 'AED',
      direction: 'REATTRIBUTE', reasonCode: 'CUSTOMER_REATTRIBUTION',
      reasonInternal: 'Misattributed customer', toOwnerNo: 'CU-TO',
    } as any, 2);
    expect(text).toContain('CU-FROM');
    expect(text).toContain('CU-TO');
    expect(text).toContain('7300.00');
    // The money in custody did not move — this sentence is the key fact the approver uses to decide whether to approve.
    expect(text).toContain('total customer assets are unchanged');
    // The other three families' "balance increased/decreased" wording is wrong for reattribution: nothing increased or decreased, only the owner changed.
    expect(text).not.toContain('balance increase');
    expect(text).not.toContain('balance decrease');
  });
});

// 顺手收口（前序评审）：Task 5 让 toWalletRef 真正落库之后，详情接口的解构
// 排除清单只剔了 walletRef —— 改记单一被查询就把正主方钱包的内部 UUID 吐出去，
// 踩铁律⑥「管理台不暴露 UUID」。
describe('AdjustmentService.getAdjustment fourth family —— the rightful owner\'s wallet also only reveals the business number', () => {
  const reattrRow = {
    id: 'uuid-row', adjustmentNo: 'ADJ2609010002', caseNo: 'RC26090100001',
    explainedFlowId: 'flow-from', explainedExternalLineId: 'ext-to',
    walletRef: 'wallet-from', toWalletRef: 'wallet-to', toOwnerNo: 'CU-TO',
    book: 'CLIENT', direction: 'REATTRIBUTE', reasonCode: 'CUSTOMER_REATTRIBUTION',
    assetCode: 'AED', amount: '730000', effectiveDate: '2026-09-01',
    reasonInternal: 'Misattributed customer', reasonCustomer: 'Account correction',
    status: 'DRAFT', approvalCaseId: null, approvalNo: null,
    ownerNo: 'CU-FROM', ownerId: 'uuid-from', traceId: null,
    createdByUserId: 'U_OP', decidedByUserId: null, postedAt: null, tbTransferId: null,
  };
  const makeSvc = () => {
    const prisma: any = {
      reconciliationAdjustment: { findUnique: jest.fn().mockResolvedValue(reattrRow) },
      wallet: {
        findUnique: jest.fn(async ({ where }: any) => ({
          walletNo: where?.id === 'wallet-from' ? 'WAL-FROM' : 'WAL-TO',
        })),
      },
      asset: { findUnique: jest.fn().mockResolvedValue({ decimals: 2 }) },
    };
    return new AdjustmentService(prisma, null as any, null as any, null as any, null as any);
  };

  it('toWalletRef does not appear in the response body, replaced by the business number toWalletNo; the rightful owner\'s customer number is given as usual', async () => {
    const result: any = await makeSvc().getAdjustment('ADJ2609010002');
    expect(result.toWalletRef).toBeUndefined();
    expect(result.walletRef).toBeUndefined();
    expect(result.toWalletNo).toBe('WAL-TO');
    expect(result.walletNo).toBe('WAL-FROM');
    expect(result.toOwnerNo).toBe('CU-TO');
  });

  it('the posting preview uses the fifth combination: both debit and credit are L.CLIENT_PAYABLE — must not fall back to the (book,direction) four-combination logic (that would show "debit client asset", the reverse of what actually posts)', async () => {
    const result: any = await makeSvc().getAdjustment('ADJ2609010002');
    expect(result.debitAccountCode).toBe('L.CLIENT_PAYABLE');
    expect(result.creditAccountCode).toBe('L.CLIENT_PAYABLE');
  });
});

describe('Recon batch A: write-off four preconditions (spec §3.2) —— missing even one is a backdoor for erasing differences', () => {
  const firmCase = {
    caseNo: 'CASE_WO', status: 'OPEN', book: 'FIRM', walletRef: 'W_FIRM', assetCode: 'AED', ownerNo: null, traceId: null,
    businessDate: '2026-09-02', slaBreached: true,
  };
  const heldDisposition = { dispositionNo: 'RCD001', outlet: 'HOLD_INVESTIGATING', causeCode: 'UNEXPLAINED', adjustmentNo: null };
  const OP = { actorType: 'ADMIN' as const, userId: 'U_TR', userNo: 'U_TR', roleCodes: ['TREASURY_OFFICER'] };
  const dto = {
    caseNo: 'CASE_WO', reasonCode: 'UNEXPLAINED_WRITE_OFF', direction: 'REDUCE', amount: '7', effectiveDate: '2026-09-02',
    explainedFlowId: 'flow-1', explainedExternalLineId: 'ext-1',
    reasonInternal: 'Unexplained write-off', reasonCustomer: '(firm side, not visible to customer)',
  };
  const makeSvc = (kase: any, disposition: any) => {
    const create = jest.fn().mockResolvedValue({ adjustmentNo: 'ADJ_WO', reasonCode: 'UNEXPLAINED_WRITE_OFF', caseNo: 'CASE_WO', amount: '7', direction: 'REDUCE', book: 'FIRM' });
    const prisma: any = {
      reconciliationCase: { findUnique: jest.fn().mockResolvedValue(kase) },
      reconciliationDisposition: { findFirst: jest.fn().mockResolvedValue(disposition) },
      asset: { findUnique: jest.fn().mockResolvedValue({ currency: 'AED', decimals: 2 }) },
      customerMain: { findUnique: jest.fn().mockResolvedValue(null) },
      reconciliationAdjustment: { create },
      depositTransaction: { findUnique: jest.fn().mockResolvedValue(null) },
      withdrawTransaction: { findUnique: jest.fn().mockResolvedValue(null) },
      swapTransaction: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const dispositions = { linkAdjustment: jest.fn().mockResolvedValue(undefined) };
    const svc = new AdjustmentService(prisma, null as any, null as any, { recordByActor: jest.fn() } as any, dispositions as any);
    return { svc, prisma, create, dispositions };
  };

  it('precondition 1: the case has not aged out → 400, copy states clearly "write-off can only be discussed after that"', async () => {
    const { svc } = makeSvc({ ...firmCase, slaBreached: false }, heldDisposition);
    await expect(svc.createDraft(dto as any, OP)).rejects.toThrow(/aging threshold/);
  });
  it('precondition 2: the anchored line has no finding, or its conclusion is not "Hold · Investigating" → 400', async () => {
    await expect(makeSvc(firmCase, null).svc.createDraft(dto as any, OP)).rejects.toThrow(/Hold · Investigating/);
    await expect(makeSvc(firmCase, { ...heldDisposition, outlet: 'HOLD_NEXT_PERIOD', causeCode: 'CUTOFF_STRADDLE' }).svc.createDraft(dto as any, OP))
      .rejects.toThrow(/Hold · Next period/);
  });
  it('precondition 2b: the finding is already linked to an adjustment → 400', async () => {
    await expect(makeSvc(firmCase, { ...heldDisposition, adjustmentNo: 'ADJ_OLD' }).svc.createDraft(dto as any, OP)).rejects.toThrow(/ADJ_OLD/);
  });
  // Recon wave 2 Task 4 change: the client pool is no longer always 400 — it is rejected only when
  // using the firm pool's write-off code (UNEXPLAINED_WRITE_OFF), the rejection reason being a "book
  // × reason code pairing" mismatch pointing to the client pool's own loss-recognition code, no longer
  // "wave 2 transfer" (the path where the client pool uses the correct code UNEXPLAINED_CLIENT_LOSS
  // and is allowed is covered in the new describe below).
  it('precondition 3: the client pool used the firm pool\'s write-off code → 400, copy points to the client pool\'s loss-recognition code', async () => {
    const { svc } = makeSvc({ ...firmCase, book: 'CLIENT', ownerNo: 'C0042' }, heldDisposition);
    await expect(svc.createDraft(dto as any, OP)).rejects.toThrow(/Client pool loss recognition/);
  });
  it('precondition 4: amount exceeds the small-amount threshold → 400, copy points to incident registration', async () => {
    const { svc } = makeSvc(firmCase, heldDisposition);
    await expect(svc.createDraft({ ...dto, amount: '10001' } as any, OP)).rejects.toThrow(/small-amount threshold/);
  });
  it('all four preconditions met → lands DRAFT, the finding is linked to the adjustment number (link carries family WRITE_OFF)', async () => {
    const { svc, create, dispositions } = makeSvc(firmCase, heldDisposition);
    const r = await svc.createDraft(dto as any, OP);
    expect(r.adjustmentNo).toBe('ADJ_WO');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reasonCode: 'UNEXPLAINED_WRITE_OFF', book: 'FIRM', direction: 'REDUCE', amount: '7' }) }));
    expect(dispositions.linkAdjustment).toHaveBeenCalledWith('RCD001', 'ADJ_WO', { family: 'WRITE_OFF' });
  });
});

describe('Recon batch A: the approval page tells it straight —— write-off family (spec §3.7)', () => {
  const svc = new AdjustmentService(null as any, null as any, null as any, null as any, null as any);
  it('states the pool, the wallet, where the difference goes, days overdue, and the investigation conclusion', () => {
    const text = svc.describeImpact({
      book: 'FIRM', ownerNo: null, amount: '7', assetCode: 'AED', direction: 'REDUCE',
      reasonCode: 'UNEXPLAINED_WRITE_OFF', reasonInternal: 'Unexplained write-off', caseNo: 'REC20260902-010',
    } as any, 2, { walletNo: 'WA2601017168', agedDays: 3, findingNote: 'Checked receipts for three days running; the difference follows no pattern' });
    expect(text).toContain('Firm pool unexplained write-off');
    expect(text).toContain('WA2601017168');
    expect(text).toContain('0.07');
    expect(text).toContain('recognized into operating funds');
    expect(text).toContain('overdue 3 days');
    expect(text).toContain('Checked receipts for three days');
  });
  it('the increase direction reads "recorded as other income"', () => {
    const text = svc.describeImpact({
      book: 'FIRM', ownerNo: null, amount: '7', assetCode: 'AED', direction: 'INCREASE',
      reasonCode: 'UNEXPLAINED_WRITE_OFF', reasonInternal: 'x', caseNo: 'REC-1',
    } as any, 2, { walletNo: 'WA1', agedDays: 4, findingNote: 'y' });
    expect(text).toContain('recorded as other income');
  });
});

// 平账三期 Task 10 评审 Fix 3（Important）：UNEXPLAINED_CLIENT_LOSS 的审批页 impact
// 文案有两条来路——HOLD_INVESTIGATING 老路（拖到账龄线还查不出原因）与 INCIDENT 事故
// 路（大额未授权转出，结论已经定成「公司承损」）。CFO 审批那一屏是动钱前最后人闸
// （describeImpact 函数头注释自己写的），继续对事故路说「查无果」「已超期 N 天」是在
// 审批页撒谎——两条路各自的文案在这里锁死，互不外溢。
describe('AdjustmentService.describeImpact —— client pool loss recognition\'s two paths each get their own copy (Task 10 review Fix 3)', () => {
  const svc = new AdjustmentService(null as any, null as any, null as any, null as any, null as any);
  const baseRow = {
    book: 'CLIENT', ownerNo: 'C0042', amount: '150000', assetCode: 'AED',
    direction: 'REDUCE', reasonCode: 'UNEXPLAINED_CLIENT_LOSS',
  } as any;

  it('HOLD_INVESTIGATING old path: copy keeps "unexplained" + days overdue as-is (no incidentNo passed)', () => {
    const text = svc.describeImpact(
      { ...baseRow, reasonInternal: 'Client loss recognition', caseNo: 'REC-HOLD-1' },
      2,
      { walletNo: 'WA001', agedDays: 5, findingNote: 'Multiple reconciliation passes turned up nothing' },
    );
    expect(text).toContain('Client pool unexplained loss recognition');
    expect(text).toContain('overdue 5 days');
    expect(text).not.toContain('incident');
  });

  it('INCIDENT path: does not say "unexplained", carries no days-overdue, carries the incident number + assessed amount, states "firm bears the loss"', () => {
    const text = svc.describeImpact(
      { ...baseRow, reasonInternal: 'Unauthorized outflow loss recognition', caseNo: 'REC-INC-1' },
      2,
      // agedDays is deliberately still passed a value (30) — to prove the incident path genuinely
      // does not read it, not that it merely failed to compute a days-overdue figure to show.
      { walletNo: 'WA001', agedDays: 30, findingNote: 'Large unauthorized outflow; incident has been assessed', incidentNo: 'INC-0009' },
    );
    expect(text).toContain('INC-0009');
    expect(text).toContain('Client pool loss recognition');
    expect(text).not.toContain('unexplained');
    expect(text).not.toContain('overdue');
    expect(text).not.toContain('30');
    expect(text).toContain('firm bears the loss');
    // 150000 minor units at decimals=2 is 1500.00 AED — the assessed amount and the adjustment amount
    // are the same number (assertIncidentWriteOffAllowed already locks the amount, the two must be equal).
    expect(text).toContain('1500.00');
  });
});

// 评审修复（I1，铁律⑥审批文案）：公司簿同样有事故升级路（LARGE_UNEXPLAINED，公司池
// 版）——事故已经定损，继续说「悬了多久、查过什么」是文不对题；对齐客户簿既有事故
// 句式，带上事故单号 + 金额锁定的依据。
describe("AdjustmentService.describeImpact —— firm pool write-off's incident path also gets its own copy (I1 review fix)", () => {
  const svc = new AdjustmentService(null as any, null as any, null as any, null as any, null as any);
  const baseRow = {
    book: 'FIRM', ownerNo: null, amount: '7', assetCode: 'AED',
    direction: 'REDUCE', reasonCode: 'UNEXPLAINED_WRITE_OFF',
  } as any;

  it('HOLD_INVESTIGATING old path unaffected: copy keeps "unexplained" + days overdue (no incidentNo passed)', () => {
    const text = svc.describeImpact(
      { ...baseRow, reasonInternal: 'Unexplained write-off', caseNo: 'REC-HOLD-2' },
      2,
      { walletNo: 'WA2', agedDays: 3, findingNote: 'Checked receipts for three days running' },
    );
    expect(text).toContain('Firm pool unexplained write-off');
    expect(text).toContain('overdue 3 days');
    expect(text).not.toContain('incident');
  });

  it('INCIDENT path: does not say "unexplained", carries no days-overdue, carries the incident number and states the amount is locked to the assessed loss', () => {
    const text = svc.describeImpact(
      { ...baseRow, reasonInternal: 'Unauthorized outflow write-off', caseNo: 'REC-INC-2' },
      2,
      // agedDays is deliberately still passed a value (30) — to prove the incident path genuinely
      // does not read it, not that it merely failed to compute a days-overdue figure to show.
      { walletNo: 'WA2', agedDays: 30, findingNote: 'Large unauthorized outflow; incident has been assessed', incidentNo: 'INC-FIRM-01' },
    );
    expect(text).toContain('INC-FIRM-01');
    expect(text).toContain('Firm pool write-off');
    expect(text).not.toContain('unexplained');
    expect(text).not.toContain('overdue');
    expect(text).not.toContain('30');
    expect(text).toContain("locked to the incident's assessed loss");
  });
});

// 评审修复（C1 挂接链）：submit() 端到端验证——大额升级路的定性行 outlet 停在
// HOLD_INVESTIGATING、只有 incidentNo 被 attachIncident 写上；submit() 读的是同一行
// 的 incidentNo（不再看 outlet），审批快照的 impact 文案里必须真的带上事故号，
// 不是只有 describeImpact 单测过了这个字符串拼接就算数。
describe('AdjustmentService.submit —— escalation path (outlet stays HOLD_INVESTIGATING, incidentNo attached) carries the incident number all the way into the approval impact copy (C1 挂接链评审修复)', () => {
  const actor = { actorType: 'ADMIN' as const, userId: 'U_OPS', userNo: 'U_OPS', roleCodes: ['OPS_OFFICER'] };
  const row = {
    adjustmentNo: 'ADJ_ESC_SUBMIT', status: AdjustmentStatus.DRAFT, caseNo: 'REC-ESC-SUB',
    book: 'CLIENT', direction: 'REDUCE', reasonCode: 'UNEXPLAINED_CLIENT_LOSS',
    amount: '123456', assetCode: 'AED', ownerNo: 'CU-9', toOwnerNo: null,
    walletRef: 'w-esc-sub', reasonInternal: 'Large unexplained difference, assessed via incident',
    traceId: null,
  };

  const makeSvc = () => {
    const prisma: any = {
      reconciliationAdjustment: {
        findUnique: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockResolvedValue({}),
      },
      asset: { findUnique: jest.fn().mockResolvedValue({ decimals: 2 }) },
      reconciliationCase: { findUnique: jest.fn().mockResolvedValue({ slaDeadline: null }) },
      wallet: { findUnique: jest.fn().mockResolvedValue({ walletNo: 'WA-ESC' }) },
      // outlet 仍是 HOLD_INVESTIGATING——attachIncident 只写 incidentNo 一列（disposition.service.ts）。
      reconciliationDisposition: {
        findFirst: jest.fn().mockResolvedValue({ findingNote: 'Escalated, incident assessed', outlet: 'HOLD_INVESTIGATING', incidentNo: 'INC-ESC-SUB' }),
      },
    };
    let capturedSnapshot: any;
    const approvals: any = {
      createAndSubmit: jest.fn((createDto: any) => {
        capturedSnapshot = createDto.objectSnapshot;
        return Promise.resolve({ id: 'appr-1', approvalNo: 'AP-ESC-SUB' });
      }),
    };
    const svc = new AdjustmentService(prisma, approvals, null as any, null as any, null as any);
    return { svc, prisma, approvals, getSnapshot: () => capturedSnapshot };
  };

  it("submit() reads incidentNo off the linked disposition line (regardless of outlet) and the approval snapshot's impact text carries the incident number", async () => {
    const { svc, prisma, approvals, getSnapshot } = makeSvc();
    await svc.submit('ADJ_ESC_SUBMIT', actor);
    expect(approvals.createAndSubmit).toHaveBeenCalled();
    const snapshot = getSnapshot();
    expect(snapshot.impact).toContain('INC-ESC-SUB');
    expect(snapshot.impact).not.toContain('unexplained');
    expect(prisma.reconciliationAdjustment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { adjustmentNo: 'ADJ_ESC_SUBMIT' },
      data: expect.objectContaining({ status: AdjustmentStatus.PENDING_APPROVAL, approvalNo: 'AP-ESC-SUB' }),
    }));
  });
});

// Task 4（调账单列表端点）: real DB, no mocks — the schema-smoke test at the top of this
// file already establishes the convention of hitting a live PrismaClient for behaviour
// that has to come from an actual query (ordering / filtering / a join), not from a mock
// echoing back whatever it was told to return. Fixture rows use far-future createdAt/
// effectiveDate markers (2031) so this suite can assert exact counts/order without
// depending on — or colliding with — the ~14 pre-existing rows already in this worktree's
// shared dev.db (seeded by demo data and other e2e runs).
describe('AdjustmentService.listAdjustments —— list read model (Task 4)', () => {
  const prisma = new PrismaClient();
  const svc = new AdjustmentService(prisma as any, null as any, null as any, null as any, null as any);

  const baseRow = {
    caseNo: 'CASE_LIST_T4', walletRef: 'W_LIST_T4', book: 'CLIENT',
    reasonInternal: 'list fixture', reasonCustomer: 'list fixture', createdByUserId: 'U_LIST_T4',
  };

  beforeAll(async () => {
    await (prisma as any).reconciliationAdjustment.createMany({
      data: [
        {
          ...baseRow, adjustmentNo: 'ADJ_LIST_T4_1', ownerNo: 'C_LIST_T4_1',
          direction: 'REDUCE', reasonCode: 'DUP_BOOKING', assetCode: 'AED', amount: '1000',
          effectiveDate: '2031-01-01', status: 'DRAFT', createdAt: new Date('2031-01-01T00:00:00Z'),
        },
        {
          ...baseRow, adjustmentNo: 'ADJ_LIST_T4_2', ownerNo: 'C_LIST_T4_2',
          direction: 'INCREASE', reasonCode: 'PAYOUT_NOT_EXECUTED', assetCode: 'USDT-TRON', amount: '2000000',
          effectiveDate: '2031-01-02', status: 'DRAFT', createdAt: new Date('2031-01-02T00:00:00Z'),
        },
        {
          ...baseRow, adjustmentNo: 'ADJ_LIST_T4_3', ownerNo: null,
          direction: 'REDUCE', reasonCode: 'BANK_CHARGE_UNBOOKED', assetCode: 'AED', amount: '3000',
          effectiveDate: '2031-01-03', status: 'REJECTED', createdAt: new Date('2031-01-03T00:00:00Z'),
        },
      ],
    });
  });
  afterAll(async () => {
    await (prisma as any).reconciliationAdjustment.deleteMany({ where: { caseNo: 'CASE_LIST_T4' } });
    await prisma.$disconnect();
  });

  const RANGE = { from: '2031-01-01', to: '2031-01-04' };

  it('sorts createdAt desc, joins asset.decimals by assetCode, and the row shape carries no UUID (no id / walletRef / ownerId)', async () => {
    const { items, total } = await svc.listAdjustments({ ...RANGE, take: 100 });
    expect(total).toBe(3);
    expect(items.map((r) => r.adjustmentNo)).toEqual(['ADJ_LIST_T4_3', 'ADJ_LIST_T4_2', 'ADJ_LIST_T4_1']);

    const aedRow = items.find((r) => r.adjustmentNo === 'ADJ_LIST_T4_1')!;
    expect(aedRow.decimals).toBe(2); // AED
    const usdtRow = items.find((r) => r.adjustmentNo === 'ADJ_LIST_T4_2')!;
    expect(usdtRow.decimals).toBe(6); // USDT-TRON

    for (const row of items) {
      expect(Object.keys(row).sort()).toEqual([
        'adjustmentNo', 'amount', 'assetCode', 'caseNo', 'createdAt', 'decimals',
        'direction', 'effectiveDate', 'ownerNo', 'reasonCode', 'status',
      ]);
    }
  });

  it('status filter actually narrows the query (not a client-side illusion)', async () => {
    const draftOnly = await svc.listAdjustments({ ...RANGE, status: 'DRAFT' });
    expect(draftOnly.total).toBe(2);
    expect(draftOnly.items.map((r) => r.adjustmentNo)).toEqual(['ADJ_LIST_T4_2', 'ADJ_LIST_T4_1']);

    const rejectedOnly = await svc.listAdjustments({ ...RANGE, status: 'REJECTED' });
    expect(rejectedOnly.total).toBe(1);
    expect(rejectedOnly.items[0].adjustmentNo).toBe('ADJ_LIST_T4_3');
  });

  it('pagination: total reflects the full filtered set regardless of skip/take, items reflect only the current page', async () => {
    const page = await svc.listAdjustments({ ...RANGE, take: 1, skip: 1 });
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].adjustmentNo).toBe('ADJ_LIST_T4_2');
  });
});

describe('单码制 REASON_SPECS（spec §5）', () => {
  it.each([
    ['AMT_MISBOOKED', 'CLIENT', ['REDUCE', 'INCREASE']],
    ['DUP_BOOKING', 'CLIENT', ['REDUCE']],
    ['PAYOUT_NOT_EXECUTED', 'CLIENT', ['INCREASE']],
    ['FIRM_AMT_UNDERBOOKED', 'FIRM', ['REDUCE', 'INCREASE']],
    ['BANK_INTEREST_UNBOOKED', 'FIRM', ['INCREASE']],
    ['BANK_CHARGE_UNBOOKED', 'FIRM', ['REDUCE']],
  ] as const)('%s 落在 %s 簿、方向 %j', (code, book, dirs) => {
    expect(REASON_SPECS[code].book).toBe(book);
    expect(REASON_SPECS[code].directions).toEqual(dirs);
    expect(REASON_SPECS[code].customerLabel !== undefined).toBe(true);
  });
  it('OTHER 双簿双向放行，客户话术受控', () => {
    expect(REASON_SPECS.OTHER.book).toBe('ANY');
    expect(() => assertReasonAllowed('OTHER', 'CLIENT', 'REDUCE')).not.toThrow();
    expect(() => assertReasonAllowed('OTHER', 'FIRM', 'INCREASE')).not.toThrow();
    expect(REASON_SPECS.OTHER.customerLabel).toBe('Balance correction');
  });
});
