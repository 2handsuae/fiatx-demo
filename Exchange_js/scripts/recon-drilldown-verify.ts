// scripts/recon-drilldown-verify.ts
//
// V8 对账重构 — 下钻匹配验证（G5）。
// 跑 DrilldownMatchService（投影 → 匹配[键不含金额] → 四桶定性）against 真实 branch DB，
// 打印每币种四桶计数 + 命中的 break line items，验证抓到 recon:gen 注入的 6 个 break（3/币种）。
//
// spec：doc-final/superpowers/specs/2026-06-20-reconciliation-redesign-design.md §4。
// 前置：先跑 `npm run recon:gen` 写 external_statement_lines（含刻意 break）。
//
// Run:
//   DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" npx ts-node -r tsconfig-paths/register scripts/recon-drilldown-verify.ts

// Node 18 polyfill：@nestjs/schedule 注册时调用 crypto.randomUUID()。必须在任何 import 之前。
import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DrilldownMatchService } from '../src/modules/clearing-settle/reconciliation/engine/drilldown-match.service';
import { ClassifiedLineItem } from '../src/modules/clearing-settle/reconciliation/engine/anomaly-classifier.service';

const BUSINESS_DATE = '2026-06-16';
const CURRENCIES = ['AED', 'USDT'];

function fmtItem(i: ClassifiedLineItem): string {
  const ref = i.externalRef ?? '(none)';
  const intl = i.internalSourceNo ? `${i.internalSource}:${i.internalSourceNo} ${i.internalAmount}` : '—';
  const extl = i.externalId ? `${i.externalSource} ${i.externalAmount}` : '—';
  return `[${i.bucket}/${i.qualifier}] ref=${ref}  internal=${intl}  external=${extl}  δ=${i.signedDelta}`;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const drill = app.get(DrilldownMatchService);

  const cutoff = new Date(`${BUSINESS_DATE}T00:00:00.000Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() + 1); // T+1 00:00

  let totalBreaks = 0;
  for (const ccy of CURRENCIES) {
    const r = await drill.run({ currency: ccy, businessDate: BUSINESS_DATE, cutoff });
    const s = r.classified.summary;
    const breakCount = s.amountMismatch + s.orphanInternal + s.orphanExternal;
    totalBreaks += breakCount;

    console.log(`\n════════ ${ccy}  (legs=${r.internalLegCount}  external_lines=${r.externalLineCount}) ════════`);
    console.log(`  buckets: PASS=${s.pass}  AMOUNT_MISMATCH=${s.amountMismatch}  ORPHAN_INTERNAL=${s.orphanInternal}  ORPHAN_EXTERNAL=${s.orphanExternal}  MANUAL=${s.manual}  (internal_book_leg=${r.classified.internalBookLeg.length}, non-break)`);
    console.log(`  → ${breakCount} break(s) this currency`);

    const breaks = [...r.classified.amountMismatch, ...r.classified.orphanInternal, ...r.classified.orphanExternal];
    if (breaks.length) {
      console.log('  break line items:');
      for (const b of breaks) console.log('   ', fmtItem(b));
    }
    if (r.classified.manual.length) {
      console.log('  manual (ambiguous fallback):');
      for (const m of r.classified.manual) console.log('   ', fmtItem(m), `candidates=${m.candidateCount}`);
    }
  }

  console.log(`\n════════ TOTAL breaks across ${CURRENCIES.join('+')}: ${totalBreaks} (expect 6 = 3/ccy) ${totalBreaks === 6 ? '✓' : '✗'} ════════`);
  await app.close();
  if (totalBreaks !== 6) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
