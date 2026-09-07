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
import { CustomerDepositWalletService } from '../src/modules/asset-treasury/wallets/customer-deposit-wallet.service';
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
 * ③ RETURNED）→ WalletReconRunService.run() 重跑 → 案子 RESOLVED（resolutionReason=AUTO_HEALED）。审计断言按 recordedAt >= testStartedAt 圈定
 * （同日 reset 重跑复用案件号，见 A 批 e2e 的说明）。与另外三份 recon e2e 串行（jest-e2e.json maxWorkers: 1）。
 *
 * ①a/①b/③ 三条主链用 demo_bob@example.com（ACTIVE、零未结限制便签）——本文件
 * 写作时用 sqlite3 直查 self 栈库实证：demo_dave@example.com lifecycle=IN_VERIFICATION，
 * demo_carol@example.com 名下挂着一张 OPEN/SILENT 的 SANCTION 限制便签
 * （scope=ALL，来自别的 e2e 套件遗留，不是本任务开的）——两者都会在
 * CustomerAccessService.assertCapability 上 403，不能拿来跑「充值/提现自助发起」
 * 这两个真实客户入口（①a/①b/③ 都要先走客户自助入口造一笔 SUCCESS）；B 批三条
 * 补单入口本身（initiateSupplement/initiateClawback/initiateReturnClaim）不查
 * 这两道客户闸。② 与拒绝路径 (d) 改用各自独立的全新客户（Task 12 验收轮收口）——
 * self 栈的 demo:all 花名册第 18 条固定给 Bob 铺一笔 25 万 AED 待审批提现
 * （PENDING_APPROVAL，TigerBeetle pending 未过账），会把 Bob 的 AED 可用余额锁成
 * 负数，与合并闸门要求的「先 demo:all 再跑这份 e2e」顺序互斥（首次按此顺序跑通
 * 全套闸门时当场复现——不是记账逻辑缺陷，是这两条用例复用 Bob 造成的环境耦合，
 * 详见各自 it() 内注释与 Task 12 报告根因链路）。
 * breakCase 每次都建全新钱包，「每个场景的 account_flows 互不相干」这条不变量
 * 不依赖换客户，用同一个客户（或各自的新客户）不影响隔离性。
 *
 * ⚠ 本文件顺带在 src 里改了两处（均评审复核确认为实现错，非 brief/测试预期错）：
 * 1) src/modules/clearing-settle/reconciliation/disposition/supplement-evidence.service.ts
 *    的 loadLine() 币种校验此前拿 wallet.asset.currency（裸币种 'USDT'）去比
 *    external_statement_lines.currency（全仓惯例存的是 asset.code，加密币是
 *    'USDT-TRON'，见该文件改动处的注释与证据链接），导致任何加密币账单行都会被
 *    误判"币种不符"——①a 用真实 USDT 案子跑通时当场复现，三条 initiate* 补单
 *    入口全部经这条守卫，此前只在 mock 下测过从未被真实数据触发。
 * 2) 同文件的 assertUnclaimed() + inbound-transfer-signals.service.ts 的
 *    initiateSupplement()：spec §2.2/§9-5 明写"拒绝/超时/撤回后原状态不动、
 *    supplementNo 清空、可再次发起"，①②③ 三路口径一致；但①的占用列
 *    supplementOfExternalLineId 是 @unique 且从不清空（②③靠 clearClawbackRequest
 *    一类方法清空各自占用列），初版实现漏了"拒绝后复用同一行"这条路，账单行会
 *    被永久占用——Step 6(c) 用真实数据跑通时当场复现，评审判为 Critical。
 * 两处均为孤立、可被真实数据证伪的字段/分支缺口，不涉及设计取舍；已按任务指示
 * 的例外条款自行改正并在此点名，改动详情见各自文件内注释。
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
  let depositWallets: CustomerDepositWalletService;
  let aedAssetId: string; let aedCode: string; let aedDecimals: number; let aedNetwork: string;
  let usdtAssetId: string; let usdtCode: string; let usdtDecimals: number; let usdtNetwork: string;
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
    depositWallets = app.get(CustomerDepositWalletService);

    CUTOFF = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    testStartedAt = new Date();

    const aed = await (prisma as any).asset.findFirst({ where: { currency: 'AED' } });
    const usdt = await (prisma as any).asset.findFirst({ where: { currency: 'USDT' } });
    if (!aed?.tbLedgerId || !usdt?.tbLedgerId) {
      throw new Error('Fixture assets AED/USDT not seeded (or missing tbLedgerId) — run `npm run db:biz:init` first.');
    }
    aedAssetId = aed.id; aedCode = aed.code; aedDecimals = aed.decimals; aedNetwork = aed.network;
    usdtAssetId = usdt.id; usdtCode = usdt.code; usdtDecimals = usdt.decimals; usdtNetwork = usdt.network;

    const bob = await (prisma as any).customerMain.findUnique({ where: { email: 'demo_bob@example.com' } });
    if (!bob) {
      throw new Error(
        "Fixture customer demo_bob@example.com not found — this worktree's self-stack DB needs " +
          'business seed data: run `bash scripts/stack.sh reset self && bash scripts/stack.sh up && ' +
          'bash scripts/on-stack.sh self demo:all` first (db:biz:init alone seeds Bob, but this suite ' +
          'is designed to run AFTER demo:all, not instead of it — see Task 12 收口轮).',
      );
    }
    bobId = bob.id;
    bobNo = bob.customerNo;

    // ①a/①b/③（及拒绝路径 (a)/(c)）需要先真造一笔 SUCCESS 充值/提现
    // （customerAccessService.assertTradingReady 硬门：无激活法币提现地址不给建单）
    // ——一次性登记，findFirst 幂等（同日重跑不重复建）。② 与拒绝路径 (d) 改用各自
    // 独立的全新客户（不再依赖这笔地址），理由见各自 it() 内注释。
    bobWithdrawalIban = `AE-E2E-SUPP-WDADDR-${bobNo}`;
    await ensureWithdrawalAddress({
      customerId: bobId, customerNo: bobNo,
      addressType: 'BANK', network: aedNetwork, address: bobWithdrawalIban, iban: bobWithdrawalIban,
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // ── helpers（makeActor / waitUntil / ensureDepositWallet / fundCustomerWallet /
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

  /** 客户在某网络上的收款地址行——走真实生产入口 createOrReturn（合并 main / V3 波一
   *  T5 后改）。波一把 Wallet 从「一资产一钱包」改成「一 vault × 一网络 × 一归属人一行
   *  地址」，并加了 @@unique([vaultCode, network, ownerNo])：同一客户在同一网络上**只能
   *  有一行** CLIENT_DEPOSIT。此前本文件自己 prisma.wallet.create 手搓钱包、每个场景建
   *  一只，那两个写法在新模型下都不成立——写的列（type / assetId）已被删，且第二只就撞
   *  唯一约束（demo:all 还会先给每个种子客户各铺一行 TRON + AED_ZAND，见 demo-lib.ts，
   *  所以对 Bob 连第一只都建不出来）。改调 createOrReturn 后：同一客户同一网络反复调
   *  返回同一行（它自己就是 create-or-return 语义），要独立钱包就换独立客户。 */
  async function ensureDepositWallet(customerId: string, network: string): Promise<any> {
    return depositWallets.createOrReturn(customerId, network);
  }

  /** 一个本文件专属的全新客户，配齐「能跑通充值/提现自助入口」所需的两样东西：
   *  TB 账户（provisionCustomerTbAccounts）+ 已登记的法币提现地址（assertTradingReady
   *  硬门，也是 createOrReturn 开新地址时要过的门）。新模型下「一客户一网络一地址行」，
   *  所以每个需要**独立钱包 / 独立案子**的场景都得有自己的客户——这正是 breakCase 从
   *  「给 Bob 建第 N 只钱包」改成「造一个自己的客户」的原因。 */
  async function createIsolatedCustomer(tag: string): Promise<{ id: string; customerNo: string }> {
    const customer = await (prisma as any).customerMain.create({
      data: { customerNo: `CU-E2E-SUPP-${tag}-${randomUUID().slice(0, 8)}`, lifecycle: 'ACTIVE' },
      select: { id: true, customerNo: true },
    });
    await provisionCustomerTbAccounts(customer.id, customer.customerNo);
    const iban = `AE-E2E-SUPP-WDADDR-${customer.customerNo}`;
    await ensureWithdrawalAddress({
      customerId: customer.id, customerNo: customer.customerNo,
      addressType: 'BANK', network: aedNetwork, address: iban, iban,
    });
    return customer;
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
    externalRef: string; tag: string; internalMinor?: bigint;
  }) {
    const isCrypto = opts.currency !== 'AED';
    // 合并 main / V3 波一 T5 后：每个破口案子配一个**自己的客户**，不再是「给 Bob 再建
    // 一只钱包」。新模型下同一客户同一网络只有一行收款地址（@@unique），而每条主链都要
    // 一个独立的钱包 + 独立的案子（openCaseFor 按 walletRef 找 OPEN 案），共用客户会让
    // 几条主链抢同一只钱包、同一个案子。客户本身对这些断言不是变量——断言都锚在
    // wallet.id / kase.id 上，不锚在"谁"身上。
    const customer = await createIsolatedCustomer(opts.tag);
    const wallet = await ensureDepositWallet(customer.id, isCrypto ? usdtNetwork : aedNetwork);
    if (opts.internalMinor && opts.internalMinor > 0n) {
      await fundCustomerWallet({
        walletId: wallet.id, ownerId: customer.id, assetId: opts.assetId,
        ledger: TB_LEDGERS[opts.currency as keyof typeof TB_LEDGERS], currency: opts.currency,
        amount: opts.internalMinor, tag: 'BASE', externalRef: `E2E-SUPP-BASE-${randomUUID()}`,
      });
    }
    const line = await createExternalLine({ walletId: wallet.id, currency: opts.currency, book: 'CLIENT', direction: opts.direction, amount: opts.amountMinor, externalRef: opts.externalRef });
    const closing = (opts.internalMinor ?? 0n) + (opts.direction === 'IN' ? opts.amountMinor : -opts.amountMinor);
    await upsertExternalBalance({ walletId: wallet.id, currency: opts.currency, book: 'CLIENT', closingBalance: closing });
    expect((await walletRecon.run({ cutoff: CUTOFF })).status).toBe('BREAK');
    const kase = await openCaseFor(wallet.id);
    return { wallet, line, kase, customer };
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

  /** 合并 main（V3 波一 T8）后 WithdrawalAddress 砍掉 assetId、改按 network 归口，
   *  唯一键是 (customerId, network, address)。法币银行行的 network 存的是**资产自己的
   *  network**（'AED_ZAND'），不是 'FIAT'——见 WithdrawWorkflowService 里按
   *  `{ customerId, network: asset.network, iban, addressType:'BANK' }` 查注册地址的那段
   *  与 demo-lib.ts 的种子写法。此前本函数传 assetId + network:'FIAT'，前者已是不存在的
   *  列（PrismaClientValidationError），后者会让提现单查不到注册地址而 400。 */
  async function ensureWithdrawalAddress(opts: {
    customerId: string; customerNo: string; addressType: string; network: string; address: string; iban?: string;
  }): Promise<void> {
    const existing = await (prisma as any).withdrawalAddress.findFirst({
      where: { customerId: opts.customerId, network: opts.network, address: opts.address, status: 'ACTIVE' },
    });
    if (existing) return;
    await (prisma as any).withdrawalAddress.create({
      data: {
        addressNo: `WAD-E2E-SUPP-${opts.addressType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        customerId: opts.customerId, customerNo: opts.customerNo, network: opts.network,
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

  /** 真造一笔 SUCCESS 法币充值：真实客户入口 createForCustomer + QUICK_DEMO
   *  扫描 → 等 COMPLIANCE_PENDING → 真 KYT 通道（花名册 ⚡① 同一条通道）→ 等 SUCCESS；
   *  随后把这笔充值自己的外部对账镜像补上（同参考号的 IN 行）——不补的话，充值
   *  Step 1 那条 isExternalCrossing 内部流水在后续对账里找不到对应外部行，
   *  永远是一条「我有外无」孤儿，桶判定卡在 COMPENSATING 而不是 MATCHED（哪怕总额
   *  已经用退汇/退回冲平），调用方最后一步「案子该愈」的断言会等不到 RESOLVED——
   *  e2e 首次真实数据跑通时当场复现（brief Step 4 原文本就点名了这一步，是我
   *  实现时漏抄的，不是 brief 错）。customerId/customerNo 默认 Bob——Step 6(b)
   *  要单独用一个本文件专属的全新客户（避免碰 Bob 的历史余额），显式传参覆盖。 */
  async function makeSuccessfulFiatDeposit(amount: string, customerId: string = bobId, customerNo: string = bobNo): Promise<{ deposit: any; wallet: { id: string } }> {
    void customerNo; // 新模型下钱包由 createOrReturn 按 customerId 取，不再手搓、不需要 ownerNo
    // 合并 main / V3 波一 T5：客户自助入金的钥匙从内部 walletId 换成（网络, 地址 | IBAN），
    // 钱包也从「每笔充值建一只」换成「一客户一网络一行」，故这里取回该客户既有的
    // AED_ZAND 收款行（Bob 的那行 demo:all 已铺好），用它的 IBAN 当入金落点。
    const wallet = await ensureDepositWallet(customerId, aedNetwork);
    const referenceNo = `E2E-DEP-${randomUUID().slice(0, 12)}`;
    await signals.createForCustomer(customerId, { network: aedNetwork, iban: wallet.iban, amount, referenceNo, fromIban: 'AE070331234567890123456' } as any);
    const scan = await signals.scanForCustomer(customerId, { network: aedNetwork, iban: wallet.iban, mode: 'QUICK_DEMO' } as any);
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
   *  内部流水各是一条「我有外无」孤儿，桶判定卡在 COMPENSATING。TigerBeetle 在本系统
   *  没启用不可透支约束（C2，见 doc-final/PRODUCTION-NOTES.md），createWithdrawal
   *  本身不需要余额铺底就能成功——不为它单独铺底。 */
  async function makeSuccessfulFiatWithdraw(amount: string, customer: { id: string; customerNo: string }, toIban: string): Promise<any> {
    // 改成收一个**独立客户**（合并 main / V3 波一 T5）：新模型下一客户一网络只有一行
    // 收款地址，Bob 的那一行是 demo:all 花名册 29 笔反复用过的公共钱包，外部收盘上挂满
    // 了别人的历史；③ 的判据要按「这只钱包出 net+fee、回 net，净变化 = -fee」精确摆
    // 收盘余额才能重跑自愈，落在这样一只公共钱包上永远对不平（案子停在 OPEN）。
    // 独立客户 = 独立钱包 = 干净的外部历史，收盘算术才成立。
    const wallet = await ensureDepositWallet(customer.id, aedNetwork);
    const quote = await withdrawQuoteService.createQuote({
      ownerType: 'CUSTOMER', ownerId: customer.id, ownerNo: customer.customerNo, assetId: aedAssetId, assetCode: aedCode,
      amount: new Prisma.Decimal(amount), customerId: customer.id,
    });
    const w = await withdrawWf.createWithdrawal(
      { assetId: aedAssetId, amount: Number(amount), toIban, quoteId: quote.id } as any,
      customer.id, 'CUSTOMER',
    );
    expect(w.status).toBe('COMPLIANCE_PENDING');
    // createWithdrawal() 出生时 fromWalletId 还是 null（真实生产也是——真正绑定在
    // 进 PAYOUT_PENDING 时才由 ensureSourceWalletBound 做，见该私有方法 JSDoc）；
    // 它的查法是"这个客户名下最早那只 ACTIVE 的 C_VIBAN/AED 钱包"，不是"刚建的这只"。
    // 合并 main / V3 波一 T5 后这个不确定性**从根上消失了**：新模型给同一客户在同一
    // 网络上只留一行收款地址（@@unique([vaultCode, network, ownerNo])），该客户名下的
    // AED_ZAND 行有且仅有一只，"最早那只" ≡ "上面 createOrReturn 取回的这只"。此前
    // 本文件给 Bob 反复建新 C_VIBAN/AED 钱包，"最早那只"跑到 ③/⑥ 时早就不是刚建的
    // 那只，账全记到了别只上、"退回后案子该愈"永远等不到（e2e 首次真实数据跑通时
    // 当场复现）——那个坑连同"手续费腿可能落到另一只钱包"的隐患一起没了：现在
    // 只有一只钱包可选，NET_POST / FEE_POST / BOUNCE_REENTRY 必然同址。
    // 下面这次赋值保留：ensureSourceWalletBound 对已有 fromWalletId 的单是 no-op
    // （同函数 JSDoc "Idempotent"），这里只是提前把它自己也会做的赋值做掉，不绕校验。
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
   *  「当下可用余额不够」这一个前提，不需要（也不该）经真实客户提现端点：真走
   *  createWithdrawal 会撞上 L1 TransactionLimitGateService 的单笔/累计上限，
   *  且限额闸门本就不是 initiateClawback 自己那道余额守卫想测的东西——直接记账
   *  绕开这个不相关的限制。调用方对本文件专属的全新客户只扣 1 分钱（不打负），
   *  不碰任何种子演示客户的余额。 */
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

  /** 一个全新客户（非种子数据，raw `customerMain.create`）没有任何 TigerBeetle 账户——
   *  TB 账户全仓唯一的建户口是 `prisma/seed-tb.helper.ts`（业务 seed 跑一次性建好
   *  Bob/Carol 等种子客户的），生产代码里再没有第二处"客户级账户缺失就自动建"的
   *  兜底（`AccountingService.resolveTbAccountId` 找不到直接 404，`executeDepositAccounting`
   *  的 STEP_1 会原样把这个 404 炸出来）——Step 6(b) 想用一个全新客户就必须自己开户，
   *  用的是与 seed 脚本同一个真实入口 `AccountingService.createAccounts`（建 TB 账户 +
   *  登记 registry 两步一次做完），不是新发明的路子。法币充值只会摸到 CLIENT_PAYABLE
   *  （100）与 DEPOSIT_SUSPENSE（101）这两个客户级科目；AED / USDT 两个账簿各开一对，共四个。
   */
  // 注册表账户号补零已在 AccountingService.createAccounts 写侧根治（平账二期 Task 1），夹具不再规避。
  async function provisionCustomerTbAccounts(customerId: string, customerNo: string): Promise<void> {
    // AED + USDT 两个账簿都开：合并 main（V3 波一）后每个破口场景各配一个独立客户
    // （见 breakCase / createIsolatedCustomer 的注释），其中 ①a 走的是**链上 USDT**
    // 那条路。只开 AED 时，USDT 充值在 executeDepositAccounting 的 STEP_1 直接炸
    // `No TB account found for code=101 ledger=2 ownerType=CUSTOMER`，充值单卡在
    // PAYIN_PENDING 永远到不了 COMPLIANCE_PENDING（此前这条路借的是种子客户 Bob，
    // 两个账簿都是 seed 建好的，所以没暴露）。种子客户天生两簿齐全，这里对齐同一形状。
    await accounting.createAccounts([
      { code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger: TB_LEDGERS.AED, ownerType: 'CUSTOMER', ownerUuid: customerId, ownerNo: customerNo, assetCurrency: 'AED', description: 'e2e fixture customer CLIENT_PAYABLE' },
      { code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger: TB_LEDGERS.AED, ownerType: 'CUSTOMER', ownerUuid: customerId, ownerNo: customerNo, assetCurrency: 'AED', description: 'e2e fixture customer DEPOSIT_SUSPENSE' },
      { code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger: TB_LEDGERS.USDT, ownerType: 'CUSTOMER', ownerUuid: customerId, ownerNo: customerNo, assetCurrency: 'USDT', description: 'e2e fixture customer CLIENT_PAYABLE (USDT)' },
      { code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger: TB_LEDGERS.USDT, ownerType: 'CUSTOMER', ownerUuid: customerId, ownerNo: customerNo, assetCurrency: 'USDT', description: 'e2e fixture customer DEPOSIT_SUSPENSE (USDT)' },
    ]);
  }

  // ── scenarios ────────────────────────────────────────────────────────────

  it('①a 链上补录：案子 → 定性漏记入金 → 发起（来源地址）→ CFO 批 → 信号进通道 → 充值单 SUCCESS（STEP_1 流水 effectiveDate=业务日、externalRef=行参考号）→ 重跑愈', async () => {
    const txHash = `0xe2esupp${randomUUID().replace(/-/g, '')}`;
    // 150（不是 brief 原文的 61）：USDT 的 DEPOSIT SINGLE_LIMIT 下限是 100（种子
    // transaction_limit_rules 实测值），61 会在 detected() 建单时就带上
    // limitHoldReason=BELOW_MIN，KYT 批准后 applyKytApproved 的 assertTradingReadyOrHold
    // 直接 no-op 掉、永远到不了 SUCCESS——e2e 首次真实数据跑通时当场复现（brief 那个
    // 数字只在 mock 下测过，没有下限门这回事）。
    const { wallet, line, kase } = await breakCase({ assetId: usdtAssetId, currency: usdtCode, decimals: usdtDecimals, direction: 'IN', amountMinor: 150_000_000n, externalRef: txHash, tag: 'A1' });
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
    const { wallet, line, kase } = await breakCase({ assetId: aedAssetId, currency: 'AED', decimals: aedDecimals, direction: 'IN', amountMinor: 120_000n, externalRef: ref, tag: 'B1' });
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
    // 用本文件专属的全新客户，不用 Bob（Task 12 验收轮收口）——self 栈跑过
    // demo:all 后，Bob 的 AED 可用余额会被花名册第 18 条那笔 25 万 AED 待审批
    // 提现（PENDING_APPROVAL，TigerBeetle pending 未过账）锁成负数，导致这里退汇
    // 1200 AED 时 initiateClawback 的余额闸误判「不足」——这是环境耦合，与本测试
    // 要验证的记账逻辑无关（Task 12 报告根因链路）。同 Step 6(b) 的道理，全新客户
    // 开户/登记地址的必要性见 provisionCustomerTbAccounts/ensureWithdrawalAddress
    // 的 JSDoc。
    const custClawNo = `CU-E2E-SUPP-${randomUUID().slice(0, 8)}`;
    const custClaw = await (prisma as any).customerMain.create({
      data: { customerNo: custClawNo, lifecycle: 'ACTIVE' },
      select: { id: true, customerNo: true },
    });
    await provisionCustomerTbAccounts(custClaw.id, custClaw.customerNo);
    const custClawIban = `AE-E2E-SUPP-CLAWADDR-${custClaw.customerNo}`;
    await ensureWithdrawalAddress({
      customerId: custClaw.id, customerNo: custClaw.customerNo,
      addressType: 'BANK', network: aedNetwork, address: custClawIban, iban: custClawIban,
    });

    const { deposit, wallet } = await makeSuccessfulFiatDeposit('1200', custClaw.id, custClaw.customerNo);
    const ref = `E2E-CLAW-${randomUUID()}`;
    const line = await createExternalLine({ walletId: wallet.id, currency: 'AED', book: 'CLIENT', direction: 'OUT', amount: 120_000n, externalRef: ref, description: 'Return' });
    await upsertExternalBalance({ walletId: wallet.id, currency: 'AED', book: 'CLIENT', closingBalance: 0n }); // 外部：1200 进又 1200 出
    expect((await walletRecon.run({ cutoff: CUTOFF })).status).toBe('BREAK');
    const kase = await openCaseFor(wallet.id);
    const disp = await dispositions.record(kase.caseNo, { explainedExternalLineId: line.id, matchType: 'ORPHAN_EXTERNAL', causeCode: 'BOUNCED_FUNDS', externalDirection: 'OUT', findingNote: '银行撤回' } as any, ops());
    const cands = await supplementEvidence.listCandidates(kase.caseNo, line.id);
    expect(cands.kind).toBe('SUPPLEMENT_BOUNCE'); expect(cands.candidates.map((c) => c.orderNo)).toContain(deposit.depositNo);

    const before = (await accounting.getCustomerAvailableBalance(custClaw.id, 'AED')).available;
    const req = await depositWf.initiateClawback(deposit.depositNo, { externalLineId: line.id, caseNo: kase.caseNo, dispositionNo: disp.dispositionNo, reason: '银行撤回' }, ops());
    await approvalsService.approve(req.approvalNo, { reason: 'e2e CFO approve clawback' }, cfo());
    await waitUntil(async () => (await deposits.findOne(deposit.id)).status === 'CLAWED_BACK', 30000);
    const ev = (await tbEvidence.findBySource('DEPOSIT', deposit.depositNo)).find((e: any) => e.eventCode === 'DEPOSIT_CLAWBACK');
    expect(ev.debitCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE]); expect(ev.creditCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET]);
    expect(ev.externalRef).toBe(ref); expect(ev.effectiveDate).toBe(kase.businessDate);
    expect((await accounting.getCustomerAvailableBalance(custClaw.id, 'AED')).available).toBe(before - 120_000n);
    await walletRecon.run({ cutoff: CUTOFF });
    expect((await (prisma as any).reconciliationCase.findUnique({ where: { id: kase.id } })).status).toBe('RESOLVED');
    expect(await auditSince('DEPOSIT_CLAWED_BACK', deposit.depositNo)).toHaveLength(1);
  });

  it('③ 退回：SUCCESS 提现 → 银行退回 → 定性 → 发起 → CFO 批 → RETURNED，借资产贷应付，余额加、手续费不退 → 重跑愈', async () => {
    // ③ 用本文件专属的独立客户（不用 Bob）——理由见 makeSuccessfulFiatWithdraw 的注释：
    // 收盘算术要求这只钱包的外部历史只有本场景造的那几笔。
    const custRet = await createIsolatedCustomer('RET');
    const custRetIban = `AE-E2E-SUPP-WDADDR-${custRet.customerNo}`;
    // 先给这个全新客户真造一笔入金铺底再提现：手续费不退意味着走完全程后客户应付
    // 净减 feeMinor，零余额起步会把 L.CLIENT_PAYABLE 记成负数，收尾闸 ⑦ verify:coa
    // 的「负余额」判据当场报红（此前借的是 Bob 的 demo:all 余额，负不下去所以没暴露）。
    // 用与 ② 同一条真实入金通道铺底，不是夹具直接改数。
    const seedAmount = '1200';
    const seedMinor = decimalToBigint(seedAmount, aedDecimals);
    await makeSuccessfulFiatDeposit(seedAmount, custRet.id, custRet.customerNo);
    const w = await makeSuccessfulFiatWithdraw('900', custRet, custRetIban);
    expect(w.status).toBe('SUCCESS');
    const netMinor = decimalToBigint(String(w.netAmount), aedDecimals);
    const ref = `E2E-PAYRET-${randomUUID()}`;
    const line = await createExternalLine({ walletId: w.fromWalletId, currency: 'AED', book: 'CLIENT', direction: 'IN', amount: netMinor, externalRef: ref, description: 'Payout returned' });
    // 收盘设 seedMinor - feeMinor（不是 0，也不再是 -feeMinor）：这只钱包外部层面的
    // 真实历史是「进 seedMinor（铺底入金镜像）、出 netMinor+feeMinor（提现两条腿镜像）、
    // 回 netMinor（本场景的退回行）」——净变化 = seedMinor - feeMinor（手续费不退，
    // 钱确实少了这一点，且退回处置本身也不碰费腿）。此刻内部是铺底 +seedMinor 加上
    // SUCCESS 提现已经记走的 -netMinor-feeMinor（两条腿都已 POST），
    // delta = (seedMinor-feeMinor) − (seedMinor-netMinor-feeMinor) = netMinor ≠ 0，
    // 仍是待发现的差异；认领处置落账（+netMinor）后内部归到 seedMinor-feeMinor，
    // 才跟这个不变的收盘对上。
    const feeMinor = decimalToBigint(String(w.feeAmount), aedDecimals);
    await upsertExternalBalance({ walletId: w.fromWalletId, currency: 'AED', book: 'CLIENT', closingBalance: seedMinor - feeMinor });
    expect((await walletRecon.run({ cutoff: CUTOFF })).status).toBe('BREAK');
    const kase = await openCaseFor(w.fromWalletId);
    const disp = await dispositions.record(kase.caseNo, { explainedExternalLineId: line.id, matchType: 'ORPHAN_EXTERNAL', causeCode: 'PAYOUT_RETURNED', externalDirection: 'IN', findingNote: '银行退回提现' } as any, ops());
    expect(disp.outlet).toBe('SUPPLEMENT'); expect(disp.deferredTarget).toBe('SUPPLEMENT_PAYOUT_RETURN');

    const feeEvidenceBefore = (await tbEvidence.findBySource('WITHDRAWAL', w.withdrawNo)).filter((e: any) => String(e.eventCode).includes('FEE'));
    const before = (await accounting.getCustomerAvailableBalance(custRet.id, 'AED')).available;
    const req = await withdrawWf.initiateReturnClaim(w.withdrawNo, { externalLineId: line.id, caseNo: kase.caseNo, dispositionNo: disp.dispositionNo, reason: '银行退回' }, ops());
    await approvalsService.approve(req.approvalNo, { reason: 'e2e CFO approve return-claim' }, cfo());
    await waitUntil(async () => (await withdraws.findByNo(w.withdrawNo)).status === 'RETURNED', 30000);

    const ev = (await tbEvidence.findBySource('WITHDRAWAL', w.withdrawNo)).find((e: any) => e.eventCode === 'WITHDRAW_BOUNCE_REENTRY');
    expect(ev.debitCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET]); expect(ev.creditCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE]);
    expect(ev.externalRef).toBe(ref); expect(ev.effectiveDate).toBe(kase.businessDate);
    expect((await accounting.getCustomerAvailableBalance(custRet.id, 'AED')).available).toBe(before + netMinor);
    const feeEvidenceAfter = (await tbEvidence.findBySource('WITHDRAWAL', w.withdrawNo)).filter((e: any) => String(e.eventCode).includes('FEE'));
    expect(feeEvidenceAfter.length).toBe(feeEvidenceBefore.length); // 手续费不退：净额腿之外没有新的费腿证据
    await walletRecon.run({ cutoff: CUTOFF });
    expect((await (prisma as any).reconciliationCase.findUnique({ where: { id: kase.id } })).status).toBe('RESOLVED');
    expect(await auditSince('WITHDRAW_RETURNED_AFTER_SUCCESS', w.withdrawNo)).toHaveLength(1);
  });

  it('拒绝路径：方向不符 400；余额不足 400；同一行仍待决时二次发起 400，CFO 拒绝后可再发起（复用同一信号）；② 拒绝后原状态不动、supplementNo 清空、可再发起', async () => {
    // (a) 方向不符：外部 OUT 行定性 MISSED_DEPOSIT（要求 IN）→ dispositions.record 抛 /方向不符/
    const txHashA = `0xe2esuppdiramis${randomUUID().replace(/-/g, '')}`;
    const { line: lineA, kase: kaseA } = await breakCase({ assetId: usdtAssetId, currency: usdtCode, decimals: usdtDecimals, direction: 'OUT', amountMinor: 2_000_000n, externalRef: txHashA, tag: 'RJA' });
    await expect(dispositions.record(kaseA.caseNo, { explainedExternalLineId: lineA.id, matchType: 'ORPHAN_EXTERNAL', causeCode: 'MISSED_DEPOSIT', externalDirection: 'OUT', findingNote: 'e2e 方向不符测试' } as any, ops())).rejects.toThrow(/direction do not match/);

    // (b) 余额不足：用一个本文件专属的全新客户（lifecycle=ACTIVE、零历史），不碰 Bob 或
    // 任何种子客户的累计余额——也因此跟 (a)(c)(d) 完全独立，谁先跑都行，`-t` 单跑
    // 这一段也复现得出来。充值 1200 后只扣 1 分钱（debitCustomerBalance 是夹具级
    // 直接记账，见其 JSDoc），让可用余额刚好比这笔要退汇的金额少 1 分——不需要、
    // 也不应该把任何人的余额打到负数（这个 self 库同一时间还要过闸门⑥ demo:all，
    // 判据对照 demo/baseline.md，种子演示客户的余额不该被本文件的反例测试污染）。
    // 一个全新客户还差两样种子客户天生就有的东西：TB 账户（provisionCustomerTbAccounts，
    // 理由见其 JSDoc）与已登记的法币提现地址——DepositWorkflowService#applyKytApproved
    // 的 assertTradingReadyOrHold 会因为查不到就把充值原地挂起（NOT_TRADING_READY，
    // 状态停在 COMPLIANCE_PENDING 不再往前），e2e 用真实全新客户跑通时当场复现。
    const tmpCustomer = await (prisma as any).customerMain.create({
      data: { customerNo: `CU-E2E-SUPP-${randomUUID().slice(0, 8)}`, lifecycle: 'ACTIVE' },
      select: { id: true, customerNo: true },
    });
    await provisionCustomerTbAccounts(tmpCustomer.id, tmpCustomer.customerNo);
    const tmpIban = `AE-E2E-SUPP-TMPADDR-${tmpCustomer.customerNo}`;
    await ensureWithdrawalAddress({
      customerId: tmpCustomer.id, customerNo: tmpCustomer.customerNo,
      addressType: 'BANK', network: aedNetwork, address: tmpIban, iban: tmpIban,
    });
    const { deposit: depB, wallet: walletB } = await makeSuccessfulFiatDeposit('1200', tmpCustomer.id, tmpCustomer.customerNo);
    await debitCustomerBalance(tmpCustomer.id, 1n);
    const refB = `E2E-CLAW-INSUFF-${randomUUID()}`;
    const lineB = await createExternalLine({ walletId: walletB.id, currency: 'AED', book: 'CLIENT', direction: 'OUT', amount: 120_000n, externalRef: refB, description: 'Return' });
    await upsertExternalBalance({ walletId: walletB.id, currency: 'AED', book: 'CLIENT', closingBalance: 0n });
    await walletRecon.run({ cutoff: CUTOFF });
    const kaseB = await openCaseFor(walletB.id);
    const dispB = await dispositions.record(kaseB.caseNo, { explainedExternalLineId: lineB.id, matchType: 'ORPHAN_EXTERNAL', causeCode: 'BOUNCED_FUNDS', externalDirection: 'OUT', findingNote: 'e2e 余额不足测试' } as any, ops());
    await expect(depositWf.initiateClawback(depB.depositNo, { externalLineId: lineB.id, caseNo: kaseB.caseNo, dispositionNo: dispB.dispositionNo, reason: 'e2e 余额不足' }, ops())).rejects.toThrow(/insufficient/);

    // (c) 二次发起：仍待决时二次发起 → 400——第一次发起时 linkSupplement 已经把
    // disposition.supplementNo 同步挂上了（不等 CFO 裁决），所以第二次撞的是
    // assertClaimable 更早那道「已转补单」自守卫（同一条定性只认一张在途的补单，
    // DispositionService.record 的锚点去重决定了同一行只有这一条定性行，走不到
    // assertUnclaimed 那句「已被补录」——那句留给下面「已拒绝」的场景）。CFO 拒绝
    // 后，spec §2.2 / §9-5 明写「拒绝/超时/撤回后原状态不动、supplementNo 清空、
    // 可再次发起」，①②③ 三路口径一致——同一行应当能再次发起，复用同一条信号回到
    // SUPPLEMENT_PENDING、拿到新 approvalNo、定性 supplementNo 重新挂上。
    // inboundTransferSignal.supplementOfExternalLineId 是 @unique 且从不清空，
    // "能不能复用"全靠 InboundTransferSignalsService.initiateSupplement 主动查
    // "已存在且是 SUPPLEMENT_REJECTED 就复用"——这条分支原来没有，账单行会被那笔
    // 已拒绝的信号永久占用（此时 disposition.supplementNo 已被拒绝流程清空，第二次
    // 发起才终于走到 assertUnclaimed，撞的正是它的「已被补录」），本文件写作过程中
    // 用真实数据跑通时当场复现（②③ 的等价场景本来就对，靠 clearClawbackRequest
    // 一类方法把各自的占用列清空；①的占用列是 @unique 不能清空，只能靠复用，是这
    // 条路独有的修法）。已按此改了 src（inbound-transfer-signals.service.ts 的
    // initiateSupplement + supplement-evidence.service.ts 的 assertUnclaimed），
    // 下面断言改成断言 spec 的行为，不再断言"永久占用"。
    const txHashC = `0xe2esuppdup${randomUUID().replace(/-/g, '')}`;
    const { line: lineC, kase: kaseC } = await breakCase({ assetId: usdtAssetId, currency: usdtCode, decimals: usdtDecimals, direction: 'IN', amountMinor: 3_000_000n, externalRef: txHashC, tag: 'RJC' });
    const dispC = await dispositions.record(kaseC.caseNo, { explainedExternalLineId: lineC.id, matchType: 'ORPHAN_EXTERNAL', causeCode: 'MISSED_DEPOSIT', externalDirection: 'IN', findingNote: 'e2e 二次发起测试' } as any, ops());
    const reqC = await signals.initiateSupplement({ externalLineId: lineC.id, caseNo: kaseC.caseNo, dispositionNo: dispC.dispositionNo, fromAddress: 'TE2eSupplementDup', reason: 'e2e first attempt' }, ops());
    await expect(signals.initiateSupplement({ externalLineId: lineC.id, caseNo: kaseC.caseNo, dispositionNo: dispC.dispositionNo, fromAddress: 'TE2eSupplementWhilePending', reason: 'e2e while first still pending' }, ops())).rejects.toThrow(/already linked to supplement/);
    await approvalsService.reject(reqC.approvalNo, { reason: 'e2e CFO reject supplement' }, cfo());
    await waitUntil(async () => (await (prisma as any).inboundTransferSignal.findUnique({ where: { signalNo: reqC.signalNo } })).status === 'SUPPLEMENT_REJECTED', 30000);
    expect((await (prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo: dispC.dispositionNo } })).supplementNo).toBeNull();
    const reqC2 = await signals.initiateSupplement({ externalLineId: lineC.id, caseNo: kaseC.caseNo, dispositionNo: dispC.dispositionNo, fromAddress: 'TE2eSupplementRetry', reason: 'e2e retry after reject' }, ops());
    expect(reqC2.signalNo).toBe(reqC.signalNo); // 复用同一条信号，不是新建
    expect(reqC2.approvalNo).not.toBe(reqC.approvalNo);
    const sigC2 = await (prisma as any).inboundTransferSignal.findUnique({ where: { signalNo: reqC2.signalNo } });
    expect(sigC2.status).toBe('SUPPLEMENT_PENDING');
    expect(sigC2.fromAddress).toBe('TE2eSupplementRetry');
    expect((await (prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo: dispC.dispositionNo } })).supplementNo).toBe(reqC2.signalNo);

    // (d) 拒绝：新造 ② 场景，initiateClawback 后 CFO 拒绝，原状态不动、占用清空、可再发起拿新 approvalNo。
    // 同样改用本文件专属的全新客户，不用 Bob（Task 12 验收轮收口，理由同 ② 开头
    // 的注释——demo:all 花名册第 18 条会把 Bob 的 AED 可用余额锁成负数，跟这里
    // initiateClawback 想测的「拒绝后可再发起」逻辑无关）。
    const custDNo = `CU-E2E-SUPP-${randomUUID().slice(0, 8)}`;
    const custD = await (prisma as any).customerMain.create({
      data: { customerNo: custDNo, lifecycle: 'ACTIVE' },
      select: { id: true, customerNo: true },
    });
    await provisionCustomerTbAccounts(custD.id, custD.customerNo);
    const custDIban = `AE-E2E-SUPP-REJADDR-${custD.customerNo}`;
    await ensureWithdrawalAddress({
      customerId: custD.id, customerNo: custD.customerNo,
      addressType: 'BANK', network: aedNetwork, address: custDIban, iban: custDIban,
    });
    const { deposit: depD, wallet: walletD } = await makeSuccessfulFiatDeposit('300', custD.id, custD.customerNo);
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
  });
});
