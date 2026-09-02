import { PrismaClient } from '@prisma/client';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdjustmentStatus } from '../constants/adjustment-transitions.constant';
import { AdjustmentService } from './adjustment.service';
import { TB_ACCOUNT_CODES } from '../../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { V8_RECON_AUDIT_ACTIONS } from '../../../audit-logging/constants/audit-actions.constant';
import { AuditLogsService } from '../../../audit-logging/audit-logs.service';

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
  // T5：构造器新增第 5 个依赖 DispositionService（改记开单收尾要用）——
  // 本 describe 只测纯同步方法，不碰任何依赖，占位 null 即可。
  const svc = new AdjustmentService(null as any, null as any, null as any, null as any, null as any);

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
  const svc = new AdjustmentService(null as any, null as any, null as any, null as any, null as any);
  it('客户账簿减钱，说清是谁、少多少、为什么——金额按 decimals 缩放成人看得懂的数，成因显示客户口径标签而不是原始枚举', () => {
    const text = svc.describeImpact({
      book: 'CLIENT', ownerNo: 'C0042', amount: '1500', assetCode: 'AED',
      direction: 'REDUCE', reasonCode: 'DEPOSIT_DUPLICATE_REVERSAL', reasonInternal: '同一笔充值入账两次',
    } as any, 2);
    expect(text).toContain('C0042');
    expect(text).toContain('减少');
    // Fix 1b：1500 分（最小单位）在 decimals=2 下是 15.00 AED，不是裸打印的 1500——
    // 后者是审批人唯一读到金额的这一屏上两个数量级的错读（200.00 AED 读成 20000）。
    expect(text).toContain('15.00');
    expect(text).not.toContain('1500');
    // customerLabel（"重复入账撤销"）取代原始枚举 DEPOSIT_DUPLICATE_REVERSAL。
    expect(text).toContain('重复入账撤销');
    expect(text).not.toContain('DEPOSIT_DUPLICATE_REVERSAL');
    expect(text).toContain('同一笔充值入账两次');
  });
  it('公司账簿：文案显示"公司自有资金"', () => {
    const text = svc.describeImpact({
      book: 'FIRM', ownerNo: null, amount: '500', assetCode: 'AED',
      direction: 'REDUCE', reasonCode: 'BANK_CHARGE', reasonInternal: '银行手续费扣款',
    } as any, 2);
    expect(text).toContain('公司自有资金');
    expect(text).toContain('5.00'); // 500 分 → 5.00 AED
    // 末站 Minor 1：公司侧两个成因的 customerLabel 刻意为 null（客户看不到公司侧调账），
    // 早先借用它会让这一屏回落打印裸枚举「成因：BANK_CHARGE」——客户侧五个成因都是中文，
    // 唯独公司侧半英半中。现在走 internalLabel。
    expect(text).toContain('银行杂费');
    expect(text).not.toContain('BANK_CHARGE');
  });
  it('方向 INCREASE 时文案显示"增加"', () => {
    const text = svc.describeImpact({
      book: 'CLIENT', ownerNo: 'C0099', amount: '800', assetCode: 'USDT',
      direction: 'INCREASE', reasonCode: 'WITHDRAW_VOID_REFUND', reasonInternal: '提现被驳回退回余额',
    } as any, 6);
    expect(text).toContain('增加');
    expect(text).toContain('0.000800'); // 800 最小单位 → 6 位 decimals 的 USDT
  });
});

