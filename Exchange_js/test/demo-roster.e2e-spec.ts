// test/demo-roster.e2e-spec.ts
//
// Task C2 e2e: proves runDeposits() drives all DEPOSIT roster rows
// (scripts/demo-roster.ts DEMO_ROSTER) to the status the roster names —
// including the three disposition arcs (CONFISCATED/RETURNED/SEIZED), each a
// real maker-checker with a second, really-logged-in admin identity approving
// over the real HTTP approve endpoint (scripts/demo-mlro.ts). Runs against a
// real AppModule + real ApprovalsService + real TigerBeetle. Builds its own
// DemoCtx (same shape as demo-lib.ts's bootstrap(), see the comment on
// beforeAll below for why it isn't reused verbatim).
//
// Task C3 extends the same file with runSwaps()/runWithdraws() coverage
// (SWAP/WITHDRAW roster rows). (Task C3b moved WITHDRAW row #19 off FRANK —
// GRACE via ⚡⑨ V9_REJECTED_MLRO_FREEZE now — see task-C3b-report.md and
// demo-lib.ts's runWithdraws comment block.)
//
// Task C3c added runFrankPreStage() (called in beforeAll below, before
// ensureSetup's ordinary deposit stage even starts) — #13 (FRANK) used to be
// KNOWN to stay red here (deposit roster row #7 permanently customer-level
// SANCTION-restricts FRANK before swaps ever ran, and initiateSwap's
// synchronous assertCapability gate rejected order creation outright — see
// task-C3-report.md/task-C3b-report.md). runFrankPreStage() creates #13's
// order (and funds it via new roster row #21) BEFORE #7 fires, so #7's own
// CUSTOMER_RESTRICTION_OPENED broadcast now freezes it for real — see
// demo-lib.ts's runFrankPreStage header comment and task-C3c-report.md.
//
// The disposition arcs also need the actual backend HTTP server of this stack
// up and listening (this test's own app context has no HTTP listener of its
// own — see ctx.apiBase in demo-lib.ts) — run this via
// `bash scripts/on-stack.sh self test:e2e test/demo-roster.e2e-spec.ts`
// against a stack already started with `bash scripts/stack.sh up`.
// (⚠️ NOT `on-stack.sh self test <spec>` — the plain `test` npm script's
// jest.config.js only roots src/**/*.spec.ts; test/**/*.e2e-spec.ts needs the
// test:e2e script, which points jest at test/jest-e2e.json instead.)

import * as path from 'path';
import * as dotenv from 'dotenv';

// Same Node 18 polyfill as src/main.ts (@nestjs/schedule needs globalThis.crypto,
// stable only in Node 19+) — main.ts isn't loaded in this e2e harness, so it has
// to be repeated here before AppModule (and therefore ScheduleModule) is imported.
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

// Loaded before any other import so PrismaService/TigerBeetleService see the
// worktree's own DATABASE_URL/TB_ADDRESS regardless of ConfigModule's internal
// load timing — mirrors deposit-money-arcs.e2e-spec.ts.
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { DepositTransactionsService } from '../src/modules/trading/deposit-transactions/deposit-transactions.service';
import { DepositWorkflowService } from '../src/modules/trading/deposit-transactions/deposit-workflow.service';
import { FundsOrderService } from '../src/modules/funds-orders/funds-order.service';
import { SwapQuoteService } from '../src/modules/trading/swap-fee-level/swap-quote.service';
import { SwapWorkflowService } from '../src/modules/trading/swap-transactions/swap-workflow.service';
import { WithdrawQuoteService } from '../src/modules/trading/withdrawal-fee-level/withdraw-quote.service';
import { WithdrawTransactionsService } from '../src/modules/trading/withdraw-transactions/withdraw-transactions.service';
import { WithdrawWorkflowService } from '../src/modules/trading/withdraw-transactions/withdraw-workflow.service';
import { ensureSetup, runFrankPreStage, runDeposits, runSwaps, runWithdraws, resolveApiBase, type DemoCtx } from '../scripts/demo-lib';
import { DEMO_ROSTER } from '../scripts/demo-roster';

