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
// alongside them; deposit roster row #7 (⚡⑦) permanently customer-level
// sanctions him — a restriction that must not land on anyone who still needs
// to swap/withdraw later in the same run (see resolveFrozenPersona). His own
// later SWAP roster row (#13, also ⚡⑦) then finds order creation itself
// blocked (CAPABILITY_RESTRICTED) rather than landing FROZEN as a real order
// — see runSwaps' catch block below and task-C3-report.md/task-C3b-report.md.
// (WITHDRAW row #19 does NOT reuse Frank — see runWithdraws below.)
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
import { WITHDRAW_VERDICT_BUTTONS } from '../src/modules/withdraw-sumsub/fixtures/verdict-buttons';
import { SCENE_TAGS, DISPO_TAGS_BY_DOMAIN, type SceneTag, type DispoTag } from '../src/modules/sumsub-shared/scene-tags';
import { DEMO_ROSTER } from './demo-roster';
import { loginAsMlro, loginAsSmo, loginAsOpsOfficer, approveApproval } from './demo-mlro';
import { createStuckWithdraw } from './demo-fixtures';

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
// with the trio above, which DEMO_ROSTER's own SWAP/WITHDRAW rows and
// resolveDemoCustomers's tradeable-or-throw check require to stay tradeable
// start-to-finish, so this identity is deliberately kept OUT of
// DEMO_CUSTOMER_EMAILS and resolved separately via resolveFrozenPersona (no
// tradeability assertion — becoming untradeable mid-run is the point).
export const FROZEN_PERSONA_EMAIL = 'demo_frank@example.com';

// Withdraw plan: everyone a fiat AED withdraw; Alice/Bob also a crypto USDT one.
// Still consumed by ensureSetup below (crypto withdrawal-address provisioning) —
// NOT by runWithdraws, which is roster-driven (task-C3); left as-is.
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

  // Roster #18 (task-C3, DEMO_ROSTER) drives BOB through a single 250,000 AED
  // withdrawal meant to demo the LARGE_APPROVAL gate (threshold 200,000 AED —
  // seedTransactionLimitRules) landing PENDING_APPROVAL. BOB's seeded
  // tradingTier is BASIC, whose SEPARATE WITHDRAWAL/DAILY cumulative gate
  // (transaction-limit-gate.service.ts#evaluate) caps at defaultLimit=50,000
  // AED — a stricter, unrelated check that runs BEFORE the large-value gate
  // and rejects the request outright (TRANSACTION_LIMIT_CUMULATIVE_EXCEEDED)
  // without ever creating a row, regardless of prior usage (confirmed against
  // the live stack — task-C3-report.md). PREMIUM's DAILY default (500,000)
  // clears 250,000 comfortably. Demo-fixture knob only, mirrors bumpFee above
  // — not a roster edit, and scoped to this one customer (not the shared
  // BASIC-tier rule, which would also move Alice/Grace).
  await ctx.prisma.customerMain.update({
    where: { id: customers[1].id }, // demo_bob@example.com — DEMO_CUSTOMER_EMAILS order
    data: { tradingTier: 'PREMIUM' },
  });

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

// ── stage 3: swaps (3-entry roster; 4-leg two-phase orchestration to SUCCESS) ──

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

