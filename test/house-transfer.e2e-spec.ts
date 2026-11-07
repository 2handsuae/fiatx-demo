import * as path from 'path';
import * as dotenv from 'dotenv';

// Same Node 18 polyfill as src/main.ts (@nestjs/schedule needs globalThis.crypto,
// stable only in Node 19+) — main.ts isn't loaded in this e2e harness, so it has
// to be repeated here before AppModule (and therefore ScheduleModule) is imported.
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

// Loaded before any other import so PrismaService / TigerBeetleService see the
// worktree's own DATABASE_URL / TB_ADDRESS regardless of ConfigModule's internal
// load timing (mirrors vendor-payment-from-wallet.e2e-spec.ts).
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA, isDebitNormalCode } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { bigintToHex, hexToBigint } from '../src/modules/accounting/tigerbeetle/utils/tb-id.util';
import { ApprovalsService } from '../src/modules/governance/approvals/approvals.service';
import { ApprovalActorContext } from '../src/modules/governance/approvals/constants/approval.constants';
import { SystemWalletResolver } from '../src/modules/funds-layer/domain/system-wallet-resolver.service';
import { FundsOrderService } from '../src/modules/funds-orders/funds-order.service';
import { FundsOrderAction } from '../src/modules/funds-orders/dto/funds-order.dto';
import { PrudentialService } from '../src/modules/asset-treasury/prudential/prudential.service';
import { HouseTransferService } from '../src/modules/asset-treasury/company-funding/house-transfer.service';
import { HouseTransferWorkflowService } from '../src/modules/asset-treasury/company-funding/house-transfer-workflow.service';
import { HouseTransferStatus } from '../src/modules/asset-treasury/company-funding/dto/house-transfer.dto';

/**
 * 戊波二 T5 · 公司调拨单 e2e（spec §8.4）：真 AppModule、真 TigerBeetle、零 mock，走真实服务入口——
 * initiate → ApprovalsService.approve / reject（CFO）→ 腿 SUBMIT / CONFIRM（⚡ 模拟推进走的同一个 FundsOrderService.advance，
 * 事件触发 workflow 落账）。断言全部取自 TigerBeetle 账户余额的前后差、凭证行、审计行、外部账单行和单据状态，不读自己写的 mock。
 *
 * 夹具：手续费户里要有「不是兑换费 / 提现费」的钱才能演扫费结转的封顶（spec 裁定 13）。按真实业务形状直接过账——
 * 与生产分录同码同户同 eventCode（兑换费 36 / 提现费 16 / 没收 4：借 现金·手续费户 / 贷 对应收入户，
 * 见 swap-leg-plan.constant.ts、withdraw-workflow.service.ts、deposit-workflow.service.ts confiscationSpec 第二腿）。
 * 码 4 的第一腿（码 3，客户本）不铺：本 e2e 不碰客户本，公司本这一笔自己借贷平。账户标志位一概不碰（TB 的「借不得超贷 /
 * 贷不得超借」照常生效，夹具透支会被拒）。
 *
 * 每个 it 用「当场快照的前后差」断言，不依赖其它 it 留下的状态；每个 it 先把自己要的手续费收入铺够（铺的就是收入 + 手续费户现金）。
 * 本文件会改动共享的 self 库（手续费户现金 / 收入户 / 公司权益），收尾由栈重铺闸清掉（reset self → demo:all → verify:coa）。
 */
