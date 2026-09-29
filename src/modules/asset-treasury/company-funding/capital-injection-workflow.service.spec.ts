// 战役乙波二 T3：注资单 workflow 行为测试（照 lp-exchange-workflow.service.spec.ts 模式）。
// `injections` 用真实 CapitalInjectionService（非桩）——T2 评审交接第 3 条：getView() 的资金单
// 腿投影（walletNo 映射 / externalRef 分支）此前零测试覆盖，本文件用一份行为化内存 prisma
// 让真实 create/transition/getView 跑通整条链路，simulateContribution 产腿后至少一条断言
// 穿过 getView 腿区。
import { randomUUID } from 'node:crypto';
import { CapitalInjectionWorkflowService } from './capital-injection-workflow.service';
import { CapitalInjectionService } from './capital-injection.service';
import { CapitalInjectionStatus as S } from './dto/capital-injection.dto';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';

const AED = { id: 'asset-aed', code: 'AED', currency: 'AED', decimals: 2, type: 'FIAT' };
const treasury = { actorType: 'ADMIN' as const, userId: 'uuid-tre', userNo: 'ADM-TRE', roleCodes: ['TREASURY_OFFICER'] };
const OPS_WALLET = { id: 'w-ops-aed', walletNo: 'WAL-OPS-AED', address: null, iban: 'AE-OPS-AED' };

// 修复轮同款：resolveTbAccountId 的 mock 按 (code, ledger) 编码出不同的账户 id——若实现把
// ledger 传错，断言里期望的账户 id 会对不上，能真的抓到跨 ledger 错误。
const acct = (code: number, ledger: number): bigint => BigInt(code) * 100n + BigInt(ledger);

const baseInput = {
  contributorName: 'Founder Holdings Ltd', assetId: AED.id, amount: '500000',
  prudentialPurpose: 'Top up prudential capital buffer ahead of quarter end',
  reason: 'Shareholder capital call',
};

/** 行为化内存 prisma（照 capital-injection.service.spec.ts 的 makePrisma 先例，扩展
 *  fundsOrder/wallet 真实存取——让 CapitalInjectionService.getView() 的腿投影跑真代码）。 */
