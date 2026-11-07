// 战役乙波二 T5：付款单 workflow 行为测试（照 capital-injection-workflow.service.spec.ts +
// lp-exchange-workflow.service.spec.ts 两份模板拼接：单腿状态机走 T3 节奏，腿事件走 LP 卖出
// 腿 84 节奏）。`payments` 用真实 VendorPaymentService（非桩，喂真实 OutsourcingVendorsService）
// ——评审交接第 2 条：T4 spec 的 fundsOrder mock 恒返 []，`where: { vendorPaymentId }` 误写成
// `capitalInjectionId` 现在测不出来；本文件用一份行为化内存 prisma 让 getView() 的
// where 真过滤 vendorPaymentId，走了错字段会看到 legs 为空、断言失败。
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { VendorPaymentWorkflowService } from './vendor-payment-workflow.service';
import { VendorPaymentService } from './vendor-payment.service';
import { FirmWalletPickerService } from '../../funds-layer/domain/firm-wallet-picker.service';
import { VendorPaymentStatus as S } from './dto/vendor-payment.dto';
import { OutsourcingVendorsService } from '../../governance/compliance-office/outsourcing-vendors.service';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';

const AED = { id: 'asset-aed', assetNo: 'ASAED0001', code: 'AED', currency: 'AED', decimals: 2, type: 'FIAT', network: 'AED_ZAND' };
const treasury = { actorType: 'ADMIN' as const, userId: 'uuid-tre', userNo: 'ADM-TRE', roleCodes: ['TREASURY_OFFICER'] };
// 戊波二 T4：from 钱包由人选——运营户 / 手续费户可选，结算户（F_SET）不许。守卫用真 FirmWalletPickerService
// 喂同一份内存 prisma，所以「选错了会 400」是真代码路径，不是桩。
const OPS_WALLET = { id: 'w-ops-aed', walletNo: 'WAL-OPS-AED', address: null, iban: 'AE-OPS-AED', ownerType: 'PLATFORM', vaultCode: 'F_OPS', network: 'AED_ZAND' };
const FEE_WALLET = { id: 'w-fee-aed', walletNo: 'WAL-FEE-AED', address: null, iban: 'AE-FEE-AED', ownerType: 'PLATFORM', vaultCode: 'F_FEE', network: 'AED_ZAND' };
const SET_WALLET = { id: 'w-set-aed', walletNo: 'WAL-SET-AED', address: null, iban: 'AE-SET-AED', ownerType: 'PLATFORM', vaultCode: 'F_SET', network: 'AED_ZAND' };
const activeVendor = { id: 'vendor-1', vendorNo: 'VEN2609290001', name: 'HexTrust Custody Ltd', status: 'ACTIVE' };

// 修复轮同款：resolveTbAccountId 的 mock 按 (code, ledger) 编码出不同的账户 id——若实现把
// ledger 传错，断言里期望的账户 id 会对不上，能真的抓到跨 ledger 错误。
const acct = (code: number, ledger: number): bigint => BigInt(code) * 100n + BigInt(ledger);
// 钱包现金户(戊波一:一钱包一户):按 (钱包 id, ledger) 单射编码,与 acct() 的小整数 id 互不相撞。
const cashAcct = (walletId: string, ledger: number): bigint => BigInt(`0x${Buffer.from(`cash:${walletId}@${ledger}`).toString('hex')}`);

