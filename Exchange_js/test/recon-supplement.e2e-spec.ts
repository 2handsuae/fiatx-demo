import * as path from 'path';
import * as dotenv from 'dotenv';

// Same Node 18 polyfill as src/main.ts (@nestjs/schedule needs globalThis.crypto,
// stable only in Node 19+) — main.ts isn't loaded in this e2e harness, so it has
// to be repeated here before AppModule (and therefore ScheduleModule) is imported.
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

// Loaded before any other import so PrismaService / TigerBeetleService see the
// worktree's own DATABASE_URL / TB_ADDRESS regardless of ConfigModule's internal
// load timing (mirrors recon-aging-write-off.e2e-spec.ts).
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { DispositionService } from '../src/modules/clearing-settle/reconciliation/disposition/disposition.service';
import { SupplementEvidenceService } from '../src/modules/clearing-settle/reconciliation/disposition/supplement-evidence.service';
import { WalletReconRunService } from '../src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TbEvidenceService } from '../src/modules/accounting/tigerbeetle/tb-evidence.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';
import { ApprovalsService } from '../src/modules/governance/approvals/approvals.service';
import { ApprovalActorContext } from '../src/modules/governance/approvals/constants/approval.constants';
import { InboundTransferSignalsService } from '../src/modules/trading/deposit-transactions/inbound-transfer-signals.service';
import { DepositWorkflowService } from '../src/modules/trading/deposit-transactions/deposit-workflow.service';
import { DepositTransactionsService } from '../src/modules/trading/deposit-transactions/deposit-transactions.service';
import { WithdrawWorkflowService } from '../src/modules/trading/withdraw-transactions/withdraw-workflow.service';
import { WithdrawTransactionsService } from '../src/modules/trading/withdraw-transactions/withdraw-transactions.service';
import { WithdrawQuoteService } from '../src/modules/trading/withdrawal-fee-level/withdraw-quote.service';
import { FundsOrderService } from '../src/modules/funds-orders/funds-order.service';
import { FundsOrderStatus } from '../src/modules/funds-orders/dto/funds-order.dto';
import { DEPOSIT_VERDICT_BUTTONS } from '../src/modules/deposit-sumsub/fixtures/verdict-buttons';
import { fakeBankRef, fakeChainTxHash } from '../src/common/utils/fake-external-refs.util';

/**
 * 平账 B 批（spec §9）e2e：补单三入口全链。案子 → 定性（SUPPLEMENT 出口）→ 案子上发起 →
 * 真审批中心（三类型，单步 CFO）→ 业务域执行（① 信号进通道 → 充值单 SUCCESS；② CLAWED_BACK；
 * ③ RETURNED）→ WalletReconRunService.run() 重跑 → 案子 AUTO_HEALED。审计断言按 recordedAt >= testStartedAt 圈定
 * （同日 reset 重跑复用案件号，见 A 批 e2e 的说明）。与另外三份 recon e2e 串行（jest-e2e.json maxWorkers: 1）。
 *
 * 四条主链全部用 demo_bob@example.com（ACTIVE、零未结限制便签）——本文件写作时
 * 用 sqlite3 直查 self 栈库实证：demo_dave@example.com lifecycle=IN_VERIFICATION，
 * demo_carol@example.com 名下挂着一张 OPEN/SILENT 的 SANCTION 限制便签
 * （scope=ALL，来自别的 e2e 套件遗留，不是本任务开的）——两者都会在
 * CustomerAccessService.assertCapability 上 403，不能拿来跑「充值/提现自助发起」
 * 这两个真实客户入口（②③ 分别要先真造一笔 SUCCESS 充值/提现）；B 批三条补单入口
 * 本身（initiateSupplement/initiateClawback/initiateReturnClaim）不查这两道客户闸，
 * 但②③需要的「先有一笔 SUCCESS」前置动作要走客户自助入口，故统一用 Bob。
 * breakCase 每次都建全新钱包，「每个场景的 account_flows 互不相干」这条不变量
 * 不依赖换客户，用同一个 ACTIVE 客户不影响隔离性。
 *
 * ⚠ 本文件顺带在 src 里改了一处：src/modules/clearing-settle/reconciliation/
 * disposition/supplement-evidence.service.ts 的 loadLine() 币种校验此前拿
 * wallet.asset.currency（裸币种 'USDT'）去比 external_statement_lines.currency
 * （全仓惯例存的是 asset.code，加密币是 'USDT-TRON'，见该文件改动处的注释与证据
 * 链接），导致任何加密币账单行都会被误判"币种不符"——①a 用真实 USDT 案子跑通
 * 时当场复现，三条 initiate* 补单入口全部经这条守卫，此前只在 mock 下测过从未
 * 被真实数据触发。判定为显然的字段级笔误（全仓其余同类比较都按 asset.code），
 * 已按任务指示的例外条款自行改正并在此点名，未改动该函数其余行为。
 */
