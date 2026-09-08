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
import { ConflictException } from '@nestjs/common';
import { AdjustmentService } from '../src/modules/clearing-settle/reconciliation/disposition/adjustment.service';
import { CaseAgingService } from '../src/modules/clearing-settle/reconciliation/workflow/case-aging.service';
import { CaseAgingSweepService } from '../src/modules/clearing-settle/reconciliation/sweep/case-aging-sweep.service';
import { ReconciliationQueryService } from '../src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service';
import { InternalTransferWorkflowService } from '../src/modules/asset-treasury/internal-transfers/internal-transfer-workflow.service';
import { FundsOrderAction } from '../src/modules/funds-orders/dto/funds-order.dto';
import { toBusinessDate } from '../src/modules/accounting/tigerbeetle/utils/business-date.util';

/**
 * 平账二期（spec §14）e2e：认损 → 补款（加密币一腿）｜ 垫款 → 认领（法币两腿经结算户）｜ 拒绝路径。
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
  let dispositions: DispositionService; let adjustments: AdjustmentService; let caseAging: CaseAgingService; let agingSweep: CaseAgingSweepService;
  let reconQuery: ReconciliationQueryService; let walletRecon: WalletReconRunService; let approvalsService: ApprovalsService;
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
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();
    prisma = app.get(PrismaService);
    dispositions = app.get(DispositionService); adjustments = app.get(AdjustmentService);
    caseAging = app.get(CaseAgingService); agingSweep = app.get(CaseAgingSweepService);
    reconQuery = app.get(ReconciliationQueryService); walletRecon = app.get(WalletReconRunService); approvalsService = app.get(ApprovalsService);
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
   *  Step 1 (CLIENT_ASSET→DEPOSIT_SUSPENSE, external crossing) + Step 2
   *  (DEPOSIT_SUSPENSE→CLIENT_PAYABLE, pure reclass) exactly. */
  async function fundCustomerWallet(opts: {
    walletId: string; ownerId: string; assetId: string; ledger: number; currency: string; amount: bigint; tag: string;
    externalRef?: string; crossing?: boolean; effectiveDate?: string;
  }): Promise<string> {
    const sourceNo = `E2E-ITR-FUND-${opts.tag}-${randomUUID().slice(0, 8)}`;

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
   *  Step 1 那条 isExternalCrossing 内部流水在后续对账里找不到对应外部行，
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
  const adjRow = (adjustmentNo: string) => (prisma as any).reconciliationAdjustment.findUnique({ where: { adjustmentNo } });
  const transferRow = (transferNo: string) => (prisma as any).internalTransfer.findUnique({ where: { transferNo } });
  const latestApprovalCase = (actionType: string, entityRef: string) => (prisma as any).approvalCase.findFirst({ where: { actionType, entityRef }, orderBy: { createdAt: 'desc' } });
  const auditSince = (action: string, subjectNo: string) => (prisma as any).auditLogEvent.findMany({ where: { action, primarySubjectNo: subjectNo, recordedAt: { gte: testStartedAt } } });
  const platformWallet = (vault: 'F_OPS' | 'F_SET', network: string) => (prisma as any).wallet.findFirst({ where: { vaultCode: vault, network, ownerType: 'PLATFORM', status: 'ACTIVE' } });
  async function waitForSimLines(fundsOrderNo: string, walletIds: string[]): Promise<void> {
    await waitUntil(async () => (await (prisma as any).externalStatementLine.count({ where: { dedupKey: { in: walletIds.map((w) => `SIM-${fundsOrderNo}-${w}`) } } })) === walletIds.length);
  }
  const rowByLine = async (caseNo: string, externalLineId: string) => (await reconQuery.getCase(caseNo)).flowComparison.find((r: any) => r.externalLine?.id === externalLineId)!;
  const rowByAdjustment = async (caseNo: string, adjustmentNo: string) => (await reconQuery.getCase(caseNo)).flowComparison.find((r: any) => r.explainedByAdjustmentNo === adjustmentNo)!;

  /** 把一个独立客户的 USDT 钱包推到「认损已落账、案子已愈、行上待补款」：主链 A 与拒绝路径 C 共用。 */
  async function driveClientLossToCompensationPending(tag: string) {
    const cust = await createIsolatedCustomer(tag);
    const wallet = await ensureDepositWallet(cust.id, usdtNetwork);
    const REF = `0xe2eloss${tag}${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await fundCustomerWallet({ walletId: wallet.id, ownerId: cust.id, assetId: usdtAssetId, ledger: TB_LEDGERS.USDT, currency: 'USDT', amount: 3_000_000_000n, tag, externalRef: REF, crossing: true });
    await createExternalLine({ walletId: wallet.id, currency: usdtCode, book: 'CLIENT', direction: 'IN', amount: 2_992_500_000n, externalRef: REF, source: 'HEXTRUST' });
    await upsertExternalBalance({ walletId: wallet.id, currency: usdtCode, book: 'CLIENT', closingBalance: 2_992_500_000n, source: 'HEXTRUST' });
    expect((await runNow()).status).toBe('BREAK');
    const kase = await openCaseFor(wallet.id);
    expect(kase.book).toBe('CUSTOMER');
    const row0 = (await reconQuery.getCase(kase.caseNo)).flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!;
    const disp = await dispositions.record({
      caseNo: kase.caseNo,
      matchType: 'AMOUNT_MISMATCH', explainedFlowId: row0.internalFlow!.id, explainedExternalLineId: row0.externalLine!.id,
      causeCode: 'UNEXPLAINED', disposition: 'HOLD_INVESTIGATING', findingNote: 'e2e：托管少 7.5 USDT，翻遍凭证查无可查', deltaSign: -1, internalDirection: 'IN', internalSourceType: 'DEPOSIT',
    } as any, ops());
    expect(disp.outlet).toBe('HOLD_INVESTIGATING');
    await caseAging.simulateTimeout(kase.caseNo, ops());
    expect(await agingSweep.checkAgingBreaches(new Date())).toBeGreaterThanOrEqual(1);
    const row1 = (await reconQuery.getCase(kase.caseNo)).flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!;
    expect(row1.nextStep).toEqual({ kind: 'WRITE_OFF', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', direction: 'REDUCE', amount: '7500000', effectiveDate: kase.businessDate });
    const woDto = {
      caseNo: kase.caseNo, reasonCode: 'UNEXPLAINED_CLIENT_LOSS', direction: 'REDUCE', amount: '7500000', effectiveDate: kase.businessDate,
      explainedFlowId: row0.internalFlow!.id, explainedExternalLineId: row0.externalLine!.id,
      reasonInternal: 'e2e 客户池认损', reasonCustomer: '平台调整', dispositionNo: disp.dispositionNo,
    };
    await expect(adjustments.createDraft({ ...woDto, reasonCode: 'UNEXPLAINED_WRITE_OFF' } as any, treasury())).rejects.toThrow(/Client pool loss recognition/);
    const { adjustmentNo } = await adjustments.createDraft(woDto as any, treasury());
    await adjustments.submit(adjustmentNo, treasury());
    const apr = await latestApprovalCase(ApprovalActionTypes.RECON_ADJUSTMENT_POST, adjustmentNo);
    expect(JSON.parse(apr.objectSnapshot).impact).toContain('Client pool unexplained loss recognition');
    await approvalsService.approve(apr.approvalNo, { reason: 'e2e CFO approve loss' }, cfo());
    await waitUntil(async () => (await adjRow(adjustmentNo)).status === 'POSTED');
    const ev = await tbEvidence.findBySource('RECON_ADJUSTMENT', adjustmentNo);
    expect(ev[0].debitCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE]);
    expect(ev[0].creditCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET]);
    expect((await accounting.getCustomerAvailableBalance(cust.id, 'USDT')).available).toBe(2_992_500_000n);
    await runNow();
    expect((await caseRow(kase.id)).status).toBe('RESOLVED');
    // 案子愈了，行上还活着：待补款（spec §7.2）
    const row2 = await rowByAdjustment(kase.caseNo, adjustmentNo);
    expect(row2.nextStep).toMatchObject({ kind: 'COMPENSATION', adjustmentNo, amount: '7500000', customerNo: cust.customerNo });
    return { cust, wallet, kase, adjustmentNo };
  }

  // ── scenarios ────────────────────────────────────────────────────────────

  it('A · 认损 → 撤回再发 → CFO 批 → ⚡ 提交腿（镜像两行、在途不红）→ ⚡ 确认（82+83 落账、清算）→ SUCCESS、余额复位、案子愈', async () => {
    const { cust, wallet, kase, adjustmentNo } = await driveClientLossToCompensationPending('A');
    // 发起 → 同来源二次发起 409 → 撤回 → 再发起放行
    const first = await transferWf.initiateCompensation({ adjustmentNo, reason: '公司认赔' }, treasury());
    expect(first.status).toBe('PENDING_APPROVAL');
    await expect(transferWf.initiateCompensation({ adjustmentNo, reason: 'again' }, treasury())).rejects.toBeInstanceOf(ConflictException);
    expect((await rowByAdjustment(kase.caseNo, adjustmentNo)).transfer).toMatchObject({ transferNo: first.transferNo, status: 'PENDING_APPROVAL' });
    expect((await rowByAdjustment(kase.caseNo, adjustmentNo)).nextStep).toBeUndefined();
    await transferWf.cancel(first.transferNo, { reason: '开错' }, treasury());
    expect((await transferRow(first.transferNo)).status).toBe('CANCELLED');
    expect(await auditSince('INTERNAL_TRANSFER_CANCELLED', first.transferNo)).toHaveLength(1);
    expect((await rowByAdjustment(kase.caseNo, adjustmentNo)).nextStep?.kind).toBe('COMPENSATION');
    const req = await transferWf.initiateCompensation({ adjustmentNo, reason: '公司认赔' }, treasury());
    const apr = await latestApprovalCase(ApprovalActionTypes.INTERNAL_TRANSFER_APPROVAL, req.transferNo);
    const snapshot = JSON.parse(apr.objectSnapshot);
    expect(snapshot.impact).toContain('compensation of 7.500000 USDT');
    expect(JSON.stringify(snapshot)).not.toContain(wallet.id);
    // 批准 → 执行中，腿 1 = 运营户 TRON → 客户地址
    await approvalsService.approve(apr.approvalNo, { reason: 'e2e CFO approve compensation' }, cfo());
    await waitUntil(async () => (await transferRow(req.transferNo)).status === 'EXECUTING');
    await expect(transferWf.cancel(req.transferNo, { reason: 'late' }, treasury())).rejects.toThrow(/cannot be cancelled/);
    const itr = await transferRow(req.transferNo);
    const opsW = await platformWallet('F_OPS', usdtNetwork);
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
    // 在途桶不红：客户钱包开一张 IN_TRANSIT 案
    await runNow();
    const transitCase = await openCaseFor(wallet.id);
    expect(transitCase.bucket).toBe('IN_TRANSIT');
    expect((await reconQuery.getCase(transitCase.caseNo)).flowComparison.find((r: any) => r.matchType === 'IN_TRANSIT')?.fundsOrderNo).toBe(leg1.fundsOrderNo);
    // ⚡ 确认 → 落账（82 + 83）→ 清算 → SUCCESS
    await fundsOrders.advance(leg1.id, FundsOrderAction.OBSERVE_CONFIRMING, 'E2E');
    await fundsOrders.advance(leg1.id, FundsOrderAction.CONFIRM, 'E2E');
    await waitUntil(async () => (await transferRow(req.transferNo)).status === 'SUCCESS');
    const tev = await tbEvidence.findBySource('INTERNAL_TRANSFER', req.transferNo);
    expect(tev.map((e: any) => e.eventCode).sort()).toEqual(['INTERNAL_TRANSFER_COMPENSATION_IN', 'INTERNAL_TRANSFER_FIRM_OUT']);
    for (const e of tev) { expect(e.isExternalCrossing).toBe(true); expect(e.externalRef).toBe(stamped.txHash); expect(e.assetCode).toBe('USDT'); }
    expect((await fundsOrders.findById(leg1.id)).status).toBe('CLEARED');
    expect((await accounting.getCustomerAvailableBalance(cust.id, 'USDT')).available).toBe(3_000_000_000n);
    // 再对账：在途案自愈；行上回挂 SUCCESS，不再给按钮
    const run = await runNow();
    expect(run.status).not.toBe('INTERNAL_BREAK'); // 预门 = 两条恒等式（与 verify:coa 同式）
    expect((await caseRow(transitCase.id)).status).toBe('RESOLVED');
    expect((await rowByAdjustment(kase.caseNo, adjustmentNo)).transfer).toMatchObject({ transferNo: req.transferNo, status: 'SUCCESS' });
    expect((await rowByAdjustment(kase.caseNo, adjustmentNo)).nextStep).toBeUndefined();
    for (const action of ['INTERNAL_TRANSFER_REQUESTED', 'INTERNAL_TRANSFER_EXECUTION_STARTED', 'INTERNAL_TRANSFER_LEG_POSTED', 'INTERNAL_TRANSFER_SETTLED']) {
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
    const tev = await tbEvidence.findBySource('INTERNAL_TRANSFER', req.transferNo);
    expect(tev.map((e: any) => e.eventCode).sort()).toEqual(['INTERNAL_TRANSFER_ADVANCE_IN', 'INTERNAL_TRANSFER_FIRM_OUT', 'INTERNAL_TRANSFER_OPS_TO_SET']);
    const opsToSet = tev.find((e: any) => e.eventCode === 'INTERNAL_TRANSFER_OPS_TO_SET');
    expect([opsToSet.debitWalletRef, opsToSet.creditWalletRef]).toEqual([opsW.id, setW.id]);
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

  it('C1 · 客户池多出来的钱：读面 CLIENT_SURPLUS，认损 INCREASE → 400 指路补录', async () => {
    const cust = await createIsolatedCustomer('C1');
    const wallet = await ensureDepositWallet(cust.id, aedNetwork);
    const ref = `E2E-SURPLUS-${randomUUID().slice(0, 8)}`;
    const line = await createExternalLine({ walletId: wallet.id, currency: 'AED', book: 'CLIENT', direction: 'IN', amount: 5_000n, externalRef: ref });
    await upsertExternalBalance({ walletId: wallet.id, currency: 'AED', book: 'CLIENT', closingBalance: 5_000n });
    expect((await runNow()).status).toBe('BREAK');
    const kase = await openCaseFor(wallet.id);
    const disp = await dispositions.record({ caseNo: kase.caseNo, explainedExternalLineId: line.id, matchType: 'ORPHAN_EXTERNAL', causeCode: 'UNEXPLAINED', disposition: 'HOLD_INVESTIGATING', externalDirection: 'IN', findingNote: 'e2e：多出来 50，查不出' } as any, ops());
    await caseAging.simulateTimeout(kase.caseNo, ops()); await agingSweep.checkAgingBreaches(new Date());
    expect((await rowByLine(kase.caseNo, line.id)).nextStep).toEqual({ kind: 'CLIENT_SURPLUS' });
    await expect(adjustments.createDraft({ caseNo: kase.caseNo, reasonCode: 'UNEXPLAINED_CLIENT_LOSS', direction: 'INCREASE', amount: '5000', effectiveDate: kase.businessDate, explainedExternalLineId: line.id, reasonInternal: 'x', reasonCustomer: 'x', dispositionNo: disp.dispositionNo } as any, treasury())).rejects.toThrow(/deposit backfill/);
  });

  it('C2 · 腿失败 → FAILED(LEG_FAILED)、零分录；按钮回来、可重新发起', async () => {
    const { kase, adjustmentNo } = await driveClientLossToCompensationPending('C2');
    const req = await transferWf.initiateCompensation({ adjustmentNo, reason: '认赔' }, treasury());
    const apr = await latestApprovalCase(ApprovalActionTypes.INTERNAL_TRANSFER_APPROVAL, req.transferNo);
    await approvalsService.approve(apr.approvalNo, { reason: 'ok' }, cfo());
    await waitUntil(async () => (await transferRow(req.transferNo)).status === 'EXECUTING');
    const itr = await transferRow(req.transferNo);
    const [leg1] = await fundsOrders.findByParent({ internalTransferId: itr.id }, { legSeq: 1 });
    await fundsOrders.advance(leg1.id, FundsOrderAction.FAIL, 'E2E');
    await waitUntil(async () => (await transferRow(req.transferNo)).status === 'FAILED');
    expect((await transferRow(req.transferNo)).failureReasonCode).toBe('LEG_FAILED');
    expect(await tbEvidence.findBySource('INTERNAL_TRANSFER', req.transferNo)).toHaveLength(0);
    expect((await auditSince('INTERNAL_TRANSFER_FAILED', req.transferNo))[0].reasonCode).toBe('LEG_FAILED');
    const row = await rowByAdjustment(kase.caseNo, adjustmentNo);
    expect(row.transfer).toMatchObject({ transferNo: req.transferNo, status: 'FAILED' });
    expect(row.nextStep?.kind).toBe('COMPENSATION');
    const again = await transferWf.initiateCompensation({ adjustmentNo, reason: '重发' }, treasury());
    expect(again.transferNo).not.toBe(req.transferNo);
  });

  it('C3 · CFO 拒绝 → REJECTED，无资金单无分录，按钮回来', async () => {
    const { kase, adjustmentNo } = await driveClientLossToCompensationPending('C3');
    const req = await transferWf.initiateCompensation({ adjustmentNo, reason: '认赔' }, treasury());
    const apr = await latestApprovalCase(ApprovalActionTypes.INTERNAL_TRANSFER_APPROVAL, req.transferNo);
    await approvalsService.reject(apr.approvalNo, { reason: 'e2e CFO reject' }, cfo());
    await waitUntil(async () => (await transferRow(req.transferNo)).status === 'REJECTED');
    const itr = await transferRow(req.transferNo);
    expect(await fundsOrders.findByParent({ internalTransferId: itr.id })).toHaveLength(0);
    expect(await tbEvidence.findBySource('INTERNAL_TRANSFER', req.transferNo)).toHaveLength(0);
    expect((await auditSince('INTERNAL_TRANSFER_REJECTED', req.transferNo))[0].approvalNo).toBe(apr.approvalNo);
    expect((await rowByAdjustment(kase.caseNo, adjustmentNo)).nextStep?.kind).toBe('COMPENSATION');
  });
});
