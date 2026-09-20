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
  };
  const transfers: any = {
    findBlockingBySource: jest.fn(async () => null),
    assertFirmOpsBalance: jest.fn(async () => undefined),
    create: jest.fn(async (input: any) => ({ ...transferRow, ...input, amount: input.amountMajor })),
    findByNo: jest.fn(async () => transferRow),
    transition: jest.fn(async (_no: string, to: string, patch: any) => ({ ...transferRow, status: to, ...patch })),
    stampApprovalNo: jest.fn(async () => undefined),
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
    stampExternalRef: jest.fn(async () => null),
    resolveExternalRef: jest.fn((row: any) => (row.asset?.type === 'CRYPTO' ? row.txHash ?? null : row.referenceNo ?? null)),
  };
  const systemWallets: any = { resolve: jest.fn(async (_assetId: string, vault: string) => (vault === 'F_OPS' ? walletsById['w-ops'] : walletsById['w-set'])) };
  const supplementEvidence: any = { assertClaimable: jest.fn(async () => ({ externalLineId: 'line-1', caseNo: 'REC2', walletId: 'w-cust', ownerId: 'uuid-cu', ownerNo: 'CU1', assetId: 'a-aed', currency: 'AED', assetType: 'FIAT', decimals: 2, amountMinor: '120000', amountMajor: '1200.00', externalRef: 'BANK-CLAW', businessDate: '2026-09-05' })) };
  const custodianStatement: any = { recordLegMovement: jest.fn(async () => ({ outLineId: 'l1', inLineId: 'l2', cutoffDate: '2026-09-05' })) };
  const wf = new InternalTransferWorkflowService(prisma, transfers, approvals, accounting, auditLogs, fundsOrders, systemWallets, supplementEvidence, custodianStatement);
  return { wf, prisma, transfers, approvals, accounting, auditLogs, fundsOrders, systemWallets, supplementEvidence, custodianStatement, transferRow };
}