const baseInput = {
  vendorNo: activeVendor.vendorNo, payeeAccountRef: 'HexTrust ops account — IBAN AE070000000123456789',
  assetId: AED.id, amount: '12000', fromWalletId: OPS_WALLET.id,
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
  const walletsById: Record<string, any> = { [OPS_WALLET.id]: OPS_WALLET, [FEE_WALLET.id]: FEE_WALLET, [SET_WALLET.id]: SET_WALLET };
  const vendorRows: Record<string, any> = { [activeVendor.vendorNo]: activeVendor };

  return {
    asset: {
      findUnique: jest.fn(async ({ where }: any) => assetsById[where.id] ?? null),
    },
    wallet: {
      findUnique: jest.fn(async ({ where }: any) => walletsById[where.id] ?? null),
      // VendorPaymentService.toView 按 fromWalletId 批量取 walletNo 用
      findMany: jest.fn(async ({ where }: any) => (where.id.in as string[]).map((id) => walletsById[id]).filter(Boolean)),
    },
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

function makeAccounting() {
  return {
    resolveTbAccountId: jest.fn(async ({ code, ledger }: any) => acct(code, ledger)),
    // 戊波一:现金户只经这个入口取——传错钱包或账本,断言里的期望 id 对不上
    resolveCashAccountId: jest.fn(async (walletId: string, ledger: number) => cashAcct(walletId, ledger)),
    // 戊波二 T3:余额闸收成 AccountingService 上这一份(读数细节在 accounting.service.spec),默认放行;不足场景用 mockRejectedValueOnce 单次拒绝。
    assertWalletBalance: jest.fn(async () => undefined),
    executeTransfer: jest.fn(async () => ({ tbTransferId: 1n })),
  };
}

function makeWorkflow() {
  const prisma: any = makePrisma();
  const vendors = new OutsourcingVendorsService(prisma as any, {} as any);
  // 余额闸默认放行；不足场景用 accounting.assertWalletBalance.mockRejectedValueOnce 单次拒绝。
  const accounting: any = makeAccounting();
  const payments = new VendorPaymentService(prisma, vendors);
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
  // 真守卫（funds-layer 共用件）：F_OPS / F_FEE 放行，其余 400 FROM_WALLET_NOT_ELIGIBLE；spy 供断言调用次序与入参。
  const picker = new FirmWalletPickerService(prisma as any);
  jest.spyOn(picker, 'assertEligible');
  const custodianStatement: any = { recordLegMovement: jest.fn(async () => ({ outLineId: 'l1', inLineId: null, cutoffDate: '2026-09-29' })) };
  // 乙波三 T2：NLA 门桩——默认放行，跌破场景用 mockRejectedValueOnce 单次拒绝（同余额闸先例）。
  const prudential: any = { assertPostOutflowCompliant: jest.fn(async () => undefined) };
  const wf = new VendorPaymentWorkflowService(prisma, payments, approvals, accounting, auditLogs, fundsOrders, picker, custodianStatement, prudential);
  return { wf, payments, prisma, vendors, approvals, accounting, auditLogs, fundsOrders, picker, custodianStatement, prudential };
}

const decided = (decision: any, payNo: string) => ({ decision, actionType: 'VENDOR_PAYMENT_APPROVAL', entityRef: payNo, approvalId: 'uuid-apr', approvalNo: 'APR1', traceId: 'trace-1', workflowType: 'VENDOR_PAYMENT', metadata: {} });

describe('VendorPaymentWorkflowService (Task 5)', () => {
  describe('initiate — birth guards + happy path', () => {
    it('operating account balance is not enough → 400 (guard is the shared AccountingService gate); NLA gate never reached — 余额闸独立运行', async () => {
      const { wf, accounting, prudential } = makeWorkflow();
      accounting.assertWalletBalance.mockRejectedValueOnce(new Error('Insufficient AED balance in wallet WAL-OPS-AED'));
      await expect(wf.initiate(baseInput, treasury)).rejects.toThrow(/Insufficient/);
      expect(prudential.assertPostOutflowCompliant).not.toHaveBeenCalled();
    });

    it('NLA gate runs right after the balance check with the payment amount/currency, orderKind=VENDOR_PAYMENT, counterpartyNo=vendorNo', async () => {
      const { wf, prudential } = makeWorkflow();
      await wf.initiate(baseInput, treasury);
      expect(prudential.assertPostOutflowCompliant).toHaveBeenCalledWith({
        currency: 'AED', amountMinor: 1_200_000n, orderKind: 'VENDOR_PAYMENT', counterpartyNo: activeVendor.vendorNo, assetNo: AED.assetNo, actor: treasury,
      });
    });

    it('NLA gate blocks → initiate rejects with the gate\'s own 400, no row created, no approval submitted (拒建单)', async () => {
      const { wf, prudential, prisma, approvals } = makeWorkflow();
      prudential.assertPostOutflowCompliant.mockRejectedValueOnce(
        new BadRequestException('Blocked by prudential floor (Company Rulebook VI.C): this payment would take Net Liquid Assets below the regulatory floor — NLA now 1500000.00 AED, after 1100000.00 AED, floor 1200000.00 AED.'),
      );
      await expect(wf.initiate(baseInput, treasury)).rejects.toThrow(/Blocked by prudential floor/);
      expect(approvals.createAndSubmit).not.toHaveBeenCalled();
      expect(prisma.vendorPayment.create).not.toHaveBeenCalled();
    });

    it('from = F_OPS: validates the chosen wallet, gates ITS balance, passes the NLA gate, persists fromWalletId, submits CFO approval whose snapshot names the from wallet by walletNo (zero UUIDs), audit REQUESTED, subjects mirror the vendor', async () => {
      const { wf, payments, approvals, auditLogs, picker, accounting, prudential } = makeWorkflow();
      const r = await wf.initiate(baseInput, treasury);
      expect(r.status).toBe(S.PENDING_APPROVAL);
      expect(r.approvalNo).toBe('APR1');
      expect(picker.assertEligible).toHaveBeenCalledWith(OPS_WALLET.id, AED.id);
      // 余额闸查的是人选的那只钱包在付款币账本上的现金户，金额 = 最小单位
      expect(accounting.assertWalletBalance).toHaveBeenCalledWith(OPS_WALLET.id, TB_LEDGERS.AED, 1_200_000n);
      expect(prudential.assertPostOutflowCompliant).toHaveBeenCalledTimes(1);
      const created = await payments.findByNo(r.payNo);
      expect(created.fromWalletId).toBe('w-ops-aed');
      expect(created.createdByUserId).toBe('ADM-TRE'); // T4 交接第 1 条：actor.userNo ?? actor.userId
      const snapshot = approvals.createAndSubmit.mock.calls[0][0];
      expect(snapshot.actionType).toBe('VENDOR_PAYMENT_APPROVAL');
      expect(snapshot.entityRef).toBe(r.payNo);
      expect(snapshot.objectSnapshot.fromWalletNo).toBe('WAL-OPS-AED');
      expect(snapshot.objectSnapshot.impact).toMatch(/AED operating balance decreases/);
      expect(JSON.stringify(snapshot.objectSnapshot)).not.toMatch(/uuid-|w-ops/);
      expect(snapshot.objectSnapshot.amount).toBe('12000.00 AED');
      expect(snapshot.objectSnapshot.vendorName).toBe(activeVendor.name);
      // 修复轮·控制器确认缺口：payeeAccountRef 必须在场——CFO 批的是「钱打到哪个账户」，
      // 这坐标是金库开单手填的一次性值，不像 LP 单那样能从已批档案反查。
      expect(snapshot.objectSnapshot.payeeAccountRef).toBe(baseInput.payeeAccountRef);
      const audit = auditLogs.recordByActor.mock.calls[0][0];
      expect(audit).toMatchObject({ action: 'VENDOR_PAYMENT_REQUESTED', actionDomain: 'TREASURY', primarySubjectNo: r.payNo, amount: '12000.00', approvalNo: 'APR1', reason: baseInput.reason });
      expect(audit.requestId).toMatch(new RegExp(`^VENDOR_PAYMENT_REQUESTED_${r.payNo}_`));
      expect(audit.metadata.fromWalletNo).toBe('WAL-OPS-AED'); // 人选的 from 钱包留痕（业务键）
      expect(audit.correlationId).toBeUndefined(); // REQUESTED 起旅程，不显式传 correlationId
      expect(audit.subjects).toEqual(expect.arrayContaining([
        expect.objectContaining({ subjectType: 'VENDOR_PAYMENT', subjectNo: r.payNo, subjectRole: 'PRIMARY' }),
        expect.objectContaining({ subjectType: 'OUTSOURCING_VENDOR', subjectNo: activeVendor.vendorNo, subjectRole: 'RELATED' }),
      ]));
    });

    it('from = F_FEE: NLA gate IS called (money leaves the firm — 戊波三 裁定 2: both from wallets are counted in NLA), balance gate checks the FEE wallet, row persists the fee wallet, snapshot names it', async () => {
      const { wf, payments, approvals, auditLogs, picker, accounting, prudential } = makeWorkflow();
      const r = await wf.initiate({ ...baseInput, fromWalletId: FEE_WALLET.id }, treasury);
      expect(picker.assertEligible).toHaveBeenCalledWith(FEE_WALLET.id, AED.id);
      expect(accounting.assertWalletBalance).toHaveBeenCalledTimes(1);
      expect(accounting.assertWalletBalance).toHaveBeenCalledWith(FEE_WALLET.id, TB_LEDGERS.AED, 1_200_000n);
      expect(prudential.assertPostOutflowCompliant).toHaveBeenCalledTimes(1);
      expect(prudential.assertPostOutflowCompliant).toHaveBeenCalledWith(expect.objectContaining({ currency: 'AED', amountMinor: 1_200_000n, orderKind: 'VENDOR_PAYMENT' }));
      const created = await payments.findByNo(r.payNo);
      expect(created.fromWalletId).toBe('w-fee-aed');
      const snapshot = approvals.createAndSubmit.mock.calls[0][0];
      expect(snapshot.objectSnapshot.fromWalletNo).toBe('WAL-FEE-AED');
      expect(JSON.stringify(snapshot.objectSnapshot)).not.toMatch(/uuid-|w-fee/);
      expect(snapshot.objectSnapshot.impact).toMatch(/AED fee balance decreases/); // 影响摘要不再对手续费户说「运营户余额减少」
      expect(auditLogs.recordByActor.mock.calls[0][0].metadata.fromWalletNo).toBe('WAL-FEE-AED');
    });

    it('from = F_SET (settlement wallet) → 400 FROM_WALLET_NOT_ELIGIBLE, nothing downstream runs: no balance gate, no NLA gate, no row, no approval', async () => {
      const { wf, prisma, approvals, accounting, prudential } = makeWorkflow();
      const err: any = await wf.initiate({ ...baseInput, fromWalletId: SET_WALLET.id }, treasury).catch((e) => e);
      expect(err.getStatus()).toBe(400);
      expect(err.getResponse()).toMatchObject({ code: 'FROM_WALLET_NOT_ELIGIBLE' });
      expect(err.message).toContain('WAL-SET-AED');
      expect(accounting.assertWalletBalance).not.toHaveBeenCalled();
      expect(prudential.assertPostOutflowCompliant).not.toHaveBeenCalled();
      expect(prisma.vendorPayment.create).not.toHaveBeenCalled();
      expect(approvals.createAndSubmit).not.toHaveBeenCalled();
    });

    it('a wallet id that does not exist → 400 FROM_WALLET_NOT_ELIGIBLE (same guard, no downstream)', async () => {
      const { wf, prisma, accounting } = makeWorkflow();
      await expect(wf.initiate({ ...baseInput, fromWalletId: 'w-nope' }, treasury)).rejects.toMatchObject({ response: { code: 'FROM_WALLET_NOT_ELIGIBLE' } });
      expect(accounting.assertWalletBalance).not.toHaveBeenCalled();
      expect(prisma.vendorPayment.create).not.toHaveBeenCalled();
    });

    it('gate order for F_OPS: wallet eligibility → balance → NLA → row (invocationCallOrder)', async () => {
      const { wf, picker, accounting, prudential, prisma } = makeWorkflow();
      await wf.initiate(baseInput, treasury);
      const order = (m: jest.Mock) => m.mock.invocationCallOrder[0];
      expect(order(picker.assertEligible as jest.Mock)).toBeLessThan(order(accounting.assertWalletBalance));
      expect(order(accounting.assertWalletBalance)).toBeLessThan(order(prudential.assertPostOutflowCompliant));
      expect(order(prudential.assertPostOutflowCompliant)).toBeLessThan(order(prisma.vendorPayment.create));
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
      ctx.accounting.assertWalletBalance.mockRejectedValueOnce(new Error('Insufficient AED balance in wallet WAL-OPS-AED'));
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
      expect(view.fromWalletNo).toBe('WAL-OPS-AED'); // 付款单本身的 from 钱包号（业务键，不是 UUID）
    });

    it('approval-time recheck follows the row\'s chosen from wallet (F_FEE): balance gate re-run on the FEE wallet; short → FAILED, zero funds orders', async () => {
      const ctx = makeWorkflow();
      const r = await ctx.wf.initiate({ ...baseInput, fromWalletId: FEE_WALLET.id }, treasury);
      ctx.accounting.assertWalletBalance.mockClear();
      ctx.prudential.assertPostOutflowCompliant.mockClear();
      ctx.accounting.assertWalletBalance.mockRejectedValueOnce(new Error('Insufficient AED balance in wallet WAL-FEE-AED'));
      await ctx.wf.onDecided(decided('APPROVED', r.payNo) as any);
      expect(ctx.accounting.assertWalletBalance).toHaveBeenCalledWith(FEE_WALLET.id, TB_LEDGERS.AED, 1_200_000n);
      const row = await ctx.payments.findByNo(r.payNo);
      expect(row.status).toBe(S.FAILED);
      expect(row.failureReasonCode).toBe('INSUFFICIENT_FIRM_BALANCE');
      expect(ctx.fundsOrders.create).not.toHaveBeenCalled();
      // 批准时不再重过 NLA 门（既有口径：门只在开单时过一次）
      expect(ctx.prudential.assertPostOutflowCompliant).not.toHaveBeenCalled();
    });

    it('approved with from = F_FEE → leg 1 leaves the FEE wallet; the view shows its walletNo on both the payment and the leg', async () => {
      const ctx = makeWorkflow();
      const r = await ctx.wf.initiate({ ...baseInput, fromWalletId: FEE_WALLET.id }, treasury);
      ctx.accounting.assertWalletBalance.mockClear();
      await ctx.wf.onDecided(decided('APPROVED', r.payNo) as any);
      expect(ctx.accounting.assertWalletBalance).toHaveBeenCalledWith(FEE_WALLET.id, TB_LEDGERS.AED, 1_200_000n);
      expect(ctx.fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ fromWalletId: 'w-fee-aed', fromIban: 'AE-FEE-AED' }));
      const view = await ctx.payments.getView(r.payNo);
      expect(view.fromWalletNo).toBe('WAL-FEE-AED');
      expect(view.legs[0].fromWalletNo).toBe('WAL-FEE-AED');
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

    it('CONFIRMED: posts 87 (DR X.EXPENSE_BANK_CUSTODY / CR 现金·row.fromWalletId) BEFORE recording — actually records custodian line first (回单先于落账) — then CLEARs → SUCCESS + audit EXECUTED carries fromStatus/toStatus + explicit requestId', async () => {
      const ctx = makeWorkflow();
      const { payNo, vendorPaymentId } = await seedExecuting(ctx);
      await ctx.wf.handleFundsOrderChanged(evt(vendorPaymentId, 'SUBMITTED') as any);
      // 开单 / 批准时的余额闸(第 8 任务才改)也走这个 mock——清掉,下面「查了哪些户」只看落账这一步
      ctx.accounting.resolveTbAccountId.mockClear();
      await ctx.wf.handleFundsOrderChanged(evt(vendorPaymentId, 'CONFIRMED') as any);
      expect(ctx.accounting.executeTransfer).toHaveBeenCalledTimes(1);
      expect(ctx.accounting.executeTransfer.mock.calls[0][0]).toMatchObject({
        code: TB_TRANSFER_CODES.VENDOR_PAYMENT, amount: 1_200_000n, ledger: TB_LEDGERS.AED,
        debitAccountId: acct(TB_ACCOUNT_CODES.EXPENSE_BANK_CUSTODY, TB_LEDGERS.AED), creditAccountId: cashAcct('w-ops-aed', TB_LEDGERS.AED),
        evidence: expect.objectContaining({
          sourceType: 'VENDOR_PAYMENT', sourceNo: payNo, eventCode: 'VENDOR_PAYMENT',
          debitCode: 'X.EXPENSE_BANK_CUSTODY', creditCode: 'A.FIRM_CASH', assetCurrency: 'AED',
        }),
      });
      // 贷方 = 付款钱包(row.fromWalletId = F_OPS)的现金户,经唯一入口取;借方是开支户(SYSTEM 300),不再借权益
      expect(ctx.accounting.resolveCashAccountId).toHaveBeenCalledWith('w-ops-aed', TB_LEDGERS.AED);
      const resolved = (ctx.accounting.resolveTbAccountId.mock.calls as any[][]).map((c) => c[0]);
      expect(resolved).toContainEqual(expect.objectContaining({ code: TB_ACCOUNT_CODES.EXPENSE_BANK_CUSTODY, ledger: TB_LEDGERS.AED, ownerType: 'SYSTEM' }));
      expect(resolved.map((a) => a.code)).not.toContain(TB_ACCOUNT_CODES.FIRM_CASH);
      expect(resolved.map((a) => a.code)).not.toContain(TB_ACCOUNT_CODES.FIRM_EQUITY);
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

    it('CONFIRMED with from = F_FEE: 87 credits the FEE wallet cash account (not the operating wallet), debit side unchanged (300 开支户), no code-90 sweep transfer', async () => {
      const ctx = makeWorkflow();
      const r = await ctx.wf.initiate({ ...baseInput, fromWalletId: FEE_WALLET.id }, treasury);
      await ctx.wf.onDecided(decided('APPROVED', r.payNo) as any);
      const row = await ctx.payments.findByNo(r.payNo);
      await ctx.wf.handleFundsOrderChanged(evt(row.id, 'CONFIRMED') as any);
      expect(ctx.accounting.executeTransfer).toHaveBeenCalledTimes(1); // 只有 87 一笔：不结转（裁定 5：钱没进运营户）
      expect(ctx.accounting.executeTransfer.mock.calls[0][0]).toMatchObject({
        code: TB_TRANSFER_CODES.VENDOR_PAYMENT, amount: 1_200_000n, ledger: TB_LEDGERS.AED,
        debitAccountId: acct(TB_ACCOUNT_CODES.EXPENSE_BANK_CUSTODY, TB_LEDGERS.AED), creditAccountId: cashAcct('w-fee-aed', TB_LEDGERS.AED),
      });
      expect(ctx.accounting.resolveCashAccountId).toHaveBeenCalledWith('w-fee-aed', TB_LEDGERS.AED);
      expect(ctx.accounting.resolveCashAccountId).not.toHaveBeenCalledWith('w-ops-aed', TB_LEDGERS.AED);
      expect((await ctx.payments.findByNo(r.payNo)).status).toBe(S.SUCCESS);
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
