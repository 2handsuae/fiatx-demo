import { ConflictException } from '@nestjs/common';
import { InternalTransferWorkflowService } from './internal-transfer-workflow.service';
import { InternalTransferStatus as S } from './dto/internal-transfer.dto';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';

const USDT = { id: 'a-usdt', code: 'USDT-TRON', currency: 'USDT', decimals: 6, type: 'CRYPTO' };
const AED = { id: 'a-aed', code: 'AED', currency: 'AED', decimals: 2, type: 'FIAT' };
const treasury = { actorType: 'ADMIN' as const, userId: 'uuid-tre', userNo: 'ADM-TRE', roleCodes: ['TREASURY_OFFICER'] };

function makeWorkflow(o: Partial<Record<'adjustment' | 'asset' | 'wallet' | 'disposition' | 'transferRow', any>> = {}) {
  const adjustment = o.adjustment ?? { adjustmentNo: 'ADJ1', status: 'POSTED', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', book: 'CLIENT', ownerId: 'uuid-cu', ownerNo: 'CU1', walletRef: 'w-cust', assetCode: 'USDT-TRON', amount: '7500000', caseNo: 'REC1', traceId: 'trace-1' };
  const asset = o.asset ?? USDT;
  const transferRow = o.transferRow ?? { id: 'uuid-itr', transferNo: 'ITR1', purpose: 'CLIENT_COMPENSATION', status: S.PENDING_APPROVAL, amount: '7.5', assetId: asset.id, asset, fromWalletId: 'w-ops', viaWalletId: asset.type === 'FIAT' ? 'w-set' : null, toWalletId: 'w-cust', customerId: 'uuid-cu', customerNo: 'CU1', reason: 'r', sourceCaseNo: 'REC1', sourceAdjustmentNo: 'ADJ1', sourceExternalLineId: null, traceId: 'trace-1', approvalNo: 'APR1' };
  const walletsById: Record<string, any> = {
    'w-ops': { id: 'w-ops', ownerId: null, address: 'Tops', iban: 'AE-OPS', walletNo: 'WA-OPS' },
    'w-set': { id: 'w-set', ownerId: null, address: null, iban: 'AE-SET', walletNo: 'WA-SET' },
    'w-cust': { id: 'w-cust', ownerId: 'uuid-cu', address: 'Tcust', iban: 'AE-CUST', walletNo: 'WA-CUST' },
  };
  const prisma: any = {
    reconciliationAdjustment: { findUnique: jest.fn(async () => adjustment) },
    reconciliationDisposition: { findFirst: jest.fn(async () => o.disposition ?? null) },
    asset: { findUnique: jest.fn(async () => asset) },
    wallet: { findUnique: jest.fn(async ({ where }: any) => walletsById[where.id] ?? null) },
    internalTransfer: { update: jest.fn(async () => transferRow), findUnique: jest.fn(async () => transferRow) },
    fundsOrder: { update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })) },
  };
  const transfers: any = {
    findBlockingBySource: jest.fn(async () => null),
    assertFirmOpsBalance: jest.fn(async () => undefined),
    create: jest.fn(async (input: any) => ({ ...transferRow, ...input, amount: input.amountMajor })),
    findByNo: jest.fn(async () => transferRow),
    transition: jest.fn(async (_no: string, to: string, patch: any) => ({ ...transferRow, status: to, ...patch })),
  };
  const approvals: any = { createAndSubmit: jest.fn(async () => ({ approvalNo: 'APR1' })), cancel: jest.fn(async () => ({})) };
  const accounting: any = {
    getCustomerAvailableBalance: jest.fn(async () => ({ available: 30_000n, held: 0n, total: 30_000n })),
    resolveTbAccountId: jest.fn(async ({ code }: any) => BigInt(code)),
    executeTransfer: jest.fn(async () => ({ tbTransferId: 1n })),
  };
  const auditLogs: any = { recordByActor: jest.fn(async () => ({})), recordSystem: jest.fn(async () => ({})) };
  const fundsOrders: any = {
    create: jest.fn(async (input: any) => ({ id: `fo-${input.legSeq}`, fundsOrderNo: `FO${input.legSeq}`, ...input })),
    findById: jest.fn(async (id: string) => ({ id, fundsOrderNo: id === 'fo-1' ? 'FO1' : 'FO2', legSeq: id === 'fo-1' ? 1 : 2, amount: '7.5', txHash: null, referenceNo: null, createdAt: new Date(), fromWalletId: id === 'fo-1' ? 'w-ops' : 'w-set', toWalletId: id === 'fo-1' && asset.type === 'FIAT' ? 'w-set' : 'w-cust' })),
    advance: jest.fn(async () => ({})),
    resolveExternalRef: jest.fn((row: any) => (row.asset?.type === 'CRYPTO' ? row.txHash ?? null : row.referenceNo ?? null)),
  };
  const systemWallets: any = { resolve: jest.fn(async (_assetId: string, vault: string) => (vault === 'F_OPS' ? walletsById['w-ops'] : walletsById['w-set'])) };
  const supplementEvidence: any = { assertClaimable: jest.fn(async () => ({ externalLineId: 'line-1', caseNo: 'REC2', walletId: 'w-cust', ownerId: 'uuid-cu', ownerNo: 'CU1', assetId: 'a-aed', currency: 'AED', assetType: 'FIAT', decimals: 2, amountMinor: '120000', amountMajor: '1200.00', externalRef: 'BANK-CLAW', businessDate: '2026-09-05' })) };
  const custodianStatement: any = { recordLegMovement: jest.fn(async () => ({ outLineId: 'l1', inLineId: 'l2', cutoffDate: '2026-09-05' })) };
  const wf = new InternalTransferWorkflowService(prisma, transfers, approvals, accounting, auditLogs, fundsOrders, systemWallets, supplementEvidence, custodianStatement);
  return { wf, prisma, transfers, approvals, accounting, auditLogs, fundsOrders, systemWallets, supplementEvidence, custodianStatement, transferRow };
}

