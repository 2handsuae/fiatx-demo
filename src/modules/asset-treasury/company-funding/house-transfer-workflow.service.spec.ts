import { BadRequestException } from '@nestjs/common';
import { HouseTransferWorkflowService } from './house-transfer-workflow.service';
import { HouseTransferStatus as S } from './dto/house-transfer.dto';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { bigintToHex } from '../../accounting/tigerbeetle/utils/tb-id.util';

const AED = { id: 'a-aed', assetNo: 'AST-AED', code: 'AED', currency: 'AED', decimals: 2, type: 'FIAT' };
const USDT = { id: 'a-usdt', assetNo: 'AST-USDT', code: 'USDT-TRON', currency: 'USDT', decimals: 6, type: 'CRYPTO' };
const OPS = { id: 'w-ops', walletNo: 'WA-OPS', vaultCode: 'F_OPS', address: 'Tops', iban: 'AE-OPS' };
const FEE = { id: 'w-fee', walletNo: 'WA-FEE', vaultCode: 'F_FEE', address: 'Tfee', iban: 'AE-FEE' };
const SET = { id: 'w-set', walletNo: 'WA-SET', vaultCode: 'F_SET', address: null, iban: 'AE-SET' };
const WALLETS: Record<string, any> = { [OPS.id]: OPS, [FEE.id]: FEE, [SET.id]: SET };

const treasury = { actorType: 'ADMIN' as const, userId: 'uuid-tre', userNo: 'ADM-TRE', roleCodes: ['TREASURY_OFFICER'] };

// 按 (code, ledger) / (钱包 id, ledger) 编出不同的账户 id——传错钱包 / 账本 / 科目，断言里的期望 id 就对不上。
const acct = (code: number, ledger: number): bigint => BigInt(code) * 100n + BigInt(ledger);
const cashAcct = (walletId: string, ledger: number): bigint => BigInt(`0x${Buffer.from(`cash:${walletId}@${ledger}`).toString('hex')}`);

type Route = 'sweep' | 'refill';

function makeRow(o: { asset?: any; route?: Route; status?: string; amount?: string; extra?: Record<string, unknown> } = {}) {
  const asset = o.asset ?? AED;
  const [from, to] = (o.route ?? 'sweep') === 'sweep' ? [FEE, OPS] : [OPS, FEE];
  return {
    id: 'uuid-htr', transferNo: 'HTR1', purpose: 'FEE_SWEEP', status: o.status ?? S.PENDING_APPROVAL, amount: o.amount ?? '100',
    assetId: asset.id, asset, fromWalletId: from.id, toWalletId: to.id, fromWallet: from, toWallet: to,
    reason: 'sweep fees', approvalNo: 'APR1', fundsOrderNo: null, closeTbTransferIds: null, traceId: 'trace-1', ...(o.extra ?? {}),
  };
}

