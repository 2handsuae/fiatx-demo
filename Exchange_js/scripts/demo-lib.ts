// scripts/demo-lib.ts
//
// Shared library for the demo transaction-data layer.
// Spec: doc-final/superpowers/specs/2026-06-21-demo-transaction-data-layer-design.md
//
// Drives the REAL domain/workflow services (no Prisma backdoors — same path as a
// human clicking in admin) to produce a reproducible day of business activity for
// the tradeable business-seed customers (Alice/Bob/Grace):
//   setup → deposits → swaps → withdrawals.
// A 4th persona (Frank, FROZEN_PERSONA_EMAIL) is set up and deposited-into
// alongside them but deliberately never trades — the roster permanently
// sanctions him (⚡⑦ FROZEN → SEIZED), which must not land on anyone who still
// needs to swap/withdraw later in the same run. See resolveFrozenPersona.
//
// End-state (after runAll): all orders SUCCESS; both COA invariants (CLIENT + FIRM)
// hold per ledger; no Outstanding or FeeAccrual rows created (real-time 1:1 model).
// verifyEndState() asserts this.

// Node18 polyfill: @nestjs/schedule calls crypto.randomUUID() at module-register
// time. Must run before any import that pulls AppModule.
import { webcrypto, createHash } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { fakeChainTxHash, fakeBankRef } from '../src/common/utils/fake-external-refs.util';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';
import { DepositTransactionsService } from '../src/modules/trading/deposit-transactions/deposit-transactions.service';
import { DepositWorkflowService } from '../src/modules/trading/deposit-transactions/deposit-workflow.service';
import { FundsOrderService } from '../src/modules/funds-orders/funds-order.service';
import { FundsOrderAction } from '../src/modules/funds-orders/dto/funds-order.dto';
import { DEPOSIT_VERDICT_BUTTONS } from '../src/modules/deposit-sumsub/fixtures/verdict-buttons';
import { SCENE_TAGS, DISPO_TAGS_BY_DOMAIN, type SceneTag, type DispoTag } from '../src/modules/sumsub-shared/scene-tags';
import { DEMO_ROSTER } from './demo-roster';
import { loginAsMlro, loginAsSmo, loginAsOpsOfficer, approveApproval } from './demo-mlro';

// Deposit channel discriminator (crypto vs fiat) — the legacy PayinType enum is gone;
// the funds_order path only needs this literal to pick refs + the crypto drive.
const PayinType = { CRYPTO: 'CRYPTO', FIAT: 'FIAT' } as const;
type PayinType = (typeof PayinType)[keyof typeof PayinType];
import { SwapQuoteService } from '../src/modules/trading/swap-fee-level/swap-quote.service';
import { SwapWorkflowService } from '../src/modules/trading/swap-transactions/swap-workflow.service';
import { WithdrawQuoteService } from '../src/modules/trading/withdrawal-fee-level/withdraw-quote.service';
import { WithdrawTransactionsService } from '../src/modules/trading/withdraw-transactions/withdraw-transactions.service';
import { WithdrawWorkflowService } from '../src/modules/trading/withdraw-transactions/withdraw-workflow.service';
import { ensureTbAccountRegistry, provisionTbAccounts } from '../prisma/seed-tb.helper';
import { buildDeterministicNo } from '../src/common/utils/no-generator.util';

// ── constants ────────────────────────────────────────────────────────────────
export const SIM = 'DEMO'; // deterministic-no tag + operatorId for driven legs

// Tradeable business-seed customers (onboarding APPROVED + compliance CLEAR).
// Order matters: index → deterministic refs/addresses.
export const DEMO_CUSTOMER_EMAILS = [
  'demo_alice@example.com',
  'demo_bob@example.com',
  'demo_grace@example.com',
] as const;

// 4th persona (see scripts/demo-roster.ts's FRANK const for the full why):
// the roster permanently sanctions this customer (customer-level SANCTION
// restriction, no release path in this codebase — deposit/withdraw/swap
// workflows only listen for CUSTOMER_RESTRICTION_OPENED). That is incompatible
// with the trio above, which SWAP_PLAN/WITHDRAW_PLAN and
// resolveDemoCustomers's tradeable-or-throw check require to stay tradeable
// start-to-finish, so this identity is deliberately kept OUT of
// DEMO_CUSTOMER_EMAILS and resolved separately via resolveFrozenPersona (no
// tradeability assertion — becoming untradeable mid-run is the point).
export const FROZEN_PERSONA_EMAIL = 'demo_frank@example.com';

// Swap plan: deliberate 2×(USDT→AED) vs 1×(smaller AED→USDT) asymmetry guarantees
// FIRM_OPS(AED) and FIRM_OPS(USDT) both move meaningfully — not an accidental ~0.
export const SWAP_PLAN: Record<string, { dir: 'USDT_AED' | 'AED_USDT'; amount: number }> = {
  'demo_alice@example.com': { dir: 'USDT_AED', amount: 1000 },
  'demo_bob@example.com': { dir: 'USDT_AED', amount: 800 },
  'demo_grace@example.com': { dir: 'AED_USDT', amount: 500 },
};

// Withdraw plan: everyone a fiat AED withdraw; Alice/Bob also a crypto USDT one.
export const WITHDRAW_PLAN: Record<string, { fiatAed: number; cryptoUsdt?: number }> = {
  'demo_alice@example.com': { fiatAed: 100, cryptoUsdt: 50 },
  'demo_bob@example.com': { fiatAed: 100, cryptoUsdt: 50 },
  'demo_grace@example.com': { fiatAed: 100 },
};

// Non-zero fees so FEE_INCOME / SPREAD_INCOME actually populate ("data must be full").
export const FEE_PLAN: Array<['swapFeeLevel' | 'withdrawalFeeLevel', string, string, string]> = [
  ['swapFeeLevel', 'STD-USDT-AED', 'SWAP_SERVICE_FEE', '10'], // 10 AED flat
  ['swapFeeLevel', 'STD-AED-USDT', 'SWAP_SERVICE_FEE', '3'], //  3 USDT flat
  ['withdrawalFeeLevel', 'STD-AED-FIAT', 'WITHDRAW_SERVICE_FEE', '2'], // 2 AED flat
  ['withdrawalFeeLevel', 'STD-USDT-TRON', 'WITHDRAW_SERVICE_FEE', '1'], // 1 USDT flat
];

// ── small utils ──────────────────────────────────────────────────────────────
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor<T>(
  label: string,
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs = 15000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - start > timeoutMs) throw new Error(`Timeout (${timeoutMs}ms) waiting for: ${label}`);
    await sleep(120);
  }
}

function customerIdx(email: string): number {
  return (DEMO_CUSTOMER_EMAILS as readonly string[]).indexOf(email) + 1;
}

