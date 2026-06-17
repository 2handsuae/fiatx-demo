// Provision 5 demo customers with full wallet + withdrawal-target setup:
//   - C_DEP (USDT)            via CustomerDepositWalletService.createOrReturn
//   - C_VIBAN (AED)           via CustomerDepositWalletService.createOrReturn
//   - USDT withdrawal address via WithdrawalAddressWorkflowService.registerAddress
//   - AED bank account        via WithdrawalAddressWorkflowService.registerBankAccount

import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { CustomerDepositWalletService } from '../src/modules/asset-treasury/wallets/customer-deposit-wallet.service';
import { WithdrawalAddressWorkflowService } from '../src/modules/asset-treasury/withdrawal-addresses/withdrawal-address-workflow.service';

const PICKS = ['Alice', 'Bob', 'Carol', 'Frank', 'Grace'];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const depositWallet = app.get(CustomerDepositWalletService);
  const wdWorkflow = app.get(WithdrawalAddressWorkflowService);

  const usdt = await (prisma as any).asset.findFirst({ where: { currency: 'USDT' } });
  const aed = await (prisma as any).asset.findFirst({ where: { currency: 'AED' } });
  if (!usdt || !aed) throw new Error('missing usdt/aed asset');

  const customers = await (prisma as any).customerMain.findMany({
    where: { firstName: { in: PICKS } },
    select: { id: true, customerNo: true, firstName: true, lastName: true },
  });
  if (customers.length < 5) throw new Error(`expected 5 customers, got ${customers.length}`);

  console.log(`\n═══ Provisioning 5 demo customers: ${PICKS.join(', ')} ═══\n`);

  // Deterministic-ish but distinct TRC20 addresses (43 chars, T-prefix). Mock chain → no real validation.
  const TRC20_ADDRS = [
    'TZBmCjqfHxYpFW3hPQpAVQrFFMHwMmf3Rn',
    'TYZ4xQpDKLcDmCT7nXfvBxKvKzNpQRsT4w',
    'TGNwLqEKMdJ8XvHsBcWzPnQRsTUVxY7zAb',
    'TXyZ2bCdEfGhJjKmNopQrSt5uVwXyZ8aBc',
    'TKpJmNopQrSt6uVwXyZaBcDeFgHkjKmN3o',
  ];
  // Compute valid UAE IBAN checksum on the fly (mod-97 per ISO 13616).
  function ibanFor(bban19: string): string {
    const rearranged = bban19 + 'AE' + '00';
    const numeric = [...rearranged].map((c) =>
      /[A-Z]/.test(c) ? (c.charCodeAt(0) - 55).toString() : c,
    ).join('');
    const check = 98n - (BigInt(numeric) % 97n);
    return 'AE' + check.toString().padStart(2, '0') + bban19;
  }
  const IBANS = [
    ibanFor('0331234567890123456'),
    ibanFor('0331234567890111111'),
    ibanFor('0331234567890222222'),
    ibanFor('0331234567890333333'),
    ibanFor('0331234567890444444'),
  ];

  for (let i = 0; i < customers.length; i++) {
    const c = customers[i];
    const fullName = `${c.firstName} ${c.lastName}`;
    console.log(`── ${c.customerNo} ${fullName} ──`);

    // 1) USDT C_DEP
    const cDep: any = await depositWallet.createOrReturn(c.id, usdt.id);
    console.log(`   C_DEP USDT       walletNo=${cDep?.walletNo} status=${cDep?.status}`);

    // 2) AED C_VIBAN (also creates C_CMA cascade if missing per service logic)
    const cVi: any = await depositWallet.createOrReturn(c.id, aed.id);
    console.log(`   C_VIBAN AED      walletNo=${cVi?.walletNo} status=${cVi?.status}`);

    // 3) USDT withdrawal address
    const addr = await wdWorkflow.registerAddress(
      {
        assetId: usdt.id,
        address: TRC20_ADDRS[i],
        ownershipDeclaration: true,
        label: `${c.firstName}'s Ledger`,
        beneficiaryName: fullName,
      } as any,
      c.id,
      c.customerNo,
    );
    console.log(`   USDT Wd Address  addressNo=${addr.addressNo} status=${addr.status}`);

    // 4) AED bank account
    const bank = await wdWorkflow.registerBankAccount(
      {
        assetId: aed.id,
        beneficiaryName: fullName,
        bankName: 'Emirates NBD',
        iban: IBANS[i],
        swiftBic: 'EBILAEAD',
        label: `${c.firstName}'s Savings`,
        ownershipDeclaration: true,
      } as any,
      c.id,
      c.customerNo,
    );
    console.log(`   AED Bank Account addressNo=${bank.addressNo} status=${bank.status}`);

    console.log();
  }

  // ── Summary recon ──
  const finalWallets = await (prisma as any).wallet.count({
    where: { ownerType: 'CUSTOMER', walletRole: { in: ['C_DEP', 'C_VIBAN', 'C_CMA'] } },
  });
  const finalAddrs = await (prisma as any).withdrawalAddress.count();
  console.log(`═══ DONE — ${finalWallets} customer wallets · ${finalAddrs} withdrawal targets ═══\n`);

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
