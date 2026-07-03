// 离线触发一次 per-wallet 对账 run（不经 HTTP、不用登录）。
// 用途：平账回填后重跑验证；e2e 闭环。
// Run: npm run recon:rerun    （或加 --cutoff=2026-07-03T12:00:00Z）
//
// Node 18 polyfill: @nestjs/schedule calls crypto.randomUUID() at module
// load. Must precede every other import.
import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { WalletReconRunService } from '../src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service';

async function main() {
  const arg = process.argv.find((a) => a.startsWith('--cutoff='));
  const cutoff = arg ? new Date(arg.slice('--cutoff='.length)) : new Date();
  if (Number.isNaN(cutoff.getTime())) throw new Error(`invalid --cutoff: ${arg}`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const svc = app.get(WalletReconRunService);
    const result = await svc.run({ cutoff });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
