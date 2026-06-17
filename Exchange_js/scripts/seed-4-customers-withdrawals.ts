// Create 2 withdrawals per non-frozen customer (1 USDT crypto + 1 AED fiat) = 8 entities.
// CREATED status only — no admin progression.

import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { WithdrawQuoteService } from '../src/modules/trading/withdrawal-fee-level/withdraw-quote.service';
import { WithdrawTransactionsService } from '../src/modules/trading/withdraw-transactions/withdraw-transactions.service';

const PICKS = ['Alice', 'Bob', 'Frank', 'Grace'];

function seeded(idx: number) {
  let s = idx * 1103515245 + 12345;
  return () => { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff; };
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma: any = app.get(PrismaService);
  const quoteSvc = app.get(WithdrawQuoteService);
  const withdrawSvc = app.get(WithdrawTransactionsService);

  const usdt = await prisma.asset.findFirst({ where: { currency: 'USDT' } });
  const aed = await prisma.asset.findFirst({ where: { currency: 'AED' } });
  if (!usdt || !aed) throw new Error('missing usdt/aed');

  const customers = await prisma.customerMain.findMany({
    where: { firstName: { in: PICKS } },
    select: { id: true, customerNo: true, firstName: true, lastName: true },
  });
  if (customers.length < 4) throw new Error(`expected 4 customers, got ${customers.length}`);

  console.log(`\n═══ Creating 8 withdrawals (4 customers × 2: USDT + AED) ═══\n`);

  for (let i = 0; i < customers.length; i++) {
    const c = customers[i];
    const idx = i + 1;

    // Fetch their pre-registered withdrawal targets
    const usdtAddr: any = await prisma.withdrawalAddress.findFirst({
      where: { customerId: c.id, assetId: usdt.id },
    });
    const aedBank: any = await prisma.withdrawalAddress.findFirst({
      where: { customerId: c.id, assetId: aed.id },
    });
    if (!usdtAddr || !aedBank) throw new Error(`${c.firstName} missing withdrawal target`);

    const rnd = seeded(idx);
    const usdtAmount = +(50 + rnd() * 150).toFixed(2);  // 50..200 USDT
    const aedAmount = +(300 + rnd() * 1700).toFixed(2); // 300..2000 AED

    console.log(`── ${c.customerNo} ${c.firstName} ${c.lastName} ──`);

    // ── USDT crypto withdraw ──
    const usdtQuote: any = await quoteSvc.createQuote({
      ownerType: 'CUSTOMER',
      ownerId: c.id,
      ownerNo: c.customerNo,
      assetId: usdt.id,
      assetCode: usdt.currency,
      amount: new Prisma.Decimal(usdtAmount),
      customerId: c.id,
    });
    const usdtWd: any = await withdrawSvc.create({
      assetId: usdt.id,
      amount: usdtAmount,
      quoteId: usdtQuote.id,
      toAddress: usdtAddr.address,
    } as any, c.id, 'CUSTOMER');
    console.log(`   USDT  ${usdtAmount}  withdrawNo=${usdtWd.withdrawNo}  status=${usdtWd.status}  → ${usdtAddr.address.slice(0, 12)}...`);

    // ── AED fiat withdraw ──
    const aedQuote: any = await quoteSvc.createQuote({
      ownerType: 'CUSTOMER',
      ownerId: c.id,
      ownerNo: c.customerNo,
      assetId: aed.id,
      assetCode: aed.currency,
      amount: new Prisma.Decimal(aedAmount),
      customerId: c.id,
    });
    const aedWd: any = await withdrawSvc.create({
      assetId: aed.id,
      amount: aedAmount,
      quoteId: aedQuote.id,
      toIban: aedBank.iban,
    } as any, c.id, 'CUSTOMER');
    console.log(`   AED   ${aedAmount}   withdrawNo=${aedWd.withdrawNo}  status=${aedWd.status}  → ${aedBank.iban}`);
    console.log();
  }

  const total = await prisma.withdrawTransaction.count();
  console.log(`═══ DONE — total withdrawals in DB: ${total} ═══\n`);

  await app.close();
  process.exit(0);
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
