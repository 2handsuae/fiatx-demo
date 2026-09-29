// 战役乙波二 T5：付款单 workflow 行为测试（照 capital-injection-workflow.service.spec.ts +
// lp-exchange-workflow.service.spec.ts 两份模板拼接：单腿状态机走 T3 节奏，腿事件走 LP 卖出
// 腿 84 节奏）。`payments` 用真实 VendorPaymentService（非桩，喂真实 OutsourcingVendorsService）
// ——评审交接第 2 条：T4 spec 的 fundsOrder mock 恒返 []，`where: { vendorPaymentId }` 误写成
// `capitalInjectionId` 现在测不出来；本文件用一份行为化内存 prisma 让 getView() 的
// where 真过滤 vendorPaymentId，走了错字段会看到 legs 为空、断言失败。
import { randomUUID } from 'node:crypto';
import { VendorPaymentWorkflowService } from './vendor-payment-workflow.service';
import { VendorPaymentService } from './vendor-payment.service';
import { VendorPaymentStatus as S } from './dto/vendor-payment.dto';
import { OutsourcingVendorsService } from '../../governance/compliance-office/outsourcing-vendors.service';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';

const AED = { id: 'asset-aed', code: 'AED', currency: 'AED', decimals: 2, type: 'FIAT' };
const treasury = { actorType: 'ADMIN' as const, userId: 'uuid-tre', userNo: 'ADM-TRE', roleCodes: ['TREASURY_OFFICER'] };
const OPS_WALLET = { id: 'w-ops-aed', walletNo: 'WAL-OPS-AED', address: null, iban: 'AE-OPS-AED' };
const activeVendor = { id: 'vendor-1', vendorNo: 'VEN2609290001', name: 'HexTrust Custody Ltd', status: 'ACTIVE' };

// 修复轮同款：resolveTbAccountId 的 mock 按 (code, ledger) 编码出不同的账户 id——若实现把
// ledger 传错，断言里期望的账户 id 会对不上，能真的抓到跨 ledger 错误。
const acct = (code: number, ledger: number): bigint => BigInt(code) * 100n + BigInt(ledger);

const baseInput = {
  vendorNo: activeVendor.vendorNo, payeeAccountRef: 'HexTrust ops account — IBAN AE070000000123456789',
  assetId: AED.id, amount: '12000',
  purposeNote: 'HexTrust 2026-09 月费', prudentialPurpose: 'Discharge outsourced custody service fee obligation',
  reason: 'Monthly vendor invoice settlement',
};

/** 行为化内存 prisma（照 capital-injection-workflow.service.spec.ts 的 makePrisma 先例，
 *  扩展 outsourcingVendor 供真实 OutsourcingVendorsService 用；fundsOrder.findMany 真过滤
 *  vendorPaymentId，让 VendorPaymentService.getView() 的腿投影跑真代码）。 */
