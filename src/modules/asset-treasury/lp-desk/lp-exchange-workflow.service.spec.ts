import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { DEFAULT_DELIVERY_SOURCE, LpExchangeWorkflowService } from './lp-exchange-workflow.service';
import { InitiateLpExchangeDto, LpExchangeStatus as S, SimulateLpDeliveryDto } from './dto/lp-exchange.dto';
import { MockTravelRuleAdapter } from '../../sumsub-shared/travel-rule/mock-travel-rule.adapter';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { NETWORKS } from '../../../config/manifests/networks.manifest';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';

const USDT = { id: 'a-usdt', assetNo: 'ASUSDT0001', code: 'USDT-TRON', currency: 'USDT', decimals: 6, type: 'CRYPTO', network: 'TRON' };
const AED = { id: 'a-aed', code: 'AED', currency: 'AED', decimals: 2, type: 'FIAT' };
const treasury = { actorType: 'ADMIN' as const, userId: 'uuid-tre', userNo: 'ADM-TRE', roleCodes: ['TREASURY_OFFICER'] };
const profile = { id: 'uuid-lp', lpNo: 'LPP1', name: 'Acme LP', fiatBankName: 'Bank', fiatIban: 'AE-LP-IBAN', cryptoNetwork: 'TRON', cryptoAddress: 'TLP-ADDR', agreementRef: 'AGR1', status: 'ACTIVE' };

// 修复轮 1 随轮小项 #2：resolveTbAccountId 的 mock 按 (code, ledger) 编码出不同的账户 id——
// 若实现把 ledger 传错（例如买入腿误用卖出币 ledger），断言里期望的账户 id 会对不上，能
// 真的抓到跨 ledger 错误，不只是抓「有没有传某个 ledger 参数」。
const acct = (code: number, ledger: number): bigint => BigInt(code) * 100n + BigInt(ledger);

// LP 两步准入 Task 5：收款地址簿条目 fixture（链上 USDT / 法币 AED 各一）。
const usdtAddress = { addressNo: 'LPA1', lpId: 'uuid-lp', lpNo: 'LPP1', assetId: USDT.id, status: 'ACTIVE', network: 'TRON', address: 'TLP-PAYOUT-1', iban: null };
const aedAddress = { addressNo: 'LPA2', lpId: 'uuid-lp', lpNo: 'LPP1', assetId: AED.id, status: 'ACTIVE', network: null, address: null, iban: 'AE-LP-PAYOUT' };

const exchangeRowBase = {
  id: 'uuid-lpx', exchangeNo: 'LPX1', lpId: 'uuid-lp', lpNo: 'LPP1',
  payoutAddressNo: 'LPA1', payoutAddress: 'TLP-PAYOUT-1', payoutIban: null,
  sellAssetId: USDT.id, sellAmount: '20000', sellAsset: USDT,
  buyAssetId: AED.id, buyAmount: '73280', buyAsset: AED,
  prudentialPurpose: 'Liquidity management', status: S.PENDING_APPROVAL, reason: 'r',
  sellFromWalletId: 'w-ops-usdt', buyViaWalletId: 'w-liq-aed', buyToWalletId: 'w-ops-aed',
  approvalNo: 'APR1', traceId: 'trace-1', createdByUserId: 'ADM-TRE',
};

