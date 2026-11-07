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
import { ApprovalActionTypes, ApprovalActorContext } from '../src/modules/governance/approvals/constants/approval.constants';
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
import { BadRequestException } from '@nestjs/common';
import { AdjustmentService } from '../src/modules/clearing-settle/reconciliation/disposition/adjustment.service';
import { ReconciliationCaseService } from '../src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service';
import { CaseAgingSweepService } from '../src/modules/clearing-settle/reconciliation/sweep/case-aging-sweep.service';
import { ReconciliationQueryService } from '../src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service';
import { FlowComparisonBuilder } from '../src/modules/clearing-settle/reconciliation/domain/flow-comparison.builder';
import { InternalTransferWorkflowService } from '../src/modules/asset-treasury/internal-transfers/internal-transfer-workflow.service';
import { CLIENT_SHORTFALL_CAUSE } from '../src/modules/clearing-settle/reconciliation/disposition/cause-registry';
import { FundsOrderAction } from '../src/modules/funds-orders/dto/funds-order.dto';
import { toBusinessDate } from '../src/modules/accounting/tigerbeetle/utils/business-date.util';
import { bigintToHex } from '../src/modules/accounting/tigerbeetle/utils/tb-id.util';

/**
 * 平账二期（spec §14）e2e，戊波二 T7b 改写：认损补缺一张单（账龄路：加密币一腿 / 法币两腿经结算户，出钱钱包人选）｜ 垫款 → 认领（法币两腿经结算户）｜
 * 拒绝 / 撤回 / 腿失败 / 挂起锁定路径。认损补缺 = 开单即挂锁 → CFO 批 = 记短缺（码 91，应付不动）→ 腿 → 82 + 83（83 贷码 2 短缺户）；
 * 旧的「认损调账单 + 补款划转单」两张单已退役。案子愈合靠匹配器第 0 轮锚配对（戊波二 T9b）：A 在批准（91 落账）后按案件业务日重对账 → 案愈、
 * 原差异行 MATCHED 且 resolution = 本单号；腿到账后那条 83 流水按参考号（Pass 1）配上模拟托管方回单。
 * 真 AppModule 零 mock；每条主链一个独立客户（承接记录点名）；与另外四份 recon e2e 串行。
 *
 * ⚠ 截止时刻用「现在」而不是 +3 天：模拟托管方回单把镜像行与当日余额都记在**当天**（toBusinessDate(now)），
 *   跑批若用 +3 天的截止就读不到那份余额——所以本文件所有 run 都是 runNow()，余额夹具默认 cutoffDate = TODAY。
 *   代价是本文件不能跨 UTC 零点跑（照实讲，与 baseline 的「种子在 UTC 18:00 前铺」同类约束）。
 * ⚠ 运营户（F_OPS）钱包的桶不断言：它带着 demo:setup / 别的套件的其它穿越流水、没有外部镜像，
 *   本来就不干净；主链只断言客户钱包的案子。
 */