describe('House transfer — fee sweep & wallet-to-wallet transfers (戊波二 T5)', () => {
  jest.setTimeout(180000);
  let app: INestApplication; let prisma: PrismaService;
  let accounting: AccountingService; let approvals: ApprovalsService;
  let wf: HouseTransferWorkflowService; let transfers: HouseTransferService;
  let fundsOrders: FundsOrderService; let systemWallets: SystemWalletResolver; let prudential: PrudentialService;
  let nlaSpy: jest.SpyInstance;

  const treasury = makeActor('E2E_HTR_TREASURY', 'TREASURY_OFFICER');
  const cfo = makeActor('E2E_HTR_CFO', 'CFO');

  let aed: any; let opsWallet: any; let feeWallet: any; let setWallet: any;
  let opsCashId: bigint; let feeCashId: bigint; let equityId: bigint;
  let incomeIds: Record<number, bigint>;
  const ledger = TB_LEDGERS.AED;
  const marker = `E2E-HTR-${randomUUID().slice(0, 8).toUpperCase()}`;
  let fixtureSeq = 0;

  function makeActor(userNo: string, role: string): ApprovalActorContext {
    return { actorType: 'ADMIN', userId: `uuid-${userNo}`, userNo, role, roleCodes: [role] };
  }

  async function waitUntil(predicate: () => Promise<boolean>, what: string, timeoutMs = 30000, intervalMs = 50): Promise<void> {
    const start = Date.now();
    for (;;) {
      if (await predicate()) return;
      if (Date.now() - start > timeoutMs) throw new Error(`waitUntil: ${what} not met within ${timeoutMs}ms`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  const major = (minor: bigint) => new Prisma.Decimal(minor.toString()).div(100).toFixed(2);

  /** posted 净余额，按科目码的借贷性质取正（与注册表列表 / verify:coa 同口径）。 */
  async function posted(accountId: bigint, code: number): Promise<bigint> {
    const b = await accounting.lookupBalance(accountId);
    return isDebitNormalCode(code) ? b.debitsPosted - b.creditsPosted : b.creditsPosted - b.debitsPosted;
  }

  async function snapshot() {
    return {
      opsCash: await posted(opsCashId, TB_ACCOUNT_CODES.FIRM_CASH),
      feeCash: await posted(feeCashId, TB_ACCOUNT_CODES.FIRM_CASH),
      equity: await posted(equityId, TB_ACCOUNT_CODES.FIRM_EQUITY),
      inc210: await posted(incomeIds[TB_ACCOUNT_CODES.INCOME_SWAP_FEE], TB_ACCOUNT_CODES.INCOME_SWAP_FEE),
      inc211: await posted(incomeIds[TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE], TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE),
      inc212: await posted(incomeIds[TB_ACCOUNT_CODES.INCOME_OTHER], TB_ACCOUNT_CODES.INCOME_OTHER),
    };
  }
  const incomeSum = (s: { inc210: bigint; inc211: bigint; inc212: bigint }) => s.inc210 + s.inc211 + s.inc212;

  /** 往手续费户铺一笔收入（真实业务形状：借 现金·手续费户 / 贷 收入户）。 */
  async function postFeeIncome(kind: 'SWAP' | 'WITHDRAW' | 'OTHER', amountMinor: bigint): Promise<void> {
    const spec = {
      SWAP: { code: TB_TRANSFER_CODES.SWAP_FEE_FIRM, income: TB_ACCOUNT_CODES.INCOME_SWAP_FEE, eventCode: 'SWAP_FEE_FIRM' },
      WITHDRAW: { code: TB_TRANSFER_CODES.WITHDRAW_FEE_FIRM, income: TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE, eventCode: 'WITHDRAW_FEE_FIRM' },
      OTHER: { code: TB_TRANSFER_CODES.DEPOSIT_CONFISCATE_INCOME_OTHER, income: TB_ACCOUNT_CODES.INCOME_OTHER, eventCode: 'CONFISCATE_INCOME_OTHER' }, // 没收 → 其他收入（裁定 13）
    }[kind];
    await accounting.executeTransfer({
      debitAccountId: feeCashId, creditAccountId: incomeIds[spec.income], amount: amountMinor, ledger, code: spec.code,
      evidence: {
        sourceType: 'E2E_HTR_FIXTURE', sourceNo: `${marker}-${++fixtureSeq}`, eventCode: spec.eventCode, traceId: marker,
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_CASH], creditCode: TB_CODE_TO_COA[spec.income],
        assetCurrency: 'AED', actorType: 'SYSTEM', actorId: 'E2E_HTR', memo: `e2e fixture: ${kind} income into the fee wallet`,
      },
    });
  }

  const initiate = (from: any, to: any, amountMinor: bigint, note: string) => wf.initiate({
    purpose: 'FEE_SWEEP', assetId: aed.id, amount: major(amountMinor), fromWalletId: from.id, toWalletId: to.id, reason: `${marker} ${note}`,
  }, treasury);

  /** CFO 批 → 等进 EXECUTING → 取到唯一一条腿。 */
  async function approveToLeg(opened: { transferNo: string; approvalNo: string }) {
    await approvals.approve(opened.approvalNo, { reason: 'e2e CFO approves the house transfer' }, cfo);
    await waitUntil(async () => (await transfers.findByNo(opened.transferNo)).status === HouseTransferStatus.EXECUTING, `${opened.transferNo} EXECUTING`);
    const row = await transfers.findByNo(opened.transferNo);
    const legs = await fundsOrders.findByParent({ houseTransferId: row.id });
    expect(legs).toHaveLength(1); // 唯一一条腿
    return { row, leg: legs[0] };
  }
  /** 金库在资金单页 ⚡：提交 → 到账确认（同一个 FundsOrderService.advance；事件触发 workflow 落账）。
   *  真人点两下之间隔着好几秒：提交的事件处理（铸参考号 + 模拟托管方写两侧外部行）是异步的，这里等它写完两行再点确认，
   *  否则两次 advance 背靠背，确认那步的铸号会和提交处理器的读写交错，外部行的参考号就可能回落到资金单号（只是测试时序，不是产品路径）。 */
  async function pushLeg(leg: any) {
    await fundsOrders.advance(leg.id, FundsOrderAction.SUBMIT, 'E2E_HTR');
    const keys = [`SIM-${leg.fundsOrderNo}-${leg.fromWalletId}`, `SIM-${leg.fundsOrderNo}-${leg.toWalletId}`];
    await waitUntil(async () => (await (prisma as any).externalStatementLine.count({ where: { dedupKey: { in: keys } } })) === 2, `${leg.fundsOrderNo} simulated custodian lines`);
    await fundsOrders.advance(leg.id, FundsOrderAction.CONFIRM, 'E2E_HTR');
  }
  /** 开单 → 批 → 推腿 → 等 SUCCESS，一条龙。 */
  async function runTransfer(from: any, to: any, amountMinor: bigint, note: string) {
    const opened = await initiate(from, to, amountMinor, note);
    const { row, leg } = await approveToLeg(opened);
    await pushLeg(leg);
    await waitUntil(async () => (await transfers.findByNo(opened.transferNo)).status === HouseTransferStatus.SUCCESS, `${opened.transferNo} SUCCESS`);
    return { opened, row, leg, final: await transfers.findByNo(opened.transferNo) };
  }

  const evidenceOf = (transferNo: string) => (prisma as any).tbTransferEvidence.findMany({ where: { sourceNo: transferNo }, orderBy: { createdAt: 'asc' } });
  const auditOf = (transferNo: string) => (prisma as any).auditLogEvent.findMany({ where: { primarySubjectType: 'HOUSE_TRANSFER', primarySubjectNo: transferNo } });
  const auditActionsOf = async (transferNo: string) => (await auditOf(transferNo)).map((a: any) => a.action).sort();
  const evidenceMinor = (e: any) => BigInt(new Prisma.Decimal(e.amount).toFixed(0));

  /** verify:coa 同口径的公司本天平（本 ledger）：Σ(50)+Σ(51)+Σ(300..302) = Σ(200)+Σ(210..212)；并且这条账本上没有负余额户。 */
  async function assertFirmBookBalanced(): Promise<void> {
    const regs = await (prisma as any).tbAccountRegistry.findMany({ where: { status: 'ACTIVE', ledger } });
    let left = 0n; let right = 0n; const negatives: string[] = [];
    const leftCodes: number[] = [TB_ACCOUNT_CODES.FIRM_CASH, TB_ACCOUNT_CODES.LP_RECEIVABLE, TB_ACCOUNT_CODES.EXPENSE_BANK_CUSTODY, TB_ACCOUNT_CODES.EXPENSE_RECON_LOSS, TB_ACCOUNT_CODES.EXPENSE_OTHER];
    const rightCodes: number[] = [TB_ACCOUNT_CODES.FIRM_EQUITY, TB_ACCOUNT_CODES.INCOME_SWAP_FEE, TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE, TB_ACCOUNT_CODES.INCOME_OTHER];
    for (const r of regs) {
      const bal = await posted(hexToBigint(r.tbAccountId), r.code);
      if (bal < 0n) negatives.push(`${TB_CODE_TO_COA[r.code] ?? r.code} ${r.ownerNo ?? r.ownerUuid}: ${bal}`);
      if (leftCodes.includes(r.code)) left += bal;
      if (rightCodes.includes(r.code)) right += bal;
    }
    expect(negatives).toEqual([]);
    expect(left).toBe(right);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(0);
    await app.init();
    prisma = app.get(PrismaService); accounting = app.get(AccountingService); approvals = app.get(ApprovalsService);
    wf = app.get(HouseTransferWorkflowService); transfers = app.get(HouseTransferService);
    fundsOrders = app.get(FundsOrderService); systemWallets = app.get(SystemWalletResolver); prudential = app.get(PrudentialService);

    aed = await (prisma as any).asset.findFirst({ where: { currency: 'AED' } });
    if (!aed?.tbLedgerId) throw new Error('Fixture asset AED not seeded — run `bash scripts/stack.sh reset self` first.');
    [opsWallet, feeWallet, setWallet] = await Promise.all([
      systemWallets.resolve(aed.id, 'F_OPS'), systemWallets.resolve(aed.id, 'F_FEE'), systemWallets.resolve(aed.id, 'F_SET'),
    ]);
    opsCashId = await accounting.resolveCashAccountId(opsWallet.id, ledger);
    feeCashId = await accounting.resolveCashAccountId(feeWallet.id, ledger);
    equityId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FIRM_EQUITY, ledger, ownerType: 'SYSTEM' });
    incomeIds = {};
    for (const code of [TB_ACCOUNT_CODES.INCOME_SWAP_FEE, TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE, TB_ACCOUNT_CODES.INCOME_OTHER]) {
      incomeIds[code] = await accounting.resolveTbAccountId({ code, ledger, ownerType: 'SYSTEM' });
    }
    nlaSpy = jest.spyOn(prudential, 'assertPostOutflowCompliant'); // 透传，不替换实现
  });
  afterAll(async () => { nlaSpy?.mockRestore(); if (app) await app.close(); });
  beforeEach(() => { nlaSpy.mockClear(); });

  it('fixture: operating and fee wallets are two different AED company wallets with funded cash accounts; the books balance before we start', async () => {
    expect(opsWallet.vaultCode).toBe('F_OPS');
    expect(feeWallet.vaultCode).toBe('F_FEE');
    expect(opsCashId).not.toBe(feeCashId);
    expect((await snapshot()).opsCash).toBeGreaterThan(0n);
    await assertFirmBookBalanced();
  });

  // ───────────────────────── ① 整扫 ─────────────────────────
  it('① full sweep fee wallet → operating wallet (with a confiscation credited to 212): CFO approves, ⚡ leg — 89 + three 90s with distinct eventCodes, 210/211/212 all to zero, equity +Σincome, verify:coa-style identity holds', async () => {
    await postFeeIncome('SWAP', 300n); await postFeeIncome('WITHDRAW', 200n);
    await postFeeIncome('OTHER', 777n); // 没收一笔贷 212：钱落手续费户现金（deposit-workflow confiscationSpec 第二腿的形状）
    const b0 = await snapshot();
    const total = incomeSum(b0);
    expect(b0.inc210).toBeGreaterThan(0n); expect(b0.inc211).toBeGreaterThan(0n); expect(b0.inc212).toBeGreaterThan(0n); // 三户都有，才演得出「三笔」
    const amount = b0.feeCash; // 整扫 = 手续费户全部现金
    expect(amount).toBeGreaterThanOrEqual(total);

    const opened = await initiate(feeWallet, opsWallet, amount, 'sweep everything');
    expect(nlaSpy).not.toHaveBeenCalled(); // 调拨单不过 NLA 门
    expect(await snapshot()).toEqual(b0); // 开单、批准之前不记账
    const { row, leg } = await approveToLeg(opened);
    expect(await snapshot()).toEqual(b0); // 批准建腿也不记账（先账后状态，落账在腿确认）
    expect(leg.fromWalletId).toBe(feeWallet.id); expect(leg.toWalletId).toBe(opsWallet.id);
    await pushLeg(leg);
    await waitUntil(async () => (await transfers.findByNo(opened.transferNo)).status === HouseTransferStatus.SUCCESS, 'SUCCESS');

    const a = await snapshot();
    expect(a.feeCash - b0.feeCash).toBe(-amount); expect(a.feeCash).toBe(0n);
    expect(a.opsCash - b0.opsCash).toBe(amount);
    expect([a.inc210, a.inc211, a.inc212]).toEqual([0n, 0n, 0n]); // 三户结转后归零
    expect(a.equity - b0.equity).toBe(total); // 公司权益增加 Σ 收入

    // 凭证：89 一笔 + 90 三笔（eventCode 各异），借贷码与账户 id 都对得上
    const evidence = await evidenceOf(opened.transferNo);
    expect(evidence).toHaveLength(4);
    const e89 = evidence.find((e: any) => e.eventCode === 'HOUSE_TRANSFER');
    expect(e89).toMatchObject({ sourceType: 'HOUSE_TRANSFER', debitCode: 'A.FIRM_CASH', creditCode: 'A.FIRM_CASH', assetCode: 'AED', debitTbAccountId: bigintToHex(opsCashId), creditTbAccountId: bigintToHex(feeCashId) });
    expect(evidenceMinor(e89)).toBe(amount);
    const closes = [
      { eventCode: 'FEE_INCOME_CLOSE_SWAP', income: TB_ACCOUNT_CODES.INCOME_SWAP_FEE, amount: b0.inc210 },
      { eventCode: 'FEE_INCOME_CLOSE_WITHDRAW', income: TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE, amount: b0.inc211 },
      { eventCode: 'FEE_INCOME_CLOSE_OTHER', income: TB_ACCOUNT_CODES.INCOME_OTHER, amount: b0.inc212 },
    ];
    const closeEvidence = closes.map((c) => {
      const e = evidence.find((x: any) => x.eventCode === c.eventCode);
      expect(e).toMatchObject({ sourceType: 'HOUSE_TRANSFER', debitCode: TB_CODE_TO_COA[c.income], creditCode: 'E.FIRM_EQUITY', debitTbAccountId: bigintToHex(incomeIds[c.income]), creditTbAccountId: bigintToHex(equityId) });
      expect(evidenceMinor(e)).toBe(c.amount);
      return e;
    });
    expect(new Set(closeEvidence.map((e: any) => e.tbTransferId)).size).toBe(3);
    // 单上的回执 = 三笔 90 的转账号，按落账顺序（码序 210 → 211 → 212）
    const final = await transfers.findByNo(opened.transferNo);
    expect(JSON.parse(final.closeTbTransferIds as string)).toEqual(closeEvidence.map((e: any) => e.tbTransferId));
    expect(final.fundsOrderNo).toBe(leg.fundsOrderNo);
    expect(final.settledAt).toBeInstanceOf(Date);
    const view = await transfers.getView(opened.transferNo);
    expect(view).toMatchObject({ status: 'SUCCESS', fromWalletNo: feeWallet.walletNo, fromVaultCode: 'F_FEE', toWalletNo: opsWallet.walletNo, toVaultCode: 'F_OPS', amount: major(amount), closeTbTransferIds: closeEvidence.map((e: any) => e.tbTransferId) });
    expect(JSON.stringify(view)).not.toMatch(new RegExp(`${row.id}|${feeWallet.id}|${opsWallet.id}|${aed.id}`)); // 铁律⑥

    // 审计：每个持久化状态变化都有码，一条不多（没有 FAILED / REJECTED / CANCELLED）
    expect(await auditActionsOf(opened.transferNo)).toEqual(['HOUSE_TRANSFER_EXECUTION_STARTED', 'HOUSE_TRANSFER_LEG_POSTED', 'HOUSE_TRANSFER_REQUESTED', 'HOUSE_TRANSFER_SETTLED']);
    const requested = (await auditOf(opened.transferNo)).find((x: any) => x.action === 'HOUSE_TRANSFER_REQUESTED');
    expect(JSON.parse(requested.metadata)).toMatchObject({ fromWalletNo: feeWallet.walletNo, toWalletNo: opsWallet.walletNo, purpose: 'FEE_SWEEP' });

    // 模拟托管方两侧外部行（⚡ 提交时已写）：from 一行 OUT、to 一行 IN，同一个 externalRef（= 89 凭证的 externalRef），运营户与手续费户对账都配得上
    const lines = await (prisma as any).externalStatementLine.findMany({ where: { dedupKey: { in: [`SIM-${leg.fundsOrderNo}-${feeWallet.id}`, `SIM-${leg.fundsOrderNo}-${opsWallet.id}`] } } });
    expect(lines.find((l: any) => l.accountRef === feeWallet.id)).toMatchObject({ direction: 'OUT', currency: 'AED' });
    expect(lines.find((l: any) => l.accountRef === opsWallet.id)).toMatchObject({ direction: 'IN', currency: 'AED' });
    expect(new Set(lines.map((l: any) => l.externalRef))).toEqual(new Set([e89.externalRef]));
    expect(e89.externalRef).toBeTruthy();
    for (const l of lines) expect(BigInt(new Prisma.Decimal(l.amount).toFixed(0))).toBe(amount);

    await assertFirmBookBalanced(); // = verify:coa 公司本恒等 + 无负余额
    expect(nlaSpy).not.toHaveBeenCalled(); // 全程没过 NLA 门
  });

  // ───────────────────────── ② 扫一半 ─────────────────────────
  it('② sweep half: only 210 then 211 are closed, in code order, just enough — 212 untouched, two 90s', async () => {
    await postFeeIncome('SWAP', 300n); await postFeeIncome('WITHDRAW', 200n); await postFeeIncome('OTHER', 100n);
    const b0 = await snapshot();
    const half211 = b0.inc211 / 2n;
    expect(b0.inc210).toBeGreaterThan(0n); expect(half211).toBeGreaterThan(0n);
    const amount = b0.inc210 + half211; // 210 全扣，211 扣一半，212 不碰
    expect(amount).toBeLessThan(incomeSum(b0));

    const { opened, final } = await runTransfer(feeWallet, opsWallet, amount, 'sweep half');
    const a = await snapshot();
    expect(a.feeCash - b0.feeCash).toBe(-amount);
    expect(a.opsCash - b0.opsCash).toBe(amount);
    expect(a.inc210).toBe(0n);
    expect(b0.inc211 - a.inc211).toBe(half211);
    expect(a.inc212).toBe(b0.inc212); // 212 一分没动
    expect(a.equity - b0.equity).toBe(amount); // 结转总额 = 调拨金额（因为 ≤ Σ 收入）

    const evidence = await evidenceOf(opened.transferNo);
    expect(evidence.map((e: any) => e.eventCode).sort()).toEqual(['FEE_INCOME_CLOSE_SWAP', 'FEE_INCOME_CLOSE_WITHDRAW', 'HOUSE_TRANSFER']);
    expect(evidenceMinor(evidence.find((e: any) => e.eventCode === 'FEE_INCOME_CLOSE_SWAP'))).toBe(b0.inc210);
    expect(evidenceMinor(evidence.find((e: any) => e.eventCode === 'FEE_INCOME_CLOSE_WITHDRAW'))).toBe(half211);
    expect(JSON.parse(final.closeTbTransferIds as string)).toHaveLength(2);
    await assertFirmBookBalanced();
  });

  // ───────────────────────── ③ 封顶 ─────────────────────────
  it('③ first move money operating → fee, then sweep everything: the close is capped at Σ(210..212), the 90s are not rejected, equity does NOT grow by the full amount', async () => {
    await postFeeIncome('SWAP', 300n); await postFeeIncome('WITHDRAW', 200n);
    const refill = 1000n; // 10.00 AED 从运营户调到手续费户：这截钱有公司权益背书，不是收入
    await runTransfer(opsWallet, feeWallet, refill, 'move money into the fee wallet first');
    const b0 = await snapshot();
    const total = incomeSum(b0);
    const amount = b0.feeCash; // 整扫
    expect(amount).toBeGreaterThan(total); // 手续费户里有一截非收入的钱
    expect(amount - total).toBeGreaterThanOrEqual(refill);

    const { opened } = await runTransfer(feeWallet, opsWallet, amount, 'sweep everything incl. non-income money');
    const a = await snapshot();
    expect(a.feeCash).toBe(0n);
    expect(a.opsCash - b0.opsCash).toBe(amount);
    expect([a.inc210, a.inc211, a.inc212]).toEqual([0n, 0n, 0n]);
    expect(a.equity - b0.equity).toBe(total); // 结转封顶在 Σ 收入，不是 amount

    const evidence = await evidenceOf(opened.transferNo);
    const closeMinor = evidence.filter((e: any) => e.eventCode.startsWith('FEE_INCOME_CLOSE_')).reduce((s: bigint, e: any) => s + evidenceMinor(e), 0n);
    expect(closeMinor).toBe(total);
    expect(evidenceMinor(evidence.find((e: any) => e.eventCode === 'HOUSE_TRANSFER'))).toBe(amount); // 89 仍是整额
    expect(await auditActionsOf(opened.transferNo)).not.toContain('HOUSE_TRANSFER_FAILED'); // 90 没被账本拒
    expect((await transfers.findByNo(opened.transferNo)).failureReasonCode).toBeNull();
    await assertFirmBookBalanced();
  });

  // ───────────────────────── ④ 运营户 → 手续费户 ─────────────────────────
  it('④ operating → fee wallet: no fee-income close (only 89), NLA gate is NOT called (money stays inside the firm — 戊波三 裁定 2) and writes no gate audit', async () => {
    const amount = 1000n;
    const b0 = await snapshot();
    const gateAuditBefore = await (prisma as any).auditLogEvent.count({ where: { action: 'PRUDENTIAL_GATE_BLOCKED' } });

    const opened = await initiate(opsWallet, feeWallet, amount, 'move money into the fee wallet');
    expect(nlaSpy).not.toHaveBeenCalled(); // 运营户与手续费户都计入 NLA，口袋间挪钱 NLA 不变，不过门
    const { leg } = await approveToLeg(opened);
    await pushLeg(leg);
    await waitUntil(async () => (await transfers.findByNo(opened.transferNo)).status === HouseTransferStatus.SUCCESS, 'SUCCESS');

    const a = await snapshot();
    expect(a.opsCash - b0.opsCash).toBe(-amount);
    expect(a.feeCash - b0.feeCash).toBe(amount);
    expect(a.equity).toBe(b0.equity); // 不结转
    expect([a.inc210, a.inc211, a.inc212]).toEqual([b0.inc210, b0.inc211, b0.inc212]);
    const evidence = await evidenceOf(opened.transferNo);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ eventCode: 'HOUSE_TRANSFER', debitTbAccountId: bigintToHex(feeCashId), creditTbAccountId: bigintToHex(opsCashId) });
    const final = await transfers.findByNo(opened.transferNo);
    expect(final.closeTbTransferIds).toBeNull();
    expect((await transfers.getView(opened.transferNo)).closeTbTransferIds).toEqual([]);
    expect(nlaSpy).not.toHaveBeenCalled(); // 发起、批准、落账全程都没过 NLA 门
    expect(await (prisma as any).auditLogEvent.count({ where: { action: 'PRUDENTIAL_GATE_BLOCKED' } })).toBe(gateAuditBefore); // 不过门，不写拦截审计
    await assertFirmBookBalanced();
  });

  it('④b under an NLA breach (computeStatus spied: NLA exactly at the floor, headroom 0; a 1-fils outflow would be blocked by the gate) both directions still open — house transfers never ask the gate', async () => {
    const real = await prudential.computeStatus();
    const floor = BigInt(real.floorAedMinor);
    const statusSpy = jest.spyOn(prudential, 'computeStatus').mockResolvedValue({
      ...real, nlaAedMinor: floor.toString(), headroomAedMinor: '0', breached: false,
    });
    const gateAuditBefore = await (prisma as any).auditLogEvent.count({ where: { action: 'PRUDENTIAL_GATE_BLOCKED' } });
    try {
      for (const [from, to] of [[opsWallet, feeWallet], [feeWallet, opsWallet]]) {
        const opened = await initiate(from, to, 1n, `breach-spy ${from.vaultCode} to ${to.vaultCode}`);
        expect((await transfers.findByNo(opened.transferNo)).status).toBe(HouseTransferStatus.PENDING_APPROVAL);
        await wf.cancel(opened.transferNo, { reason: 'e2e cleanup' }, treasury); // 收拾夹具：撤回待批单
      }
      expect(statusSpy).not.toHaveBeenCalled(); // 连状态都没去算：服务根本不碰审慎门
    } finally {
      statusSpy.mockRestore();
    }
    expect(nlaSpy).not.toHaveBeenCalled();
    expect(await (prisma as any).auditLogEvent.count({ where: { action: 'PRUDENTIAL_GATE_BLOCKED' } })).toBe(gateAuditBefore);
  });

  // ───────────────────────── ⑤ 拒绝 / 撤回 ─────────────────────────
  it('⑤ CFO rejects → REJECTED (no leg, no entries, audit with the approval causation); treasury withdraws another → CANCELLED (approval cancelled, no leg)', async () => {
    await postFeeIncome('SWAP', 300n);
    const b0 = await snapshot();
    const amount = 100n;

    const rejected = await initiate(feeWallet, opsWallet, amount, 'to be rejected');
    await approvals.reject(rejected.approvalNo, { reason: 'e2e CFO rejects the sweep' }, cfo);
    await waitUntil(async () => (await transfers.findByNo(rejected.transferNo)).status === HouseTransferStatus.REJECTED, 'REJECTED');
    const rejectedRow = await transfers.findByNo(rejected.transferNo);
    expect(rejectedRow.failureNote).toBe('e2e CFO rejects the sweep');
    expect(await fundsOrders.findByParent({ houseTransferId: rejectedRow.id })).toHaveLength(0); // 没建腿
    expect(await evidenceOf(rejected.transferNo)).toHaveLength(0); // 没记账
    const rejectAudit = (await auditOf(rejected.transferNo)).find((x: any) => x.action === 'HOUSE_TRANSFER_REJECTED');
    expect(rejectAudit).toMatchObject({ fromStatus: 'PENDING_APPROVAL', toStatus: 'REJECTED' });
    expect(rejectAudit.approvalNo).toBe(rejected.approvalNo);
    expect(rejectAudit.causationId).toBeTruthy();
    expect(await auditActionsOf(rejected.transferNo)).toEqual(['HOUSE_TRANSFER_REJECTED', 'HOUSE_TRANSFER_REQUESTED']);

    const cancelled = await initiate(feeWallet, opsWallet, amount, 'to be withdrawn');
    const cancelOut = await wf.cancel(cancelled.transferNo, { reason: 'e2e treasury withdraws it' }, treasury);
    expect(cancelOut).toEqual({ transferNo: cancelled.transferNo, status: 'CANCELLED' });
    const cancelledRow = await transfers.findByNo(cancelled.transferNo);
    expect(cancelledRow.status).toBe(HouseTransferStatus.CANCELLED);
    expect((await (prisma as any).approvalCase.findFirst({ where: { approvalNo: cancelled.approvalNo } })).status).toBe('CANCELLED');
    expect(await fundsOrders.findByParent({ houseTransferId: cancelledRow.id })).toHaveLength(0);
    expect(await auditActionsOf(cancelled.transferNo)).toEqual(['HOUSE_TRANSFER_CANCELLED', 'HOUSE_TRANSFER_REQUESTED']);
    // 终态没有出边：已撤回的单再撤 / 已拒绝的单再撤，一律 400
    await expect(wf.cancel(cancelled.transferNo, { reason: 'again' }, treasury)).rejects.toThrow(/cannot be cancelled/);
    await expect(wf.cancel(rejected.transferNo, { reason: 'again' }, treasury)).rejects.toThrow(/cannot be cancelled/);

    expect(await snapshot()).toEqual(b0); // 两张单都没动过账
  });

  // ───────────────────────── 建单守卫（真实钱包 / 真实 TB 余额）─────────────────────────
  it('guards: from = to, the settlement wallet, a balance larger than the from wallet — all 400, no row; nothing is booked', async () => {
    const b0 = await snapshot();
    const before = await (prisma as any).houseTransfer.count();
    await expect(initiate(opsWallet, opsWallet, 100n, 'same wallet')).rejects.toThrow(/two different wallets/);
    await expect(initiate(setWallet, opsWallet, 100n, 'from settlement')).rejects.toMatchObject({ response: { code: 'FROM_WALLET_NOT_ELIGIBLE' } });
    await expect(initiate(opsWallet, setWallet, 100n, 'to settlement')).rejects.toMatchObject({ response: { code: 'TO_WALLET_NOT_ELIGIBLE' } });
    await expect(initiate(feeWallet, opsWallet, b0.feeCash + 1n, 'more than the fee wallet holds')).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_FIRM_BALANCE' } });
    expect(await (prisma as any).houseTransfer.count()).toBe(before);
    expect(await snapshot()).toEqual(b0);
  });

  // ───────────────────────── ⑥ 落账被账本拒（真实 TigerBeetle）─────────────────────────
  it('⑥ two sweeps approved on the same balance: the second 89 is rejected by TigerBeetle → audit HOUSE_TRANSFER_FAILED(POSTING_FAILED), the order stays EXECUTING, nothing else is booked, no compensation; an EXECUTING order cannot be cancelled', async () => {
    await postFeeIncome('SWAP', 300n);
    const amount = (await snapshot()).feeCash; // 整扫两次
    expect(amount).toBeGreaterThan(0n);
    const first = await initiate(feeWallet, opsWallet, amount, 'sweep A');
    const second = await initiate(feeWallet, opsWallet, amount, 'sweep B (same balance)'); // 发起 / 批准时的余额闸都过：A 还没落账
    const A = await approveToLeg(first); const B = await approveToLeg(second);
    await pushLeg(A.leg);
    await waitUntil(async () => (await transfers.findByNo(first.transferNo)).status === HouseTransferStatus.SUCCESS, 'A SUCCESS');
    const afterA = await snapshot();
    expect(afterA.feeCash).toBe(0n);

    await pushLeg(B.leg); // 手续费户已被扫空：B 的 89 贷方户「贷不得超借」，TB 拒
    await waitUntil(async () => (await auditActionsOf(second.transferNo)).includes('HOUSE_TRANSFER_FAILED'), 'B POSTING_FAILED audit');
    const failedAudit = (await auditOf(second.transferNo)).find((x: any) => x.action === 'HOUSE_TRANSFER_FAILED');
    expect(failedAudit).toMatchObject({ reasonCode: 'POSTING_FAILED', outcome: 'FAILED' });
    expect(failedAudit.toStatus).toBeNull();
    const rowB = await transfers.findByNo(second.transferNo);
    expect(rowB.status).toBe(HouseTransferStatus.EXECUTING); // 单停在 EXECUTING
    expect(rowB.failureReasonCode).toBe('POSTING_FAILED'); // 行上记着卡在哪
    expect(rowB.closeTbTransferIds).toBeNull();
    expect(await snapshot()).toEqual(afterA); // 账本一分没动（不补偿、不重试）
    expect(await evidenceOf(second.transferNo)).toHaveLength(0); // 89 被拒，90 根本没尝试
    expect((await fundsOrders.findByParent({ houseTransferId: rowB.id }))[0].status).toBe('CONFIRMED'); // 腿停在 CONFIRMED，不清算
    expect(await auditActionsOf(second.transferNo)).toEqual(['HOUSE_TRANSFER_EXECUTION_STARTED', 'HOUSE_TRANSFER_FAILED', 'HOUSE_TRANSFER_REQUESTED']);
    await expect(wf.cancel(second.transferNo, { reason: 'too late' }, treasury)).rejects.toThrow(/cannot be cancelled/); // 执行中不许撤回
    expect((await transfers.findByNo(second.transferNo)).status).toBe(HouseTransferStatus.EXECUTING);
    await assertFirmBookBalanced();
  });
});