// Roster: scripts/demo-roster.ts DEMO_ROSTER (domain === 'SWAP', 3 rows) — same
// "real service/workflow methods only" contract as runDeposits above.
//   · ⚡① drives SwapWorkflowService.applyKytVerdict({verdict:'approved'}) directly
//     — initiateSwap itself books nothing (swap sits COMPLIANCE_PENDING until a
//     KYT verdict lands); no real Sumsub webhook in demo/local, so the verdict is
//     applied the same way createRosterDeposit/driveVerdict do for deposits.
//   · #13 (FRANK, ⚡⑦) is the one row that does NOT reach a verdict at all: by the
//     time swaps run, deposit roster row #7 has already opened a customer-level
//     SANCTION restriction on FRANK (scope=ALL — restriction-cause.constant.ts),
//     and initiateSwap's very first check (customerAccessService
//     .assertTradingEligibility → assertCapability) throws CAPABILITY_RESTRICTED
//     synchronously, before any swapTransaction row is inserted. Unlike DEPOSIT
//     (whose detected() has no upfront capability gate, so a restricted
//     customer's deposit still gets created and is pre-empted to FROZEN
//     afterward — see runDeposits' #10 comment), SWAP has no such "create then
//     freeze" path: there is nothing to apply ⚡⑦ to. Confirmed against the live
//     stack (task-C3-report.md) — no order is produced for #13, so nothing is
//     pushed to `results`; printAnswerKey already renders that as "（没造出来）".
export async function runSwaps(ctx: DemoCtx): Promise<Array<{ seq: number; orderNo: string; status: string }>> {
  console.log('═══ demo:swap — 3 笔按花名册铺 ═══');
  const customers = await resolveDemoCustomers(ctx.prisma);
  const frozenPersona = await resolveFrozenPersona(ctx.prisma);
  const byEmail = new Map([...customers, frozenPersona].map((c) => [c.email, c]));

  const results: Array<{ seq: number; orderNo: string; status: string }> = [];

  for (const entry of DEMO_ROSTER.filter((r) => r.domain === 'SWAP')) {
    const c = byEmail.get(entry.customerEmail);
    if (!c) throw new Error(`roster #${entry.seq}: customer ${entry.customerEmail} not resolved`);

    const sellUsdt = entry.currency === 'USDT';
    const from = sellUsdt ? ctx.usdt : ctx.aed;
    const to = sellUsdt ? ctx.aed : ctx.usdt;

    let swap: any;
    try {
      const quote: any = await ctx.swapQuote.createQuote({
        ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
        fromAssetId: from.id, fromAssetCode: from.currency,
        toAssetId: to.id, toAssetCode: to.currency,
        amount: new Prisma.Decimal(entry.amount), customerId: c.id,
      } as any);
      swap = await ctx.swapWf.initiateSwap(c.id, quote.id);
    } catch (e: any) {
      // See the roster-comment block above (#13/FRANK). INSUFFICIENT_BALANCE is
      // kept alongside CAPABILITY_RESTRICTED as the same family of expected
      // creation-time rejection for this row — FRANK's only two deposits
      // (#7 FROZEN, #10 SEIZED) never credit his available balance either.
      const code = e?.response?.code ?? e?.code;
      if (code === 'CAPABILITY_RESTRICTED' || code === 'INSUFFICIENT_BALANCE') {
        console.log(`  #${entry.seq} ${entry.label}: 建单被拒 ${code} —— ${c.customerNo} 无法产出订单（详见任务报告）`);
        continue;
      }
      throw e;
    }
    console.log(`  #${entry.seq} ${entry.label}: ${swap.swapNo} ${sellUsdt ? 'USDT→AED' : 'AED→USDT'} ${entry.amount} (COMPLIANCE_PENDING)`);

    switch (entry.seq) {
      case 11:
      case 12:
        // riskScore 5 = SWAP_VERDICT_BUTTONS.V1_APPROVED 的真实 score（不传的话
        // sumsub_score 落 NULL，详情页 L2 副行只能显示 'Awaiting Sumsub verdict'）。
        await ctx.swapWf.applyKytVerdict(swap.id, { verdict: 'approved', riskScore: 5 });
        await driveSwapToSuccess(ctx, { id: swap.id, swapNo: swap.swapNo });
        break;
      case 13:
        // 理论上的原生路径（若某次运行 FRANK 尚未被限制）：⚡⑦ =
        // V7_REJECTED_SANCTION_APPLICANT（score 98）—— 兑换的 FROZEN 是零出边
        // 终态，没有没收/退回/上缴那类处置弧。当前实测下不可达，见上方 catch。
        await ctx.swapWf.applyKytVerdict(swap.id, { verdict: 'rejected', riskScore: 98, sceneTag: 'SANCTION_APPLICANT' });
        break;
    }

    const final: any = await ctx.prisma.swapTransaction.findUnique({ where: { id: swap.id } });
    results.push({ seq: entry.seq, orderNo: final.swapNo, status: final.status });
    console.log(`  #${entry.seq} ${entry.label}: ${final.swapNo} → ${final.status}`);
  }

  return results;
}

