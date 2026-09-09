// scripts/demo-lib.ts
//
// Shared library for the demo transaction-data layer.
// Spec: doc-final/superpowers/specs/2026-06-21-demo-transaction-data-layer-design.md
//
// Drives the REAL domain/workflow services (no Prisma backdoors — same path as a
// human clicking in admin) to produce a reproducible day of business activity for
// the tradeable business-seed customers (Alice/Bob/Grace):
//   setup → Frank pre-stage → deposits → swaps → withdrawals.
// A 4th persona (Frank, FROZEN_PERSONA_EMAIL) is set up alongside them; deposit
// roster row #7 (⚡⑦) permanently customer-level sanctions him — a restriction
// that must not land on anyone who still needs to swap/withdraw later in the
// same run (see resolveFrozenPersona). His own later SWAP roster row (#13,
// expectedStatus FROZEN) is frozen by that SAME sanction's broadcast
// (CUSTOMER_RESTRICTION_OPENED → SwapWorkflowService.onCustomerRestrictionOpened
// sweeps his in-flight COMPLIANCE_PENDING swaps) — but only because
// runFrankPreStage() (new pre-stage, run BEFORE runDeposits) funds him (roster
// row #21, a plain SUCCESS deposit) and creates #13's order while he's still
// unrestricted. Neither holds by default: initiateSwap synchronously rejects a
// restricted customer (CAPABILITY_RESTRICTED) and separately requires sell-side
// balance up front (INSUFFICIENT_BALANCE), and Frank has no other roster row
// that ever credits him — see runFrankPreStage's own header comment for the
// full mechanism (task-C3-report.md/task-C3b-report.md document the two dead
// ends that made the pre-stage necessary; task-C3c-report.md is the fix).
// (WITHDRAW row #19 does NOT reuse Frank — see runWithdraws below.)
//
// End-state (after runAll): every one of DEMO_ROSTER's 21 rows lands on the
// exact status the roster names — not "all SUCCESS" (a rich demo day has
// frozen/confiscated/returned/seized/in-flight orders on purpose: deposit #7
// FROZEN, #10 SEIZED, swap #13 FROZEN, withdraw #20 PAYOUT_PENDING, etc — see
// DEMO_ROSTER for the full 21-row expected shape). verifyEndState() proves
// this by feeding runDeposits/runSwaps/runWithdraws' own returned
// {seq,orderNo,status} results into printAnswerKey() (scripts/demo-roster.ts),
// which compares each roster row's expectedStatus against the matching seq.
// Anything NOT produced by one of those three roster-driven functions — e.g.
// the two standalone stray orders demo:in-transit's own fixture creates —
// never enters that array and is therefore silently ignored, by construction
// (task-C4-report.md). Both COA invariants (CLIENT + FIRM) hold per ledger;
// no Outstanding or FeeAccrual rows created (real-time 1:1 model).
// verifyEndState() asserts this.

import { requireStackEnv } from './require-stack-env';
requireStackEnv({ requireTb: true });

import { createHash } from 'node:crypto';

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
import { DEMO_ROSTER, printAnswerKey, RosterDomain } from './demo-roster';
import { loginAsMlro, loginAsSmo, loginAsCfo, approveApproval } from './demo-mlro';
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
import { writeSeedAudit } from '../prisma/seed-audit.helper';
import { buildDeterministicNo } from '../src/common/utils/no-generator.util';

// ── constants ────────────────────────────────────────────────────────────────
export const SIM = 'DEMO'; // deterministic-no tag + operatorId for driven legs

import { fakeTronAddress } from '../src/common/utils/tron-address.util';