describe('Recon supplement e2e (平账 B 批, Task 8)', () => {
  jest.setTimeout(90000);
  let app: INestApplication; let prisma: PrismaService;
  let dispositions: DispositionService; let supplementEvidence: SupplementEvidenceService;
  let walletRecon: WalletReconRunService; let approvalsService: ApprovalsService;
  let signals: InboundTransferSignalsService; let depositWf: DepositWorkflowService; let deposits: DepositTransactionsService;
  let withdrawWf: WithdrawWorkflowService; let withdraws: WithdrawTransactionsService;
  let withdrawQuoteService: WithdrawQuoteService; let fundsOrders: FundsOrderService;
  let tbEvidence: TbEvidenceService; let accounting: AccountingService;
  let aedAssetId: string; let aedCode: string; let aedDecimals: number;
  let usdtAssetId: string; let usdtCode: string; let usdtDecimals: number;
  let bobId: string; let bobNo: string; let bobWithdrawalIban: string;
  let CUTOFF: Date; let testStartedAt: Date;
  const ops = () => makeActor('E2E_OPS', 'OPS_OFFICER');
  const cfo = () => makeActor('E2E_CFO', 'CFO');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();

    prisma = app.get(PrismaService);
    dispositions = app.get(DispositionService);
    supplementEvidence = app.get(SupplementEvidenceService);
    walletRecon = app.get(WalletReconRunService);
    approvalsService = app.get(ApprovalsService);
    signals = app.get(InboundTransferSignalsService);
    depositWf = app.get(DepositWorkflowService);
    deposits = app.get(DepositTransactionsService);
    withdrawWf = app.get(WithdrawWorkflowService);
    withdraws = app.get(WithdrawTransactionsService);
    withdrawQuoteService = app.get(WithdrawQuoteService);
    fundsOrders = app.get(FundsOrderService);
    tbEvidence = app.get(TbEvidenceService);
    accounting = app.get(AccountingService);

    CUTOFF = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    testStartedAt = new Date();

    const aed = await (prisma as any).asset.findFirst({ where: { currency: 'AED' } });
    const usdt = await (prisma as any).asset.findFirst({ where: { currency: 'USDT' } });
    if (!aed?.tbLedgerId || !usdt?.tbLedgerId) {
      throw new Error('Fixture assets AED/USDT not seeded (or missing tbLedgerId) — run `npm run db:biz:init` first.');
    }
    aedAssetId = aed.id; aedCode = aed.code; aedDecimals = aed.decimals;
    usdtAssetId = usdt.id; usdtCode = usdt.code; usdtDecimals = usdt.decimals;

    const bob = await (prisma as any).customerMain.findUnique({ where: { email: 'demo_bob@example.com' } });
    if (!bob) {
      throw new Error(
        "Fixture customer demo_bob@example.com not found — this worktree's self-stack DB needs " +
          'business seed data first: `DATABASE_URL=... TB_ADDRESS=... npm run db:biz:init`.',
      );
    }
    bobId = bob.id;
    bobNo = bob.customerNo;

    // ②③ 需要先真造一笔 SUCCESS 提现（customerAccessService.assertTradingReady 硬门：
    // 无激活法币提现地址不给建单）——一次性登记，四条链路共用，findFirst 幂等（同日重跑不重复建）。
    bobWithdrawalIban = `AE-E2E-SUPP-WDADDR-${bobNo}`;
    await ensureWithdrawalAddress({
      customerId: bobId, customerNo: bobNo, assetId: aedAssetId,
      addressType: 'BANK', network: 'FIAT', address: bobWithdrawalIban, iban: bobWithdrawalIban,
    });

    // ②/⑥d 的退汇认领要求 Bob「当下」AED 可用余额 >= 这笔退汇额——这个 self 库不
    // 每次重置，Bob 名下的 CLIENT_PAYABLE 是全库累计值（按 ownerId 记，不按钱包），
    // 会被本文件之外别的 e2e 历史跑动带成负数（写作时实测到 -2425.00 AED），首次
    // 真实数据跑通 e2e 时当场复现（brief 只在 mock 下测过，没有累计余额这回事）。
    // 一次性铺一大笔垫底，钱包 id 只是记账留痕的标签——CLIENT_PAYABLE 这本 TB 账
    // 按 (ledger, ownerType, ownerUuid) 记，不按钱包，这只钱包永远不会有对应的
    // external_balance 行，对任何一次 walletRecon.run() 都不可见，不会污染任何
    // 场景自己的对账比对。
    const bulkFundWallet = await createCustomerWallet({
      ownerId: bobId, ownerNo: bobNo, assetId: aedAssetId,
      walletRole: 'C_VIBAN', type: 'FIAT_VIBAN', iban: `AE-E2E-SUPP-BULKFUND-${randomUUID().slice(0, 8)}`,
    });
    await fundCustomerWallet({
      walletId: bulkFundWallet.id, ownerId: bobId, assetId: aedAssetId, ledger: TB_LEDGERS.AED, currency: 'AED',
      amount: 2_000_000n, tag: 'BULKFUND', // 20,000.00 AED——够盖负漂移即可，别铺太大（Step 6(b) 会把它也扣光，扣得越多下一轮起点越怪）
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // ── helpers（makeActor / waitUntil / createCustomerWallet / fundCustomerWallet /
  //     createExternalLine / upsertExternalBalance / openCaseFor 原样抄自
  //     recon-aging-write-off.e2e-spec.ts，dedupKey 前缀改 E2E-SUPP-；未抄
  //     latestApprovalCase——本文件每处审批号都由 initiate*/scan 的返回值直接拿到，
  //     用不上按 actionType 反查） ─────────────────────────────────────────

  function makeActor(userNo: string, role: string): ApprovalActorContext {
    return { actorType: 'ADMIN', userId: `uuid-${userNo}`, userNo, role, roleCodes: [role] };
  }

  async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 30000, intervalMs = 50): Promise<void> {
    const start = Date.now();
    for (;;) {
      if (await predicate()) return;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  async function createCustomerWallet(opts: {
    ownerId: string; ownerNo: string; assetId: string; walletRole: 'C_VIBAN' | 'C_DEP'; type: string; iban?: string; address?: string;
  }): Promise<{ id: string; walletNo?: string | null; iban?: string | null }> {
    return (prisma as any).wallet.create({
      data: {
        walletNo: `WA-E2E-SUPP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ownerType: 'CUSTOMER', ownerId: opts.ownerId, ownerNo: opts.ownerNo,
        type: opts.type, walletRole: opts.walletRole, assetId: opts.assetId,
        address: opts.address ?? null, iban: opts.iban ?? null, status: 'ACTIVE',
      },
      select: { id: true, walletNo: true, iban: true },
    });
  }

  /** Real production evidence shape — mirrors deposit-workflow.service.ts's own
   *  Step 1 (CLIENT_ASSET→DEPOSIT_SUSPENSE, external crossing) + Step 2
   *  (DEPOSIT_SUSPENSE→CLIENT_PAYABLE, pure reclass) exactly. */
  async function fundCustomerWallet(opts: {
    walletId: string; ownerId: string; assetId: string; ledger: number; currency: string; amount: bigint; tag: string;
    externalRef?: string; crossing?: boolean; effectiveDate?: string;
  }): Promise<string> {
    const sourceNo = `E2E-SUPP-FUND-${opts.tag}-${randomUUID().slice(0, 8)}`;

    const clientAssetId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_ASSET, ledger: opts.ledger, ownerType: 'SYSTEM' });
    const suspenseId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger: opts.ledger, ownerType: 'CUSTOMER', ownerUuid: opts.ownerId });
    const payableId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger: opts.ledger, ownerType: 'CUSTOMER', ownerUuid: opts.ownerId });

    await accounting.executeTransfer({
      debitAccountId: clientAssetId, creditAccountId: suspenseId, amount: opts.amount, ledger: opts.ledger,
      code: TB_TRANSFER_CODES.DEPOSIT_ASSET_TO_SUSPENSE,
      evidence: {
        sourceType: 'DEPOSIT', sourceNo, eventCode: 'DEPOSIT_ASSET_TO_SUSPENSE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
        assetCurrency: opts.currency, traceId: sourceNo, actorType: 'SYSTEM', actorId: 'E2E_HARNESS',
        memo: 'e2e fixture: pre-fund customer balance for recon-supplement tests (Step 1)',
        debitWalletRef: opts.walletId, creditWalletRef: opts.walletId,
        externalRef: opts.externalRef ?? null, isExternalCrossing: opts.crossing ?? false,
        ...(opts.effectiveDate ? { effectiveDate: opts.effectiveDate } : {}),
      },
    });

    await accounting.executeTransfer({
      debitAccountId: suspenseId, creditAccountId: payableId, amount: opts.amount, ledger: opts.ledger,
      code: TB_TRANSFER_CODES.DEPOSIT_SUSPENSE_TO_PAYABLE,
      evidence: {
        sourceType: 'DEPOSIT', sourceNo, eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE],
        assetCurrency: opts.currency, traceId: sourceNo, actorType: 'SYSTEM', actorId: 'E2E_HARNESS',
        memo: 'e2e fixture: pre-fund customer balance for recon-supplement tests (Step 2)',
        debitWalletRef: opts.walletId, creditWalletRef: opts.walletId,
        isExternalCrossing: false,
        ...(opts.effectiveDate ? { effectiveDate: opts.effectiveDate } : {}),
      },
    });

    return sourceNo;
  }

  async function createExternalLine(opts: {
    walletId: string; currency: string; book: 'CLIENT' | 'FIRM';
    direction: 'IN' | 'OUT'; amount: bigint; externalRef: string; description?: string; datetime?: Date;
  }): Promise<{ id: string }> {
    return (prisma as any).externalStatementLine.create({
      data: {
        source: 'ZAND', accountRef: opts.walletId, subAccount: opts.walletId,
        book: opts.book, currency: opts.currency, direction: opts.direction, amount: opts.amount.toString(),
        externalRef: opts.externalRef, datetime: opts.datetime ?? new Date(), description: opts.description ?? 'Incoming',
        dedupKey: `E2E-SUPP-${randomUUID()}`,
      },
      select: { id: true },
    });
  }

  async function upsertExternalBalance(opts: {
    walletId: string; currency: string; book: 'CLIENT' | 'FIRM'; closingBalance: bigint; cutoffDate?: string;
  }): Promise<void> {
    const cutoffDate = opts.cutoffDate ?? CUTOFF.toISOString().slice(0, 10);
    await (prisma as any).externalBalance.upsert({
      where: { source_accountRef_cutoffDate: { source: 'ZAND', accountRef: opts.walletId, cutoffDate } },
      create: {
        source: 'ZAND', accountRef: opts.walletId, currency: opts.currency, book: opts.book,
        cutoffDate, closingBalance: opts.closingBalance.toString(), walletRef: opts.walletId,
      },
      update: { closingBalance: opts.closingBalance.toString() },
    });
  }

  async function openCaseFor(walletId: string) {
    return (prisma as any).reconciliationCase.findFirst({ where: { walletRef: walletId, status: 'OPEN' } });
  }

  async function auditSince(action: string, subjectNo: string) {
    return (prisma as any).auditLogEvent.findMany({ where: { action, primarySubjectNo: subjectNo, recordedAt: { gte: testStartedAt } } });
  }

  /** 造一个「外有我无」案子：新钱包 + 外部行 + 收盘 + 跑一次对账，返回案子与差异行。
   *  isCrypto 按 currency 判（本文件只用 USDT/AED 两种），internalMinor 铺底用真实
   *  两步 TB 记账（同 fundCustomerWallet 的 Step1/Step2），外部收盘同步把这笔铺底
   *  算进去——四条主链本身都不需要铺底（外有我无起点即 0），只有 Step6 的反例
   *  预留了这个参数（照抄 brief 的 breakCase 签名，未用不代表没用处：真实差异
   *  案子在演示里常常是「已有余额、漏了新的一笔」，不是每次都从零开始）。 */
  async function breakCase(opts: {
    assetId: string; currency: string; decimals: number; direction: 'IN' | 'OUT'; amountMinor: bigint;
    externalRef: string; ownerId: string; ownerNo: string; internalMinor?: bigint;
  }) {
    const isCrypto = opts.currency !== 'AED';
    const wallet = await createCustomerWallet({
      ownerId: opts.ownerId, ownerNo: opts.ownerNo, assetId: opts.assetId,
      walletRole: isCrypto ? 'C_DEP' : 'C_VIBAN', type: isCrypto ? 'CRYPTO_ADDRESS' : 'FIAT_VIBAN',
      ...(isCrypto ? { address: `TE2ESUPP${randomUUID().slice(0, 10)}` } : { iban: `AE-E2E-SUPP-${randomUUID().slice(0, 10)}` }),
    });
    if (opts.internalMinor && opts.internalMinor > 0n) {
      await fundCustomerWallet({
        walletId: wallet.id, ownerId: opts.ownerId, assetId: opts.assetId,
        ledger: TB_LEDGERS[opts.currency as keyof typeof TB_LEDGERS], currency: opts.currency,
        amount: opts.internalMinor, tag: 'BASE', externalRef: `E2E-SUPP-BASE-${randomUUID()}`,
      });
    }
    const line = await createExternalLine({ walletId: wallet.id, currency: opts.currency, book: 'CLIENT', direction: opts.direction, amount: opts.amountMinor, externalRef: opts.externalRef });
    const closing = (opts.internalMinor ?? 0n) + (opts.direction === 'IN' ? opts.amountMinor : -opts.amountMinor);
    await upsertExternalBalance({ walletId: wallet.id, currency: opts.currency, book: 'CLIENT', closingBalance: closing });
    expect((await walletRecon.run({ cutoff: CUTOFF })).status).toBe('BREAK');
    const kase = await openCaseFor(wallet.id);
    return { wallet, line, kase };
  }

  // ── helpers（本文件新增，brief 未给出字面代码的部分） ──────────────────────

  /** brief Step 5 引用的「recon-adjustment-money-arcs.e2e-spec.ts 里驱动提现到
   *  SUCCESS 的夹具」经核实并不存在于那份文件（该文件唯一的 createFixtureWithdraw
   *  是直接 prisma 建一行 status=RETURNED 的死数据，没有真实状态机/记账，命令：
   *  `grep -n withdrawWf test/recon-adjustment-money-arcs.e2e-spec.ts` 零命中）。
   *  真正「用真实生产入口把提现开到 SUCCESS」的写法在 test/withdraw-money-arcs.e2e-spec.ts
   *  场景 1，本函数是它的字面搬运（decimalToBigint / driveLegTransition 同源）。 */
  function decimalToBigint(decimalValue: string, decimals: number): bigint {
    const [whole, frac = ''] = decimalValue.split('.');
    const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + paddedFrac);
  }

  async function ensureWithdrawalAddress(opts: {
    customerId: string; customerNo: string; assetId: string; addressType: string; network: string; address: string; iban?: string;
  }): Promise<void> {
    const existing = await (prisma as any).withdrawalAddress.findFirst({
      where: { customerId: opts.customerId, assetId: opts.assetId, address: opts.address, status: 'ACTIVE' },
    });
    if (existing) return;
    await (prisma as any).withdrawalAddress.create({
      data: {
        addressNo: `WAD-E2E-SUPP-${opts.addressType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        customerId: opts.customerId, customerNo: opts.customerNo, assetId: opts.assetId, network: opts.network,
        address: opts.address, addressType: opts.addressType, iban: opts.iban ?? null,
        ownershipDeclaredAt: new Date(), ownershipProofType: 'E2E_FIXTURE',
        status: 'ACTIVE', activatesAt: new Date(Date.now() - 1000),
        traceId: `e2e-recon-supplement-address-${opts.addressType}`,
      },
    });
  }

  /** Drives a legSeq 1/2 funds order to CONFIRMED without going through
   *  FundsOrderService's real fire-and-forget `emit()` — mutates the row directly
   *  then calls the real routing entry point, fully awaited exactly once. Copied
   *  verbatim from test/withdraw-money-arcs.e2e-spec.ts (only the CONFIRMED path
   *  is used in this file). */
  async function driveLegTransition(fundsOrderId: string, toStatus: FundsOrderStatus, withdrawId: string): Promise<void> {
    const row: any = await fundsOrders.findById(fundsOrderId);
    if (!row) throw new Error(`funds order ${fundsOrderId} not found`);
    const oldStatus = row.status;
    const history = row.statusHistory ? JSON.parse(row.statusHistory) : [];
    history.push({ fromStatus: oldStatus, toStatus, action: 'E2E_HARNESS_DRIVE', at: new Date().toISOString() });
    const patch: any = { status: toStatus, statusHistory: JSON.stringify(history) };
    if (toStatus === FundsOrderStatus.CONFIRMED) {
      const assetType = (row.asset?.type ?? 'CRYPTO').toUpperCase();
      if (assetType === 'CRYPTO') {
        if (!row.txHash) patch.txHash = fakeChainTxHash(row.fundsOrderNo);
      } else if (!row.referenceNo) {
        patch.referenceNo = fakeBankRef(row.fundsOrderNo, row.createdAt ?? new Date());
      }
    }
    await (prisma as any).fundsOrder.update({ where: { id: fundsOrderId }, data: patch });

    await withdrawWf.handleFundsOrderChanged({
      fundsOrderId, fundsOrderNo: row.fundsOrderNo,
      parent: { withdrawTransactionId: withdrawId },
      legSeq: row.legSeq, attempt: row.attempt, oldStatus, newStatus: toStatus,
    });
  }

  // scripts/demo-lib.ts 的 verdictArgsForButton + VERDICT_BY_WEBHOOK_TYPE 的私有
  // 复制（不改 demo-lib）。原版还会从 typedTags 里挑 sceneTag/dispoTag，本文件
  // 唯一用得到的按钮 V1_APPROVED 两者都没有，故略去那段抽取——省略不改变
  // verdictArgs('approved') 的返回值。
  const VERDICT_BY_WEBHOOK_TYPE: Record<string, 'approved' | 'rejected' | 'awaitUser' | 'onHold'> = {
    applicantKytTxnApproved: 'approved',
    applicantKytTxnRejected: 'rejected',
    applicantKytTxnAwaitingUser: 'awaitUser',
  };
  function verdictArgsForButton(buttonKey: string) {
    const button = (DEPOSIT_VERDICT_BUTTONS as any)[buttonKey];
    if (!button) throw new Error(`unknown deposit verdict button: ${buttonKey}`);
    const verdict = VERDICT_BY_WEBHOOK_TYPE[button.webhookType];
    if (!verdict) throw new Error(`button ${buttonKey} has no approved/rejected/awaitUser mapping (webhookType=${button.webhookType})`);
    return {
      verdict,
      riskScore: button.verdict.score,
      ...(button.verdict.applicantActions?.length && { applicantActions: button.verdict.applicantActions }),
    };
  }
  /** 选 DEPOSIT_VERDICT_BUTTONS 里 webhookType 映射到该结果的那个键——本文件
   *  只用得到 'approved'，唯一命中 V1_APPROVED。 */
  function verdictArgs(outcome: 'approved' | 'rejected' | 'awaitUser' | 'onHold') {
    const buttonKey = Object.keys(DEPOSIT_VERDICT_BUTTONS).find(
      (k) => VERDICT_BY_WEBHOOK_TYPE[(DEPOSIT_VERDICT_BUTTONS as any)[k].webhookType] === outcome,
    );
    if (!buttonKey) throw new Error(`no deposit verdict button maps to outcome ${outcome}`);
    return verdictArgsForButton(buttonKey);
  }

  /** 真造一笔 SUCCESS 法币充值（Bob）：真实客户入口 createForCustomer + QUICK_DEMO
   *  扫描 → 等 COMPLIANCE_PENDING → 真 KYT 通道（花名册 ⚡① 同一条通道）→ 等 SUCCESS；
   *  随后把这笔充值自己的外部对账镜像补上（同参考号的 IN 行）——不补的话，充值
   *  Step 1 那条 isExternalCrossing 内部流水在后续对账里找不到对应外部行，
   *  永远是一条「我有外无」孤儿，桶判定卡在 SOFT_FLAG 而不是 MATCHED（哪怕总额
   *  已经用退汇/退回冲平），调用方最后一步「案子该愈」的断言会等不到 RESOLVED——
   *  e2e 首次真实数据跑通时当场复现（brief Step 4 原文本就点名了这一步，是我
   *  实现时漏抄的，不是 brief 错）。 */
  async function makeSuccessfulFiatDeposit(amount: string): Promise<{ deposit: any; wallet: { id: string } }> {
    const wallet = await createCustomerWallet({
      ownerId: bobId, ownerNo: bobNo, assetId: aedAssetId,
      walletRole: 'C_VIBAN', type: 'FIAT_VIBAN', iban: `AE-E2E-SUPP-DEP-${randomUUID().slice(0, 10)}`,
    });
    const referenceNo = `E2E-DEP-${randomUUID().slice(0, 12)}`;
    await signals.createForCustomer(bobId, { walletId: wallet.id, amount, referenceNo, fromIban: 'AE070331234567890123456' } as any);
    const scan = await signals.scanForCustomer(bobId, { walletId: wallet.id, mode: 'QUICK_DEMO' } as any);
    const depositId = (scan as any).depositIds[0];
    await waitUntil(async () => (await deposits.findOne(depositId)).status === 'COMPLIANCE_PENDING', 30000);
    await depositWf.applyKytVerdict(depositId, verdictArgs('approved'));
    await waitUntil(async () => (await deposits.findOne(depositId)).status === 'SUCCESS', 30000);
    const deposit = await deposits.findOne(depositId);
    await createExternalLine({
      walletId: wallet.id, currency: 'AED', book: 'CLIENT', direction: 'IN',
      amount: decimalToBigint(amount, aedDecimals), externalRef: referenceNo, description: 'Original deposit',
    });
    return { deposit, wallet };
  }

  /** 真造一笔 SUCCESS 法币提现（Bob）：真实客户入口 createWithdrawal（经真报价）
   *  → 真 KYT 通道 → 两条腿（本金 + 手续费，手续费按费率可能为 0）真实 CONFIRMED
   *  → 等 SUCCESS；随后把 NET_POST / FEE_POST 两条腿各自的外部对账镜像补上（两条
   *  evidence 都标了 isExternalCrossing=true，withdraw-money-arcs 既有的记账
   *  形状，本文件不改）——同 makeSuccessfulFiatDeposit 的道理，不补的话这两条
   *  内部流水各是一条「我有外无」孤儿，桶判定卡在 SOFT_FLAG。TigerBeetle 在本系统
   *  没启用不可透支约束（C2，见 doc-final/PRODUCTION-NOTES.md），createWithdrawal
   *  本身不需要余额铺底就能成功——不为它单独铺底。 */
  async function makeSuccessfulFiatWithdraw(amount: string): Promise<any> {
    const wallet = await createCustomerWallet({
      ownerId: bobId, ownerNo: bobNo, assetId: aedAssetId,
      walletRole: 'C_VIBAN', type: 'FIAT_VIBAN', iban: `AE-E2E-SUPP-WDSRC-${randomUUID().slice(0, 10)}`,
    });
    const quote = await withdrawQuoteService.createQuote({
      ownerType: 'CUSTOMER', ownerId: bobId, ownerNo: bobNo, assetId: aedAssetId, assetCode: aedCode,
      amount: new Prisma.Decimal(amount), customerId: bobId,
    });
    const w = await withdrawWf.createWithdrawal(
      { assetId: aedAssetId, amount: Number(amount), toIban: bobWithdrawalIban, quoteId: quote.id } as any,
      bobId, 'CUSTOMER',
    );
    expect(w.status).toBe('COMPLIANCE_PENDING');
    // createWithdrawal() 出生时 fromWalletId 还是 null（真实生产也是——真正绑定在
    // 进 PAYOUT_PENDING 时才由 ensureSourceWalletBound 做，见该私有方法 JSDoc）；
    // 它的查法是"这个客户名下最早那只 ACTIVE 的 C_VIBAN/AED 钱包"，不是"刚建的这
    // 只"。本文件同一个 it() 序列会给 Bob 反复建新的 C_VIBAN/AED 钱包（①b/②各建
    // 一只、每次调用本函数也各建一只），"最早那只"在跑到 ③/⑥ 时早就不是刚建的
    // 这只——账实质上全记到了另一只（可能是别的场景、甚至别的 e2e 早年历史遗留）
    // 钱包上，这只钱包上什么内部流水都没有，"退回后案子该愈"这类断言会永远等不到，
    // e2e 首次真实数据跑通时当场复现（brief 只有 mock 下测过）。直接钉死，绕开这
    // 个"哪只最老"的不确定性——ensureSourceWalletBound 对已有 fromWalletId 的单是
    // no-op（同函数 JSDoc "Idempotent"），这里只是提前把它自己也会做的赋值做掉，
    // 不是绕过什么校验。手续费腿另有一次独立的（无排序）活跃钱包查找
    // （WithdrawWorkflowService#initiatePayoutPhase 里的 findCustomerWallet），不受
    // 这次钉死影响——可能落到另一只钱包上，但净额腿的 POST/退回两笔金额相同、方向
    // 相反，对本钱包净额互相抵消，手续费单独走别处不影响这只钱包"归零"这件事，
    // 不影响本文件任何断言。
    await (prisma as any).withdrawTransaction.update({
      where: { id: w.id },
      data: { fromWalletId: wallet.id, fromWalletNo: wallet.walletNo ?? null, fromIban: wallet.iban ?? null },
    });
    await withdrawWf.applyKytVerdict(w.id, { verdict: 'approved' });
    await waitUntil(async () => (await withdraws.findByNo(w.withdrawNo)).status === 'PAYOUT_PENDING', 30000);
    const [payoutLeg] = await fundsOrders.findByParent({ withdrawTransactionId: w.id }, { legSeq: 1 });
    const feeLegs = await fundsOrders.findByParent({ withdrawTransactionId: w.id }, { legSeq: 2 });
    await driveLegTransition(payoutLeg.id, FundsOrderStatus.CONFIRMED, w.id);
    if (feeLegs[0]) await driveLegTransition(feeLegs[0].id, FundsOrderStatus.CONFIRMED, w.id);
    await waitUntil(async () => (await withdraws.findByNo(w.withdrawNo)).status === 'SUCCESS', 30000);
    const finalW = await withdraws.findByNo(w.withdrawNo);
    const payoutLegAfter = await fundsOrders.findById(payoutLeg.id);
    await createExternalLine({
      walletId: wallet.id, currency: 'AED', book: 'CLIENT', direction: 'OUT',
      amount: decimalToBigint(String(finalW.netAmount), aedDecimals), externalRef: (payoutLegAfter as any).referenceNo, description: 'Original payout',
    });
    if (feeLegs[0]) {
      const feeLegAfter = await fundsOrders.findById(feeLegs[0].id);
      await createExternalLine({
        walletId: wallet.id, currency: 'AED', book: 'CLIENT', direction: 'OUT',
        amount: decimalToBigint(String(finalW.feeAmount), aedDecimals), externalRef: (feeLegAfter as any).referenceNo, description: 'Withdrawal fee',
      });
    }
    return finalW;
  }

  /** 夹具级直接扣款——镜像 fundCustomerWallet 的贷方向，走同一组 TB 原语（同样是
   *  "测试铺底"性质的直接记账，不代表任何真实业务事件）。Step 6(b) 只是要构造
   *  「当下可用余额不够」这一个前提，不需要（也不该）经真实客户提现端点：那笔
   *  金额要清空 Bob 当下的全部余额（大小不可控——这个不清空的 self 库里他的余额
   *  是跨很多次 e2e 历史累计值），真走 createWithdrawal 会撞上 L1
   *  TransactionLimitGateService 的单笔/累计上限，且限额闸门本就不是
   *  initiateClawback 自己那道余额守卫想测的东西——直接记账绕开这个不相关的
   *  限制。 */
  async function debitCustomerBalance(ownerId: string, amountMinor: bigint): Promise<void> {
    if (amountMinor <= 0n) return;
    const sourceNo = `E2E-SUPP-DRAIN-${randomUUID().slice(0, 8)}`;
    const payableId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger: TB_LEDGERS.AED, ownerType: 'CUSTOMER', ownerUuid: ownerId });
    const assetId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_ASSET, ledger: TB_LEDGERS.AED, ownerType: 'SYSTEM' });
    await accounting.executeTransfer({
      debitAccountId: payableId, creditAccountId: assetId, amount: amountMinor, ledger: TB_LEDGERS.AED,
      code: TB_TRANSFER_CODES.RECON_ADJUSTMENT,
      evidence: {
        sourceType: 'DEPOSIT', sourceNo, eventCode: 'E2E_FIXTURE_DRAIN',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
        assetCurrency: 'AED', traceId: sourceNo, actorType: 'SYSTEM', actorId: 'E2E_HARNESS',
        memo: 'e2e fixture: drain customer balance for Step 6(b) insufficient-balance guard test',
        isExternalCrossing: false,
      },
    });
  }

  // ── scenarios ────────────────────────────────────────────────────────────

  it('①a 链上补录：案子 → 定性漏记入金 → 发起（来源地址）→ CFO 批 → 信号进通道 → 充值单 SUCCESS（STEP_1 流水 effectiveDate=业务日、externalRef=行参考号）→ 重跑愈', async () => {
    const txHash = `0xe2esupp${randomUUID().replace(/-/g, '')}`;
    // 150（不是 brief 原文的 61）：USDT 的 DEPOSIT SINGLE_LIMIT 下限是 100（种子
    // transaction_limit_rules 实测值），61 会在 detected() 建单时就带上
    // limitHoldReason=BELOW_MIN，KYT 批准后 applyKytApproved 的 assertTradingReadyOrHold
    // 直接 no-op 掉、永远到不了 SUCCESS——e2e 首次真实数据跑通时当场复现（brief 那个
    // 数字只在 mock 下测过，没有下限门这回事）。
    const { wallet, line, kase } = await breakCase({ assetId: usdtAssetId, currency: usdtCode, decimals: usdtDecimals, direction: 'IN', amountMinor: 150_000_000n, externalRef: txHash, ownerId: bobId, ownerNo: bobNo });
    const disp = await dispositions.record(kase.caseNo, { explainedExternalLineId: line.id, matchType: 'ORPHAN_EXTERNAL', causeCode: 'MISSED_DEPOSIT', externalDirection: 'IN', findingNote: '托管账单有、我方监听漏了' } as any, ops());
    expect(disp.outlet).toBe('SUPPLEMENT'); expect(disp.deferredTarget).toBe('SUPPLEMENT_DEPOSIT');

    const req = await signals.initiateSupplement({ externalLineId: line.id, caseNo: kase.caseNo, dispositionNo: disp.dispositionNo, fromAddress: 'TE2eSupplementSender', reason: '补录漏记入金' }, ops());
    const sig = await (prisma as any).inboundTransferSignal.findUnique({ where: { signalNo: req.signalNo } });
    expect(sig.status).toBe('SUPPLEMENT_PENDING'); expect(sig.txHash).toBe(txHash); expect(String(sig.amount)).toBe('150'); expect(sig.supplementEffectiveDate).toBe(kase.businessDate);
    expect((await (prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo: disp.dispositionNo } })).supplementNo).toBe(req.signalNo);

    await approvalsService.approve(req.approvalNo, { reason: 'e2e CFO approve supplement' }, cfo());
    await waitUntil(async () => (await (prisma as any).inboundTransferSignal.findUnique({ where: { signalNo: req.signalNo } })).status === 'PAYIN_CREATED', 30000);
    const deposit = await (prisma as any).depositTransaction.findFirst({ where: { toWalletId: wallet.id }, orderBy: { createdAt: 'desc' } });
    expect(deposit.txHash).toBe(txHash); expect(deposit.effectiveDate).toBe(kase.businessDate);
    // 走完合规闸：与花名册 ⚡① 同一条通道
    await waitUntil(async () => (await deposits.findOne(deposit.id)).status === 'COMPLIANCE_PENDING', 30000);
    await depositWf.applyKytVerdict(deposit.id, verdictArgs('approved'));
    await waitUntil(async () => (await deposits.findOne(deposit.id)).status === 'SUCCESS', 30000);
    expect((await (prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo: disp.dispositionNo } })).supplementNo).toBe(deposit.depositNo);

    const flow = await (prisma as any).accountFlow.findFirst({ where: { walletRef: wallet.id, externalRef: txHash } });
    expect(flow.effectiveDate).toBe(kase.businessDate);
    await walletRecon.run({ cutoff: CUTOFF });
    expect((await (prisma as any).reconciliationCase.findUnique({ where: { id: kase.id } })).status).toBe('RESOLVED');
    expect(await auditSince('DEPOSIT_SUPPLEMENT_REQUESTED', req.signalNo)).toHaveLength(1);
    expect(await auditSince('DEPOSIT_SUPPLEMENTED', req.signalNo)).toHaveLength(1);
  });

  it('①b 法币补录：案子 → 定性漏记入金 → 发起（来源 IBAN）→ CFO 批 → 信号进通道 → 充值单 SUCCESS → 重跑愈', async () => {
    const ref = `E2E-BANK-REF-${randomUUID().slice(0, 12)}`;
    const { wallet, line, kase } = await breakCase({ assetId: aedAssetId, currency: 'AED', decimals: aedDecimals, direction: 'IN', amountMinor: 120_000n, externalRef: ref, ownerId: bobId, ownerNo: bobNo });
    const disp = await dispositions.record(kase.caseNo, { explainedExternalLineId: line.id, matchType: 'ORPHAN_EXTERNAL', causeCode: 'MISSED_DEPOSIT', externalDirection: 'IN', findingNote: '托管账单有、我方监听漏了（法币）' } as any, ops());
    expect(disp.outlet).toBe('SUPPLEMENT'); expect(disp.deferredTarget).toBe('SUPPLEMENT_DEPOSIT');

    const req = await signals.initiateSupplement({ externalLineId: line.id, caseNo: kase.caseNo, dispositionNo: disp.dispositionNo, fromIban: 'AE070331234567890123456', reason: '补录漏记入金（法币）' }, ops());
    const sig = await (prisma as any).inboundTransferSignal.findUnique({ where: { signalNo: req.signalNo } });
    expect(sig.status).toBe('SUPPLEMENT_PENDING'); expect(sig.referenceNo).toBe(ref); expect(sig.channelType).toBe('FIAT');
    expect((await (prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo: disp.dispositionNo } })).supplementNo).toBe(req.signalNo);

    await approvalsService.approve(req.approvalNo, { reason: 'e2e CFO approve supplement (fiat)' }, cfo());
    await waitUntil(async () => (await (prisma as any).inboundTransferSignal.findUnique({ where: { signalNo: req.signalNo } })).status === 'PAYIN_CREATED', 30000);
    const deposit = await (prisma as any).depositTransaction.findFirst({ where: { toWalletId: wallet.id }, orderBy: { createdAt: 'desc' } });
    expect(deposit.referenceNo).toBe(ref); expect(deposit.effectiveDate).toBe(kase.businessDate);
    // 法币资金单出生即 CONFIRMED，直接等 COMPLIANCE_PENDING（不像链上要先 OBSERVE_CONFIRMING/CONFIRM 两跳）
    await waitUntil(async () => (await deposits.findOne(deposit.id)).status === 'COMPLIANCE_PENDING', 30000);
    await depositWf.applyKytVerdict(deposit.id, verdictArgs('approved'));
    await waitUntil(async () => (await deposits.findOne(deposit.id)).status === 'SUCCESS', 30000);
    expect((await (prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo: disp.dispositionNo } })).supplementNo).toBe(deposit.depositNo);

    const flow = await (prisma as any).accountFlow.findFirst({ where: { walletRef: wallet.id, externalRef: ref } });
    expect(flow.effectiveDate).toBe(kase.businessDate);
    await walletRecon.run({ cutoff: CUTOFF });
    expect((await (prisma as any).reconciliationCase.findUnique({ where: { id: kase.id } })).status).toBe('RESOLVED');
    expect(await auditSince('DEPOSIT_SUPPLEMENT_REQUESTED', req.signalNo)).toHaveLength(1);
    expect(await auditSince('DEPOSIT_SUPPLEMENTED', req.signalNo)).toHaveLength(1);
  });

  it('② 退汇：SUCCESS 充值 1200 AED → 银行扣回 → 定性 → 发起（候选含原单）→ CFO 批 → CLAWED_BACK，借应付贷资产，余额减 → 重跑愈', async () => {
    const { deposit, wallet } = await makeSuccessfulFiatDeposit('1200');
    const ref = `E2E-CLAW-${randomUUID()}`;
    const line = await createExternalLine({ walletId: wallet.id, currency: 'AED', book: 'CLIENT', direction: 'OUT', amount: 120_000n, externalRef: ref, description: 'Return' });
    await upsertExternalBalance({ walletId: wallet.id, currency: 'AED', book: 'CLIENT', closingBalance: 0n }); // 外部：1200 进又 1200 出
    expect((await walletRecon.run({ cutoff: CUTOFF })).status).toBe('BREAK');
    const kase = await openCaseFor(wallet.id);
    const disp = await dispositions.record(kase.caseNo, { explainedExternalLineId: line.id, matchType: 'ORPHAN_EXTERNAL', causeCode: 'BOUNCED_FUNDS', externalDirection: 'OUT', findingNote: '银行撤回' } as any, ops());
    const cands = await supplementEvidence.listCandidates(kase.caseNo, line.id);
    expect(cands.kind).toBe('SUPPLEMENT_BOUNCE'); expect(cands.candidates.map((c) => c.orderNo)).toContain(deposit.depositNo);

    const before = (await accounting.getCustomerAvailableBalance(bobId, 'AED')).available;
    const req = await depositWf.initiateClawback(deposit.depositNo, { externalLineId: line.id, caseNo: kase.caseNo, dispositionNo: disp.dispositionNo, reason: '银行撤回' }, ops());
    await approvalsService.approve(req.approvalNo, { reason: 'e2e CFO approve clawback' }, cfo());
    await waitUntil(async () => (await deposits.findOne(deposit.id)).status === 'CLAWED_BACK', 30000);
    const ev = (await tbEvidence.findBySource('DEPOSIT', deposit.depositNo)).find((e: any) => e.eventCode === 'DEPOSIT_CLAWBACK');
    expect(ev.debitCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE]); expect(ev.creditCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET]);
    expect(ev.externalRef).toBe(ref); expect(ev.effectiveDate).toBe(kase.businessDate);
    expect((await accounting.getCustomerAvailableBalance(bobId, 'AED')).available).toBe(before - 120_000n);
    await walletRecon.run({ cutoff: CUTOFF });
    expect((await (prisma as any).reconciliationCase.findUnique({ where: { id: kase.id } })).status).toBe('RESOLVED');
    expect(await auditSince('DEPOSIT_CLAWED_BACK', deposit.depositNo)).toHaveLength(1);
  });

  it('③ 退回：SUCCESS 提现 → 银行退回 → 定性 → 发起 → CFO 批 → RETURNED，借资产贷应付，余额加、手续费不退 → 重跑愈', async () => {
    const w = await makeSuccessfulFiatWithdraw('900');
    expect(w.status).toBe('SUCCESS');
    const netMinor = decimalToBigint(String(w.netAmount), aedDecimals);
    const ref = `E2E-PAYRET-${randomUUID()}`;
    const line = await createExternalLine({ walletId: w.fromWalletId, currency: 'AED', book: 'CLIENT', direction: 'IN', amount: netMinor, externalRef: ref, description: 'Payout returned' });
    // 收盘设 -feeMinor（手续费留在客户身上的那一份），不是 0：makeSuccessfulFiatWithdraw
    // 已经把「原笔出账」镜像成两条外部行（本金 OUT netMinor + 手续费 OUT feeMinor），
    // 这只钱包外部层面的真实历史是「出 netMinor+feeMinor、回 netMinor」——净变化
    // = -feeMinor，不是 0（手续费不退，钱确实少了这一点，且退回处置本身也不碰
    // 费腿）。此刻内部只有 SUCCESS 提现已经记走的 -netMinor-feeMinor（两条腿都已
    // POST），delta = -feeMinor − (-netMinor-feeMinor) = netMinor ≠ 0，仍是待发现的
    // 差异；认领处置落账后内部归到 -feeMinor，才跟这个不变的收盘对上。
    const feeMinor = decimalToBigint(String(w.feeAmount), aedDecimals);
    await upsertExternalBalance({ walletId: w.fromWalletId, currency: 'AED', book: 'CLIENT', closingBalance: -feeMinor });
    expect((await walletRecon.run({ cutoff: CUTOFF })).status).toBe('BREAK');
    const kase = await openCaseFor(w.fromWalletId);
    const disp = await dispositions.record(kase.caseNo, { explainedExternalLineId: line.id, matchType: 'ORPHAN_EXTERNAL', causeCode: 'PAYOUT_RETURNED', externalDirection: 'IN', findingNote: '银行退回提现' } as any, ops());
    expect(disp.outlet).toBe('SUPPLEMENT'); expect(disp.deferredTarget).toBe('SUPPLEMENT_PAYOUT_RETURN');

    const feeEvidenceBefore = (await tbEvidence.findBySource('WITHDRAWAL', w.withdrawNo)).filter((e: any) => String(e.eventCode).includes('FEE'));
    const before = (await accounting.getCustomerAvailableBalance(bobId, 'AED')).available;
    const req = await withdrawWf.initiateReturnClaim(w.withdrawNo, { externalLineId: line.id, caseNo: kase.caseNo, dispositionNo: disp.dispositionNo, reason: '银行退回' }, ops());
    await approvalsService.approve(req.approvalNo, { reason: 'e2e CFO approve return-claim' }, cfo());
    await waitUntil(async () => (await withdraws.findByNo(w.withdrawNo)).status === 'RETURNED', 30000);

    const ev = (await tbEvidence.findBySource('WITHDRAWAL', w.withdrawNo)).find((e: any) => e.eventCode === 'WITHDRAW_BOUNCE_REENTRY');
    expect(ev.debitCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET]); expect(ev.creditCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE]);
    expect(ev.externalRef).toBe(ref); expect(ev.effectiveDate).toBe(kase.businessDate);
    expect((await accounting.getCustomerAvailableBalance(bobId, 'AED')).available).toBe(before + netMinor);
    const feeEvidenceAfter = (await tbEvidence.findBySource('WITHDRAWAL', w.withdrawNo)).filter((e: any) => String(e.eventCode).includes('FEE'));
    expect(feeEvidenceAfter.length).toBe(feeEvidenceBefore.length); // 手续费不退：净额腿之外没有新的费腿证据
    await walletRecon.run({ cutoff: CUTOFF });
    expect((await (prisma as any).reconciliationCase.findUnique({ where: { id: kase.id } })).status).toBe('RESOLVED');
    expect(await auditSince('WITHDRAW_RETURNED_AFTER_SUCCESS', w.withdrawNo)).toHaveLength(1);
  });

  it('拒绝路径：同一行二次发起 400；② 余额不足 400；成因与方向不符 400；CFO 拒绝后原状态不动、supplementNo 清空、可再发起', async () => {
    // (a) 方向不符：外部 OUT 行定性 MISSED_DEPOSIT（要求 IN）→ dispositions.record 抛 /方向不符/
    const txHashA = `0xe2esuppdiramis${randomUUID().replace(/-/g, '')}`;
    const { line: lineA, kase: kaseA } = await breakCase({ assetId: usdtAssetId, currency: usdtCode, decimals: usdtDecimals, direction: 'OUT', amountMinor: 2_000_000n, externalRef: txHashA, ownerId: bobId, ownerNo: bobNo });
    await expect(dispositions.record(kaseA.caseNo, { explainedExternalLineId: lineA.id, matchType: 'ORPHAN_EXTERNAL', causeCode: 'MISSED_DEPOSIT', externalDirection: 'OUT', findingNote: 'e2e 方向不符测试' } as any, ops())).rejects.toThrow(/方向不符/);

    // (c) 二次发起：①a 这条补单路一旦被 CFO 拒绝，账单行仍被那笔（已拒绝的）信号永久占用
    // ——inboundTransferSignal.supplementOfExternalLineId 是 @unique 且拒绝不清空它
    // （只清 disposition.supplementNo），故拒绝后同一行的第二次发起仍会撞
    // assertUnclaimed 的「已被补录 .* 认领」，不是 assertClaimable 更早那条「已转补单」
    // ——两条 400 文案不同，必须先拒绝一次才能真实复现被 brief 点名的那条文案。
    const txHashC = `0xe2esuppdup${randomUUID().replace(/-/g, '')}`;
    const { line: lineC, kase: kaseC } = await breakCase({ assetId: usdtAssetId, currency: usdtCode, decimals: usdtDecimals, direction: 'IN', amountMinor: 3_000_000n, externalRef: txHashC, ownerId: bobId, ownerNo: bobNo });
    const dispC = await dispositions.record(kaseC.caseNo, { explainedExternalLineId: lineC.id, matchType: 'ORPHAN_EXTERNAL', causeCode: 'MISSED_DEPOSIT', externalDirection: 'IN', findingNote: 'e2e 二次发起测试' } as any, ops());
    const reqC = await signals.initiateSupplement({ externalLineId: lineC.id, caseNo: kaseC.caseNo, dispositionNo: dispC.dispositionNo, fromAddress: 'TE2eSupplementDup', reason: 'e2e first attempt (to be rejected)' }, ops());
    await approvalsService.reject(reqC.approvalNo, { reason: 'e2e CFO reject to poison the line' }, cfo());
    await waitUntil(async () => (await (prisma as any).inboundTransferSignal.findUnique({ where: { signalNo: reqC.signalNo } })).status === 'SUPPLEMENT_REJECTED', 30000);
    expect((await (prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo: dispC.dispositionNo } })).supplementNo).toBeNull();
    await expect(signals.initiateSupplement({ externalLineId: lineC.id, caseNo: kaseC.caseNo, dispositionNo: dispC.dispositionNo, fromAddress: 'TE2eSupplementDup2', reason: 'e2e retry' }, ops())).rejects.toThrow(/已被补录 .* 认领/);

    // (d) 拒绝：新造 ② 场景，initiateClawback 后 CFO 拒绝，原状态不动、占用清空、可再发起拿新 approvalNo
    // ——放在 (b) 之前跑：(b) 会故意把 Bob 的可用余额打到不够，(d) 需要余额充足才是真的在测「拒绝后能重来」而不是意外撞到余额不足。
    const { deposit: depD, wallet: walletD } = await makeSuccessfulFiatDeposit('300');
    const refD = `E2E-CLAW-REJ-${randomUUID()}`;
    const lineD = await createExternalLine({ walletId: walletD.id, currency: 'AED', book: 'CLIENT', direction: 'OUT', amount: 30_000n, externalRef: refD, description: 'Return' });
    await upsertExternalBalance({ walletId: walletD.id, currency: 'AED', book: 'CLIENT', closingBalance: 0n });
    await walletRecon.run({ cutoff: CUTOFF });
    const kaseD = await openCaseFor(walletD.id);
    const dispD = await dispositions.record(kaseD.caseNo, { explainedExternalLineId: lineD.id, matchType: 'ORPHAN_EXTERNAL', causeCode: 'BOUNCED_FUNDS', externalDirection: 'OUT', findingNote: 'e2e 拒绝后可再发起测试' } as any, ops());
    const reqD = await depositWf.initiateClawback(depD.depositNo, { externalLineId: lineD.id, caseNo: kaseD.caseNo, dispositionNo: dispD.dispositionNo, reason: 'e2e clawback then reject' }, ops());
    await approvalsService.reject(reqD.approvalNo, { reason: 'e2e CFO reject clawback' }, cfo());
    await waitUntil(async () => (await (prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo: dispD.dispositionNo } })).supplementNo === null, 30000);
    const depDAfterReject = await deposits.findOne(depD.id);
    expect(depDAfterReject.clawbackExternalLineId).toBeNull();
    expect(depDAfterReject.status).toBe('SUCCESS');
    const reqD2 = await depositWf.initiateClawback(depD.depositNo, { externalLineId: lineD.id, caseNo: kaseD.caseNo, dispositionNo: dispD.dispositionNo, reason: 'e2e retry after reject' }, ops());
    expect(reqD2.approvalNo).not.toBe(reqD.approvalNo);

    // (b) 余额不足：先把 Bob 的 AED 可用余额直接记账扣到明显低于 0（夹具级直接扣款，
    // 理由见 debitCustomerBalance 的 JSDoc；扣的比「当前余额」多 1500，保证扣完
    // 是负的，无论当前是正是负），再造一笔 1200 SUCCESS 充值发起退汇——此时她的
    // 总可用余额仍 < 1200，assertClawbackBalance 抛 /余额不足/。
    const beforeDrain = (await accounting.getCustomerAvailableBalance(bobId, 'AED')).available;
    const drainAmountMinor = (beforeDrain > 0n ? beforeDrain : 0n) + 150_000n;
    await debitCustomerBalance(bobId, drainAmountMinor);
    const { deposit: depB, wallet: walletB } = await makeSuccessfulFiatDeposit('1200');
    const refB = `E2E-CLAW-INSUFF-${randomUUID()}`;
    const lineB = await createExternalLine({ walletId: walletB.id, currency: 'AED', book: 'CLIENT', direction: 'OUT', amount: 120_000n, externalRef: refB, description: 'Return' });
    await upsertExternalBalance({ walletId: walletB.id, currency: 'AED', book: 'CLIENT', closingBalance: 0n });
    await walletRecon.run({ cutoff: CUTOFF });
    const kaseB = await openCaseFor(walletB.id);
    const dispB = await dispositions.record(kaseB.caseNo, { explainedExternalLineId: lineB.id, matchType: 'ORPHAN_EXTERNAL', causeCode: 'BOUNCED_FUNDS', externalDirection: 'OUT', findingNote: 'e2e 余额不足测试' } as any, ops());
    await expect(depositWf.initiateClawback(depB.depositNo, { externalLineId: lineB.id, caseNo: kaseB.caseNo, dispositionNo: dispB.dispositionNo, reason: 'e2e 余额不足' }, ops())).rejects.toThrow(/余额不足/);
  });
});