function makePrisma() {
  const payRows = new Map<string, any>();
  const fundsOrderRows = new Map<string, any>();
  let clock = Date.parse('2026-09-29T00:00:00.000Z');
  const tick = () => new Date((clock += 1000));
  const assetsById: Record<string, any> = { [AED.id]: AED };
  const walletsById: Record<string, any> = { [OPS_WALLET.id]: OPS_WALLET };
  const vendorRows: Record<string, any> = { [activeVendor.vendorNo]: activeVendor };

  return {
    asset: { findUnique: jest.fn(async ({ where }: any) => assetsById[where.id] ?? null) },
    wallet: { findUnique: jest.fn(async ({ where }: any) => walletsById[where.id] ?? null) },
    outsourcingVendor: { findUnique: jest.fn(async ({ where }: any) => vendorRows[where.vendorNo] ?? null) },
    vendorPayment: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: randomUUID(), approvalNo: null, failureReasonCode: null, failureNote: null, executedAt: null, settledAt: null, createdAt: tick(), updatedAt: tick(), ...data };
        payRows.set(row.payNo, row);
        return { ...row, asset: assetsById[row.assetId] };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = where.payNo ? payRows.get(where.payNo) : [...payRows.values()].find((r) => r.id === where.id);
        if (!existing) throw new Error(`no such row: ${JSON.stringify(where)}`);
        const updated = { ...existing, ...data, updatedAt: tick() };
        payRows.set(updated.payNo, updated);
        return { ...updated, asset: assetsById[updated.assetId] };
      }),
      // handleFundsOrderChanged 按事件带的内部 id 读（横向读放行，同 LpExchangeWorkflowService
      // 先例）；VendorPaymentService.findByNo 按业务号读——两种 where 都要支持。
      findUnique: jest.fn(async ({ where }: any) => {
        const row = where.payNo ? payRows.get(where.payNo) : [...payRows.values()].find((r) => r.id === where.id);
        return row ? { ...row, asset: assetsById[row.assetId] } : null;
      }),
      findMany: jest.fn(async () => [...payRows.values()].map((r) => ({ ...r, asset: assetsById[r.assetId] }))),
      count: jest.fn(async () => payRows.size),
    },
    // 供 VendorPaymentService.getView() 直读（真代码路径，不经 FundsOrderService）——评审
    // 交接第 2 条：where 真过滤 vendorPaymentId。
    fundsOrder: {
      findMany: jest.fn(async ({ where }: any) => {
        return [...fundsOrderRows.values()]
          .filter((r) => r.vendorPaymentId === where.vendorPaymentId)
          .sort((a, b) => a.legSeq - b.legSeq || a.attempt - b.attempt)
          .map((r) => ({
            ...r,
            fromWallet: r.fromWalletId ? walletsById[r.fromWalletId] : null,
            toWallet: r.toWalletId ? walletsById[r.toWalletId] : null,
            asset: { type: assetsById[r.assetId]?.type },
          }));
      }),
    },
    __fundsOrderRows: fundsOrderRows, // 测试内部句柄，供 fundsOrders 桩写入
  };
}

function makeAccounting(creditsPosted: bigint, debitsPosted: bigint, debitsPending = 0n) {
  return {
    resolveTbAccountId: jest.fn(async ({ code, ledger }: any) => acct(code, ledger)),
    lookupBalance: jest.fn(async () => ({ creditsPosted, debitsPosted, debitsPending, creditsPending: 0n })),
    executeTransfer: jest.fn(async () => ({ tbTransferId: 1n })),
  };
}

function makeWorkflow() {
  const prisma: any = makePrisma();
  const vendors = new OutsourcingVendorsService(prisma as any, {} as any);
  // 余额充裕（100_000 AED 级），assertFirmOpsBalance 天然放行；不足场景用 jest.spyOn 单次拒绝。
  const accounting: any = makeAccounting(100_000_000_000n, 0n);
  const payments = new VendorPaymentService(prisma, vendors, accounting);
  const approvals: any = { createAndSubmit: jest.fn(async () => ({ approvalNo: 'APR1' })), cancel: jest.fn(async () => ({})) };
  const auditLogs: any = { recordByActor: jest.fn(async () => ({})), recordSystem: jest.fn(async () => ({})) };
  // fundsOrders 桩：create/findById 直写/直读同一份 prisma.fundsOrder 内存表，让
  // payments.getView() 之后能查到真腿（评审交接第 2 条）。
  const fundsOrders: any = {
    create: jest.fn(async (input: any) => {
      const id = `fo-${input.legSeq}`;
      const row = {
        id, fundsOrderNo: `FDO${input.legSeq}`, legSeq: input.legSeq, attempt: 1,
        status: input.initialStatus, amount: input.amount, netAmount: input.netAmount,
        assetId: input.assetId, vendorPaymentId: input.vendorPaymentId,
        fromWalletId: input.fromWalletId, fromAddress: input.fromAddress, fromIban: input.fromIban,
        toWalletId: input.toWalletId, toAddress: input.toAddress, toIban: input.toIban,
        txHash: null, referenceNo: null, createdAt: new Date(),
      };
      prisma.__fundsOrderRows.set(id, row);
      return row;
    }),
    findById: jest.fn(async (id: string) => prisma.__fundsOrderRows.get(id) ?? null),
    advance: jest.fn(async () => ({})),
    stampExternalRef: jest.fn(async () => null),
    resolveExternalRef: jest.fn((row: any) => (row.asset?.type === 'CRYPTO' ? row.txHash ?? null : row.referenceNo ?? null)),
  };
  const systemWallets: any = { resolve: jest.fn(async () => OPS_WALLET) };
  const custodianStatement: any = { recordLegMovement: jest.fn(async () => ({ outLineId: 'l1', inLineId: null, cutoffDate: '2026-09-29' })) };
  const wf = new VendorPaymentWorkflowService(prisma, payments, approvals, accounting, auditLogs, fundsOrders, systemWallets, custodianStatement);
  return { wf, payments, prisma, vendors, approvals, accounting, auditLogs, fundsOrders, systemWallets, custodianStatement };
}

