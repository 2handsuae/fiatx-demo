// scripts/verify-reconciliation.ts
//
// V8 客户资产对账 — 全链 END-TO-END SMOKE 测试(Task G1)。
// 证明 ReconciliationRunWorkflowService.run() 在真实 branch DB 上端到端跑通,
// 两个 layer(CRYPTO + FIAT)× businessDate=2026-06-16,默认 DRY_RUN(不落库)。
//
// ⚠️ 这是 SMOKE 测试,不是闭合断言测试:
//   wallet.mockBalance 很可能未 seed 成与 TB 余额一致(多半全 0),mock external adapter
//   也是刻意简化的。因此闭合性质(Σunmatched signedDelta == I5 delta)在原始数据上不成立,
//   I5 会显示较大 delta —— 这是预期的,不是代码 bug。
//   故本脚本【不】硬断言 closes===true 或 delta===0。
//   闭合 / I5-zero 断言需要一个 seed 一致的 mockBalance 场景(deferred);
//   本 smoke 只证明 wiring + pipeline 执行。
//
// 本脚本断言 PIPELINE 端到端工作:
//   - run({...DRY_RUN}) 不抛异常即跑通。
//   - 返回结构良好:dry-run 时 runNo='(dry-run)'(或 skipped),cases 是数组。
//   - 每个 case 形状正确(ccy / delta / lineItems / closes 字段齐全且类型对)。
//   - CRYPTO + FIAT 两层都跑。
//   - 打印每个 case 结果供人工 eyeball。
//   - pipeline 跑通且两层返回结构良好 → exit 0;异常或结构错误 → exit 1。
//
// V7-EOD 门:若 CRYPTO 因 branch DB 无 COMPLETED SettlementBatch 而 skipped:true,可接受
//   (check 会处理 skipped)。
//
// Run:
//   DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" npm run recon:verify:dry
//   DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" npm run recon:verify:apply

// Node 18 polyfill: @nestjs/schedule(sweep @Cron)在模块注册时调用 crypto.randomUUID()。
// Node 18 无 global crypto → ReferenceError。main.ts 有此 polyfill 但本脚本绕过 main.ts。
// 必须在任何拉取 @nestjs/schedule 的 import 之前(即最顶端)。
import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ReconciliationRunWorkflowService } from '../src/modules/clearing-settle/reconciliation/workflow/reconciliation-run-workflow.service';

const failures: string[] = [];
let count = 0;
function check(label: string, ok: boolean, detail = '') {
  count += 1;
  console.log(ok ? `  ✓ ${label}` : `  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label + (detail ? ` — ${detail}` : ''));
}

async function main() {
  const apply = process.argv.includes('--apply');
  const businessDate = '2026-06-16';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const wf = app.get(ReconciliationRunWorkflowService);
  try {
    for (const layer of ['CRYPTO', 'FIAT'] as const) {
      const res: any = await wf.run({ businessDate, layer, triggerType: 'MANUAL', mode: apply ? 'APPLY' : 'DRY_RUN' });
      const skipped = res.skipped === true;
      console.log(`\n[${layer}] mode=${apply ? 'APPLY' : 'DRY_RUN'} runNo=${res.runNo ?? '(skipped)'} skipped=${skipped}`);
      check(`${layer}: returns cases array`, Array.isArray(res.cases));
      if (Array.isArray(res.cases)) {
        for (const c of res.cases) {
          console.log(`    ${c.ccy}: delta=${String(c.delta)} lineItems=${c.lineItems} closes=${c.closes}`);
          check(
            `${layer}/${c.ccy}: case shape well-formed`,
            c.ccy != null && c.delta != null && typeof c.lineItems === 'number' && typeof c.closes === 'boolean',
          );
        }
      }
      // dry-run runNo 应为 '(dry-run)';CRYPTO 被 V7-EOD 门 skip 时无 runNo,skipped===true 也算通过。
      if (!apply) check(`${layer}: dry-run runNo is '(dry-run)' (or skipped)`, skipped || res.runNo === '(dry-run)');
    }
    console.log(`\n════ ${count} checks, ${failures.length} failures ════`);
    // NOTE: closure (Σunmatched==I5delta) / I5-zero are NOT asserted here —
    // they require a seeded consistent mockBalance scenario. This smoke proves wiring + pipeline run.
    if (failures.length) {
      failures.forEach((f) => console.log('  - ' + f));
      process.exit(1);
    }
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