// ── stage 4: withdrawals (7-entry roster, incl. large-value gate + in-transit) ─
//
// Roster: scripts/demo-roster.ts DEMO_ROSTER (domain === 'WITHDRAW', 7 rows) —
// same "real service/workflow methods only" contract as runDeposits/runSwaps.
//   · ⚡ buttons drive WithdrawWorkflowService.applyKytVerdict directly, verdict
//     args derived from WITHDRAW_VERDICT_BUTTONS (verdictArgsForWithdrawButton
//     below) — the same table the admin demo panel renders for withdraw orders.
//     Kept as its own function rather than parameterising deposits'
//     verdictArgsForButton — deliberate fork, the same convention
//     withdraw-workflow.service.ts's own applyKytRejected uses against its
//     deposit counterpart (see that method's header comment: "两域各写一遍,不抽
//     公共方法").
//   · #18 (大额闸, driver='超大额闸' — not a ⚡ button) needs no verdict at all:
//     WithdrawWorkflowService's own handleWithdrawalCreated
//     (@OnEvent(WITHDRAWAL_CREATED), fire-and-forget) auto-routes any
//     withdrawal ≥ the LARGE_APPROVAL threshold (200,000 AED,
//     transaction_limit_rules seed) from COMPLIANCE_PENDING to
//     PENDING_APPROVAL before Sumsub submission — the roster wants it parked
//     there, unapproved (see ensureSetup's BOB→PREMIUM comment above for why
//     BOB needs that tier bump to even reach this gate).
//   · #19 (GRACE, ⚡⑨ V9_REJECTED_MLRO_FREEZE) — deliberately NOT FRANK/⚡⑦
//     (task-C3b-report.md): a customer-level SANCTION restriction (⚡⑦) would
//     make this row hit the exact same CAPABILITY_RESTRICTED wall as runSwaps'
//     #13 (see that comment block) — order creation itself would be blocked,
//     never landing FROZEN as a real order. ⚡⑨'s dispoTag=FROZEN_BY_MLRO takes
//     a different branch in withdraw-workflow.service.ts#applyKytRejected:
//     `if (isApplicantSanction || sceneTag === 'SANCTION_COUNTERPARTY' ||
//     dispoTag === 'FROZEN_BY_MLRO')` freezes the order, but the
//     customerRestrictionsService.open() call inside that block is gated on
//     `if (isApplicantSanction)` only (sceneTag==='SANCTION_APPLICANT') — a
//     bare dispoTag hit never opens a restriction. So this order can be
//     created and driven through COMPLIANCE_PENDING → FROZEN like any other
//     row, and GRACE stays fully tradeable (no other roster row depends on
//     that, but it's true regardless).
//   · #20 (在途单) is not created via createWithdrawal at all — it reuses
//     demo-fixtures.ts's createStuckWithdraw fixture verbatim (task-C3
//     background note 2): same real quote→createWithdrawal→applyKytVerdict
//     path, deliberately stopped mid-leg (SUBMITTED, never CONFIRMED) so the
//     withdrawal itself never leaves PAYOUT_PENDING.

const WITHDRAW_DISPO_TAGS = DISPO_TAGS_BY_DOMAIN.WITHDRAW;

/** Withdraw analog of verdictArgsForButton (deposits, above) — reads
 *  WITHDRAW_VERDICT_BUTTONS instead of DEPOSIT_VERDICT_BUTTONS. */
function verdictArgsForWithdrawButton(buttonKey: string) {
  const button = WITHDRAW_VERDICT_BUTTONS[buttonKey];
  if (!button) throw new Error(`unknown withdraw verdict button: ${buttonKey}`);
  const verdict = VERDICT_BY_WEBHOOK_TYPE[button.webhookType];
  if (!verdict) throw new Error(`button ${buttonKey} has no approved/rejected/awaitUser mapping (webhookType=${button.webhookType})`);

  let sceneTag: SceneTag | undefined;
  let dispoTag: DispoTag | undefined;
  for (const tag of button.verdict.typedTags ?? []) {
    if (tag.type !== 'userDefined') continue;
    if (SCENE_TAGS.has(tag.label as SceneTag)) sceneTag = tag.label as SceneTag;
    if (WITHDRAW_DISPO_TAGS.has(tag.label as DispoTag)) dispoTag = tag.label as DispoTag;
  }

  return {
    verdict,
    riskScore: button.verdict.score,
    ...(sceneTag && { sceneTag }),
    ...(dispoTag && { dispoTag }),
    ...(button.verdict.applicantActions?.length && { applicantActions: button.verdict.applicantActions }),
  };
}

