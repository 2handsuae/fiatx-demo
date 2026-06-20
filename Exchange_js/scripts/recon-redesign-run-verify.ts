// scripts/recon-redesign-run-verify.ts
//
// V8 对账重构 — 收口编排器验证（G6）。
// 跑 RedesignReconRunService（G4 五公式 + G5 下钻四桶 → 装配 → 持久化）against 真实 branch DB：
//   1) DRY_RUN：0 落库，打印 per-currency 五公式 PASS/FAIL + 四桶计数。
//   2) APPLY：落 ReconciliationRun + ReconciliationInvariantCheck(式1..5) + ReconciliationCase + LineItem。
//   3) 回读 GET getLatestRedesignRun()，验证落库形状（run + formulasByCurrency + cases）。
//
// spec：doc-final/superpowers/specs/2026-06-20-reconciliation-redesign-design.md §3/§4/§4.4。
// 前置：先跑 `npm run recon:gen` 写 external_statement_lines + external_balances（含刻意 break）。
//
// Run:
//   DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" npx ts-node -r tsconfig-paths/register scripts/recon-redesign-run-verify.ts

// Node 18 polyfill：@nestjs/schedule 注册时调用 crypto.randomUUID()。必须在任何 import 之前。
import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { RedesignReconRunService } from '../src/modules/clearing-settle/reconciliation/workflow/redesign-recon-run.service';
import { ReconciliationQueryService } from '../src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service';
import { RedesignCurrencyResult } from '../src/modules/clearing-settle/reconciliation/workflow/redesign-recon-run.service';

const BUSINESS_DATE = '2026-06-16';

function printCurrency(c: RedesignCurrencyResult): void {
  const s = c.drilldown.classified.summary;
  console.log(`\n──── ${c.currency} (layer=${c.layer}) ────`);
  console.log('  5 formulas:');
  for (const f of c.formulas) {
    const mark = f.status === 'PASS' ? '✓' : '✗';
    console.log(`    ${mark} ${f.formula} ${f.label.padEnd(40)} Δ=${f.delta.toString()}  [${f.status}]`);
  }
  console.log(
    `  4 buckets: PASS=${s.pass} AMOUNT_MISMATCH=${s.amountMismatch} ORPHAN_INTERNAL=${s.orphanInternal} ORPHAN_EXTERNAL=${s.orphanExternal} MANUAL=${s.manual}`,
  );
  console.log(`  → hasBreak=${c.hasBreak}  netDelta=${c.netDelta.toString()}`);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const orchestrator = app.get(RedesignReconRunService);
  const query = app.get(ReconciliationQueryService);

  // ── 1) DRY_RUN（默认，0 落库） ──
  console.log('════════════════ DRY_RUN ════════════════');
  const dry = await orchestrator.run({ businessDate: BUSINESS_DATE, triggerType: 'MANUAL', mode: 'DRY_RUN' });
  console.log(`runNo=${dry.runNo} mode=${dry.mode} openedCount=${dry.openedCount}`);
  for (const c of dry.currencies) printCurrency(c);

  // ── 2) APPLY（落库） ──
  console.log('\n════════════════ APPLY ════════════════');
  const applied = await orchestrator.run({ businessDate: BUSINESS_DATE, triggerType: 'MANUAL', mode: 'APPLY' });
  console.log(`runNo=${applied.runNo} mode=${applied.mode} openedCount=${applied.openedCount}`);

  // ── 3) 回读落库形状 ──
  console.log('\n════════════════ READ-BACK (getLatestRedesignRun) ════════════════');
  const latest = await query.getLatestRedesignRun(BUSINESS_DATE);
  if (!latest) {
    console.error('✗ getLatestRedesignRun returned null after APPLY');
    await app.close();
    process.exit(1);
  }
  const checkCount = latest.run.invariantChecks.length;
  const caseCount = latest.cases.length;
  const lineItemCount = latest.cases.reduce((n, k) => n + k.lineItems.length, 0);
  console.log(`run=${latest.run.runNo} status=${latest.run.status} invariantStatus=${latest.run.invariantStatus}`);
  console.log(`  invariant_checks(=5 formulas × ccy)=${checkCount}`);
  console.log(`  currencies in formulasByCurrency=${Object.keys(latest.formulasByCurrency).join(',')}`);
  console.log(`  cases=${caseCount}  line_items=${lineItemCount}`);
  for (const k of latest.cases) {
    console.log(
      `    case ${k.caseNo} ${k.assetCode} delta=${k.deltaAmount} status=${k.status} ` +
        `reimbursementObligationId=${k.reimbursementObligationId ?? 'null(hook)'} lineItems=${k.lineItems.length}`,
    );
  }

  // ── 断言：APPLY 必须落了 run + 每币种 5 个 check；DRY_RUN openedCount 与 APPLY 一致 ──
  const ccyCount = dry.currencies.length;
  const expectChecks = ccyCount * 5;
  const ok = checkCount === expectChecks && applied.openedCount === dry.openedCount && applied.runNo !== '(dry-run)';
  console.log(
    `\n════════ ASSERT: checks=${checkCount}/${expectChecks}  opened DRY=${dry.openedCount} APPLY=${applied.openedCount}  ${ok ? '✓' : '✗'} ════════`,
  );

  await app.close();
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