// Tradeable business-seed customers (onboarding APPROVED + compliance CLEAR).
// Order matters: index → deterministic refs/addresses.
export const DEMO_CUSTOMER_EMAILS = [
  'demo_alice@example.com',
  'demo_bob@example.com',
  'demo_grace@example.com',
  // 对账素材人设——进这个名单就自动拿到 C_VIBAN/C_DEP 两个钱包、客户级 TB 科目、
  // 以及法币提现地址（2026-07-11 上线的交易前置闸要求客户有 active 法币提现地址，
  // 否则第一笔充值就会被 hold 住）。
  'demo_jack@example.com',
  'demo_kate@example.com',
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
  ['withdrawalFeeLevel', 'STD-AED-AED_ZAND', 'WITHDRAW_SERVICE_FEE', '2'], // 2 AED flat
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

/** Roster row count for one domain, read live off DEMO_ROSTER — the three
 *  demo:deposit/demo:swap/demo:withdraw banners below print this instead of a
 *  hardcoded number so adding/removing roster rows can't leave a stale count
 *  on screen (2026-08-30: caught printing "11 笔"/"3 笔" after the roster grew
 *  to 18/4 — same class of trap as the runDeposits switch missing a default). */
function nOf(d: RosterDomain): number {
  return DEMO_ROSTER.filter((r) => r.domain === d).length;
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
  /** Populated by runFrankPreStage() (must run before runDeposits/runSwaps) —
   *  see that function's header comment for why FRANK's capital deposit
   *  (roster #21) and swap (#13) both have to be created ahead of the normal
   *  deposit/swap stages. runDeposits()/runSwaps() read these ids back
   *  instead of creating new orders for those two rows. */
  frankPreStage?: { depositId: string; swapId: string };
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

    // C_DEP（TRON 收款地址）
    const depNo = buildDeterministicNo('WA', SIM, 'C_DEP', c.customerNo);
    await ctx.prisma.wallet.upsert({
      where: { walletNo: depNo }, update: {},
      create: {
        walletNo: depNo, ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
        vaultCode: 'CLIENT_DEPOSIT', walletRole: 'C_DEP', network: 'TRON',
        address: fakeTronAddress(depNo), custodianRef: `hextrust-demo-${c.customerNo}`, status: 'ACTIVE',
      },
    });
    await writeSeedAudit(ctx.prisma, {
      action: 'CUSTOMER_DEPOSIT_ADDRESS_SEEDED', subjectType: 'WALLET', subjectNo: depNo, actorNo: 'DEMO_SEED', ownerCustomerNo: c.customerNo,
      afterData: { network: 'TRON', walletRole: 'C_DEP', address: fakeTronAddress(depNo) },
    });

    // C_VIBAN（AED_ZAND 虚拟账号）
    const vibanNo = buildDeterministicNo('WA', SIM, 'C_VIBAN', c.customerNo);
    const vibanIban = `AE07086${createHash('sha256').update(vibanNo).digest('hex').replace(/\D/g, '').padEnd(16, '0').slice(0, 16)}`;
    await ctx.prisma.wallet.upsert({
      where: { walletNo: vibanNo }, update: {},
      create: {
        walletNo: vibanNo, ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
        vaultCode: 'CLIENT_DEPOSIT', walletRole: 'C_VIBAN', network: 'AED_ZAND',
        iban: vibanIban, custodianRef: `zand-demo-${c.customerNo}`, status: 'ACTIVE',
      },
    });
    await writeSeedAudit(ctx.prisma, {
      action: 'CUSTOMER_DEPOSIT_ADDRESS_SEEDED', subjectType: 'WALLET', subjectNo: vibanNo, actorNo: 'DEMO_SEED', ownerCustomerNo: c.customerNo,
      afterData: { network: 'AED_ZAND', walletRole: 'C_VIBAN', iban: vibanIban },
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
      where: { customerId_network_address: { customerId: c.id, network: 'AED_ZAND', address: vibanIban } },
      update: { status: 'ACTIVE' },
      create: {
        addressNo: wdAddrNo, customerId: c.id, customerNo: c.customerNo,
        network: 'AED_ZAND', address: vibanIban, addressType: 'BANK', iban: vibanIban,
        ownershipDeclaredAt: new Date(), ownershipProofType: 'DEMO_FIXTURE',
        status: 'ACTIVE', activatesAt: new Date(Date.now() - 1000),
        traceId: `demo-setup-withdrawal-address-${c.customerNo}`,
      },
    });
    await writeSeedAudit(ctx.prisma, {
      action: 'WITHDRAWAL_ADDRESS_SEEDED', subjectType: 'WITHDRAWAL_ADDRESS', subjectNo: wdAddrNo, actorNo: 'DEMO_SEED', ownerCustomerNo: c.customerNo,
      afterData: { network: 'AED_ZAND', addressType: 'BANK', address: vibanIban },
    });

    // Registered crypto withdrawal destination — Task 3's per-transaction hard
    // guard (createWithdrawal requires the EXACT target address on file, on
    // top of the trading-ready "has ≥1 BANK address" gate above). Only
    // WITHDRAW_PLAN entries with a `cryptoUsdt` leg (alice/bob) need one;
    // must match runWithdraws' own deterministic address derivation exactly.
    if (WITHDRAW_PLAN[c.email]?.cryptoUsdt) {
      const idx = customerIdx(c.email);
      const cryptoWdAddr = fakeTronAddress(`${SIM}wd${idx}`);
      const cryptoWdAddrNo = buildDeterministicNo('WA', SIM, 'WD_CRYPTO', c.customerNo);
      await ctx.prisma.withdrawalAddress.upsert({
        where: { customerId_network_address: { customerId: c.id, network: 'TRON', address: cryptoWdAddr } },
        update: { status: 'ACTIVE' },
        create: {
          addressNo: cryptoWdAddrNo, customerId: c.id, customerNo: c.customerNo,
          network: 'TRON', address: cryptoWdAddr, addressType: 'SELF_CUSTODY',
          ownershipDeclaredAt: new Date(), ownershipProofType: 'DEMO_FIXTURE',
          status: 'ACTIVE', activatesAt: new Date(Date.now() - 1000),
          traceId: `demo-setup-withdrawal-address-crypto-${c.customerNo}`,
        },
      });
      await writeSeedAudit(ctx.prisma, {
        action: 'WITHDRAWAL_ADDRESS_SEEDED', subjectType: 'WITHDRAWAL_ADDRESS', subjectNo: cryptoWdAddrNo, actorNo: 'DEMO_SEED', ownerCustomerNo: c.customerNo,
        afterData: { network: 'TRON', addressType: 'SELF_CUSTODY', address: cryptoWdAddr },
      });
    }
  }

  await provisionTbAccounts(ctx.prisma);
  console.log(`  setup done: ${[...customers, frozenPersona].map((c) => c.customerNo).join(', ')}`);
}