// ── context ──────────────────────────────────────────────────────────────────
export type DemoCtx = {
  app: INestApplicationContext;
  prisma: any;
  accounting: AccountingService;
  fundsOrders: FundsOrderService;
  deposits: DepositTransactionsService;
  depositWf: any;
  swapQuote: SwapQuoteService;
  swapWf: any;
  swapWorkflowSvc: SwapWorkflowService;
  withdrawQuote: WithdrawQuoteService;
  withdraws: WithdrawTransactionsService;
  withdrawWf: WithdrawWorkflowService;
  usdt: any;
  aed: any;
  /** Real running backend's HTTP origin — this script's own app context (below)
   *  has no HTTP listener of its own (createApplicationContext binds no routes),
   *  so the MLRO/SMO/OPS_OFFICER login+approve calls for the deposit disposition
   *  arcs (runDeposits) need the actual long-running stack server instead. */
  apiBase: string;
};

// Worktree ("self") stacks auto-allocate a 4-port block persisted in
// <worktree-root>/.stackports (scripts/stack-common.sh#allocate_worktree_ports) —
// the backend HTTP port is that base value. The main stack has no such file and
// always uses the fixed port 3000 (scripts/stack-common.sh#load_stack_config).
export function resolveApiBase(): string {
  const stackportsPath = path.resolve(__dirname, '../../.stackports');
  try {
    const base = parseInt(fs.readFileSync(stackportsPath, 'utf8').trim(), 10);
    if (Number.isFinite(base)) return `http://localhost:${base}`;
  } catch {
    // no .stackports here — not a worktree stack, fall through to main's fixed port.
  }
  return 'http://localhost:3000';
}

export async function bootstrap(): Promise<DemoCtx> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma: any = app.get(PrismaService);
  const usdt = await prisma.asset.findFirst({ where: { status: 'ACTIVE', type: 'CRYPTO', currency: 'USDT' } });
  const aed = await prisma.asset.findFirst({ where: { status: 'ACTIVE', type: 'FIAT', currency: 'AED' } });
  if (!usdt || !aed) throw new Error('USDT/AED active assets not seeded — run the business seed first');
  return {
    app,
    prisma,
    accounting: app.get(AccountingService),
    fundsOrders: app.get(FundsOrderService),
    deposits: app.get(DepositTransactionsService),
    depositWf: app.get(DepositWorkflowService),
    swapQuote: app.get(SwapQuoteService),
    swapWf: app.get(SwapWorkflowService),
    swapWorkflowSvc: app.get(SwapWorkflowService),
    withdrawQuote: app.get(WithdrawQuoteService),
    withdraws: app.get(WithdrawTransactionsService),
    withdrawWf: app.get(WithdrawWorkflowService),
    usdt,
    aed,
    apiBase: resolveApiBase(),
  };
}

export async function resolveDemoCustomers(prisma: any): Promise<any[]> {
  const rows = await prisma.customerMain.findMany({
    where: { email: { in: [...DEMO_CUSTOMER_EMAILS] } },
    select: {
      id: true, customerNo: true, email: true, firstName: true, lastName: true,
      lifecycle: true,
      // 三轴收敛后"能不能交易"= lifecycle ACTIVE 且名下无 OPEN 便签。
      // 便签一行一 scope，任何一行 OPEN 都足以让 demo 半路卡住，这里一律拒跑。
      restrictionRows: { where: { status: 'OPEN' }, select: { cause: true, scope: true } },
    },
  });
  const missing = DEMO_CUSTOMER_EMAILS.filter((e) => !rows.find((r: any) => r.email === e));
  if (missing.length) throw new Error(`demo customers missing (run business seed): ${missing.join(', ')}`);
  const blocked = rows.filter((r: any) => r.lifecycle !== 'ACTIVE' || r.restrictionRows.length > 0);
  if (blocked.length) {
    throw new Error(
      `demo customers not tradeable: ${blocked
        .map((r: any) => {
          const marks = r.restrictionRows.map((x: any) => `${x.cause}:${x.scope}`).join('+');
          return `${r.email}(${r.lifecycle}${marks ? '/' + marks : ''})`;
        })
        .join(', ')}`,
    );
  }
  // preserve DEMO_CUSTOMER_EMAILS order
  return DEMO_CUSTOMER_EMAILS.map((e) => rows.find((r: any) => r.email === e));
}

/** The 4th persona (FROZEN_PERSONA_EMAIL above) — existence-only lookup, no
 *  tradeability assertion. Unlike resolveDemoCustomers, this never throws on
 *  him carrying an OPEN restriction mid-run — that's the roster's own doing
 *  (deposit rows #7/#10), not a fixture error. */
export async function resolveFrozenPersona(prisma: any): Promise<any> {
  const row = await prisma.customerMain.findFirst({
    where: { email: FROZEN_PERSONA_EMAIL },
    select: { id: true, customerNo: true, email: true, firstName: true, lastName: true },
  });
  if (!row) throw new Error(`demo frozen persona missing (run business seed): ${FROZEN_PERSONA_EMAIL}`);
  return row;
}

async function bumpFee(prisma: any, model: 'swapFeeLevel' | 'withdrawalFeeLevel', levelCode: string, itemCode: string, value: string): Promise<void> {
  const level = await prisma[model].findUnique({ where: { levelCode } });
  if (!level) throw new Error(`${model} ${levelCode} not found`);
  const cfg = JSON.parse(level.tiersJson);
  const item = cfg.tiers[0].feeItems.find((f: any) => f.itemCode === itemCode);
  if (!item) throw new Error(`${itemCode} not found in ${levelCode}`);
  item.value = value;
  const tiersJson = JSON.stringify(cfg);
  const configHash = createHash('sha256').update(tiersJson).digest('hex');
  await prisma[model].update({ where: { levelCode }, data: { tiersJson, configHash } });
}

