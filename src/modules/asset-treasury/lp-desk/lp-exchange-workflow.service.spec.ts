import { BadRequestException } from '@nestjs/common';
import { LpExchangeWorkflowService } from './lp-exchange-workflow.service';
import { LpExchangeStatus as S } from './dto/lp-exchange.dto';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';

const USDT = { id: 'a-usdt', code: 'USDT-TRON', currency: 'USDT', decimals: 6, type: 'CRYPTO' };
const AED = { id: 'a-aed', code: 'AED', currency: 'AED', decimals: 2, type: 'FIAT' };
const treasury = { actorType: 'ADMIN' as const, userId: 'uuid-tre', userNo: 'ADM-TRE', roleCodes: ['TREASURY_OFFICER'] };
const profile = { lpNo: 'LPP1', name: 'Acme LP', fiatBankName: 'Bank', fiatIban: 'AE-LP-IBAN', cryptoNetwork: 'TRON', cryptoAddress: 'TLP-ADDR', agreementRef: 'AGR1', status: 'ACTIVE' };

// 修复轮 1 随轮小项 #2：resolveTbAccountId 的 mock 按 (code, ledger) 编码出不同的账户 id——
// 若实现把 ledger 传错（例如买入腿误用卖出币 ledger），断言里期望的账户 id 会对不上，能
// 真的抓到跨 ledger 错误，不只是抓「有没有传某个 ledger 参数」。
const acct = (code: number, ledger: number): bigint => BigInt(code) * 100n + BigInt(ledger);

const exchangeRowBase = {
  id: 'uuid-lpx', exchangeNo: 'LPX1', lpId: 'uuid-lp', lpNo: 'LPP1',
  sellAssetId: USDT.id, sellAmount: '20000', sellAsset: USDT,
  buyAssetId: AED.id, buyAmount: '73280', buyAsset: AED,
  prudentialPurpose: 'Liquidity management', status: S.PENDING_APPROVAL, reason: 'r',
  sellFromWalletId: 'w-ops-usdt', buyViaWalletId: 'w-liq-aed', buyToWalletId: 'w-ops-aed',
  approvalNo: 'APR1', traceId: 'trace-1', createdByUserId: 'ADM-TRE',
};

