import { PrismaClient } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
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
    return { svc: new AdjustmentService(prisma, null as any, null as any, null as any), create, prisma };
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
    return new AdjustmentService(prisma, null as any, accounting, { recordByActor } as any);
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
    return new AdjustmentService(prisma, null as any, null as any, null as any);
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