// ── stage 1: setup (idempotent) ──────────────────────────────────────────────
export async function ensureSetup(ctx: DemoCtx): Promise<void> {
  console.log('═══ demo:setup — fees + wallets + TB accounts ═══');
  for (const [model, level, item, val] of FEE_PLAN) {
    try {
      await bumpFee(ctx.prisma, model, level, item, val);
    } catch (e: any) {
      console.log(`  ⚠ fee ${level}/${item}: ${e.message}`);
    }
  }

  const customers = await resolveDemoCustomers(ctx.prisma);
  const frozenPersona = await resolveFrozenPersona(ctx.prisma);
  const cmaTpl = await ctx.prisma.wallet.findFirst({
    where: { walletRole: 'C_CMA', assetId: ctx.aed.id, status: 'ACTIVE' },
    select: { bankName: true, accountName: true },
  });

  // Frank (frozenPersona) needs the exact same wallets/TB accounts/withdrawal
  // address as the trio — he deposits like they do (roster #7/#10), just never
  // swaps/withdraws, so he's included in setup but not in DEMO_CUSTOMER_EMAILS.
  for (const c of [...customers, frozenPersona]) {
    // customer TB accounts (CLIENT_PAYABLE + DEPOSIT_SUSPENSE) per asset
    for (const asset of [ctx.usdt, ctx.aed]) {
      const ledger = TB_LEDGERS[asset.currency as keyof typeof TB_LEDGERS];
      for (const code of [TB_ACCOUNT_CODES.CLIENT_PAYABLE, TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE]) {
        await ensureTbAccountRegistry(ctx.prisma, {
          code, ledger, ownerType: 'CUSTOMER', ownerUuid: c.id, ownerNo: c.customerNo,
          assetCode: asset.code, description: `${code} ${c.customerNo}/${asset.code}`,
        });
      }
    }

    // C_DEP (USDT deposit address)
    const depNo = buildDeterministicNo('WA', SIM, 'C_DEP', c.customerNo);
    const depAddr = `T${createHash('sha256').update(depNo).digest('hex').slice(0, 33)}`;
    await ctx.prisma.wallet.upsert({
      where: { walletNo: depNo }, update: {},
      create: {
        walletNo: depNo, ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
        type: 'CRYPTO_ADDRESS', walletRole: 'C_DEP', assetId: ctx.usdt.id, address: depAddr, status: 'ACTIVE',
      },
    });

    // C_VIBAN (AED)
    const vibanNo = buildDeterministicNo('WA', SIM, 'C_VIBAN', c.customerNo);
    const vibanIban = `AE07086${createHash('sha256').update(vibanNo).digest('hex').replace(/\D/g, '').padEnd(16, '0').slice(0, 16)}`;
    await ctx.prisma.wallet.upsert({
      where: { walletNo: vibanNo }, update: {},
      create: {
        walletNo: vibanNo, ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
        type: 'FIAT_BANK', walletRole: 'C_VIBAN', assetId: ctx.aed.id, iban: vibanIban,
        bankName: cmaTpl?.bankName ?? 'Zand Bank PJSC', accountName: cmaTpl?.accountName ?? 'FiatX Ltd', status: 'ACTIVE',
      },
    });

    // Registered fiat withdrawal address (BANK/ACTIVE) — the 2026-07-11
    // trading-start precondition gate (deposit-workflow.service.ts
    // #assertTradingReadyOrHold + onboarding.service.ts#assertTradingReady)
    // holds deposit/swap/withdraw for any customer without one on file. This
    // step was missing here — a fresh (never-demo'd-before) DB stalls on the
    // very first deposit approval, which is what actually surfaces the gap
    // (an existing worktree with accumulated prior demo runs already has one
    // from an earlier successful withdrawal and never notices).
    const wdAddrNo = buildDeterministicNo('WA', SIM, 'WD_BANK', c.customerNo);
    await ctx.prisma.withdrawalAddress.upsert({
      where: { customerId_assetId_address: { customerId: c.id, assetId: ctx.aed.id, address: vibanIban } },
      update: { status: 'ACTIVE' },
      create: {
        addressNo: wdAddrNo, customerId: c.id, customerNo: c.customerNo,
        assetId: ctx.aed.id, network: 'FIAT', address: vibanIban, addressType: 'BANK', iban: vibanIban,
        ownershipDeclaredAt: new Date(), ownershipProofType: 'DEMO_FIXTURE',
        status: 'ACTIVE', activatesAt: new Date(Date.now() - 1000),
        traceId: `demo-setup-withdrawal-address-${c.customerNo}`,
      },
    });

    // Registered crypto withdrawal destination — Task 3's per-transaction hard
    // guard (createWithdrawal requires the EXACT target address on file, on
    // top of the trading-ready "has ≥1 BANK address" gate above). Only
    // WITHDRAW_PLAN entries with a `cryptoUsdt` leg (alice/bob) need one;
    // must match runWithdraws' own deterministic address derivation exactly.
    if (WITHDRAW_PLAN[c.email]?.cryptoUsdt) {
      const idx = customerIdx(c.email);
      const cryptoWdAddr = `T${createHash('sha256').update(`${SIM}wd${idx}`).digest('hex').slice(0, 33)}`;
      const cryptoWdAddrNo = buildDeterministicNo('WA', SIM, 'WD_CRYPTO', c.customerNo);
      await ctx.prisma.withdrawalAddress.upsert({
        where: { customerId_assetId_address: { customerId: c.id, assetId: ctx.usdt.id, address: cryptoWdAddr } },
        update: { status: 'ACTIVE' },
        create: {
          addressNo: cryptoWdAddrNo, customerId: c.id, customerNo: c.customerNo,
          assetId: ctx.usdt.id, network: ctx.usdt.network || 'TRON', address: cryptoWdAddr, addressType: 'SELF_CUSTODY',
          ownershipDeclaredAt: new Date(), ownershipProofType: 'DEMO_FIXTURE',
          status: 'ACTIVE', activatesAt: new Date(Date.now() - 1000),
          traceId: `demo-setup-withdrawal-address-crypto-${c.customerNo}`,
        },
      });
    }
  }

  await provisionTbAccounts(ctx.prisma);
  console.log(`  setup done: ${[...customers, frozenPersona].map((c) => c.customerNo).join(', ')}`);
}

// ── stage 2: deposits (10-entry roster, incl. 3 disposition arcs) ─────────────
//
// Roster: scripts/demo-roster.ts DEMO_ROSTER (domain === 'DEPOSIT', 10 rows) —
// every row drives to whatever status the roster names, via the REAL service/
// workflow methods a human admin would use (no direct table writes):
//   · the ⚡ buttons drive DepositWorkflowService.applyKytVerdict directly —
//     the same workflow method the admin demo panel's endpoint
//     (AdminDepositDemoController → DepositDemoScenarioService.runVerdict) calls
//     downstream of its webhook-shaped replay, with the verdict arguments read
//     off the SAME button table (DEPOSIT_VERDICT_BUTTONS) the panel itself uses
//     (see verdictArgsForButton below). The full webhook-endpoint replay was
//     tried first and abandoned: it requires the deposit's Sumsub applicant to
//     have actually been submitted (sumsubTxnId set), which never happened for
//     demo_grace@example.com at the time — her seed customer row had no
//     sumsubApplicantId at all (only Alice/Bob/Ivy had one back then), so Gate
//     0's submitSumsubTxns permanently skipped her. She (and Frank) have one
//     now — added in task-C2b-report.md to fix that exact absence silently
//     breaking the REAL admin ⚡ demo panel — but this script's own choice never
//     depended on that gap: calling the workflow method directly is explicitly
//     sanctioned by the "同一套端点/workflow 方法" replay rule and sidesteps the
//     Sumsub-submission dependency entirely either way — see task-C2-report.md;
//   · the three disposition arcs (CONFISCATED/RETURNED/SEIZED) are real
//     maker-checker: an initiate*() call opens the approval case in-process (the
//     "maker" here is a constructed actor, same pattern DepositWorkflowService's
//     own KYT_VERDICT_ACTOR uses for system-initiated actions), then a SECOND,
//     really-logged-in admin identity (scripts/demo-mlro.ts) hits the real
//     approve endpoint on the actually-running stack server.

const DEMO_ACTOR = (userId: string, role: string) => ({
  actorType: 'ADMIN' as const, userId, userNo: userId, role, roleCodes: [role],
});