describe('Recon internal transfer e2e (平账二期, Task 9)', () => {
  jest.setTimeout(120000);
  let app: INestApplication; let prisma: PrismaService;
  let dispositions: DispositionService; let adjustments: AdjustmentService; let caseService: ReconciliationCaseService; let agingSweep: CaseAgingSweepService;
  let reconQuery: ReconciliationQueryService; let flowBuilder: FlowComparisonBuilder; let walletRecon: WalletReconRunService; let approvalsService: ApprovalsService;
  let transferWf: InternalTransferWorkflowService; let fundsOrders: FundsOrderService; let tbEvidence: TbEvidenceService; let accounting: AccountingService;
  let signals: InboundTransferSignalsService; let depositWf: DepositWorkflowService; let deposits: DepositTransactionsService;
  let withdrawWf: WithdrawWorkflowService; let withdraws: WithdrawTransactionsService; let withdrawQuoteService: WithdrawQuoteService;
  let depositWallets: CustomerDepositWalletService;
  let aedAssetId: string; let aedCode: string; let aedDecimals: number; let aedNetwork: string;
  let usdtAssetId: string; let usdtCode: string; let usdtDecimals: number; let usdtNetwork: string;
  let TODAY: string; let testStartedAt: Date;
  const ops = () => makeActor('E2E_OPS', 'OPS_OFFICER');
  const cfo = () => makeActor('E2E_CFO', 'CFO');
  const treasury = () => makeActor('E2E_TREASURY', 'TREASURY_OFFICER');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(0);
    await app.init();
    prisma = app.get(PrismaService);
    dispositions = app.get(DispositionService); adjustments = app.get(AdjustmentService);
    caseService = app.get(ReconciliationCaseService); agingSweep = app.get(CaseAgingSweepService);
    reconQuery = app.get(ReconciliationQueryService); flowBuilder = app.get(FlowComparisonBuilder); walletRecon = app.get(WalletReconRunService); approvalsService = app.get(ApprovalsService);
    transferWf = app.get(InternalTransferWorkflowService); fundsOrders = app.get(FundsOrderService);
    tbEvidence = app.get(TbEvidenceService); accounting = app.get(AccountingService);
    signals = app.get(InboundTransferSignalsService); depositWf = app.get(DepositWorkflowService); deposits = app.get(DepositTransactionsService);
    withdrawWf = app.get(WithdrawWorkflowService); withdraws = app.get(WithdrawTransactionsService); withdrawQuoteService = app.get(WithdrawQuoteService);
    depositWallets = app.get(CustomerDepositWalletService);
    TODAY = toBusinessDate(new Date()); testStartedAt = new Date();
    const aed = await (prisma as any).asset.findFirst({ where: { currency: 'AED' } });
    const usdt = await (prisma as any).asset.findFirst({ where: { currency: 'USDT' } });
    if (!aed?.tbLedgerId || !usdt?.tbLedgerId) throw new Error('Fixture assets AED/USDT not seeded — run `bash scripts/stack.sh reset self` first.');
    aedAssetId = aed.id; aedCode = aed.code; aedDecimals = aed.decimals; aedNetwork = aed.network;
    usdtAssetId = usdt.id; usdtCode = usdt.code; usdtDecimals = usdt.decimals; usdtNetwork = usdt.network;
  });
  afterAll(async () => { if (app) await app.close(); });

  // ── helpers（makeActor / waitUntil / ensureDepositWallet / createIsolatedCustomer /
  //     provisionCustomerTbAccounts / ensureWithdrawalAddress / fundCustomerWallet /
  //     decimalToBigint / driveLegTransition / VERDICT_BY_WEBHOOK_TYPE+verdictArgs* /
  //     makeSuccessfulFiatDeposit / makeSuccessfulFiatWithdraw 逐字复制自
  //     test/recon-supplement.e2e-spec.ts，dedupKey/客户号/地址号前缀 E2E-SUPP 改
  //     E2E-ITR；createExternalLine / upsertExternalBalance / openCaseFor / auditSince /
  //     breakCase / debitCustomerBalance 未抄——本文件在下面自己的 helpers 段落里另有
  //     一套签名更宽的版本，或本文件用不上） ─────────────────────────────────────
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
      data: { customerNo: `CU-E2E-ITR-${tag}-${randomUUID().slice(0, 8)}`, lifecycle: 'ACTIVE' },
      select: { id: true, customerNo: true },
    });
    await provisionCustomerTbAccounts(customer.id, customer.customerNo);
    const iban = `AE-E2E-ITR-WDADDR-${customer.customerNo}`;
    await ensureWithdrawalAddress({
      customerId: customer.id, customerNo: customer.customerNo,
      addressType: 'BANK', network: aedNetwork, address: iban, iban,
    });
    return customer;
  }

  /** Real production evidence shape — mirrors deposit-workflow.service.ts's own
   *  Step 1 (DR 客户现金·落地钱包 / CR 暂扣) + Step 2 (DR 暂扣 / CR 应付, pure reclass) exactly.
   *  戊波一:现金类账户一钱包一户——Step 1 的借方是这只钱包自己的现金户(A.CLIENT_CASH),
   *  只经 AccountingService.resolveCashAccountId 取,不再有按币种聚合的客户现金户。
   *  钱包由调用方经 createOrReturn(= 开地址流程,已开好现金户)取得。 */
  async function fundCustomerWallet(opts: {
    walletId: string; ownerId: string; assetId: string; ledger: number; currency: string; amount: bigint; tag: string;
    externalRef?: string; effectiveDate?: string;
  }): Promise<string> {
    const sourceNo = `E2E-ITR-FUND-${opts.tag}-${randomUUID().slice(0, 8)}`;

    const walletCashId = await accounting.resolveCashAccountId(opts.walletId, opts.ledger);
    const suspenseId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger: opts.ledger, ownerType: 'CUSTOMER', ownerUuid: opts.ownerId });
    const payableId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger: opts.ledger, ownerType: 'CUSTOMER', ownerUuid: opts.ownerId });

    await accounting.executeTransfer({
      debitAccountId: walletCashId, creditAccountId: suspenseId, amount: opts.amount, ledger: opts.ledger,
      code: TB_TRANSFER_CODES.DEPOSIT_ASSET_TO_SUSPENSE,
      evidence: {
        sourceType: 'DEPOSIT', sourceNo, eventCode: 'DEPOSIT_ASSET_TO_SUSPENSE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_CASH], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
        assetCurrency: opts.currency, traceId: sourceNo, actorType: 'SYSTEM', actorId: 'E2E_HARNESS',
        memo: 'e2e fixture: pre-fund customer balance for recon-supplement tests (Step 1)',
        externalRef: opts.externalRef ?? null,
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
        ...(opts.effectiveDate ? { effectiveDate: opts.effectiveDate } : {}),
      },
    });

    return sourceNo;
  }

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
        addressNo: `WAD-E2E-ITR-${opts.addressType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
   *  Step 1 那条进钱的内部流水在后续对账里找不到对应外部行，
   *  永远是一条「我有外无」孤儿，桶判定卡在 COMPENSATING 而不是 MATCHED（哪怕总额
   *  已经用退汇/退回冲平），调用方最后一步「案子该愈」的断言会等不到 RESOLVED——
   *  e2e 首次真实数据跑通时当场复现（原版 recon-supplement.e2e-spec.ts 的注释
   *  点名了这一步）。⚠ 与源文件的一处偏差：源版 customerId/customerNo 默认落
   *  Bob（`= bobId, = bobNo`）——本文件没有共享花名册客户，beforeAll 不解析
   *  Bob，两个参数改成必填（本文件所有调用点都显式传参，从未依赖过默认值）。 */
  async function makeSuccessfulFiatDeposit(amount: string, customerId: string, customerNo: string): Promise<{ deposit: any; wallet: { id: string } }> {
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
   *  evidence 都是 withdraw-money-arcs 既有的记账形状，本文件不改）——同 makeSuccessfulFiatDeposit 的道理，不补的话这两条
   *  内部流水各是一条「我有外无」孤儿，桶判定卡在 COMPENSATING。TigerBeetle 在本系统
   *  没启用不可透支约束（C2，见 doc-final/PRODUCTION-NOTES.md），createWithdrawal
   *  本身不需要余额铺底就能成功——不为它单独铺底。 */
  async function makeSuccessfulFiatWithdraw(amount: string, customer: { id: string; customerNo: string }, toIban: string): Promise<any> {
    // 改成收一个**独立客户**（合并 main / V3 波一 T5）：新模型下一客户一网络只有一行
    // 收款地址，Bob 的那一行是 demo:all 花名册 35 笔反复用过的公共钱包，外部收盘上挂满
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

  // ── helpers（本文件新增，brief 未从别处抄的部分） ──────────────────────

  /** 本文件所有跑批都用「现在」当截止（见文件头 ⚠）。 */
  const runNow = () => walletRecon.run({ cutoff: new Date() });

  async function createExternalLine(opts: { walletId: string; currency: string; book: 'CLIENT' | 'FIRM'; direction: 'IN' | 'OUT'; amount: bigint; externalRef: string; description?: string; source?: 'ZAND' | 'HEXTRUST' }): Promise<{ id: string }> {
    return (prisma as any).externalStatementLine.create({
      data: { source: opts.source ?? 'ZAND', accountRef: opts.walletId, subAccount: opts.walletId, book: opts.book, currency: opts.currency, direction: opts.direction, amount: opts.amount.toString(), externalRef: opts.externalRef, datetime: new Date(), description: opts.description ?? 'Incoming', dedupKey: `E2E-ITR-${randomUUID()}` },
      select: { id: true },
    });
  }
  async function upsertExternalBalance(opts: { walletId: string; currency: string; book: 'CLIENT' | 'FIRM'; closingBalance: bigint; source?: 'ZAND' | 'HEXTRUST' }): Promise<void> {
    const source = opts.source ?? 'ZAND';
    await (prisma as any).externalBalance.upsert({
      where: { source_accountRef_cutoffDate: { source, accountRef: opts.walletId, cutoffDate: TODAY } },
      create: { source, accountRef: opts.walletId, currency: opts.currency, book: opts.book, cutoffDate: TODAY, closingBalance: opts.closingBalance.toString(), walletRef: opts.walletId },
      update: { closingBalance: opts.closingBalance.toString() },
    });
  }
  const openCaseFor = (walletId: string) => (prisma as any).reconciliationCase.findFirst({ where: { walletRef: walletId, status: 'OPEN' } });
  const caseRow = (id: string) => (prisma as any).reconciliationCase.findUnique({ where: { id } });
  const transferRow = (transferNo: string) => (prisma as any).internalTransfer.findUnique({ where: { transferNo } });
  const latestApprovalCase = (actionType: string, entityRef: string) => (prisma as any).approvalCase.findFirst({ where: { actionType, entityRef }, orderBy: { createdAt: 'desc' } });
  const auditSince = (action: string, subjectNo: string) => (prisma as any).auditLogEvent.findMany({ where: { action, primarySubjectNo: subjectNo, recordedAt: { gte: testStartedAt } } });
  /** 戊波一:凭证行的借 / 贷账户 id 是十六进制串;现金户只经 resolveCashAccountId 取。 */
  const cashHex = async (walletId: string, ledger: number) => bigintToHex(await accounting.resolveCashAccountId(walletId, ledger));
  const reconLossHex = async (ledger: number) => bigintToHex(await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.EXPENSE_RECON_LOSS, ledger, ownerType: 'SYSTEM' }));
  /** 现金户已落账净额(资产类:借增贷减)——断言「钱从哪只钱包出 / 进哪只钱包」。 */
  async function cashPosted(walletId: string, ledger: number): Promise<bigint> {
    const b = await accounting.lookupBalance(await accounting.resolveCashAccountId(walletId, ledger));
    return b.debitsPosted - b.creditsPosted;
  }
  /** 对账核销损失户(SYSTEM 301,开支类借方户)已落账净额。 */
  async function reconLossPosted(ledger: number): Promise<bigint> {
    const b = await accounting.lookupBalance(await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.EXPENSE_RECON_LOSS, ledger, ownerType: 'SYSTEM' }));
    return b.debitsPosted - b.creditsPosted;
  }
  type CompanyBooks = { cash: Record<string, bigint>; loss: bigint };
  /** 落账前先记下相关钱包现金户 + 对账核销损失户的余额,落账后按差额断言(库里已有 demo:setup 等别的套件的流水,不断言绝对值)。 */
  async function snapshotBooks(ledger: number, walletIds: string[]): Promise<CompanyBooks> {
    const cash: Record<string, bigint> = {};
    for (const id of walletIds) cash[id] = await cashPosted(id, ledger);
    return { cash, loss: await reconLossPosted(ledger) };
  }

  /** 认损补缺 / 垫款单落账后的账户与余额落点(戊波一·附录 B「内部转账」,戊波二加认损补缺的 91 / 83 形状)——**过账断言**,不依赖对账引擎。
   *  法币(两腿):81 借 现金·结算钱包 / 贷 现金·运营钱包;82 借 对账核销损失 / 贷 现金·结算钱包。
   *  加密币(一腿):82 借 对账核销损失 / 贷 现金·出钱钱包。83 借 现金·客户钱包 / 贷 应付·客户(垫款)或 码 2·同一只客户钱包(认损补缺,topup)。
   *  before 须在批准之后、腿之前取(认损补缺的 91 已把客户钱包现金户减掉缺口,83 把它补回)。 */
  async function expectTransferPostings(o: {
    transferNo: string; ledger: number; fiat: boolean; opsWalletId: string; setWalletId?: string; customerWalletId: string;
    customerId: string; clientInEvent: string; amountMinor: bigint; before: CompanyBooks;
    /** 认损补缺单（戊波二）：多一笔 91 记短缺；83 贷码 2·同一只客户钱包而不是应付。垫款单不传。opsWalletId = 出钱钱包（运营户或人选的手续费户）。 */
    topup?: boolean;
  }): Promise<void> {
    const tev = await tbEvidence.findBySource('INTERNAL_TRANSFER', o.transferNo);
    const byEvent = (code: string) => tev.find((e: any) => e.eventCode === code);
    const expectedEvents = [
      ...(o.fiat ? ['INTERNAL_TRANSFER_FIRM_OUT', o.clientInEvent, 'INTERNAL_TRANSFER_OPS_TO_SET'] : ['INTERNAL_TRANSFER_FIRM_OUT', o.clientInEvent]),
      ...(o.topup ? ['INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED'] : []),
    ];
    expect(tev.map((e: any) => e.eventCode).sort()).toEqual(expectedEvents.sort());
    const firmWalletId = o.fiat ? o.setWalletId! : o.opsWalletId;
    if (o.fiat) {
      const opsToSet = byEvent('INTERNAL_TRANSFER_OPS_TO_SET');
      expect([opsToSet.debitCode, opsToSet.creditCode]).toEqual(['A.FIRM_CASH', 'A.FIRM_CASH']);
      expect(opsToSet.debitTbAccountId).toBe(await cashHex(o.setWalletId!, o.ledger));
      expect(opsToSet.creditTbAccountId).toBe(await cashHex(o.opsWalletId, o.ledger));
    }
    const firmOut = byEvent('INTERNAL_TRANSFER_FIRM_OUT');
    expect([firmOut.debitCode, firmOut.creditCode]).toEqual(['X.EXPENSE_RECON_LOSS', 'A.FIRM_CASH']);
    expect(firmOut.debitTbAccountId).toBe(await reconLossHex(o.ledger));
    expect(firmOut.creditTbAccountId).toBe(await cashHex(firmWalletId, o.ledger));
    const clientIn = byEvent(o.clientInEvent);
    expect(clientIn.debitTbAccountId).toBe(await cashHex(o.customerWalletId, o.ledger));
    if (o.topup) {
      // 认损补缺：83 贷这只客户钱包自己的码 2 短缺户(消掉批准时 91 借进去的那截)——不碰应付；91 与它对称
      expect([clientIn.debitCode, clientIn.creditCode]).toEqual(['A.CLIENT_CASH', 'A.CLIENT_SHORTFALL']);
      expect(clientIn.creditTbAccountId).toBe(await shortfallHex(o.customerWalletId, o.ledger));
      const recognized = byEvent('INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED');
      expect([recognized.debitCode, recognized.creditCode]).toEqual(['A.CLIENT_SHORTFALL', 'A.CLIENT_CASH']);
      expect(recognized.debitTbAccountId).toBe(await shortfallHex(o.customerWalletId, o.ledger));
      expect(recognized.creditTbAccountId).toBe(await cashHex(o.customerWalletId, o.ledger));
    } else {
      expect([clientIn.debitCode, clientIn.creditCode]).toEqual(['A.CLIENT_CASH', 'L.CLIENT_PAYABLE']);
      // 83 的贷方是这位客户自己的应付户(不是别的客户、也不是聚合户)
      expect(clientIn.creditTbAccountId).toBe(bigintToHex(await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger: o.ledger, ownerType: 'CUSTOMER', ownerUuid: o.customerId })));
    }
    // 余额落点:运营钱包现金少了本金;结算钱包(法币)81 进来 82 放出,净零;客户钱包现金多了本金;对账核销损失多了本金
    const wallets = Object.keys(o.before.cash);
    const after = await snapshotBooks(o.ledger, wallets);
    expect(after.cash[o.opsWalletId]).toBe(o.before.cash[o.opsWalletId] - o.amountMinor);
    if (o.fiat) expect(after.cash[o.setWalletId!]).toBe(o.before.cash[o.setWalletId!]);
    expect(after.cash[o.customerWalletId]).toBe(o.before.cash[o.customerWalletId] + o.amountMinor);
    expect(after.loss).toBe(o.before.loss + o.amountMinor);
  }

  const platformWallet = (vault: 'F_OPS' | 'F_SET' | 'F_FEE', network: string) => (prisma as any).wallet.findFirst({ where: { vaultCode: vault, network, ownerType: 'PLATFORM', status: 'ACTIVE' } });
  async function waitForSimLines(fundsOrderNo: string, walletIds: string[]): Promise<void> {
    await waitUntil(async () => (await (prisma as any).externalStatementLine.count({ where: { dedupKey: { in: walletIds.map((w) => `SIM-${fundsOrderNo}-${w}`) } } })) === walletIds.length);
  }
  const rowByLine = async (caseNo: string, externalLineId: string) => (await reconQuery.getCase(caseNo)).flowComparison.find((r: any) => r.externalLine?.id === externalLineId)!;
  const dispRow = (dispositionNo: string) => (prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo } });
  /** 码 2 托管短缺待补(借方户,一钱包一户)：已落账净额 = 借 − 贷。批准那一步(91)借进去,最后一腿(83)贷回来。 */
  const shortfallAccountId = (walletId: string, ledger: number) => accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_SHORTFALL, ledger, ownerType: 'WALLET', ownerUuid: walletId });
  const shortfallHex = async (walletId: string, ledger: number) => bigintToHex(await shortfallAccountId(walletId, ledger));
  async function shortfallPosted(walletId: string, ledger: number): Promise<bigint> {
    const b = await accounting.lookupBalance(await shortfallAccountId(walletId, ledger));
    return b.debitsPosted - b.creditsPosted;
  }
  /** 客户应付(码 100)可用余额——认损补缺全程「客户余额不动」就断言它。 */
  const payableAvailable = async (customerId: string, currency: string) => (await accounting.getCustomerAvailableBalance(customerId, currency)).available;
  /** 客户应付户的流水——客户端对账单的取数口(TbEvidenceService.getAccountStatement)。认损补缺不碰应付,所以这里一行都不该多。 */
  async function payableStatement(customerId: string, ledger: number) {
    const id = bigintToHex(await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger, ownerType: 'CUSTOMER', ownerUuid: customerId }));
    return (await tbEvidence.getAccountStatement(id)).items;
  }

  /** 公司钱包铺底——真实注资形状(附录 B「注资」：借 现金·公司钱包 / 贷 公司权益,码 70)。
   *  手续费户在 demo:setup 之后没有余额(费用收入要等真实提现才进),P2 要从它出钱,先注一笔。 */
  async function fundFirmWallet(opts: { walletId: string; ledger: number; currency: string; amount: bigint; tag: string }): Promise<void> {
    const sourceNo = `E2E-ITR-FIRMFUND-${opts.tag}-${randomUUID().slice(0, 8)}`;
    await accounting.executeTransfer({
      debitAccountId: await accounting.resolveCashAccountId(opts.walletId, opts.ledger),
      creditAccountId: await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FIRM_EQUITY, ledger: opts.ledger, ownerType: 'SYSTEM' }),
      amount: opts.amount, ledger: opts.ledger, code: TB_TRANSFER_CODES.CAPITAL_INJECTION,
      evidence: {
        sourceType: 'DEPOSIT', sourceNo, eventCode: 'E2E_FIRM_FIXTURE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_CASH], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_EQUITY],
        assetCurrency: opts.currency, traceId: sourceNo, actorType: 'SYSTEM', actorId: 'E2E_HARNESS',
        memo: 'e2e fixture: pre-fund firm wallet cash (capital-injection shape)', externalRef: null,
      },
    });
  }

  /** 真实出款入口造「在途出款」锁：客户自助 createWithdrawal（经真报价）——建单当场对这只钱包的现金户挂净额 + 手续费两笔待决贷方
   *  （码 10 / 13，同待批提现），KYT 还没判、单停在 COMPLIANCE_PENDING，锁一直挂着。amount = 净额 + 手续费 = 待决贷方总额。
   *  只用于 AED（createIsolatedCustomer 已登记法币提现地址）；提现不受协议闸拦（assertAgreementAccepted 对 WITHDRAW 放行）。 */
  async function createInFlightWithdrawal(cust: { id: string; customerNo: string }, amount: string): Promise<any> {
    const quote = await withdrawQuoteService.createQuote({
      ownerType: 'CUSTOMER', ownerId: cust.id, ownerNo: cust.customerNo, assetId: aedAssetId, assetCode: aedCode,
      amount: new Prisma.Decimal(amount), customerId: cust.id,
    });
    const w = await withdrawWf.createWithdrawal(
      { assetId: aedAssetId, amount: Number(amount), toIban: `AE-E2E-ITR-WDADDR-${cust.customerNo}`, quoteId: quote.id } as any,
      cust.id, 'CUSTOMER',
    );
    expect(w.status).toBe('COMPLIANCE_PENDING');
    return w;
  }

  /** 把一个独立客户的钱包推到「托管少了、查无果、案子超期」：认损补缺账龄路的起点（读面已给 SHORTFALL_TOPUP 钮）。
   *  A / C2 / C3 / P2 与两条挂起锁定用例共用（默认 USDT 链上钱包）；'AED' 走法币 vIBAN（缺口取在小额线 100.00 AED 以内，账龄路才开得了单）。
   *  铺底走真实充值两跳形状（fundCustomerWallet）；外部对账单故意少给一截，别的流水全配得上，案上唯一的差异就是这截短缺。
   *  戊波二起不再有「认损调账单」这一步——客户余额从头到尾是铺底原额，这里返回时案子还是 OPEN、差异行还在。 */
  async function driveClientShortfallToOverdue(tag: string, kind: 'USDT' | 'AED' = 'USDT') {
    const L = kind === 'USDT'
      ? { network: usdtNetwork, assetId: usdtAssetId, ledger: TB_LEDGERS.USDT, currency: 'USDT', code: usdtCode, source: 'HEXTRUST' as const, fund: 3_000_000_000n, external: 2_992_500_000n, loss: 7_500_000n, lossText: '7.5 USDT', refPrefix: '0xe2eloss' }
      : { network: aedNetwork, assetId: aedAssetId, ledger: TB_LEDGERS.AED, currency: 'AED', code: aedCode, source: 'ZAND' as const, fund: 300_000n, external: 291_000n, loss: 9_000n, lossText: '90.00 AED', refPrefix: 'E2E-LOSS-' };
    const cust = await createIsolatedCustomer(tag);
    const wallet = await ensureDepositWallet(cust.id, L.network);
    const REF = `${L.refPrefix}${tag}${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await fundCustomerWallet({ walletId: wallet.id, ownerId: cust.id, assetId: L.assetId, ledger: L.ledger, currency: L.currency, amount: L.fund, tag, externalRef: REF });
    await createExternalLine({ walletId: wallet.id, currency: L.code, book: 'CLIENT', direction: 'IN', amount: L.external, externalRef: REF, source: L.source });
    await upsertExternalBalance({ walletId: wallet.id, currency: L.code, book: 'CLIENT', closingBalance: L.external, source: L.source });
    expect((await runNow()).status).toBe('BREAK');
    const kase = await openCaseFor(wallet.id);
    expect(kase.book).toBe('CUSTOMER');
    const row0 = (await reconQuery.getCase(kase.caseNo)).flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!;
    const disp = await dispositions.record({
      caseNo: kase.caseNo,
      matchType: 'AMOUNT_MISMATCH', explainedFlowId: row0.internalFlow!.id, explainedExternalLineId: row0.externalLine!.id,
      causeCode: 'UNEXPLAINED', disposition: 'HOLD_INVESTIGATING', findingNote: `e2e：托管少 ${L.lossText}，翻遍凭证查无可查`, deltaSign: -1, internalDirection: 'IN', internalSourceType: 'DEPOSIT',
    } as any, ops());
    expect(disp.outlet).toBe('HOLD_INVESTIGATING');
    await caseService.simulateTimeout(kase.caseNo, ops());
    expect(await agingSweep.checkAgingBreaches(new Date())).toBeGreaterThanOrEqual(1);
    const row1 = await rowByLine(kase.caseNo, row0.externalLine!.id as string);
    expect(row1.nextStep).toEqual({ kind: 'SHORTFALL_TOPUP', amount: L.loss.toString(), effectiveDate: kase.businessDate, lossSource: 'AGING', customerNo: cust.customerNo, walletNo: wallet.walletNo });
    return { cust, wallet, kase, row0: row0 as any, disp, L };
  }

  /** 在差异行上开认损补缺单（金库）：锚用该行的两个真实证据 id（内部流水 + 对账单行）；金额 / 成因 / 生效日都由服务端定，开单人只选出钱钱包、写原因。 */
  const openTopup = (f: { kase: any; row0: any; fromWalletId: string; reason?: string }) => transferWf.initiateShortfallTopup({
    caseNo: f.kase.caseNo, flowId: f.row0.internalFlow?.id, externalLineId: f.row0.externalLine?.id, fromWalletId: f.fromWalletId, reason: f.reason ?? '公司认损补缺',
  }, treasury());

  // ── scenarios ────────────────────────────────────────────────────────────

  it('A · 账龄路全弧：开单即挂锁（撤回再发）→ CFO 批 = 记短缺（91：生效日 = 案件业务日、应付不动）→ ⚡ 提交腿 → ⚡ 确认（82 + 83 贷短缺户）→ SUCCESS、短缺归零、现金户复位、客户端对账单零行', async () => {
    const { cust, wallet, kase, row0, disp, L } = await driveClientShortfallToOverdue('A');
    const ledger = L.ledger;
    const opsW = await platformWallet('F_OPS', usdtNetwork);
    const stmtBefore = await payableStatement(cust.id, ledger);
    expect(await payableAvailable(cust.id, 'USDT')).toBe(L.fund);
    expect(await shortfallPosted(wallet.id, ledger)).toBe(0n);
    expect(await cashPosted(wallet.id, ledger)).toBe(L.fund);

    // 开单 → 处置记录挂 transferNo、差异行锁定（读面收起按钮、回链 PENDING_APPROVAL）；同行再开 400（换一个锚也一样）；零分录
    const first = await openTopup({ kase, row0, fromWalletId: opsW.id });
    expect(first.status).toBe('PENDING_APPROVAL');
    expect((await dispRow(disp.dispositionNo)).transferNo).toBe(first.transferNo);
    await expect(transferWf.initiateShortfallTopup({ caseNo: kase.caseNo, externalLineId: row0.externalLine.id, fromWalletId: opsW.id, reason: 'again' }, treasury())).rejects.toThrow(/already linked to shortfall top-up/);
    const lockedRow = await rowByLine(kase.caseNo, row0.externalLine.id);
    expect(lockedRow.transfer).toMatchObject({ transferNo: first.transferNo, purpose: 'SHORTFALL_TOPUP', status: 'PENDING_APPROVAL', recognized: false });
    expect(lockedRow.nextStep).toBeUndefined();
    expect(await tbEvidence.findBySource('INTERNAL_TRANSFER', first.transferNo)).toHaveLength(0);
    expect(await shortfallPosted(wallet.id, ledger)).toBe(0n);
    // 撤回 → 解锁、按钮回来；再发起放行
    await transferWf.cancel(first.transferNo, { reason: '开错' }, treasury());
    expect((await transferRow(first.transferNo)).status).toBe('CANCELLED');
    expect(await auditSince('INTERNAL_TRANSFER_CANCELLED', first.transferNo)).toHaveLength(1);
    expect((await dispRow(disp.dispositionNo)).transferNo).toBeNull();
    expect((await rowByLine(kase.caseNo, row0.externalLine.id)).nextStep?.kind).toBe('SHORTFALL_TOPUP');
    const req = await openTopup({ kase, row0, fromWalletId: opsW.id });
    expect((await dispRow(disp.dispositionNo)).transferNo).toBe(req.transferNo);
    const apr = await latestApprovalCase(ApprovalActionTypes.INTERNAL_TRANSFER_APPROVAL, req.transferNo);
    const snapshot = JSON.parse(apr.objectSnapshot);
    // 审批页那句话逐字（spec §4.1）：认的是托管短缺、客户余额不动
    expect(snapshot.impact).toBe(`Recognize custody shortfall of 7.500000 USDT on wallet ${wallet.walletNo} for customer ${cust.customerNo} and top it up from ${opsW.walletNo}; customer balance unchanged`);
    expect(snapshot).toMatchObject({ purpose: 'SHORTFALL_TOPUP', amount: '7.500000', currency: 'USDT', lossSource: 'AGING', effectiveDate: kase.businessDate, fromWalletNo: opsW.walletNo });
    expect(JSON.stringify(snapshot)).not.toContain(wallet.id);

    // 批准 = 记短缺（码 91），然后才有腿
    await approvalsService.approve(apr.approvalNo, { reason: 'e2e CFO approve shortfall top-up' }, cfo());
    await waitUntil(async () => (await transferRow(req.transferNo)).status === 'EXECUTING');
    await expect(transferWf.cancel(req.transferNo, { reason: 'late' }, treasury())).rejects.toThrow(/cannot be cancelled/);
    const itr = await transferRow(req.transferNo);
    const tev1 = await tbEvidence.findBySource('INTERNAL_TRANSFER', req.transferNo);
    expect(tev1.map((e: any) => e.eventCode)).toEqual(['INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED']);
    const rec = tev1[0];
    // 91：借 码 2·这只客户钱包 / 贷 码 1·同一只客户钱包；生效日 = 案件业务日（事后分录靠它才落进那天的对账）
    expect([rec.debitCode, rec.creditCode]).toEqual(['A.CLIENT_SHORTFALL', 'A.CLIENT_CASH']);
    expect(rec.debitTbAccountId).toBe(await shortfallHex(wallet.id, ledger));
    expect(rec.creditTbAccountId).toBe(await cashHex(wallet.id, ledger));
    expect(String(rec.amount)).toBe(L.loss.toString());
    expect(rec.effectiveDate).toBe(kase.businessDate);
    expect(rec.externalRef).toBeFalsy(); // 记短缺是账面动作，没有对应的外部行
    expect(itr.recognizedTbTransferId).toBe(rec.tbTransferId);
    expect(itr.recognizedAt).not.toBeNull();
    expect(itr).toMatchObject({ purpose: 'SHORTFALL_TOPUP', lossSource: 'AGING', explainedFlowId: row0.internalFlow.id, explainedExternalLineId: row0.externalLine.id });
    expect(toBusinessDate(itr.effectiveDate)).toBe(kase.businessDate);
    // 客户应付一分不动；短缺户借进 7.5；现金户少 7.5（= 外部真值）
    expect(await payableAvailable(cust.id, 'USDT')).toBe(L.fund);
    expect(await shortfallPosted(wallet.id, ledger)).toBe(L.loss);
    expect(await cashPosted(wallet.id, ledger)).toBe(L.fund - L.loss);
    expect(await cashPosted(wallet.id, ledger)).toBe(L.external);
    // 审计：记短缺单独一条（要因果），带生效日与固定成因
    const recAudit = await auditSince('INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED', req.transferNo);
    expect(recAudit).toHaveLength(1);
    expect(recAudit[0]).toMatchObject({ actionDomain: 'TREASURY', approvalNo: apr.approvalNo, amount: '7.500000', correlationId: itr.traceId });
    expect(new Date(recAudit[0].effectiveDate).toISOString().slice(0, 10)).toBe(kase.businessDate);
    expect(JSON.parse(recAudit[0].metadata)).toMatchObject({ tbTransferId: itr.recognizedTbTransferId, causeCode: CLIENT_SHORTFALL_CAUSE, lossSource: 'AGING' });
    // 匹配器第 0 轮（戊波二 T9b）：按案件业务日重对账。记短缺（91，生效日 = 案件业务日）是现金户上的一条 OUT，与原差异行的两个锚配成一组——
    //   {原内部行 IN 3000, 91 OUT 7.5} 的签名和 2992.5 = 对账单那条 IN 2992.5 → 一条 MATCHED，resolution = 本单号；
    //   现金户 2992.5 = 外部收盘，对内差额 0（现金 + 短缺 = 应付）→ 钱包 MATCHED、案子自愈。
    const healCutoff = new Date();
    const healRun = await walletRecon.run({ cutoff: healCutoff });
    const healSnap = await (prisma as any).reconciliationRunWallet.findFirst({ where: { runId: healRun.runId, walletRef: wallet.id } });
    expect(healSnap).toMatchObject({ bucket: 'MATCHED', matchedCount: 1, orphanInternal: 0, orphanExternal: 0, mismatchCount: 0 });
    expect(String(healSnap.deltaAmount)).toBe('0');
    expect(String(healSnap.internalDeltaAmount)).toBe('0');
    expect(await caseRow(kase.id)).toMatchObject({ status: 'RESOLVED', resolutionReason: 'AUTO_HEALED', closedByRunId: healRun.runId });
    expect(await openCaseFor(wallet.id)).toBeNull();
    // 读面：同一个截止点重建逐行对照——原差异行（对账单那条）现在是 MATCHED，挂着本单号；整张表没有任何异常行
    const healedRows = (await flowBuilder.build({ walletRef: wallet.id, cutoff: healCutoff, businessDate: kase.businessDate, assetCode: kase.assetCode })).rows;
    const origRow = healedRows.find((r: any) => r.externalLine?.id === row0.externalLine.id)!;
    expect(origRow.matchType).toBe('MATCHED');
    expect(origRow.explainedByAdjustmentNo).toBe(req.transferNo);
    expect(origRow.internalFlow!.id).toBe(row0.internalFlow.id);
    expect(healedRows.filter((r: any) => r.matchType !== 'MATCHED')).toEqual([]);

    // 腿 1 = 运营户 TRON → 客户地址
    const booksBefore = await snapshotBooks(ledger, [opsW.id, wallet.id]); // 91 已落、腿未落
    const [leg1] = await fundsOrders.findByParent({ internalTransferId: itr.id }, { legSeq: 1 });
    expect(leg1.status).toBe('CREATED');
    expect([leg1.fromWalletId, leg1.toWalletId]).toEqual([opsW.id, wallet.id]);
    expect(itr.viaWalletId).toBeNull();
    // ⚡ 提交腿 → 模拟托管方写两行，参考号 = 腿 txHash
    await fundsOrders.advance(leg1.id, FundsOrderAction.SUBMIT, 'E2E');
    await waitForSimLines(leg1.fundsOrderNo, [opsW.id, wallet.id]);
    const stamped = await fundsOrders.findById(leg1.id);
    expect(stamped.txHash).toMatch(/^0x/);
    const simIn = await (prisma as any).externalStatementLine.findUnique({ where: { dedupKey: `SIM-${leg1.fundsOrderNo}-${wallet.id}` } });
    expect(simIn).toMatchObject({ direction: 'IN', book: 'CLIENT', externalRef: stamped.txHash, currency: usdtCode });
    expect(simIn.amount.toString()).toBe('7500000');
    // ⚡ 确认 → 落账（82 + 83）→ 清算 → SUCCESS
    await fundsOrders.advance(leg1.id, FundsOrderAction.OBSERVE_CONFIRMING, 'E2E');
    await fundsOrders.advance(leg1.id, FundsOrderAction.CONFIRM, 'E2E');
    await waitUntil(async () => (await transferRow(req.transferNo)).status === 'SUCCESS');
    const tev = await tbEvidence.findBySource('INTERNAL_TRANSFER', req.transferNo);
    expect(tev.map((e: any) => e.eventCode).sort()).toEqual(['INTERNAL_TRANSFER_FIRM_OUT', 'INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED', 'INTERNAL_TRANSFER_SHORTFALL_TOPUP_IN']);
    for (const e of tev) {
      expect(e.assetCode).toBe('USDT');
      if (e.eventCode !== 'INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED') expect(e.externalRef).toBe(stamped.txHash); // 腿上的两笔与镜像行同号
    }
    // 过账形状：82 借 对账核销损失 / 贷 现金·运营钱包；83 借 现金·客户钱包 / 贷 码 2·同一只客户钱包（不是应付）；余额落点见 helper
    await expectTransferPostings({ transferNo: req.transferNo, ledger, fiat: false, topup: true, opsWalletId: opsW.id, customerWalletId: wallet.id, customerId: cust.id, clientInEvent: 'INTERNAL_TRANSFER_SHORTFALL_TOPUP_IN', amountMinor: L.loss, before: booksBefore });
    expect((await fundsOrders.findById(leg1.id)).status).toBe('CLEARED');
    // 终态：短缺归零、现金户回到记短缺之前（= 铺底原额）、客户应付全程是铺底原额
    expect(await shortfallPosted(wallet.id, ledger)).toBe(0n);
    expect(await cashPosted(wallet.id, ledger)).toBe(L.fund);
    expect(await payableAvailable(cust.id, 'USDT')).toBe(L.fund);
    // 客户端对账单（取自客户应付户）：整段弧零新增行，更不会有 INTERNAL_TRANSFER 来源
    const stmtAfter = await payableStatement(cust.id, ledger);
    expect(stmtAfter).toHaveLength(stmtBefore.length);
    expect(stmtAfter.filter((i: any) => i.sourceType === 'INTERNAL_TRANSFER')).toHaveLength(0);
    // 读面：回链 SUCCESS（已记短缺），不再给按钮
    const doneRow = await rowByLine(kase.caseNo, row0.externalLine.id);
    expect(doneRow.transfer).toMatchObject({ transferNo: req.transferNo, status: 'SUCCESS', recognized: true });
    expect(doneRow.nextStep).toBeUndefined();
    const run = await runNow();
    expect(run.status).not.toBe('INTERNAL_BREAK'); // 预门 = 两条恒等式（与 verify:coa 同式）：记短缺 + 补缺整段弧后依旧成立
    // 腿到账后：83（IN 7.5，参考号 = 腿 txHash）按参考号（Pass 1）配上模拟托管方回单那一行；
    // 第 0 轮那一组照旧是 MATCHED（原行 + 91 ↔ 对账单）；钱包整体平、没有异常、没有案子（⚡ 提交腿已把外部收盘一并抬高 7.5）
    const finalSnap = await (prisma as any).reconciliationRunWallet.findFirst({ where: { runId: run.runId, walletRef: wallet.id } });
    expect(finalSnap).toMatchObject({ bucket: 'MATCHED', matchedCount: 2, orphanInternal: 0, orphanExternal: 0, mismatchCount: 0 });
    expect(String(finalSnap.deltaAmount)).toBe('0');
    expect(await openCaseFor(wallet.id)).toBeNull();
    const finalRows = (await flowBuilder.build({ walletRef: wallet.id, cutoff: new Date(), businessDate: TODAY, assetCode: kase.assetCode })).rows;
    const legRow = finalRows.find((r: any) => r.externalLine?.id === simIn.id)!;
    expect(legRow.matchType).toBe('MATCHED');
    expect(legRow.internalFlow!.eventCode).toBe('INTERNAL_TRANSFER_SHORTFALL_TOPUP_IN');
    expect(legRow.internalFlow!.externalRef).toBe(stamped.txHash);
    expect(legRow.explainedByAdjustmentNo).toBeUndefined(); // Pass 1 配的，不是第 0 轮的解释
    for (const action of ['INTERNAL_TRANSFER_REQUESTED', 'INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED', 'INTERNAL_TRANSFER_EXECUTION_STARTED', 'INTERNAL_TRANSFER_LEG_POSTED', 'INTERNAL_TRANSFER_SETTLED']) {
      expect(await auditSince(action, req.transferNo)).toHaveLength(1);
    }
    const settled = (await auditSince('INTERNAL_TRANSFER_SETTLED', req.transferNo))[0];
    expect(settled.actionDomain).toBe('TREASURY');
    expect(settled.correlationId).toBe(itr.traceId);
  });

  it('B · 退汇余额不足：读面给 ADVANCE → 认领 400 指路 → 垫款两腿（81 / 82+83）→ 可用够扣 → 认领退汇 CLAWED_BACK → 愈', async () => {
    const cust = await createIsolatedCustomer('B');
    const iban = `AE-E2E-ITR-WDADDR-${cust.customerNo}`;
    const { deposit, wallet } = await makeSuccessfulFiatDeposit('1200', cust.id, cust.customerNo);
    const w = await makeSuccessfulFiatWithdraw('900', cust, iban);           // 净 898 + 费 2 出去；账上剩 300，外部也剩 300
    expect(w.status).toBe('SUCCESS');
    const claw = `E2E-CLAW-${randomUUID()}`;
    const line = await createExternalLine({ walletId: wallet.id, currency: 'AED', book: 'CLIENT', direction: 'OUT', amount: 120_000n, externalRef: claw, description: 'Return' });
    await upsertExternalBalance({ walletId: wallet.id, currency: 'AED', book: 'CLIENT', closingBalance: 30_000n - 120_000n }); // 300 − 1200 = −900
    expect((await runNow()).status).toBe('BREAK');
    const kase = await openCaseFor(wallet.id);
    const disp = await dispositions.record({ caseNo: kase.caseNo, explainedExternalLineId: line.id, matchType: 'ORPHAN_EXTERNAL', causeCode: 'BOUNCED_FUNDS', disposition: 'SUPPLEMENT', externalDirection: 'OUT', findingNote: '银行撤回，客户已花掉一部分' } as any, ops());
    expect(disp.deferredTarget).toBe('SUPPLEMENT_BOUNCE');
    const row0 = await rowByLine(kase.caseNo, line.id);
    expect(row0.nextStep).toMatchObject({ kind: 'ADVANCE', amount: '90000', externalLineId: line.id, available: '30000', lineAmount: '120000', customerNo: cust.customerNo });
    await expect(depositWf.initiateClawback(deposit.depositNo, { externalLineId: line.id, caseNo: kase.caseNo, dispositionNo: disp.dispositionNo, reason: 'x' }, ops())).rejects.toThrow(/initiate an advance/);
    // 垫款：金额锁定 = 差额 900
    const req = await transferWf.initiateAdvance({ caseNo: kase.caseNo, externalLineId: line.id, reason: '先垫后扣' }, treasury());
    const apr = await latestApprovalCase(ApprovalActionTypes.INTERNAL_TRANSFER_APPROVAL, req.transferNo);
    const snapshot = JSON.parse(apr.objectSnapshot);
    expect(snapshot.impact).toContain('Advance 900.00 AED');
    expect(snapshot).not.toHaveProperty('externalLineId');
    expect(snapshot.externalRef).toBe(claw);
    await approvalsService.approve(apr.approvalNo, { reason: 'e2e CFO approve advance' }, cfo());
    await waitUntil(async () => (await transferRow(req.transferNo)).status === 'EXECUTING');
    const itr = await transferRow(req.transferNo);
    const opsW = await platformWallet('F_OPS', aedNetwork); const setW = await platformWallet('F_SET', aedNetwork);
    expect(itr.viaWalletId).toBe(setW.id);
    const booksBefore = await snapshotBooks(TB_LEDGERS.AED, [opsW.id, setW.id, wallet.id]);
    // 腿 1：运营户 → 结算户
    const [leg1] = await fundsOrders.findByParent({ internalTransferId: itr.id }, { legSeq: 1 });
    expect([leg1.fromWalletId, leg1.toWalletId]).toEqual([opsW.id, setW.id]);
    await fundsOrders.advance(leg1.id, FundsOrderAction.SUBMIT, 'E2E');
    await waitForSimLines(leg1.fundsOrderNo, [opsW.id, setW.id]);
    await fundsOrders.advance(leg1.id, FundsOrderAction.CONFIRM, 'E2E');
    await waitUntil(async () => (await fundsOrders.findByParent({ internalTransferId: itr.id }, { legSeq: 2 })).length === 1);
    expect((await fundsOrders.findById(leg1.id)).status).toBe('CLEARED');
    expect((await transferRow(req.transferNo)).status).toBe('EXECUTING');
    // 腿 2：结算户 → 客户 vIBAN
    const [leg2] = await fundsOrders.findByParent({ internalTransferId: itr.id }, { legSeq: 2 });
    expect([leg2.fromWalletId, leg2.toWalletId]).toEqual([setW.id, wallet.id]);
    await fundsOrders.advance(leg2.id, FundsOrderAction.SUBMIT, 'E2E');
    await waitForSimLines(leg2.fundsOrderNo, [setW.id, wallet.id]);
    await fundsOrders.advance(leg2.id, FundsOrderAction.CONFIRM, 'E2E');
    await waitUntil(async () => (await transferRow(req.transferNo)).status === 'SUCCESS');
    // 戊波一·附录 B「内部转账」:过账形状(账户 + 余额落点)见 expectTransferPostings
    await expectTransferPostings({ transferNo: req.transferNo, ledger: TB_LEDGERS.AED, fiat: true, opsWalletId: opsW.id, setWalletId: setW.id, customerWalletId: wallet.id, customerId: cust.id, clientInEvent: 'INTERNAL_TRANSFER_ADVANCE_IN', amountMinor: 90_000n, before: booksBefore });
    expect((await accounting.getCustomerAvailableBalance(cust.id, 'AED')).available).toBe(120_000n);
    // 垫款到账：读面不再给 ADVANCE，回挂 SUCCESS；认领退汇走 B 批原路
    const row1 = await rowByLine(kase.caseNo, line.id);
    expect(row1.nextStep).toBeUndefined();
    expect(row1.transfer).toMatchObject({ transferNo: req.transferNo, purpose: 'CLIENT_ADVANCE', status: 'SUCCESS' });
    const clawReq = await depositWf.initiateClawback(deposit.depositNo, { externalLineId: line.id, caseNo: kase.caseNo, dispositionNo: disp.dispositionNo, reason: '银行撤回' }, ops());
    await approvalsService.approve(clawReq.approvalNo, { reason: 'e2e CFO approve clawback' }, cfo());
    await waitUntil(async () => (await deposits.findOne(deposit.id)).status === 'CLAWED_BACK');
    expect((await accounting.getCustomerAvailableBalance(cust.id, 'AED')).available).toBe(0n);
    await runNow();
    expect((await caseRow(kase.id)).status).toBe('RESOLVED');
  });

  it('C1 · 客户池多出来的钱：读面 CLIENT_SURPLUS，认损补缺 → 400 指路补录（不是认损）；旧的认损调账单入口也已关', async () => {
    const cust = await createIsolatedCustomer('C1');
    const wallet = await ensureDepositWallet(cust.id, aedNetwork);
    const ref = `E2E-SURPLUS-${randomUUID().slice(0, 8)}`;
    const line = await createExternalLine({ walletId: wallet.id, currency: 'AED', book: 'CLIENT', direction: 'IN', amount: 5_000n, externalRef: ref });
    await upsertExternalBalance({ walletId: wallet.id, currency: 'AED', book: 'CLIENT', closingBalance: 5_000n });
    expect((await runNow()).status).toBe('BREAK');
    const kase = await openCaseFor(wallet.id);
    const disp = await dispositions.record({ caseNo: kase.caseNo, explainedExternalLineId: line.id, matchType: 'ORPHAN_EXTERNAL', causeCode: 'UNEXPLAINED', disposition: 'HOLD_INVESTIGATING', externalDirection: 'IN', findingNote: 'e2e：多出来 50，查不出' } as any, ops());
    await caseService.simulateTimeout(kase.caseNo, ops()); await agingSweep.checkAgingBreaches(new Date());
    expect((await rowByLine(kase.caseNo, line.id)).nextStep).toEqual({ kind: 'CLIENT_SURPLUS' });
    const opsW = await platformWallet('F_OPS', aedNetwork);
    await expect(transferWf.initiateShortfallTopup({ caseNo: kase.caseNo, externalLineId: line.id, fromWalletId: opsW.id, reason: 'x' }, treasury())).rejects.toThrow(/deposit backfill/);
    expect(await (prisma as any).internalTransfer.count({ where: { explainedExternalLineId: line.id } })).toBe(0);
    expect((await dispRow(disp.dispositionNo)).transferNo).toBeNull();
    // 旧路已关：客户池认损不再是调账单码（戊波二把它并进划转单）
    await expect(adjustments.createDraft({ caseNo: kase.caseNo, reasonCode: CLIENT_SHORTFALL_CAUSE, direction: 'INCREASE', amount: '5000', effectiveDate: kase.businessDate, explainedExternalLineId: line.id, reasonInternal: 'x', dispositionNo: disp.dispositionNo } as any, treasury())).rejects.toThrow(/Unknown reason code/);
  });

  it('C2 · 腿失败（已记短缺）→ FAILED(LEG_FAILED)，91 在 82 / 83 不在；入口不回、同行再开 400；短缺户不归零', async () => {
    const { cust, wallet, kase, row0, disp, L } = await driveClientShortfallToOverdue('C2');
    const ledger = L.ledger;
    const opsW = await platformWallet('F_OPS', usdtNetwork);
    const req = await openTopup({ kase, row0, fromWalletId: opsW.id });
    const apr = await latestApprovalCase(ApprovalActionTypes.INTERNAL_TRANSFER_APPROVAL, req.transferNo);
    await approvalsService.approve(apr.approvalNo, { reason: 'ok' }, cfo());
    await waitUntil(async () => (await transferRow(req.transferNo)).status === 'EXECUTING');
    const itr = await transferRow(req.transferNo);
    const [leg1] = await fundsOrders.findByParent({ internalTransferId: itr.id }, { legSeq: 1 });
    await fundsOrders.advance(leg1.id, FundsOrderAction.FAIL, 'E2E');
    await waitUntil(async () => (await transferRow(req.transferNo)).status === 'FAILED');
    const failed = await transferRow(req.transferNo);
    expect(failed.failureReasonCode).toBe('LEG_FAILED');
    expect(failed.recognizedTbTransferId).toBeTruthy(); // 91 已落：这张单「已记短缺」
    // 账：只有 91；公司放出（82）与客户收到（83）一笔都没有
    expect((await tbEvidence.findBySource('INTERNAL_TRANSFER', req.transferNo)).map((e: any) => e.eventCode)).toEqual(['INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED']);
    expect((await auditSince('INTERNAL_TRANSFER_FAILED', req.transferNo))[0].reasonCode).toBe('LEG_FAILED');
    // 短缺户不归零（挂着等人工）、现金户仍是记短缺后的外部真值、客户应付不动
    expect(await shortfallPosted(wallet.id, ledger)).toBe(L.loss);
    expect(await cashPosted(wallet.id, ledger)).toBe(L.fund - L.loss);
    expect(await payableAvailable(cust.id, 'USDT')).toBe(L.fund);
    // 入口不回：行继续锁着，没有 SHORTFALL_TOPUP 钮，回链 FAILED（已记短缺）
    expect((await dispRow(disp.dispositionNo)).transferNo).toBe(req.transferNo);
    const row = await rowByLine(kase.caseNo, row0.externalLine.id);
    expect(row.transfer).toMatchObject({ transferNo: req.transferNo, status: 'FAILED', recognized: true });
    expect(row.nextStep).toBeUndefined();
    // 同一行再开 → 400（不论用哪个锚）；没有第二张单
    await expect(openTopup({ kase, row0, fromWalletId: opsW.id, reason: '重发' })).rejects.toThrow(BadRequestException);
    await expect(openTopup({ kase, row0, fromWalletId: opsW.id, reason: '重发' })).rejects.toThrow(/already linked to shortfall top-up/);
    await expect(transferWf.initiateShortfallTopup({ caseNo: kase.caseNo, flowId: row0.internalFlow.id, fromWalletId: opsW.id, reason: '重发' }, treasury())).rejects.toThrow(/already linked to shortfall top-up/);
    expect(await (prisma as any).internalTransfer.count({ where: { explainedExternalLineId: row0.externalLine.id } })).toBe(1);
  });

  it('C3 · CFO 拒绝 → REJECTED，无资金单无分录（连 91 也没记），解锁，按钮回来、可重新发起', async () => {
    const { cust, wallet, kase, row0, disp, L } = await driveClientShortfallToOverdue('C3');
    const opsW = await platformWallet('F_OPS', usdtNetwork);
    const req = await openTopup({ kase, row0, fromWalletId: opsW.id, reason: '认损补缺' });
    const apr = await latestApprovalCase(ApprovalActionTypes.INTERNAL_TRANSFER_APPROVAL, req.transferNo);
    await approvalsService.reject(apr.approvalNo, { reason: 'e2e CFO reject' }, cfo());
    await waitUntil(async () => (await transferRow(req.transferNo)).status === 'REJECTED');
    const itr = await transferRow(req.transferNo);
    expect(itr.recognizedTbTransferId).toBeNull();
    expect(await fundsOrders.findByParent({ internalTransferId: itr.id })).toHaveLength(0);
    expect(await tbEvidence.findBySource('INTERNAL_TRANSFER', req.transferNo)).toHaveLength(0);
    expect(await shortfallPosted(wallet.id, L.ledger)).toBe(0n);
    expect(await cashPosted(wallet.id, L.ledger)).toBe(L.fund);
    expect((await auditSince('INTERNAL_TRANSFER_REJECTED', req.transferNo))[0].approvalNo).toBe(apr.approvalNo);
    expect(await auditSince('INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED', req.transferNo)).toHaveLength(0);
    // 解锁：处置记录的 transferNo 清空，读面按钮回来，可再开一张
    expect((await dispRow(disp.dispositionNo)).transferNo).toBeNull();
    expect((await rowByLine(kase.caseNo, row0.externalLine.id)).nextStep?.kind).toBe('SHORTFALL_TOPUP');
    const again = await openTopup({ kase, row0, fromWalletId: opsW.id, reason: '重发' });
    expect(again.transferNo).not.toBe(req.transferNo);
    expect(again.status).toBe('PENDING_APPROVAL');
    expect(await payableAvailable(cust.id, 'USDT')).toBe(L.fund);
  });

  // ── 过账形状(戊波一 / 戊波二)：法币两腿认损补缺 ───────────────────────────
  // 加密币一腿的过账形状由上面 A 逐项断言(expectTransferPostings)；法币两腿经结算户这条，铺底走夹具(fundCustomerWallet)、
  // 与 A 同一条真实认损补缺链(driveClientShortfallToOverdue 的 AED 版)，单独钉住 91 / 81 / 82 / 83 的落点——
  // 并且出钱钱包选**手续费户**（A 用运营户），证明「人选 from 钱包」这一步真的决定了钱从哪只钱包出。
  // 最终余额 = 铺底原额（应付从头到尾没动；缺口 9_000 记短缺借进码 2、83 贷回去）。

  it('P2 · 法币两腿认损补缺（from = 手续费户）：91 记短缺 → 81 借 现金·结算钱包 / 贷 现金·手续费户，82 借 对账核销损失 / 贷 现金·结算钱包，83 借 现金·客户 vIBAN / 贷 码 2 → SUCCESS，应付不动', async () => {
    const { cust, wallet, kase, row0, L } = await driveClientShortfallToOverdue('P2', 'AED');
    const ledger = L.ledger;
    const feeW = await platformWallet('F_FEE', aedNetwork); const setW = await platformWallet('F_SET', aedNetwork); const opsW = await platformWallet('F_OPS', aedNetwork);
    await fundFirmWallet({ walletId: feeW.id, ledger, currency: 'AED', amount: 50_000n, tag: 'P2' }); // 手续费户 demo:setup 后是空的：先注 500.00 AED
    const req = await openTopup({ kase, row0, fromWalletId: feeW.id, reason: '公司认损补缺' });
    const apr = await latestApprovalCase(ApprovalActionTypes.INTERNAL_TRANSFER_APPROVAL, req.transferNo);
    const snapshot = JSON.parse(apr.objectSnapshot);
    expect(snapshot.impact).toBe(`Recognize custody shortfall of 90.00 AED on wallet ${wallet.walletNo} for customer ${cust.customerNo} and top it up from ${feeW.walletNo}; customer balance unchanged`);
    expect(snapshot.fromWalletNo).toBe(feeW.walletNo);
    await approvalsService.approve(apr.approvalNo, { reason: 'e2e CFO approve shortfall top-up' }, cfo());
    await waitUntil(async () => (await transferRow(req.transferNo)).status === 'EXECUTING');
    const itr = await transferRow(req.transferNo);
    expect(itr.fromWalletId).toBe(feeW.id);
    expect(itr.viaWalletId).toBe(setW.id);
    // 91 已落（批准那一步）：应付不动
    expect((await tbEvidence.findBySource('INTERNAL_TRANSFER', req.transferNo)).map((e: any) => e.eventCode)).toEqual(['INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED']);
    expect(await payableAvailable(cust.id, 'AED')).toBe(L.fund);
    expect(await shortfallPosted(wallet.id, ledger)).toBe(L.loss);
    const booksBefore = await snapshotBooks(ledger, [feeW.id, setW.id, wallet.id, opsW.id]);
    const [leg1] = await fundsOrders.findByParent({ internalTransferId: itr.id }, { legSeq: 1 });
    expect([leg1.fromWalletId, leg1.toWalletId]).toEqual([feeW.id, setW.id]);
    await fundsOrders.advance(leg1.id, FundsOrderAction.SUBMIT, 'E2E');
    await waitForSimLines(leg1.fundsOrderNo, [feeW.id, setW.id]);
    await fundsOrders.advance(leg1.id, FundsOrderAction.CONFIRM, 'E2E');
    await waitUntil(async () => (await fundsOrders.findByParent({ internalTransferId: itr.id }, { legSeq: 2 })).length === 1);
    const [leg2] = await fundsOrders.findByParent({ internalTransferId: itr.id }, { legSeq: 2 });
    expect([leg2.fromWalletId, leg2.toWalletId]).toEqual([setW.id, wallet.id]);
    await fundsOrders.advance(leg2.id, FundsOrderAction.SUBMIT, 'E2E');
    await waitForSimLines(leg2.fundsOrderNo, [setW.id, wallet.id]);
    await fundsOrders.advance(leg2.id, FundsOrderAction.CONFIRM, 'E2E');
    await waitUntil(async () => (await transferRow(req.transferNo)).status === 'SUCCESS');
    await expectTransferPostings({ transferNo: req.transferNo, ledger, fiat: true, topup: true, opsWalletId: feeW.id, setWalletId: setW.id, customerWalletId: wallet.id, customerId: cust.id, clientInEvent: 'INTERNAL_TRANSFER_SHORTFALL_TOPUP_IN', amountMinor: L.loss, before: booksBefore });
    expect((await snapshotBooks(ledger, [opsW.id])).cash[opsW.id]).toBe(booksBefore.cash[opsW.id]); // 运营户不动：钱是手续费户出的
    expect(await shortfallPosted(wallet.id, ledger)).toBe(0n);
    expect(await cashPosted(wallet.id, ledger)).toBe(L.fund);
    expect(await payableAvailable(cust.id, 'AED')).toBe(L.fund); // 铺底原额：应付从头到尾没动
  });

  // ── 挂起锁定（裁定 14）：91 贷客户现金户，该户「贷不得超借」，TB 判标志时把挂起的贷方也算进去 ──
  // 客户钱包上有在途出款（待批提现的锁）时，可用额 = 借已过账 − 贷已过账 − 贷挂起 < 短缺额，码 91 必被 TB 拒。
  // 真实运营里本就如此（托管少了钱，这只钱包的出款先停），所以开单时拒并指路；开单后才出现的锁，批准那一步复查拒（RECOGNITION_FAILED）。
  // 锁都经真实出款入口造（createWithdrawal），不是裸写 TB 待决转账，形状同真实待批提现。

  it('挂起锁定 · 客户钱包上有在途出款：可用额 < 短缺额 → 开单 400 指路「先处理在途出款」，不建单、不挂锁', async () => {
    const { cust, wallet, kase, row0, disp, L } = await driveClientShortfallToOverdue('LOCK', 'AED');
    const opsW = await platformWallet('F_OPS', aedNetwork);
    // 铺底 3000.00，缺口 90.00；真实提现 2950.00 → 待决贷方 2950.00 → 可用 50.00 < 90.00
    await createInFlightWithdrawal(cust, '2950');
    expect(await cashPosted(wallet.id, L.ledger)).toBe(L.fund);                                  // 已落账现金没动：挂的是待决
    expect(await accounting.getWalletCashAvailable(wallet.id, L.ledger)).toBe(5_000n);           // 可用 = 300_000 − 295_000
    const err: any = await openTopup({ kase, row0, fromWalletId: opsW.id }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: 'CLIENT_WALLET_PAYOUTS_IN_FLIGHT' });
    expect(err.message).toMatch(/first handle this wallet's in-flight payouts/);
    expect(err.message).toContain(cust.customerNo);
    expect(JSON.stringify(err.getResponse())).not.toContain(wallet.id);                          // 话术只用业务号，不带 UUID
    // 没建单、没挂锁、没动账；读面按钮还在（拒在点按那一刻，不是读面替它拒）
    expect(await (prisma as any).internalTransfer.count({ where: { explainedExternalLineId: row0.externalLine.id } })).toBe(0);
    expect((await dispRow(disp.dispositionNo)).transferNo).toBeNull();
    expect((await rowByLine(kase.caseNo, row0.externalLine.id)).nextStep?.kind).toBe('SHORTFALL_TOPUP');
    expect(await shortfallPosted(wallet.id, L.ledger)).toBe(0n);
  });

  it('开单后才出现的在途出款（lock after submit）：CFO 批准那一步复查不过 → FAILED(RECOGNITION_FAILED)，行解锁，91 没记、没腿', async () => {
    const { cust, wallet, kase, row0, disp, L } = await driveClientShortfallToOverdue('LAST', 'AED');
    const opsW = await platformWallet('F_OPS', aedNetwork);
    const req = await openTopup({ kase, row0, fromWalletId: opsW.id }); // 开单时钱包上没有锁 → 放行
    expect(req.status).toBe('PENDING_APPROVAL');
    expect((await dispRow(disp.dispositionNo)).transferNo).toBe(req.transferNo);
    await createInFlightWithdrawal(cust, '2950');                       // 开单之后、批准之前，客户发起真实提现 → 待决贷方 2950.00
    expect(await accounting.getWalletCashAvailable(wallet.id, L.ledger)).toBe(5_000n);
    const payableWithLock = await payableAvailable(cust.id, 'AED');   // 提现自己把客户可用余额锁到 50.00；认损补缺不该再动它
    expect(payableWithLock).toBe(5_000n);
    const apr = await latestApprovalCase(ApprovalActionTypes.INTERNAL_TRANSFER_APPROVAL, req.transferNo);
    await approvalsService.approve(apr.approvalNo, { reason: 'e2e CFO approve shortfall top-up' }, cfo());
    await waitUntil(async () => (await transferRow(req.transferNo)).status === 'FAILED');
    const failed = await transferRow(req.transferNo);
    expect(failed.failureReasonCode).toBe('RECOGNITION_FAILED');
    expect(failed.recognizedTbTransferId).toBeNull();
    // 没有任何分录落下：91 没记、没有腿、短缺户 0、现金户铺底原额
    expect(await tbEvidence.findBySource('INTERNAL_TRANSFER', req.transferNo)).toHaveLength(0);
    expect(await fundsOrders.findByParent({ internalTransferId: failed.id })).toHaveLength(0);
    expect(await shortfallPosted(wallet.id, L.ledger)).toBe(0n);
    expect(await cashPosted(wallet.id, L.ledger)).toBe(L.fund);
    expect(await payableAvailable(cust.id, 'AED')).toBe(payableWithLock);
    // 审计：失败一条（RECOGNITION_FAILED），没有 SHORTFALL_RECOGNIZED
    const failAudit = await auditSince('INTERNAL_TRANSFER_FAILED', req.transferNo);
    expect(failAudit).toHaveLength(1);
    expect(failAudit[0].reasonCode).toBe('RECOGNITION_FAILED');
    expect(await auditSince('INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED', req.transferNo)).toHaveLength(0);
    // 行解锁：处置记录 transferNo 清空，按钮回来（记短缺没落，可以重新开单）
    expect((await dispRow(disp.dispositionNo)).transferNo).toBeNull();
    const row = await rowByLine(kase.caseNo, row0.externalLine.id);
    expect(row.nextStep?.kind).toBe('SHORTFALL_TOPUP');
    expect(row.transfer).toBeFalsy(); // 失败单已解锁，不再回挂到这一行
  });
});