describe('AdjustmentService.createDraft 两道闸 —— 门不可绕的落点，闸失效不能只靠人眼看代码', () => {
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

  it('闸二·边界线：客户账簿加钱不传关联原单号 → 拒', async () => {
    const { svc } = makeSvc(openClientCase);
    await expect(svc.createDraft({
      caseNo: 'CASE_GATE', lineItemId: 'LI_1', reasonCode: 'DEPOSIT_AMOUNT_CORRECTION',
      direction: 'INCREASE', amount: '1000', effectiveDate: '2026-08-28',
      reasonInternal: '充值金额记错，需向上更正', reasonCustomer: '充值金额更正',
    } as any, OP)).rejects.toThrow(BadRequestException);
  });

  it('闸二·放行：传了关联原单号且原单真实存在（充值单）→ 不拒，落库的 relatedOrderNo 是传进去的值', async () => {
    const { svc, create, prisma } = makeSvc(openClientCase);
    prisma.depositTransaction.findUnique.mockResolvedValue({ id: 'dep-uuid' });
    await svc.createDraft({
      caseNo: 'CASE_GATE', lineItemId: 'LI_1', reasonCode: 'DEPOSIT_AMOUNT_CORRECTION',
      direction: 'INCREASE', amount: '1000', effectiveDate: '2026-08-28',
      reasonInternal: '充值金额记错，需向上更正', reasonCustomer: '充值金额更正',
      relatedOrderNo: 'DEP2608280001',
    } as any, OP);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ relatedOrderNo: 'DEP2608280001' }),
    }));
    // 反遮蔽：查询必须按传进来的这个单号查，不是任意通配。
    expect(prisma.depositTransaction.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { depositNo: 'DEP2608280001' } }),
    );
  });

  it('闸二·放行：原单是提现单而不是充值单也认——三张表逐一查，不是只认充值表', async () => {
    const { svc, create, prisma } = makeSvc(openClientCase);
    prisma.withdrawTransaction.findUnique.mockResolvedValue({ id: 'wd-uuid' });
    await svc.createDraft({
      caseNo: 'CASE_GATE', reasonCode: 'WITHDRAW_VOID_REFUND',
      direction: 'INCREASE', amount: '1000', effectiveDate: '2026-08-28',
      reasonInternal: '提现已撤销但账没冲', reasonCustomer: '提现撤销退回',
      relatedOrderNo: 'WD2608280001',
    } as any, OP);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ relatedOrderNo: 'WD2608280001' }),
    }));
  });

  it('闸二·边界线（Fix 3）：relatedOrderNo 非空，但充值/提现/兑换三张表都查无此单 → 拒——不能靠瞎填一个单号就绕过边界线守卫', async () => {
    const { svc, create, prisma } = makeSvc(openClientCase);
    await expect(svc.createDraft({
      caseNo: 'CASE_GATE', reasonCode: 'DEPOSIT_AMOUNT_CORRECTION',
      direction: 'INCREASE', amount: '1000', effectiveDate: '2026-08-28',
      reasonInternal: '充值金额记错，需向上更正', reasonCustomer: '充值金额更正',
      relatedOrderNo: 'DEP_DOES_NOT_EXIST',
    } as any, OP)).rejects.toThrow(BadRequestException);
    // 拒得干净：没有走到落库那一步。
    expect(create).not.toHaveBeenCalled();
    // 反遮蔽：确实查过三张表（不是提前因为别的原因短路拒绝）。
    expect(prisma.depositTransaction.findUnique).toHaveBeenCalled();
    expect(prisma.withdrawTransaction.findUnique).toHaveBeenCalled();
    expect(prisma.swapTransaction.findUnique).toHaveBeenCalled();
  });

  it('闸一·成因非法组合：FIRM 专属成因配到 CLIENT 账簿的 case → 拒', async () => {
    const { svc } = makeSvc(openClientCase);
    await expect(svc.createDraft({
      caseNo: 'CASE_GATE', lineItemId: 'LI_1', reasonCode: 'BANK_INTEREST',
      direction: 'INCREASE', amount: '1000', effectiveDate: '2026-08-28',
      reasonInternal: '银行利息', reasonCustomer: '银行利息', relatedOrderNo: 'X',
    } as any, OP)).rejects.toThrow(BadRequestException);
  });

  it('闸一·防绕过：落库的 book 来自 case，请求里塞 book 也带不进去', async () => {
    const { svc, create } = makeSvc(openClientCase);
    await svc.createDraft({
      caseNo: 'CASE_GATE', lineItemId: 'LI_1', reasonCode: 'DEPOSIT_DUPLICATE_REVERSAL',
      direction: 'REDUCE', amount: '1000', effectiveDate: '2026-08-28',
      reasonInternal: '同一笔充值入账两次', reasonCustomer: '重复入账撤销',
      book: 'FIRM',
    } as any, OP);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ book: 'CLIENT' }),
    }));
  });

  // ④ 解释锚：这张单在解释哪一条差异，锚在真实证据 id 上（内部流水 / 外部对账单行），
  // 不锚 ReconciliationLineItem.id（每轮对账 delete-then-insert，锚上去就悬空）。
  // 落库必须带上，否则下一轮对账摘不掉这条差异，案子平不下来。
  it('从差异行开单：两个解释锚原样落库', async () => {
    const { svc, create } = makeSvc(openClientCase);
    await svc.createDraft({
      caseNo: 'CASE_GATE', reasonCode: 'DEPOSIT_DUPLICATE_REVERSAL',
      direction: 'REDUCE', amount: '1000', effectiveDate: '2026-08-28',
      reasonInternal: '同一笔充值入账两次', reasonCustomer: '重复入账撤销',
      explainedFlowId: 'FLOW_9', explainedExternalLineId: 'EXTLINE_9',
    } as any, OP);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ explainedFlowId: 'FLOW_9', explainedExternalLineId: 'EXTLINE_9' }),
    }));
  });

  // 案件级入口开单（纯余额差、案子上没有差异行可指）：两个锚都空，照常建单。
  it('不带解释锚（案件级入口）：createDraft 照常建单，两个锚落 null', async () => {
    const { svc, create } = makeSvc(openClientCase);
    await svc.createDraft({
      caseNo: 'CASE_GATE', reasonCode: 'DEPOSIT_DUPLICATE_REVERSAL',
      direction: 'REDUCE', amount: '1000', effectiveDate: '2026-08-28',
      reasonInternal: '同一笔充值入账两次', reasonCustomer: '重复入账撤销',
    } as any, OP);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ explainedFlowId: null, explainedExternalLineId: null }),
    }));
  });

  // ① 生效日守卫：晚于案件业务日 = 重跑该业务日的对账取不到这笔分录，差额永远
  // 归不了零。前端默认值已改成案件业务日，这条锁后端兜底。
  it('生效日晚于案件业务日 → 400，不建单', async () => {
    const { svc, create } = makeSvc(openClientCase);   // openClientCase.businessDate = '2026-08-28'
    await expect(svc.createDraft({
      caseNo: 'CASE_GATE', reasonCode: 'DEPOSIT_DUPLICATE_REVERSAL',
      direction: 'REDUCE', amount: '1000', effectiveDate: '2026-08-29',
      reasonInternal: '同一笔充值入账两次', reasonCustomer: '重复入账撤销',
    } as any, OP)).rejects.toThrow(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('生效日等于案件业务日（正常口径）与早于案件业务日 → 都放行', async () => {
    for (const effectiveDate of ['2026-08-28', '2026-08-01']) {
      const { svc, create } = makeSvc(openClientCase);
      await svc.createDraft({
        caseNo: 'CASE_GATE', reasonCode: 'DEPOSIT_DUPLICATE_REVERSAL',
        direction: 'REDUCE', amount: '1000', effectiveDate,
        reasonInternal: '同一笔充值入账两次', reasonCustomer: '重复入账撤销',
      } as any, OP);
      expect(create).toHaveBeenCalled();
    }
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
    const svc = new AdjustmentService(prisma, null as any, null as any, null as any, null as any);
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
    const svc = new AdjustmentService(prisma, null as any, null as any, null as any, null as any);
    await expect(svc.onRejected('ADJ_R2', 'U_OPS_7')).rejects.toThrow(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('AdjustmentService.onApproved 落账', () => {
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
    const update = jest.fn();
    const accounting = { executeTransfer, resolveTbAccountId: jest.fn() };
    await expect(
      makeSvc({ ...clientRow, status: 'POSTED' }, accounting, update).onApproved('ADJ2608280001', 'U_OPS'),
    ).rejects.toThrow(BadRequestException);
    expect(executeTransfer).not.toHaveBeenCalled();
    // 对称补上（评审 Minor 5）：与 onRejected 的终态测试一样，闸门拒绝时不该碰任何一次写库。
    expect(update).not.toHaveBeenCalled();
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

  // 评审 Minor 4：四组合此前只端到端断言过 CLIENT/REDUCE + FIRM/INCREASE 两种，
  // 剩下两种（镜像方向）在接线层完全没测过。补齐后四组合两两科目对都不同
  // （注意 CLIENT 两条码集合相同、顺序相反——toEqual 对数组顺序敏感，
  // 硬编码答案没法同时通过这两条）。
  it('分录接线覆盖·CLIENT/INCREASE：走「借客户托管 / 贷客户应付」（提现撤销退回场景）', async () => {
    const resolveTbAccountId = jest.fn().mockResolvedValue(1n);
    const accounting = { executeTransfer: jest.fn().mockResolvedValue({ tbTransferId: 1n }), resolveTbAccountId };
    const row = { ...clientRow, direction: 'INCREASE', reasonCode: 'WITHDRAW_VOID_REFUND' };
    await makeSvc(row, accounting).onApproved('ADJ2608280001', 'U_OPS');
    const codes = resolveTbAccountId.mock.calls.map((c: any[]) => c[0].code);
    expect(codes).toEqual([TB_ACCOUNT_CODES.CLIENT_ASSET, TB_ACCOUNT_CODES.CLIENT_PAYABLE]);
  });

  it('分录接线覆盖·FIRM/REDUCE：走「借公司运营 / 贷公司资产」（演示破口场景5：银行杂费）', async () => {
    const resolveTbAccountId = jest.fn().mockResolvedValue(1n);
    const accounting = { executeTransfer: jest.fn().mockResolvedValue({ tbTransferId: 1n }), resolveTbAccountId };
    const row = {
      ...clientRow, book: 'FIRM', direction: 'REDUCE', reasonCode: 'BANK_CHARGE',
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
  describe('审计信封契约一致性（评审 Critical 回归锁）', () => {
    const captureEnvelope = async (row: any) => {
      const recordByActor = jest.fn();
      const accounting = { executeTransfer: jest.fn().mockResolvedValue({ tbTransferId: 1n }), resolveTbAccountId: jest.fn().mockResolvedValue(1n) };
      await makeSvc(row, accounting, jest.fn(), recordByActor).onApproved('ADJ2608280001', 'U_OPS');
      expect(recordByActor).toHaveBeenCalledTimes(1);
      return recordByActor.mock.calls[0][0];
    };

    it('a) 信封顶层字段覆盖合同表 RECON_ADJUSTMENT_POSTED.requiredFields 里的每一项', async () => {
      const envelope = await captureEnvelope(clientRow);
      const required = V8_RECON_AUDIT_ACTIONS.RECON_ADJUSTMENT_POSTED.requiredFields;
      // 合同表本身别被改空——空数组会让下面的循环啥都不测，等于测试形同虚设。
      expect(required.length).toBeGreaterThan(0);
      for (const field of required) {
        expect(envelope[field as keyof typeof envelope]).not.toBeUndefined();
        expect(envelope[field as keyof typeof envelope]).not.toBeNull();
      }
    });

    it('b) 真实 AuditLogsService.assertActionSpec 验捕获到的信封——不抛（不依赖真库：assertActionSpec 是纯校验，不碰 prisma）', async () => {
      const envelope = await captureEnvelope(clientRow);
      const realAuditLogs = new AuditLogsService(null as any);
      expect(() => (realAuditLogs as any).assertActionSpec(envelope)).not.toThrow();
    });

    it('correlationId 回落：case 没有 traceId 时不拒写（INHERIT 码空 correlationId 会被真校验拒绝），回落值与 evidence 那侧（:181 已有的 row.traceId||row.adjustmentNo）对齐', async () => {
      const envelope = await captureEnvelope({ ...clientRow, traceId: null });
      expect(envelope.correlationId).toBe('ADJ2608280001');

      const realAuditLogs = new AuditLogsService(null as any);
      expect(() => (realAuditLogs as any).assertActionSpec(envelope)).not.toThrow();
    });

    it('subjects 里案件用词表登记名 RECONCILIATION_CASE，不用未登记的自造词 RECON_CASE（按案件查这笔调账靠它，同模块开案审计 wallet-recon-run.service.ts 用的就是这个词）', async () => {
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
describe('AdjustmentService.getAdjustment —— 详情读模型（Task 7）', () => {
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
    reasonCode: 'DEPOSIT_DUPLICATE_REVERSAL', assetCode: 'AED', amount: '1500',
    effectiveDate: '2026-08-15', reasonInternal: '同一笔充值入账两次', reasonCustomer: '重复入账撤销',
    status: 'DRAFT', approvalCaseId: null, approvalNo: null, ownerNo: 'C0042', ownerId: 'uuid-cust',
    traceId: null, createdByUserId: 'U_OP', decidedByUserId: null, postedAt: null, tbTransferId: null,
  };

  it('返回体不含任何 UUID（铁律⑥）：id/ownerId/approvalCaseId/两个解释锚/walletRef 被剔除，业务号 adjustmentNo 保留', async () => {
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

  it('decimals 取自资产表；查不到资产行时兜底 0（不抛，与 getCase 同款兜底）', async () => {
    const svcHit = makeSvc(baseRow, { decimals: 2 });
    expect((await svcHit.getAdjustment('ADJ2608280002') as any).decimals).toBe(2);

    const svcMiss = makeSvc(baseRow, null);
    expect((await svcMiss.getAdjustment('ADJ2608280002') as any).decimals).toBe(0);
  });

  it('客户账簿减钱（DEPOSIT_DUPLICATE_REVERSAL/REDUCE）：分录预览是「借 L.CLIENT_PAYABLE / 贷 A.CLIENT_ASSET」', async () => {
    const svc = makeSvc(baseRow);
    const result: any = await svc.getAdjustment('ADJ2608280002');
    expect(result.debitAccountCode).toBe('L.CLIENT_PAYABLE');
    expect(result.creditAccountCode).toBe('A.CLIENT_ASSET');
  });

  it('公司账簿加钱（BANK_INTEREST/INCREASE）：分录预览是「借 A.FIRM_ASSET / 贷 E.INCOME_OTHER」——与 onApproved 分录接线测试的科目对呼应，不能两处各说各话', async () => {
    const firmRow = { ...baseRow, book: 'FIRM', direction: 'INCREASE', reasonCode: 'BANK_INTEREST', ownerNo: null, ownerId: null };
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
describe('createDraft 第四族（改记，spec §6）+ 定性联动 + DRAFTED 审计', () => {
  // 与"两道闸" describe 的 OP 同一惯例：userId/userNo 同值，createdByUserId 落业务号。
  const ACTOR = { actorType: 'ADMIN' as const, userId: 'U_OP', userNo: 'U_OP', roleCodes: ['ADMIN'] };

  it('改记：两案同业务日校验、正主方必填原单、direction 落 REATTRIBUTE、toWalletRef/toOwnerNo 落库', async () => {
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
    expect(dispositionMock.linkAdjustment).toHaveBeenCalledWith('RCD001', r.adjustmentNo);
  });

  it('改记两案业务日不同 → 400（本轮不做跨日改记）', async () => {
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
    } as any, ACTOR)).rejects.toThrow(/业务日/);
  });

  it('改记缺 toCaseNo / 缺 relatedOrderNo → 各 400', async () => {
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

    // 断言一：不传 toCaseNo——正主方是谁都不知道，压根不该建单。
    await expect(makeService().createDraft({
      caseNo: 'REC-FROM',
      reasonCode: 'CUSTOMER_REATTRIBUTION', direction: 'REDUCE',
      amount: '1000', effectiveDate: '2026-09-01',
      reasonInternal: 'x', reasonCustomer: 'y',
    } as any, ACTOR)).rejects.toThrow(/toCaseNo|正主方案件号/);

    // 断言二：toCaseNo 给了，但没给 relatedOrderNo——正主方是"加钱"，没原单等于凭空加钱。
    await expect(makeService().createDraft({
      caseNo: 'REC-FROM', toCaseNo: 'REC-TO',
      reasonCode: 'CUSTOMER_REATTRIBUTION', direction: 'REDUCE',
      amount: '1000', effectiveDate: '2026-09-01',
      reasonInternal: 'x', reasonCustomer: 'y',
    } as any, ACTOR)).rejects.toThrow(/原单/);
  });

  // afterDraftCreated 是四族通用的收尾——用既有三族里最简单的一条路径（客户账簿
  // 减钱、不触发原单守卫）验证它接上了，不必借第四族才能测到这条通用行为。
  it('每次 createDraft（四族通用）记 RECON_ADJUSTMENT_DRAFTED，requestId 显式', async () => {
    const openCase = {
      caseNo: 'CASE_DRAFTED_1', status: 'OPEN', book: 'CLIENT',
      walletRef: 'W_DRAFTED', assetCode: 'AED', ownerNo: 'C0042', traceId: null,
      businessDate: '2026-08-28',
    };
    const recordByActor = jest.fn();
    // afterDraftCreated 读的是 create() 落库后拿回的 row，不是 dto——
    // mock 只需给出审计信封会用到的那几列。
    const createdRow = {
      adjustmentNo: 'ADJ2608280099', reasonCode: 'DEPOSIT_DUPLICATE_REVERSAL', amount: '1000',
      ownerNo: 'C0042', caseNo: 'CASE_DRAFTED_1', direction: 'REDUCE', book: 'CLIENT',
      reasonInternal: '同一笔充值入账两次',
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
      caseNo: 'CASE_DRAFTED_1', reasonCode: 'DEPOSIT_DUPLICATE_REVERSAL',
      direction: 'REDUCE', amount: '1000', effectiveDate: '2026-08-28',
      reasonInternal: '同一笔充值入账两次', reasonCustomer: '重复入账撤销',
    } as any, ACTOR);

    expect(recordByActor).toHaveBeenCalledTimes(1);
    const envelope = recordByActor.mock.calls[0][0];
    expect(envelope.action).toBe('RECON_ADJUSTMENT_DRAFTED');
    // requiredFields 顶层——assertActionSpec 读的是信封顶层字段，不是 metadata。
    expect(envelope.reasonCode).toBe('DEPOSIT_DUPLICATE_REVERSAL');
    expect(envelope.amount).toBe('1000');
    // 漏了显式 requestId 会被静默去重、审计直接消失（本仓踩过）。
    expect(envelope.requestId).toMatch(/^RECON_ADJUSTMENT_DRAFTED_ADJ/);
  });
});

// 平账一期半 T6：第四族落账（改记）。这是本批唯一真动账本的一段，
// 会计正确性是核心——四条断言各自锁住一处「mock 下会全绿、真环境里会炸/会算错」
// 的坑（ledger 取 currency、CLIENT_PAYABLE 的 ownerType、evidence.assetCurrency、
// 两腿钱包各落各的）。
describe('AdjustmentService.onApproved 第四族落账（改记，spec §6）', () => {
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
    caseNo: 'RC26090100001', reasonInternal: '记错客户', traceId: 'T-REATTR',
    relatedOrderNo: 'DP2609010001',
  };

  it('借 from 应付 / 贷 to 应付：两腿同科目 CLIENT_PAYABLE、ownerType 都是 CUSTOMER、ownerUuid 各自的；客户资产腿一次都不出现', async () => {
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

  it('evidence 两腿各落各的钱包（错记方降/正主方升），isExternalCrossing=false，生效日随单', async () => {
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

  it('加密币改记：ledger 与 evidence.assetCurrency 都按 asset.currency 取（USDT-TRON → USDT），不是 assetCode', async () => {
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

  it('落账后置 POSTED、记下 tbTransferId，裁决人落业务号（铁律⑥）', async () => {
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

  it('已 POSTED 的改记单再落一次被状态机拒绝（铁律④），且不碰账本、不写库', async () => {
    const executeTransfer = jest.fn();
    const update = jest.fn();
    const accounting = { executeTransfer, resolveTbAccountId: jest.fn() };
    await expect(
      makeSvc({ ...reattrRow, status: 'POSTED' }, accounting, update).onApproved('ADJ2609010001', 'U_OPS'),
    ).rejects.toThrow(BadRequestException);
    expect(executeTransfer).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('正主方客户解析不到 → 抛 NotFoundException，账本一动不动（宁可不落账，也不能把负债贷给一个解析不出的户）', async () => {
    const executeTransfer = jest.fn();
    const accounting = { executeTransfer, resolveTbAccountId: jest.fn().mockResolvedValue(1n) };
    await expect(
      makeSvc({ ...reattrRow, toOwnerNo: 'CU-NOBODY' }, accounting).onApproved('ADJ2609010001', 'U_OPS'),
    ).rejects.toThrow(NotFoundException);
    expect(executeTransfer).not.toHaveBeenCalled();
  });

  it('审计信封与主路径同构：RECON_ADJUSTMENT_POSTED、requiredFields 在顶层、requestId 显式、真实 assertActionSpec 不拒写；metadata 多带正主方线索', async () => {
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
  it('两侧客户都进 subjects：错记方与正主方各一条 CUSTOMER/OWNER（按正主方客户号也要查得到这笔改记）', async () => {
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

describe('AdjustmentService.describeImpact 第四族 —— 审批人要看见钱从谁名下去了谁名下', () => {
  const svc = new AdjustmentService(null as any, null as any, null as any, null as any, null as any);

  it('输出「从 A 名下改记到 B 名下；客户资产总额不变」', () => {
    const text = svc.describeImpact({
      book: 'CLIENT', ownerNo: 'CU-FROM', amount: '730000', assetCode: 'AED',
      direction: 'REATTRIBUTE', reasonCode: 'CUSTOMER_REATTRIBUTION',
      reasonInternal: '记错客户', toOwnerNo: 'CU-TO',
    } as any, 2);
    expect(text).toContain('CU-FROM');
    expect(text).toContain('CU-TO');
    expect(text).toContain('7300.00');
    // 托管里的钱没动 —— 这句是审批人判断「该不该批」的关键事实。
    expect(text).toContain('客户资产总额不变');
    // 三族的「余额增加/减少」话术套在改记上是错的：钱没增没减，只是换了主人。
    expect(text).not.toContain('余额增加');
    expect(text).not.toContain('余额减少');
  });
});

// 顺手收口（前序评审）：Task 5 让 toWalletRef 真正落库之后，详情接口的解构
// 排除清单只剔了 walletRef —— 改记单一被查询就把正主方钱包的内部 UUID 吐出去，
// 踩铁律⑥「管理台不暴露 UUID」。
describe('AdjustmentService.getAdjustment 第四族 —— 正主方钱包也只给业务号', () => {
  const reattrRow = {
    id: 'uuid-row', adjustmentNo: 'ADJ2609010002', caseNo: 'RC26090100001',
    explainedFlowId: 'flow-from', explainedExternalLineId: 'ext-to',
    walletRef: 'wallet-from', toWalletRef: 'wallet-to', toOwnerNo: 'CU-TO',
    book: 'CLIENT', direction: 'REATTRIBUTE', reasonCode: 'CUSTOMER_REATTRIBUTION',
    assetCode: 'AED', amount: '730000', effectiveDate: '2026-09-01',
    reasonInternal: '记错客户', reasonCustomer: '账户更正划转',
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

  it('toWalletRef 不出现在返回体里，换成业务号 toWalletNo；正主方客户号照常给', async () => {
    const result: any = await makeSvc().getAdjustment('ADJ2609010002');
    expect(result.toWalletRef).toBeUndefined();
    expect(result.walletRef).toBeUndefined();
    expect(result.toWalletNo).toBe('WAL-TO');
    expect(result.walletNo).toBe('WAL-FROM');
    expect(result.toOwnerNo).toBe('CU-TO');
  });

  it('分录预览走第五种组合：借/贷都是 L.CLIENT_PAYABLE——不能落回 (book,direction) 四组合（那会显示成「借客户托管」，与真实落账相反）', async () => {
    const result: any = await makeSvc().getAdjustment('ADJ2609010002');
    expect(result.debitAccountCode).toBe('L.CLIENT_PAYABLE');
    expect(result.creditAccountCode).toBe('L.CLIENT_PAYABLE');
  });
});
