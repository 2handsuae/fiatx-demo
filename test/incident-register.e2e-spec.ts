import * as path from 'path';
import * as dotenv from 'dotenv';

// 同 recon-internal-transfer.e2e-spec.ts：Node 18 polyfill（@nestjs/schedule 需要
// globalThis.crypto，Node 19+ 才稳），main.ts 不在本 harness 里跑，这里补一遍。
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

// PrismaService / TigerBeetleService 要在任何其它 import 之前看到本 worktree 的
// DATABASE_URL / TB_ADDRESS（同 recon-internal-transfer.e2e-spec.ts 头注释）。
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { ForbiddenException, INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { DispositionService } from '../src/modules/clearing-settle/reconciliation/disposition/disposition.service';
import { AdjustmentService } from '../src/modules/clearing-settle/reconciliation/disposition/adjustment.service';
import { WalletReconRunService } from '../src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TbEvidenceService } from '../src/modules/accounting/tigerbeetle/tb-evidence.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';
import { bigintToDecimal } from '../src/modules/funds-layer/accounting/tb-amount.util';
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
import { FundsOrderAction, FundsOrderStatus } from '../src/modules/funds-orders/dto/funds-order.dto';
import { DEPOSIT_VERDICT_BUTTONS } from '../src/modules/deposit-sumsub/fixtures/verdict-buttons';
import { fakeBankRef, fakeChainTxHash } from '../src/common/utils/fake-external-refs.util';
import { InternalTransferWorkflowService } from '../src/modules/asset-treasury/internal-transfers/internal-transfer-workflow.service';
import { toBusinessDate } from '../src/modules/accounting/tigerbeetle/utils/business-date.util';
import { IncidentService } from '../src/modules/governance/incidents/incident.service';
import { IncidentRegistrationWorkflowService } from '../src/modules/governance/incidents/incident-registration-workflow.service';
import { IncidentCloseWorkflowService } from '../src/modules/governance/incidents/incident-close-workflow.service';
import { IncidentEscalationTargets, IncidentRemediationKinds, IncidentTypes } from '../src/modules/governance/incidents/incident.constants';

/**
 * 平账三期 · 事故登记（Task 13）e2e：真 AppModule 零 mock，与四份既有 recon e2e 串行
 * （同一 SQLite 库 + 同一 TigerBeetle 实例，见 jest-e2e.json 头注释）。
 *
 * 十段断言对应 task-13-brief.md 的清单：① ~ ⑥ 共用同一条「未授权转出」主链
 * （一个客户、一个案件、一个事故单，状态机严格按登记→调查→（非法结案 400）→
 * 定损→认损补款→结案顺序往前走，故这 6 条 it 共享外层变量、必须按文件顺序跑
 * ——jest 在同一个 describe 内默认按声明顺序串行执行，不并发），⑦~⑨各自独立
 * 建自己的事故/客户，⑩ 是零账务footprint的独立证明。
 *
 * ⚠ 造案手法照抄 test/recon-internal-transfer.e2e-spec.ts（makeActor / waitUntil /
 *   ensureDepositWallet / createIsolatedCustomer / fundCustomerWallet /
 *   ensureWithdrawalAddress / driveLegTransition / verdictArgs* /
 *   makeSuccessfulFiatDeposit / makeSuccessfulFiatWithdraw / provisionCustomerTbAccounts /
 *   createExternalLine / upsertExternalBalance / openCaseFor / caseRow /
 *   waitForSimLines / platformWallet），前缀由 E2E-ITR 改 E2E-INC；截止时间用
 *   「现在」且不跨 UTC 午夜（二期 Task 9 同款约束）。
 */
describe('Incident register e2e (平账三期 · 事故登记, Task 13)', () => {
  jest.setTimeout(120000);
  let app: INestApplication; let prisma: PrismaService;
  let dispositions: DispositionService; let adjustments: AdjustmentService;
  let walletRecon: WalletReconRunService; let approvalsService: ApprovalsService;
  let transferWf: InternalTransferWorkflowService; let fundsOrders: FundsOrderService;
  let tbEvidence: TbEvidenceService; let accounting: AccountingService;
  let signals: InboundTransferSignalsService; let depositWf: DepositWorkflowService; let deposits: DepositTransactionsService;
  let withdrawWf: WithdrawWorkflowService; let withdraws: WithdrawTransactionsService; let withdrawQuoteService: WithdrawQuoteService;
  let depositWallets: CustomerDepositWalletService;
  let incidents: IncidentService; let registrationWorkflow: IncidentRegistrationWorkflowService; let closeWorkflow: IncidentCloseWorkflowService;
  let aedAssetId: string; let aedCode: string; let aedDecimals: number; let aedNetwork: string;
  let usdtAssetId: string; let usdtCode: string; let usdtDecimals: number; let usdtNetwork: string;
  let TODAY: string;
  // 甲波一 T5 连锁修复：assertOperator（经办桶断言，经 AccessControlService.hasPermission
  // 真查 userRole/rolePermission 表）——makeActor 原来的 `uuid-${userNo}` 是纯捏造 id，查不到
  // 任何绑定，会让本文件里所有直调 IncidentService/IncidentCloseWorkflowService 的用例改为
  // 清一色 ForbiddenException。改用 beforeAll 里查到的真种子管理员 id（userNo 仍保留
  // E2E_INC_* 展示串，不影响 registeredByUserId 等既有断言——本文件此前未断言过该字符串，
  // 见 grep 核实）。
  // 战役甲波一 T9（角色改派，T5 遗留）：本文件全程只造 UNAUTHORIZED_OUTFLOW / CLIENT_SHORTFALL
  // 两类（均属 FUNDS 族，operatorGroup=INCIDENT_WRITE），T9 前 INCIDENT_WRITE 已随两角色定案
  // （2026-09-10）整体迁到 TREASURY_OFFICER，OPS_OFFICER 早不持有——原来那个按 OPS_OFFICER
  // 造 actor 的工厂函数从写下那天起就没对上真实持有人，故全文件改派 treasury()，原
  // opsUserId 与那个工厂函数随之删除（不留孤儿）。
  let cfoUserId: string; let mlroUserId: string; let treasuryUserId: string;
  const cfo = () => makeActor(cfoUserId, 'E2E_INC_CFO', 'CFO');
  const mlro = () => makeActor(mlroUserId, 'E2E_INC_MLRO', 'MLRO');
  const treasury = () => makeActor(treasuryUserId, 'E2E_INC_TREASURY', 'TREASURY_OFFICER');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();
    prisma = app.get(PrismaService);
    dispositions = app.get(DispositionService); adjustments = app.get(AdjustmentService);
    walletRecon = app.get(WalletReconRunService); approvalsService = app.get(ApprovalsService);
    transferWf = app.get(InternalTransferWorkflowService); fundsOrders = app.get(FundsOrderService);
    tbEvidence = app.get(TbEvidenceService); accounting = app.get(AccountingService);
    signals = app.get(InboundTransferSignalsService); depositWf = app.get(DepositWorkflowService); deposits = app.get(DepositTransactionsService);
    withdrawWf = app.get(WithdrawWorkflowService); withdraws = app.get(WithdrawTransactionsService); withdrawQuoteService = app.get(WithdrawQuoteService);
    depositWallets = app.get(CustomerDepositWalletService);
    incidents = app.get(IncidentService); registrationWorkflow = app.get(IncidentRegistrationWorkflowService); closeWorkflow = app.get(IncidentCloseWorkflowService);
    TODAY = toBusinessDate(new Date());
    const aed = await (prisma as any).asset.findFirst({ where: { currency: 'AED' } });
    const usdt = await (prisma as any).asset.findFirst({ where: { currency: 'USDT' } });
    if (!aed?.tbLedgerId || !usdt?.tbLedgerId) throw new Error('Fixture assets AED/USDT not seeded — run `bash scripts/stack.sh reset self` first.');
    // 甲波一 T5 连锁修复：真查种子管理员 id（CFO/MLRO/TREASURY_OFFICER 三个邮箱——T9 修1
    // 起 OPS_OFFICER 已随 ops() 工厂一并删除，见上方 T9 注释），供上面三个 makeActor(...)
    // 工厂用——assertOperator 走的是真 DB 查询，捏造 id 查不到组。
    const [cfoUser, mlroUser, treasuryUser] = await Promise.all([
      (prisma as any).user.findFirst({ where: { email: 'cfo@fiatx.com' } }),
      (prisma as any).user.findFirst({ where: { email: 'mlro@fiatx.com' } }),
      (prisma as any).user.findFirst({ where: { email: 'treasury@fiatx.com' } }),
    ]);
    if (!cfoUser || !mlroUser || !treasuryUser) throw new Error('Fixture role-seed admins (CFO/MLRO/TREASURY_OFFICER) not seeded — run `bash scripts/stack.sh reset self` first.');
    cfoUserId = cfoUser.id; mlroUserId = mlroUser.id; treasuryUserId = treasuryUser.id;
    aedAssetId = aed.id; aedCode = aed.code; aedDecimals = aed.decimals; aedNetwork = aed.network;
    usdtAssetId = usdt.id; usdtCode = usdt.code; usdtDecimals = usdt.decimals; usdtNetwork = usdt.network;
  });
  afterAll(async () => { if (app) await app.close(); });

  // ── helpers（照抄 test/recon-internal-transfer.e2e-spec.ts，前缀 E2E-ITR → E2E-INC）──

  function makeActor(userId: string, userNo: string, role: string): ApprovalActorContext {
    return { actorType: 'ADMIN', userId, userNo, role, roleCodes: [role] };
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

  async function ensureDepositWallet(customerId: string, network: string): Promise<any> {
    return depositWallets.createOrReturn(customerId, network);
  }

  async function createIsolatedCustomer(tag: string): Promise<{ id: string; customerNo: string }> {
    const customer = await (prisma as any).customerMain.create({
      data: { customerNo: `CU-E2E-INC-${tag}-${randomUUID().slice(0, 8)}`, lifecycle: 'ACTIVE' },
      select: { id: true, customerNo: true },
    });
    await provisionCustomerTbAccounts(customer.id, customer.customerNo);
    const iban = `AE-E2E-INC-WDADDR-${customer.customerNo}`;
    await ensureWithdrawalAddress({
      customerId: customer.id, customerNo: customer.customerNo,
      addressType: 'BANK', network: aedNetwork, address: iban, iban,
    });
    return customer;
  }

  async function fundCustomerWallet(opts: {
    walletId: string; ownerId: string; assetId: string; ledger: number; currency: string; amount: bigint; tag: string;
    externalRef?: string; crossing?: boolean; effectiveDate?: string;
  }): Promise<string> {
    const sourceNo = `E2E-INC-FUND-${opts.tag}-${randomUUID().slice(0, 8)}`;

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
        memo: 'e2e fixture: pre-fund customer balance for incident-register tests (Step 1)',
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
        memo: 'e2e fixture: pre-fund customer balance for incident-register tests (Step 2)',
        debitWalletRef: opts.walletId, creditWalletRef: opts.walletId,
        isExternalCrossing: false,
        ...(opts.effectiveDate ? { effectiveDate: opts.effectiveDate } : {}),
      },
    });

    return sourceNo;
  }

  function decimalToBigint(decimalValue: string, decimals: number): bigint {
    const [whole, frac = ''] = decimalValue.split('.');
    const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + paddedFrac);
  }

  async function ensureWithdrawalAddress(opts: {
    customerId: string; customerNo: string; addressType: string; network: string; address: string; iban?: string;
  }): Promise<void> {
    const existing = await (prisma as any).withdrawalAddress.findFirst({
      where: { customerId: opts.customerId, network: opts.network, address: opts.address, status: 'ACTIVE' },
    });
    if (existing) return;
    await (prisma as any).withdrawalAddress.create({
      data: {
        addressNo: `WAD-E2E-INC-${opts.addressType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        customerId: opts.customerId, customerNo: opts.customerNo, network: opts.network,
        address: opts.address, addressType: opts.addressType, iban: opts.iban ?? null,
        ownershipDeclaredAt: new Date(), ownershipProofType: 'E2E_FIXTURE',
        status: 'ACTIVE', activatesAt: new Date(Date.now() - 1000),
        traceId: `e2e-incident-register-address-${opts.addressType}`,
      },
    });
  }

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
  function verdictArgs(outcome: 'approved' | 'rejected' | 'awaitUser' | 'onHold') {
    const buttonKey = Object.keys(DEPOSIT_VERDICT_BUTTONS).find(
      (k) => VERDICT_BY_WEBHOOK_TYPE[(DEPOSIT_VERDICT_BUTTONS as any)[k].webhookType] === outcome,
    );
    if (!buttonKey) throw new Error(`no deposit verdict button maps to outcome ${outcome}`);
    return verdictArgsForButton(buttonKey);
  }

  async function makeSuccessfulFiatDeposit(amount: string, customerId: string, customerNo: string): Promise<{ deposit: any; wallet: { id: string } }> {
    void customerNo;
    const wallet = await ensureDepositWallet(customerId, aedNetwork);
    const referenceNo = `E2E-INC-DEP-${randomUUID().slice(0, 12)}`;
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

  async function makeSuccessfulFiatWithdraw(amount: string, customer: { id: string; customerNo: string }, toIban: string): Promise<any> {
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

  async function provisionCustomerTbAccounts(customerId: string, customerNo: string): Promise<void> {
    await accounting.createAccounts([
      { code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger: TB_LEDGERS.AED, ownerType: 'CUSTOMER', ownerUuid: customerId, ownerNo: customerNo, assetCurrency: 'AED', description: 'e2e fixture customer CLIENT_PAYABLE' },
      { code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger: TB_LEDGERS.AED, ownerType: 'CUSTOMER', ownerUuid: customerId, ownerNo: customerNo, assetCurrency: 'AED', description: 'e2e fixture customer DEPOSIT_SUSPENSE' },
      { code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger: TB_LEDGERS.USDT, ownerType: 'CUSTOMER', ownerUuid: customerId, ownerNo: customerNo, assetCurrency: 'USDT', description: 'e2e fixture customer CLIENT_PAYABLE (USDT)' },
      { code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger: TB_LEDGERS.USDT, ownerType: 'CUSTOMER', ownerUuid: customerId, ownerNo: customerNo, assetCurrency: 'USDT', description: 'e2e fixture customer DEPOSIT_SUSPENSE (USDT)' },
    ]);
  }

  const runNow = () => walletRecon.run({ cutoff: new Date() });

  async function createExternalLine(opts: { walletId: string; currency: string; book: 'CLIENT' | 'FIRM'; direction: 'IN' | 'OUT'; amount: bigint; externalRef: string; description?: string; source?: 'ZAND' | 'HEXTRUST' }): Promise<{ id: string }> {
    return (prisma as any).externalStatementLine.create({
      data: { source: opts.source ?? 'ZAND', accountRef: opts.walletId, subAccount: opts.walletId, book: opts.book, currency: opts.currency, direction: opts.direction, amount: opts.amount.toString(), externalRef: opts.externalRef, datetime: new Date(), description: opts.description ?? 'Incoming', dedupKey: `E2E-INC-${randomUUID()}` },
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
  const platformWallet = (vault: 'F_OPS' | 'F_SET', network: string) => (prisma as any).wallet.findFirst({ where: { vaultCode: vault, network, ownerType: 'PLATFORM', status: 'ACTIVE' } });
  async function waitForSimLines(fundsOrderNo: string, walletIds: string[]): Promise<void> {
    await waitUntil(async () => (await (prisma as any).externalStatementLine.count({ where: { dedupKey: { in: walletIds.map((w) => `SIM-${fundsOrderNo}-${w}`) } } })) === walletIds.length);
  }

  // ── 主链共享状态（① ~ ⑥ 一个客户 / 一个案件 / 一个事故单，按文件顺序推进）──

  let mainCustomer: { id: string; customerNo: string };
  let mainWallet: { id: string };
  let mainCaseNo: string;
  let mainCaseId: string;
  let mainDispositionNo: string;
  let mainIncidentNo: string;
  let mainAssessedAmountMajor: string;
  let mainAdjustmentNo: string;
  let mainCompensationTransferNo: string;

  const FUND_AMOUNT_MINOR = 2_000_000_000n; // 主链初始 USDT 内部余额
  const LOSS_MINOR = 25_000_000n;           // 未授权转出走丢的金额

  // ── scenarios ────────────────────────────────────────────────────────────

  it('1 · 造未授权转出破口 → 定性 UNAUTHORIZED_OUTFLOW → 定性行 outlet===INCIDENT → 登记事故（金库）→ 定性行 incidentNo 写回、案子照旧 OPEN', async () => {
    mainCustomer = await createIsolatedCustomer('MAIN');
    mainWallet = await ensureDepositWallet(mainCustomer.id, usdtNetwork);
    const outflowRef = `0xe2einc${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await fundCustomerWallet({
      walletId: mainWallet.id, ownerId: mainCustomer.id, assetId: usdtAssetId, ledger: TB_LEDGERS.USDT,
      currency: 'USDT', amount: FUND_AMOUNT_MINOR, tag: 'MAIN',
    });
    // 未授权转出：外部托管方对账单出现一笔我方毫无内部记录的转出（外有我无 · OUT）。
    const outLine = await createExternalLine({
      walletId: mainWallet.id, currency: usdtCode, book: 'CLIENT', direction: 'OUT',
      amount: LOSS_MINOR, externalRef: outflowRef, source: 'HEXTRUST', description: 'Unrecognized outbound transfer',
    });
    await upsertExternalBalance({
      walletId: mainWallet.id, currency: usdtCode, book: 'CLIENT',
      closingBalance: FUND_AMOUNT_MINOR - LOSS_MINOR, source: 'HEXTRUST',
    });
    expect((await runNow()).status).toBe('BREAK');

    const kase = await openCaseFor(mainWallet.id);
    expect(kase.book).toBe('CUSTOMER');
    mainCaseNo = kase.caseNo; mainCaseId = kase.id;

    const disp = await dispositions.record({
      caseNo: mainCaseNo,
      matchType: 'ORPHAN_EXTERNAL', explainedExternalLineId: outLine.id,
      causeCode: 'UNAUTHORIZED_OUTFLOW', disposition: 'INCIDENT', externalDirection: 'OUT',
      findingNote: 'e2e：外部托管方对账单出现一笔我方无任何内部记录的转出，疑似盗转',
    } as any, treasury());
    expect(disp.outlet).toBe('INCIDENT');
    mainDispositionNo = disp.dispositionNo;

    const reg = await registrationWorkflow.register({
      type: IncidentTypes.UNAUTHORIZED_OUTFLOW, title: '疑似未授权转出',
      description: '外部托管方对账单显示一笔转出，我方无任何内部记录',
      sourceCaseNo: mainCaseNo, sourceDispositionNo: mainDispositionNo,
    } as any, treasury());
    mainIncidentNo = reg.incidentNo;
    expect(mainIncidentNo).toMatch(/^INC/);

    const dispRow = await (prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo: mainDispositionNo } });
    expect(dispRow.incidentNo).toBe(mainIncidentNo);
    expect((await caseRow(mainCaseId)).status).toBe('OPEN');
  });

  it('2 · 调查 → 两条 note + 一条升级（MLRO）→ 时间线可读', async () => {
    const started = await incidents.startInvestigation(mainIncidentNo, treasury());
    expect(started.status).toBe('INVESTIGATING');
    await incidents.addNote(mainIncidentNo, '核对托管方转账记录，暂未定位收款地址归属', treasury());
    await incidents.addNote(mainIncidentNo, '已联系托管方 HexTrust 索取交易签名信息', treasury());
    await incidents.escalate(mainIncidentNo, { to: IncidentEscalationTargets.MLRO, note: '涉嫌盗转，升级 MLRO 关注' }, treasury());

    const view = await incidents.getView(mainIncidentNo);
    expect(view.status).toBe('INVESTIGATING');
    expect(view.notes.map((n: any) => n.kind)).toEqual(['NOTE', 'NOTE', 'ESCALATION']);
    expect(view.notes[0].body).toBe('核对托管方转账记录，暂未定位收款地址归属');
    expect(view.notes[1].body).toBe('已联系托管方 HexTrust 索取交易签名信息');
    expect(view.notes[2]).toMatchObject({ kind: 'ESCALATION', escalatedTo: 'MLRO', body: '涉嫌盗转，升级 MLRO 关注' });
  });

  it('3 · REGISTERED/INVESTIGATING 状态下 close → 400（变异靶子①的 e2e 面）', async () => {
    expect((await incidents.findByNo(mainIncidentNo)).status).toBe('INVESTIGATING');
    await expect(closeWorkflow.requestClose(mainIncidentNo, treasury())).rejects.toThrow(/close cannot be requested/);
    // 拒绝是纯校验、不落库：状态原地不动。
    expect((await incidents.findByNo(mainIncidentNo)).status).toBe('INVESTIGATING');
  });

  it('4 · 定损 FIRM_LOSS + 需通报（TIR_K_H + CRM_V_D_2）→ reportDeadlineAt===createdAt+72h（变异靶子②的 e2e 面）；草案 → 标已通报', async () => {
    const before = await incidents.findByNo(mainIncidentNo);
    mainAssessedAmountMajor = bigintToDecimal(LOSS_MINOR, usdtDecimals).toFixed(usdtDecimals);

    const assessed = await incidents.assess(mainIncidentNo, {
      assessedAmount: mainAssessedAmountMajor, assessmentBasis: 'FIRM_LOSS',
      reportRequired: true, reportBasisCodes: ['TIR_K_H', 'CRM_V_D_2'],
    } as any, treasury());
    expect(assessed.status).toBe('ASSESSED');

    // TIR_K_H 有钟（72h）、CRM_V_D_2 无钟（null）——deadline 取有钟依据的 min，锚在
    // 登记时刻（before.createdAt），不是定损时刻。
    const expectedDeadline = new Date(before.createdAt.getTime() + 72 * 3600 * 1000);
    expect(assessed.reportDeadlineAt).not.toBeNull();
    expect(assessed.reportDeadlineAt!.getTime()).toBe(expectedDeadline.getTime());

    await incidents.saveReportDraft(mainIncidentNo, '事件时间线与影响范围说明（草案）：托管方转出未经授权，已定损 25 USDT。', treasury());
    await incidents.markReported(mainIncidentNo, { reference: 'VARA-REG-2026-001' }, treasury());

    const view = await incidents.getView(mainIncidentNo);
    expect(view.reportedAt).not.toBeNull();
    expect(view.reportReference).toBe('VARA-REG-2026-001');
    expect(view.reportDraft).toContain('托管方转出未经授权');
  });

  it('5 · 认损调账（金库开、金额=定损额、CFO 批、落账）→ 补款（adjustmentNo 通道、CFO 批、⚡ 推腿到 SUCCESS）→ 重对账案愈 → 挂载两单到事故', async () => {
    // ① 认损调账：锚在事故定性行上，金额锁定为定损额（最小单位）。
    const adjDto = {
      caseNo: mainCaseNo, reasonCode: 'UNEXPLAINED_CLIENT_LOSS', direction: 'REDUCE',
      amount: LOSS_MINOR.toString(), effectiveDate: (await caseRow(mainCaseId)).businessDate,
      explainedExternalLineId: (await (prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo: mainDispositionNo } })).explainedExternalLineId,
      reasonInternal: 'e2e 未授权转出事故认损：公司承损', reasonCustomer: '平台调整',
      dispositionNo: mainDispositionNo,
    };
    const { adjustmentNo } = await adjustments.createDraft(adjDto as any, treasury());
    mainAdjustmentNo = adjustmentNo;
    await adjustments.submit(mainAdjustmentNo, treasury());
    const apr = await latestApprovalCase(ApprovalActionTypes.RECON_ADJUSTMENT_POST, mainAdjustmentNo);
    expect(JSON.parse(apr.objectSnapshot).impact).toContain(mainIncidentNo);
    await approvalsService.approve(apr.approvalNo, { reason: 'e2e CFO approve incident loss' }, cfo());
    await waitUntil(async () => (await adjRow(mainAdjustmentNo)).status === 'POSTED');

    const ev = await tbEvidence.findBySource('RECON_ADJUSTMENT', mainAdjustmentNo);
    expect(ev[0].debitCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE]);
    expect(ev[0].creditCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET]);
    expect((await accounting.getCustomerAvailableBalance(mainCustomer.id, 'USDT')).available).toBe(FUND_AMOUNT_MINOR - LOSS_MINOR);

    // 内部已经等于外部：重对账，案子愈。
    await runNow();
    expect((await caseRow(mainCaseId)).status).toBe('RESOLVED');

    // ② 补款：公司认赔，走 initiateCompensation → CFO 批 → ⚡ 提交腿 → ⚡ 确认 → SUCCESS。
    const req = await transferWf.initiateCompensation({ adjustmentNo: mainAdjustmentNo, reason: '公司认赔未授权转出' }, treasury());
    mainCompensationTransferNo = req.transferNo;
    await approvalsService.approve(req.approvalNo, { reason: 'e2e CFO approve compensation' }, cfo());
    await waitUntil(async () => (await transferRow(mainCompensationTransferNo)).status === 'EXECUTING');
    const itr = await transferRow(mainCompensationTransferNo);
    const opsW = await platformWallet('F_OPS', usdtNetwork);
    const [leg1] = await fundsOrders.findByParent({ internalTransferId: itr.id }, { legSeq: 1 });
    expect([leg1.fromWalletId, leg1.toWalletId]).toEqual([opsW.id, mainWallet.id]);
    await fundsOrders.advance(leg1.id, FundsOrderAction.SUBMIT, 'E2E');
    await waitForSimLines(leg1.fundsOrderNo, [opsW.id, mainWallet.id]);
    await fundsOrders.advance(leg1.id, FundsOrderAction.OBSERVE_CONFIRMING, 'E2E');
    await fundsOrders.advance(leg1.id, FundsOrderAction.CONFIRM, 'E2E');
    await waitUntil(async () => (await transferRow(mainCompensationTransferNo)).status === 'SUCCESS');
    expect((await accounting.getCustomerAvailableBalance(mainCustomer.id, 'USDT')).available).toBe(FUND_AMOUNT_MINOR);

    // ③ 挂载两单到事故：ADJUSTMENT 先挂（ASSESSED → RESOLVING 自动迁移），TRANSFER 后挂（原地 RESOLVING）。
    expect((await incidents.findByNo(mainIncidentNo)).status).toBe('ASSESSED');
    await incidents.linkRemediation(mainIncidentNo, { kind: IncidentRemediationKinds.ADJUSTMENT, referenceNo: mainAdjustmentNo } as any, treasury());
    expect((await incidents.findByNo(mainIncidentNo)).status).toBe('RESOLVING');
    await incidents.linkRemediation(mainIncidentNo, { kind: IncidentRemediationKinds.TRANSFER, referenceNo: mainCompensationTransferNo } as any, treasury());
    expect((await incidents.findByNo(mainIncidentNo)).status).toBe('RESOLVING');

    const view = await incidents.getView(mainIncidentNo);
    expect(view.remediations.map((r: any) => r.referenceNo).sort()).toEqual([mainAdjustmentNo, mainCompensationTransferNo].sort());
  });

  it('6 · 提结案 → 审批类型 INCIDENT_CLOSE_SECURITY；MLRO 未批时 CFO 批不动；MLRO 批 → CFO 批 → 事故 CLOSED', async () => {
    const closeReq = await closeWorkflow.requestClose(mainIncidentNo, treasury());
    expect(closeReq.approvalNo).toBeTruthy();
    const apr = await (prisma as any).approvalCase.findFirst({ where: { approvalNo: closeReq.approvalNo } });
    expect(apr.actionType).toBe(ApprovalActionTypes.INCIDENT_CLOSE_SECURITY);

    // CFO 先批：不是当前 pending 步骤（step1=MLRO）的候选人 → 403，事故原地不动。
    await expect(approvalsService.approve(closeReq.approvalNo, { reason: 'wrong order' }, cfo())).rejects.toBeInstanceOf(ForbiddenException);
    expect((await incidents.findByNo(mainIncidentNo)).status).toBe('RESOLVING');

    // MLRO 批 step1：案子仍 PENDING（还有 step2），事故仍未 CLOSED。
    await approvalsService.approve(closeReq.approvalNo, { reason: 'MLRO ok' }, mlro());
    expect((await incidents.findByNo(mainIncidentNo)).status).toBe('RESOLVING');

    // CFO 批 step2（末票）→ 案子 APPROVED → workflow.incident.decided → 事故 CLOSED。
    await approvalsService.approve(closeReq.approvalNo, { reason: 'CFO final' }, cfo());
    await waitUntil(async () => (await incidents.findByNo(mainIncidentNo)).status === 'CLOSED');
    const closed = await incidents.findByNo(mainIncidentNo);
    expect(closed.closedAt).not.toBeNull();
  });

  it('7 · 权限探针：金库能登记不能裁决（403）；CFO 无 INCIDENT_WRITE 提不了结案（403，自批死锁不存在的行为证明）', async () => {
    const server = app.getHttpServer();
    async function loginAdmin(email: string): Promise<string> {
      const res = await request(server).post('/auth/login').send({ email, password: '123456' });
      if (!res.body?.access_token) throw new Error(`login ${email} failed: ${JSON.stringify(res.body)}`);
      return res.body.access_token as string;
    }
    const treasuryToken = await loginAdmin('treasury@fiatx.com');
    const cfoToken = await loginAdmin('cfo@fiatx.com');

    // 金库持 INCIDENT_WRITE（两角色定案 2026-09-10 起，FUNDS 族经办组）——真实 HTTP 走真实
    // RBAC 闸，登记成功。MANUAL 已于甲波一 T2 退役，改用最简单的存量类型（CLIENT_SHORTFALL
    // 只需 customerNo+amount）。
    const regRes = await request(server).post('/admin/incidents')
      .set('Authorization', `Bearer ${treasuryToken}`)
      .send({ type: 'CLIENT_SHORTFALL', title: 'e2e 权限探针：金库登记', description: '验证金库能登记但不能裁决自己开的结案单', customerNo: 'E2E-PROBE-CUST', amount: '1' });
    expect(regRes.status).toBe(201);
    const probeIncidentNo = regRes.body.incidentNo as string;
    expect(probeIncidentNo).toMatch(/^INC/);

    // 铺垫（走服务方法，不是本条断言的对象）：推到可结案态，提交结案。
    await incidents.startInvestigation(probeIncidentNo, treasury());
    await incidents.assess(probeIncidentNo, { assessedAmount: '0', assessmentBasis: 'NO_LOSS', reportRequired: false } as any, treasury());
    const closeReq = await closeWorkflow.requestClose(probeIncidentNo, treasury());

    // 金库拿着 GOV_APPROVAL_READ 能点到 approve 端点，但角色不在候选人里（CLIENT_SHORTFALL→INCIDENT_CLOSE_FINANCIAL→单步 CFO）——403。
    const treasuryDecideRes = await request(server)
      .post(`/admin/control-gates/approvals/${closeReq.approvalNo}/approve`)
      .set('Authorization', `Bearer ${treasuryToken}`)
      .send({ reason: 'treasury 尝试裁决自己开的结案单' });
    expect(treasuryDecideRes.status).toBe(403);
    expect((await incidents.findByNo(probeIncidentNo)).status).not.toBe('CLOSED');

    // M1 修准（T9 修1）：CFO 持 INCIDENT_FIN_WRITE（T9 绑定），route 层五桶 OR 放行，能
    // 进控制器；真正挡它的是 IncidentCloseWorkflowService.requestClose() 里的
    // IncidentService.assertOperator（服务层门，见 incident.service.ts）——这张探针是
    // CLIENT_SHORTFALL（FUNDS 族，需 cap.incident.funds），CFO 只持 cap.incident.fin，
    // 家族不对，403 在服务层而非守卫层。
    // 「开结案单的人」与「批结案单的人」角色互斥，证明自批死锁不存在。
    const cfoCloseRes = await request(server)
      .post(`/admin/incidents/${probeIncidentNo}/close`)
      .set('Authorization', `Bearer ${cfoToken}`)
      .send({});
    expect(cfoCloseRes.status).toBe(403);
  });

  it('8 · CLIENT_SHORTFALL 登记（MANUAL 已于甲波一 T2 退役，改用最简单的存量类型）→ 撤回（必填理由）→ WITHDRAWN', async () => {
    const reg = await registrationWorkflow.register({
      type: IncidentTypes.CLIENT_SHORTFALL, title: '误登记的对账观察', description: '金库手滑，实际是正常波动，登记后即撤回',
      customerNo: 'E2E-WD-CUST', amount: '1',
    } as any, treasury());
    await expect(incidents.withdraw(reg.incidentNo, '', treasury())).rejects.toThrow(/Withdrawal requires a reason/);
    const wd = await incidents.withdraw(reg.incidentNo, '经复核，属误报，无实际事故', treasury());
    expect(wd.status).toBe('WITHDRAWN');
    const row = await incidents.findByNo(reg.incidentNo);
    expect(row.withdrawnReason).toBe('经复核，属误报，无实际事故');
  });

  it('9 · CLIENT_SHORTFALL：带垫款单号登记 → 锚定校验（purpose===\'CLIENT_ADVANCE\'）', async () => {
    const cust = await createIsolatedCustomer('SHORT');
    const iban = `AE-E2E-INC-WDADDR-${cust.customerNo}`;
    await makeSuccessfulFiatDeposit('1200', cust.id, cust.customerNo);
    const w = await makeSuccessfulFiatWithdraw('900', cust, iban); // 净 898 + 费 2 出去；账上剩 300
    expect(w.status).toBe('SUCCESS');
    const wallet = await ensureDepositWallet(cust.id, aedNetwork);
    const claw = `E2E-INC-CLAW-${randomUUID()}`;
    const line = await createExternalLine({ walletId: wallet.id, currency: 'AED', book: 'CLIENT', direction: 'OUT', amount: 120_000n, externalRef: claw, description: 'Return' });
    await upsertExternalBalance({ walletId: wallet.id, currency: 'AED', book: 'CLIENT', closingBalance: 30_000n - 120_000n }); // 300 − 1200 = −900
    expect((await runNow()).status).toBe('BREAK');
    const kase = await openCaseFor(wallet.id);
    const disp = await dispositions.record({
      caseNo: kase.caseNo,
      explainedExternalLineId: line.id, matchType: 'ORPHAN_EXTERNAL', causeCode: 'BOUNCED_FUNDS',
      disposition: 'SUPPLEMENT', externalDirection: 'OUT', findingNote: 'e2e：银行撤回，客户已花掉一部分',
    } as any, treasury());
    expect(disp.deferredTarget).toBe('SUPPLEMENT_BOUNCE');

    // 真造一张垫款单（purpose 天然是 CLIENT_ADVANCE），不落地到 SUCCESS——锚定校验只看 purpose。
    const advance = await transferWf.initiateAdvance({ caseNo: kase.caseNo, externalLineId: line.id, reason: '先垫后扣' }, treasury());
    expect((await transferRow(advance.transferNo)).purpose).toBe('CLIENT_ADVANCE');

    // 负例：锚一张真实存在、但 purpose 不是垫款单的划转单（步骤⑤的补款单）→ 拒绝。
    await expect(incidents.register({
      type: IncidentTypes.CLIENT_SHORTFALL, title: '客户欠款登记（负例）', description: '锚定一张非垫款单，验证拒绝',
      customerNo: cust.customerNo, amount: '900', sourceAdvanceTransferNo: mainCompensationTransferNo,
    } as any, treasury())).rejects.toThrow(/not an advance transfer/);

    // 正例：锚定真实垫款单，登记成功。
    const reg = await registrationWorkflow.register({
      type: IncidentTypes.CLIENT_SHORTFALL, title: '客户欠款登记', description: '银行撤回导致客户余额透支，垫款追索中',
      customerNo: cust.customerNo, amount: '900', sourceAdvanceTransferNo: advance.transferNo,
    } as any, treasury());
    expect(reg.incidentNo).toMatch(/^INC/);
    const view = await incidents.getView(reg.incidentNo);
    expect(view.sourceAdvanceTransferNo).toBe(advance.transferNo);
    expect(view.customerNo).toBe(cust.customerNo);
  });

  it('10 · 全程 verify:coa 口径：事故动作前后账本零变化（登记/调查/定损/结案零过账——用既有余额查询接口）', async () => {
    const cust = await createIsolatedCustomer('BAL');
    const wallet = await ensureDepositWallet(cust.id, usdtNetwork);
    await fundCustomerWallet({
      walletId: wallet.id, ownerId: cust.id, assetId: usdtAssetId, ledger: TB_LEDGERS.USDT,
      currency: 'USDT', amount: 500_000_000n, tag: 'BAL',
    });
    const available = async () => (await accounting.getCustomerAvailableBalance(cust.id, 'USDT')).available;
    const before = await available();
    expect(before).toBe(500_000_000n);

    const reg = await registrationWorkflow.register({
      // MANUAL 已于甲波一 T2 退役，改用最简单的存量类型（CLIENT_SHORTFALL 只需 customerNo+amount）。
      type: IncidentTypes.CLIENT_SHORTFALL, title: '零账务验证', description: '验证事故登记与调查动作不触碰账本',
      customerNo: cust.customerNo, amount: '0',
    } as any, treasury());
    expect(await available()).toBe(before);

    await incidents.startInvestigation(reg.incidentNo, treasury());
    expect(await available()).toBe(before);
    await incidents.addNote(reg.incidentNo, '排查中，暂无资金异动', treasury());
    expect(await available()).toBe(before);
    await incidents.escalate(reg.incidentNo, { to: IncidentEscalationTargets.MLRO, note: '知会 MLRO' }, treasury());
    expect(await available()).toBe(before);

    await incidents.assess(reg.incidentNo, { assessedAmount: '0', assessmentBasis: 'NO_LOSS', reportRequired: false } as any, treasury());
    expect(await available()).toBe(before);

    const closeReq = await closeWorkflow.requestClose(reg.incidentNo, treasury());
    expect(await available()).toBe(before);
    await approvalsService.approve(closeReq.approvalNo, { reason: 'e2e CFO approve NO_LOSS close' }, cfo());
    await waitUntil(async () => (await incidents.findByNo(reg.incidentNo)).status === 'CLOSED');
    expect(await available()).toBe(before);
  });
});
