import * as path from 'path';
import * as dotenv from 'dotenv';

// Same Node 18 polyfill as src/main.ts (@nestjs/schedule needs globalThis.crypto,
// stable only in Node 19+) — main.ts isn't loaded in this e2e harness, so it has
// to be repeated here before AppModule (and therefore ScheduleModule) is imported.
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

// Loaded before any other import so PrismaService / TigerBeetleService see the
// worktree's own DATABASE_URL / TB_ADDRESS regardless of ConfigModule's internal
// load timing (mirrors recon-reattribution.e2e-spec.ts).
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { WalletReconRunService } from '../src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service';
import { ReconciliationQueryService } from '../src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { WalletCashAccountService } from '../src/modules/accounting/tigerbeetle/wallet-cash-account.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { ensureTbAccountRegistry, provisionTbAccounts } from '../prisma/seed-tb.helper';
import { generateReferenceNo } from '../src/common/utils/no-generator.util';
import { toBusinessDate } from '../src/modules/accounting/tigerbeetle/utils/business-date.util';

/**
 * 戊波二 T9a e2e：**客户钱包的对内差额**（spec §4.5 / §8.7，裁定 7 / 18）。
 *
 * 对内差额 = (现金 1·钱包 + 短缺待补 2·钱包) − (应付 100 + 暂扣 101，该客户·该账本)：一只客户钱包自己的两本账必须一致。
 * 对账引擎对它的口径：≠ 0 即 BREAK（对外差额为 0 也开案），归零才结案；差异行写 INVARIANT（外部侧空、无菜单、无解释）。
 *
 * ── 造数为什么是「同本跨客户」（裁定 18）──────────────────────────────────
 * 直接 AccountingService.executeTransfer 记一笔「借 1·A 钱包 / 贷 100·B 客户应付」（同一个 AED 账本）：
 *   · 客户本整体仍平（Σ现金 +Y、Σ应付 +Y）→ 过得了整轮的预门 computeInternalIdentity（跨本造数会先撞预门，逐钱包压根不跑）；
 *   · A 钱包：现金多了 Y、应付没动 → 对内 +Y；B 钱包：现金没动、应付多了 Y → 对内 −Y。
 * 这也说清了对内差额在生产上逮的是什么：同一本账内跨客户记了一半的错。
 *
 * ── 外部侧 ────────────────────────────────────────────────────────────────
 * 两只钱包的外部对账单都照现金户做（A 的外部余额 = 造数后的现金，且有一条同单号的外部行与造数那笔配上；
 * B 的现金没动，外部余额 = 铺底额）——于是**对外差额恒为 0，案子的唯一成因就是对内差额**。
 * 第二段另让 A 再多一个对外差额 +5：两种差额同时在案（A wallet may have BOTH）。
 *
 * ── 夹具 ──────────────────────────────────────────────────────────────────
 * 全新客户 / 全新钱包（绝不复用种子钱包：别的 spec 的并发 worker 会往同一个物理钱包上落真实流水），
 * 截止点钉在 wall-clock now 之后 3 天（同 recon-reattribution：夹具写入的 effectiveDate 恒为今天，
 * 取数不依赖 createdAt 与 cutoff 的毫秒先后；也把本文件的 run 与库里既有演示案件隔开）。
 *
 * ⚠ 时钟窗口：真实时钟落在 UTC 20:00–24:00（迪拜 00:00–04:00）时，用 UTC 日期写外部余额的对账类 e2e 会被拧歪
 *   （见 e2e-baseline-0c6eb7b0.md §3/§4）。本文件的外部余额 cutoffDate 取引擎自己的 toBusinessDate，不受窗口影响。
 * ⚠ 必须与其他 e2e 串行跑（test/jest-e2e.json 的 maxWorkers: 1）：run() 是全局的。
 */