const DEPOSIT_DISPO_TAGS = DISPO_TAGS_BY_DOMAIN.DEPOSIT;
const VERDICT_BY_WEBHOOK_TYPE: Record<string, 'approved' | 'rejected' | 'awaitUser' | 'onHold'> = {
  applicantKytTxnApproved: 'approved',
  applicantKytTxnRejected: 'rejected',
  applicantKytTxnAwaitingUser: 'awaitUser',
};

/** Reads one ⚡ button's real definition (DEPOSIT_VERDICT_BUTTONS, the same table
 *  the admin demo panel renders its buttons from) and derives the
 *  applyKytVerdict() call args a real Sumsub webhook for that button would have
 *  produced — same derivation DepositKytVerdictHandler does off a real webhook's
 *  typedTags/applicantActions. */
function verdictArgsForButton(buttonKey: string) {
  const button = DEPOSIT_VERDICT_BUTTONS[buttonKey];
  if (!button) throw new Error(`unknown deposit verdict button: ${buttonKey}`);
  const verdict = VERDICT_BY_WEBHOOK_TYPE[button.webhookType];
  if (!verdict) throw new Error(`button ${buttonKey} has no approved/rejected/awaitUser mapping (webhookType=${button.webhookType})`);

  let sceneTag: SceneTag | undefined;
  let dispoTag: DispoTag | undefined;
  for (const tag of button.verdict.typedTags ?? []) {
    if (tag.type !== 'userDefined') continue;
    if (SCENE_TAGS.has(tag.label as SceneTag)) sceneTag = tag.label as SceneTag;
    if (DEPOSIT_DISPO_TAGS.has(tag.label as DispoTag)) dispoTag = tag.label as DispoTag;
  }

  return {
    verdict,
    riskScore: button.verdict.score,
    ...(sceneTag && { sceneTag }),
    ...(dispoTag && { dispoTag }),
    ...(button.verdict.applicantActions?.length && { applicantActions: button.verdict.applicantActions }),
  };
}

/** Creates one deposit + drives its payin funds order (legSeq 1) to CLEARED, then
 *  waits for it to leave PAYIN_PENDING — either COMPLIANCE_PENDING (Gate 0 ran
 *  and passed) or somewhere Gate 0 routed it to on its own (e.g. straight to
 *  FROZEN, when an earlier roster row already sanctioned this same customer —
 *  see #10 below). Gate 0 runs off a fire-and-forget `emit()` (not `emitAsync` —
 *  see test/deposit-money-arcs.e2e-spec.ts's header comment for the same race on
 *  funds-order events), so this has to poll rather than trust the immediate
 *  post-CONFIRM state. */
async function createRosterDeposit(
  ctx: DemoCtx, c: any, asset: any, walletId: string, amount: string, type: PayinType,
): Promise<any> {
  const idx = customerIdx(c.email);
  const { deposit: dep, fundsOrder: fo }: any = await ctx.deposits.detected({
    assetId: asset.id, toWalletId: walletId, amount,
    txHash: type === PayinType.CRYPTO ? fakeChainTxHash(walletId) : undefined,
    fromAddress: type === PayinType.CRYPTO ? `Tsender${idx}` : undefined,
    fromIban: type === PayinType.FIAT ? `AE00SENDER${idx}` : undefined,
    referenceNo: fakeBankRef(walletId, new Date()),
  });

  if (type === PayinType.CRYPTO) {
    await ctx.fundsOrders.advance(fo.id, FundsOrderAction.OBSERVE_CONFIRMING, 'SYSTEM');
    await ctx.fundsOrders.advance(fo.id, FundsOrderAction.CONFIRM, 'SYSTEM');
  }
  await waitFor(`funds order ${fo.fundsOrderNo} CLEARED`, async () => {
    const f: any = await ctx.prisma.fundsOrder.findUnique({ where: { id: fo.id } });
    return f?.status === 'CLEARED' ? f : null;
  });

  return waitFor(`deposit ${dep.depositNo} past PAYIN_PENDING`, async () => {
    const d: any = await ctx.deposits.findOne(dep.id);
    return d.status !== 'PAYIN_PENDING' ? d : null;
  });
}

/** Feeds one ⚡ verdict button into a COMPLIANCE_PENDING deposit via the real
 *  DepositWorkflowService.applyKytVerdict — see verdictArgsForButton above for why
 *  this calls the workflow method rather than replaying the webhook endpoint.
 *  No-ops (just logs) if Gate 0 already moved the deposit elsewhere. */
async function driveVerdict(ctx: DemoCtx, depositId: string, buttonKey: string): Promise<any> {
  const current: any = await ctx.deposits.findOne(depositId);
  if (current.status !== 'COMPLIANCE_PENDING') {
    console.log(`    ⚡${buttonKey} skipped — ${current.depositNo} already ${current.status} (Gate 0 pre-empted)`);
    return current;
  }
  await ctx.depositWf.applyKytVerdict(depositId, verdictArgsForButton(buttonKey));
  return ctx.deposits.findOne(depositId);
}

async function waitDepositStatus(ctx: DemoCtx, depositId: string, status: string, timeoutMs = 15000): Promise<any> {
  return waitFor(`deposit reaches ${status}`, async () => {
    const d: any = await ctx.deposits.findOne(depositId);
    return d.status === status ? d : null;
  }, timeoutMs);
}

/** Drives a disposition leg (legSeq 2 confiscation / 3 return / 4 seize) CREATED →
 *  CONFIRMED — the same generic funds_order state machine driveWithdraw below uses
 *  for its own legs. CONFIRMED is what DepositWorkflowService's
 *  handleFundsOrderChanged routes to settleConfiscation/settleReturn/settleSeize
 *  (posts the pending TB legs, flips the deposit to its terminal disposition
 *  status). */
async function driveDispositionLeg(ctx: DemoCtx, depositId: string, legSeq: number): Promise<void> {
  const leg: any = await waitFor(`disposition leg ${legSeq} materialised`, async () => {
    const [l] = await ctx.fundsOrders.findByParent({ depositTransactionId: depositId }, { legSeq });
    return l ?? null;
  });
  const legIsCrypto = (leg.asset?.type || '').toUpperCase() !== 'FIAT';
  const seq = legIsCrypto
    ? [FundsOrderAction.SUBMIT, FundsOrderAction.OBSERVE_CONFIRMING, FundsOrderAction.CONFIRM]
    : [FundsOrderAction.SUBMIT, FundsOrderAction.CONFIRM];
  for (const action of seq) {
    await ctx.fundsOrders.advance(leg.id, action, SIM);
    await sleep(60);
  }
}

/** Checker step(s) of a maker-checker disposition: looks up the approval case's
 *  internal id from its approvalNo (the real approve endpoint takes the id, not
 *  the business-facing approvalNo — see scripts/demo-mlro.ts), then logs in for
 *  real + approves once per required step, in order (SEIZE needs two distinct
 *  real logins — SENIOR_MANAGEMENT_OFFICER then MLRO, four-eyes). */