describe('Deposit/swap/withdraw roster (e2e, Task C2 + C3)', () => {
  jest.setTimeout(180000);

  let ctx: DemoCtx;

  // Not demo-lib.ts's own bootstrap(): NestFactory.createApplicationContext() runs
  // the onApplicationBootstrap hooks (which register every @OnEvent listener across
  // the whole AppModule) inside that single call, with no gap to raise
  // EventEmitter2's maxListeners first. The full AppModule registers more than the
  // default-10 listeners on some event names, and the eventemitter2 version pinned
  // here throws (not just warns) once that threshold is crossed — the exact issue
  // test/deposit-money-arcs.e2e-spec.ts's header already documents & works around
  // for its own AppModule bootstrap. Test.createTestingModule's
  // compile → createNestApplication → [raise cap] → init() sequence has that gap.
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();

    const prisma: any = app.get(PrismaService);
    const usdt = await prisma.asset.findFirst({ where: { status: 'ACTIVE', type: 'CRYPTO', currency: 'USDT' } });
    const aed = await prisma.asset.findFirst({ where: { status: 'ACTIVE', type: 'FIAT', currency: 'AED' } });
    if (!usdt || !aed) throw new Error('USDT/AED active assets not seeded — run the business seed first');

    ctx = {
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

    await ensureSetup(ctx); // idempotent — guarantees wallets/TB accounts exist standalone
    await runFrankPreStage(ctx); // must run before runDeposits — see its header comment (demo-lib.ts)
  });

  afterAll(async () => {
    if (ctx?.app) await ctx.app.close();
  });

  it('充值 11 笔全部落到花名册预期状态', async () => {
    const results = await runDeposits(ctx);
    const deposits = DEMO_ROSTER.filter((r) => r.domain === 'DEPOSIT');
    for (const r of deposits) {
      const got = results.find((x) => x.seq === r.seq);
      expect({ seq: r.seq, status: got?.status }).toEqual({ seq: r.seq, status: r.expectedStatus });
    }
  });

  // Depends on runDeposits() above having already restricted FRANK (customer-
  // level SANCTION, scope=ALL) — jest runs `it` blocks in one file sequentially
  // within a describe, sharing the same beforeAll ctx/DB, so this is safe.
  //
  // withdrawResults is captured here (not re-fetched by a second runWithdraws()
  // call below) deliberately: runWithdraws, like runDeposits, is NOT idempotent
  // — a second call creates a SECOND #18 (BOB, 250,000 AED) within the same
  // calendar-day cumulative-limit window, which trips
  // TRANSACTION_LIMIT_CUMULATIVE_EXCEEDED the second time around (confirmed
  // against the live stack — task-C3-report.md). One call, shared results.
  let withdrawResults: Array<{ seq: number; orderNo: string; status: string }>;

  it('兑换 3 笔 + 提现 7 笔全部落到花名册预期状态', async () => {
    // Order matters: swaps before withdraws (mirrors demo-all.ts's own
    // setup → deposits → swaps → withdraws pipeline) — #18 (BOB, 250,000 AED
    // withdrawal) running before #12 (BOB, sell 2,900 AED) would drain BOB's
    // available balance first and spuriously fail #12 with
    // INSUFFICIENT_BALANCE (confirmed against the live stack when this was
    // briefly reversed — task-C3-report.md).
    const swapResults = await runSwaps(ctx);
    withdrawResults = await runWithdraws(ctx);
    const results = [...swapResults, ...withdrawResults];
    for (const r of DEMO_ROSTER.filter((x) => x.domain !== 'DEPOSIT')) {
      const got = results.find((x) => x.seq === r.seq);
      expect({ seq: r.seq, status: got?.status }).toEqual({ seq: r.seq, status: r.expectedStatus });
    }
  });

  it('在途单由 runWithdraws 产出，不再需要单独跑 demo:in-transit', () => {
    expect(withdrawResults.find((x) => x.seq === 20)?.status).toBe('PAYOUT_PENDING');
  });
});