function makeWorkflow(o: Partial<Record<'exchangeRow' | 'buyLegs', any>> = {}) {
  const exchangeRow = o.exchangeRow ?? exchangeRowBase;
  const walletsById: Record<string, any> = {
    'w-ops-usdt': { id: 'w-ops-usdt', address: 'Tops-usdt', iban: null },
    'w-liq-aed': { id: 'w-liq-aed', address: null, iban: 'AE-LIQ' },
    'w-ops-aed': { id: 'w-ops-aed', address: null, iban: 'AE-OPS-AED' },
  };
  const assetsById: Record<string, any> = { [USDT.id]: USDT, [AED.id]: AED };
  const prisma: any = {
    asset: { findUnique: jest.fn(async ({ where }: any) => assetsById[where.id] ?? null) },
    wallet: { findUnique: jest.fn(async ({ where }: any) => walletsById[where.id] ?? null) },
    lpExchange: { findUnique: jest.fn(async () => exchangeRow) },
  };
  const exchanges: any = {
    assertFirmOpsBalance: jest.fn(async () => undefined),
    create: jest.fn(async (input: any) => ({ ...exchangeRow, ...input })),
    findByNo: jest.fn(async () => exchangeRow),
    transition: jest.fn(async (_no: string, to: string, patch: any = {}) => ({ ...exchangeRow, status: to, ...patch })),
    stampApprovalNo: jest.fn(async () => undefined),
  };
  const lpProfiles: any = { assertActiveByNo: jest.fn(async () => undefined), findByNo: jest.fn(async () => profile) };
  const approvals: any = { createAndSubmit: jest.fn(async () => ({ approvalNo: 'APR1' })), cancel: jest.fn(async () => ({})) };
  const accounting: any = {
    resolveTbAccountId: jest.fn(async ({ code, ledger }: any) => acct(code, ledger)),
    executeTransfer: jest.fn(async () => ({ tbTransferId: 1n })),
  };
  const auditLogs: any = { recordByActor: jest.fn(async () => ({})), recordSystem: jest.fn(async () => ({})) };
  const buyLegs = o.buyLegs ?? [{ id: 'fo-2', fundsOrderNo: 'FDO2', legSeq: 2, amount: '73280' }];
  const legsById: Record<string, any> = {
    'fo-1': { id: 'fo-1', fundsOrderNo: 'FDO1', legSeq: 1, amount: '20000', txHash: null, referenceNo: null, createdAt: new Date(), fromWalletId: 'w-ops-usdt', toWalletId: null },
    'fo-2': { id: 'fo-2', fundsOrderNo: 'FDO2', legSeq: 2, amount: '73280', txHash: null, referenceNo: 'BANK-2', createdAt: new Date(), fromWalletId: null, toWalletId: 'w-liq-aed' },
    'fo-3': { id: 'fo-3', fundsOrderNo: 'FDO3', legSeq: 3, amount: '73280', txHash: null, referenceNo: 'BANK-3', createdAt: new Date(), fromWalletId: 'w-liq-aed', toWalletId: 'w-ops-aed' },
  };
  const fundsOrders: any = {
    create: jest.fn(async (input: any) => ({ id: `fo-${input.legSeq}`, fundsOrderNo: `FDO${input.legSeq}`, ...input })),
    findById: jest.fn(async (id: string) => legsById[id] ?? null),
    advance: jest.fn(async () => ({})),
    stampExternalRef: jest.fn(async () => null),
    resolveExternalRef: jest.fn((row: any) => (row.asset?.type === 'CRYPTO' ? row.txHash ?? null : row.referenceNo ?? null)),
    findByParent: jest.fn(async () => buyLegs),
  };
  const systemWallets: any = {
    resolve: jest.fn(async (assetId: string, vault: string) => {
      if (vault === 'F_OPS' && assetId === USDT.id) return walletsById['w-ops-usdt'];
      if (vault === 'F_LIQ') return walletsById['w-liq-aed'];
      return walletsById['w-ops-aed'];
    }),
  };
  const custodianStatement: any = { recordLegMovement: jest.fn(async () => ({ outLineId: 'l1', inLineId: 'l2', cutoffDate: '2026-09-29' })) };
  // 乙波三 T2：NLA 门桩——默认放行，跌破场景用 mockRejectedValueOnce 单次拒绝（同余额闸先例）。
  const prudential: any = { assertPostOutflowCompliant: jest.fn(async () => undefined) };
  const wf = new LpExchangeWorkflowService(prisma, exchanges, lpProfiles, approvals, accounting, auditLogs, fundsOrders, systemWallets, custodianStatement, prudential);
  return { wf, prisma, exchanges, lpProfiles, approvals, accounting, auditLogs, fundsOrders, systemWallets, custodianStatement, exchangeRow, prudential };
}

