import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InternalTransferWorkflowService } from './internal-transfer-workflow.service';
import { InternalTransferStatus as S } from './dto/internal-transfer.dto';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { startOfBusinessDate } from '../../accounting/tigerbeetle/utils/business-date.util';
import { bigintToHex } from '../../accounting/tigerbeetle/utils/tb-id.util';

const USDT = { id: 'a-usdt', code: 'USDT-TRON', currency: 'USDT', decimals: 6, type: 'CRYPTO' };
const AED = { id: 'a-aed', code: 'AED', currency: 'AED', decimals: 2, type: 'FIAT' };
// 按 (code, ledger) / (钱包 id, ledger) 编出不同的账户 id——传错钱包或账本,断言里的期望 id 就对不上。
// 现金户(戊波一:一钱包一户)走 cashAcct,只经 resolveCashAccountId 取;其余科目走 acct;
// 码 2 托管短缺待补(戊波二:一钱包一户,ownerType WALLET)走 shortfallAcct,经 resolveTbAccountId 取。
const acct = (code: number, ledger: number): bigint => BigInt(code) * 100n + BigInt(ledger);
const cashAcct = (walletId: string, ledger: number): bigint => BigInt(`0x${Buffer.from(`cash:${walletId}@${ledger}`).toString('hex')}`);
const shortfallAcct = (walletId: string, ledger: number): bigint => BigInt(`0x${Buffer.from(`shortfall:${walletId}@${ledger}`).toString('hex')}`);
const treasury = { actorType: 'ADMIN' as const, userId: 'uuid-tre', userNo: 'ADM-TRE', roleCodes: ['TREASURY_OFFICER'] };

const BUSINESS_DATE = '2026-11-05';
const kaseRow = { caseNo: 'REC1', status: 'OPEN', book: 'CUSTOMER', walletRef: 'w-cust', ownerNo: 'CU1', assetCode: 'USDT-TRON', businessDate: BUSINESS_DATE, slaBreached: true, traceId: 'trace-1' };
const heldRow = { dispositionNo: 'RCD1', outlet: 'HOLD_INVESTIGATING', incidentNo: null, adjustmentNo: null, transferNo: null };
// 案件页同一行的开单预填(resolveWriteOff 公式):托管里少了 7.5 USDT,方向 REDUCE
const diffRow = { internalFlow: { id: 'flow-1', direction: 'IN' }, externalLine: { id: 'line-1' }, matchType: 'AMOUNT_MISMATCH', adjustmentPrefill: { amountMinor: '7500000', direction: 'REDUCE', reattributionSide: 'TO' } };

