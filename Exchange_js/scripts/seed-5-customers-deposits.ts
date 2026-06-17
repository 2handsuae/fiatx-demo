// Create 2 payins per pre-provisioned customer (1 USDT crypto + 1 AED fiat).
// Only creates DETECTED payins — user drives state forward manually in admin UI.

import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { PayinsService } from '../src/modules/asset-treasury/payins/payins.service';
import { PayinType } from '../src/modules/asset-treasury/payins/dto/payin.dto';

const PICKS = ['Alice', 'Bob', 'Carol', 'Frank', 'Grace'];
const SIM = 'SEED5';

// Per-customer deterministic random amounts (USDT 200..2000, AED 800..6000)
function seeded(idx: number) {
  let s = idx * 1103515245 + 12345;
  return () => { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff; };
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma: any = app.get(PrismaService);
  const payins = app.get(PayinsService);

  const usdt = await prisma.asset.findFirst({ where: { currency: 'USDT' } });
  const aed = await prisma.asset.findFirst({ where: { currency: 'AED' } });
  if (!usdt || !aed) throw new Error('missing usdt/aed');

  const customers = await prisma.customerMain.findMany({
    where: { firstName: { in: PICKS } },
    select: { id: true, customerNo: true, firstName: true, lastName: true },
  });
  if (customers.length < 5) throw new Error(`expected 5 customers, got ${customers.length}`);

  console.log(`\n═══ Creating 2 payins × 5 customers = 10 payins (DETECTED only) ═══\n`);

  for (let i = 0; i < customers.length; i++) {
    const c = customers[i];
    const idx = i + 1;

    const cDep = await prisma.wallet.findFirst({ where: { ownerId: c.id, walletRole: 'C_DEP', assetId: usdt.id } });
    const cViban = await prisma.wallet.findFirst({ where: { ownerId: c.id, walletRole: 'C_VIBAN', assetId: aed.id } });
    if (!cDep || !cViban) throw new Error(`${c.firstName} missing C_DEP or C_VIBAN`);

    const rnd = seeded(idx);
    const usdtAmount = (200 + rnd() * 1800).toFixed(2);
    const aedAmount = (800 + rnd() * 5200).toFixed(2);

    console.log(`── ${c.customerNo} ${c.firstName} ${c.lastName} ──`);

    // 1) USDT crypto payin
    const cryptoPayin: any = await payins.createDetected({
      assetId: usdt.id,
      toWalletId: cDep.id,
      type: PayinType.CRYPTO,
      amount: usdtAmount,
      txHash: `0x${SIM}${idx}USDT${Date.now()}`,
      fromAddress: `Tsender${idx}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.slice(0, 34),
      referenceNo: `REF-${SIM}-${idx}-USDT`,
    } as any);
    console.log(`   USDT  ${usdtAmount}  payinNo=${cryptoPayin.payinNo}  status=${cryptoPayin.status}`);

    // 2) AED fiat payin
    const fiatPayin: any = await payins.createDetected({
      assetId: aed.id,
      toWalletId: cViban.id,
      type: PayinType.FIAT,
      amount: aedAmount,
      fromIban: `AE070330000000000000${idx.toString().padStart(3, '0')}`,
      referenceNo: `REF-${SIM}-${idx}-AED`,
    } as any);
    console.log(`   AED   ${aedAmount}   payinNo=${fiatPayin.payinNo}  status=${fiatPayin.status}`);
    console.log();
  }

  const total = await prisma.payin.count();
  console.log(`═══ DONE — total payins in DB: ${total} ═══\n`);

  await app.close();
  process.exit(0);
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
