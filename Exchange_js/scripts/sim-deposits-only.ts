// Deposit-only sim: provisions 10 customers (with C_DEP + C_VIBAN wallets), then
// for each customer drives 2 payins (1 USDT crypto + 1 AED fiat) to SUCCESS.
// Amounts are randomised per customer per asset. Reuses sim-e2e-demo.ts patterns.
import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;
import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { TB_ACCOUNT_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';
import { DepositTransactionsService } from '../src/modules/trading/deposit-transactions/deposit-transactions.service';
import { PayinsService } from '../src/modules/asset-treasury/payins/payins.service';
import { PayinAction, PayinType } from '../src/modules/asset-treasury/payins/dto/payin.dto';
import { ensureTbAccountRegistry, provisionTbAccounts } from '../prisma/seed-tb.helper';
import { buildDeterministicNo } from '../src/common/utils/no-generator.util';

const SIM = 'DEP10';
const N = 10;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Seeded RNG so re-runs are deterministic per customer index.
function seeded(idx: number) {
  let s = idx * 1103515245 + 12345;
  return () => { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff; };
}
async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined>, timeoutMs = 10000): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await fn(); if (r) return r;
    await sleep(150);
  }
  throw new Error(`timeout: ${label}`);
}

async function main() {
  const ctx = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma: any = ctx.get(PrismaService);
  const payinsService = ctx.get(PayinsService);
  const depositService = ctx.get(DepositTransactionsService);

  const usdt = await prisma.asset.findFirst({ where: { status: 'ACTIVE', type: 'CRYPTO', currency: 'USDT' } });
  const aed = await prisma.asset.findFirst({ where: { status: 'ACTIVE', type: 'FIAT', currency: 'AED' } });
  if (!usdt || !aed) throw new Error('USDT/AED assets not seeded');
  const passwordHash = await bcrypt.hash('123456', 10);
  const cmaTpl = await prisma.wallet.findFirst({
    where: { walletRole: 'C_CMA', assetId: aed.id, status: 'ACTIVE' },
    select: { bankName: true, accountName: true },
  });

  type Cust = { idx: number; id: string; customerNo: string; depId: string; vibanId: string; usdtAmount: string; aedAmount: string };
  const custs: Cust[] = [];

  // ── Provision 10 customers + C_DEP + C_VIBAN + TB accounts ──
  console.log('\n═══ Provision 10 customers + wallets + TB accounts ═══');
  for (let i = 1; i <= N; i++) {
    const tag = String(i).padStart(2, '0');
    const email = `dep_c${tag}@example.com`;
    const customerNo = buildDeterministicNo('CU', email);
    const customer = await prisma.customerMain.upsert({
      where: { email },
      update: { onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE', complianceStatus: 'CLEAR', riskRating: 'LOW', tradingTier: 'PREMIUM' },
      create: {
        email, customerNo, phone: `+15554${tag}0000`,
        firstName: `Dep${tag}`, lastName: 'OnlyTest', passwordHash, passwordUpdatedAt: new Date(),
        customerType: 'INDIVIDUAL', onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE',
        complianceStatus: 'CLEAR', riskRating: 'LOW', tradingTier: 'PREMIUM', eddRequired: false,
      },
      select: { id: true, customerNo: true },
    });
    for (const asset of [usdt, aed]) {
      const ledger = TB_LEDGERS[asset.currency as keyof typeof TB_LEDGERS];
      for (const code of [TB_ACCOUNT_CODES.CLIENT_PAYABLE, TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE]) {
        await ensureTbAccountRegistry(prisma, {
          code, ledger, ownerType: 'CUSTOMER', ownerUuid: customer.id, ownerNo: customer.customerNo,
          assetCode: asset.code, description: `${code} for ${customer.customerNo}/${asset.code}`,
        });
      }
    }
    const depNo = buildDeterministicNo('WA', SIM, 'C_DEP', customer.customerNo);
    const depAddr = `T${createHash('sha256').update(depNo).digest('hex').slice(0, 33)}`;
    await prisma.wallet.upsert({
      where: { walletNo: depNo }, update: {},
      create: { walletNo: depNo, ownerType: 'CUSTOMER', ownerId: customer.id, ownerNo: customer.customerNo, type: 'CRYPTO_ADDRESS', walletRole: 'C_DEP', assetId: usdt.id, address: depAddr, status: 'ACTIVE' },
    });
    const depW = await prisma.wallet.findUnique({ where: { walletNo: depNo } });
    const vibanNo = buildDeterministicNo('WA', SIM, 'C_VIBAN', customer.customerNo);
    const vibanIban = `AE07086${createHash('sha256').update(vibanNo).digest('hex').replace(/\D/g, '').padEnd(16, '0').slice(0, 16)}`;
    await prisma.wallet.upsert({
      where: { walletNo: vibanNo }, update: {},
      create: { walletNo: vibanNo, ownerType: 'CUSTOMER', ownerId: customer.id, ownerNo: customer.customerNo, type: 'FIAT_BANK', walletRole: 'C_VIBAN', assetId: aed.id, iban: vibanIban, bankName: cmaTpl?.bankName ?? 'Zand Bank PJSC', accountName: cmaTpl?.accountName ?? 'FiatX Ltd', status: 'ACTIVE' },
    });
    const vibanW = await prisma.wallet.findUnique({ where: { walletNo: vibanNo } });

    // Random amounts (seeded by idx → deterministic):
    //   USDT 200..2000 (2 dp); AED 800..6000 (2 dp).
    const rnd = seeded(i);
    const usdtAmount = (200 + rnd() * 1800).toFixed(2);
    const aedAmount = (800 + rnd() * 5200).toFixed(2);
    custs.push({ idx: i, id: customer.id, customerNo: customer.customerNo, depId: depW.id, vibanId: vibanW.id, usdtAmount, aedAmount });
  }
  await provisionTbAccounts(prisma);
  console.log(`  provisioned ${custs.length} customers: ${custs[0].customerNo} .. ${custs[N - 1].customerNo}`);

  // ── Drive 2 deposits per customer (USDT crypto + AED fiat) → SUCCESS ──
  console.log('\n═══ Drive 20 deposits (10 USDT + 10 AED) → SUCCESS ═══');
  async function driveDeposit(c: Cust, asset: any, walletId: string, amount: string, type: PayinType) {
    const payin = await payinsService.createDetected({
      assetId: asset.id, toWalletId: walletId, type, amount,
      txHash: type === PayinType.CRYPTO ? `0x${SIM}${c.idx}${asset.code}` : undefined,
      fromAddress: type === PayinType.CRYPTO ? `Tsender${c.idx}` : undefined,
      fromIban: type === PayinType.FIAT ? `AE00SENDER${c.idx}` : undefined,
      referenceNo: `REF-${SIM}-${c.idx}-${asset.code}`,
    } as any);
    const dep = await waitFor(`deposit for payin ${payin.payinNo}`, () => depositService.findByPayinId(payin.id));
    if (type === PayinType.CRYPTO) {
      await payinsService.updateStatus(payin.id, PayinAction.BLOCK);
      await payinsService.updateStatus(payin.id, PayinAction.CONFIRM);
    } else {
      await payinsService.updateStatus(payin.id, PayinAction.CONFIRM);
    }
    await waitFor(`payin ${payin.payinNo} CLEARED`, async () => {
      const p = await payinsService.findOne(payin.id);
      return p.status === 'CLEARED' ? p : null;
    });
    const depWfMod = await import('../src/modules/trading/deposit-transactions/deposit-workflow.service');
    const depWf: any = ctx.get(depWfMod.DepositWorkflowService);
    await waitFor(`deposit ${dep.depositNo} COMPLIANCE_PENDING`, async () => {
      const d = await depositService.findOne(dep.id);
      return d.status === 'COMPLIANCE_PENDING' ? d : null;
    });
    await depWf.applyKytResult(dep.id, 'PASSED', 5);
    if (type === PayinType.CRYPTO) await depWf.applyTrResult(dep.id, 'PASSED');
    await waitFor(`deposit ${dep.depositNo} SUCCESS`, async () => {
      const d = await depositService.findOne(dep.id);
      if (d.status === 'SUCCESS') return d;
      if (d.status === 'FROZEN' || d.status === 'REJECTED' || d.status === 'FAILED') throw new Error(`deposit ${dep.depositNo} terminal ${d.status}`);
      return null;
    });
    return { payin, dep };
  }

  for (const c of custs) {
    const r1 = await driveDeposit(c, usdt, c.depId, c.usdtAmount, PayinType.CRYPTO);
    const r2 = await driveDeposit(c, aed, c.vibanId, c.aedAmount, PayinType.FIAT);
    console.log(`  ${c.customerNo}: USDT ${c.usdtAmount} (payin=${r1.payin.payinNo} deposit=${r1.dep.depositNo}) | AED ${c.aedAmount} (payin=${r2.payin.payinNo} deposit=${r2.dep.depositNo})`);
  }

  console.log('\n═══ DONE — 20 deposits SUCCESS ═══');
  await sleep(500);
  await ctx.close();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