function makeWorkflow(o: Partial<Record<'asset' | 'disposition' | 'transferRow' | 'kase' | 'held' | 'incident' | 'diffRow', any>> = {}) {
  const asset = o.asset ?? USDT;
  const kase = o.kase ?? kaseRow;
  const transferRow = o.transferRow ?? {
    id: 'uuid-itr', transferNo: 'ITR1', purpose: 'SHORTFALL_TOPUP', status: S.PENDING_APPROVAL, amount: '7.5', assetId: asset.id, asset,
    fromWalletId: 'w-ops', viaWalletId: asset.type === 'FIAT' ? 'w-set' : null, toWalletId: 'w-cust', customerId: 'uuid-cu', customerNo: 'CU1', reason: 'r',
    sourceCaseNo: 'REC1', sourceExternalLineId: null, explainedFlowId: 'flow-1', explainedExternalLineId: 'line-1',
    recognizedTbTransferId: null, recognizedAt: null, effectiveDate: startOfBusinessDate(BUSINESS_DATE), lossSource: 'AGING', sourceIncidentNo: null,
    traceId: 'trace-1', approvalNo: 'APR1',
  };
  const walletsById: Record<string, any> = {
    'w-ops': { id: 'w-ops', ownerId: null, ownerType: 'PLATFORM', vaultCode: 'F_OPS', address: 'Tops', iban: 'AE-OPS', walletNo: 'WA-OPS' },
    'w-set': { id: 'w-set', ownerId: null, ownerType: 'PLATFORM', vaultCode: 'F_SET', address: null, iban: 'AE-SET', walletNo: 'WA-SET' },
    'w-fee': { id: 'w-fee', ownerId: null, ownerType: 'PLATFORM', vaultCode: 'F_FEE', address: 'Tfee', iban: 'AE-FEE', walletNo: 'WA-FEE' },
    'w-cust': { id: 'w-cust', ownerId: 'uuid-cu', ownerType: 'CUSTOMER', address: 'Tcust', iban: 'AE-CUST', walletNo: 'WA-CUST' },
  };
  const prisma: any = {
    reconciliationCase: { findUnique: jest.fn(async () => kase) },
    reconciliationDisposition: { findFirst: jest.fn(async (args: any) => (args?.where?.explainedExternalLineId ? (o.disposition ?? null) : (o.held === undefined ? heldRow : o.held))) },
    incident: { findUnique: jest.fn(async () => o.incident ?? null) },
    asset: { findUnique: jest.fn(async () => asset) },
    wallet: { findUnique: jest.fn(async ({ where }: any) => walletsById[where.id] ?? null) },
    internalTransfer: { update: jest.fn(async () => transferRow), findUnique: jest.fn(async () => transferRow) },
  };
  const transfers: any = {
    findBlockingBySource: jest.fn(async () => null),
    findBlockingShortfallTopup: jest.fn(async () => null),
    create: jest.fn(async (input: any) => ({ ...transferRow, ...input, amount: input.amountMajor })),
    findByNo: jest.fn(async () => transferRow),
    transition: jest.fn(async (_no: string, to: string, patch: any) => ({ ...transferRow, status: to, ...patch })),
    stampApprovalNo: jest.fn(async () => undefined),
    stampRecognized: jest.fn(async () => undefined),
  };
  const approvals: any = { createAndSubmit: jest.fn(async () => ({ approvalNo: 'APR1' })), cancel: jest.fn(async () => ({})) };
  const accounting: any = {
    getCustomerAvailableBalance: jest.fn(async () => ({ available: 30_000n, held: 0n, total: 30_000n })),
    resolveTbAccountId: jest.fn(async ({ code, ledger, ownerType, ownerUuid }: any) => (ownerType === 'WALLET' ? shortfallAcct(ownerUuid, ledger) : acct(code, ledger))),
    resolveCashAccountId: jest.fn(async (walletId: string, ledger: number) => cashAcct(walletId, ledger)),
    // 戊波二 T3：余额闸收成 AccountingService 上这一份,默认放行;不足场景用 mockRejectedValueOnce 单次拒绝。
    assertWalletBalance: jest.fn(async () => undefined),
    // 戊波二 T7a:可用额算式只此一份(余额闸与客户钱包余量复查共用);默认远大于任何测试金额。
    getWalletCashAvailable: jest.fn(async () => 1_000_000_000_000n),
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
  // 戊波二 T7a:from 钱包守卫(运营户 / 手续费户)、处置记录回挂、案件页同一行的差额
  const firmWallets: any = { assertEligible: jest.fn(async (walletId: string) => walletsById[walletId]) };
  const dispositions: any = { linkTransfer: jest.fn(async () => undefined), unlinkTransfer: jest.fn(async () => undefined) };
  const reconQuery: any = { getCase: jest.fn(async () => ({ flowComparison: [o.diffRow ?? diffRow] })) };
  const wf = new InternalTransferWorkflowService(prisma, transfers, approvals, accounting, auditLogs, fundsOrders, systemWallets, supplementEvidence, custodianStatement, firmWallets, dispositions, reconQuery);
  return { wf, prisma, transfers, approvals, accounting, auditLogs, fundsOrders, systemWallets, supplementEvidence, custodianStatement, firmWallets, dispositions, reconQuery, transferRow };
}

describe('InternalTransferWorkflowService (Task 7)', () => {
  // ── 戊波二 T7a · 认损补缺一张单：开单 ─────────────────────────────────────────────
  describe('initiateShortfallTopup — one document, aging path', () => {
    const dto = { caseNo: 'REC1', flowId: 'flow-1', externalLineId: 'line-1', fromWalletId: 'w-ops', reason: '公司认赔' };

    it('opens: amount = the difference row\'s shortfall (server-computed), fixed cause, effective date = case business date, row locked at submit, sent to CFO', async () => {
      const { wf, transfers, approvals, auditLogs, firmWallets, accounting, dispositions, reconQuery } = makeWorkflow();
      const r = await wf.initiateShortfallTopup(dto, treasury);
      expect(r).toEqual({ transferNo: 'ITR1', approvalNo: 'APR1', status: 'PENDING_APPROVAL' });
      // 金额不是客户端传的:取案件页同一行的开单预填(与 nextStep 同源)
      expect(reconQuery.getCase).toHaveBeenCalledWith('REC1');
      expect(transfers.create).toHaveBeenCalledWith(expect.objectContaining({
        purpose: 'SHORTFALL_TOPUP', amountMajor: '7.500000', fromWalletId: 'w-ops', viaWalletId: null, toWalletId: 'w-cust',
        customerId: 'uuid-cu', customerNo: 'CU1', sourceCaseNo: 'REC1', explainedFlowId: 'flow-1', explainedExternalLineId: 'line-1',
        lossSource: 'AGING', sourceIncidentNo: null, effectiveDate: startOfBusinessDate(BUSINESS_DATE), traceId: 'trace-1',
      }));
      // from 钱包 ∈ {运营户, 手续费户} × 该币种网络(共用守卫),余额闸查的是人选的那只
      expect(firmWallets.assertEligible).toHaveBeenCalledWith('w-ops', 'a-usdt');
      expect(accounting.assertWalletBalance).toHaveBeenCalledWith('w-ops', TB_LEDGERS.USDT, 7_500_000n);
      // 开单即挂:处置记录落 transferNo(走处置主体自己的方法),不加 DispositionKind、不改 outlet
      expect(dispositions.linkTransfer).toHaveBeenCalledWith('RCD1', 'ITR1');
      // 快照:加 fromWalletNo / lossSource / effectiveDate;零 UUID;impact 照 spec §4.1 原句
      const snapshot = approvals.createAndSubmit.mock.calls[0][0];
      expect(snapshot.actionType).toBe('INTERNAL_TRANSFER_APPROVAL');
      expect(snapshot.entityRef).toBe('ITR1');
      expect(snapshot.objectSnapshot).toMatchObject({ purpose: 'SHORTFALL_TOPUP', fromWalletNo: 'WA-OPS', lossSource: 'AGING', effectiveDate: BUSINESS_DATE, customerNo: 'CU1' });
      expect(JSON.stringify(snapshot.objectSnapshot)).not.toMatch(/uuid-|w-ops|w-cust|flow-1|line-1/);
      expect(snapshot.objectSnapshot.impact).toBe('Recognize custody shortfall of 7.500000 USDT on wallet WA-CUST for customer CU1 and top it up from WA-OPS; customer balance unchanged');
      // 铁律①:人选的 from 钱包、固定成因、来路进审计
      const audit = auditLogs.recordByActor.mock.calls[0][0];
      expect(audit).toMatchObject({ action: 'INTERNAL_TRANSFER_REQUESTED', actionDomain: 'TREASURY', primarySubjectNo: 'ITR1', amount: '7.500000' });
      expect(audit.metadata).toMatchObject({ causeCode: 'UNEXPLAINED_CLIENT_LOSS', lossSource: 'AGING', fromWalletNo: 'WA-OPS', effectiveDate: BUSINESS_DATE });
    });

    it('fiat: leg route goes through the settlement wallet (via), the operator-chosen fee wallet can be the from wallet', async () => {
      const { wf, transfers, accounting } = makeWorkflow({ asset: AED, kase: { ...kaseRow, assetCode: 'AED' }, diffRow: { ...diffRow, adjustmentPrefill: { amountMinor: '9000', direction: 'REDUCE', reattributionSide: 'TO' } } });
      await wf.initiateShortfallTopup({ ...dto, fromWalletId: 'w-fee' }, treasury);
      expect(transfers.create).toHaveBeenCalledWith(expect.objectContaining({ amountMajor: '90.00', fromWalletId: 'w-fee', viaWalletId: 'w-set', toWalletId: 'w-cust' }));
      expect(accounting.assertWalletBalance).toHaveBeenCalledWith('w-fee', TB_LEDGERS.AED, 9_000n);
    });

    it('needs at least one anchor (400), before any other work', async () => {
      const { wf, transfers, reconQuery } = makeWorkflow();
      await expect(wf.initiateShortfallTopup({ caseNo: 'REC1', fromWalletId: 'w-ops', reason: 'r' }, treasury)).rejects.toThrow(/anchored to a difference row/);
      expect(reconQuery.getCase).not.toHaveBeenCalled();
      expect(transfers.create).not.toHaveBeenCalled();
    });

    // 守卫是从调账单搬来的原样守卫(write-off-guards,与公司池核销共用)——客户池只多一条「只许少」
    it.each([
      ['the case has not reached the aging threshold', { kase: { ...kaseRow, slaBreached: false } }, /aging threshold/],
      ['the row\'s finding is not "Hold · Investigating"', { held: { ...heldRow, outlet: 'ADJUST_CORRECT' } }, /Hold · Investigating/],
      ['the row has no finding at all', { held: null }, /Hold · Investigating/],
      ['the row is already locked by a shortfall top-up', { held: { ...heldRow, transferNo: 'ITR0' } }, /already linked to shortfall top-up ITR0 — cannot open another shortfall top-up/],
      ['the row is already locked by an adjustment', { held: { ...heldRow, adjustmentNo: 'ADJ0' } }, /already linked to adjustment ADJ0/],
      ['the difference is past the small-amount line (100,000 USDT-class lines are for incidents)', { diffRow: { ...diffRow, adjustmentPrefill: { amountMinor: '999999999999', direction: 'REDUCE', reattributionSide: 'TO' } } }, /small-amount threshold/],
      ['the row is client-pool surplus (INCREASE) — excess funds cannot be recognized as a shortfall', { diffRow: { ...diffRow, adjustmentPrefill: { amountMinor: '7500000', direction: 'INCREASE', reattributionSide: 'TO' } } }, /Excess funds in the client pool/],
    ])('aging path guard: %s → 400, nothing created, nothing locked', async (_name, o, re) => {
      const { wf, transfers, dispositions } = makeWorkflow(o as any);
      await expect(wf.initiateShortfallTopup(dto, treasury)).rejects.toThrow(re as RegExp);
      expect(transfers.create).not.toHaveBeenCalled();
      expect(dispositions.linkTransfer).not.toHaveBeenCalled();
    });

    it('the anchored row is not on the case any more → 400', async () => {
      const { wf } = makeWorkflow({ diffRow: { internalFlow: { id: 'other' }, externalLine: { id: 'other' }, adjustmentPrefill: diffRow.adjustmentPrefill } });
      await expect(wf.initiateShortfallTopup(dto, treasury)).rejects.toThrow(/no longer on the case/);
    });

    it('the anchored row is on the case but is not a difference (e.g. already matched: no opening prefill) → 400, nothing created', async () => {
      const { wf, transfers } = makeWorkflow({ diffRow: { internalFlow: { id: 'flow-1' }, externalLine: { id: 'line-1' }, matchType: 'MATCHED' } });
      await expect(wf.initiateShortfallTopup(dto, treasury)).rejects.toThrow(/not a difference that can be recognized/);
      expect(transfers.create).not.toHaveBeenCalled();
    });

    it('a company-pool case (400) / a closed case (400) cannot open a shortfall top-up', async () => {
      await expect(makeWorkflow({ kase: { ...kaseRow, book: 'FIRM' } }).wf.initiateShortfallTopup(dto, treasury)).rejects.toThrow(/client-pool action/);
      await expect(makeWorkflow({ kase: { ...kaseRow, status: 'RESOLVED' } }).wf.initiateShortfallTopup(dto, treasury)).rejects.toThrow(/open case/);
    });

    it('an existing top-up on the same row blocks a new one → 409; so does a FAILED one that already recognized the shortfall (ruling 15: no re-top-up)', async () => {
      const live = makeWorkflow();
      live.transfers.findBlockingShortfallTopup.mockResolvedValueOnce({ transferNo: 'ITR0', status: 'EXECUTING' });
      await expect(live.wf.initiateShortfallTopup(dto, treasury)).rejects.toBeInstanceOf(ConflictException);
      expect(live.transfers.findBlockingShortfallTopup).toHaveBeenCalledWith({ explainedFlowId: 'flow-1', explainedExternalLineId: 'line-1' });

      const failedAfterRecognition = makeWorkflow();
      failedAfterRecognition.transfers.findBlockingShortfallTopup.mockResolvedValueOnce({ transferNo: 'ITR0', status: 'FAILED', recognizedTbTransferId: 'tb-91' });
      const err = await failedAfterRecognition.wf.initiateShortfallTopup(dto, treasury).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toMatch(/ITR0 \(FAILED\).*already recognized.*not re-opened/);
      expect(failedAfterRecognition.transfers.create).not.toHaveBeenCalled();
      expect(failedAfterRecognition.dispositions.linkTransfer).not.toHaveBeenCalled();
    });

    it('the from wallet is not eligible (e.g. a settlement wallet) → the picker\'s 400 passes through; nothing created', async () => {
      const { wf, firmWallets, transfers } = makeWorkflow();
      firmWallets.assertEligible.mockRejectedValueOnce(new BadRequestException({ code: 'FROM_WALLET_NOT_ELIGIBLE', message: 'Wallet WA-SET cannot be chosen as the from wallet' }));
      await expect(wf.initiateShortfallTopup({ ...dto, fromWalletId: 'w-set' }, treasury)).rejects.toThrow(/cannot be chosen/);
      expect(transfers.create).not.toHaveBeenCalled();
    });

    it('the chosen from wallet cannot pay → the shared balance gate\'s 400 passes through', async () => {
      const { wf, accounting, transfers } = makeWorkflow();
      accounting.assertWalletBalance.mockRejectedValueOnce(new Error('Insufficient USDT balance in wallet WA-OPS'));
      await expect(wf.initiateShortfallTopup(dto, treasury)).rejects.toThrow(/Insufficient/);
      expect(transfers.create).not.toHaveBeenCalled();
    });

    // 裁定 14:客户现金户带「贷不得超借」,TB 判标志时把挂起的贷方也算进去——待批提现的锁定会让码 91 被拒
    it('customer wallet has an in-flight payout lock so its free cash < the shortfall → 400 telling the operator to handle the wallet\'s in-flight payouts first (no UUID in the text)', async () => {
      const { wf, accounting, transfers, dispositions } = makeWorkflow();
      accounting.getWalletCashAvailable.mockResolvedValueOnce(1_000_000n); // 1 USDT 自由,要认 7.5
      const err: any = await wf.initiateShortfallTopup(dto, treasury).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({ code: 'CLIENT_WALLET_PAYOUTS_IN_FLIGHT' });
      expect(err.message).toMatch(/first handle this wallet's in-flight payouts \(reject or withdraw the pending withdrawal\)/);
      expect(err.message).toContain('CU1');
      expect(err.message).toContain('WA-CUST');
      expect(err.message).toContain('1.000000 USDT');
      expect(err.message).toContain('7.500000 USDT');
      expect(err.message).not.toMatch(/uuid-|w-cust/);
      // 查的是客户钱包(不是公司钱包),且用的是共享的可用额算式
      expect(accounting.getWalletCashAvailable).toHaveBeenCalledWith('w-cust', TB_LEDGERS.USDT);
      expect(transfers.create).not.toHaveBeenCalled();
      expect(dispositions.linkTransfer).not.toHaveBeenCalled();
    });

    it('headroom exactly equal to the shortfall is enough', async () => {
      const { wf, accounting, transfers } = makeWorkflow();
      accounting.getWalletCashAvailable.mockResolvedValueOnce(7_500_000n);
      await wf.initiateShortfallTopup(dto, treasury);
      expect(transfers.create).toHaveBeenCalled();
    });
  });

  describe('initiateShortfallTopup — incident path', () => {
    const dto = { caseNo: 'REC1', flowId: 'flow-1', fromWalletId: 'w-ops', reason: '事故定损，公司承担' };
    const incidentHeld = { ...heldRow, outlet: 'INCIDENT', incidentNo: 'INC1' };
    const assessed = { incidentNo: 'INC1', status: 'ASSESSED', assessmentBasis: 'FIRM_LOSS', assessedAmount: new Prisma.Decimal('1234.56') };

    it('amount is locked to the assessed loss (not the row, not the client), no aging line / small-amount line applies, lossSource INCIDENT + incident number', async () => {
      const { wf, transfers, approvals, reconQuery, dispositions } = makeWorkflow({
        held: incidentHeld, incident: assessed, kase: { ...kaseRow, slaBreached: false },
      });
      await wf.initiateShortfallTopup(dto, treasury);
      expect(reconQuery.getCase).not.toHaveBeenCalled(); // 事故路不看差异行
      expect(transfers.create).toHaveBeenCalledWith(expect.objectContaining({
        purpose: 'SHORTFALL_TOPUP', amountMajor: '1234.560000', lossSource: 'INCIDENT', sourceIncidentNo: 'INC1',
        explainedFlowId: 'flow-1', explainedExternalLineId: null, effectiveDate: startOfBusinessDate(BUSINESS_DATE),
      }));
      expect(approvals.createAndSubmit.mock.calls[0][0].objectSnapshot).toMatchObject({ lossSource: 'INCIDENT', sourceIncidentNo: 'INC1', effectiveDate: BUSINESS_DATE });
      expect(dispositions.linkTransfer).toHaveBeenCalledWith('RCD1', 'ITR1');
    });

    it('a LARGE_UNEXPLAINED line that stayed in Hold·Investigating but carries an incident number takes the incident path too (same discriminator as the adjustment)', async () => {
      const { wf, transfers } = makeWorkflow({ held: { ...heldRow, incidentNo: 'INC1' }, incident: assessed });
      await wf.initiateShortfallTopup(dto, treasury);
      expect(transfers.create).toHaveBeenCalledWith(expect.objectContaining({ lossSource: 'INCIDENT' }));
    });

    it.each([
      ['incident not assessed yet', { held: incidentHeld, incident: { ...assessed, status: 'INVESTIGATING', assessmentBasis: null, assessedAmount: null } }, /has not been assessed yet — wait for the assessment before opening a shortfall top-up/],
      ['assessment is not "firm bears the loss"', { held: incidentHeld, incident: { ...assessed, assessmentBasis: 'RECOVERED' } }, /not "Firm bears the loss" — only a firm-bears-the-loss assessment can open a shortfall top-up/],
      ['incident outlet but no incident registered yet', { held: { ...heldRow, outlet: 'INCIDENT', incidentNo: null } }, /no incident number attached yet/],
      ['the row is already locked by a shortfall top-up', { held: { ...incidentHeld, transferNo: 'ITR0' }, incident: assessed }, /already linked to shortfall top-up ITR0/],
    ])('incident path guard: %s → 400, nothing created', async (_name, o, re) => {
      const { wf, transfers } = makeWorkflow(o as any);
      await expect(wf.initiateShortfallTopup(dto, treasury)).rejects.toThrow(re as RegExp);
      expect(transfers.create).not.toHaveBeenCalled();
    });

    it('the headroom gate applies on the incident path as well', async () => {
      const { wf, accounting, transfers } = makeWorkflow({ held: incidentHeld, incident: assessed });
      accounting.getWalletCashAvailable.mockResolvedValueOnce(10n);
      await expect(wf.initiateShortfallTopup(dto, treasury)).rejects.toThrow(/in-flight payouts/);
      expect(transfers.create).not.toHaveBeenCalled();
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
      const { wf, transfers, approvals, accounting, systemWallets, dispositions } = makeWorkflow({ disposition, asset: AED });
      const r = await wf.initiateAdvance({ caseNo: 'REC2', externalLineId: 'line-1', reason: 'Advance funds' }, treasury);
      expect(r.status).toBe('PENDING_APPROVAL');
      // 余额闸查的是该币种 F_OPS 钱包（w-ops）在该币种账本上的现金户，金额 = 最小单位
      expect(systemWallets.resolve).toHaveBeenCalledWith(AED.id, 'F_OPS');
      expect(accounting.assertWalletBalance).toHaveBeenCalledWith('w-ops', TB_LEDGERS.AED, 90_000n);
      // 垫款的出钱钱包恒为运营户(建单时写死,不开放选择);生效日 = 被退汇账单行的业务日(迪拜日起点);没有认损来路 / 锚
      expect(transfers.create).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'CLIENT_ADVANCE', amountMajor: '900.00', fromWalletId: 'w-ops', viaWalletId: 'w-set', toWalletId: 'w-cust', sourceExternalLineId: 'line-1', sourceCaseNo: 'REC2', effectiveDate: startOfBusinessDate('2026-09-05') }));
      expect(transfers.create.mock.calls[0][0]).not.toHaveProperty('lossSource');
      expect(transfers.create.mock.calls[0][0]).not.toHaveProperty('explainedFlowId');
      expect(approvals.createAndSubmit.mock.calls[0][0].objectSnapshot.impact).toContain('Advance 900.00 AED');
      // 垫款不挂处置记录的 transferNo(那是认损补缺的锁)
      expect(dispositions.linkTransfer).not.toHaveBeenCalled();
    });
  });

  describe('onDecided', () => {
    const decided = (decision: any) => ({ decision, actionType: 'INTERNAL_TRANSFER_APPROVAL', entityRef: 'ITR1', approvalId: 'uuid-apr', approvalNo: 'APR1', traceId: 'trace-1', workflowType: 'INTERNAL_TRANSFER', decisionByUserNo: 'ADM-CFO', metadata: {} });
    const advanceRow = (asset: any = USDT) => ({
      id: 'uuid-itr', transferNo: 'ITR1', purpose: 'CLIENT_ADVANCE', status: S.PENDING_APPROVAL, amount: '7.5', assetId: asset.id, asset,
      fromWalletId: 'w-ops', viaWalletId: asset.type === 'FIAT' ? 'w-set' : null, toWalletId: 'w-cust', customerId: 'uuid-cu', customerNo: 'CU1', reason: 'r',
      sourceCaseNo: 'REC1', sourceExternalLineId: 'line-1', explainedFlowId: null, explainedExternalLineId: null,
      recognizedTbTransferId: null, recognizedAt: null, effectiveDate: startOfBusinessDate('2026-09-05'), lossSource: null, sourceIncidentNo: null, traceId: 'trace-1', approvalNo: 'APR1',
    });

    it('rejected → REJECTED + audit carries the approval causation + the row lock is released', async () => {
      const { wf, transfers, auditLogs, dispositions } = makeWorkflow();
      await wf.onDecided(decided('DECLINED') as any);
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'REJECTED', expect.anything());
      expect(auditLogs.recordSystem.mock.calls[0][0]).toMatchObject({ action: 'INTERNAL_TRANSFER_REJECTED', approvalNo: 'APR1', causationId: 'uuid-apr' });
      expect(dispositions.unlinkTransfer).toHaveBeenCalledWith('ITR1');
    });
    it('approval expired (timeout) → REJECTED and the row lock is released too', async () => {
      const { wf, transfers, dispositions } = makeWorkflow();
      await wf.onDecided(decided('EXPIRED') as any);
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'REJECTED', expect.objectContaining({ failureNote: 'Approval expired' }));
      expect(dispositions.unlinkTransfer).toHaveBeenCalledWith('ITR1');
    });
    it('a cancellation decision is not handled here (cancel() closes its own loop)', async () => {
      const { wf, transfers, dispositions } = makeWorkflow();
      await wf.onDecided(decided('CANCELLED') as any);
      expect(transfers.transition).not.toHaveBeenCalled();
      expect(dispositions.unlinkTransfer).not.toHaveBeenCalled();
    });
    it('a rejected ADVANCE has no row lock to release (the lock belongs to the shortfall top-up)', async () => {
      const { wf, dispositions } = makeWorkflow({ transferRow: advanceRow() });
      await wf.onDecided(decided('DECLINED') as any);
      expect(dispositions.unlinkTransfer).not.toHaveBeenCalled();
    });

    describe('shortfall top-up · approved', () => {
      it('re-checks both gates (the chosen from wallet balance AND the customer wallet headroom), then posts code 91 (Dr 2 · customer wallet / Cr 1 · same wallet) BEFORE any leg exists', async () => {
        const { wf, accounting, fundsOrders } = makeWorkflow();
        await wf.onDecided(decided('APPROVED') as any);
        expect(accounting.assertWalletBalance).toHaveBeenCalledWith('w-ops', TB_LEDGERS.USDT, 7_500_000n);
        expect(accounting.getWalletCashAvailable).toHaveBeenCalledWith('w-cust', TB_LEDGERS.USDT);
        expect(accounting.executeTransfer).toHaveBeenCalledTimes(1);
        expect(accounting.executeTransfer.mock.calls[0][0]).toMatchObject({
          code: TB_TRANSFER_CODES.CLIENT_SHORTFALL_RECOGNIZED, amount: 7_500_000n, ledger: TB_LEDGERS.USDT,
          debitAccountId: shortfallAcct('w-cust', TB_LEDGERS.USDT), creditAccountId: cashAcct('w-cust', TB_LEDGERS.USDT),
          evidence: expect.objectContaining({
            sourceType: 'INTERNAL_TRANSFER', sourceNo: 'ITR1', eventCode: 'INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED',
            debitCode: 'A.CLIENT_SHORTFALL', creditCode: 'A.CLIENT_CASH', assetCurrency: 'USDT',
            effectiveDate: BUSINESS_DATE, // 生效日 = 案件业务日:事后分录只有生效日等于那天,按案件业务日重对账才看得见
            actorType: 'ADMIN', actorId: 'ADM-CFO',
          }),
        });
        // 码 2 户经注册表按 (2, ledger, WALLET, 客户钱包) 取;客户应付一分不碰
        expect(accounting.resolveTbAccountId).toHaveBeenCalledWith({ code: TB_ACCOUNT_CODES.CLIENT_SHORTFALL, ledger: TB_LEDGERS.USDT, ownerType: 'WALLET', ownerUuid: 'w-cust' });
        expect((accounting.resolveTbAccountId.mock.calls as any[][]).map((c) => c[0].code)).not.toContain(TB_ACCOUNT_CODES.CLIENT_PAYABLE);
        expect(accounting.resolveCashAccountId).toHaveBeenCalledWith('w-cust', TB_LEDGERS.USDT);
        // 先记短缺、后建腿
        expect(accounting.executeTransfer.mock.invocationCallOrder[0]).toBeLessThan(fundsOrders.create.mock.invocationCallOrder[0]);
      });

      it('stores the receipt on the transfer, writes the audit INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED (amount + business-day effective date + approval causation) before EXECUTION_STARTED, then EXECUTING with leg 1 (operator-chosen from wallet → customer)', async () => {
        const { wf, transfers, fundsOrders, auditLogs } = makeWorkflow();
        await wf.onDecided(decided('APPROVED') as any);
        expect(transfers.stampRecognized).toHaveBeenCalledWith('ITR1', bigintToHex(1n));
        const actions = auditLogs.recordSystem.mock.calls.map((c: any) => c[0].action);
        expect(actions).toEqual(['INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED', 'INTERNAL_TRANSFER_EXECUTION_STARTED']);
        expect(auditLogs.recordSystem.mock.calls[0][0]).toMatchObject({
          action: 'INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED', actionDomain: 'TREASURY', amount: '7.500000', effectiveDate: BUSINESS_DATE,
          approvalNo: 'APR1', causationId: 'uuid-apr', primarySubjectNo: 'ITR1',
        });
        expect(auditLogs.recordSystem.mock.calls[0][0].metadata).toMatchObject({ tbTransferId: bigintToHex(1n), causeCode: 'UNEXPLAINED_CLIENT_LOSS' });
        expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ internalTransferId: 'uuid-itr', legSeq: 1, initialStatus: 'CREATED', amount: '7.5', fromWalletId: 'w-ops', toWalletId: 'w-cust', fromAddress: 'Tops', toAddress: 'Tcust' }));
        expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'EXECUTING', expect.objectContaining({ executedAt: expect.any(Date) }));
        expect(auditLogs.recordSystem.mock.calls[1][0]).toMatchObject({ action: 'INTERNAL_TRANSFER_EXECUTION_STARTED', approvalNo: 'APR1', causationId: 'uuid-apr' });
      });

      it('the recognition posting is rejected → FAILED(RECOGNITION_FAILED) via the existing PENDING_APPROVAL→FAILED edge, row lock released, no leg, no receipt, audit FAILED', async () => {
        const { wf, accounting, transfers, fundsOrders, dispositions, auditLogs } = makeWorkflow();
        accounting.executeTransfer.mockRejectedValueOnce(new Error('TigerBeetle transfer rejected: exceeds_credits'));
        await wf.onDecided(decided('APPROVED') as any);
        expect(transfers.transition).toHaveBeenCalledTimes(1);
        expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'FAILED', expect.objectContaining({ failureReasonCode: 'RECOGNITION_FAILED', failureNote: expect.stringContaining('exceeds_credits') }));
        expect(dispositions.unlinkTransfer).toHaveBeenCalledWith('ITR1');
        expect(fundsOrders.create).not.toHaveBeenCalled();
        expect(transfers.stampRecognized).not.toHaveBeenCalled();
        expect(auditLogs.recordSystem.mock.calls.map((c: any) => c[0].action)).toEqual(['INTERNAL_TRANSFER_FAILED']);
        expect(auditLogs.recordSystem.mock.calls[0][0]).toMatchObject({ reasonCode: 'RECOGNITION_FAILED', outcome: 'FAILED', approvalNo: 'APR1', causationId: 'uuid-apr', fromStatus: 'PENDING_APPROVAL', toStatus: 'FAILED' });
      });

      it('between submit and approval a withdrawal lock appeared on the customer wallet (headroom gone) → FAILED(RECOGNITION_FAILED) with the guidance text, 91 never attempted, lock released', async () => {
        const { wf, accounting, transfers, fundsOrders, dispositions } = makeWorkflow();
        accounting.getWalletCashAvailable.mockResolvedValueOnce(0n);
        await wf.onDecided(decided('APPROVED') as any);
        expect(accounting.executeTransfer).not.toHaveBeenCalled();
        expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'FAILED', expect.objectContaining({ failureReasonCode: 'RECOGNITION_FAILED', failureNote: expect.stringMatching(/in-flight payouts/) }));
        expect(dispositions.unlinkTransfer).toHaveBeenCalledWith('ITR1');
        expect(fundsOrders.create).not.toHaveBeenCalled();
      });

      it('the chosen from wallet cannot pay any more → FAILED(INSUFFICIENT_FIRM_BALANCE), no 91 posted, no funds order, row lock released', async () => {
        const { wf, transfers, fundsOrders, accounting, dispositions } = makeWorkflow();
        accounting.assertWalletBalance.mockRejectedValueOnce(new Error('Insufficient USDT balance in wallet WA-OPS'));
        await wf.onDecided(decided('APPROVED') as any);
        expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'FAILED', expect.objectContaining({ failureReasonCode: 'INSUFFICIENT_FIRM_BALANCE' }));
        expect(accounting.executeTransfer).not.toHaveBeenCalled();
        expect(fundsOrders.create).not.toHaveBeenCalled();
        expect(dispositions.unlinkTransfer).toHaveBeenCalledWith('ITR1');
      });

      it('fiat: leg 1 is the chosen from wallet → settlement wallet, after the 91', async () => {
        const { wf, fundsOrders, accounting } = makeWorkflow({ asset: AED });
        await wf.onDecided(decided('APPROVED') as any);
        expect(accounting.executeTransfer.mock.calls[0][0].code).toBe(TB_TRANSFER_CODES.CLIENT_SHORTFALL_RECOGNIZED);
        expect(accounting.executeTransfer.mock.calls[0][0].ledger).toBe(TB_LEDGERS.AED);
        expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ legSeq: 1, fromWalletId: 'w-ops', toWalletId: 'w-set', fromIban: 'AE-OPS', toIban: 'AE-SET' }));
      });
    });

    describe('client advance · approved (unchanged: no recognition step)', () => {
      it('operating balance is not enough → FAILED(INSUFFICIENT_FIRM_BALANCE), no funds order', async () => {
        const { wf, transfers, fundsOrders, accounting } = makeWorkflow({ transferRow: advanceRow() });
        accounting.assertWalletBalance.mockRejectedValueOnce(new Error('Insufficient USDT balance in wallet WA-OPS'));
        await wf.onDecided(decided('APPROVED') as any);
        expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'FAILED', expect.objectContaining({ failureReasonCode: 'INSUFFICIENT_FIRM_BALANCE' }));
        expect(fundsOrders.create).not.toHaveBeenCalled();
      });
      it('creates leg 1 (crypto: operating account → customer) → EXECUTING + audit EXECUTION_STARTED; nothing posted at approval', async () => {
        const { wf, transfers, fundsOrders, auditLogs, accounting, dispositions } = makeWorkflow({ transferRow: advanceRow() });
        await wf.onDecided(decided('APPROVED') as any);
        expect(accounting.executeTransfer).not.toHaveBeenCalled();
        expect(accounting.getWalletCashAvailable).not.toHaveBeenCalled();
        expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ internalTransferId: 'uuid-itr', legSeq: 1, initialStatus: 'CREATED', amount: '7.5', fromWalletId: 'w-ops', toWalletId: 'w-cust', fromAddress: 'Tops', toAddress: 'Tcust' }));
        expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'EXECUTING', expect.objectContaining({ executedAt: expect.any(Date) }));
        expect(auditLogs.recordSystem.mock.calls[0][0]).toMatchObject({ action: 'INTERNAL_TRANSFER_EXECUTION_STARTED', approvalNo: 'APR1', causationId: 'uuid-apr' });
        expect(dispositions.unlinkTransfer).not.toHaveBeenCalled();
      });
      it('fiat leg 1 is operating account → settlement account', async () => {
        const { wf, fundsOrders } = makeWorkflow({ asset: AED, transferRow: advanceRow(AED) });
        await wf.onDecided(decided('APPROVED') as any);
        expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ legSeq: 1, fromWalletId: 'w-ops', toWalletId: 'w-set', fromIban: 'AE-OPS', toIban: 'AE-SET' }));
      });
    });
  });

  describe('handleFundsOrderChanged', () => {
    const executing = (asset: any, purpose: 'SHORTFALL_TOPUP' | 'CLIENT_ADVANCE' = 'SHORTFALL_TOPUP') => ({
      id: 'uuid-itr', transferNo: 'ITR1', purpose, status: S.EXECUTING, amount: '7.5', assetId: asset.id, asset,
      fromWalletId: 'w-ops', viaWalletId: asset.type === 'FIAT' ? 'w-set' : null, toWalletId: 'w-cust', customerId: 'uuid-cu', customerNo: 'CU1', reason: 'r',
      sourceCaseNo: 'REC1', sourceExternalLineId: null, explainedFlowId: purpose === 'SHORTFALL_TOPUP' ? 'flow-1' : null, explainedExternalLineId: purpose === 'SHORTFALL_TOPUP' ? 'line-1' : null,
      recognizedTbTransferId: purpose === 'SHORTFALL_TOPUP' ? 'tb-91' : null, effectiveDate: startOfBusinessDate(BUSINESS_DATE), lossSource: purpose === 'SHORTFALL_TOPUP' ? 'AGING' : null, sourceIncidentNo: null,
      traceId: 'trace-1', approvalNo: 'APR1',
    });
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
    it('CONFIRMED · final leg (crypto leg 1) of a SHORTFALL_TOPUP: 82 DR EXPENSE_RECON_LOSS / CR cash·fromWallet, 83 DR cash·toWallet / CR code 2 (custody shortfall, same customer wallet) — never the payable → SUCCESS + audit LEG_POSTED / SETTLED', async () => {
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
      // 83(戊波二):借 现金·客户钱包(toWalletId)/ 贷 码 2 托管短缺待补·同一只客户钱包——把批准时记下的短缺消掉;客户应付不动
      expect(accounting.executeTransfer.mock.calls[1][0]).toMatchObject({
        code: TB_TRANSFER_CODES.INTERNAL_TRANSFER_CLIENT_IN, amount: 7_500_000n, ledger: TB_LEDGERS.USDT,
        debitAccountId: cashAcct('w-cust', TB_LEDGERS.USDT), creditAccountId: shortfallAcct('w-cust', TB_LEDGERS.USDT),
        evidence: expect.objectContaining({ eventCode: 'INTERNAL_TRANSFER_SHORTFALL_TOPUP_IN', debitCode: 'A.CLIENT_CASH', creditCode: 'A.CLIENT_SHORTFALL', externalRef: '0xleg' }),
      });
      expect(accounting.resolveCashAccountId).toHaveBeenCalledWith('w-ops', TB_LEDGERS.USDT);
      expect(accounting.resolveCashAccountId).toHaveBeenCalledWith('w-cust', TB_LEDGERS.USDT);
      expect(accounting.resolveTbAccountId).toHaveBeenCalledWith(expect.objectContaining({ code: TB_ACCOUNT_CODES.EXPENSE_RECON_LOSS, ownerType: 'SYSTEM' }));
      expect(accounting.resolveTbAccountId).toHaveBeenCalledWith({ code: TB_ACCOUNT_CODES.CLIENT_SHORTFALL, ledger: TB_LEDGERS.USDT, ownerType: 'WALLET', ownerUuid: 'w-cust' });
      // 客户端零行的结构性保证:对账单只读客户应付户(码 100),认损补缺的两笔(91 / 83)与 82 一次都没取过它
      const resolvedCodes = (accounting.resolveTbAccountId.mock.calls as any[][]).map((c) => c[0].code);
      for (const gone of [TB_ACCOUNT_CODES.CLIENT_PAYABLE, TB_ACCOUNT_CODES.FIRM_CASH, TB_ACCOUNT_CODES.CLIENT_CASH, 201, TB_ACCOUNT_CODES.FIRM_EQUITY]) expect(resolvedCodes).not.toContain(gone);
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'SUCCESS', expect.objectContaining({ settledAt: expect.any(Date) }));
      expect(auditLogs.recordSystem.mock.calls.map((c: any) => c[0].action)).toEqual(['INTERNAL_TRANSFER_LEG_POSTED', 'INTERNAL_TRANSFER_SETTLED']);
      expect(auditLogs.recordSystem.mock.calls[1][0].reason).toMatch(/shortfall is cleared/);
    });
    it('CONFIRMED · final leg (fiat leg 2) of a CLIENT_ADVANCE: 82 credits the settlement wallet cash (via), 83 debits the customer wallet cash and STILL credits the payable (code 100) — the advance path is unchanged', async () => {
      const row = { ...executing(AED, 'CLIENT_ADVANCE'), amount: '900' };
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
      const { wf, accounting, fundsOrders } = makeWorkflow({ transferRow: executing(USDT, 'CLIENT_ADVANCE') });
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
    it('CONFIRMED · final leg (fiat leg 2) of a SHORTFALL_TOPUP: 82 credits the settlement wallet cash (via), 83 credits code 2 of the customer wallet on the AED ledger', async () => {
      const row = { ...executing(AED), amount: '900' };
      const { wf, accounting, fundsOrders, transfers } = makeWorkflow({ transferRow: row, asset: AED });
      fundsOrders.findById.mockResolvedValueOnce({ id: 'fo-2', fundsOrderNo: 'FO2', legSeq: 2, amount: '900', txHash: null, referenceNo: 'BANK-2', createdAt: new Date(), fromWalletId: 'w-set', toWalletId: 'w-cust' });
      await wf.handleFundsOrderChanged(evt(2, 'CONFIRMED') as any);
      expect(accounting.executeTransfer.mock.calls[0][0]).toMatchObject({ code: TB_TRANSFER_CODES.INTERNAL_TRANSFER_FIRM_OUT, creditAccountId: cashAcct('w-set', TB_LEDGERS.AED) });
      expect(accounting.executeTransfer.mock.calls[1][0]).toMatchObject({
        code: TB_TRANSFER_CODES.INTERNAL_TRANSFER_CLIENT_IN, amount: 90_000n, ledger: TB_LEDGERS.AED,
        debitAccountId: cashAcct('w-cust', TB_LEDGERS.AED), creditAccountId: shortfallAcct('w-cust', TB_LEDGERS.AED),
        evidence: expect.objectContaining({ eventCode: 'INTERNAL_TRANSFER_SHORTFALL_TOPUP_IN', creditCode: 'A.CLIENT_SHORTFALL' }),
      });
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'SUCCESS', expect.anything());
    });
    it('FAILED · fiat leg 2: order goes FAILED(LEG_FAILED), the note spells out that funds remain in the settlement account', async () => {
      const { wf, transfers } = makeWorkflow({ transferRow: executing(AED), asset: AED });
      await wf.handleFundsOrderChanged(evt(2, 'FAILED') as any);
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'FAILED', expect.objectContaining({ failureReasonCode: 'LEG_FAILED', failureNote: expect.stringContaining('settlement account') }));
    });
    // 裁定 15:91 已落账、腿却 FAILED——不做重补;短缺户挂着等人工,这行继续锁着(不解锁),同一行开不出第二张
    it('FAILED · crypto leg of a SHORTFALL_TOPUP (shortfall already recognized): FAILED(LEG_FAILED), the note says the shortfall stays open, and the row lock is NOT released (no re-top-up)', async () => {
      const { wf, transfers, dispositions } = makeWorkflow({ transferRow: executing(USDT) });
      await wf.handleFundsOrderChanged(evt(1, 'FAILED') as any);
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'FAILED', expect.objectContaining({ failureReasonCode: 'LEG_FAILED', failureNote: expect.stringMatching(/shortfall is already recognized.*stays open.*not re-opened/) }));
      expect(dispositions.unlinkTransfer).not.toHaveBeenCalled();
    });
    it('FAILED · crypto leg of a CLIENT_ADVANCE keeps the old note (no funds moved, can be reinitiated)', async () => {
      const { wf, transfers } = makeWorkflow({ transferRow: executing(USDT, 'CLIENT_ADVANCE') });
      await wf.handleFundsOrderChanged(evt(1, 'TIMEOUT') as any);
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'FAILED', expect.objectContaining({ failureNote: expect.stringContaining('can be reinitiated') }));
    });
  });

  describe('cancel', () => {
    it('pending-approval transfers can be cancelled: cancels the approval first, then flips to CANCELLED, releases the row lock + audit', async () => {
      const { wf, approvals, transfers, auditLogs, dispositions } = makeWorkflow();
      const r = await wf.cancel('ITR1', { reason: 'Opened by mistake' }, treasury);
      expect(approvals.cancel).toHaveBeenCalledWith('APR1', { reason: 'Opened by mistake' }, treasury);
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'CANCELLED', expect.objectContaining({ failureNote: 'Opened by mistake' }));
      expect(dispositions.unlinkTransfer).toHaveBeenCalledWith('ITR1');
      expect(r.status).toBe('CANCELLED');
      expect(auditLogs.recordByActor.mock.calls[0][0].action).toBe('INTERNAL_TRANSFER_CANCELLED');
    });
    it('cannot cancel while executing (and the row lock stays)', async () => {
      const { wf, dispositions } = makeWorkflow({ transferRow: { transferNo: 'ITR1', status: S.EXECUTING, asset: USDT } });
      await expect(wf.cancel('ITR1', { reason: 'x' }, treasury)).rejects.toThrow(/cannot be cancelled/);
      expect(dispositions.unlinkTransfer).not.toHaveBeenCalled();
    });
  });
});
