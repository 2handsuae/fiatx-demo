import { ConflictException } from '@nestjs/common';
import { InternalTransferWorkflowService } from './internal-transfer-workflow.service';
import { InternalTransferStatus as S } from './dto/internal-transfer.dto';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';

const USDT = { id: 'a-usdt', code: 'USDT-TRON', currency: 'USDT', decimals: 6, type: 'CRYPTO' };
const AED = { id: 'a-aed', code: 'AED', currency: 'AED', decimals: 2, type: 'FIAT' };
// 按 (code, ledger) / (钱包 id, ledger) 编出不同的账户 id——传错钱包或账本,断言里的期望 id 就对不上。
// 现金户(戊波一:一钱包一户)走 cashAcct,只经 resolveCashAccountId 取;其余科目走 acct。
const acct = (code: number, ledger: number): bigint => BigInt(code) * 100n + BigInt(ledger);
const cashAcct = (walletId: string, ledger: number): bigint => BigInt(`0x${Buffer.from(`cash:${walletId}@${ledger}`).toString('hex')}`);
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
    resolveTbAccountId: jest.fn(async ({ code, ledger }: any) => acct(code, ledger)),
    resolveCashAccountId: jest.fn(async (walletId: string, ledger: number) => cashAcct(walletId, ledger)),
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
    it('CONFIRMED · fiat leg 1: 81 debit cash·viaWallet (settlement) / credit cash·fromWallet (operating) → cleared → creates leg 2 (settlement account → customer)', async () => {
      const row = { ...executing(AED), amount: '900' };
      const { wf, accounting, fundsOrders, transfers } = makeWorkflow({ transferRow: row, asset: AED });
      fundsOrders.findById.mockResolvedValueOnce({ id: 'fo-1', fundsOrderNo: 'FO1', legSeq: 1, amount: '900', txHash: null, referenceNo: 'BANK-1', createdAt: new Date(), fromWalletId: 'w-ops', toWalletId: 'w-set' });
      await wf.handleFundsOrderChanged(evt(1, 'CONFIRMED') as any);
      expect(accounting.executeTransfer).toHaveBeenCalledTimes(1);
      expect(accounting.executeTransfer.mock.calls[0][0]).toMatchObject({
        code: TB_TRANSFER_CODES.INTERNAL_TRANSFER_OPS_TO_SET, amount: 90_000n, ledger: TB_LEDGERS.AED,
        debitAccountId: cashAcct('w-set', TB_LEDGERS.AED), creditAccountId: cashAcct('w-ops', TB_LEDGERS.AED),
        evidence: expect.objectContaining({ sourceType: 'INTERNAL_TRANSFER', sourceNo: 'ITR1', eventCode: 'INTERNAL_TRANSFER_OPS_TO_SET', debitCode: 'A.FIRM_CASH', creditCode: 'A.FIRM_CASH', externalRef: 'BANK-1', assetCurrency: 'AED' }),
      });
      // 81 两侧都是钱包现金户,经唯一入口取;不再有聚合 FIRM_CASH / 退役码 201 / FIRM_EQUITY 查询
      expect(accounting.resolveCashAccountId).toHaveBeenCalledWith('w-set', TB_LEDGERS.AED);
      expect(accounting.resolveCashAccountId).toHaveBeenCalledWith('w-ops', TB_LEDGERS.AED);
      expect(accounting.resolveTbAccountId).not.toHaveBeenCalled();
      expect(fundsOrders.advance).toHaveBeenCalledWith('fo-1', 'CLEAR', 'INTERNAL_TRANSFER_WORKFLOW');
      expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ legSeq: 2, fromWalletId: 'w-set', toWalletId: 'w-cust' }));
      expect(transfers.transition).not.toHaveBeenCalled();
    });
    it('CONFIRMED · final leg (crypto leg 1): 82 DR EXPENSE_RECON_LOSS / CR cash·fromWallet, 83 (event code by purpose) DR cash·toWallet / CR CLIENT_PAYABLE(customer) → SUCCESS + audit LEG_POSTED / SETTLED', async () => {
      const { wf, accounting, fundsOrders, transfers, auditLogs } = makeWorkflow({ transferRow: executing(USDT) });
      fundsOrders.findById.mockResolvedValueOnce({ id: 'fo-1', fundsOrderNo: 'FO1', legSeq: 1, amount: '7.5', txHash: '0xleg', referenceNo: null, createdAt: new Date(), fromWalletId: 'w-ops', toWalletId: 'w-cust' });
      await wf.handleFundsOrderChanged(evt(1, 'CONFIRMED') as any);
      expect(accounting.executeTransfer).toHaveBeenCalledTimes(2);
      // 82:借 对账核销损失(SYSTEM 301,公司出这笔钱记损失)/ 贷 现金·公司钱包(加密币 = from 运营钱包);不再借权益、不再贷聚合 FIRM_CASH
      expect(accounting.executeTransfer.mock.calls[0][0]).toMatchObject({
        code: TB_TRANSFER_CODES.INTERNAL_TRANSFER_FIRM_OUT, amount: 7_500_000n, ledger: TB_LEDGERS.USDT,
        debitAccountId: acct(TB_ACCOUNT_CODES.EXPENSE_RECON_LOSS, TB_LEDGERS.USDT), creditAccountId: cashAcct('w-ops', TB_LEDGERS.USDT),
        evidence: expect.objectContaining({ eventCode: 'INTERNAL_TRANSFER_FIRM_OUT', debitCode: 'X.EXPENSE_RECON_LOSS', creditCode: 'A.FIRM_CASH' }),
      });
      // 83:借 现金·客户钱包(toWalletId)/ 贷 应付·客户(逐客户户,账本同币种)
      expect(accounting.executeTransfer.mock.calls[1][0]).toMatchObject({
        code: TB_TRANSFER_CODES.INTERNAL_TRANSFER_CLIENT_IN, amount: 7_500_000n, ledger: TB_LEDGERS.USDT,
        debitAccountId: cashAcct('w-cust', TB_LEDGERS.USDT), creditAccountId: acct(TB_ACCOUNT_CODES.CLIENT_PAYABLE, TB_LEDGERS.USDT),
        evidence: expect.objectContaining({ eventCode: 'INTERNAL_TRANSFER_COMPENSATION_IN', debitCode: 'A.CLIENT_CASH', creditCode: 'L.CLIENT_PAYABLE', externalRef: '0xleg' }),
      });
      expect(accounting.resolveCashAccountId).toHaveBeenCalledWith('w-ops', TB_LEDGERS.USDT);
      expect(accounting.resolveCashAccountId).toHaveBeenCalledWith('w-cust', TB_LEDGERS.USDT);
      expect(accounting.resolveTbAccountId).toHaveBeenCalledWith(expect.objectContaining({ code: TB_ACCOUNT_CODES.EXPENSE_RECON_LOSS, ownerType: 'SYSTEM' }));
      expect(accounting.resolveTbAccountId).toHaveBeenCalledWith(expect.objectContaining({ code: 100, ownerType: 'CUSTOMER', ownerUuid: 'uuid-cu' }));
      const resolvedCodes = (accounting.resolveTbAccountId.mock.calls as any[][]).map((c) => c[0].code);
      for (const gone of [TB_ACCOUNT_CODES.FIRM_CASH, TB_ACCOUNT_CODES.CLIENT_CASH, 201, TB_ACCOUNT_CODES.FIRM_EQUITY]) expect(resolvedCodes).not.toContain(gone);
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'SUCCESS', expect.objectContaining({ settledAt: expect.any(Date) }));
      expect(auditLogs.recordSystem.mock.calls.map((c: any) => c[0].action)).toEqual(['INTERNAL_TRANSFER_LEG_POSTED', 'INTERNAL_TRANSFER_SETTLED']);
    });
    it('CONFIRMED · final leg (fiat leg 2): 82 credits the settlement wallet cash (via), 83 debits the customer wallet cash — the advance path is wired the same way', async () => {
      const row = { ...executing(AED), amount: '900', purpose: 'CLIENT_ADVANCE' };
      const { wf, accounting, fundsOrders, transfers } = makeWorkflow({ transferRow: row, asset: AED });
      fundsOrders.findById.mockResolvedValueOnce({ id: 'fo-2', fundsOrderNo: 'FO2', legSeq: 2, amount: '900', txHash: null, referenceNo: 'BANK-2', createdAt: new Date(), fromWalletId: 'w-set', toWalletId: 'w-cust' });
      await wf.handleFundsOrderChanged(evt(2, 'CONFIRMED') as any);
      expect(accounting.executeTransfer).toHaveBeenCalledTimes(2);
      expect(accounting.executeTransfer.mock.calls[0][0]).toMatchObject({
        code: TB_TRANSFER_CODES.INTERNAL_TRANSFER_FIRM_OUT, amount: 90_000n, ledger: TB_LEDGERS.AED,
        debitAccountId: acct(TB_ACCOUNT_CODES.EXPENSE_RECON_LOSS, TB_LEDGERS.AED), creditAccountId: cashAcct('w-set', TB_LEDGERS.AED),
        evidence: expect.objectContaining({ eventCode: 'INTERNAL_TRANSFER_FIRM_OUT', debitCode: 'X.EXPENSE_RECON_LOSS', creditCode: 'A.FIRM_CASH' }),
      });
      expect(accounting.executeTransfer.mock.calls[1][0]).toMatchObject({
        code: TB_TRANSFER_CODES.INTERNAL_TRANSFER_CLIENT_IN, amount: 90_000n, ledger: TB_LEDGERS.AED,
        debitAccountId: cashAcct('w-cust', TB_LEDGERS.AED), creditAccountId: acct(TB_ACCOUNT_CODES.CLIENT_PAYABLE, TB_LEDGERS.AED),
        evidence: expect.objectContaining({ eventCode: 'INTERNAL_TRANSFER_ADVANCE_IN', debitCode: 'A.CLIENT_CASH', creditCode: 'L.CLIENT_PAYABLE' }),
      });
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'SUCCESS', expect.objectContaining({ settledAt: expect.any(Date) }));
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