describe('LpExchangeWorkflowService (Task 5)', () => {
  describe('initiate — birth guards + happy path', () => {
    const dto = { lpNo: 'LPP1', sellAssetId: USDT.id, sellAmount: '20000', buyAssetId: AED.id, buyAmount: '73280', prudentialPurpose: 'Liquidity management', reason: 'Rebalance USDT into AED' };

    it('operating account balance is not enough → 400 (guard comes from the entity); NLA gate never reached — 余额闸独立运行', async () => {
      const { wf, exchanges, prudential } = makeWorkflow();
      exchanges.assertFirmOpsBalance.mockRejectedValueOnce(new Error('Insufficient USDT balance in the operating account'));
      await expect(wf.initiate(dto, treasury)).rejects.toThrow(/Insufficient/);
      expect(prudential.assertPostOutflowCompliant).not.toHaveBeenCalled();
    });

    it('NLA gate runs right after the balance check, by the SELL side only (sellAsset currency/sellAmountMinor) — buy side is not credited (未来进项不抵扣)', async () => {
      const { wf, prudential } = makeWorkflow();
      await wf.initiate(dto, treasury);
      expect(prudential.assertPostOutflowCompliant).toHaveBeenCalledWith({
        currency: 'USDT', amountMinor: 20_000_000_000n, orderKind: 'LP_EXCHANGE', counterpartyNo: 'LPP1', actor: treasury,
      });
      // 断言调用参数里没有任何买入边的痕迹（buyAmount/buyAssetId 均不出现在门的入参里）。
      const call = prudential.assertPostOutflowCompliant.mock.calls[0][0];
      expect(Object.keys(call)).toEqual(['currency', 'amountMinor', 'orderKind', 'counterpartyNo', 'actor']);
    });

    it('NLA gate blocks → initiate rejects with the gate\'s own 400, no row created, no wallets resolved, no approval submitted (拒建单)', async () => {
      const { wf, prudential, exchanges, systemWallets, approvals } = makeWorkflow();
      prudential.assertPostOutflowCompliant.mockRejectedValueOnce(
        new BadRequestException('Blocked by prudential floor (Company Rulebook VI.C): this LP exchange would take Net Liquid Assets below the regulatory floor — NLA now 1500000.00 AED, after 1100000.00 AED, floor 1200000.00 AED.'),
      );
      await expect(wf.initiate(dto, treasury)).rejects.toThrow(/Blocked by prudential floor/);
      expect(systemWallets.resolve).not.toHaveBeenCalled();
      expect(approvals.createAndSubmit).not.toHaveBeenCalled();
      expect(exchanges.create).not.toHaveBeenCalled();
    });

    it('happy path: resolves 3 wallets (F_OPS sell / F_LIQ buy / F_OPS buy), creates the row, submits to CFO approval, audit REQUESTED, snapshot has zero UUIDs', async () => {
      const { wf, exchanges, approvals, auditLogs, systemWallets } = makeWorkflow();
      const r = await wf.initiate(dto, treasury);
      expect(r).toEqual({ exchangeNo: 'LPX1', approvalNo: 'APR1', status: 'PENDING_APPROVAL' });
      expect(exchanges.assertFirmOpsBalance).toHaveBeenCalledWith('USDT', 20_000_000_000n);
      expect(systemWallets.resolve).toHaveBeenCalledWith(USDT.id, 'F_OPS');
      expect(systemWallets.resolve).toHaveBeenCalledWith(AED.id, 'F_LIQ');
      expect(systemWallets.resolve).toHaveBeenCalledWith(AED.id, 'F_OPS');
      expect(exchanges.create).toHaveBeenCalledWith(expect.objectContaining({ lpNo: 'LPP1', sellFromWalletId: 'w-ops-usdt', buyViaWalletId: 'w-liq-aed', buyToWalletId: 'w-ops-aed' }));
      expect(exchanges.stampApprovalNo).toHaveBeenCalledWith('LPX1', 'APR1');
      const snapshot = approvals.createAndSubmit.mock.calls[0][0];
      expect(snapshot.actionType).toBe('LP_EXCHANGE_APPROVAL');
      expect(snapshot.entityRef).toBe('LPX1');
      expect(JSON.stringify(snapshot.objectSnapshot)).not.toMatch(/uuid-|w-ops|w-liq/);
      expect(snapshot.objectSnapshot.lpName).toBe('Acme LP');
      expect(snapshot.objectSnapshot.sell).toBe('20000.000000 USDT');
      expect(snapshot.objectSnapshot.buy).toBe('73280.00 AED');
      const audit = auditLogs.recordByActor.mock.calls[0][0];
      expect(audit).toMatchObject({ action: 'LP_EXCHANGE_REQUESTED', actionDomain: 'TREASURY', primarySubjectNo: 'LPX1', amount: '20000.000000', approvalNo: 'APR1' });
      expect(audit.requestId).toMatch(/^LP_EXCHANGE_REQUESTED_LPX1_/);
      expect(audit.correlationId).toBeUndefined(); // REQUESTED 起旅程，不显式传 correlationId
      expect(audit.subjects).toEqual(expect.arrayContaining([
        expect.objectContaining({ subjectType: 'LP_EXCHANGE', subjectNo: 'LPX1', subjectRole: 'PRIMARY' }),
        expect.objectContaining({ subjectType: 'LIQUIDITY_PROVIDER', subjectNo: 'LPP1', subjectRole: 'RELATED' }),
      ]));
    });
  });

  describe('onDecided', () => {
    const decided = (decision: any) => ({ decision, actionType: 'LP_EXCHANGE_APPROVAL', entityRef: 'LPX1', approvalId: 'uuid-apr', approvalNo: 'APR1', traceId: 'trace-1', workflowType: 'LP_EXCHANGE', metadata: {} });

    it('rejected → REJECTED + audit carries fromStatus/toStatus + approval causation + explicit requestId', async () => {
      const { wf, exchanges, auditLogs } = makeWorkflow();
      await wf.onDecided(decided('DECLINED') as any);
      expect(exchanges.transition).toHaveBeenCalledWith('LPX1', 'REJECTED', expect.anything());
      const audit = auditLogs.recordSystem.mock.calls[0][0];
      expect(audit).toMatchObject({ action: 'LP_EXCHANGE_REJECTED', approvalNo: 'APR1', causationId: 'uuid-apr', fromStatus: 'PENDING_APPROVAL', toStatus: 'REJECTED' });
      expect(audit.requestId).toMatch(/^LP_EXCHANGE_REJECTED_LPX1_/);
    });

    it('a cancellation decision is not handled here (cancel() closes its own loop)', async () => {
      const { wf, exchanges } = makeWorkflow();
      await wf.onDecided(decided('CANCELLED') as any);
      expect(exchanges.transition).not.toHaveBeenCalled();
    });

    it('approved but operating account balance is not enough → FAILED(INSUFFICIENT_FIRM_BALANCE), no funds order created, audit carries reasonCode + explicit requestId', async () => {
      const { wf, exchanges, fundsOrders, auditLogs } = makeWorkflow();
      exchanges.assertFirmOpsBalance.mockRejectedValueOnce(new Error('Insufficient USDT balance in the operating account'));
      await wf.onDecided(decided('APPROVED') as any);
      expect(exchanges.transition).toHaveBeenCalledWith('LPX1', 'FAILED', expect.objectContaining({ failureReasonCode: 'INSUFFICIENT_FIRM_BALANCE' }));
      expect(fundsOrders.create).not.toHaveBeenCalled();
      const audit = auditLogs.recordSystem.mock.calls[0][0];
      expect(audit).toMatchObject({ action: 'LP_EXCHANGE_FAILED', outcome: 'FAILED', reasonCode: 'INSUFFICIENT_FIRM_BALANCE', approvalNo: 'APR1', causationId: 'uuid-apr', fromStatus: 'PENDING_APPROVAL', toStatus: 'FAILED' });
      expect(audit.requestId).toMatch(/^LP_EXCHANGE_FAILED_LPX1_/);
    });

    it('approved → creates sell leg 1 (F_OPS → LP crypto address, CREATED) → EXECUTING + audit EXECUTION_STARTED carries fromStatus/toStatus + approvalNo+causationId + explicit requestId', async () => {
      const { wf, exchanges, fundsOrders, auditLogs } = makeWorkflow();
      await wf.onDecided(decided('APPROVED') as any);
      expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({
        lpExchangeId: 'uuid-lpx', legSeq: 1, initialStatus: 'CREATED', assetId: USDT.id, amount: '20000',
        fromWalletId: 'w-ops-usdt', fromAddress: 'Tops-usdt', toWalletId: null, toAddress: 'TLP-ADDR', toIban: null,
      }));
      expect(exchanges.transition).toHaveBeenCalledWith('LPX1', 'EXECUTING', expect.objectContaining({ executedAt: expect.any(Date) }));
      const audit = auditLogs.recordSystem.mock.calls[0][0];
      expect(audit).toMatchObject({ action: 'LP_EXCHANGE_EXECUTION_STARTED', approvalNo: 'APR1', causationId: 'uuid-apr', fromStatus: 'PENDING_APPROVAL', toStatus: 'EXECUTING' });
      expect(audit.requestId).toMatch(/^LP_EXCHANGE_EXECUTION_STARTED_LPX1_/);
    });
  });

  describe('handleFundsOrderChanged — sell leg 1', () => {
    const executing = { ...exchangeRowBase, status: S.EXECUTING };
    const evt = (legSeq: number, newStatus: string) => ({ fundsOrderId: 'fo-1', fundsOrderNo: 'FDO1', parent: { lpExchangeId: 'uuid-lpx' }, legSeq, attempt: 1, oldStatus: null, newStatus });

    it('an event that is not for an LP exchange leg is ignored outright', async () => {
      const { wf, custodianStatement } = makeWorkflow();
      await wf.handleFundsOrderChanged({ ...evt(1, 'SUBMITTED'), parent: { internalTransferId: 'x' } } as any);
      expect(custodianStatement.recordLegMovement).not.toHaveBeenCalled();
    });

    it('SUBMITTED: mints the reference (crypto txHash), then writes one custodian line (toWalletId null — LP external address is not our wallet)', async () => {
      const { wf, fundsOrders, custodianStatement } = makeWorkflow({ exchangeRow: executing });
      fundsOrders.stampExternalRef.mockResolvedValueOnce({ txHash: `0x${'ab'.repeat(32)}` });
      await wf.handleFundsOrderChanged(evt(1, 'SUBMITTED') as any);
      expect(fundsOrders.stampExternalRef).toHaveBeenCalledWith('fo-1');
      expect(custodianStatement.recordLegMovement).toHaveBeenCalledWith(expect.objectContaining({
        fundsOrderNo: 'FDO1', fromWalletId: 'w-ops-usdt', toWalletId: null, assetCode: 'USDT-TRON', assetType: 'CRYPTO', amountMinor: 20_000_000_000n,
      }));
    });

    it('CONFIRMED: posts 84 with the SELL-side ledger (跨 ledger 是本任务要害) — DR E.FIRM_OPS / CR A.FIRM_ASSET, external-crossing → CLEAR → AWAITING_DELIVERY + audit PAY_LEG_POSTED carries fromStatus/toStatus + explicit requestId', async () => {
      const { wf, accounting, fundsOrders, exchanges, auditLogs } = makeWorkflow({ exchangeRow: executing });
      await wf.handleFundsOrderChanged(evt(1, 'CONFIRMED') as any);
      expect(accounting.executeTransfer).toHaveBeenCalledTimes(1);
      expect(accounting.executeTransfer.mock.calls[0][0]).toMatchObject({
        code: TB_TRANSFER_CODES.LP_EXCHANGE_PAY, amount: 20_000_000_000n, ledger: TB_LEDGERS.USDT,
        debitAccountId: acct(TB_ACCOUNT_CODES.FIRM_OPS, TB_LEDGERS.USDT), creditAccountId: acct(TB_ACCOUNT_CODES.FIRM_ASSET, TB_LEDGERS.USDT),
        evidence: expect.objectContaining({
          sourceType: 'LP_EXCHANGE', sourceNo: 'LPX1', eventCode: 'LP_EXCHANGE_PAY',
          debitCode: 'E.FIRM_OPS', creditCode: 'A.FIRM_ASSET',
          debitWalletRef: 'w-ops-usdt', creditWalletRef: 'w-ops-usdt', isExternalCrossing: true, assetCurrency: 'USDT',
        }),
      });
      expect(fundsOrders.advance).toHaveBeenCalledWith('fo-1', 'CLEAR', 'LP_EXCHANGE_WORKFLOW');
      expect(exchanges.transition).toHaveBeenCalledWith('LPX1', 'AWAITING_DELIVERY');
      const audit = auditLogs.recordSystem.mock.calls[0][0];
      expect(audit).toMatchObject({ action: 'LP_EXCHANGE_PAY_LEG_POSTED', amount: '20000.000000', fromStatus: 'EXECUTING', toStatus: 'AWAITING_DELIVERY' });
      expect(audit.requestId).toMatch(/^LP_EXCHANGE_PAY_LEG_POSTED_LPX1_/);
    });

    it('posting throws → audit FAILED(POSTING_FAILED) with explicit requestId, not cleared, no transition, no retry', async () => {
      const { wf, accounting, fundsOrders, exchanges, auditLogs } = makeWorkflow({ exchangeRow: executing });
      accounting.executeTransfer.mockRejectedValueOnce(new Error('TB down'));
      await wf.handleFundsOrderChanged(evt(1, 'CONFIRMED') as any);
      expect(fundsOrders.advance).not.toHaveBeenCalled();
      expect(exchanges.transition).not.toHaveBeenCalled();
      const audit = auditLogs.recordSystem.mock.calls[0][0];
      expect(audit).toMatchObject({ action: 'LP_EXCHANGE_FAILED', reasonCode: 'POSTING_FAILED', outcome: 'FAILED' });
      expect(audit.requestId).toMatch(/^LP_EXCHANGE_FAILED_LPX1_/);
    });

    it('FAILED: sell leg fails → order FAILED(LEG_FAILED), no funds paid to the LP', async () => {
      const { wf, exchanges, auditLogs } = makeWorkflow({ exchangeRow: executing });
      await wf.handleFundsOrderChanged(evt(1, 'FAILED') as any);
      expect(exchanges.transition).toHaveBeenCalledWith('LPX1', 'FAILED', expect.objectContaining({ failureReasonCode: 'LEG_FAILED', failureNote: expect.stringContaining('no funds paid out') }));
      expect(auditLogs.recordSystem.mock.calls[0][0]).toMatchObject({ action: 'LP_EXCHANGE_FAILED', reasonCode: 'LEG_FAILED', fromStatus: 'EXECUTING', toStatus: 'FAILED' });
    });
  });

  describe('simulateDelivery (⚡ buy leg 2 — front desk)', () => {
    const awaitingDelivery = { ...exchangeRowBase, status: S.AWAITING_DELIVERY };

    it('guard: not awaiting delivery → 400', async () => {
      const { wf } = makeWorkflow({ exchangeRow: { ...exchangeRowBase, status: S.EXECUTING } });
      await expect(wf.simulateDelivery('LPX1', treasury)).rejects.toThrow(/not awaiting delivery/);
    });

    it('creates leg 2 born CONFIRMED (buy asset FIAT → fromIban = LP iban, toIban/toWalletId = our F_LIQ wallet), records the F_LIQ custodian line BEFORE posting 85 (评审 R12：回单先于落账，否则 bumpClosing 兜底基准双计), then CLEARs, DELIVERED + audit DELIVERED with explicit requestId', async () => {
      const { wf, fundsOrders, accounting, custodianStatement, exchanges, auditLogs } = makeWorkflow({ exchangeRow: awaitingDelivery });
      const r = await wf.simulateDelivery('LPX1', treasury);
      expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({
        lpExchangeId: 'uuid-lpx', legSeq: 2, initialStatus: 'CONFIRMED', assetId: AED.id, amount: '73280',
        fromWalletId: null, fromIban: 'AE-LP-IBAN', fromAddress: null,
        toWalletId: 'w-liq-aed', toIban: 'AE-LIQ', toAddress: null,
      }));
      expect(accounting.executeTransfer).toHaveBeenCalledTimes(1);
      expect(accounting.executeTransfer.mock.calls[0][0]).toMatchObject({
        code: TB_TRANSFER_CODES.LP_EXCHANGE_RECEIVE, amount: 7_328_000n, ledger: TB_LEDGERS.AED,
        debitAccountId: acct(TB_ACCOUNT_CODES.FIRM_ASSET, TB_LEDGERS.AED), creditAccountId: acct(TB_ACCOUNT_CODES.FIRM_LIQ, TB_LEDGERS.AED),
        evidence: expect.objectContaining({ eventCode: 'LP_EXCHANGE_RECEIVE', debitCode: 'A.FIRM_ASSET', creditCode: 'E.FIRM_LIQ', debitWalletRef: 'w-liq-aed', creditWalletRef: 'w-liq-aed', isExternalCrossing: true, assetCurrency: 'AED' }),
      });
      expect(fundsOrders.advance).toHaveBeenCalledWith('fo-2', 'CLEAR', 'LP_EXCHANGE_WORKFLOW');
      expect(custodianStatement.recordLegMovement).toHaveBeenCalledWith(expect.objectContaining({ fundsOrderNo: 'FDO2', fromWalletId: null, toWalletId: 'w-liq-aed', assetCode: 'AED', assetType: 'FIAT', amountMinor: 7_328_000n }));
      // 评审 Imp#1/R12：回单必须先于落账（invocationCallOrder 越小越早发生）。
      expect(custodianStatement.recordLegMovement.mock.invocationCallOrder[0]).toBeLessThan(accounting.executeTransfer.mock.invocationCallOrder[0]);
      expect(exchanges.transition).toHaveBeenCalledWith('LPX1', 'DELIVERED', expect.objectContaining({ deliveredAt: expect.any(Date) }));
      const audit = auditLogs.recordByActor.mock.calls[0][0];
      // 信封 amount 字段恒填卖出边（brief §Step8）；买入边落 metadata.buyLegAmount。
      expect(audit).toMatchObject({ action: 'LP_EXCHANGE_DELIVERED', amount: '20000.000000', fromStatus: 'AWAITING_DELIVERY', toStatus: 'DELIVERED' });
      expect(audit.metadata).toMatchObject({ buyLegAmount: '73280.00' });
      expect(audit.requestId).toMatch(/^LP_EXCHANGE_DELIVERED_LPX1_/);
      expect(r.status).toBe('DELIVERED');
    });
  });

  describe('accept (leg 3 — F_LIQ → F_OPS, R13: external-crossing + two-sided custodian lines)', () => {
    const delivered = { ...exchangeRowBase, status: S.DELIVERED };

    it('not yet delivered → 400 (still awaiting delivery)', async () => {
      const { wf } = makeWorkflow({ exchangeRow: { ...exchangeRowBase, status: S.AWAITING_DELIVERY } });
      await expect(wf.accept('LPX1', treasury)).rejects.toThrow(/not delivered yet/);
    });

    it('double accept → 400 (already SUCCESS, transitions table has zero out-edges)', async () => {
      const { wf } = makeWorkflow({ exchangeRow: { ...exchangeRowBase, status: S.SUCCESS } });
      await expect(wf.accept('LPX1', treasury)).rejects.toThrow(/not delivered yet/);
    });

    it('creates leg 3 (F_LIQ → F_OPS, both our own wallets, address/iban filled both sides), records BOTH custodian lines BEFORE posting 86 (评审 R13：内转也要两侧过对账，isExternalCrossing=true), CLEARs, SUCCESS + audit ACCEPTED with expected/received + explicit requestId + LP name mirrored', async () => {
      const { wf, fundsOrders, accounting, custodianStatement, exchanges, auditLogs } = makeWorkflow({ exchangeRow: delivered });
      const r = await wf.accept('LPX1', treasury);
      expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({
        lpExchangeId: 'uuid-lpx', legSeq: 3, initialStatus: 'CONFIRMED', assetId: AED.id, amount: '73280',
        fromWalletId: 'w-liq-aed', fromIban: 'AE-LIQ', fromAddress: null,
        toWalletId: 'w-ops-aed', toIban: 'AE-OPS-AED', toAddress: null,
      }));
      expect(accounting.executeTransfer.mock.calls[0][0]).toMatchObject({
        code: TB_TRANSFER_CODES.LP_EXCHANGE_ACCEPT, amount: 7_328_000n, ledger: TB_LEDGERS.AED,
        debitAccountId: acct(TB_ACCOUNT_CODES.FIRM_LIQ, TB_LEDGERS.AED), creditAccountId: acct(TB_ACCOUNT_CODES.FIRM_OPS, TB_LEDGERS.AED),
        evidence: expect.objectContaining({ eventCode: 'LP_EXCHANGE_ACCEPT', debitCode: 'E.FIRM_LIQ', creditCode: 'E.FIRM_OPS', debitWalletRef: 'w-liq-aed', creditWalletRef: 'w-ops-aed', isExternalCrossing: true }),
      });
      expect(custodianStatement.recordLegMovement).toHaveBeenCalledWith(expect.objectContaining({
        fundsOrderNo: 'FDO3', fromWalletId: 'w-liq-aed', toWalletId: 'w-ops-aed', assetCode: 'AED', assetType: 'FIAT', amountMinor: 7_328_000n,
      }));
      // 评审 Imp#2/R12/R13：回单必须先于落账。
      expect(custodianStatement.recordLegMovement.mock.invocationCallOrder[0]).toBeLessThan(accounting.executeTransfer.mock.invocationCallOrder[0]);
      expect(fundsOrders.advance).toHaveBeenCalledWith('fo-3', 'CLEAR', 'LP_EXCHANGE_WORKFLOW');
      expect(exchanges.transition).toHaveBeenCalledWith('LPX1', 'SUCCESS', expect.objectContaining({ settledAt: expect.any(Date) }));
      const audit = auditLogs.recordByActor.mock.calls[0][0];
      // 信封 amount 字段恒填卖出边（brief §Step8）；验收两数（expected/received）落 metadata；LP 名镜像（spec §7）。
      expect(audit).toMatchObject({ action: 'LP_EXCHANGE_ACCEPTED', amount: '20000.000000', fromStatus: 'DELIVERED', toStatus: 'SUCCESS' });
      expect(audit.metadata).toMatchObject({ expected: '73280.00', received: '73280.00', lpName: 'Acme LP' });
      expect(audit.requestId).toMatch(/^LP_EXCHANGE_ACCEPTED_LPX1_/);
      expect(r.status).toBe('SUCCESS');
    });

    it("received uses leg 2's ACTUAL amount, not the row's buyAmount restated (short delivery: LP sent 73100, row still says 73280)", async () => {
      const { wf, auditLogs } = makeWorkflow({ exchangeRow: delivered, buyLegs: [{ id: 'fo-2', fundsOrderNo: 'FDO2', legSeq: 2, amount: '73100' }] });
      await wf.accept('LPX1', treasury);
      const audit = auditLogs.recordByActor.mock.calls[0][0];
      expect(audit.metadata.expected).toBe('73280.00'); // row.buyAmount，不受实际到货额影响
      expect(audit.metadata.received).toBe('73100.00'); // 腿 2 实际金额，与 expected 不同才证明真的读了腿 2
    });
  });

  describe('cancel', () => {
    it('pending-approval exchanges can be cancelled: cancels the approval first, then flips to CANCELLED + audit', async () => {
      const { wf, approvals, exchanges, auditLogs } = makeWorkflow();
      const r = await wf.cancel('LPX1', { reason: 'Opened by mistake' }, treasury);
      expect(approvals.cancel).toHaveBeenCalledWith('APR1', { reason: 'Opened by mistake' }, treasury);
      expect(exchanges.transition).toHaveBeenCalledWith('LPX1', 'CANCELLED', expect.objectContaining({ failureNote: 'Opened by mistake' }));
      expect(r.status).toBe('CANCELLED');
      const audit = auditLogs.recordByActor.mock.calls[0][0];
      expect(audit).toMatchObject({ action: 'LP_EXCHANGE_CANCELLED', fromStatus: 'PENDING_APPROVAL', toStatus: 'CANCELLED' });
      expect(audit.requestId).toMatch(/^LP_EXCHANGE_CANCELLED_LPX1_/);
    });

    it('cannot cancel while executing', async () => {
      const { wf } = makeWorkflow({ exchangeRow: { ...exchangeRowBase, status: S.EXECUTING } });
      await expect(wf.cancel('LPX1', { reason: 'x' }, treasury)).rejects.toThrow(/cannot be cancelled/);
    });
  });
});