describe('Recon internal delta (e2e, 戊波二 T9a)', () => {
  jest.setTimeout(90000);

  let app: INestApplication;
  let prisma: PrismaService;
  let walletRecon: WalletReconRunService;
  let reconQuery: ReconciliationQueryService;
  let accounting: AccountingService;

  let aedCode: string; // 'AED'
  const LEDGER = 1;    // AED 账本
  let CUTOFF: Date;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(0);
    await app.init();

    prisma = app.get(PrismaService);
    walletRecon = app.get(WalletReconRunService);
    reconQuery = app.get(ReconciliationQueryService);
    accounting = app.get(AccountingService);

    CUTOFF = new Date(Date.now() + 3 * 24 * 3600 * 1000);

    const aed = await (prisma as any).asset.findFirst({ where: { currency: 'AED' } });
    if (!aed || !aed.tbLedgerId) {
      throw new Error('Fixture asset AED not seeded (or missing tbLedgerId) — run `npm run db:biz:init` first.');
    }
    aedCode = aed.code;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // ── helpers（夹具搭法照抄 recon-reattribution.e2e-spec.ts）─────────────────

  async function makeCustomer(tag: string): Promise<{ id: string; customerNo: string }> {
    const customerNo = generateReferenceNo('CU');
    const row = await (prisma as any).customerMain.create({
      data: {
        email: `e2e_recon_intdelta_${tag}_${customerNo}@example.com`.toLowerCase(),
        customerNo,
        phone: `+1${customerNo.replace(/\D/g, '')}`,
        firstName: 'Recon', lastName: 'Fixture',
        customerType: 'INDIVIDUAL',
        lifecycle: 'ACTIVE',
        riskRating: 'LOW', tradingTier: 'BASIC', eddRequired: false,
      },
      select: { id: true, customerNo: true },
    });
    return { id: row.id, customerNo: row.customerNo };
  }

  /** 新客户没有种子客户那样天然带全资产的 TB 账户——补 AED 的应付 / 暂扣两户（同 reattribution）。 */
  async function ensureCustomerAedTbAccounts(customerId: string, customerNo: string): Promise<void> {
    for (const code of [TB_ACCOUNT_CODES.CLIENT_PAYABLE, TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE]) {
      await ensureTbAccountRegistry(prisma as any, {
        code, ledger: LEDGER, ownerType: 'CUSTOMER', ownerUuid: customerId, ownerNo: customerNo,
        assetCode: aedCode, description: `e2e recon-internal-delta ${code}/AED`,
      });
    }
    await provisionTbAccounts(prisma as any);
  }

  /** 全新客户钱包 + 开现金户（码 1）与短缺待补户（码 2）——夹具直造钱包必须调 ensureForWallet（波一规矩）。 */
  async function createCustomerWallet(owner: { id: string; customerNo: string }, tag: string): Promise<{ id: string }> {
    const created = await (prisma as any).wallet.create({
      data: {
        walletNo: `WA-E2E-INTDELTA-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ownerType: 'CUSTOMER', ownerId: owner.id, ownerNo: owner.customerNo,
        vaultCode: 'CLIENT_DEPOSIT', walletRole: 'C_VIBAN', network: 'AED_ZAND',
        iban: `AE_E2E_INTDELTA_${tag}_${Date.now()}`, status: 'ACTIVE',
      },
    });
    await app.get(WalletCashAccountService).ensureForWallet(created);
    return { id: created.id };
  }

  /** 铺底：真实充值的两跳形状（借 钱包现金户 / 贷 暂扣，再借 暂扣 / 贷 应付）。对该钱包 现金 +amount、应付 +amount → 对内平。 */
  async function fundCustomerWallet(opts: { walletId: string; ownerId: string; amount: bigint; tag: string; externalRef: string }): Promise<void> {
    const sourceNo = `E2E-INTDELTA-FUND-${opts.tag}-${randomUUID().slice(0, 8)}`;
    const cashId = await accounting.resolveCashAccountId(opts.walletId, LEDGER);
    const suspenseId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger: LEDGER, ownerType: 'CUSTOMER', ownerUuid: opts.ownerId });
    const payableId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger: LEDGER, ownerType: 'CUSTOMER', ownerUuid: opts.ownerId });
    const base = { assetCurrency: aedCode, traceId: sourceNo, actorType: 'SYSTEM', actorId: 'E2E_HARNESS' };
    await accounting.executeTransfer({
      debitAccountId: cashId, creditAccountId: suspenseId, amount: opts.amount, ledger: LEDGER,
      code: TB_TRANSFER_CODES.DEPOSIT_ASSET_TO_SUSPENSE,
      evidence: {
        ...base, sourceType: 'DEPOSIT', sourceNo, eventCode: 'DEPOSIT_ASSET_TO_SUSPENSE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_CASH], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
        memo: 'e2e fixture: 真实充值入账（Step 1，外部对账单上看得见）', externalRef: opts.externalRef,
      },
    });
    await accounting.executeTransfer({
      debitAccountId: suspenseId, creditAccountId: payableId, amount: opts.amount, ledger: LEDGER,
      code: TB_TRANSFER_CODES.DEPOSIT_SUSPENSE_TO_PAYABLE,
      evidence: {
        ...base, sourceType: 'DEPOSIT', sourceNo, eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE],
        memo: 'e2e fixture: 真实充值入账（Step 2，纯账面重分类）',
      },
    });
  }

  /**
   * 「同本跨客户记了一半」的造数：借 1·A 钱包现金 / 贷 100·B 客户应付（同一个 AED 账本）。
   * reverse = 精确反向（借 100·B / 贷 1·A）。夹具专用 sourceType / eventCode，转账号随机后缀（TB 转账号是确定性哈希，撞号会静默当已存在跳过）。
   */
  async function postCrossCustomer(opts: { a: { walletId: string }; b: { customerId: string }; amount: bigint; externalRef: string; reverse: boolean }): Promise<void> {
    const aCash = await accounting.resolveCashAccountId(opts.a.walletId, LEDGER);
    const bPayable = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger: LEDGER, ownerType: 'CUSTOMER', ownerUuid: opts.b.customerId });
    const eventCode = opts.reverse ? 'E2E_INTERNAL_DELTA_REVERSE' : 'E2E_INTERNAL_DELTA';
    const sourceNo = `E2E-INTDELTA-${eventCode}-${randomUUID().slice(0, 8)}`;
    await accounting.executeTransfer({
      debitAccountId: opts.reverse ? bPayable : aCash,
      creditAccountId: opts.reverse ? aCash : bPayable,
      amount: opts.amount, ledger: LEDGER,
      code: TB_TRANSFER_CODES.DEPOSIT_SUSPENSE_TO_PAYABLE, // 夹具借用一个现成的转账码：本笔没有对应的业务码，也不该有
      evidence: {
        sourceType: 'E2E_INTERNAL_DELTA', sourceNo, eventCode,
        debitCode: TB_CODE_TO_COA[opts.reverse ? TB_ACCOUNT_CODES.CLIENT_PAYABLE : TB_ACCOUNT_CODES.CLIENT_CASH],
        creditCode: TB_CODE_TO_COA[opts.reverse ? TB_ACCOUNT_CODES.CLIENT_CASH : TB_ACCOUNT_CODES.CLIENT_PAYABLE],
        assetCurrency: aedCode, traceId: sourceNo, actorType: 'SYSTEM', actorId: 'E2E_HARNESS',
        memo: opts.reverse ? 'e2e fixture: 对内不平的精确反向更正' : 'e2e fixture: 同本跨客户只记了一半（借 A 现金 / 贷 B 应付）',
        externalRef: opts.externalRef,
      },
    });
  }

  /** 码 91 的形状：借 2·本钱包短缺待补 / 贷 1·本钱包现金（认损那一笔，同一只钱包内部的两个户）。夹具专用 eventCode，转账号随机后缀。 */
  async function postShortfallRecognized(opts: { walletId: string; amount: bigint; externalRef: string }): Promise<void> {
    const shortfallId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_SHORTFALL, ledger: LEDGER, ownerType: 'WALLET', ownerUuid: opts.walletId });
    const cashId = await accounting.resolveCashAccountId(opts.walletId, LEDGER);
    const sourceNo = `E2E-INTDELTA-SHORTFALL-${randomUUID().slice(0, 8)}`;
    await accounting.executeTransfer({
      debitAccountId: shortfallId, creditAccountId: cashId, amount: opts.amount, ledger: LEDGER,
      code: TB_TRANSFER_CODES.CLIENT_SHORTFALL_RECOGNIZED,
      evidence: {
        sourceType: 'E2E_INTERNAL_DELTA', sourceNo, eventCode: 'E2E_SHORTFALL_RECOGNIZED',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_SHORTFALL], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_CASH],
        assetCurrency: aedCode, traceId: sourceNo, actorType: 'SYSTEM', actorId: 'E2E_HARNESS',
        memo: 'e2e fixture: 认损那一笔的形状（借 短缺待补 / 贷 现金，同一只钱包）', externalRef: opts.externalRef,
      },
    });
  }

  async function upsertExternalBalance(walletId: string, closingBalance: bigint): Promise<void> {
    // 外部余额的 cutoffDate 取引擎自己的口径（迪拜业务日），不用 UTC 日期——这样本文件在 UTC 20:00–24:00 窗口内也不被拧歪。
    const cutoffDate = toBusinessDate(CUTOFF);
    await (prisma as any).externalBalance.upsert({
      where: { source_accountRef_cutoffDate: { source: 'ZAND', accountRef: walletId, cutoffDate } },
      create: {
        source: 'ZAND', accountRef: walletId, currency: aedCode, book: 'CLIENT',
        cutoffDate, closingBalance: closingBalance.toString(), walletRef: walletId,
      },
      update: { closingBalance: closingBalance.toString() },
    });
  }

  async function createExternalLine(walletId: string, direction: 'IN' | 'OUT', amount: bigint, externalRef: string): Promise<void> {
    await (prisma as any).externalStatementLine.create({
      data: {
        source: 'ZAND', accountRef: walletId, subAccount: walletId, book: 'CLIENT', currency: aedCode,
        direction, amount: amount.toString(), externalRef, datetime: new Date(), description: 'Incoming',
        dedupKey: `E2E-INTDELTA-${randomUUID()}`,
      },
    });
  }

  const openCaseFor = (walletId: string) =>
    (prisma as any).reconciliationCase.findFirst({ where: { walletRef: walletId, status: 'OPEN' } });
  const caseById = (id: string) => (prisma as any).reconciliationCase.findUnique({ where: { id } });
  const lineItemsOf = (caseId: string) =>
    (prisma as any).reconciliationLineItem.findMany({ where: { caseId }, orderBy: { lineNo: 'asc' } });
  const snapshotOf = (runId: string, walletRef: string) =>
    (prisma as any).reconciliationRunWallet.findUnique({ where: { runId_walletRef: { runId, walletRef } } });
  const runNoOf = async (runId: string): Promise<string> =>
    (await (prisma as any).reconciliationRun.findUnique({ where: { id: runId }, select: { runNo: true } })).runNo;

  // ── 场景：同本跨客户造不平 → 两案 INVARIANT → 叠加对外差额 → 精确反向 → 两案自愈 ───────────

  it('同本跨客户造不平：A +Y / B −Y 各开一案（对外差额 0）、各带一条 INVARIANT 行；再叠一个对外差额两种并存；精确反向记回 → 一次重对账两案自愈', async () => {
    const XA = 120000n;  // A 铺底（AED 1,200.00）
    const XB = 80000n;   // B 铺底（AED 800.00）
    const Y = 35000n;    // 只记了一半的那一笔（AED 350.00）

    // ── 夹具：两个全新客户、各一只 AED 钱包，各自铺底；外部对账单照现金户做 ──
    const custA = await makeCustomer('A');
    const custB = await makeCustomer('B');
    await ensureCustomerAedTbAccounts(custA.id, custA.customerNo);
    await ensureCustomerAedTbAccounts(custB.id, custB.customerNo);
    const walletA = await createCustomerWallet(custA, 'A');
    const walletB = await createCustomerWallet(custB, 'B');

    const fundRefA = `ZANDREF-E2E-INTDELTA-FUNDA-${randomUUID().slice(0, 8)}`;
    const fundRefB = `ZANDREF-E2E-INTDELTA-FUNDB-${randomUUID().slice(0, 8)}`;
    await fundCustomerWallet({ walletId: walletA.id, ownerId: custA.id, amount: XA, tag: 'A', externalRef: fundRefA });
    await fundCustomerWallet({ walletId: walletB.id, ownerId: custB.id, amount: XB, tag: 'B', externalRef: fundRefB });
    await createExternalLine(walletA.id, 'IN', XA, fundRefA);
    await createExternalLine(walletB.id, 'IN', XB, fundRefB);

    // 造数前先自证夹具干净：对内平、对外平 → 一轮对账两只钱包都是 MATCHED、不开案。
    await upsertExternalBalance(walletA.id, XA);
    await upsertExternalBalance(walletB.id, XB);
    const cleanRun = await walletRecon.run({ cutoff: CUTOFF });
    expect(await snapshotOf(cleanRun.runId, walletA.id)).toMatchObject({ bucket: 'MATCHED' });
    expect(await snapshotOf(cleanRun.runId, walletB.id)).toMatchObject({ bucket: 'MATCHED' });
    expect((await snapshotOf(cleanRun.runId, walletA.id)).internalDeltaAmount.toString()).toBe('0');
    expect((await snapshotOf(cleanRun.runId, walletB.id)).internalDeltaAmount.toString()).toBe('0');
    expect(await openCaseFor(walletA.id)).toBeNull();
    expect(await openCaseFor(walletB.id)).toBeNull();

    let reversed = false;
    const reverseRef = `ZANDREF-E2E-INTDELTA-REV-${randomUUID().slice(0, 8)}`;
    try {
      // ── 造不平：借 1·A / 贷 100·B（同一个 AED 账本）。外部侧照现金户做：A 的外部多一条同单号的入账行 ──
      const forwardRef = `ZANDREF-E2E-INTDELTA-FWD-${randomUUID().slice(0, 8)}`;
      await postCrossCustomer({ a: { walletId: walletA.id }, b: { customerId: custB.id }, amount: Y, externalRef: forwardRef, reverse: false });
      await createExternalLine(walletA.id, 'IN', Y, forwardRef);
      await upsertExternalBalance(walletA.id, XA + Y);   // A：外部 = 造数后的现金 → 对外差额 0
      await upsertExternalBalance(walletB.id, XB);       // B：现金没动 → 对外差额 0

      // ── 第一轮：两案各带对内差额与一条 INVARIANT 行 ──
      const run1 = await walletRecon.run({ cutoff: CUTOFF });
      expect(run1.status).toBe('BREAK');

      const caseA = await openCaseFor(walletA.id);
      const caseB = await openCaseFor(walletB.id);
      expect(caseA).toBeTruthy();
      expect(caseB).toBeTruthy();
      expect(caseA).toMatchObject({ bucket: 'BREAK', status: 'OPEN' });
      expect(caseB).toMatchObject({ bucket: 'BREAK', status: 'OPEN' });
      // 对外差额为 0 —— 开案的唯一成因是对内差额（裁定 7：≠ 0 即开案，对外为 0 也开）
      expect(caseA.deltaAmount.toString()).toBe('0');
      expect(caseB.deltaAmount.toString()).toBe('0');
      expect(caseA.internalDeltaAmount.toString()).toBe(Y.toString());          // A 钱包一侧多了 Y
      expect(caseB.internalDeltaAmount.toString()).toBe((-Y).toString());       // B 钱包一侧少了 Y（应付多出来）

      const invA = await lineItemsOf(caseA.id);
      const invB = await lineItemsOf(caseB.id);
      expect(invA).toHaveLength(1);   // 流水全都配上了，案子上只有这一条 INVARIANT，没有别的差异行
      expect(invB).toHaveLength(1);
      expect(invA[0]).toMatchObject({ matchStatus: 'INVARIANT', internalDirection: 'IN', walletRef: walletA.id, status: 'OPEN', resolution: null });
      expect(invB[0]).toMatchObject({ matchStatus: 'INVARIANT', internalDirection: 'OUT', walletRef: walletB.id, status: 'OPEN', resolution: null });
      expect(invA[0].internalAmount.toString()).toBe(Y.toString());             // 行上存绝对值 + 方向
      expect(invB[0].internalAmount.toString()).toBe(Y.toString());
      // 外部侧空、没有可锚定的内部流水 —— 它不参与任何匹配
      for (const li of [invA[0], invB[0]]) {
        expect(li.externalTxId).toBeNull();
        expect(li.externalAmount).toBeNull();
        expect(li.externalDirection).toBeNull();
        expect(li.internalSourceId).toBeNull();
      }

      // 跑批快照：对内差额进了快照行（带符号）
      const snapA = await snapshotOf(run1.runId, walletA.id);
      const snapB = await snapshotOf(run1.runId, walletB.id);
      expect(snapA).toMatchObject({ bucket: 'BREAK', caseNo: caseA.caseNo });
      expect(snapB).toMatchObject({ bucket: 'BREAK', caseNo: caseB.caseNo });
      expect(snapA.deltaAmount.toString()).toBe('0');
      expect(snapA.internalDeltaAmount.toString()).toBe(Y.toString());
      expect(snapB.internalDeltaAmount.toString()).toBe((-Y).toString());

      // 读面：跑批详情钱包表与案件详情都下发对内差额；这类案子没有任何处置菜单可点
      const runDetail: any = await reconQuery.getRun(await runNoOf(run1.runId));
      expect(runDetail.accountStatusTable.find((r: any) => r.walletRef === walletA.id)).toMatchObject({ delta: '0', internalDelta: Y.toString() });
      expect(runDetail.accountStatusTable.find((r: any) => r.walletRef === walletB.id)).toMatchObject({ delta: '0', internalDelta: (-Y).toString() });
      const detailA: any = await reconQuery.getCase(caseA.caseNo);
      expect(String(detailA.internalDeltaAmount)).toBe(Y.toString());
      expect(detailA.lineItems.map((l: any) => l.matchStatus)).toEqual(['INVARIANT']);
      expect(detailA.flowComparison.filter((r: any) => r.dispositions?.length)).toEqual([]);
      const detailB: any = await reconQuery.getCase(caseB.caseNo);
      expect(String(detailB.internalDeltaAmount)).toBe((-Y).toString());
      expect(detailB.flowComparison.filter((r: any) => r.dispositions?.length)).toEqual([]);

      // ── 第二轮：A 另有对外差额 +5（外部多报 5）—— 同一案复观察，两种差额并存 ──
      await upsertExternalBalance(walletA.id, XA + Y + 5n);
      const run2 = await walletRecon.run({ cutoff: CUTOFF });
      expect(run2.status).toBe('BREAK');
      const caseA2 = await caseById(caseA.id);
      expect(caseA2.status).toBe('OPEN');
      expect(caseA2.deltaAmount.toString()).toBe('5');
      expect(caseA2.internalDeltaAmount.toString()).toBe(Y.toString());
      expect((await lineItemsOf(caseA.id)).map((l: any) => l.matchStatus)).toEqual(['INVARIANT']);   // 行是每轮重建的，不累积
      expect(await openCaseFor(walletB.id)).toMatchObject({ id: caseB.id });

      // ── 精确反向记回：借 100·B / 贷 1·A。外部侧照现金户做（A 多一条同单号的出账行，外部余额回到铺底额）──
      await postCrossCustomer({ a: { walletId: walletA.id }, b: { customerId: custB.id }, amount: Y, externalRef: reverseRef, reverse: true });
      reversed = true;
      await createExternalLine(walletA.id, 'OUT', Y, reverseRef);
      await upsertExternalBalance(walletA.id, XA);
      await upsertExternalBalance(walletB.id, XB);

      // ── 第三轮：对内差额归零 → 钱包不在破口集合 → 两案随钱包自愈 ──
      const run3 = await walletRecon.run({ cutoff: CUTOFF });
      expect(await openCaseFor(walletA.id)).toBeNull();
      expect(await openCaseFor(walletB.id)).toBeNull();
      for (const id of [caseA.id, caseB.id]) {
        expect(await caseById(id)).toMatchObject({ status: 'RESOLVED', resolutionReason: 'AUTO_HEALED', closedByRunId: run3.runId });
      }
      expect(run3.casesAutoHealed).toBeGreaterThanOrEqual(2);
      for (const w of [walletA.id, walletB.id]) {
        const snap = await snapshotOf(run3.runId, w);
        expect(snap).toMatchObject({ bucket: 'MATCHED', caseNo: null });
        expect(snap.internalDeltaAmount.toString()).toBe('0');
        expect(snap.deltaAmount.toString()).toBe('0');
      }
    } finally {
      // 断言中途红了也别把不平的账留在库里（后面的 spec 共用这个库）：补上反向更正。
      if (!reversed) {
        await postCrossCustomer({ a: { walletId: walletA.id }, b: { customerId: custB.id }, amount: Y, externalRef: reverseRef, reverse: true }).catch(() => undefined);
      }
    }
  });

  it('认损之后（借 2 / 贷 1，同一只钱包）：短缺待补进算式——现金少了 S、短缺多了 S，对内差额仍为 0，钱包不因此开案', async () => {
    const X = 90000n;  // 铺底
    const S = 25000n;  // 认下的短缺

    const cust = await makeCustomer('S');
    await ensureCustomerAedTbAccounts(cust.id, cust.customerNo);
    const wallet = await createCustomerWallet(cust, 'S');
    const fundRef = `ZANDREF-E2E-INTDELTA-SFUND-${randomUUID().slice(0, 8)}`;
    await fundCustomerWallet({ walletId: wallet.id, ownerId: cust.id, amount: X, tag: 'S', externalRef: fundRef });
    await createExternalLine(wallet.id, 'IN', X, fundRef);
    await upsertExternalBalance(wallet.id, X);
    const before = await walletRecon.run({ cutoff: CUTOFF });
    expect(await snapshotOf(before.runId, wallet.id)).toMatchObject({ bucket: 'MATCHED' });

    // 认损：现金 −S、短缺待补 +S（应付不动）。外部侧配一条同单号的出账行、余额同步少 S ——只为把对外差额与流水异常压到 0，
    // 隔离出「对内差额算式里有没有短缺这一项」：丢了它，这只钱包会读成 现金 X−S ≠ 应付 X，对内 −S。
    const ref = `ZANDREF-E2E-INTDELTA-SHORT-${randomUUID().slice(0, 8)}`;
    await postShortfallRecognized({ walletId: wallet.id, amount: S, externalRef: ref });
    await createExternalLine(wallet.id, 'OUT', S, ref);
    await upsertExternalBalance(wallet.id, X - S);

    const run = await walletRecon.run({ cutoff: CUTOFF });
    const snap = await snapshotOf(run.runId, wallet.id);
    expect(snap.internalTotal.toString()).toBe((X - S).toString());     // 现金户只剩 X−S
    expect(snap.internalDeltaAmount.toString()).toBe('0');              // (X−S) + S − X
    expect(snap.deltaAmount.toString()).toBe('0');
    expect(snap).toMatchObject({ bucket: 'MATCHED', caseNo: null });
    expect(await openCaseFor(wallet.id)).toBeNull();
  });
});