const decided = (decision: any, payNo: string) => ({ decision, actionType: 'VENDOR_PAYMENT_APPROVAL', entityRef: payNo, approvalId: 'uuid-apr', approvalNo: 'APR1', traceId: 'trace-1', workflowType: 'VENDOR_PAYMENT', metadata: {} });

describe('VendorPaymentWorkflowService (Task 5)', () => {
  describe('initiate — birth guards + happy path', () => {
    it('operating account balance is not enough → 400 (guard comes from the entity)', async () => {
      const { wf, payments } = makeWorkflow();
      jest.spyOn(payments, 'assertFirmOpsBalance').mockRejectedValueOnce(new Error('Insufficient AED balance in the operating account'));
      await expect(wf.initiate(baseInput, treasury)).rejects.toThrow(/Insufficient/);
    });

    it('resolves the F_OPS wallet, creates the row, submits CFO approval, audit REQUESTED, snapshot has zero UUIDs, subjects mirror the vendor', async () => {
      const { wf, payments, approvals, auditLogs, systemWallets } = makeWorkflow();
      const r = await wf.initiate(baseInput, treasury);
      expect(r.status).toBe(S.PENDING_APPROVAL);
      expect(r.approvalNo).toBe('APR1');
      expect(systemWallets.resolve).toHaveBeenCalledWith(AED.id, 'F_OPS');
      const created = await payments.findByNo(r.payNo);
      expect(created.fromWalletId).toBe('w-ops-aed');
      expect(created.createdByUserId).toBe('ADM-TRE'); // T4 交接第 1 条：actor.userNo ?? actor.userId
      const snapshot = approvals.createAndSubmit.mock.calls[0][0];
      expect(snapshot.actionType).toBe('VENDOR_PAYMENT_APPROVAL');
      expect(snapshot.entityRef).toBe(r.payNo);
      expect(JSON.stringify(snapshot.objectSnapshot)).not.toMatch(/uuid-|w-ops/);
      expect(snapshot.objectSnapshot.amount).toBe('12000.00 AED');
      expect(snapshot.objectSnapshot.vendorName).toBe(activeVendor.name);
      const audit = auditLogs.recordByActor.mock.calls[0][0];
      expect(audit).toMatchObject({ action: 'VENDOR_PAYMENT_REQUESTED', actionDomain: 'TREASURY', primarySubjectNo: r.payNo, amount: '12000.00', approvalNo: 'APR1', reason: baseInput.reason });
      expect(audit.requestId).toMatch(new RegExp(`^VENDOR_PAYMENT_REQUESTED_${r.payNo}_`));
      expect(audit.correlationId).toBeUndefined(); // REQUESTED 起旅程，不显式传 correlationId
      expect(audit.subjects).toEqual(expect.arrayContaining([
        expect.objectContaining({ subjectType: 'VENDOR_PAYMENT', subjectNo: r.payNo, subjectRole: 'PRIMARY' }),
        expect.objectContaining({ subjectType: 'OUTSOURCING_VENDOR', subjectNo: activeVendor.vendorNo, subjectRole: 'RELATED' }),
      ]));
    });
  });

  describe('onDecided', () => {
    async function seedPending(ctx: ReturnType<typeof makeWorkflow>) {
      const r = await ctx.wf.initiate(baseInput, treasury);
      return r.payNo;
    }

    it('declined → REJECTED + audit carries fromStatus/toStatus + approval causation + explicit requestId', async () => {
      const ctx = makeWorkflow();
      const payNo = await seedPending(ctx);
      await ctx.wf.onDecided(decided('DECLINED', payNo) as any);
      const row = await ctx.payments.findByNo(payNo);
      expect(row.status).toBe(S.REJECTED);
      const audit = ctx.auditLogs.recordSystem.mock.calls[0][0];
      expect(audit).toMatchObject({ action: 'VENDOR_PAYMENT_REJECTED', approvalNo: 'APR1', causationId: 'uuid-apr', fromStatus: 'PENDING_APPROVAL', toStatus: 'REJECTED' });
      expect(audit.requestId).toMatch(new RegExp(`^VENDOR_PAYMENT_REJECTED_${payNo}_`));
    });

    it('a cancellation decision is not handled here (cancel() closes its own loop)', async () => {
      const ctx = makeWorkflow();
      const payNo = await seedPending(ctx);
      ctx.auditLogs.recordSystem.mockClear();
      await ctx.wf.onDecided(decided('CANCELLED', payNo) as any);
      const row = await ctx.payments.findByNo(payNo);
      expect(row.status).toBe(S.PENDING_APPROVAL); // 未被 onDecided 动过
      expect(ctx.auditLogs.recordSystem).not.toHaveBeenCalled();
    });

    it('approved but operating account balance is not enough → FAILED(INSUFFICIENT_FIRM_BALANCE), zero funds orders, audit carries reasonCode + explicit requestId', async () => {
      const ctx = makeWorkflow();
      const payNo = await seedPending(ctx);
      jest.spyOn(ctx.payments, 'assertFirmOpsBalance').mockRejectedValueOnce(new Error('Insufficient AED balance in the operating account'));
      await ctx.wf.onDecided(decided('APPROVED', payNo) as any);
      const row = await ctx.payments.findByNo(payNo);
      expect(row.status).toBe(S.FAILED);
      expect(row.failureReasonCode).toBe('INSUFFICIENT_FIRM_BALANCE');
      expect(ctx.fundsOrders.create).not.toHaveBeenCalled();
      const audit = ctx.auditLogs.recordSystem.mock.calls[0][0];
      expect(audit).toMatchObject({ action: 'VENDOR_PAYMENT_FAILED', outcome: 'FAILED', reasonCode: 'INSUFFICIENT_FIRM_BALANCE', approvalNo: 'APR1', causationId: 'uuid-apr', fromStatus: 'PENDING_APPROVAL', toStatus: 'FAILED' });
      expect(audit.requestId).toMatch(new RegExp(`^VENDOR_PAYMENT_FAILED_${payNo}_`));
    });

    it('approved → creates leg 1 (F_OPS → payee, CREATED, to=null/toIban=payeeAccountRef) → EXECUTING + audit EXECUTION_STARTED carries fromStatus/toStatus + approvalNo+causationId + explicit requestId', async () => {
      const ctx = makeWorkflow();
      const payNo = await seedPending(ctx);
      await ctx.wf.onDecided(decided('APPROVED', payNo) as any);
      const row = await ctx.payments.findByNo(payNo);
      expect(ctx.fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({
        vendorPaymentId: row.id, legSeq: 1, initialStatus: 'CREATED', assetId: AED.id, amount: '12000',
        fromWalletId: 'w-ops-aed', toWalletId: null, toAddress: null, toIban: baseInput.payeeAccountRef,
      }));
      expect(row.status).toBe(S.EXECUTING);
      expect(row.executedAt).toBeInstanceOf(Date);
      const audit = ctx.auditLogs.recordSystem.mock.calls[0][0];
      expect(audit).toMatchObject({ action: 'VENDOR_PAYMENT_EXECUTION_STARTED', approvalNo: 'APR1', causationId: 'uuid-apr', fromStatus: 'PENDING_APPROVAL', toStatus: 'EXECUTING' });
      expect(audit.requestId).toMatch(new RegExp(`^VENDOR_PAYMENT_EXECUTION_STARTED_${payNo}_`));

      // 评审交接第 2 条：腿产生后穿过 getView() 真实腿投影（where 真过滤 vendorPaymentId，
      // 不像 T4 spec 的 mock 那样恒返 []）。
      const view = await ctx.payments.getView(payNo);
      expect(view.legs).toHaveLength(1);
      expect(view.legs[0]).toMatchObject({ fundsOrderNo: 'FDO1', legSeq: 1, status: 'CREATED', fromWalletNo: 'WAL-OPS-AED', toWalletNo: null, externalRef: null });
    });
  });

  describe('handleFundsOrderChanged — payment leg 1', () => {
    async function seedExecuting(ctx: ReturnType<typeof makeWorkflow>) {
      const r = await ctx.wf.initiate(baseInput, treasury);
      await ctx.wf.onDecided(decided('APPROVED', r.payNo) as any);
      const row = await ctx.payments.findByNo(r.payNo);
      return { payNo: r.payNo, vendorPaymentId: row.id };
    }
    const evt = (vendorPaymentId: string, newStatus: string) => ({ fundsOrderId: 'fo-1', fundsOrderNo: 'FDO1', parent: { vendorPaymentId }, legSeq: 1, attempt: 1, oldStatus: null, newStatus });

    it('an event that is not for a vendor payment leg is ignored outright', async () => {
      const ctx = makeWorkflow();
      await ctx.wf.handleFundsOrderChanged({ ...evt('anything', 'SUBMITTED'), parent: { internalTransferId: 'x' } } as any);
      expect(ctx.custodianStatement.recordLegMovement).not.toHaveBeenCalled();
    });

    it('SUBMITTED: mints the reference (fiat referenceNo), then writes one custodian line (toWalletId null — payee external coordinate is not our wallet)', async () => {
      const ctx = makeWorkflow();
      const { vendorPaymentId } = await seedExecuting(ctx);
      ctx.fundsOrders.stampExternalRef.mockResolvedValueOnce({ referenceNo: 'BANK-REF-1' });
      await ctx.wf.handleFundsOrderChanged(evt(vendorPaymentId, 'SUBMITTED') as any);
      expect(ctx.fundsOrders.stampExternalRef).toHaveBeenCalledWith('fo-1');
      expect(ctx.custodianStatement.recordLegMovement).toHaveBeenCalledWith(expect.objectContaining({
        fundsOrderNo: 'FDO1', fromWalletId: 'w-ops-aed', toWalletId: null, assetCode: 'AED', assetType: 'FIAT', amountMinor: 1_200_000n,
      }));
    });

    it('CONFIRMED: posts 87 (DR E.FIRM_OPS / CR A.FIRM_ASSET, external-crossing) BEFORE recording — actually records custodian line first (回单先于落账) — then CLEARs → SUCCESS + audit EXECUTED carries fromStatus/toStatus + explicit requestId', async () => {
      const ctx = makeWorkflow();
      const { payNo, vendorPaymentId } = await seedExecuting(ctx);
      await ctx.wf.handleFundsOrderChanged(evt(vendorPaymentId, 'SUBMITTED') as any);
      await ctx.wf.handleFundsOrderChanged(evt(vendorPaymentId, 'CONFIRMED') as any);
      expect(ctx.accounting.executeTransfer).toHaveBeenCalledTimes(1);
      expect(ctx.accounting.executeTransfer.mock.calls[0][0]).toMatchObject({
        code: TB_TRANSFER_CODES.VENDOR_PAYMENT, amount: 1_200_000n, ledger: TB_LEDGERS.AED,
        debitAccountId: acct(TB_ACCOUNT_CODES.FIRM_OPS, TB_LEDGERS.AED), creditAccountId: acct(TB_ACCOUNT_CODES.FIRM_ASSET, TB_LEDGERS.AED),
        evidence: expect.objectContaining({
          sourceType: 'VENDOR_PAYMENT', sourceNo: payNo, eventCode: 'VENDOR_PAYMENT',
          debitCode: 'E.FIRM_OPS', creditCode: 'A.FIRM_ASSET',
          debitWalletRef: 'w-ops-aed', creditWalletRef: 'w-ops-aed', isExternalCrossing: true, assetCurrency: 'AED',
        }),
      });
      // 评审 R12 同款纪律：回单必须先于落账（invocationCallOrder 越小越早发生，本次调用
      // 是 CONFIRMED 事件里的 postPaymentLeg，custodian 记录发生在 SUBMITTED 那一跳）。
      expect(ctx.custodianStatement.recordLegMovement.mock.invocationCallOrder[0]).toBeLessThan(ctx.accounting.executeTransfer.mock.invocationCallOrder[0]);
      expect(ctx.fundsOrders.advance).toHaveBeenCalledWith('fo-1', 'CLEAR', 'VENDOR_PAYMENT_WORKFLOW');
      const row = await ctx.payments.findByNo(payNo);
      expect(row.status).toBe(S.SUCCESS);
      expect(row.settledAt).toBeInstanceOf(Date);
      const audit = ctx.auditLogs.recordSystem.mock.calls.at(-1)[0]; // [0]=EXECUTION_STARTED, last=EXECUTED
      expect(audit).toMatchObject({ action: 'VENDOR_PAYMENT_EXECUTED', amount: '12000.00', fromStatus: 'EXECUTING', toStatus: 'SUCCESS' });
      expect(audit.requestId).toMatch(new RegExp(`^VENDOR_PAYMENT_EXECUTED_${payNo}_`));
    });

    it('posting throws → audit FAILED(POSTING_FAILED) with explicit requestId, not cleared, no transition, no retry (铁律⑤：先账后状态，失败即停)', async () => {
      const ctx = makeWorkflow();
      const { payNo, vendorPaymentId } = await seedExecuting(ctx);
      ctx.accounting.executeTransfer.mockRejectedValueOnce(new Error('TB down'));
      await ctx.wf.handleFundsOrderChanged(evt(vendorPaymentId, 'CONFIRMED') as any);
      expect(ctx.fundsOrders.advance).not.toHaveBeenCalled();
      const row = await ctx.payments.findByNo(payNo);
      expect(row.status).toBe(S.EXECUTING); // 停在原地，不重试
      const audit = ctx.auditLogs.recordSystem.mock.calls.at(-1)[0];
      expect(audit).toMatchObject({ action: 'VENDOR_PAYMENT_FAILED', reasonCode: 'POSTING_FAILED', outcome: 'FAILED' });
      expect(audit.requestId).toMatch(new RegExp(`^VENDOR_PAYMENT_FAILED_${payNo}_`));
    });

    it('FAILED: payment leg fails → order FAILED(LEG_FAILED), no funds paid out to the vendor', async () => {
      const ctx = makeWorkflow();
      const { payNo, vendorPaymentId } = await seedExecuting(ctx);
      await ctx.wf.handleFundsOrderChanged(evt(vendorPaymentId, 'FAILED') as any);
      const row = await ctx.payments.findByNo(payNo);
      expect(row.status).toBe(S.FAILED);
      expect(row.failureReasonCode).toBe('LEG_FAILED');
      expect(ctx.auditLogs.recordSystem.mock.calls.at(-1)[0]).toMatchObject({ action: 'VENDOR_PAYMENT_FAILED', reasonCode: 'LEG_FAILED', fromStatus: 'EXECUTING', toStatus: 'FAILED' });
    });
  });

  describe('cancel', () => {
    it('pending-approval payments can be cancelled: cancels the approval first, then flips to CANCELLED + audit', async () => {
      const { wf, payments, approvals, auditLogs } = makeWorkflow();
      const r = await wf.initiate(baseInput, treasury);
      const result = await wf.cancel(r.payNo, { reason: 'Opened by mistake' }, treasury);
      expect(approvals.cancel).toHaveBeenCalledWith('APR1', { reason: 'Opened by mistake' }, treasury);
      expect(result.status).toBe(S.CANCELLED);
      const row = await payments.findByNo(r.payNo);
      expect(row.status).toBe(S.CANCELLED);
      const audit = auditLogs.recordByActor.mock.calls[1][0]; // [0]=REQUESTED, [1]=CANCELLED
      expect(audit).toMatchObject({ action: 'VENDOR_PAYMENT_CANCELLED', fromStatus: 'PENDING_APPROVAL', toStatus: 'CANCELLED' });
      expect(audit.requestId).toMatch(new RegExp(`^VENDOR_PAYMENT_CANCELLED_${r.payNo}_`));
    });

    it('cannot cancel once executing', async () => {
      const { wf } = makeWorkflow();
      const r = await wf.initiate(baseInput, treasury);
      await wf.onDecided(decided('APPROVED', r.payNo) as any);
      await expect(wf.cancel(r.payNo, { reason: 'x' }, treasury)).rejects.toThrow(/cannot be cancelled/);
    });
  });
});