async function waitWithdrawStatus(ctx: DemoCtx, withdrawId: string, status: string, timeoutMs = 15000): Promise<any> {
  return waitFor(`withdrawal reaches ${status}`, async () => {
    const w: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: withdrawId } });
    return w?.status === status ? w : null;
  }, timeoutMs);
}

/** Feeds one ⚡ verdict button into a COMPLIANCE_PENDING withdrawal via the real
 *  WithdrawWorkflowService.applyKytVerdict — mirrors driveVerdict (deposits)
 *  above. No-op (logs) if the withdrawal already moved elsewhere (e.g. #18's
 *  large-value gate auto-routing it to PENDING_APPROVAL first). */
async function driveWithdrawVerdict(ctx: DemoCtx, withdrawId: string, buttonKey: string): Promise<any> {
  const current: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: withdrawId } });
  if (current.status !== 'COMPLIANCE_PENDING') {
    console.log(`    ⚡${buttonKey} skipped — ${current.withdrawNo} already ${current.status}`);
    return current;
  }
  await ctx.withdrawWf.applyKytVerdict(withdrawId, verdictArgsForWithdrawButton(buttonKey));
  return ctx.prisma.withdrawTransaction.findUnique({ where: { id: withdrawId } });
}

/** Creates one withdrawal via the real quote+createWithdrawal path, retrying on
 *  the known WD-number collision (generateReferenceNo('WD') only draws a
 *  4-digit random — a crowded same-day namespace can collide on withdrawNo;
 *  underlying weakness is production-side, flagged separately). Returns as soon
 *  as the row exists ("born" at COMPLIANCE_PENDING) — callers drive it the rest
 *  of the way per their roster row's target status. */
async function createRosterWithdraw(
  ctx: DemoCtx, c: any, asset: any, amount: string, dest: { toIban?: string; toAddress?: string },
): Promise<any> {
  const wq: any = await ctx.withdrawQuote.createQuote({
    ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
    assetId: asset.id, assetCode: asset.currency, amount: new Prisma.Decimal(amount), customerId: c.id,
  } as any);
  for (let attempt = 1; ; attempt++) {
    try {
      return await ctx.withdrawWf.createWithdrawal(
        { assetId: asset.id, amount, toIban: dest.toIban, toAddress: dest.toAddress, quoteId: wq.id } as any,
        c.id, 'CUSTOMER',
      );
    } catch (e: any) {
      if (e?.code === 'P2002' && attempt < 8) { await sleep(60); continue; }
      throw e;
    }
  }
}

/** Drives every leg (principal + fee) of a PAYOUT_PENDING withdrawal CREATED →
 *  CONFIRMED, same per-asset-type action sequence the old driveWithdraw used —
 *  the withdraw workflow's funds_order handler POSTs the TB leg + CLEARs it on
 *  CONFIRMED, flipping the withdrawal to SUCCESS once every leg is CLEARED. */
async function driveWithdrawLegsToSuccess(ctx: DemoCtx, withdrawId: string, withdrawNo: string): Promise<void> {
  // At PAYOUT_PENDING the workflow has materialised the payout principal funds
  // order (legSeq 1) and, when a fee was charged, the fee funds order (legSeq 2).
  await waitFor(`${withdrawNo} PAYOUT_PENDING`, async () => {
    const w: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: withdrawId } });
    if (w.status !== 'PAYOUT_PENDING') return null;
    const [payoutLeg] = await ctx.fundsOrders.findByParent({ withdrawTransactionId: withdrawId }, { legSeq: 1 });
    return payoutLeg ? w : null;
  }, 8000);

  const legs: any[] = await ctx.fundsOrders.findByParent({ withdrawTransactionId: withdrawId }, {});
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

  await waitFor(`${withdrawNo} SUCCESS`, async () => {
    const w: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: withdrawId } });
    if (w.status === 'SUCCESS') return w;
    if (['FAILED', 'RETURNED', 'REJECTED'].includes(w.status)) {
      throw new Error(`${withdrawNo} terminal ${w.status} (expected SUCCESS)`);
    }
    return null;
  }, 8000);
}