async function makerCheckerApprove(ctx: DemoCtx, approvalNo: string, logins: Array<() => Promise<string>>): Promise<void> {
  const kase = await ctx.prisma.approvalCase.findUnique({ where: { approvalNo } });
  if (!kase) throw new Error(`approval case ${approvalNo} not found`);
  for (const login of logins) {
    const token = await login();
    await approveApproval(ctx.apiBase, token, kase.id);
  }
}

export async function runDeposits(ctx: DemoCtx): Promise<Array<{ seq: number; orderNo: string; status: string }>> {
  console.log('═══ demo:deposit — 10 笔按花名册铺（含三条处置弧）═══');
  const customers = await resolveDemoCustomers(ctx.prisma);
  // roster rows #7/#10 target the frozen persona (FRANK), not the tradeable
  // trio — resolve him too so byEmail/wallets below can find him.
  const frozenPersona = await resolveFrozenPersona(ctx.prisma);
  const depositCustomers = [...customers, frozenPersona];
  const byEmail = new Map(depositCustomers.map((c) => [c.email, c]));

  const wallets = new Map<string, { usdt: any; aed: any }>();
  for (const c of depositCustomers) {
    const usdtWallet = await ctx.prisma.wallet.findFirst({ where: { ownerId: c.id, walletRole: 'C_DEP', assetId: ctx.usdt.id } });
    const aedWallet = await ctx.prisma.wallet.findFirst({ where: { ownerId: c.id, walletRole: 'C_VIBAN', assetId: ctx.aed.id } });
    if (!usdtWallet || !aedWallet) throw new Error(`${c.email} missing C_DEP/C_VIBAN — run demo:setup first`);
    wallets.set(c.email, { usdt: usdtWallet, aed: aedWallet });
  }

  const driven: Array<{ seq: number; depositId: string }> = [];

  for (const entry of DEMO_ROSTER.filter((r) => r.domain === 'DEPOSIT')) {
    const c = byEmail.get(entry.customerEmail);
    if (!c) throw new Error(`roster #${entry.seq}: customer ${entry.customerEmail} not resolved`);
    const w = wallets.get(entry.customerEmail)!;
    const isUsdt = entry.currency === 'USDT';
    const asset = isUsdt ? ctx.usdt : ctx.aed;
    const walletId = (isUsdt ? w.usdt : w.aed).id;
    const type = isUsdt ? PayinType.CRYPTO : PayinType.FIAT;

    let dep = await createRosterDeposit(ctx, c, asset, walletId, entry.amount, type);

    switch (entry.seq) {
      case 1: case 2: case 3:
        await driveVerdict(ctx, dep.id, 'V1_APPROVED');
        dep = await waitDepositStatus(ctx, dep.id, 'SUCCESS');
        break;

      case 4:
        await driveVerdict(ctx, dep.id, 'V2_AWAIT_USER');
        dep = await waitDepositStatus(ctx, dep.id, 'ACTION_PENDING');
        break;

      case 5:
        await driveVerdict(ctx, dep.id, 'V11_REJECTED_NO_TAG');
        dep = await waitDepositStatus(ctx, dep.id, 'MANUAL_CHECKING');
        break;

      case 6:
        // 低于下限（amount < DEPOSIT 单笔下限，transaction_limit_rules 种子 minAmount=100）：
        // approved 判决抵达 DepositWorkflowService.approveDeposit 的挂起闸(holdIfHeld)，
        // 钱留在 DEPOSIT_SUSPENSE 不过账 → OPERATION_PENDING。
        await driveVerdict(ctx, dep.id, 'V1_APPROVED');
        dep = await waitDepositStatus(ctx, dep.id, 'OPERATION_PENDING');
        break;

      case 7:
        await driveVerdict(ctx, dep.id, 'V7_REJECTED_SANCTION_APPLICANT');
        dep = await waitDepositStatus(ctx, dep.id, 'FROZEN');
        break;

      case 8: {
        // 低于下限挂起 → 运营发起没收 → OPS_OFFICER 换人批（approval.constants.ts 里
        // DEPOSIT_CONFISCATION 就是单步 OPS_OFFICER，不是 MLRO）→ 资金单腿(legSeq 2)
        // 确认 → CONFISCATED。
        await driveVerdict(ctx, dep.id, 'V1_APPROVED');
        dep = await waitDepositStatus(ctx, dep.id, 'OPERATION_PENDING');
        const conf = await ctx.depositWf.initiateConfiscation(
          dep.id,
          { reason: 'Below-min deposit — T&C handling fee (demo fixture)' },
          DEMO_ACTOR('DEMO_OPS_MAKER_8', 'OPS_OFFICER'),
        );
        await makerCheckerApprove(ctx, conf.approvalNo, [() => loginAsOpsOfficer(ctx.apiBase)]);
        await driveDispositionLeg(ctx, dep.id, 2);
        dep = await waitDepositStatus(ctx, dep.id, 'CONFISCATED');
        break;
      }

      case 9: {
        // ⚡⑪ 转人工 → 运营发起退回 → MLRO 换人批 → 资金单腿(legSeq 3)确认 → RETURNED。
        await driveVerdict(ctx, dep.id, 'V11_REJECTED_NO_TAG');
        dep = await waitDepositStatus(ctx, dep.id, 'MANUAL_CHECKING');
        const ret = await ctx.depositWf.initiateReturn(
          dep.id,
          { reason: 'Officer disposition — return funds to the originating account (demo fixture)' },
          DEMO_ACTOR('DEMO_OPS_MAKER_9', 'OPS_OFFICER'),
        );
        await makerCheckerApprove(ctx, ret.approvalNo, [() => loginAsMlro(ctx.apiBase)]);
        await driveDispositionLeg(ctx, dep.id, 3);
        dep = await waitDepositStatus(ctx, dep.id, 'RETURNED');
        break;
      }

      case 10: {
        // ⚡⑦ 冻结（#7 已把 FRANK 判过一次 SANCTION_APPLICANT —— 这是 customerLevel 限制，
        // 会连坐冻住 FRANK 名下所有非终态单；这笔新单créé时 FRANK 已被限制，Gate 0 会在
        // 提交 Sumsub 之前就直接把它落 FROZEN，driveVerdict 撞上非 COMPLIANCE_PENDING
        // 会自己跳过 —— 两条路径殊途同归，都是真实的处置起点）→ 运营发起上缴 →
        // 两步批（SENIOR_MANAGEMENT_OFFICER → MLRO，四眼）→ 资金单腿(legSeq 4)确认 → SEIZED。
        await driveVerdict(ctx, dep.id, 'V7_REJECTED_SANCTION_APPLICANT');
        dep = await waitDepositStatus(ctx, dep.id, 'FROZEN');
        const seize = await ctx.depositWf.initiateSeize(
          dep.id,
          { reason: 'Government seizure order (demo fixture)', orderRef: `GOV-ORDER-DEMO-${dep.depositNo}` },
          DEMO_ACTOR('DEMO_OPS_MAKER_10', 'OPS_OFFICER'),
        );
        await makerCheckerApprove(ctx, seize.approvalNo, [
          () => loginAsSmo(ctx.apiBase),
          () => loginAsMlro(ctx.apiBase),
        ]);
        await driveDispositionLeg(ctx, dep.id, 4);
        dep = await waitDepositStatus(ctx, dep.id, 'SEIZED');
        break;
      }
    }

    driven.push({ seq: entry.seq, depositId: dep.id });
    console.log(`  #${entry.seq} ${entry.label}: ${dep.depositNo} → ${dep.status}`);
  }

  // Re-read every deposit's status AFTER the whole roster has run — not the status
  // each row settled on right when ITS OWN drive finished. A later row CAN move an
  // earlier row's deposit out from under it: any SANCTION_APPLICANT verdict opens
  // a customer-level restriction (scope=ALL) on its owner, and
  // DepositWorkflowService's onCustomerRestrictionOpened sweeps EVERY non-terminal
  // deposit that owner has to FROZEN. That is exactly why #7/#10 (FROZEN/SEIZED)
  // are pinned to FRANK — a persona with no OTHER roster rows — instead of reusing
  // a trio member: BOB used to hold both #5 (MANUAL_CHECKING) and #7, and #7's
  // sweep silently clobbered #5 to FROZEN after the fact (PAYIN_PENDING→
  // COMPLIANCE_PENDING→MANUAL_CHECKING→FROZEN), which also happened to be exactly
  // the customer-level-restriction/trio-must-stay-tradeable conflict that made
  // demo:swap FATAL further down the pipeline — see task-C2b-report.md. The
  // roster's expectedStatus is a claim about the FINAL settled state, so this must
  // report that — not a stale mid-run snapshot that would hide a future case of the
  // same conflict. See task-C2-report.md / task-C2b-report.md.
  const results: Array<{ seq: number; orderNo: string; status: string }> = [];
  for (const { seq, depositId } of driven) {
    const final: any = await ctx.deposits.findOne(depositId);
    results.push({ seq, orderNo: final.depositNo, status: final.status });
  }
  return results;
}

