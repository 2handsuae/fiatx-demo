// test/demo-roster.e2e-spec.ts
//
// Task C2 e2e: proves runDeposits() drives all 10 DEPOSIT roster rows
// (scripts/demo-roster.ts DEMO_ROSTER) to the status the roster names —
// including the three disposition arcs (CONFISCATED/RETURNED/SEIZED), each a
// real maker-checker with a second, really-logged-in admin identity approving
// over the real HTTP approve endpoint (scripts/demo-mlro.ts). Runs against a
// real AppModule + real ApprovalsService + real TigerBeetle. Builds its own
// DemoCtx (same shape as demo-lib.ts's bootstrap(), see the comment on
// beforeAll below for why it isn't reused verbatim).
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
import { ensureSetup, runDeposits, resolveApiBase, type DemoCtx } from '../scripts/demo-lib';
import { DEMO_ROSTER } from '../scripts/demo-roster';

describe('Deposit roster (e2e, Task C2)', () => {
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
  });

  afterAll(async () => {
    if (ctx?.app) await ctx.app.close();
  });

  it('充值 10 笔全部落到花名册预期状态', async () => {
    const results = await runDeposits(ctx);
    const deposits = DEMO_ROSTER.filter((r) => r.domain === 'DEPOSIT');
    for (const r of deposits) {
      const got = results.find((x) => x.seq === r.seq);
      expect({ seq: r.seq, status: got?.status }).toEqual({ seq: r.seq, status: r.expectedStatus });
    }
  });
});