export async function runWithdraws(ctx: DemoCtx): Promise<Array<{ seq: number; orderNo: string; status: string }>> {
  console.log('═══ demo:withdraw — 7 笔按花名册铺(含大额闸 + 在途单) ═══');
  const customers = await resolveDemoCustomers(ctx.prisma);
  const frozenPersona = await resolveFrozenPersona(ctx.prisma);
  const byEmail = new Map([...customers, frozenPersona].map((c) => [c.email, c]));

  const results: Array<{ seq: number; orderNo: string; status: string }> = [];

  for (const entry of DEMO_ROSTER.filter((r) => r.domain === 'WITHDRAW')) {
    const c = byEmail.get(entry.customerEmail);
    if (!c) throw new Error(`roster #${entry.seq}: customer ${entry.customerEmail} not resolved`);

    // #20 在途单 —— demo-in-transit.ts's own fixture, not createWithdrawal.
    if (entry.seq === 20) {
      const stuck = await createStuckWithdraw(ctx, { customer: c, asset: ctx.aed, amount: entry.amount, cutoff: new Date() });
      const wd: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { withdrawNo: stuck.withdrawNo } });
      results.push({ seq: entry.seq, orderNo: wd.withdrawNo, status: wd.status });
      console.log(`  #${entry.seq} ${entry.label}: ${wd.withdrawNo} → ${wd.status}`);
      continue;
    }

    const isUsdt = entry.currency === 'USDT';
    const asset = isUsdt ? ctx.usdt : ctx.aed;
    let toIban: string | undefined;
    let toAddress: string | undefined;
    if (isUsdt) {
      const idx = customerIdx(c.email);
      toAddress = `T${createHash('sha256').update(`${SIM}wd${idx}`).digest('hex').slice(0, 33)}`;
    } else {
      const viban = await ctx.prisma.wallet.findFirst({ where: { ownerId: c.id, walletRole: 'C_VIBAN', assetId: ctx.aed.id } });
      if (!viban) throw new Error(`${c.email} missing C_VIBAN — run demo:setup first`);
      toIban = viban.iban;
    }

    // No try/catch here (unlike runSwaps' #13): every WITHDRAW roster row
    // belongs to alice/bob/grace, who resolveDemoCustomers above already
    // guarantees are unrestricted — #19 (GRACE, ⚡⑨) is created and driven the
    // same way as every other row, never hits CAPABILITY_RESTRICTED (see the
    // roster-comment block above for why FRANK/⚡⑦ isn't used here).
    const wd = await createRosterWithdraw(ctx, c, asset, entry.amount, { toIban, toAddress });
    console.log(`  #${entry.seq} ${entry.label}: ${wd.withdrawNo} ${entry.amount} ${asset.currency} (${wd.status})`);

    switch (entry.seq) {
      case 14:
      case 15:
      case 16:
        await driveWithdrawVerdict(ctx, wd.id, 'V1_APPROVED');
        await driveWithdrawLegsToSuccess(ctx, wd.id, wd.withdrawNo);
        break;
      case 17:
        await driveWithdrawVerdict(ctx, wd.id, 'V2_AWAIT_USER');
        await waitWithdrawStatus(ctx, wd.id, 'ACTION_PENDING');
        break;
      case 18:
        // 超大额闸——不需要也不该应用任何 KYT 判决，见上方 roster-comment 块。
        // 不批准：它就该停在这给演示看。
        await waitWithdrawStatus(ctx, wd.id, 'PENDING_APPROVAL');
        break;
      case 19:
        // MLRO 冻结（⚡⑨，非制裁）——只冻这一笔单，不碰 GRACE 的客户级能力，
        // 见上方 roster-comment 块。
        await driveWithdrawVerdict(ctx, wd.id, 'V9_REJECTED_MLRO_FREEZE');
        await waitWithdrawStatus(ctx, wd.id, 'FROZEN');
        break;
    }

    const final: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
    results.push({ seq: entry.seq, orderNo: final.withdrawNo, status: final.status });
    console.log(`  #${entry.seq} ${entry.label}: ${final.withdrawNo} → ${final.status}`);
  }

  return results;
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