function makeWorkflow(o: { row?: any; income?: Partial<Record<number, bigint>> } = {}) {
  const row = o.row ?? makeRow();
  const asset = row.asset;
  const income = { [TB_ACCOUNT_CODES.INCOME_SWAP_FEE]: 0n, [TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE]: 0n, [TB_ACCOUNT_CODES.INCOME_OTHER]: 0n, ...(o.income ?? {}) };
  const ledger = TB_LEDGERS[asset.currency as keyof typeof TB_LEDGERS];
  const incomeByAcct = new Map<bigint, bigint>(Object.entries(income).map(([code, bal]) => [acct(Number(code), ledger), bal as bigint]));

  const prisma: any = { asset: { findUnique: jest.fn(async () => asset) } };
  const houseTransfers: any = {
    create: jest.fn(async (input: any) => ({ ...makeRow({ asset }), ...input, amount: input.amount, fromWallet: WALLETS[input.fromWalletId], toWallet: WALLETS[input.toWalletId] })),
    findByNo: jest.fn(async () => row),
    findById: jest.fn(async () => row),
    transition: jest.fn(async (_no: string, to: string, patch: any) => ({ ...row, status: to, ...patch })),
    stampApprovalNo: jest.fn(async () => undefined),
    stampFailure: jest.fn(async () => undefined),
  };
  const approvals: any = { createAndSubmit: jest.fn(async () => ({ approvalNo: 'APR1' })), cancel: jest.fn(async () => ({})) };
  let nextTbId = 9000n;
  const accounting: any = {
    assertWalletBalance: jest.fn(async () => undefined),
    resolveCashAccountId: jest.fn(async (walletId: string, l: number) => cashAcct(walletId, l)),
    resolveTbAccountId: jest.fn(async ({ code, ledger: l }: any) => acct(code, l)),
    lookupBalance: jest.fn(async (id: bigint) => ({ debitsPosted: 0n, creditsPosted: incomeByAcct.get(id) ?? 0n, debitsPending: 0n, creditsPending: 0n })),
    executeTransfer: jest.fn(async () => ({ tbTransferId: nextTbId++ })),
  };
  const auditLogs: any = { recordByActor: jest.fn(async () => ({})), recordSystem: jest.fn(async () => ({})) };
  const fundsOrders: any = {
    create: jest.fn(async (input: any) => ({ id: 'fo-1', fundsOrderNo: 'FDO1', ...input })),
    findById: jest.fn(async () => ({ id: 'fo-1', fundsOrderNo: 'FDO1', legSeq: 1, amount: String(row.amount), txHash: null, referenceNo: 'BANKREF1', fromWalletId: row.fromWalletId, toWalletId: row.toWalletId })),
    advance: jest.fn(async () => ({})),
    stampExternalRef: jest.fn(async () => ({ referenceNo: 'BANKREF1' })),
    resolveExternalRef: jest.fn(() => 'BANKREF1'),
  };
  const firmWallets: any = {
    assertEligible: jest.fn(async (walletId: string) => {
      const w = WALLETS[walletId];
      if (!w || w.vaultCode === 'F_SET') throw new BadRequestException({ code: 'FROM_WALLET_NOT_ELIGIBLE', message: `Wallet ${w?.walletNo ?? '-'} cannot be chosen` });
      return w;
    }),
  };
  const custodianStatement: any = { recordLegMovement: jest.fn(async () => ({ outLineId: 'l1', inLineId: 'l2', cutoffDate: '2026-11-07' })) };
  const wf = new HouseTransferWorkflowService(prisma, houseTransfers, approvals, accounting, auditLogs, fundsOrders, firmWallets, custodianStatement);
  return { wf, prisma, houseTransfers, approvals, accounting, auditLogs, fundsOrders, firmWallets, custodianStatement, row, ledger };
}

const input = (o: Partial<{ fromWalletId: string; toWalletId: string; amount: string }> = {}) => ({
  purpose: 'FEE_SWEEP' as const, assetId: AED.id, amount: '100', fromWalletId: FEE.id, toWalletId: OPS.id, reason: 'Sweep fee income into operations', ...o,
});
const auditActions = (m: { auditLogs: any }) => [...m.auditLogs.recordByActor.mock.calls, ...m.auditLogs.recordSystem.mock.calls].map((c: any[]) => c[0].action);
const decided = (decision: any, extra: Record<string, unknown> = {}) => ({ decision, actionType: 'HOUSE_TRANSFER_APPROVAL', entityRef: 'HTR1', approvalId: 'uuid-apr', approvalNo: 'APR1', traceId: 'trace-1', workflowType: 'HOUSE_TRANSFER', metadata: {}, ...extra });
const legEvent = (newStatus: string) => ({ fundsOrderId: 'fo-1', fundsOrderNo: 'FDO1', parent: { houseTransferId: 'uuid-htr' }, legSeq: 1, attempt: 1, oldStatus: null, newStatus });