// ── stage 3: swaps (4-leg two-phase orchestration; auto-advance to SUCCESS) ──

/** Drive ONE swap leg from its current state to CLEARED by repeatedly advancing
 *  the leg's funds_order through the per-asset-type state machine (spec §5.3).
 *  CRYPTO: CREATED→SUBMIT→SUBMITTED→OBSERVE_CONFIRMING→CONFIRMING→CONFIRM→CONFIRMED→CLEAR→CLEARED.
 *  FIAT:   CREATED→SUBMIT→SUBMITTED→CONFIRM→CONFIRMED→CLEAR→CLEARED.
 *  Each leg's funds_order is created in CREATED (leg 1 by applyKytVerdict on an
 *  approving KYT verdict — initiateSwap itself books nothing, see runSwaps
 *  below; legs 2-4 chained by the handler on the prior leg's CLEARED). Drives
 *  via advanceLeg — the real controller path (sell-first guard + funds_order.advance). */
async function driveSwapLegToClear(ctx: DemoCtx, swapId: string, swapNo: string, legSeq: number): Promise<void> {
  // Legs 2-4 are chained by the (async) handler once the prior leg CLEARs — wait
  // for this leg's funds_order to materialise before driving it.
  await waitFor(`${swapNo} leg ${legSeq} created`, async () => {
    const [leg] = await ctx.fundsOrders.findByParent({ swapTransactionId: swapId }, { legSeq });
    return leg ?? null;
  }, 8000);

  // Phase 1: drive CREATED → … → CONFIRMED. CONFIRMED is the finalize trigger —
  // the swap workflow (async @OnEvent) then posts TB, auto-CLEARs this leg, and
  // chains the next. We never issue CLEAR (mirrors the sim panel, which has no
  // CLEAR button).
  for (let step = 0; step < 8; step++) {
    const [leg] = await ctx.fundsOrders.findByParent({ swapTransactionId: swapId }, { legSeq });
    if (!leg) throw new Error(`${swapNo} leg ${legSeq} not found`);
    if (leg.status === 'CLEARED' || leg.status === 'CONFIRMED') break;
    const isFiat = ((leg as any).asset?.type || '').toUpperCase() === 'FIAT';
    let action: FundsOrderAction;
    if (isFiat) {
      if (leg.status === 'CREATED') action = FundsOrderAction.SUBMIT;
      else if (leg.status === 'SUBMITTED') action = FundsOrderAction.CONFIRM;
      else throw new Error(`${swapNo} leg ${legSeq} unexpected fiat status ${leg.status}`);
    } else {
      if (leg.status === 'CREATED') action = FundsOrderAction.SUBMIT;
      else if (leg.status === 'SUBMITTED') action = FundsOrderAction.OBSERVE_CONFIRMING;
      else if (leg.status === 'CONFIRMING') action = FundsOrderAction.CONFIRM;
      else throw new Error(`${swapNo} leg ${legSeq} unexpected crypto status ${leg.status}`);
    }
    await ctx.fundsOrders.advance(leg.id, action, 'DEMO');
    await sleep(40);
  }

  // Phase 2: wait for the async workflow to auto-CLEAR this leg (post TB + chain).
  await waitFor(`${swapNo} leg ${legSeq} CLEARED`, async () => {
    const [leg] = await ctx.fundsOrders.findByParent({ swapTransactionId: swapId }, { legSeq });
    return leg?.status === 'CLEARED' ? leg : null;
  }, 8000);
}

/** Drive an entire PROCESSING swap (all 4 legs) to SUCCESS. */
async function driveSwapToSuccess(ctx: DemoCtx, swap: { id: string; swapNo: string }): Promise<void> {
  for (const legSeq of [1, 2, 3, 4]) {
    await driveSwapLegToClear(ctx, swap.id, swap.swapNo, legSeq);
  }
  await waitFor(`${swap.swapNo} SUCCESS`, async () => {
    const s: any = await ctx.prisma.swapTransaction.findUnique({ where: { id: swap.id } });
    return s?.status === 'SUCCESS' ? s : null;
  }, 8000);
}