function makeWorkflow(o: Partial<Record<'exchangeRow' | 'buyLegs' | 'payoutAddress', any>> = {}) {
  const exchangeRow = o.exchangeRow ?? exchangeRowBase;
  // 地址簿主体服务桩：findByNo 不存在返回 null（Task 3 契约），默认命中 usdtAddress；o.payoutAddress 显式传 null 表示「查不到」。
  const payoutAddress = 'payoutAddress' in o ? o.payoutAddress : usdtAddress;
  const payoutAddresses: any = { findByNo: jest.fn(async () => payoutAddress) };
  const walletsById: Record<string, any> = {
    'w-ops-usdt': { id: 'w-ops-usdt', address: 'Tops-usdt', iban: null },
    'w-liq-aed': { id: 'w-liq-aed', address: null, iban: 'AE-LIQ' },
    'w-ops-aed': { id: 'w-ops-aed', address: null, iban: 'AE-OPS-AED' },
    'w-liq-usdt': { id: 'w-liq-usdt', address: 'Tliq-usdt', iban: null },
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
  // 生产那道词表校验亲自跑每条信封（缺必填 / 缺 causation / 域不符 / INHERIT 无 correlationId 当场抛）。
  // 注意：未登记的码它静默放行（`if (!spec) return`），所以「码是否登记」另由 lp-exchange-audit-codes.spec.ts 冻结。
  const realSpec: any = new AuditLogsService(null as any);
  const auditLogs: any = {
    recordByActor: jest.fn(async (input: any) => { realSpec.assertActionSpec(input); return {}; }),
    recordSystem: jest.fn(async (input: any) => { realSpec.assertActionSpec(input); return {}; }),
  };
  // LP 两步准入 Task 6：到货来源筛查走同一个 TRAVEL_RULE_ADAPTER——用真 mock（尾号 2222 黄 / 3333 红 / 其余绿），不手写桩，
  // 以免「红黄尾号约定」在测试里被另写一遍；spy 只为断言调用实参。
  const travelRule = new MockTravelRuleAdapter();
  const screenSpy = jest.spyOn(travelRule, 'screenAddress');
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
  const wf = new LpExchangeWorkflowService(prisma, exchanges, lpProfiles, approvals, accounting, auditLogs, fundsOrders, systemWallets, custodianStatement, prudential, payoutAddresses, travelRule);
  return { wf, prisma, exchanges, lpProfiles, approvals, accounting, auditLogs, fundsOrders, systemWallets, custodianStatement, exchangeRow, prudential, payoutAddresses, travelRule, screenSpy };
}

describe('LpExchangeWorkflowService (Task 5)', () => {
  describe('initiate — birth guards + happy path', () => {
    const dto = { lpNo: 'LPP1', sellAssetId: USDT.id, sellAmount: '20000', buyAssetId: AED.id, buyAmount: '73280', payoutAddressNo: 'LPA1', prudentialPurpose: 'Liquidity management', reason: 'Rebalance USDT into AED' };

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
        currency: 'USDT', amountMinor: 20_000_000_000n, orderKind: 'LP_EXCHANGE', counterpartyNo: 'LPP1', assetNo: USDT.assetNo, actor: treasury,
      });
      // 断言调用参数里没有任何买入边的痕迹（buyAmount/buyAssetId 均不出现在门的入参里）。
      const call = prudential.assertPostOutflowCompliant.mock.calls[0][0];
      expect(Object.keys(call)).toEqual(['currency', 'amountMinor', 'orderKind', 'counterpartyNo', 'assetNo', 'actor']);
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

  describe('initiate — 收款地址守卫链 + 抄单（LP 两步准入 Task 5）', () => {
    const dto = { lpNo: 'LPP1', sellAssetId: USDT.id, sellAmount: '20000', buyAssetId: AED.id, buyAmount: '73280', payoutAddressNo: 'LPA1', prudentialPurpose: 'Liquidity management', reason: 'Rebalance USDT into AED' };
    const codeOf = async (p: Promise<unknown>) => {
      const err: any = await p.catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      return err.getResponse().code;
    };
    const expectNothingCreated = (h: ReturnType<typeof makeWorkflow>) => {
      expect(h.exchanges.create).not.toHaveBeenCalled();
      expect(h.approvals.createAndSubmit).not.toHaveBeenCalled();
    };

    it('address not in the book → 400 PAYOUT_ADDRESS_NOT_FOUND, no row, no approval', async () => {
      const h = makeWorkflow({ payoutAddress: null });
      expect(await codeOf(h.wf.initiate(dto, treasury))).toBe('PAYOUT_ADDRESS_NOT_FOUND');
      expect(h.payoutAddresses.findByNo).toHaveBeenCalledWith('LPA1');
      expectNothingCreated(h);
    });

    it('address belongs to another LP → 400 PAYOUT_ADDRESS_WRONG_LP', async () => {
      const h = makeWorkflow({ payoutAddress: { ...usdtAddress, lpId: 'uuid-other-lp', lpNo: 'LPP9' } });
      expect(await codeOf(h.wf.initiate(dto, treasury))).toBe('PAYOUT_ADDRESS_WRONG_LP');
      expectNothingCreated(h);
    });

    it('address is registered for another asset than the sell asset → 400 PAYOUT_ADDRESS_ASSET_MISMATCH', async () => {
      const h = makeWorkflow({ payoutAddress: { ...usdtAddress, assetId: AED.id } });
      expect(await codeOf(h.wf.initiate(dto, treasury))).toBe('PAYOUT_ADDRESS_ASSET_MISMATCH');
      expectNothingCreated(h);
    });

    it.each(['PENDING_APPROVAL', 'SUSPENDED', 'REJECTED', 'CANCELLED', 'DEACTIVATED'])('address is %s (not ACTIVE) → 400 PAYOUT_ADDRESS_INACTIVE', async (status) => {
      const h = makeWorkflow({ payoutAddress: { ...usdtAddress, status } });
      expect(await codeOf(h.wf.initiate(dto, treasury))).toBe('PAYOUT_ADDRESS_INACTIVE');
      expectNothingCreated(h);
    });

    it('happy path (crypto sell): the order copies addressNo + on-chain address from the entry (iban null) and the approval snapshot carries addressNo + coordinate, zero UUIDs', async () => {
      const { wf, exchanges, approvals } = makeWorkflow();
      await wf.initiate(dto, treasury);
      expect(exchanges.create).toHaveBeenCalledWith(expect.objectContaining({ payoutAddressNo: 'LPA1', payoutAddress: 'TLP-PAYOUT-1', payoutIban: null }));
      const snap = approvals.createAndSubmit.mock.calls[0][0].objectSnapshot;
      expect(snap).toMatchObject({ payoutAddressNo: 'LPA1', coordinate: 'TLP-PAYOUT-1' });
      expect(JSON.stringify(snap)).not.toMatch(/uuid-/);
    });

    it('happy path (fiat sell): the order copies addressNo + IBAN from the entry (on-chain address null) and the snapshot coordinate is the IBAN', async () => {
      const { wf, exchanges, approvals } = makeWorkflow({ payoutAddress: aedAddress });
      await wf.initiate({ ...dto, sellAssetId: AED.id, sellAmount: '73280', buyAssetId: USDT.id, buyAmount: '20000', payoutAddressNo: 'LPA2' }, treasury);
      expect(exchanges.create).toHaveBeenCalledWith(expect.objectContaining({ payoutAddressNo: 'LPA2', payoutAddress: null, payoutIban: 'AE-LP-PAYOUT' }));
      expect(approvals.createAndSubmit.mock.calls[0][0].objectSnapshot).toMatchObject({ payoutAddressNo: 'LPA2', coordinate: 'AE-LP-PAYOUT' });
    });

    it('DTO: payoutAddressNo is required (real ValidationPipe)', async () => {
      const pipe = new ValidationPipe({ transform: true, whitelist: true });
      const meta = { type: 'body' as const, metatype: InitiateLpExchangeDto };
      const { payoutAddressNo: _drop, ...without } = dto;
      await expect(pipe.transform(without, meta)).rejects.toThrow(BadRequestException);
      await expect(pipe.transform({ ...dto, payoutAddressNo: '' }, meta)).rejects.toThrow(BadRequestException);
      await expect(pipe.transform(dto, meta)).resolves.toMatchObject({ payoutAddressNo: 'LPA1' });
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
        // LP 两步准入 Task 5：腿 1 的 to 坐标读单据抄下的收款地址（'TLP-PAYOUT-1'），不再读档案 cryptoAddress（'TLP-ADDR'）。
        fromWalletId: 'w-ops-usdt', fromAddress: 'Tops-usdt', toWalletId: null, toAddress: 'TLP-PAYOUT-1', toIban: null,
      }));
      expect(exchanges.transition).toHaveBeenCalledWith('LPX1', 'EXECUTING', expect.objectContaining({ executedAt: expect.any(Date) }));
      const audit = auditLogs.recordSystem.mock.calls[0][0];
      expect(audit).toMatchObject({ action: 'LP_EXCHANGE_EXECUTION_STARTED', approvalNo: 'APR1', causationId: 'uuid-apr', fromStatus: 'PENDING_APPROVAL', toStatus: 'EXECUTING' });
      expect(audit.requestId).toMatch(/^LP_EXCHANGE_EXECUTION_STARTED_LPX1_/);
    });

    it('leg 1 to-coordinate comes from the ORDER snapshot, not the live address book: the entry was edited after opening (still ACTIVE) → leg still pays the snapshotted address', async () => {
      const { wf, fundsOrders } = makeWorkflow({ payoutAddress: { ...usdtAddress, address: 'TLP-EDITED-LATER' } });
      await wf.onDecided(decided('APPROVED') as any);
      expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ legSeq: 1, toAddress: 'TLP-PAYOUT-1', toIban: null }));
    });

    it('fiat sell: leg 1 pays the snapshotted IBAN (toIban), toAddress null — never the profile fiatIban', async () => {
      const fiatRow = { ...exchangeRowBase, sellAssetId: AED.id, sellAsset: AED, sellFromWalletId: 'w-ops-aed', payoutAddressNo: 'LPA2', payoutAddress: null, payoutIban: 'AE-LP-PAYOUT' };
      const { wf, fundsOrders } = makeWorkflow({ exchangeRow: fiatRow, payoutAddress: aedAddress });
      await wf.onDecided(decided('APPROVED') as any);
      expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ legSeq: 1, assetId: AED.id, toAddress: null, toIban: 'AE-LP-PAYOUT' }));
    });

    it.each(['SUSPENDED', 'DEACTIVATED'])('approved but the chosen address went %s since opening → FAILED(PAYOUT_ADDRESS_INACTIVE), zero funds orders, audit carries reasonCode + approval causation + explicit requestId', async (status) => {
      const { wf, exchanges, fundsOrders, auditLogs, payoutAddresses } = makeWorkflow({ payoutAddress: { ...usdtAddress, status } });
      await wf.onDecided(decided('APPROVED') as any);
      expect(payoutAddresses.findByNo).toHaveBeenCalledWith('LPA1'); // 复查的是单据抄下的地址号
      expect(exchanges.transition).toHaveBeenCalledTimes(1);
      expect(exchanges.transition).toHaveBeenCalledWith('LPX1', 'FAILED', expect.objectContaining({ failureReasonCode: 'PAYOUT_ADDRESS_INACTIVE', failureNote: expect.stringContaining('LPA1') }));
      expect(fundsOrders.create).not.toHaveBeenCalled();
      const audit = auditLogs.recordSystem.mock.calls[0][0];
      expect(audit).toMatchObject({ action: 'LP_EXCHANGE_FAILED', outcome: 'FAILED', reasonCode: 'PAYOUT_ADDRESS_INACTIVE', approvalNo: 'APR1', causationId: 'uuid-apr', fromStatus: 'PENDING_APPROVAL', toStatus: 'FAILED' });
      expect(audit.requestId).toMatch(/^LP_EXCHANGE_FAILED_LPX1_/);
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

    it('creates leg 2 born CONFIRMED (buy asset FIAT, no source given → fromIban = the clean placeholder, never the profile fiatIban; toIban/toWalletId = our F_LIQ wallet), records the F_LIQ custodian line BEFORE posting 85 (评审 R12：回单先于落账，否则 bumpClosing 兜底基准双计), then CLEARs, DELIVERED + audit DELIVERED with explicit requestId', async () => {
      const { wf, fundsOrders, accounting, custodianStatement, exchanges, auditLogs } = makeWorkflow({ exchangeRow: awaitingDelivery });
      const r = await wf.simulateDelivery('LPX1', treasury);
      expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({
        lpExchangeId: 'uuid-lpx', legSeq: 2, initialStatus: 'CONFIRMED', assetId: AED.id, amount: '73280',
        // LP 两步准入 Task 6：腿 2 的 from 不再抄档案坐标（旧写法「假装 LP 永远从注册地址打款」已废除），无入参 → 占位。
        fromWalletId: null, fromIban: DEFAULT_DELIVERY_SOURCE.FIAT, fromAddress: null,
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

  describe('simulateDelivery — 来源筛查（LP 两步准入 Task 6：拦人不拦状态）', () => {
    const awaitingDelivery = { ...exchangeRowBase, status: S.AWAITING_DELIVERY };
    // 买入币是链上 USDT 的一单（卖 AED 买 USDT）：腿 2 的 from 落 fromAddress、筛查传买入资产的链网络。
    const awaitingCrypto = {
      ...exchangeRowBase, status: S.AWAITING_DELIVERY,
      sellAssetId: AED.id, sellAsset: AED, sellAmount: '73280', sellFromWalletId: 'w-ops-aed',
      buyAssetId: USDT.id, buyAsset: USDT, buyAmount: '20000', buyViaWalletId: 'w-liq-usdt', buyToWalletId: 'w-ops-usdt',
      payoutAddressNo: 'LPA2', payoutAddress: null, payoutIban: 'AE-LP-PAYOUT',
    };
    const RED_IBAN = 'AE000000000000000003333';
    const YELLOW_IBAN = 'AE000000000000000002222';
    const RED_ADDR = 'TSuspiciousDeliverySource0000003333';
    /** simulateDelivery 里唯一一次 DELIVERED 迁移的 patch（单据快照四列随它一次落）。 */
    const deliveredPatch = (exchanges: any) => {
      const call = exchanges.transition.mock.calls.find((c: any[]) => c[1] === 'DELIVERED');
      return call?.[2];
    };
    const screenedAudit = (auditLogs: any) => auditLogs.recordSystem.mock.calls.map((c: any[]) => c[0]).filter((a: any) => a.action === 'LP_EXCHANGE_DELIVERY_SCREENED');

    it('⚡ with a 3333 source → the order is flagged RED, the audit says so, and the order is STILL delivered (screening is a flag, not a gate)', async () => {
      const { wf, exchanges, fundsOrders, accounting, auditLogs, screenSpy } = makeWorkflow({ exchangeRow: awaitingDelivery });
      const r = await wf.simulateDelivery('LPX1', treasury, { fromSource: RED_IBAN });
      // 拦人不拦状态：照常落腿 2、落账 85、CLEAR、翻 DELIVERED——一步不少
      expect(r.status).toBe('DELIVERED');
      expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ legSeq: 2 }));
      expect(accounting.executeTransfer).toHaveBeenCalledTimes(1);
      expect(fundsOrders.advance).toHaveBeenCalledWith('fo-2', 'CLEAR', 'LP_EXCHANGE_WORKFLOW');
      // 单据快照：来源（法币 → IBAN 列、地址列空）+ 结论 + 筛查时刻
      expect(deliveredPatch(exchanges)).toMatchObject({
        deliveryFromIban: RED_IBAN, deliveryFromAddress: null, deliveryScreeningAnswer: 'RED', deliveryScreenedAt: expect.any(Date),
      });
      // 法币来源传 BANK_RAIL_NETWORK（AED fixture 无 network 字段——实现若误传 asset.network 会是 undefined）
      expect(screenSpy).toHaveBeenCalledWith(RED_IBAN, NETWORKS.AED_ZAND.code);
      // 留痕：系统主体、带来源与结论
      const audits = screenedAudit(auditLogs);
      expect(audits).toHaveLength(1);
      expect(auditLogs.recordByActor.mock.calls.map((c: any[]) => c[0].action)).not.toContain('LP_EXCHANGE_DELIVERY_SCREENED');
      expect(audits[0]).toMatchObject({
        action: 'LP_EXCHANGE_DELIVERY_SCREENED', actionDomain: 'TREASURY', primarySubjectNo: 'LPX1',
        correlationId: 'trace-1', sourcePlatform: 'SYSTEM',
        afterData: { fromSource: RED_IBAN, screeningAnswer: 'RED' },
      });
      expect(audits[0].requestId).toMatch(/^LP_EXCHANGE_DELIVERY_SCREENED_LPX1_/);
      expect(audits[0].metadata).toMatchObject({ screeningAnswer: 'RED', lpName: 'Acme LP' });
    });

    it('the RED order is acceptable: feed simulateDelivery\'s own output row into accept() → SUCCESS, leg 3 posted — acceptance never reads the screening answer', async () => {
      const first = makeWorkflow({ exchangeRow: awaitingDelivery });
      await first.wf.simulateDelivery('LPX1', treasury, { fromSource: RED_IBAN });
      const idx = first.exchanges.transition.mock.calls.findIndex((c: any[]) => c[1] === 'DELIVERED');
      const deliveredRow = await first.exchanges.transition.mock.results[idx].value;
      expect(deliveredRow).toMatchObject({ status: 'DELIVERED', deliveryScreeningAnswer: 'RED' });

      const second = makeWorkflow({ exchangeRow: deliveredRow });
      const r = await second.wf.accept('LPX1', treasury);
      expect(r.status).toBe('SUCCESS');
      expect(second.fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ legSeq: 3 }));
      expect(second.accounting.executeTransfer).toHaveBeenCalledTimes(1);
      expect(second.exchanges.transition).toHaveBeenCalledWith('LPX1', 'SUCCESS', expect.objectContaining({ settledAt: expect.any(Date) }));
      // 没有任何「因筛查结论而拒绝验收」的审计/错误（迁移表零改动由 lp-exchange.service.spec 的独立 8×8 真值表冻结）
      expect(second.auditLogs.recordSystem.mock.calls.map((c: any[]) => c[0].action)).not.toContain('LP_EXCHANGE_FAILED');
    });

    it('YELLOW (2222) is recorded the same way and the order is delivered', async () => {
      const { wf, exchanges, auditLogs } = makeWorkflow({ exchangeRow: awaitingDelivery });
      const r = await wf.simulateDelivery('LPX1', treasury, { fromSource: YELLOW_IBAN });
      expect(r.status).toBe('DELIVERED');
      expect(deliveredPatch(exchanges)).toMatchObject({ deliveryFromIban: YELLOW_IBAN, deliveryScreeningAnswer: 'YELLOW' });
      expect(screenedAudit(auditLogs)[0]).toMatchObject({ afterData: { fromSource: YELLOW_IBAN, screeningAnswer: 'YELLOW' } });
    });

    it('no source given → the clean placeholder is screened (GREEN), snapshotted and audited — GREEN is recorded too, every ⚡delivery leaves a conclusion', async () => {
      const { wf, exchanges, auditLogs, screenSpy } = makeWorkflow({ exchangeRow: awaitingDelivery });
      const r = await wf.simulateDelivery('LPX1', treasury);
      expect(r.status).toBe('DELIVERED');
      expect(screenSpy).toHaveBeenCalledWith(DEFAULT_DELIVERY_SOURCE.FIAT, 'AED_ZAND');
      expect(deliveredPatch(exchanges)).toMatchObject({
        deliveryFromIban: DEFAULT_DELIVERY_SOURCE.FIAT, deliveryFromAddress: null, deliveryScreeningAnswer: 'GREEN', deliveryScreenedAt: expect.any(Date),
      });
      expect(screenedAudit(auditLogs)[0]).toMatchObject({ afterData: { fromSource: DEFAULT_DELIVERY_SOURCE.FIAT, screeningAnswer: 'GREEN' } });
    });

    it.each([['empty body {}', {}], ['fromSource undefined', { fromSource: undefined }], ['empty string', { fromSource: '' }], ['whitespace only', { fromSource: '   ' }], ['tabs/newlines only', { fromSource: ' \t\n ' }]])(
      'a blank source (%s) counts as not given → same as no parameter: placeholder + GREEN', async (_label, dto) => {
        const { wf, fundsOrders, exchanges, screenSpy } = makeWorkflow({ exchangeRow: awaitingDelivery });
        await wf.simulateDelivery('LPX1', treasury, dto as any);
        expect(screenSpy).toHaveBeenCalledWith(DEFAULT_DELIVERY_SOURCE.FIAT, 'AED_ZAND');
        expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ legSeq: 2, fromIban: DEFAULT_DELIVERY_SOURCE.FIAT }));
        expect(deliveredPatch(exchanges)).toMatchObject({ deliveryFromIban: DEFAULT_DELIVERY_SOURCE.FIAT, deliveryScreeningAnswer: 'GREEN' });
      },
    );

    it('a padded source is trimmed before it is used: screened, stored on leg 2 and on the order trimmed', async () => {
      const { wf, fundsOrders, exchanges, screenSpy } = makeWorkflow({ exchangeRow: awaitingDelivery });
      await wf.simulateDelivery('LPX1', treasury, { fromSource: `  ${RED_IBAN}  ` });
      expect(screenSpy).toHaveBeenCalledWith(RED_IBAN, 'AED_ZAND');
      expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ legSeq: 2, fromIban: RED_IBAN }));
      expect(deliveredPatch(exchanges)).toMatchObject({ deliveryFromIban: RED_IBAN, deliveryScreeningAnswer: 'RED' });
    });

    it('leg 2 from-coordinate = the ⚡ input, NOT the profile coordinate (fiat buy: fromIban; profile fiatIban "AE-LP-IBAN" is not used any more)', async () => {
      const { wf, fundsOrders } = makeWorkflow({ exchangeRow: awaitingDelivery });
      await wf.simulateDelivery('LPX1', treasury, { fromSource: 'AE123400000000000009999' });
      const leg = fundsOrders.create.mock.calls.find((c: any[]) => c[0].legSeq === 2)![0];
      expect(leg).toMatchObject({ fromIban: 'AE123400000000000009999', fromAddress: null, fromWalletId: null, toWalletId: 'w-liq-aed', toIban: 'AE-LIQ' });
      expect(JSON.stringify(leg)).not.toContain('AE-LP-IBAN');
    });

    it('crypto buy: the source goes to leg 2 fromAddress (fromIban null), screening gets the buy asset\'s chain network, snapshot lands in the ADDRESS column', async () => {
      const { wf, fundsOrders, exchanges, screenSpy, auditLogs } = makeWorkflow({ exchangeRow: awaitingCrypto });
      await wf.simulateDelivery('LPX1', treasury, { fromSource: RED_ADDR });
      const leg = fundsOrders.create.mock.calls.find((c: any[]) => c[0].legSeq === 2)![0];
      expect(leg).toMatchObject({ assetId: USDT.id, fromAddress: RED_ADDR, fromIban: null, fromWalletId: null, toWalletId: 'w-liq-usdt', toAddress: 'Tliq-usdt' });
      expect(JSON.stringify(leg)).not.toContain('TLP-ADDR'); // 档案 cryptoAddress
      expect(screenSpy).toHaveBeenCalledWith(RED_ADDR, 'TRON');
      expect(deliveredPatch(exchanges)).toMatchObject({ deliveryFromAddress: RED_ADDR, deliveryFromIban: null, deliveryScreeningAnswer: 'RED' });
      expect(screenedAudit(auditLogs)[0]).toMatchObject({ afterData: { fromSource: RED_ADDR, screeningAnswer: 'RED' } });
    });

    it('crypto buy, no source → the TRON placeholder (GREEN) lands in fromAddress', async () => {
      const { wf, fundsOrders, exchanges, screenSpy } = makeWorkflow({ exchangeRow: awaitingCrypto });
      await wf.simulateDelivery('LPX1', treasury, { fromSource: '  ' });
      expect(screenSpy).toHaveBeenCalledWith(DEFAULT_DELIVERY_SOURCE.CRYPTO, 'TRON');
      expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ legSeq: 2, fromAddress: DEFAULT_DELIVERY_SOURCE.CRYPTO, fromIban: null }));
      expect(deliveredPatch(exchanges)).toMatchObject({ deliveryFromAddress: DEFAULT_DELIVERY_SOURCE.CRYPTO, deliveryFromIban: null, deliveryScreeningAnswer: 'GREEN' });
    });

    it('the DELIVERED audit is unchanged (actor-recorded, with its transition); the screening audit is a separate system-recorded entry', async () => {
      const { wf, auditLogs } = makeWorkflow({ exchangeRow: awaitingDelivery });
      await wf.simulateDelivery('LPX1', treasury, { fromSource: RED_IBAN });
      expect(auditLogs.recordByActor).toHaveBeenCalledTimes(1);
      expect(auditLogs.recordByActor.mock.calls[0][0]).toMatchObject({ action: 'LP_EXCHANGE_DELIVERED', fromStatus: 'AWAITING_DELIVERY', toStatus: 'DELIVERED' });
      expect(auditLogs.recordSystem).toHaveBeenCalledTimes(1);
    });

    it('the status guard still wins: not awaiting delivery → 400, nothing screened, nothing written', async () => {
      const { wf, screenSpy, fundsOrders, auditLogs } = makeWorkflow({ exchangeRow: { ...exchangeRowBase, status: S.EXECUTING } });
      await expect(wf.simulateDelivery('LPX1', treasury, { fromSource: RED_IBAN })).rejects.toThrow(/not awaiting delivery/);
      expect(screenSpy).not.toHaveBeenCalled();
      expect(fundsOrders.create).not.toHaveBeenCalled();
      expect(auditLogs.recordSystem).not.toHaveBeenCalled();
    });

    it('DEFAULT_DELIVERY_SOURCE: shaped like the real coordinates (TRON: T + 33 chars; UAE IBAN: AE + 21 digits), clean under the mock\'s tail convention, and visibly a placeholder', async () => {
      const { CRYPTO, FIAT } = DEFAULT_DELIVERY_SOURCE;
      expect(CRYPTO).toHaveLength(34);
      expect(CRYPTO.startsWith('T')).toBe(true);
      expect(FIAT).toMatch(/^AE\d{21}$/);
      const adapter = new MockTravelRuleAdapter();
      for (const [coord, network] of [[CRYPTO, 'TRON'], [FIAT, 'AED_ZAND']] as const) {
        expect(await adapter.screenAddress(coord, network)).toBe('GREEN');
        expect(coord.endsWith('0000')).toBe(true); // 与 mock 红(3333)/黄(2222)/VASP(1111)/灰港(4444)尾号都不撞，且肉眼可见是占位
      }
      expect(/placeholder/i.test(CRYPTO)).toBe(true);
    });

    it('DTO: fromSource is optional (real ValidationPipe): absent / string pass, non-string rejected, unknown keys stripped', async () => {
      const pipe = new ValidationPipe({ transform: true, whitelist: true });
      const meta = { type: 'body' as const, metatype: SimulateLpDeliveryDto };
      await expect(pipe.transform({}, meta)).resolves.toMatchObject({});
      await expect(pipe.transform({ fromSource: RED_IBAN }, meta)).resolves.toMatchObject({ fromSource: RED_IBAN });
      await expect(pipe.transform({ fromSource: 123 }, meta)).rejects.toThrow(BadRequestException);
      const stripped: any = await pipe.transform({ fromSource: RED_IBAN, screeningAnswer: 'GREEN' }, meta);
      expect(stripped.screeningAnswer).toBeUndefined(); // 结论不是入参，调用方不能自报
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