// ── stage 1.5: Frank's pre-stage capital + swap (must run BEFORE runDeposits) ─
//
// SWAP roster row #13 (FRANK, expectedStatus FROZEN) needs a real in-flight
// COMPLIANCE_PENDING swap order sitting on the books at the exact moment
// deposit roster row #7 opens FRANK's customer-level SANCTION restriction
// (scope=ALL) — that broadcast (CUSTOMER_RESTRICTION_OPENED) is the ONLY way
// #13 ever reaches FROZEN: SwapWorkflowService.onCustomerRestrictionOpened
// sweeps every COMPLIANCE_PENDING swap belonging to the just-restricted
// customer straight to FROZEN (swap-workflow.service.ts:1783). Two hard
// preconditions block getting there any other way, both confirmed dead ends
// (task-C3-report.md / task-C3b-report.md):
//
//   1. initiateSwap's balance pre-check (swap-workflow.service.ts:288-314)
//      requires FRANK to already hold ≥ the sell amount in his available
//      CLIENT_PAYABLE balance before the order can even be created — and
//      FRANK has no OTHER roster row that ever credits him before #7/#10
//      permanently sanction/seize him. Roster row #21 (a plain SUCCESS AED
//      deposit) exists solely to fund him first.
//
//   2. initiateSwap's synchronous assertTradingEligibility gate
//      (swap-workflow.service.ts:206) throws CAPABILITY_RESTRICTED the
//      instant FRANK carries an OPEN restriction — so #13's order has to be
//      CREATED strictly before #7 fires. demo:all's pipeline is staged
//      setup → deposits → swaps → withdraws (scripts/demo-all.ts): deposit
//      row #7 always finishes long before runSwaps() is even called, so
//      #13's creation cannot live inside the normal SWAP stage — it has to
//      run in its own pre-stage, ahead of runDeposits().
//
// So this function does both, in order, right after ensureSetup(): drives #21
// all the way to SUCCESS (same V1_APPROVED path as roster rows #1-3), then
// creates #13's swap (quote + initiateSwap only — no verdict; initiateSwap
// alone books nothing beyond the COMPLIANCE_PENDING row) and hands its id
// back via ctx.frankPreStage for runSwaps() to pick up later, once #7 (inside
// the runDeposits() call that follows) has actually frozen it.
export async function runFrankPreStage(ctx: DemoCtx): Promise<Array<{ seq: number; orderNo: string; status: string }>> {
  console.log('═══ demo:frank-prestage — FRANK 本金充值 + 兑换建单（须早于 #7 制裁）═══');
  const frank = await resolveFrozenPersona(ctx.prisma);

  const depositEntry = DEMO_ROSTER.find((r) => r.seq === 21)!;
  const aedWallet = await ctx.prisma.wallet.findFirst({
    where: { ownerId: frank.id, walletRole: 'C_VIBAN', network: 'AED_ZAND' },
  });
  if (!aedWallet) throw new Error(`${frank.email} missing C_VIBAN — run demo:setup first`);

  let dep = await createRosterDeposit(ctx, frank, ctx.aed, aedWallet.id, depositEntry.amount, PayinType.FIAT, depositEntry.seq);
  await driveVerdict(ctx, dep.id, 'V1_APPROVED');
  dep = await waitDepositStatus(ctx, dep.id, 'SUCCESS');
  console.log(`  #${depositEntry.seq} ${depositEntry.label}: ${dep.depositNo} → ${dep.status}`);

  const swapEntry = DEMO_ROSTER.find((r) => r.seq === 13)!;
  const sellUsdt = swapEntry.currency === 'USDT';
  const from = sellUsdt ? ctx.usdt : ctx.aed;
  const to = sellUsdt ? ctx.aed : ctx.usdt;
  const quote: any = await ctx.swapQuote.createQuote({
    ownerType: 'CUSTOMER', ownerId: frank.id, ownerNo: frank.customerNo,
    fromAssetId: from.id, fromAssetCode: from.currency,
    toAssetId: to.id, toAssetCode: to.currency,
    amount: new Prisma.Decimal(swapEntry.amount), customerId: frank.id,
  } as any);
  const swap = await ctx.swapWf.initiateSwap(frank.id, quote.id);
  ctx.frankPreStage = { depositId: dep.id, swapId: swap.id };
  console.log(`  #${swapEntry.seq} ${swapEntry.label}: ${swap.swapNo} AED→USDT ${swapEntry.amount} (COMPLIANCE_PENDING —— 等 runDeposits 里的 #7 广播连坐冻结)`);

  return [{ seq: depositEntry.seq, orderNo: dep.depositNo, status: dep.status }];
}