describe('HouseTransferWorkflowService（戊波二 T5）', () => {
  describe('initiate — 建单守卫', () => {
    it('from = to → 400，不建单、不提审', async () => {
      const m = makeWorkflow();
      await expect(m.wf.initiate(input({ fromWalletId: OPS.id, toWalletId: OPS.id }), treasury)).rejects.toThrow(/must be two different wallets/);
      expect(m.houseTransfers.create).not.toHaveBeenCalled();
      expect(m.approvals.createAndSubmit).not.toHaveBeenCalled();
    });
    it('from 与 to 都过 FirmWalletPicker（同一个资产）；结算户 F_SET 当 from 或 to 都被拒，不建单', async () => {
      const m = makeWorkflow();
      await m.wf.initiate(input(), treasury);
      expect(m.firmWallets.assertEligible).toHaveBeenCalledWith(FEE.id, AED.id);
      expect(m.firmWallets.assertEligible).toHaveBeenCalledWith(OPS.id, AED.id);
      for (const bad of [input({ fromWalletId: SET.id }), input({ toWalletId: SET.id })]) {
        const m2 = makeWorkflow();
        await expect(m2.wf.initiate(bad, treasury)).rejects.toMatchObject({ response: { code: 'FROM_WALLET_NOT_ELIGIBLE' } });
        expect(m2.houseTransfers.create).not.toHaveBeenCalled();
      }
    });
    it('from 余额不够 → 拒（共用余额闸，对象 = from 钱包、账本 = 资产币种、金额 = 最小单位），不建单', async () => {
      const m = makeWorkflow();
      m.accounting.assertWalletBalance.mockRejectedValueOnce(new BadRequestException({ code: 'INSUFFICIENT_FIRM_BALANCE', message: 'Insufficient AED balance' }));
      await expect(m.wf.initiate(input(), treasury)).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_FIRM_BALANCE' } });
      expect(m.accounting.assertWalletBalance).toHaveBeenCalledWith(FEE.id, TB_LEDGERS.AED, 10_000n);
      expect(m.houseTransfers.create).not.toHaveBeenCalled();
    });
    it('两个方向都直接开单（钱在公司自己口袋之间挪、NLA 不变，不过 NLA 门——戊波三 裁定 2；服务已不持有审慎门，「不调门」由 e2e 行为断言）：运营→手续费、手续费→运营', async () => {
      const refill = makeWorkflow({ row: makeRow({ route: 'refill' }) });
      await refill.wf.initiate(input({ fromWalletId: OPS.id, toWalletId: FEE.id }), treasury);
      expect(refill.houseTransfers.create).toHaveBeenCalledTimes(1);
      const sweep = makeWorkflow();
      await sweep.wf.initiate(input(), treasury);
      expect(sweep.houseTransfers.create).toHaveBeenCalledTimes(1);
    });
    it('通过：建单落两只钱包与用途、提 CFO 审批（快照零 UUID，带两只钱包号 / 金额 / 影响摘要）、回填审批号、写 REQUESTED', async () => {
      const m = makeWorkflow();
      const out = await m.wf.initiate(input(), treasury);
      expect(out).toEqual({ transferNo: 'HTR1', approvalNo: 'APR1', status: 'PENDING_APPROVAL' });
      expect(m.houseTransfers.create).toHaveBeenCalledWith(expect.objectContaining({
        purpose: 'FEE_SWEEP', assetId: AED.id, amount: '100', fromWalletId: FEE.id, toWalletId: OPS.id, createdByUserId: 'ADM-TRE',
      }));
      const submitted = m.approvals.createAndSubmit.mock.calls[0][0];
      expect(submitted.actionType).toBe('HOUSE_TRANSFER_APPROVAL');
      expect(submitted.entityRef).toBe('HTR1');
      expect(submitted.objectSnapshot).toMatchObject({ transferNo: 'HTR1', purpose: 'FEE_SWEEP', fromWalletNo: 'WA-FEE', toWalletNo: 'WA-OPS', amount: '100.00 AED' });
      expect(JSON.stringify(submitted.objectSnapshot)).not.toMatch(/uuid-|w-fee|w-ops|a-aed/);
      expect(submitted.objectSnapshot.impact).toContain('closed into firm equity'); // 手续费户 → 运营户：审批人要看到会同额结转
      expect(m.houseTransfers.stampApprovalNo).toHaveBeenCalledWith('HTR1', 'APR1');
      expect(m.auditLogs.recordByActor).toHaveBeenCalledTimes(1);
      expect(m.auditLogs.recordByActor.mock.calls[0][0]).toMatchObject({
        action: 'HOUSE_TRANSFER_REQUESTED', actionDomain: 'TREASURY', workflowType: 'HOUSE_TRANSFER',
        primarySubjectType: 'HOUSE_TRANSFER', primarySubjectNo: 'HTR1', amount: '100.00', approvalNo: 'APR1', reason: 'Sweep fee income into operations',
      });
      expect(m.auditLogs.recordByActor.mock.calls[0][0].requestId).toMatch(/^HOUSE_TRANSFER_REQUESTED_HTR1_/);
      expect(m.auditLogs.recordByActor.mock.calls[0][0].metadata).toMatchObject({ fromWalletNo: 'WA-FEE', toWalletNo: 'WA-OPS', purpose: 'FEE_SWEEP' });
    });
    it('运营户 → 手续费户的审批摘要不提结转（没有结转）', async () => {
      const m = makeWorkflow({ row: makeRow({ route: 'refill' }) });
      await m.wf.initiate(input({ fromWalletId: OPS.id, toWalletId: FEE.id }), treasury);
      expect(m.approvals.createAndSubmit.mock.calls[0][0].objectSnapshot.impact).not.toContain('closed into firm equity');
    });
  });

  describe('cancel', () => {
    it('待批 → 撤审批单、迁 CANCELLED、写 CANCELLED（带操作人与前后状态）', async () => {
      const m = makeWorkflow();
      const out = await m.wf.cancel('HTR1', { reason: 'changed my mind' }, treasury);
      expect(m.approvals.cancel).toHaveBeenCalledWith('APR1', { reason: 'changed my mind' }, treasury);
      expect(m.houseTransfers.transition).toHaveBeenCalledWith('HTR1', S.CANCELLED, expect.anything());
      expect(out).toEqual({ transferNo: 'HTR1', status: 'CANCELLED' });
      expect(m.auditLogs.recordByActor.mock.calls[0][0]).toMatchObject({ action: 'HOUSE_TRANSFER_CANCELLED', reason: 'changed my mind', fromStatus: 'PENDING_APPROVAL', toStatus: 'CANCELLED' });
    });
    it('执行中 / 终态不许撤回 → 400，不动审批、不迁状态', async () => {
      const m = makeWorkflow({ row: makeRow({ status: S.EXECUTING }) });
      await expect(m.wf.cancel('HTR1', { reason: 'x' }, treasury)).rejects.toThrow(/cannot be cancelled/);
      expect(m.approvals.cancel).not.toHaveBeenCalled();
      expect(m.houseTransfers.transition).not.toHaveBeenCalled();
    });
  });

  describe('onDecided — 审批裁决', () => {
    it('拒绝 → REJECTED，审计带审批因果与拒绝理由', async () => {
      const m = makeWorkflow();
      await m.wf.onDecided(decided('DECLINED', { decisionReason: 'not now' }) as any);
      expect(m.houseTransfers.transition).toHaveBeenCalledWith('HTR1', S.REJECTED, expect.objectContaining({ failureNote: 'not now' }));
      expect(m.auditLogs.recordSystem.mock.calls[0][0]).toMatchObject({ action: 'HOUSE_TRANSFER_REJECTED', approvalNo: 'APR1', causationId: 'uuid-apr', reason: 'not now', fromStatus: 'PENDING_APPROVAL', toStatus: 'REJECTED' });
    });
    it('超时 → REJECTED（理由 Approval expired）', async () => {
      const m = makeWorkflow();
      await m.wf.onDecided(decided('EXPIRED') as any);
      expect(m.auditLogs.recordSystem.mock.calls[0][0]).toMatchObject({ action: 'HOUSE_TRANSFER_REJECTED', reason: 'Approval expired' });
    });
    it('撤回裁决不在这里处理（cancel() 自己收口）', async () => {
      const m = makeWorkflow();
      await m.wf.onDecided(decided('CANCELLED') as any);
      expect(m.houseTransfers.transition).not.toHaveBeenCalled();
      expect(auditActions(m)).toEqual([]);
    });
    it('不是待批态的单收到裁决 → 忽略', async () => {
      const m = makeWorkflow({ row: makeRow({ status: S.EXECUTING }) });
      await m.wf.onDecided(decided('APPROVED') as any);
      expect(m.houseTransfers.transition).not.toHaveBeenCalled();
      expect(m.fundsOrders.create).not.toHaveBeenCalled();
    });
    it('批准但 from 余额已不够 → FAILED(INSUFFICIENT_FIRM_BALANCE)，不建腿，写 FAILED', async () => {
      const m = makeWorkflow();
      m.accounting.assertWalletBalance.mockRejectedValueOnce(new Error('Insufficient AED balance in wallet WA-FEE'));
      await m.wf.onDecided(decided('APPROVED') as any);
      expect(m.accounting.assertWalletBalance).toHaveBeenCalledWith(FEE.id, TB_LEDGERS.AED, 10_000n);
      expect(m.houseTransfers.transition).toHaveBeenCalledWith('HTR1', S.FAILED, expect.objectContaining({ failureReasonCode: 'INSUFFICIENT_FIRM_BALANCE' }));
      expect(m.fundsOrders.create).not.toHaveBeenCalled();
      expect(m.auditLogs.recordSystem.mock.calls[0][0]).toMatchObject({ action: 'HOUSE_TRANSFER_FAILED', outcome: 'FAILED', reasonCode: 'INSUFFICIENT_FIRM_BALANCE', approvalNo: 'APR1', causationId: 'uuid-apr', fromStatus: 'PENDING_APPROVAL', toStatus: 'FAILED' });
    });
    it('批准且余额够 → 建唯一一条腿（父键 houseTransferId、legSeq 1、CREATED 出生、from → to 钱包与坐标）、迁 EXECUTING 并回填资金单号、写 EXECUTION_STARTED', async () => {
      const m = makeWorkflow();
      await m.wf.onDecided(decided('APPROVED') as any);
      expect(m.fundsOrders.create).toHaveBeenCalledTimes(1);
      expect(m.fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({
        houseTransferId: 'uuid-htr', legSeq: 1, initialStatus: 'CREATED', assetId: AED.id, amount: '100', netAmount: '100',
        fromWalletId: FEE.id, fromIban: 'AE-FEE', toWalletId: OPS.id, toIban: 'AE-OPS', traceId: 'trace-1',
      }));
      expect(m.houseTransfers.transition).toHaveBeenCalledWith('HTR1', S.EXECUTING, expect.objectContaining({ fundsOrderNo: 'FDO1', executedAt: expect.any(Date) }));
      expect(m.auditLogs.recordSystem.mock.calls[0][0]).toMatchObject({ action: 'HOUSE_TRANSFER_EXECUTION_STARTED', approvalNo: 'APR1', causationId: 'uuid-apr', metadata: { fundsOrderNo: 'FDO1' }, fromStatus: 'PENDING_APPROVAL', toStatus: 'EXECUTING' });
    });
  });

  describe('腿事件', () => {
    it('不是调拨单的腿（父键里没有 houseTransferId）→ 忽略', async () => {
      const m = makeWorkflow({ row: makeRow({ status: S.EXECUTING }) });
      await m.wf.handleFundsOrderChanged({ ...legEvent('CONFIRMED'), parent: { vendorPaymentId: 'x' } } as any);
      expect(m.houseTransfers.findById).not.toHaveBeenCalled();
      expect(m.accounting.executeTransfer).not.toHaveBeenCalled();
    });

    it('SUBMITTED：铸参考号后模拟托管方两侧都写（from 一行 OUT、to 一行 IN），带同一个 externalRef 与最小单位金额', async () => {
      const m = makeWorkflow({ row: makeRow({ status: S.EXECUTING }) });
      await m.wf.handleFundsOrderChanged(legEvent('SUBMITTED') as any);
      expect(m.fundsOrders.stampExternalRef).toHaveBeenCalledWith('fo-1');
      expect(m.custodianStatement.recordLegMovement).toHaveBeenCalledTimes(1);
      expect(m.custodianStatement.recordLegMovement).toHaveBeenCalledWith(expect.objectContaining({
        fundsOrderNo: 'FDO1', fromWalletId: FEE.id, toWalletId: OPS.id, assetCode: 'AED', assetType: 'FIAT', amountMinor: 10_000n, externalRef: 'BANKREF1',
      }));
      expect(m.accounting.executeTransfer).not.toHaveBeenCalled(); // 提交不记账
    });

    describe('CONFIRMED — 落账', () => {
      const sweepRow = (amount: string, asset: any = AED) => makeRow({ route: 'sweep', status: S.EXECUTING, amount, asset });
      const callOf = (m: { accounting: any }, i: number) => m.accounting.executeTransfer.mock.calls[i][0];

      it('运营户 → 手续费户：只有 89（借 to 现金 / 贷 from 现金，借贷码 A.FIRM_CASH 同源同流水号），无 90、不读收入户；清算 → LEG_POSTED → SUCCESS → SETTLED', async () => {
        const m = makeWorkflow({ row: makeRow({ route: 'refill', status: S.EXECUTING, amount: '100' }), income: { [TB_ACCOUNT_CODES.INCOME_SWAP_FEE]: 5_000n } });
        await m.wf.handleFundsOrderChanged(legEvent('CONFIRMED') as any);
        expect(m.accounting.executeTransfer).toHaveBeenCalledTimes(1);
        const t = callOf(m, 0);
        expect(t).toMatchObject({ debitAccountId: cashAcct(FEE.id, m.ledger), creditAccountId: cashAcct(OPS.id, m.ledger), amount: 10_000n, ledger: m.ledger, code: TB_TRANSFER_CODES.HOUSE_TRANSFER });
        expect(t.evidence).toMatchObject({ sourceType: 'HOUSE_TRANSFER', sourceNo: 'HTR1', eventCode: 'HOUSE_TRANSFER', debitCode: 'A.FIRM_CASH', creditCode: 'A.FIRM_CASH', assetCurrency: 'AED', externalRef: 'BANKREF1', traceId: 'trace-1' });
        expect(m.accounting.lookupBalance).not.toHaveBeenCalled();
        expect(m.fundsOrders.advance).toHaveBeenCalledWith('fo-1', 'CLEAR', 'HOUSE_TRANSFER_WORKFLOW');
        const patch = m.houseTransfers.transition.mock.calls[0][2];
        expect(m.houseTransfers.transition.mock.calls[0][1]).toBe(S.SUCCESS);
        expect(patch.settledAt).toBeInstanceOf(Date);
        expect(patch.closeTbTransferIds).toBeUndefined(); // 没结转：不写回执
        expect(auditActions(m)).toEqual(['HOUSE_TRANSFER_LEG_POSTED', 'HOUSE_TRANSFER_SETTLED']);
        expect(m.auditLogs.recordSystem.mock.calls[1][0]).toMatchObject({ action: 'HOUSE_TRANSFER_SETTLED', fromStatus: 'EXECUTING', toStatus: 'SUCCESS', amount: '100.00' });
      });

      it('手续费户 → 运营户、收入够（Σ 210..212 恰等于金额）：89 之后三笔 90，借 210 → 211 → 212、贷 200，eventCode 各异，回执按落账顺序存', async () => {
        const m = makeWorkflow({ row: sweepRow('60'), income: { [TB_ACCOUNT_CODES.INCOME_SWAP_FEE]: 3_000n, [TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE]: 2_000n, [TB_ACCOUNT_CODES.INCOME_OTHER]: 1_000n } });
        await m.wf.handleFundsOrderChanged(legEvent('CONFIRMED') as any);
        expect(m.accounting.executeTransfer).toHaveBeenCalledTimes(4);
        expect(callOf(m, 0).code).toBe(TB_TRANSFER_CODES.HOUSE_TRANSFER); // 89 先
        const expected = [
          { income: 210, eventCode: 'FEE_INCOME_CLOSE_SWAP', coa: 'E.INCOME_SWAP_FEE', amount: 3_000n },
          { income: 211, eventCode: 'FEE_INCOME_CLOSE_WITHDRAW', coa: 'E.INCOME_WITHDRAW_FEE', amount: 2_000n },
          { income: 212, eventCode: 'FEE_INCOME_CLOSE_OTHER', coa: 'E.INCOME_OTHER', amount: 1_000n },
        ];
        expected.forEach((e, i) => {
          const t = callOf(m, i + 1);
          expect(t).toMatchObject({ debitAccountId: acct(e.income, m.ledger), creditAccountId: acct(TB_ACCOUNT_CODES.FIRM_EQUITY, m.ledger), amount: e.amount, ledger: m.ledger, code: TB_TRANSFER_CODES.FEE_INCOME_CLOSE });
          expect(t.evidence).toMatchObject({ sourceType: 'HOUSE_TRANSFER', sourceNo: 'HTR1', eventCode: e.eventCode, debitCode: e.coa, creditCode: 'E.FIRM_EQUITY', assetCurrency: 'AED' });
        });
        expect(new Set([1, 2, 3].map((i) => callOf(m, i).evidence.eventCode)).size).toBe(3);
        // 回执：三笔 90 的转账号（executeTransfer 依次返回 9000n、9001n、9002n、9003n；9000n 是 89，不入回执）
        expect(JSON.parse(m.houseTransfers.transition.mock.calls[0][2].closeTbTransferIds)).toEqual([bigintToHex(9001n), bigintToHex(9002n), bigintToHex(9003n)]);
        expect(auditActions(m)).toEqual(['HOUSE_TRANSFER_LEG_POSTED', 'HOUSE_TRANSFER_SETTLED']);
      });

      it('扫一半（金额 45 < Σ60）：210 全扣、211 只扣到够，212 不碰——89 + 两笔 90', async () => {
        const m = makeWorkflow({ row: sweepRow('45'), income: { [TB_ACCOUNT_CODES.INCOME_SWAP_FEE]: 3_000n, [TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE]: 2_000n, [TB_ACCOUNT_CODES.INCOME_OTHER]: 1_000n } });
        await m.wf.handleFundsOrderChanged(legEvent('CONFIRMED') as any);
        expect(m.accounting.executeTransfer).toHaveBeenCalledTimes(3);
        expect(callOf(m, 1)).toMatchObject({ debitAccountId: acct(210, m.ledger), amount: 3_000n });
        expect(callOf(m, 2)).toMatchObject({ debitAccountId: acct(211, m.ledger), amount: 1_500n });
        expect(JSON.parse(m.houseTransfers.transition.mock.calls[0][2].closeTbTransferIds)).toHaveLength(2);
      });

      it('封顶（金额 100 > Σ60，手续费户里有运营户调来的钱）：结转总额 = Σ 收入，三户各扣全额，不多结转', async () => {
        const m = makeWorkflow({ row: sweepRow('100'), income: { [TB_ACCOUNT_CODES.INCOME_SWAP_FEE]: 3_000n, [TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE]: 2_000n, [TB_ACCOUNT_CODES.INCOME_OTHER]: 1_000n } });
        await m.wf.handleFundsOrderChanged(legEvent('CONFIRMED') as any);
        const closes = [1, 2, 3].map((i) => callOf(m, i).amount as bigint);
        expect(m.accounting.executeTransfer).toHaveBeenCalledTimes(4);
        expect(closes).toEqual([3_000n, 2_000n, 1_000n]);
        expect(closes.reduce((a, b) => a + b, 0n)).toBe(6_000n);
        expect(callOf(m, 0).amount).toBe(10_000n); // 89 仍是整额
      });

      it('收入户全是 0：只有 89，不产出 0 额的 90，也不写回执', async () => {
        const m = makeWorkflow({ row: sweepRow('100') });
        await m.wf.handleFundsOrderChanged(legEvent('CONFIRMED') as any);
        expect(m.accounting.executeTransfer).toHaveBeenCalledTimes(1);
        expect(m.houseTransfers.transition.mock.calls[0][2].closeTbTransferIds).toBeUndefined();
      });

      it('读收入户余额取的是该资产账本上的 SYSTEM 户（USDT 单不读 AED 账本）', async () => {
        const row = makeRow({ route: 'sweep', status: S.EXECUTING, amount: '10', asset: USDT });
        const m = makeWorkflow({ row, income: { [TB_ACCOUNT_CODES.INCOME_SWAP_FEE]: 4_000_000n } });
        await m.wf.handleFundsOrderChanged(legEvent('CONFIRMED') as any);
        expect(m.ledger).toBe(TB_LEDGERS.USDT);
        expect(m.accounting.resolveTbAccountId).toHaveBeenCalledWith({ code: 210, ledger: TB_LEDGERS.USDT, ownerType: 'SYSTEM' });
        expect(callOf(m, 0).amount).toBe(10_000_000n);
        expect(callOf(m, 1)).toMatchObject({ debitAccountId: acct(210, TB_LEDGERS.USDT), amount: 4_000_000n, ledger: TB_LEDGERS.USDT });
      });

      it('89 被账本拒（落账失败 = 流程失败）：写 FAILED(POSTING_FAILED)，单停在 EXECUTING——不清算、不迁状态、不写 LEG_POSTED / SETTLED、不碰 90、不重试', async () => {
        const m = makeWorkflow({ row: sweepRow('100'), income: { [TB_ACCOUNT_CODES.INCOME_SWAP_FEE]: 3_000n } });
        m.accounting.executeTransfer.mockRejectedValueOnce(new Error('TigerBeetle transfer rejected: exceeds_credits'));
        await m.wf.handleFundsOrderChanged(legEvent('CONFIRMED') as any);
        expect(m.accounting.executeTransfer).toHaveBeenCalledTimes(1);
        expect(m.fundsOrders.advance).not.toHaveBeenCalled();
        expect(m.houseTransfers.transition).not.toHaveBeenCalled();
        expect(m.houseTransfers.stampFailure).toHaveBeenCalledWith('HTR1', 'POSTING_FAILED', expect.stringContaining('exceeds_credits')); // 卡在哪、为什么，记在行上
        expect(auditActions(m)).toEqual(['HOUSE_TRANSFER_FAILED']);
        expect(m.auditLogs.recordSystem.mock.calls[0][0]).toMatchObject({ action: 'HOUSE_TRANSFER_FAILED', outcome: 'FAILED', reasonCode: 'POSTING_FAILED', metadata: { fundsOrderNo: 'FDO1' } });
        expect(m.auditLogs.recordSystem.mock.calls[0][0].reason).toContain('exceeds_credits');
        expect(m.auditLogs.recordSystem.mock.calls[0][0].toStatus).toBeUndefined(); // 状态没变
      });

      it('第二笔 90 被账本拒：同样停在 EXECUTING + POSTING_FAILED，不补偿已落的 89 / 第一笔 90（禁做清单：补偿 / repair）', async () => {
        const m = makeWorkflow({ row: sweepRow('100'), income: { [TB_ACCOUNT_CODES.INCOME_SWAP_FEE]: 3_000n, [TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE]: 2_000n } });
        m.accounting.executeTransfer
          .mockResolvedValueOnce({ tbTransferId: 1n }).mockResolvedValueOnce({ tbTransferId: 2n }).mockRejectedValueOnce(new Error('rejected'));
        await m.wf.handleFundsOrderChanged(legEvent('CONFIRMED') as any);
        expect(m.accounting.executeTransfer).toHaveBeenCalledTimes(3); // 89、210、211（被拒），之后什么也不做
        expect(m.fundsOrders.advance).not.toHaveBeenCalled();
        expect(m.houseTransfers.transition).not.toHaveBeenCalled();
        expect(auditActions(m)).toEqual(['HOUSE_TRANSFER_FAILED']);
        expect(m.auditLogs.recordSystem.mock.calls[0][0]).toMatchObject({ reasonCode: 'POSTING_FAILED' });
      });

      it('单已不在 EXECUTING（比如已 SUCCESS / FAILED）收到腿确认事件 → 忽略，不重复落账', async () => {
        const m = makeWorkflow({ row: makeRow({ status: S.SUCCESS }) });
        await m.wf.handleFundsOrderChanged(legEvent('CONFIRMED') as any);
        expect(m.accounting.executeTransfer).not.toHaveBeenCalled();
      });
    });

    it.each(['FAILED', 'TIMEOUT'])('腿 %s → 单 FAILED(LEG_FAILED)，写 FAILED，不落任何分录', async (leg) => {
      const m = makeWorkflow({ row: makeRow({ status: S.EXECUTING }) });
      await m.wf.handleFundsOrderChanged(legEvent(leg) as any);
      expect(m.houseTransfers.transition).toHaveBeenCalledWith('HTR1', S.FAILED, expect.objectContaining({ failureReasonCode: 'LEG_FAILED' }));
      expect(m.accounting.executeTransfer).not.toHaveBeenCalled();
      expect(auditActions(m)).toEqual(['HOUSE_TRANSFER_FAILED']);
      expect(m.auditLogs.recordSystem.mock.calls[0][0]).toMatchObject({ outcome: 'FAILED', reasonCode: 'LEG_FAILED', metadata: { fundsOrderNo: 'FDO1' }, fromStatus: 'EXECUTING', toStatus: 'FAILED' });
    });
  });

  describe('审计：七码各有写点，信封零 UUID', () => {
    it('REQUESTED / CANCELLED / REJECTED / EXECUTION_STARTED / LEG_POSTED / SETTLED / FAILED 全部被走到过', async () => {
      const seen = new Set<string>();
      const collect = (m: { auditLogs: any }) => auditActions(m).forEach((a) => seen.add(a));
      const a = makeWorkflow(); await a.wf.initiate(input(), treasury); collect(a);
      const b = makeWorkflow(); await b.wf.cancel('HTR1', { reason: 'r' }, treasury); collect(b);
      const c = makeWorkflow(); await c.wf.onDecided(decided('DECLINED') as any); collect(c);
      const d = makeWorkflow(); await d.wf.onDecided(decided('APPROVED') as any); collect(d);
      const e = makeWorkflow({ row: makeRow({ status: S.EXECUTING }) }); await e.wf.handleFundsOrderChanged(legEvent('CONFIRMED') as any); collect(e);
      const f = makeWorkflow({ row: makeRow({ status: S.EXECUTING }) }); await f.wf.handleFundsOrderChanged(legEvent('FAILED') as any); collect(f);
      expect([...seen].sort()).toEqual([
        'HOUSE_TRANSFER_CANCELLED', 'HOUSE_TRANSFER_EXECUTION_STARTED', 'HOUSE_TRANSFER_FAILED', 'HOUSE_TRANSFER_LEG_POSTED',
        'HOUSE_TRANSFER_REJECTED', 'HOUSE_TRANSFER_REQUESTED', 'HOUSE_TRANSFER_SETTLED',
      ]);
    });
    it('信封：主体 HOUSE_TRANSFER·transferNo，from / to 钱包 RELATED，有审批号挂 INSTRUMENT，有资金单挂 RELATED；全程不出现 UUID / walletId', async () => {
      const m = makeWorkflow();
      await m.wf.onDecided(decided('APPROVED') as any);
      const env = m.auditLogs.recordSystem.mock.calls[0][0];
      expect(env.subjects).toEqual(expect.arrayContaining([
        { subjectType: 'HOUSE_TRANSFER', subjectNo: 'HTR1', subjectRole: 'PRIMARY' },
        { subjectType: 'WALLET', subjectNo: 'WA-FEE', subjectRole: 'RELATED' },
        { subjectType: 'WALLET', subjectNo: 'WA-OPS', subjectRole: 'RELATED' },
        { subjectType: 'APPROVAL_CASE', subjectNo: 'APR1', subjectRole: 'INSTRUMENT' },
        { subjectType: 'FUNDS_ORDER', subjectNo: 'FDO1', subjectRole: 'RELATED' },
      ]));
      expect(env.correlationId).toBe('trace-1');
      expect(JSON.stringify(env.subjects)).not.toMatch(/uuid-|w-fee|w-ops/);
    });
  });
});
