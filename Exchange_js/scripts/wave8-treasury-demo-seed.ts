import { Prisma, PrismaClient } from '@prisma/client';
import { ensureBaseSeeded } from '../prisma/seed.base';
import { seedBusiness } from '../prisma/seed.business';
import {
  cleanupWave8TreasuryDemoData,
  WAVE8_TREASURY_DEMO_DEPOSIT_NO_PREFIX,
  WAVE8_TREASURY_DEMO_WALLET_NO_PREFIX,
  buildWave8TreasuryDemoMetadata,
  buildWave8TreasuryDemoTraceId,
} from '../src/modules/asset-treasury/demo/wave8-treasury-demo.util';

const prisma = new PrismaClient({
  log: ['warn', 'error'],
});

const DEMO_CUSTOMER_NO = 'CUST-MIN-0003';
const DEMO_FEE_TRACE_ID = buildWave8TreasuryDemoTraceId('FEE');
const DEMO_REPLAY_TRACE_ID = buildWave8TreasuryDemoTraceId('REPLAY');
const DEMO_DEPOSIT_WALLET_NO = `${WAVE8_TREASURY_DEMO_WALLET_NO_PREFIX}BTC`;
const DEMO_DEPOSIT_ADDRESS = 'bc1qw8treasurydemodepositcandidate0001';
const DEMO_DEPOSIT_NO = `${WAVE8_TREASURY_DEMO_DEPOSIT_NO_PREFIX}001`;

function asDecimal(value: string) {
  return new Prisma.Decimal(value);
}

async function ensurePrerequisites() {
  await ensureBaseSeeded(prisma);
  await seedBusiness(prisma, { skipEnsureBase: true });
}