describe('InternalTransferWorkflowService（平账二期 Task 7）', () => {
  describe('initiateCompensation —— 出生守卫', () => {
    it('认损单未落账 → 400', async () => {
      const { wf } = makeWorkflow({ adjustment: { adjustmentNo: 'ADJ1', status: 'PENDING_APPROVAL', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', book: 'CLIENT' } });
      await expect(wf.initiateCompensation({ adjustmentNo: 'ADJ1', reason: 'r' }, treasury)).rejects.toThrow(/还没落账/);
    });
    it('不是客户池认损单 → 400', async () => {
      const { wf } = makeWorkflow({ adjustment: { adjustmentNo: 'ADJ1', status: 'POSTED', reasonCode: 'UNEXPLAINED_WRITE_OFF', book: 'FIRM' } });
      await expect(wf.initiateCompensation({ adjustmentNo: 'ADJ1', reason: 'r' }, treasury)).rejects.toThrow(/不是客户池认损单/);
    });
    it('同一认损单已有未走完 / 已成功的划转单 → 409', async () => {
      const { wf, transfers } = makeWorkflow();
      transfers.findBlockingBySource.mockResolvedValueOnce({ transferNo: 'ITR0', status: 'SUCCESS' });
      await expect(wf.initiateCompensation({ adjustmentNo: 'ADJ1', reason: 'r' }, treasury)).rejects.toBeInstanceOf(ConflictException);
    });
    it('运营户余额不够 → 400（守卫来自主体）', async () => {
      const { wf, transfers } = makeWorkflow();
      transfers.assertFirmOpsBalance.mockRejectedValueOnce(new Error('运营户 USDT 余额不足'));
      await expect(wf.initiateCompensation({ adjustmentNo: 'ADJ1', reason: 'r' }, treasury)).rejects.toThrow(/余额不足/);
    });
    it('正路径：加密币一腿（无中转）、金额 = 认损额、送 CFO 审批、审计 REQUESTED、快照零 UUID', async () => {
      const { wf, transfers, approvals, auditLogs } = makeWorkflow();
      const r = await wf.initiateCompensation({ adjustmentNo: 'ADJ1', reason: '认赔' }, treasury);
      expect(r).toEqual({ transferNo: 'ITR1', approvalNo: 'APR1', status: 'PENDING_APPROVAL' });
      expect(transfers.create).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'CLIENT_COMPENSATION', amountMajor: '7.500000', fromWalletId: 'w-ops', viaWalletId: null, toWalletId: 'w-cust', customerNo: 'CU1', sourceAdjustmentNo: 'ADJ1', sourceCaseNo: 'REC1' }));
      const snapshot = approvals.createAndSubmit.mock.calls[0][0];
      expect(snapshot.actionType).toBe('INTERNAL_TRANSFER_APPROVAL');
      expect(snapshot.entityRef).toBe('ITR1');
      expect(JSON.stringify(snapshot.objectSnapshot)).not.toMatch(/uuid-|w-ops|w-cust/);
      expect(snapshot.objectSnapshot.impact).toContain('补款 7.500000 USDT');
      expect(auditLogs.recordByActor.mock.calls[0][0]).toMatchObject({ action: 'INTERNAL_TRANSFER_REQUESTED', actionDomain: 'TREASURY', primarySubjectNo: 'ITR1', amount: '7.500000' });
      expect(auditLogs.recordByActor.mock.calls[0][0].requestId).toMatch(/^INTERNAL_TRANSFER_REQUESTED_ITR1_/);
    });
  });

  describe('initiateAdvance', () => {
    const disposition = { dispositionNo: 'RCD1', outlet: 'SUPPLEMENT', deferredTarget: 'SUPPLEMENT_BOUNCE', supplementNo: null };
    it('可用余额够扣 → 400 不需要垫款', async () => {
      const { wf, accounting } = makeWorkflow({ disposition, asset: AED });
      accounting.getCustomerAvailableBalance.mockResolvedValueOnce({ available: 120_000n, held: 0n, total: 120_000n });
      await expect(wf.initiateAdvance({ caseNo: 'REC2', externalLineId: 'line-1', reason: 'r' }, treasury)).rejects.toThrow(/不需要垫款/);
    });
    it('未定性为退汇 → 400', async () => {
      const { wf } = makeWorkflow({ disposition: { ...disposition, deferredTarget: 'SUPPLEMENT_DEPOSIT' }, asset: AED });
      await expect(wf.initiateAdvance({ caseNo: 'REC2', externalLineId: 'line-1', reason: 'r' }, treasury)).rejects.toThrow(/入金被退汇/);
    });
    it('正路径：法币两腿（经结算户）、金额 = 退汇 1200 − 可用 300 = 900', async () => {
      const { wf, transfers, approvals } = makeWorkflow({ disposition, asset: AED });
      const r = await wf.initiateAdvance({ caseNo: 'REC2', externalLineId: 'line-1', reason: '垫' }, treasury);
      expect(r.status).toBe('PENDING_APPROVAL');
      expect(transfers.assertFirmOpsBalance).toHaveBeenCalledWith('AED', 90_000n);
      expect(transfers.create).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'CLIENT_ADVANCE', amountMajor: '900.00', fromWalletId: 'w-ops', viaWalletId: 'w-set', toWalletId: 'w-cust', sourceExternalLineId: 'line-1', sourceCaseNo: 'REC2' }));
      expect(approvals.createAndSubmit.mock.calls[0][0].objectSnapshot.impact).toContain('垫付 900.00 AED');
    });
  });

  describe('onDecided', () => {
    const decided = (decision: any) => ({ decision, actionType: 'INTERNAL_TRANSFER_APPROVAL', entityRef: 'ITR1', approvalId: 'uuid-apr', approvalNo: 'APR1', traceId: 'trace-1', workflowType: 'INTERNAL_TRANSFER', metadata: {} });
    it('拒绝 → REJECTED + 审计带审批因果', async () => {
      const { wf, transfers, auditLogs } = makeWorkflow();
      await wf.onDecided(decided('DECLINED') as any);
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'REJECTED', expect.anything());
      expect(auditLogs.recordSystem.mock.calls[0][0]).toMatchObject({ action: 'INTERNAL_TRANSFER_REJECTED', approvalNo: 'APR1', causationId: 'uuid-apr' });
    });
    it('撤回裁决不处理（撤回由 cancel() 自己收口）', async () => {
      const { wf, transfers } = makeWorkflow();
      await wf.onDecided(decided('CANCELLED') as any);
      expect(transfers.transition).not.toHaveBeenCalled();
    });
    it('批准但运营户余额不够 → FAILED(INSUFFICIENT_FIRM_BALANCE)，不建资金单', async () => {
      const { wf, transfers, fundsOrders } = makeWorkflow();
      transfers.assertFirmOpsBalance.mockRejectedValueOnce(new Error('运营户 USDT 余额不足'));
      await wf.onDecided(decided('APPROVED') as any);
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'FAILED', expect.objectContaining({ failureReasonCode: 'INSUFFICIENT_FIRM_BALANCE' }));
      expect(fundsOrders.create).not.toHaveBeenCalled();
    });
    it('批准 → 建腿 1（加密币：运营户 → 客户）→ EXECUTING + 审计 EXECUTION_STARTED', async () => {
      const { wf, transfers, fundsOrders, auditLogs } = makeWorkflow();
      await wf.onDecided(decided('APPROVED') as any);
      expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ internalTransferId: 'uuid-itr', legSeq: 1, initialStatus: 'CREATED', amount: '7.5', fromWalletId: 'w-ops', toWalletId: 'w-cust', fromAddress: 'Tops', toAddress: 'Tcust' }));
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'EXECUTING', expect.objectContaining({ executedAt: expect.any(Date) }));
      expect(auditLogs.recordSystem.mock.calls[0][0]).toMatchObject({ action: 'INTERNAL_TRANSFER_EXECUTION_STARTED', approvalNo: 'APR1', causationId: 'uuid-apr' });
    });
    it('批准 → 法币腿 1 是 运营户 → 结算户', async () => {
      const { wf, fundsOrders } = makeWorkflow({ asset: AED });
      await wf.onDecided(decided('APPROVED') as any);
      expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ legSeq: 1, fromWalletId: 'w-ops', toWalletId: 'w-set', fromIban: 'AE-OPS', toIban: 'AE-SET' }));
    });
  });

  describe('handleFundsOrderChanged', () => {
    const executing = (asset: any) => ({ id: 'uuid-itr', transferNo: 'ITR1', purpose: 'CLIENT_COMPENSATION', status: S.EXECUTING, amount: '7.5', assetId: asset.id, asset, fromWalletId: 'w-ops', viaWalletId: asset.type === 'FIAT' ? 'w-set' : null, toWalletId: 'w-cust', customerId: 'uuid-cu', customerNo: 'CU1', reason: 'r', sourceCaseNo: 'REC1', sourceAdjustmentNo: 'ADJ1', sourceExternalLineId: null, traceId: 'trace-1', approvalNo: 'APR1' });
    const evt = (legSeq: number, newStatus: string) => ({ fundsOrderId: `fo-${legSeq}`, fundsOrderNo: `FO${legSeq}`, parent: { internalTransferId: 'uuid-itr' }, legSeq, attempt: 1, oldStatus: null, newStatus });

    it('不是划转腿的事件直接忽略', async () => {
      const { wf, custodianStatement } = makeWorkflow();
      await wf.handleFundsOrderChanged({ ...evt(1, 'SUBMITTED'), parent: { withdrawTransactionId: 'w' } } as any);
      expect(custodianStatement.recordLegMovement).not.toHaveBeenCalled();
    });
    it('SUBMITTED：提交那一步就铸参考号（加密币 txHash），随后模拟托管方写两行', async () => {
      const { wf, prisma, custodianStatement } = makeWorkflow({ transferRow: executing(USDT) });
      await wf.handleFundsOrderChanged(evt(1, 'SUBMITTED') as any);
      expect(prisma.fundsOrder.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'fo-1' }, data: { txHash: expect.stringMatching(/^0x/) } }));
      expect(custodianStatement.recordLegMovement).toHaveBeenCalledWith(expect.objectContaining({ fundsOrderNo: 'FO1', fromWalletId: 'w-ops', toWalletId: 'w-cust', assetCode: 'USDT-TRON', assetType: 'CRYPTO', amountMinor: 7_500_000n, externalRef: expect.stringMatching(/^0x/) }));
    });
    it('CONFIRMED · 法币腿 1：借运营户 / 贷结算户（81）→ 清算 → 建腿 2（结算户 → 客户）', async () => {
      const row = { ...executing(AED), amount: '900' };
      const { wf, accounting, fundsOrders, transfers } = makeWorkflow({ transferRow: row, asset: AED });
      fundsOrders.findById.mockResolvedValueOnce({ id: 'fo-1', fundsOrderNo: 'FO1', legSeq: 1, amount: '900', txHash: null, referenceNo: 'BANK-1', createdAt: new Date(), fromWalletId: 'w-ops', toWalletId: 'w-set' });
      await wf.handleFundsOrderChanged(evt(1, 'CONFIRMED') as any);
      expect(accounting.executeTransfer).toHaveBeenCalledTimes(1);
      expect(accounting.executeTransfer.mock.calls[0][0]).toMatchObject({ code: TB_TRANSFER_CODES.INTERNAL_TRANSFER_OPS_TO_SET, amount: 90_000n, evidence: expect.objectContaining({ sourceType: 'INTERNAL_TRANSFER', sourceNo: 'ITR1', eventCode: 'INTERNAL_TRANSFER_OPS_TO_SET', debitWalletRef: 'w-ops', creditWalletRef: 'w-set', isExternalCrossing: true, externalRef: 'BANK-1', assetCurrency: 'AED' }) });
      expect(fundsOrders.advance).toHaveBeenCalledWith('fo-1', 'CLEAR', 'INTERNAL_TRANSFER_WORKFLOW');
      expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ legSeq: 2, fromWalletId: 'w-set', toWalletId: 'w-cust' }));
      expect(transfers.transition).not.toHaveBeenCalled();
    });
    it('CONFIRMED · 最后一腿（加密币腿 1）：公司放出（82）+ 客户收到（83，事件码按用途）→ SUCCESS + 审计 LEG_POSTED / SETTLED', async () => {
      const { wf, accounting, fundsOrders, transfers, auditLogs } = makeWorkflow({ transferRow: executing(USDT) });
      fundsOrders.findById.mockResolvedValueOnce({ id: 'fo-1', fundsOrderNo: 'FO1', legSeq: 1, amount: '7.5', txHash: '0xleg', referenceNo: null, createdAt: new Date(), fromWalletId: 'w-ops', toWalletId: 'w-cust' });
      await wf.handleFundsOrderChanged(evt(1, 'CONFIRMED') as any);
      expect(accounting.executeTransfer).toHaveBeenCalledTimes(2);
      expect(accounting.executeTransfer.mock.calls[0][0]).toMatchObject({ code: TB_TRANSFER_CODES.INTERNAL_TRANSFER_FIRM_OUT, amount: 7_500_000n, evidence: expect.objectContaining({ eventCode: 'INTERNAL_TRANSFER_FIRM_OUT', debitWalletRef: 'w-ops', creditWalletRef: 'w-ops' }) });
      expect(accounting.executeTransfer.mock.calls[1][0]).toMatchObject({ code: TB_TRANSFER_CODES.INTERNAL_TRANSFER_CLIENT_IN, amount: 7_500_000n, evidence: expect.objectContaining({ eventCode: 'INTERNAL_TRANSFER_COMPENSATION_IN', debitWalletRef: 'w-cust', creditWalletRef: 'w-cust', externalRef: '0xleg' }) });
      expect(accounting.resolveTbAccountId).toHaveBeenCalledWith(expect.objectContaining({ code: 100, ownerType: 'CUSTOMER', ownerUuid: 'uuid-cu' }));
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'SUCCESS', expect.objectContaining({ settledAt: expect.any(Date) }));
      expect(auditLogs.recordSystem.mock.calls.map((c: any) => c[0].action)).toEqual(['INTERNAL_TRANSFER_LEG_POSTED', 'INTERNAL_TRANSFER_SETTLED']);
    });
    it('垫款的客户侧事件码是 INTERNAL_TRANSFER_ADVANCE_IN', async () => {
      const { wf, accounting, fundsOrders } = makeWorkflow({ transferRow: { ...executing(USDT), purpose: 'CLIENT_ADVANCE' } });
      fundsOrders.findById.mockResolvedValueOnce({ id: 'fo-1', fundsOrderNo: 'FO1', legSeq: 1, amount: '7.5', txHash: '0xleg', referenceNo: null, createdAt: new Date(), fromWalletId: 'w-ops', toWalletId: 'w-cust' });
      await wf.handleFundsOrderChanged(evt(1, 'CONFIRMED') as any);
      expect(accounting.executeTransfer.mock.calls[1][0].evidence.eventCode).toBe('INTERNAL_TRANSFER_ADVANCE_IN');
    });
    it('落账抛错 → 审计 FAILED(POSTING_FAILED)，不清算、不 SUCCESS、不重试', async () => {
      const { wf, accounting, fundsOrders, transfers, auditLogs } = makeWorkflow({ transferRow: executing(USDT) });
      fundsOrders.findById.mockResolvedValueOnce({ id: 'fo-1', fundsOrderNo: 'FO1', legSeq: 1, amount: '7.5', txHash: '0xleg', referenceNo: null, createdAt: new Date(), fromWalletId: 'w-ops', toWalletId: 'w-cust' });
      accounting.executeTransfer.mockRejectedValueOnce(new Error('TB down'));
      await wf.handleFundsOrderChanged(evt(1, 'CONFIRMED') as any);
      expect(fundsOrders.advance).not.toHaveBeenCalled();
      expect(transfers.transition).not.toHaveBeenCalled();
      expect(auditLogs.recordSystem.mock.calls[0][0]).toMatchObject({ action: 'INTERNAL_TRANSFER_FAILED', reasonCode: 'POSTING_FAILED', outcome: 'FAILED' });
    });
    it('FAILED · 法币腿 2：订单 FAILED(LEG_FAILED)，备注写清款项停在结算户', async () => {
      const { wf, transfers } = makeWorkflow({ transferRow: executing(AED), asset: AED });
      await wf.handleFundsOrderChanged(evt(2, 'FAILED') as any);
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'FAILED', expect.objectContaining({ failureReasonCode: 'LEG_FAILED', failureNote: expect.stringContaining('结算户') }));
    });
  });

  describe('cancel', () => {
    it('待批可撤：先撤审批单再翻 CANCELLED + 审计', async () => {
      const { wf, approvals, transfers, auditLogs } = makeWorkflow();
      const r = await wf.cancel('ITR1', { reason: '开错' }, treasury);
      expect(approvals.cancel).toHaveBeenCalledWith('APR1', { reason: '开错' }, treasury);
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'CANCELLED', expect.objectContaining({ failureNote: '开错' }));
      expect(r.status).toBe('CANCELLED');
      expect(auditLogs.recordByActor.mock.calls[0][0].action).toBe('INTERNAL_TRANSFER_CANCELLED');
    });
    it('执行中不许撤', async () => {
      const { wf } = makeWorkflow({ transferRow: { transferNo: 'ITR1', status: S.EXECUTING, asset: USDT } });
      await expect(wf.cancel('ITR1', { reason: 'x' }, treasury)).rejects.toThrow(/不能撤回/);
    });
  });
});