// ── stage 2: deposits (18-entry roster, incl. 3 disposition arcs; #21 is
//    pre-staged by runFrankPreStage() above and just re-reported here) ───────
//
// Roster: scripts/demo-roster.ts DEMO_ROSTER (domain === 'DEPOSIT', 18 rows,
// incl. #21 — see the stage banner above for how that one is handled) — every
// row drives to whatever status the roster names, via the REAL service/
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
 *  waits for it to leave PAYIN_PENDING — either COMPLIANCE_PENDING (L1 ran
 *  and passed) or somewhere L1 routed it to on its own (e.g. straight to
 *  FROZEN, when an earlier roster row already sanctioned this same customer —
 *  see #10 below). L1 runs off a fire-and-forget `emit()` (not `emitAsync` —
 *  see test/deposit-money-arcs.e2e-spec.ts's header comment for the same race on
 *  funds-order events), so this has to poll rather than trust the immediate
 *  post-CONFIRM state. */
async function createRosterDeposit(
  ctx: DemoCtx, c: any, asset: any, walletId: string, amount: string, type: PayinType, seq: number,
): Promise<any> {
  const idx = customerIdx(c.email);
  // 种子必须按 seq（花名册行号，全表 1-29 唯一）取，不能按 walletId 取——同一钱包在
  // 同一天入好几笔是常态（如 #24/#25 同为 JACK 的 AED 钱包），按 walletId 取会让
  // 这几笔的 txHash/referenceNo 完全撞号；生产路径按 fundsOrderNo 取正是同一个
  // 唯一性要求（funds-order.service.ts buildExternalRefPatch），这里的 funds order
  // 此刻还没建出来（正是 detected() 要建的），拿不到号，用 seq 顶上。
  const { deposit: dep, fundsOrder: fo }: any = await ctx.deposits.detected({
    assetId: asset.id, toWalletId: walletId, amount,
    txHash: type === PayinType.CRYPTO ? fakeChainTxHash(`DEP${seq}`) : undefined,
    fromAddress: type === PayinType.CRYPTO ? `Tsender${idx}` : undefined,
    fromIban: type === PayinType.FIAT ? `AE00SENDER${idx}` : undefined,
    referenceNo: fakeBankRef(`DEP${seq}`, new Date()),
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
 *  No-ops (just logs) if L1 already moved the deposit elsewhere. */
async function driveVerdict(ctx: DemoCtx, depositId: string, buttonKey: string): Promise<any> {
  const current: any = await ctx.deposits.findOne(depositId);
  if (current.status !== 'COMPLIANCE_PENDING') {
    console.log(`    ⚡${buttonKey} skipped — ${current.depositNo} already ${current.status} (L1 pre-empted)`);
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

/** Checker step(s) of a maker-checker disposition: logs in for real + approves
 *  once per required step, in order (SEIZE needs two distinct real logins —
 *  SENIOR_MANAGEMENT_OFFICER then MLRO, four-eyes). The approve endpoint takes
 *  approvalNo directly (Task 17) — no internal-id lookup needed. */
async function makerCheckerApprove(ctx: DemoCtx, approvalNo: string, logins: Array<() => Promise<string>>): Promise<void> {
  for (const login of logins) {
    const token = await login();
    await approveApproval(ctx.apiBase, token, approvalNo);
  }
}

export async function runDeposits(ctx: DemoCtx): Promise<Array<{ seq: number; orderNo: string; status: string }>> {
  console.log(`═══ demo:deposit — ${nOf('DEPOSIT')} 笔按花名册铺（含三条处置弧 + FRANK 预铺本金 #21）═══`);
  const customers = await resolveDemoCustomers(ctx.prisma);
  // roster rows #7/#10 target the frozen persona (FRANK), not the tradeable
  // trio — resolve him too so byEmail/wallets below can find him.
  const frozenPersona = await resolveFrozenPersona(ctx.prisma);
  const depositCustomers = [...customers, frozenPersona];
  const byEmail = new Map(depositCustomers.map((c) => [c.email, c]));

  const wallets = new Map<string, { usdt: any; aed: any }>();
  for (const c of depositCustomers) {
    const usdtWallet = await ctx.prisma.wallet.findFirst({ where: { ownerId: c.id, walletRole: 'C_DEP', network: 'TRON' } });
    const aedWallet = await ctx.prisma.wallet.findFirst({ where: { ownerId: c.id, walletRole: 'C_VIBAN', network: 'AED_ZAND' } });
    if (!usdtWallet || !aedWallet) throw new Error(`${c.email} missing C_DEP/C_VIBAN — run demo:setup first`);
    wallets.set(c.email, { usdt: usdtWallet, aed: aedWallet });
  }

  const driven: Array<{ seq: number; depositId: string }> = [];

  for (const entry of DEMO_ROSTER.filter((r) => r.domain === 'DEPOSIT')) {
    if (entry.seq === 21) {
      // Already created + driven to SUCCESS by runFrankPreStage(), which MUST
      // run before this function — #21 has to settle, and #13's swap has to
      // exist, before #7 below opens FRANK's restriction (see
      // runFrankPreStage's header comment). Nothing to drive here; just fold
      // the already-settled result in so callers still see all 18 rows.
      if (!ctx.frankPreStage) throw new Error('roster #21: call runFrankPreStage(ctx) before runDeposits(ctx)');
      driven.push({ seq: 21, depositId: ctx.frankPreStage.depositId });
      continue;
    }
    const c = byEmail.get(entry.customerEmail);
    if (!c) throw new Error(`roster #${entry.seq}: customer ${entry.customerEmail} not resolved`);
    const w = wallets.get(entry.customerEmail)!;
    const isUsdt = entry.currency === 'USDT';
    const asset = isUsdt ? ctx.usdt : ctx.aed;
    const walletId = (isUsdt ? w.usdt : w.aed).id;
    const type = isUsdt ? PayinType.CRYPTO : PayinType.FIAT;

    let dep = await createRosterDeposit(ctx, c, asset, walletId, entry.amount, type, entry.seq);

    switch (entry.seq) {
      // seq 22/24-29 是对账素材单（2026-08-30 加）：跟 1/2/3 一样是普通成功充值，
      // 走同一条 V1_APPROVED → SUCCESS 的路。
      case 1: case 2: case 3:
      case 22: case 24: case 25: case 26: case 27: case 28: case 29:
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
        // 低于下限挂起 → 运营发起没收 → CFO 换人批（2026-08-30 起 approval.constants.ts 里
        // DEPOSIT_CONFISCATION 单步裁决人改 CFO——没收是客户的钱变公司收入，属财务事项）
        // → 资金单腿(legSeq 2)确认 → CONFISCATED。
        await driveVerdict(ctx, dep.id, 'V1_APPROVED');
        dep = await waitDepositStatus(ctx, dep.id, 'OPERATION_PENDING');
        const conf = await ctx.depositWf.initiateConfiscation(
          dep.id,
          { reason: 'Below-min deposit — T&C handling fee (demo fixture)' },
          DEMO_ACTOR('DEMO_OPS_MAKER_8', 'OPS_OFFICER'),
        );
        await makerCheckerApprove(ctx, conf.approvalNo, [() => loginAsCfo(ctx.apiBase)]);
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
        // 会连坐冻住 FRANK 名下所有非终态单；这笔新单créé时 FRANK 已被限制，L1 会在
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

      default:
        // fail-closed：花名册加了一行、却忘了在这里给它一条驱动路径时，当场炸，
        // 而不是让那一行悄悄停在 COMPLIANCE_PENDING 里。
        // 2026-08-30 实证：本批加 7 行素材单时踩的正是这个缺口——switch 只有
        // case 1-10、没有 default，新行一路 fall through、永远到不了 SUCCESS，
        // 而且不报任何错，要等花名册答案键比对时才以"状态不符"的面目出现。
        throw new Error(
          `花名册 #${entry.seq}（${entry.label}）在 runDeposits 里没有对应的驱动分支 —— ` +
          '加了花名册行就必须同时在这里给它一条路，否则它会停在 COMPLIANCE_PENDING。',
        );
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
  // are pinned to FRANK instead of reusing a trio member — FRANK's only OTHER
  // deposit row (#21, pre-staged by runFrankPreStage()) is driven to a TERMINAL
  // SUCCESS well before #7 ever runs, so it's immune to this sweep: BOB used to
  // hold both #5 (MANUAL_CHECKING) and #7, and #7's
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

// ── stage 3: swaps (4-entry roster; 4-leg two-phase orchestration to SUCCESS) ──

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

// Roster: scripts/demo-roster.ts DEMO_ROSTER (domain === 'SWAP', 4 rows) — same
// "real service/workflow methods only" contract as runDeposits above.
//   · ⚡① drives SwapWorkflowService.applyKytVerdict({verdict:'approved'}) directly
//     — initiateSwap itself books nothing (swap sits COMPLIANCE_PENDING until a
//     KYT verdict lands); no real Sumsub webhook in demo/local, so the verdict is
//     applied the same way createRosterDeposit/driveVerdict do for deposits.
//   · #13 (FRANK) is the one row whose ORDER is NOT created here at all — it was
//     already created by runFrankPreStage() (called before runDeposits(), see
//     that function's header comment), specifically so it exists BEFORE deposit
//     roster row #7 opens FRANK's customer-level SANCTION restriction (scope=ALL
//     — restriction-cause.constant.ts). By the time THIS loop runs, #7 has
//     already fired — creating the order here would hit initiateSwap's
//     synchronous assertTradingEligibility gate and throw CAPABILITY_RESTRICTED,
//     the exact dead end task-C3-report.md documented (an even earlier attempt,
//     applying a rejecting ⚡⑦ verdict directly to a freshly-created order, hit
//     the same wall — task-C3b-report.md). So this loop just waits for #7's
//     broadcast (CUSTOMER_RESTRICTION_OPENED →
//     SwapWorkflowService.onCustomerRestrictionOpened, fire-and-forget) to
//     finish sweeping the pre-staged COMPLIANCE_PENDING order to FROZEN — no
//     verdict is ever applied to it directly. See task-C3c-report.md.
export async function runSwaps(ctx: DemoCtx): Promise<Array<{ seq: number; orderNo: string; status: string }>> {
  console.log(`═══ demo:swap — ${nOf('SWAP')} 笔按花名册铺 ═══`);
  const customers = await resolveDemoCustomers(ctx.prisma);
  const frozenPersona = await resolveFrozenPersona(ctx.prisma);
  const byEmail = new Map([...customers, frozenPersona].map((c) => [c.email, c]));

  const results: Array<{ seq: number; orderNo: string; status: string }> = [];

  for (const entry of DEMO_ROSTER.filter((r) => r.domain === 'SWAP')) {
    const c = byEmail.get(entry.customerEmail);
    if (!c) throw new Error(`roster #${entry.seq}: customer ${entry.customerEmail} not resolved`);

    let swap: any;
    if (entry.seq === 13) {
      // Pre-staged — see the roster-comment block above.
      if (!ctx.frankPreStage) {
        console.log(`  #${entry.seq} ${entry.label}: ⊘ 跳过（需经 demo:deposit/demo:all 预铺 FRANK 前置阶段——demo:swap 单独跑无此上文）`);
        continue;
      }
      const swapId = ctx.frankPreStage.swapId;
      swap = await waitFor(`${entry.label} 被 #7 广播连坐冻结`, async () => {
        const s: any = await ctx.prisma.swapTransaction.findUnique({ where: { id: swapId } });
        return s?.status === 'FROZEN' ? s : null;
      }, 8000);
      console.log(`  #${entry.seq} ${entry.label}: ${swap.swapNo} → ${swap.status}（pre-stage 建单，#7 广播连坐冻结）`);
    } else {
      const sellUsdt = entry.currency === 'USDT';
      const from = sellUsdt ? ctx.usdt : ctx.aed;
      const to = sellUsdt ? ctx.aed : ctx.usdt;
      const quote: any = await ctx.swapQuote.createQuote({
        ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
        fromAssetId: from.id, fromAssetCode: from.currency,
        toAssetId: to.id, toAssetCode: to.currency,
        amount: new Prisma.Decimal(entry.amount), customerId: c.id,
      } as any);
      swap = await ctx.swapWf.initiateSwap(c.id, quote.id);
      console.log(`  #${entry.seq} ${entry.label}: ${swap.swapNo} ${sellUsdt ? 'USDT→AED' : 'AED→USDT'} ${entry.amount} (COMPLIANCE_PENDING)`);

      // riskScore 5 = SWAP_VERDICT_BUTTONS.V1_APPROVED 的真实 score（不传的话
      // sumsub_score 落 NULL，详情页 L2 副行只能显示 'Awaiting Sumsub verdict'）。
      await ctx.swapWf.applyKytVerdict(swap.id, { verdict: 'approved', riskScore: 5 });
      await driveSwapToSuccess(ctx, { id: swap.id, swapNo: swap.swapNo });
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
 *  the known WDR-number collision (generateReferenceNo('WDR') draws a
 *  6-digit random (as of 2026-09-01) — a crowded same-day namespace can still
 *  collide on withdrawNo, just far less often now; underlying weakness is
 *  production-side, flagged separately). Returns as soon
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
  console.log(`═══ demo:withdraw — ${nOf('WITHDRAW')} 笔按花名册铺(含大额闸 + 在途单) ═══`);
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
      toAddress = fakeTronAddress(`${SIM}wd${idx}`);
    } else {
      const viban = await ctx.prisma.wallet.findFirst({ where: { ownerId: c.id, walletRole: 'C_VIBAN', network: 'AED_ZAND' } });
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

// ── data.md snapshot (docs generation) ────────────────────────────────────
// doc-final/demo/data.md:3 declares this file's generated section is written
// by demo:all — this is that write. Only the text between the GENERATED
// markers is touched; everything else in data.md is hand-maintained and left
// alone. If the markers are missing (someone hand-edited them out), skip
// silently rather than corrupting the file — data.md's own git history is
// the recovery path, not this script.
const DATA_MD_PATH = path.resolve(__dirname, '../doc-final/demo/data.md');
const GENERATED_BEGIN = '<!-- GENERATED:BEGIN -->';
const GENERATED_END = '<!-- GENERATED:END -->';

function renderDataMdSnapshot(
  rosterResults: Array<{ seq: number; orderNo: string; status: string }>,
  coaRows: Array<{ label: string; ok: boolean; detail: string }>,
): string {
  const bySeq = new Map(rosterResults.map((a) => [a.seq, a]));
  const DOMAIN_LABEL: Record<string, string> = { DEPOSIT: '充值', SWAP: '兑换', WITHDRAW: '提现' };
  const lines: string[] = [];
  lines.push(
    `> 本段由 \`demo:all\` 收尾自动写入（\`scripts/demo-lib.ts → renderDataMdSnapshot\`），别手改——下次跑会整段覆盖。`,
  );
  lines.push(
    `> **只收录跨重铺稳定的列**：单号（\`DEP…\`/\`SWP…\`/\`WDR…\`）内嵌日期+随机后缀、每次跑都变，` +
      `收录进来会让 \`git diff data.md\` 永远有噪音、失去"行为有没有变"的判据作用（也让工作树无故变脏）。` +
      `**要当次的真实单号，看 \`demo:all\` 运行时打印的花名册**——那份是当场的、准的。`,
  );
  let bad = 0;
  for (const domain of ['DEPOSIT', 'SWAP', 'WITHDRAW'] as const) {
    const rows = DEMO_ROSTER.filter((r) => r.domain === domain);
    lines.push('', `### ${DOMAIN_LABEL[domain]}（${rows.length} 笔）`, '');
    lines.push('| # | 场景 | 客户 | 金额 | 预期终态 | 实到状态 | 结果 |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const r of rows) {
      const a = bySeq.get(r.seq);
      const rowOk = a?.status === r.expectedStatus;
      if (!rowOk) bad += 1;
      lines.push(
        `| ${r.seq} | ${r.label} | ${r.customerEmail} | ${r.amount} ${r.currency} | ${r.expectedStatus} | ` +
          `${a?.status ?? '（没造出来）'} | ${rowOk ? '✓' : '✗'} |`,
      );
    }
  }
  lines.push('', `**花名册：${DEMO_ROSTER.length - bad}/${DEMO_ROSTER.length} 符合预期**`);
  lines.push('', '### 账本恒等式（COA）', '');
  lines.push('| 恒等式 | 结果 |');
  lines.push('|---|---|');
  for (const row of coaRows) {
    lines.push(`| ${row.label} | ${row.ok ? '✓' : '✗'} ${row.detail} |`);
  }
  return lines.join('\n');
}

function writeDataMdSnapshot(body: string): void {
  const original = fs.readFileSync(DATA_MD_PATH, 'utf8');
  const beginIdx = original.indexOf(GENERATED_BEGIN);
  const endIdx = original.indexOf(GENERATED_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    console.warn(`  ⚠ data.md 缺 GENERATED 标记，跳过生成区写入（${DATA_MD_PATH}）`);
    return;
  }
  const before = original.slice(0, beginIdx + GENERATED_BEGIN.length);
  const after = original.slice(endIdx);
  fs.writeFileSync(DATA_MD_PATH, `${before}\n${body}\n${after}`, 'utf8');
  console.log(`  ✓ data.md 生成区已更新`);
}

// ── verification (spec §6) ───────────────────────────────────────────────────
export async function verifyEndState(
  ctx: DemoCtx,
  rosterResults: Array<{ seq: number; orderNo: string; status: string }>,
): Promise<boolean> {
  console.log('\n═══ verify end-state (spec §6) ═══');
  const fails: string[] = [];
  let n = 0;
  const ok = (label: string, cond: boolean, detail = '') => {
    n += 1;
    if (cond) console.log(`  ✓ ${label}${detail ? ` (${detail})` : ''}`);
    else { fails.push(label); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
  };

  // 1. 花名册逐条比对 —— 取代旧的「所有 demo 单必须 SUCCESS」。那条全称断言的
  //    前提本来就是错的：一份丰富的演示数据本来就该有冻结的、没收的、退回的、
  //    上缴的、卡在半路的，不是清一色 SUCCESS。rosterResults 只装得下
  //    runDeposits/runSwaps/runWithdraws 各自真正驱动过的花名册各笔（seq →
  //    {orderNo,status} 的实际落点）——别的任何单（比如 demo:in-transit 命令
  //    另造的两笔独立在途单）从不会被放进这个数组，天然不参与比对，不需要
  //    额外的排除名单。
  const { pass, lines } = printAnswerKey(rosterResults);
  lines.forEach((l) => console.log(l));
  ok(`花名册 ${DEMO_ROSTER.length} 笔逐条符合预期`, pass);

  // 2. COA invariants: CLIENT and FIRM balance per ledger (real-time 1:1 model proof)
  //    CLIENT: CLIENT_ASSET == Σ(CLIENT_PAYABLE + DEPOSIT_SUSPENSE) per ledger
  //    FIRM:   FIRM_ASSET == Σ(FIRM_OPS + FIRM_SET + INCOME_SWAP_FEE + INCOME_WITHDRAW_FEE + INCOME_OTHER) per ledger
  //    (asset accounts are debit-normal; liabilities/equity are credit-normal)
  const coaMap = await buildCoaBalanceMap(ctx);
  const LEDGER_NAMES: Record<number, string> = { [TB_LEDGERS.AED]: 'AED', [TB_LEDGERS.USDT]: 'USDT' };
  const coaRows: Array<{ label: string; ok: boolean; detail: string }> = [];
  for (const [ledger, m] of coaMap) {
    const name = LEDGER_NAMES[ledger] ?? `ledger${ledger}`;
    const clientAsset = m.get(TB_ACCOUNT_CODES.CLIENT_ASSET) ?? 0n;
    const clientLiab = (m.get(TB_ACCOUNT_CODES.CLIENT_PAYABLE) ?? 0n) + (m.get(TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE) ?? 0n);
    const clientLabel = `COA CLIENT(${name}): CLIENT_ASSET == Σ(CLIENT_PAYABLE+DEPOSIT_SUSPENSE)`;
    const clientOk = clientAsset === clientLiab;
    const clientDetail = `${clientAsset} == ${clientLiab}`;
    ok(clientLabel, clientOk, clientDetail);
    coaRows.push({ label: clientLabel, ok: clientOk, detail: clientDetail });
    const firmAsset = m.get(TB_ACCOUNT_CODES.FIRM_ASSET) ?? 0n;
    const firmEquity = (m.get(TB_ACCOUNT_CODES.FIRM_OPS) ?? 0n) + (m.get(TB_ACCOUNT_CODES.FIRM_SET) ?? 0n) + (m.get(TB_ACCOUNT_CODES.INCOME_SWAP_FEE) ?? 0n) + (m.get(TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE) ?? 0n) + (m.get(TB_ACCOUNT_CODES.INCOME_OTHER) ?? 0n);
    const firmLabel = `COA FIRM(${name}): FIRM_ASSET == Σ(FIRM_OPS+FIRM_SET+INCOME_SWAP_FEE+INCOME_WITHDRAW_FEE+INCOME_OTHER)`;
    const firmOk = firmAsset === firmEquity;
    const firmDetail = `${firmAsset} == ${firmEquity}`;
    ok(firmLabel, firmOk, firmDetail);
    coaRows.push({ label: firmLabel, ok: firmOk, detail: firmDetail });
  }

  // 3./4. (removed C5b) The Outstanding + FeeAccrual tables — which these checks
  //    asserted stayed empty/unleaked under the real-time model — were dropped
  //    with the rest of the V7/V8 deferred-settlement residue. The "no deferred
  //    settlement rows" invariant is now structurally guaranteed by the schema
  //    (the tables no longer exist), so the runtime assertions are obsolete.

  // 5. data.md:3 早已声明生成区由 demo:all 自动写入——这就是那个写入点。写在
  //    断言判据算完、返回结果之前：不管本轮 29 笔是否全绿，data.md 都应反映
  //    "刚刚实到的样子"（供排障时对照），而不是只在全绿时才落盘。
  writeDataMdSnapshot(renderDataMdSnapshot(rosterResults, coaRows));

  console.log(`\n  asserts: ${n - fails.length}/${n} PASS`);
  if (fails.length) console.log(`  FAIL: ${fails.join('; ')}`);
  return fails.length === 0;
}