function makePrisma() {
  const cinRows = new Map<string, any>();
  const fundsOrderRows = new Map<string, any>();
  let clock = Date.parse('2026-09-29T00:00:00.000Z');
  const tick = () => new Date((clock += 1000));
  const assetsById: Record<string, any> = { [AED.id]: AED };
  const walletsById: Record<string, any> = { [OPS_WALLET.id]: OPS_WALLET };

  return {
    asset: { findUnique: jest.fn(async ({ where }: any) => assetsById[where.id] ?? null) },
    wallet: { findUnique: jest.fn(async ({ where }: any) => walletsById[where.id] ?? null) },
    capitalInjection: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: randomUUID(), approvalNo: null, receivedAt: null, settledAt: null, createdAt: tick(), updatedAt: tick(), ...data };
        cinRows.set(row.cinNo, row);
        return { ...row, asset: assetsById[row.assetId] };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = cinRows.get(where.cinNo);
        if (!existing) throw new Error(`no such row: ${where.cinNo}`);
        const updated = { ...existing, ...data, updatedAt: tick() };
        cinRows.set(where.cinNo, updated);
        return { ...updated, asset: assetsById[updated.assetId] };
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const row = cinRows.get(where.cinNo);
        return row ? { ...row, asset: assetsById[row.assetId] } : null;
      }),
      findMany: jest.fn(async () => [...cinRows.values()].map((r) => ({ ...r, asset: assetsById[r.assetId] }))),
      count: jest.fn(async () => cinRows.size),
    },
    // 供 CapitalInjectionService.getView() 直读（真代码路径，不经 FundsOrderService）。
    fundsOrder: {
      findMany: jest.fn(async ({ where }: any) => {
        return [...fundsOrderRows.values()]
          .filter((r) => r.capitalInjectionId === where.capitalInjectionId)
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

function makeWorkflow() {
  const prisma: any = makePrisma();
  const injections = new CapitalInjectionService(prisma);
  const approvals: any = { createAndSubmit: jest.fn(async () => ({ approvalNo: 'APR1' })), cancel: jest.fn(async () => ({})) };
  const accounting: any = {
    resolveTbAccountId: jest.fn(async ({ code, ledger }: any) => acct(code, ledger)),
    executeTransfer: jest.fn(async () => ({ tbTransferId: 1n })),
  };
  const auditLogs: any = { recordByActor: jest.fn(async () => ({})), recordSystem: jest.fn(async () => ({})) };
  // fundsOrders 桩：create/findByParent 直写/直读同一份 prisma.fundsOrder 内存表，让
  // injections.getView() 之后能查到真腿（评审交接第 3 条）。
  const fundsOrders: any = {
    create: jest.fn(async (input: any) => {
      const id = `fo-${input.legSeq}`;
      const row = {
        id, fundsOrderNo: `FDO${input.legSeq}`, legSeq: input.legSeq, attempt: 1,
        status: input.initialStatus, amount: input.amount, netAmount: input.netAmount,
        assetId: input.assetId, capitalInjectionId: input.capitalInjectionId,
        fromWalletId: input.fromWalletId, fromAddress: input.fromAddress, fromIban: input.fromIban,
        toWalletId: input.toWalletId, toAddress: input.toAddress, toIban: input.toIban,
        txHash: null, referenceNo: 'BANK-REF-1', createdAt: new Date(),
      };
      prisma.__fundsOrderRows.set(id, row);
      return row;
    }),
    advance: jest.fn(async () => ({})),
    resolveExternalRef: jest.fn((row: any) => (row.asset?.type === 'CRYPTO' ? row.txHash ?? null : row.referenceNo ?? null)),
    findByParent: jest.fn(async (parent: any, filter?: any) =>
      [...prisma.__fundsOrderRows.values()].filter(
        (r: any) => r.capitalInjectionId === parent.capitalInjectionId && (filter?.legSeq === undefined || r.legSeq === filter.legSeq),
      ),
    ),
  };
  const systemWallets: any = { resolve: jest.fn(async () => OPS_WALLET) };
  const custodianStatement: any = { recordLegMovement: jest.fn(async () => ({ outLineId: null, inLineId: 'l1', cutoffDate: '2026-09-29' })) };
  const wf = new CapitalInjectionWorkflowService(prisma, injections, approvals, accounting, auditLogs, fundsOrders, systemWallets, custodianStatement);
  return { wf, injections, prisma, approvals, accounting, auditLogs, fundsOrders, systemWallets, custodianStatement };
}

describe('CapitalInjectionWorkflowService (Task 3)', () => {
  describe('initiate — happy path', () => {
    it('resolves the F_OPS wallet, creates the row, submits CFO approval, audit REQUESTED, snapshot has zero UUIDs', async () => {
      const { wf, injections, approvals, auditLogs, systemWallets } = makeWorkflow();
      const r = await wf.initiate(baseInput, treasury);
      expect(r.status).toBe(S.PENDING_APPROVAL);
      expect(r.approvalNo).toBe('APR1');
      expect(systemWallets.resolve).toHaveBeenCalledWith(AED.id, 'F_OPS');
      const created = await injections.findByNo(r.cinNo);
      expect(created.toWalletId).toBe('w-ops-aed');
      expect(created.createdByUserId).toBe('ADM-TRE'); // T2 交接第 2 条：actor.userNo ?? actor.userId
      const snapshot = approvals.createAndSubmit.mock.calls[0][0];
      expect(snapshot.actionType).toBe('CAPITAL_INJECTION_APPROVAL');
      expect(snapshot.entityRef).toBe(r.cinNo);
      expect(JSON.stringify(snapshot.objectSnapshot)).not.toMatch(/uuid-|w-ops/);
      expect(snapshot.objectSnapshot.amount).toBe('500000.00 AED');
      const audit = auditLogs.recordByActor.mock.calls[0][0];
      expect(audit).toMatchObject({ action: 'CAPITAL_INJECTION_REQUESTED', actionDomain: 'TREASURY', primarySubjectNo: r.cinNo, amount: '500000.00', approvalNo: 'APR1', reason: baseInput.reason });
      expect(audit.requestId).toMatch(new RegExp(`^CAPITAL_INJECTION_REQUESTED_${r.cinNo}_`));
      expect(audit.correlationId).toBeUndefined(); // REQUESTED 起旅程，不显式传 correlationId
    });
  });

  describe('onDecided', () => {
    async function seedPending(wf: ReturnType<typeof makeWorkflow>['wf'], injections: CapitalInjectionService) {
      const r = await wf.initiate(baseInput, treasury);
      return r.cinNo;
    }

    it('approved → AWAITING_FUNDS + audit APPROVED carries fromStatus/toStatus + approvalNo+causationId', async () => {
      const { wf, injections, auditLogs } = makeWorkflow();
      const cinNo = await seedPending(wf, injections);
      await wf.onDecided({ decision: 'APPROVED', actionType: 'CAPITAL_INJECTION_APPROVAL', entityRef: cinNo, approvalId: 'uuid-apr', approvalNo: 'APR1', traceId: 'trace-1', workflowType: 'CAPITAL_INJECTION', metadata: {} } as any);
      const row = await injections.findByNo(cinNo);
      expect(row.status).toBe(S.AWAITING_FUNDS);
      const audit = auditLogs.recordSystem.mock.calls[0][0];
      expect(audit).toMatchObject({ action: 'CAPITAL_INJECTION_APPROVED', approvalNo: 'APR1', causationId: 'uuid-apr', fromStatus: 'PENDING_APPROVAL', toStatus: 'AWAITING_FUNDS' });
      expect(audit.requestId).toMatch(new RegExp(`^CAPITAL_INJECTION_APPROVED_${cinNo}_`));
    });

    it('declined → REJECTED + audit REJECTED carries fromStatus/toStatus + approvalNo+causationId', async () => {
      const { wf, injections, auditLogs } = makeWorkflow();
      const cinNo = await seedPending(wf, injections);
      await wf.onDecided({ decision: 'DECLINED', actionType: 'CAPITAL_INJECTION_APPROVAL', entityRef: cinNo, approvalId: 'uuid-apr', approvalNo: 'APR1', traceId: 'trace-1', workflowType: 'CAPITAL_INJECTION', metadata: {}, decisionReason: 'Not needed this quarter' } as any);
      const row = await injections.findByNo(cinNo);
      expect(row.status).toBe(S.REJECTED);
      const audit = auditLogs.recordSystem.mock.calls[0][0];
      expect(audit).toMatchObject({ action: 'CAPITAL_INJECTION_REJECTED', reason: 'Not needed this quarter', approvalNo: 'APR1', causationId: 'uuid-apr', fromStatus: 'PENDING_APPROVAL', toStatus: 'REJECTED' });
      expect(audit.requestId).toMatch(new RegExp(`^CAPITAL_INJECTION_REJECTED_${cinNo}_`));
    });

    it('a cancellation decision is not handled here (cancel() closes its own loop)', async () => {
      const { wf, injections, auditLogs } = makeWorkflow();
      const cinNo = await seedPending(wf, injections);
      auditLogs.recordSystem.mockClear();
      await wf.onDecided({ decision: 'CANCELLED', actionType: 'CAPITAL_INJECTION_APPROVAL', entityRef: cinNo, approvalId: 'uuid-apr', approvalNo: 'APR1', traceId: 'trace-1', workflowType: 'CAPITAL_INJECTION', metadata: {} } as any);
      const row = await injections.findByNo(cinNo);
      expect(row.status).toBe(S.PENDING_APPROVAL); // 未被 onDecided 动过
      expect(auditLogs.recordSystem).not.toHaveBeenCalled();
    });
  });

  describe('simulateContribution (⚡到款) + confirm (确认入账, 码70) — full chain', () => {
    async function seedAwaitingFunds() {
      const ctx = makeWorkflow();
      const r = await ctx.wf.initiate(baseInput, treasury);
      await ctx.wf.onDecided({ decision: 'APPROVED', actionType: 'CAPITAL_INJECTION_APPROVAL', entityRef: r.cinNo, approvalId: 'uuid-apr', approvalNo: 'APR1', traceId: 'trace-1', workflowType: 'CAPITAL_INJECTION', metadata: {} } as any);
      return { ...ctx, cinNo: r.cinNo };
    }

    it('未批（PENDING_APPROVAL）时 ⚡到款被拒', async () => {
      const { wf, injections } = makeWorkflow();
      const r = await wf.initiate(baseInput, treasury);
      await expect(wf.simulateContribution(r.cinNo, treasury)).rejects.toThrow(/not awaiting funds/);
      const row = await injections.findByNo(r.cinNo);
      expect(row.status).toBe(S.PENDING_APPROVAL);
    });

    it('未到款（AWAITING_FUNDS）时 confirm 被拒', async () => {
      const { wf, cinNo } = await seedAwaitingFunds();
      await expect(wf.confirm(cinNo, treasury)).rejects.toThrow(/not received yet/);
    });

    it('⚡到款：建腿 CONFIRMED，回单先于（不落账），翻 RECEIVED；accounting.executeTransfer 未被调（落账不在这一边——本任务与 LP 腿2 的关键差异）', async () => {
      const { wf, injections, auditLogs, accounting, custodianStatement, cinNo } = await seedAwaitingFunds();
      const r = await wf.simulateContribution(cinNo, treasury);
      expect(r.status).toBe(S.RECEIVED);
      expect(accounting.executeTransfer).not.toHaveBeenCalled();
      expect(custodianStatement.recordLegMovement).toHaveBeenCalledWith(expect.objectContaining({
        fundsOrderNo: 'FDO1', fromWalletId: null, toWalletId: 'w-ops-aed', assetCode: 'AED', assetType: 'FIAT', amountMinor: 50_000_000n,
      }));
      const row = await injections.findByNo(cinNo);
      expect(row.status).toBe(S.RECEIVED);
      expect(row.receivedAt).toBeInstanceOf(Date);
      // recordByActor 的第 0 次是 initiate() 的 REQUESTED（seedAwaitingFunds 里发起）；取最后一次。
      const audit = auditLogs.recordByActor.mock.calls.at(-1)[0];
      expect(audit).toMatchObject({ action: 'CAPITAL_INJECTION_FUNDS_RECEIVED', fromStatus: 'AWAITING_FUNDS', toStatus: 'RECEIVED', amount: '500000.00' });
      expect(audit.requestId).toMatch(new RegExp(`^CAPITAL_INJECTION_FUNDS_RECEIVED_${cinNo}_`));

      // 评审交接第 3 条：腿产生后穿过 getView() 真实腿投影（walletNo 映射 + externalRef 分支，
      // FIAT → referenceNo）——此前 T2 零覆盖。
      const view = await injections.getView(cinNo);
      expect(view.legs).toHaveLength(1);
      expect(view.legs[0]).toMatchObject({ fundsOrderNo: 'FDO1', legSeq: 1, status: 'CONFIRMED', fromWalletNo: null, toWalletNo: 'WAL-OPS-AED', externalRef: 'BANK-REF-1' });
    });

    it('二次 ⚡到款被拒（已在 RECEIVED，非 AWAITING_FUNDS）', async () => {
      const { wf, cinNo } = await seedAwaitingFunds();
      await wf.simulateContribution(cinNo, treasury);
      await expect(wf.simulateContribution(cinNo, treasury)).rejects.toThrow(/not awaiting funds/);
    });

    it('confirm：post 码 70（DR FIRM_ASSET / CR FIRM_OPS，注入币 ledger，外穿）→ CLEAR 腿 → SUCCESS + audit CONFIRMED(expected/received) + explicit requestId', async () => {
      const { wf, injections, accounting, fundsOrders, auditLogs, cinNo } = await seedAwaitingFunds();
      await wf.simulateContribution(cinNo, treasury);
      const r = await wf.confirm(cinNo, treasury);
      expect(r.status).toBe(S.SUCCESS);
      expect(accounting.executeTransfer).toHaveBeenCalledTimes(1);
      expect(accounting.executeTransfer.mock.calls[0][0]).toMatchObject({
        code: TB_TRANSFER_CODES.CAPITAL_INJECTION, amount: 50_000_000n, ledger: TB_LEDGERS.AED,
        debitAccountId: acct(TB_ACCOUNT_CODES.FIRM_ASSET, TB_LEDGERS.AED), creditAccountId: acct(TB_ACCOUNT_CODES.FIRM_OPS, TB_LEDGERS.AED),
        evidence: expect.objectContaining({
          sourceType: 'CAPITAL_INJECTION', sourceNo: cinNo, eventCode: 'CAPITAL_INJECTION',
          debitCode: 'A.FIRM_ASSET', creditCode: 'E.FIRM_OPS',
          debitWalletRef: 'w-ops-aed', creditWalletRef: 'w-ops-aed', isExternalCrossing: true, assetCurrency: 'AED',
        }),
      });
      expect(fundsOrders.advance).toHaveBeenCalledWith('fo-1', 'CLEAR', 'CAPITAL_INJECTION_WORKFLOW');
      const row = await injections.findByNo(cinNo);
      expect(row.status).toBe(S.SUCCESS);
      expect(row.settledAt).toBeInstanceOf(Date);
      // recordByActor 顺序：[0]=REQUESTED(initiate)，[1]=FUNDS_RECEIVED(simulateContribution)，[2]=CONFIRMED；取最后一次。
      const audit = auditLogs.recordByActor.mock.calls.at(-1)[0];
      expect(audit).toMatchObject({ action: 'CAPITAL_INJECTION_CONFIRMED', fromStatus: 'RECEIVED', toStatus: 'SUCCESS', amount: '500000.00' });
      expect(audit.metadata).toMatchObject({ expected: '500000.00', received: '500000.00' });
      expect(audit.requestId).toMatch(new RegExp(`^CAPITAL_INJECTION_CONFIRMED_${cinNo}_`));
    });

    it('二次 confirm 被拒（迁移表天然拒二次——已 SUCCESS，零出边）', async () => {
      const { wf, cinNo } = await seedAwaitingFunds();
      await wf.simulateContribution(cinNo, treasury);
      await wf.confirm(cinNo, treasury);
      await expect(wf.confirm(cinNo, treasury)).rejects.toThrow(/not received yet/);
    });
  });

  describe('cancel', () => {
    it('pending-approval injections can be cancelled: cancels the approval first, then flips to CANCELLED + audit', async () => {
      const { wf, injections, approvals, auditLogs } = makeWorkflow();
      const r = await wf.initiate(baseInput, treasury);
      const result = await wf.cancel(r.cinNo, { reason: 'Opened by mistake' }, treasury);
      expect(approvals.cancel).toHaveBeenCalledWith('APR1', { reason: 'Opened by mistake' }, treasury);
      expect(result.status).toBe(S.CANCELLED);
      const row = await injections.findByNo(r.cinNo);
      expect(row.status).toBe(S.CANCELLED);
      const audit = auditLogs.recordByActor.mock.calls[1][0]; // [0]=REQUESTED, [1]=CANCELLED
      expect(audit).toMatchObject({ action: 'CAPITAL_INJECTION_CANCELLED', fromStatus: 'PENDING_APPROVAL', toStatus: 'CANCELLED' });
      expect(audit.requestId).toMatch(new RegExp(`^CAPITAL_INJECTION_CANCELLED_${r.cinNo}_`));
    });

    it('cannot cancel once awaiting funds', async () => {
      const { wf } = makeWorkflow();
      const r = await wf.initiate(baseInput, treasury);
      await wf.onDecided({ decision: 'APPROVED', actionType: 'CAPITAL_INJECTION_APPROVAL', entityRef: r.cinNo, approvalId: 'uuid-apr', approvalNo: 'APR1', traceId: 'trace-1', workflowType: 'CAPITAL_INJECTION', metadata: {} } as any);
      await expect(wf.cancel(r.cinNo, { reason: 'x' }, treasury)).rejects.toThrow(/cannot be cancelled/);
    });
  });
});