async function loadRefs() {
  const [customer, aed, btc, custBankWallet] = await Promise.all([
    prisma.customerMain.findUnique({
      where: { customerNo: DEMO_CUSTOMER_NO },
      select: { id: true, customerNo: true },
    }),
    prisma.asset.findFirst({
      where: { type: 'FIAT', code: 'AED' },
      select: { id: true, code: true },
    }),
    prisma.asset.findFirst({
      where: { type: 'CRYPTO', code: 'BTC', network: 'BITCOIN' },
      select: { id: true, code: true, network: true, decimals: true },
    }),
    prisma.wallet.findFirst({
      where: { walletRole: 'CUST_BANK', status: 'ACTIVE' },
      select: { id: true, walletNo: true, bankAccount: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  if (!customer || !aed || !btc || !custBankWallet) {
    throw new Error('Missing baseline refs for Wave 8 treasury demo seed');
  }

  return { customer, aed, btc, custBankWallet };
}

async function seedOpenReimbursement(input: {
  aed: { id: string; code: string };
  custBankWallet: { id: string; walletNo: string | null; bankAccount: string | null };
}) {
  const feeOccurrence = await prisma.feeOccurrence.create({
    data: {
      feeNo: 'FEE-W8TREASURY-001',
      feeType: 'BANK_MONTHLY_FEE',
      occurrenceType: 'PERIOD',
      status: 'RECORDED',
      assetId: input.aed.id,
      amount: asDecimal('25.00'),
      payer: 'PLATFORM',
      chargedToCustomer: false,
      sourceEntityType: 'TREASURY_DEMO',
      sourceEntityId: 'wave8-treasury-demo-fee',
      sourceEntityNo: 'W8-TREASURY-FEE-001',
      sourceWalletId: input.custBankWallet.id,
      sourceAccountRef: input.custBankWallet.bankAccount || input.custBankWallet.walletNo,
      relatedEntityType: 'TREASURY_DEMO',
      relatedEntityId: 'wave8-treasury-demo',
      relatedEntityNo: 'W8-TREASURY-DEMO',
      poolRole: 'CUST_BANK',
      reimbursementImpact: 'SAFEGUARDED_POOL',
      evidenceRef: 'wave8-treasury-demo-bank-monthly-fee',
      traceId: DEMO_FEE_TRACE_ID,
      metadata: JSON.stringify(buildWave8TreasuryDemoMetadata('open-reimbursement')),
      idempotencyKey: 'W8-TREASURY-DEMO:FEE:001',
    },
    select: { id: true, feeNo: true },
  });

  const obligation = await prisma.reimbursementObligation.create({
    data: {
      obligationNo: 'ROB-W8TREASURY-001',
      feeOccurrenceId: feeOccurrence.id,
      status: 'OPEN',
      assetId: input.aed.id,
      amount: asDecimal('25.00'),
      poolRole: 'CUST_BANK',
      sourceWalletId: input.custBankWallet.id,
      sourceAccountRef: input.custBankWallet.bankAccount || input.custBankWallet.walletNo,
      reason: 'Wave 8 treasury demo reimbursement obligation',
      traceId: DEMO_FEE_TRACE_ID,
      metadata: JSON.stringify(buildWave8TreasuryDemoMetadata('open-reimbursement')),
    },
    select: { id: true, obligationNo: true, status: true },
  });

  return { feeOccurrence, obligation };
}

async function seedReplayCandidate(input: {
  customer: { id: string; customerNo: string };
  btc: { id: string; code: string; network: string | null; decimals: number };
}) {
  const existingWallet = await prisma.wallet.findFirst({
    where: {
      ownerId: input.customer.id,
      assetId: input.btc.id,
      type: 'CRYPTO_ADDRESS',
      direction: 'INBOUND',
    },
    select: { id: true, walletNo: true, address: true },
  });

  const depositWallet =
    existingWallet ??
    (await prisma.wallet.create({
      data: {
        walletNo: DEMO_DEPOSIT_WALLET_NO,
        ownerType: 'CUSTOMER',
        ownerId: input.customer.id,
        ownerNo: input.customer.customerNo,
        type: 'CRYPTO_ADDRESS',
        direction: 'INBOUND',
        walletRole: 'DEPOSIT',
        assetId: input.btc.id,
        address: DEMO_DEPOSIT_ADDRESS,
        status: 'ACTIVE',
      },
      select: { id: true, walletNo: true, address: true },
    }));

  const deposit = await prisma.depositTransaction.create({
    data: {
      depositNo: DEMO_DEPOSIT_NO,
      ownerType: 'CUSTOMER',
      ownerId: input.customer.id,
      status: 'SUCCESS',
      assetId: input.btc.id,
      toWalletId: depositWallet.id,
      amount: asDecimal('0.25000000'),
      netAmount: asDecimal('0.25000000'),
      feeAmount: asDecimal('0'),
      fromAddress: 'bc1qw8treasurydemofromwallet0001',
      toAddress: depositWallet.address,
      txHash: 'w8treasurydemodeposit0001',
      referenceNo: 'W8-TREASURY-DEMO-DEP',
      completedAt: new Date('2026-04-06T09:00:00.000Z'),
    },
    select: { id: true, depositNo: true, status: true },
  });

  return { depositWallet, deposit };
}

function printSummary(input: {
  cleanup: Awaited<ReturnType<typeof cleanupWave8TreasuryDemoData>>;
  reimbursement: {
    feeOccurrence: { feeNo: string };
    obligation: { obligationNo: string; status: string };
  };
  replayCandidate: {
    depositWallet: { walletNo: string | null };
    deposit: { depositNo: string; status: string };
  };
}) {
  console.log('✅ Wave 8 treasury demo data ready.');
  console.log('');
  console.log('Cleanup counts:');
  for (const [key, value] of Object.entries(input.cleanup)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log('');
  console.log('Created demo records:');
  console.log(`  Fee occurrence:           ${input.reimbursement.feeOccurrence.feeNo}`);
  console.log(`  Reimbursement obligation: ${input.reimbursement.obligation.obligationNo} (${input.reimbursement.obligation.status})`);
  console.log(`  Replay candidate wallet:  ${input.replayCandidate.depositWallet.walletNo ?? '(missing walletNo)'}`);
  console.log(`  Replay candidate deposit: ${input.replayCandidate.deposit.depositNo} (${input.replayCandidate.deposit.status})`);
}

async function main() {
  try {
    console.log('--- Seeding Wave 8 treasury demo data ---');
    await ensurePrerequisites();
    const cleanup = await cleanupWave8TreasuryDemoData(prisma as any);
    const refs = await loadRefs();
    const reimbursement = await seedOpenReimbursement(refs);
    const replayCandidate = await seedReplayCandidate(refs);
    printSummary({
      cleanup,
      reimbursement,
      replayCandidate,
    });
  } catch (error) {
    console.error('Wave 8 treasury demo seed failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