describe('InternalTransferWorkflowService (Task 7)', () => {
  describe('initiateCompensation — birth guards', () => {
    it('the loss-recognition adjustment is not yet posted → 400', async () => {
      const { wf } = makeWorkflow({ adjustment: { adjustmentNo: 'ADJ1', status: 'PENDING_APPROVAL', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', book: 'CLIENT' } });
      await expect(wf.initiateCompensation({ adjustmentNo: 'ADJ1', reason: 'r' }, treasury)).rejects.toThrow(/not yet posted/);
    });
    it('not a client-pool loss-recognition adjustment → 400', async () => {
      const { wf } = makeWorkflow({ adjustment: { adjustmentNo: 'ADJ1', status: 'POSTED', reasonCode: 'UNEXPLAINED_WRITE_OFF', book: 'FIRM' } });
      await expect(wf.initiateCompensation({ adjustmentNo: 'ADJ1', reason: 'r' }, treasury)).rejects.toThrow(/not a client-pool loss-recognition adjustment/);
    });
    it('the same adjustment already has an unfinished / successful transfer → 409', async () => {
      const { wf, transfers } = makeWorkflow();
      transfers.findBlockingBySource.mockResolvedValueOnce({ transferNo: 'ITR0', status: 'SUCCESS' });
      await expect(wf.initiateCompensation({ adjustmentNo: 'ADJ1', reason: 'r' }, treasury)).rejects.toBeInstanceOf(ConflictException);
    });
    it('operating account balance is not enough → 400 (guard comes from the entity)', async () => {
      const { wf, transfers } = makeWorkflow();
      transfers.assertFirmOpsBalance.mockRejectedValueOnce(new Error('Insufficient USDT balance in the operating account'));
      await expect(wf.initiateCompensation({ adjustmentNo: 'ADJ1', reason: 'r' }, treasury)).rejects.toThrow(/Insufficient/);
    });
    it('happy path: one crypto leg (no via wallet), amount = the recognized loss, sent to CFO approval, audit REQUESTED, snapshot has zero UUIDs', async () => {
      const { wf, transfers, approvals, auditLogs } = makeWorkflow();
      const r = await wf.initiateCompensation({ adjustmentNo: 'ADJ1', reason: 'Loss recognized' }, treasury);
      expect(r).toEqual({ transferNo: 'ITR1', approvalNo: 'APR1', status: 'PENDING_APPROVAL' });
      expect(transfers.create).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'CLIENT_COMPENSATION', amountMajor: '7.500000', fromWalletId: 'w-ops', viaWalletId: null, toWalletId: 'w-cust', customerNo: 'CU1', sourceAdjustmentNo: 'ADJ1', sourceCaseNo: 'REC1' }));
      // 铁律③：approvalNo 回填改走主体服务(不再直写 prisma.internalTransfer.update)
      expect(transfers.stampApprovalNo).toHaveBeenCalledWith('ITR1', 'APR1');
      const snapshot = approvals.createAndSubmit.mock.calls[0][0];
      expect(snapshot.actionType).toBe('INTERNAL_TRANSFER_APPROVAL');
      expect(snapshot.entityRef).toBe('ITR1');
      expect(JSON.stringify(snapshot.objectSnapshot)).not.toMatch(/uuid-|w-ops|w-cust/);
      expect(snapshot.objectSnapshot.impact).toContain('compensation of 7.500000 USDT');
      expect(auditLogs.recordByActor.mock.calls[0][0]).toMatchObject({ action: 'INTERNAL_TRANSFER_REQUESTED', actionDomain: 'TREASURY', primarySubjectNo: 'ITR1', amount: '7.500000' });
      expect(auditLogs.recordByActor.mock.calls[0][0].requestId).toMatch(/^INTERNAL_TRANSFER_REQUESTED_ITR1_/);
    });
  });

  describe('initiateAdvance', () => {
    const disposition = { dispositionNo: 'RCD1', outlet: 'SUPPLEMENT', deferredTarget: 'SUPPLEMENT_BOUNCE', supplementNo: null };
    it('available balance already covers it → 400, no advance needed', async () => {
      const { wf, accounting } = makeWorkflow({ disposition, asset: AED });
      accounting.getCustomerAvailableBalance.mockResolvedValueOnce({ available: 120_000n, held: 0n, total: 120_000n });
      await expect(wf.initiateAdvance({ caseNo: 'REC2', externalLineId: 'line-1', reason: 'r' }, treasury)).rejects.toThrow(/no advance is needed/);
    });
    it('not classified as a bounced deposit → 400', async () => {
      const { wf } = makeWorkflow({ disposition: { ...disposition, deferredTarget: 'SUPPLEMENT_DEPOSIT' }, asset: AED });
      await expect(wf.initiateAdvance({ caseNo: 'REC2', externalLineId: 'line-1', reason: 'r' }, treasury)).rejects.toThrow(/Deposit recalled/);
    });
    it('happy path: two fiat legs (via the settlement account), amount = bounced 1200 − available 300 = 900', async () => {
      const { wf, transfers, approvals } = makeWorkflow({ disposition, asset: AED });
      const r = await wf.initiateAdvance({ caseNo: 'REC2', externalLineId: 'line-1', reason: 'Advance funds' }, treasury);
      expect(r.status).toBe('PENDING_APPROVAL');
      expect(transfers.assertFirmOpsBalance).toHaveBeenCalledWith('AED', 90_000n);
      expect(transfers.create).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'CLIENT_ADVANCE', amountMajor: '900.00', fromWalletId: 'w-ops', viaWalletId: 'w-set', toWalletId: 'w-cust', sourceExternalLineId: 'line-1', sourceCaseNo: 'REC2' }));
      expect(approvals.createAndSubmit.mock.calls[0][0].objectSnapshot.impact).toContain('Advance 900.00 AED');
    });
  });

  describe('onDecided', () => {
    const decided = (decision: any) => ({ decision, actionType: 'INTERNAL_TRANSFER_APPROVAL', entityRef: 'ITR1', approvalId: 'uuid-apr', approvalNo: 'APR1', traceId: 'trace-1', workflowType: 'INTERNAL_TRANSFER', metadata: {} });
    it('rejected → REJECTED + audit carries the approval causation', async () => {
      const { wf, transfers, auditLogs } = makeWorkflow();
      await wf.onDecided(decided('DECLINED') as any);
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'REJECTED', expect.anything());
      expect(auditLogs.recordSystem.mock.calls[0][0]).toMatchObject({ action: 'INTERNAL_TRANSFER_REJECTED', approvalNo: 'APR1', causationId: 'uuid-apr' });
    });
    it('a cancellation decision is not handled here (cancel() closes its own loop)', async () => {
      const { wf, transfers } = makeWorkflow();
      await wf.onDecided(decided('CANCELLED') as any);
      expect(transfers.transition).not.toHaveBeenCalled();
    });
    it('approved but operating account balance is not enough → FAILED(INSUFFICIENT_FIRM_BALANCE), no funds order created', async () => {
      const { wf, transfers, fundsOrders } = makeWorkflow();
      transfers.assertFirmOpsBalance.mockRejectedValueOnce(new Error('Insufficient USDT balance in the operating account'));
      await wf.onDecided(decided('APPROVED') as any);
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'FAILED', expect.objectContaining({ failureReasonCode: 'INSUFFICIENT_FIRM_BALANCE' }));
      expect(fundsOrders.create).not.toHaveBeenCalled();
    });
    it('approved → creates leg 1 (crypto: operating account → customer) → EXECUTING + audit EXECUTION_STARTED', async () => {
      const { wf, transfers, fundsOrders, auditLogs } = makeWorkflow();
      await wf.onDecided(decided('APPROVED') as any);
      expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ internalTransferId: 'uuid-itr', legSeq: 1, initialStatus: 'CREATED', amount: '7.5', fromWalletId: 'w-ops', toWalletId: 'w-cust', fromAddress: 'Tops', toAddress: 'Tcust' }));
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'EXECUTING', expect.objectContaining({ executedAt: expect.any(Date) }));
      expect(auditLogs.recordSystem.mock.calls[0][0]).toMatchObject({ action: 'INTERNAL_TRANSFER_EXECUTION_STARTED', approvalNo: 'APR1', causationId: 'uuid-apr' });
    });
    it('approved → fiat leg 1 is operating account → settlement account', async () => {
      const { wf, fundsOrders } = makeWorkflow({ asset: AED });
      await wf.onDecided(decided('APPROVED') as any);
      expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ legSeq: 1, fromWalletId: 'w-ops', toWalletId: 'w-set', fromIban: 'AE-OPS', toIban: 'AE-SET' }));
    });
  });

  describe('handleFundsOrderChanged', () => {
    const executing = (asset: any) => ({ id: 'uuid-itr', transferNo: 'ITR1', purpose: 'CLIENT_COMPENSATION', status: S.EXECUTING, amount: '7.5', assetId: asset.id, asset, fromWalletId: 'w-ops', viaWalletId: asset.type === 'FIAT' ? 'w-set' : null, toWalletId: 'w-cust', customerId: 'uuid-cu', customerNo: 'CU1', reason: 'r', sourceCaseNo: 'REC1', sourceAdjustmentNo: 'ADJ1', sourceExternalLineId: null, traceId: 'trace-1', approvalNo: 'APR1' });
    const evt = (legSeq: number, newStatus: string) => ({ fundsOrderId: `fo-${legSeq}`, fundsOrderNo: `FO${legSeq}`, parent: { internalTransferId: 'uuid-itr' }, legSeq, attempt: 1, oldStatus: null, newStatus });

    it('an event that is not for a transfer leg is ignored outright', async () => {
      const { wf, custodianStatement } = makeWorkflow();
      await wf.handleFundsOrderChanged({ ...evt(1, 'SUBMITTED'), parent: { withdrawTransactionId: 'w' } } as any);
      expect(custodianStatement.recordLegMovement).not.toHaveBeenCalled();
    });
    it('SUBMITTED: the reference number is minted at submission (crypto txHash), then the simulated custodian writes two lines', async () => {
      const { wf, fundsOrders, custodianStatement } = makeWorkflow({ transferRow: executing(USDT) });
      fundsOrders.stampExternalRef.mockResolvedValueOnce({ txHash: `0x${'ab'.repeat(32)}` });
      await wf.handleFundsOrderChanged(evt(1, 'SUBMITTED') as any);
      expect(fundsOrders.stampExternalRef).toHaveBeenCalledWith('fo-1');
      expect(custodianStatement.recordLegMovement).toHaveBeenCalledWith(expect.objectContaining({ fundsOrderNo: 'FO1', fromWalletId: 'w-ops', toWalletId: 'w-cust', assetCode: 'USDT-TRON', assetType: 'CRYPTO', amountMinor: 7_500_000n, externalRef: expect.stringMatching(/^0x/) }));
    });
    it('CONFIRMED · fiat leg 1: debit operating account / credit settlement account (81) → cleared → creates leg 2 (settlement account → customer)', async () => {
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
    it('CONFIRMED · final leg (crypto leg 1): firm pays out (82) + customer receives (83, event code by purpose) → SUCCESS + audit LEG_POSTED / SETTLED', async () => {
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
    it('the customer-side event code for an advance is INTERNAL_TRANSFER_ADVANCE_IN', async () => {
      const { wf, accounting, fundsOrders } = makeWorkflow({ transferRow: { ...executing(USDT), purpose: 'CLIENT_ADVANCE' } });
      fundsOrders.findById.mockResolvedValueOnce({ id: 'fo-1', fundsOrderNo: 'FO1', legSeq: 1, amount: '7.5', txHash: '0xleg', referenceNo: null, createdAt: new Date(), fromWalletId: 'w-ops', toWalletId: 'w-cust' });
      await wf.handleFundsOrderChanged(evt(1, 'CONFIRMED') as any);
      expect(accounting.executeTransfer.mock.calls[1][0].evidence.eventCode).toBe('INTERNAL_TRANSFER_ADVANCE_IN');
    });
    it('posting throws → audit FAILED(POSTING_FAILED), not cleared, not SUCCESS, no retry', async () => {
      const { wf, accounting, fundsOrders, transfers, auditLogs } = makeWorkflow({ transferRow: executing(USDT) });
      fundsOrders.findById.mockResolvedValueOnce({ id: 'fo-1', fundsOrderNo: 'FO1', legSeq: 1, amount: '7.5', txHash: '0xleg', referenceNo: null, createdAt: new Date(), fromWalletId: 'w-ops', toWalletId: 'w-cust' });
      accounting.executeTransfer.mockRejectedValueOnce(new Error('TB down'));
      await wf.handleFundsOrderChanged(evt(1, 'CONFIRMED') as any);
      expect(fundsOrders.advance).not.toHaveBeenCalled();
      expect(transfers.transition).not.toHaveBeenCalled();
      expect(auditLogs.recordSystem.mock.calls[0][0]).toMatchObject({ action: 'INTERNAL_TRANSFER_FAILED', reasonCode: 'POSTING_FAILED', outcome: 'FAILED' });
    });
    it('FAILED · fiat leg 2: order goes FAILED(LEG_FAILED), the note spells out that funds remain in the settlement account', async () => {
      const { wf, transfers } = makeWorkflow({ transferRow: executing(AED), asset: AED });
      await wf.handleFundsOrderChanged(evt(2, 'FAILED') as any);
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'FAILED', expect.objectContaining({ failureReasonCode: 'LEG_FAILED', failureNote: expect.stringContaining('settlement account') }));
    });
  });

  describe('cancel', () => {
    it('pending-approval transfers can be cancelled: cancels the approval first, then flips to CANCELLED + audit', async () => {
      const { wf, approvals, transfers, auditLogs } = makeWorkflow();
      const r = await wf.cancel('ITR1', { reason: 'Opened by mistake' }, treasury);
      expect(approvals.cancel).toHaveBeenCalledWith('APR1', { reason: 'Opened by mistake' }, treasury);
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'CANCELLED', expect.objectContaining({ failureNote: 'Opened by mistake' }));
      expect(r.status).toBe('CANCELLED');
      expect(auditLogs.recordByActor.mock.calls[0][0].action).toBe('INTERNAL_TRANSFER_CANCELLED');
    });
    it('cannot cancel while executing', async () => {
      const { wf } = makeWorkflow({ transferRow: { transferNo: 'ITR1', status: S.EXECUTING, asset: USDT } });
      await expect(wf.cancel('ITR1', { reason: 'x' }, treasury)).rejects.toThrow(/cannot be cancelled/);
    });
  });
});