export async function runSwaps(ctx: DemoCtx): Promise<void> {
  console.log('═══ demo:swap — fixed-amount swaps; auto-advance 4 legs to SUCCESS ═══');
  const customers = await resolveDemoCustomers(ctx.prisma);
  let driven = 0;
  let skippedSuccess = 0;
  let recovered = 0;

  for (const c of customers) {
    const plan = SWAP_PLAN[c.email];
    // idempotent: SUCCESS → skip; PROCESSING → auto-advance to SUCCESS; else create new + advance.
    const existing: any = await ctx.prisma.swapTransaction.findFirst({
      where: { ownerId: c.id, status: { in: ['SUCCESS', 'PROCESSING'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing?.status === 'SUCCESS') {
      console.log(`  ${c.customerNo} ${c.firstName}: swap ${existing.swapNo} already SUCCESS — skip`);
      skippedSuccess++;
      continue;
    }
    if (existing?.status === 'PROCESSING') {
      console.log(`  ${c.customerNo} ${c.firstName}: swap ${existing.swapNo} PROCESSING — auto-advance to SUCCESS`);
      await driveSwapToSuccess(ctx, { id: existing.id, swapNo: existing.swapNo });
      recovered++;
      continue;
    }

    const usdtToAed = plan.dir === 'USDT_AED';
    const from = usdtToAed ? ctx.usdt : ctx.aed;
    const to = usdtToAed ? ctx.aed : ctx.usdt;
    const quote: any = await ctx.swapQuote.createQuote({
      ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
      fromAssetId: from.id, fromAssetCode: from.currency,
      toAssetId: to.id, toAssetCode: to.currency,
      amount: new Prisma.Decimal(plan.amount), customerId: c.id,
    } as any);
    // initiateSwap (Task 4) books nothing — swap sits COMPLIANCE_PENDING until a
    // Sumsub KYT verdict lands (Task 6). No real Sumsub webhook in demo/local, so
    // the approving verdict is applied directly, mirroring driveWithdraw's own
    // applyKytVerdict call below (and createRosterDeposit/driveVerdict above).
    const swap: any = await ctx.swapWf.initiateSwap(c.id, quote.id);
    console.log(`  ${c.customerNo} ${c.firstName}: ${swap.swapNo} ${usdtToAed ? 'USDT→AED' : 'AED→USDT'} ${plan.amount} → ${swap.netToAmount ?? swap.toAmount} ${to.currency} (COMPLIANCE_PENDING)`);
    // riskScore 与充值/提现的 demo 调用对齐（各自 riskScore: 5）—— 不传的话
    // sumsub_score 落 NULL，详情页 L2 副行只能显示 'Awaiting Sumsub verdict'。
    await ctx.swapWf.applyKytVerdict(swap.id, { verdict: 'approved', riskScore: 5 });
    console.log(`  ${c.customerNo} ${c.firstName}: ${swap.swapNo} KYT approved → PROCESSING, leg1 booked`);
    await driveSwapToSuccess(ctx, { id: swap.id, swapNo: swap.swapNo });
    console.log(`  ${c.customerNo} ${c.firstName}: ${swap.swapNo} 4 legs CLEAR → SUCCESS`);
    driven++;
  }
  console.log(`  ${driven} new swap(s) driven to SUCCESS, ${recovered} PROCESSING recovered, ${skippedSuccess} already-SUCCESS skipped`);
}

// ── stage 4: withdrawals ─────────────────────────────────────────────────────
async function driveWithdraw(ctx: DemoCtx, c: any, asset: any, amount: number, toIban?: string, toAddress?: string): Promise<any> {
  // idempotent: skip if customer already has a SUCCESS withdraw in this asset
  const existing = await ctx.prisma.withdrawTransaction.findFirst({ where: { ownerId: c.id, assetId: asset.id, status: 'SUCCESS' } });
  if (existing) return existing;

  const wq: any = await ctx.withdrawQuote.createQuote({
    ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
    assetId: asset.id, assetCode: asset.currency, amount: new Prisma.Decimal(amount), customerId: c.id,
  } as any);
  // generateReferenceNo('WD') uses only a 4-digit random; on a crowded same-day
  // namespace it can collide (P2002 on withdrawNo). Retry a few times — each call
  // redraws the random. (Underlying weakness is production-side, flagged separately.)
  let wd: any;
  for (let attempt = 1; ; attempt++) {
    try {
      wd = await ctx.withdrawWf.createWithdrawal({ assetId: asset.id, amount, toIban, toAddress, quoteId: wq.id } as any, c.id, 'CUSTOMER');
      break;
    } catch (e: any) {
      if (e?.code === 'P2002' && attempt < 8) { await sleep(60); continue; }
      throw e;
    }
  }
  await waitFor(`${wd.withdrawNo} COMPLIANCE_PENDING`, async () => {
    const w: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
    return w.status === 'COMPLIANCE_PENDING' ? w : null;
  });
  // Real Sumsub KYT verdict application (Task 5) — mirrors runDeposits' own
  // KYT-verdict drives above (createRosterDeposit/driveVerdict). There is no real
  // Sumsub webhook in the demo/local environment, so the verdict is applied directly.
  await ctx.withdrawWf.applyKytVerdict(wd.id, { verdict: 'approved', riskScore: 5 });

  // At PAYOUT_PENDING the workflow has materialised the payout principal funds
  // order (legSeq 1) and, when a fee was charged, the fee funds order (legSeq 2).
  await waitFor(`${wd.withdrawNo} PAYOUT_PENDING`, async () => {
    const w: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
    if (w.status !== 'PAYOUT_PENDING') return null;
    const [payoutLeg] = await ctx.fundsOrders.findByParent({ withdrawTransactionId: wd.id }, { legSeq: 1 });
    return payoutLeg ? w : null;
  }, 8000);

  // Drive each leg (principal + fee) CREATED → CONFIRMED per its asset type. The
  // withdraw workflow's funds_order handler POSTs the TB leg + CLEARs it on
  // CONFIRMED, and flips the withdrawal to SUCCESS once ALL legs are CLEARED.
  const legs: any[] = await ctx.fundsOrders.findByParent({ withdrawTransactionId: wd.id }, {});
  for (const leg of legs.sort((a, b) => a.legSeq - b.legSeq)) {
    const legIsCrypto = (leg.asset?.type || '').toUpperCase() !== 'FIAT';
    const seq = legIsCrypto
      ? [FundsOrderAction.SUBMIT, FundsOrderAction.OBSERVE_CONFIRMING, FundsOrderAction.CONFIRM]
      : [FundsOrderAction.SUBMIT, FundsOrderAction.CONFIRM];
    for (const action of seq) {
      await ctx.fundsOrders.advance(leg.id, action, SIM);
      await sleep(60);
    }
  }

  await waitFor(`${wd.withdrawNo} SUCCESS`, async () => {
    const w: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
    if (w.status === 'SUCCESS') return w;
    if (['FAILED', 'RETURNED', 'REJECTED'].includes(w.status)) {
      throw new Error(`${wd.withdrawNo} terminal ${w.status} (expected SUCCESS)`);
    }
    return null;
  }, 8000);
  return wd;
}

export async function runWithdraws(ctx: DemoCtx): Promise<void> {
  console.log('═══ demo:withdraw — fiat (+crypto) withdrawals → SUCCESS ═══');
  const customers = await resolveDemoCustomers(ctx.prisma);
  for (const c of customers) {
    const plan = WITHDRAW_PLAN[c.email];
    const viban = await ctx.prisma.wallet.findFirst({ where: { ownerId: c.id, walletRole: 'C_VIBAN', assetId: ctx.aed.id } });
    if (!viban) throw new Error(`${c.email} missing C_VIBAN — run demo:setup first`);
    await driveWithdraw(ctx, c, ctx.aed, plan.fiatAed, viban.iban, undefined);
    if (plan.cryptoUsdt) {
      const idx = customerIdx(c.email);
      const toAddr = `T${createHash('sha256').update(`${SIM}wd${idx}`).digest('hex').slice(0, 33)}`;
      await driveWithdraw(ctx, c, ctx.usdt, plan.cryptoUsdt, undefined, toAddr);
    }
    console.log(`  ${c.customerNo} ${c.firstName}: withdrawals SUCCESS`);
  }
  // Real-time 1:1 model: withdrawal fee is posted directly to INCOME_WITHDRAW_FEE (211) in TB
  // — no WITHDRAW_FEE_SETTLEMENT legs or FeeAccrual rows to drive/settle.
}

// ── COA invariant helpers ─────────────────────────────────────────────────────

// Build a ledger→code→balance map by querying all active TB account registries and
// looking up each balance individually via AccountingService. This is equivalent to
// verify-realtime-coa.ts but reuses the NestJS accounting service already in ctx.
const ASSET_CODES = new Set([TB_ACCOUNT_CODES.CLIENT_ASSET, TB_ACCOUNT_CODES.FIRM_ASSET]);

async function buildCoaBalanceMap(ctx: DemoCtx): Promise<Map<number, Map<number, bigint>>> {
  // ledger → (code → aggregate balance)
  const byLedger = new Map<number, Map<number, bigint>>();
  const regs = await ctx.prisma.tbAccountRegistry.findMany({ where: { status: 'ACTIVE' } });
  for (const r of regs) {
    const balance = await ctx.accounting.lookupBalance(BigInt('0x' + r.tbAccountId));
    const isAsset = ASSET_CODES.has(r.code);
    const bal: bigint = isAsset
      ? balance.debitsPosted - balance.creditsPosted
      : balance.creditsPosted - balance.debitsPosted;
    if (!byLedger.has(r.ledger)) byLedger.set(r.ledger, new Map());
    const m = byLedger.get(r.ledger)!;
    m.set(r.code, (m.get(r.code) ?? 0n) + bal);
  }
  return byLedger;
}

// ── verification (spec §6) ───────────────────────────────────────────────────
export async function verifyEndState(ctx: DemoCtx): Promise<boolean> {
  console.log('\n═══ verify end-state (spec §6) ═══');
  const customers = await resolveDemoCustomers(ctx.prisma);
  const ids = customers.map((c) => c.id);
  const fails: string[] = [];
  let n = 0;
  const ok = (label: string, cond: boolean, detail = '') => {
    n += 1;
    if (cond) console.log(`  ✓ ${label}${detail ? ` (${detail})` : ''}`);
    else { fails.push(label); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
  };

  // 1. orders all terminal-good (scoped to demo customers)
  for (const [label, model, good] of [
    ['deposits SUCCESS', 'depositTransaction', 'SUCCESS'],
    ['swaps SUCCESS', 'swapTransaction', 'SUCCESS'],
    ['withdrawals SUCCESS', 'withdrawTransaction', 'SUCCESS'],
  ] as const) {
    const total = await ctx.prisma[model].count({ where: { ownerId: { in: ids } } });
    const bad = await ctx.prisma[model].count({ where: { ownerId: { in: ids }, status: { not: good } } });
    ok(`all demo ${label}`, total > 0 && bad === 0, `${total - bad}/${total} ${good}`);
  }

  // Withdraw payout principal legs (funds_orders legSeq=1) all CLEARED. Payouts
  // are no longer a separate table — the payout is the withdrawal's legSeq-1
  // funds order, driven CREATED → CLEARED alongside the withdrawal.
  {
    const wdIds = (
      await ctx.prisma.withdrawTransaction.findMany({ where: { ownerId: { in: ids } }, select: { id: true } })
    ).map((w: any) => w.id);
    const total = await ctx.prisma.fundsOrder.count({
      where: { withdrawTransactionId: { in: wdIds }, legSeq: 1 },
    });
    const bad = await ctx.prisma.fundsOrder.count({
      where: { withdrawTransactionId: { in: wdIds }, legSeq: 1, status: { not: 'CLEARED' } },
    });
    ok('all demo payout legs CLEARED', total > 0 && bad === 0, `${total - bad}/${total} CLEARED`);
  }

  // 2. COA invariants: CLIENT and FIRM balance per ledger (real-time 1:1 model proof)
  //    CLIENT: CLIENT_ASSET == Σ(CLIENT_PAYABLE + DEPOSIT_SUSPENSE) per ledger
  //    FIRM:   FIRM_ASSET == Σ(FIRM_OPS + FIRM_SET + INCOME_SWAP_FEE + INCOME_WITHDRAW_FEE + INCOME_OTHER) per ledger
  //    (asset accounts are debit-normal; liabilities/equity are credit-normal)
  const coaMap = await buildCoaBalanceMap(ctx);
  const LEDGER_NAMES: Record<number, string> = { [TB_LEDGERS.AED]: 'AED', [TB_LEDGERS.USDT]: 'USDT' };
  for (const [ledger, m] of coaMap) {
    const name = LEDGER_NAMES[ledger] ?? `ledger${ledger}`;
    const clientAsset = m.get(TB_ACCOUNT_CODES.CLIENT_ASSET) ?? 0n;
    const clientLiab = (m.get(TB_ACCOUNT_CODES.CLIENT_PAYABLE) ?? 0n) + (m.get(TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE) ?? 0n);
    ok(`COA CLIENT(${name}): CLIENT_ASSET == Σ(CLIENT_PAYABLE+DEPOSIT_SUSPENSE)`, clientAsset === clientLiab, `${clientAsset} == ${clientLiab}`);
    const firmAsset = m.get(TB_ACCOUNT_CODES.FIRM_ASSET) ?? 0n;
    const firmEquity = (m.get(TB_ACCOUNT_CODES.FIRM_OPS) ?? 0n) + (m.get(TB_ACCOUNT_CODES.FIRM_SET) ?? 0n) + (m.get(TB_ACCOUNT_CODES.INCOME_SWAP_FEE) ?? 0n) + (m.get(TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE) ?? 0n) + (m.get(TB_ACCOUNT_CODES.INCOME_OTHER) ?? 0n);
    ok(`COA FIRM(${name}): FIRM_ASSET == Σ(FIRM_OPS+FIRM_SET+INCOME_SWAP_FEE+INCOME_WITHDRAW_FEE+INCOME_OTHER)`, firmAsset === firmEquity, `${firmAsset} == ${firmEquity}`);
  }

  // 3./4. (removed C5b) The Outstanding + FeeAccrual tables — which these checks
  //    asserted stayed empty/unleaked under the real-time model — were dropped
  //    with the rest of the V7/V8 deferred-settlement residue. The "no deferred
  //    settlement rows" invariant is now structurally guaranteed by the schema
  //    (the tables no longer exist), so the runtime assertions are obsolete.

  console.log(`\n  asserts: ${n - fails.length}/${n} PASS`);
  if (fails.length) console.log(`  FAIL: ${fails.join('; ')}`);
  return fails.length === 0;
}
