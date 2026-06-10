import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import * as path from 'path';
import { ensureBaseSeeded } from '../prisma/seed.base';
import { seedBusiness } from '../prisma/seed.business';
import { buildDeterministicWalletNo } from '../src/common/utils/no-generator.util';
import {
  DEMO_BUSINESS_DATE,
  DEMO_SCENARIOS,
  parseDemoFiatStatementCsv,
} from '../src/modules/clearing-settle/safeguarding-reconciliation/demo/wave8-safeguarding-demo.util';
import {
  buildCryptoSystemWalletNo,
  buildFiatPoolWalletNo,
} from '../src/modules/asset-treasury/wallets/system-wallet.util';

const prisma = new PrismaClient({
  log: ['warn', 'error'],
});

const DEMO_SOURCE_TYPE = 'SAFEGUARDING_DEMO';
const DEMO_EVENT_CODE = 'WF16_SAFEGUARDING_DEMO';
const DEMO_CUSTOMER_NO = 'CUST-MIN-0003';
const BTC_DEPOSIT_WALLET_NO = buildDeterministicWalletNo(
  'DEPOSIT',
  DEMO_SCENARIOS.BTC.assetCode,
  'DEMO-CUST-MIN-0003',
);
const BTC_DEPOSIT_ADDRESS = 'bc1qwf16democustmin0003depositwallet0001';
const AED_STATEMENT_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures',
  'wave8-safeguarding-aed-statement-2026-04-01.csv',
);
const SAFE_FIAT_IN_TRANSIT_STATUSES = ['CONFIRMING', 'CONFIRMED'];

type DemoAssetRefs = {
  btc: { id: string; code: string; network: string };
  usdt: { id: string; code: string; network: string };
  aed: { id: string; code: string; network: string };
};

type DemoWalletRefs = {
  btcDeposit: { id: string; walletNo: string };
  btcMaster: { id: string; walletNo: string };
  btcPayout: { id: string; walletNo: string };
  usdtMaster: { id: string; walletNo: string };
  usdtPayout: { id: string; walletNo: string };
  aedCustBank: { id: string; walletNo: string; iban: string | null };
};

function asDecimal(value: string) {
  return new Prisma.Decimal(value);
}

function demoTraceId(suffix: string) {
  return `SAFEGUARDING:${DEMO_BUSINESS_DATE}:DEMO:${suffix}`;
}

async function ensurePrerequisites() {
  await ensureBaseSeeded(prisma);
  await seedBusiness(prisma, { skipEnsureBase: true });
}

async function loadDemoAssets(): Promise<DemoAssetRefs> {
  const assets = await prisma.asset.findMany({
    where: {
      OR: [
        { type: 'CRYPTO', code: DEMO_SCENARIOS.BTC.assetCode, network: DEMO_SCENARIOS.BTC.network },
        { type: 'CRYPTO', code: DEMO_SCENARIOS.USDT.assetCode, network: DEMO_SCENARIOS.USDT.network },
        { type: 'FIAT', code: DEMO_SCENARIOS.AED.assetCode },
      ],
    },
    select: { id: true, code: true, network: true, type: true },
  });

  const btc = assets.find(
    (asset) =>
      asset.type === 'CRYPTO' &&
      asset.code === DEMO_SCENARIOS.BTC.assetCode &&
      asset.network === DEMO_SCENARIOS.BTC.network,
  );
  const usdt = assets.find(
    (asset) =>
      asset.type === 'CRYPTO' &&
      asset.code === DEMO_SCENARIOS.USDT.assetCode &&
      asset.network === DEMO_SCENARIOS.USDT.network,
  );
  const aed = assets.find(
    (asset) => asset.type === 'FIAT' && asset.code === DEMO_SCENARIOS.AED.assetCode,
  );

  if (!btc || !usdt || !aed) {
    throw new Error('Missing demo assets for Wave 8 safeguarding seed');
  }

  return {
    btc: {
      id: btc.id,
      code: btc.code,
      network: btc.network ?? DEMO_SCENARIOS.BTC.network,
    },
    usdt: {
      id: usdt.id,
      code: usdt.code,
      network: usdt.network ?? DEMO_SCENARIOS.USDT.network,
    },
    aed: {
      id: aed.id,
      code: aed.code,
      network: aed.network ?? '',
    },
  };
}

async function loadDemoCustomer() {
  const customer = await prisma.customerMain.findUnique({
    where: { customerNo: DEMO_CUSTOMER_NO },
    select: { id: true, customerNo: true },
  });
  if (!customer) {
    throw new Error(`Missing demo customer ${DEMO_CUSTOMER_NO}`);
  }
  return customer;
}

async function ensureDemoDepositWallet(
  assetId: string,
  customer: { id: string; customerNo: string },
): Promise<{ id: string; walletNo: string }> {
  const existing = await prisma.wallet.findUnique({
    where: { walletNo: BTC_DEPOSIT_WALLET_NO },
    select: { id: true, walletNo: true },
  });

  if (existing) {
    await prisma.wallet.update({
      where: { id: existing.id },
      data: {
        ownerType: 'CUSTOMER',
        ownerId: customer.id,
        ownerNo: customer.customerNo,
        type: 'CRYPTO_ADDRESS',
        direction: 'INBOUND',
        walletRole: 'DEPOSIT',
        assetId,
        address: BTC_DEPOSIT_ADDRESS,
        status: 'ACTIVE',
      },
    });
    return {
      id: existing.id,
      walletNo: BTC_DEPOSIT_WALLET_NO,
    };
  }

  const created = await prisma.wallet.create({
    data: {
      walletNo: BTC_DEPOSIT_WALLET_NO,
      ownerType: 'CUSTOMER',
      ownerId: customer.id,
      ownerNo: customer.customerNo,
      type: 'CRYPTO_ADDRESS',
      direction: 'INBOUND',
      walletRole: 'DEPOSIT',
      assetId,
      address: BTC_DEPOSIT_ADDRESS,
      status: 'ACTIVE',
    },
    select: { id: true, walletNo: true },
  });

  return {
    id: created.id,
    walletNo: BTC_DEPOSIT_WALLET_NO,
  };
}

async function loadDemoWallets(
  assets: DemoAssetRefs,
  customer: { id: string; customerNo: string },
): Promise<DemoWalletRefs> {
  const btcDeposit = await ensureDemoDepositWallet(assets.btc.id, customer);

  const walletNos = [
    buildCryptoSystemWalletNo('MASTER', assets.btc.code, assets.btc.network),
    buildCryptoSystemWalletNo('PAYOUT', assets.btc.code, assets.btc.network),
    buildCryptoSystemWalletNo('MASTER', assets.usdt.code, assets.usdt.network),
    buildCryptoSystemWalletNo('PAYOUT', assets.usdt.code, assets.usdt.network),
    buildFiatPoolWalletNo('CUST_BANK', assets.aed.code),
  ];

  const wallets = await prisma.wallet.findMany({
    where: { walletNo: { in: walletNos } },
    select: { id: true, walletNo: true, iban: true },
  });
  const walletByNo = new Map(wallets.map((wallet) => [wallet.walletNo || '', wallet]));

  const btcMaster = walletByNo.get(
    buildCryptoSystemWalletNo('MASTER', assets.btc.code, assets.btc.network),
  );
  const btcPayout = walletByNo.get(
    buildCryptoSystemWalletNo('PAYOUT', assets.btc.code, assets.btc.network),
  );
  const usdtMaster = walletByNo.get(
    buildCryptoSystemWalletNo('MASTER', assets.usdt.code, assets.usdt.network),
  );
  const usdtPayout = walletByNo.get(
    buildCryptoSystemWalletNo('PAYOUT', assets.usdt.code, assets.usdt.network),
  );
  const aedCustBank = walletByNo.get(buildFiatPoolWalletNo('CUST_BANK', assets.aed.code));

  if (!btcMaster || !btcPayout || !usdtMaster || !usdtPayout || !aedCustBank) {
    throw new Error('Missing canonical pool wallets for Wave 8 safeguarding demo');
  }

  return {
    btcDeposit,
    btcMaster: {
      id: btcMaster.id,
      walletNo: btcMaster.walletNo ?? buildCryptoSystemWalletNo('MASTER', assets.btc.code, assets.btc.network),
    },
    btcPayout: {
      id: btcPayout.id,
      walletNo: btcPayout.walletNo ?? buildCryptoSystemWalletNo('PAYOUT', assets.btc.code, assets.btc.network),
    },
    usdtMaster: {
      id: usdtMaster.id,
      walletNo: usdtMaster.walletNo ?? buildCryptoSystemWalletNo('MASTER', assets.usdt.code, assets.usdt.network),
    },
    usdtPayout: {
      id: usdtPayout.id,
      walletNo: usdtPayout.walletNo ?? buildCryptoSystemWalletNo('PAYOUT', assets.usdt.code, assets.usdt.network),
    },
    aedCustBank: {
      id: aedCustBank.id,
      walletNo: aedCustBank.walletNo ?? buildFiatPoolWalletNo('CUST_BANK', assets.aed.code),
      iban: aedCustBank.iban,
    },
  };
}

async function assertNoFiatInTransit() {
  const count = await prisma.payout.count({
    where: {
      type: 'FIAT',
      status: { in: SAFE_FIAT_IN_TRANSIT_STATUSES },
    },
  });

  if (count > 0) {
    throw new Error(
      'Wave 8 safeguarding demo requires zero FIAT payouts in CONFIRMING/CONFIRMED. Run npm run dev:reset first.',
    );
  }
}

async function assertNoUnexpectedAssetLiabilities(
  customerId: string,
  assetIds: string[],
) {
  const rows = await prisma.journalLine.findMany({
    where: {
      ownerType: 'CUSTOMER',
      ownerId: { not: customerId },
      assetId: { in: assetIds },
      accountCode: { in: ['L.CLIENT_CREDIT', 'L.CLIENT_HELD'] },
    },
    select: {
      assetId: true,
      ownerId: true,
      drCr: true,
      amount: true,
    },
  });

  if (!rows.length) {
    return;
  }

  const nonZeroByAsset = new Map<string, Prisma.Decimal>();
  for (const row of rows) {
    const current = nonZeroByAsset.get(row.assetId) || new Prisma.Decimal(0);
    const amount = new Prisma.Decimal(row.amount);
    nonZeroByAsset.set(
      row.assetId,
      String(row.drCr || '').toUpperCase() === 'CR'
        ? current.plus(amount)
        : current.minus(amount),
    );
  }

  const offenders = Array.from(nonZeroByAsset.entries()).filter(([, amount]) => !amount.eq(0));
  if (offenders.length) {
    throw new Error(
      `Wave 8 safeguarding demo found non-demo customer liabilities on demo assets: ${offenders
        .map(([assetId, amount]) => `${assetId}:${amount.toString()}`)
        .join(', ')}. Run npm run dev:reset first.`,
    );
  }
}

async function cleanupDemoArtifacts(
  assets: DemoAssetRefs,
  wallets: DemoWalletRefs,
) {
  const demoRuns = await (prisma as any).safeguardingRun.findMany({
    where: { businessDate: DEMO_BUSINESS_DATE },
    select: { id: true },
  });
  const runIds = demoRuns.map((item: any) => item.id);

  const demoImports = await (prisma as any).fiatStatementImport.findMany({
    where: { businessDate: DEMO_BUSINESS_DATE },
    select: { id: true },
  });
  const importIds = demoImports.map((item: any) => item.id);

  if (importIds.length) {
    await (prisma as any).fiatStatementEntry.deleteMany({
      where: { importId: { in: importIds } },
    });
  }
  await (prisma as any).fiatStatementImport.deleteMany({
    where: { businessDate: DEMO_BUSINESS_DATE },
  });
  await (prisma as any).reconciliationWarning.deleteMany({
    where: { businessDate: DEMO_BUSINESS_DATE },
  });
  await (prisma as any).reconciliationBreak.deleteMany({
    where: {
      businessDate: DEMO_BUSINESS_DATE,
      sourceType: 'SAFEGUARDING_ASSET',
    },
  });
  if (runIds.length) {
    await (prisma as any).liabilitySnapshot.deleteMany({
      where: { runId: { in: runIds } },
    });
    await (prisma as any).safeguardingPoolSnapshot.deleteMany({
      where: { runId: { in: runIds } },
    });
  }
  await (prisma as any).safeguardingRun.deleteMany({
    where: { businessDate: DEMO_BUSINESS_DATE },
  });

  await (prisma as any).safeguardingPolicy.deleteMany({
    where: {
      OR: [
        { assetId: assets.btc.id, poolRole: 'DEPOSIT' },
        { assetId: assets.btc.id, poolRole: 'PAYOUT' },
        { assetId: assets.usdt.id, poolRole: 'PAYOUT' },
      ],
    },
  });

  const demoJournals = await prisma.journal.findMany({
    where: { sourceType: DEMO_SOURCE_TYPE },
    select: { id: true },
  });
  const demoJournalIds = demoJournals.map((item) => item.id);
  if (demoJournalIds.length) {
    await prisma.journalLine.deleteMany({
      where: { journalId: { in: demoJournalIds } },
    });
    await prisma.journal.deleteMany({
      where: { id: { in: demoJournalIds } },
    });
  }

  await prisma.walletBalanceSnapshot.deleteMany({
    where: {
      walletId: wallets.btcDeposit.id,
      assetId: assets.btc.id,
    },
  });
}

async function assertManagedPoolSurface(
  assets: DemoAssetRefs,
  wallets: DemoWalletRefs,
) {
  const managedWalletIds = new Set([
    wallets.btcDeposit.id,
    wallets.btcMaster.id,
    wallets.btcPayout.id,
    wallets.usdtMaster.id,
    wallets.usdtPayout.id,
    wallets.aedCustBank.id,
  ]);

  const snapshots = await prisma.walletBalanceSnapshot.findMany({
    where: {
      assetId: { in: [assets.btc.id, assets.usdt.id, assets.aed.id] },
      totalBalance: { not: new Prisma.Decimal(0) },
      wallet: {
        status: 'ACTIVE',
        walletRole: { in: ['DEPOSIT', 'MASTER', 'PAYOUT', 'CUST_BANK'] },
      },
    },
    select: {
      walletId: true,
      totalBalance: true,
      wallet: {
        select: {
          walletNo: true,
          walletRole: true,
        },
      },
    },
  });

  const unexpected = snapshots.filter((snapshot) => !managedWalletIds.has(snapshot.walletId));
  if (unexpected.length) {
    const refs = unexpected
      .map((item) => `${item.wallet.walletNo || item.walletId}:${item.totalBalance}`)
      .join(', ');
    throw new Error(
      `Wave 8 safeguarding demo found unexpected active pool balances for demo assets: ${refs}. Run npm run dev:reset first.`,
    );
  }
}

async function adjustLiability(
  customerId: string,
  assetId: string,
  targetLiability: string,
  assetAccountCode: 'A.CLIENT_CUSTODY' | 'A.CLIENT_BANK',
  sourceId: string,
  description: string,
) {
  const rows = await prisma.journalLine.findMany({
    where: {
      ownerType: 'CUSTOMER',
      ownerId: customerId,
      assetId,
      accountCode: { in: ['L.CLIENT_CREDIT', 'L.CLIENT_HELD'] },
    },
    select: {
      drCr: true,
      amount: true,
    },
  });

  const currentLiability = rows.reduce((sum, row) => {
    const amount = new Prisma.Decimal(row.amount);
    return String(row.drCr || '').toUpperCase() === 'CR'
      ? sum.plus(amount)
      : sum.minus(amount);
  }, new Prisma.Decimal(0));
  const target = asDecimal(targetLiability);
  const delta = target.minus(currentLiability);

  if (delta.eq(0)) {
    return;
  }

  const absoluteDelta = delta.abs();
  const increaseLiability = delta.gt(0);

  await prisma.journal.create({
    data: {
      id: randomUUID(),
      journalNo: `${sourceId}-${Date.now()}`,
      sourceType: DEMO_SOURCE_TYPE,
      sourceId,
      sourceNo: sourceId,
      eventCode: DEMO_EVENT_CODE,
      postingStatus: 'POSTED',
      postedAt: new Date(`${DEMO_BUSINESS_DATE}T12:00:00.000Z`),
      baseAssetId: assetId,
      description,
      totalAmount: absoluteDelta,
      lines: {
        create: [
          {
            id: randomUUID(),
            lineNo: 1,
            accountCode: increaseLiability ? assetAccountCode : 'L.CLIENT_CREDIT',
            drCr: increaseLiability ? 'DR' : 'DR',
            amount: absoluteDelta,
            assetId,
            ownerType: 'CUSTOMER',
            ownerId: customerId,
            dimensions: '{}',
            description: `${description} line 1`,
          },
          {
            id: randomUUID(),
            lineNo: 2,
            accountCode: increaseLiability ? 'L.CLIENT_CREDIT' : assetAccountCode,
            drCr: increaseLiability ? 'CR' : 'CR',
            amount: absoluteDelta,
            assetId,
            ownerType: 'CUSTOMER',
            ownerId: customerId,
            dimensions: '{}',
            description: `${description} line 2`,
          },
        ],
      },
    },
  });
}

async function upsertWalletSnapshot(
  walletId: string,
  assetId: string,
  totalBalance: string,
  updatedAt?: string,
) {
  const amount = asDecimal(totalBalance);
  await prisma.walletBalanceSnapshot.upsert({
    where: {
      walletId_assetId: {
        walletId,
        assetId,
      },
    },
    update: {
      availableBalance: amount,
      restrictedBalance: new Prisma.Decimal(0),
      inTransitBalance: new Prisma.Decimal(0),
      totalBalance: amount,
    },
    create: {
      walletId,
      assetId,
      availableBalance: amount,
      restrictedBalance: new Prisma.Decimal(0),
      inTransitBalance: new Prisma.Decimal(0),
      totalBalance: amount,
    },
  });

  if (updatedAt) {
    await prisma.$executeRawUnsafe(
      'UPDATE wallet_balance_snapshots SET updatedAt = ? WHERE walletId = ? AND assetId = ?',
      updatedAt,
      walletId,
      assetId,
    );
  }
}

async function seedPolicies(assets: DemoAssetRefs) {
  await (prisma as any).safeguardingPolicy.create({
    data: {
      policyNo: 'SGP-WF16-DEMO-BTC-DEPOSIT',
      assetId: assets.btc.id,
      poolRole: 'DEPOSIT',
      status: 'ACTIVE',
      collectionAmountThreshold: asDecimal(
        DEMO_SCENARIOS.BTC.policies.depositThresholdAmount,
      ),
      collectionMaxAgeMinutes: DEMO_SCENARIOS.BTC.policies.depositMaxAgeMinutes,
    },
  });

  await (prisma as any).safeguardingPolicy.create({
    data: {
      policyNo: 'SGP-WF16-DEMO-BTC-PAYOUT',
      assetId: assets.btc.id,
      poolRole: 'PAYOUT',
      status: 'ACTIVE',
      targetMaxBalance: asDecimal(DEMO_SCENARIOS.BTC.policies.payoutTargetMax),
    },
  });

  await (prisma as any).safeguardingPolicy.create({
    data: {
      policyNo: 'SGP-WF16-DEMO-USDT-PAYOUT',
      assetId: assets.usdt.id,
      poolRole: 'PAYOUT',
      status: 'ACTIVE',
      targetMinBalance: asDecimal(DEMO_SCENARIOS.USDT.policies.payoutTargetMin),
    },
  });
}

async function seedFiatStatementImport(assetId: string, walletId: string) {
  const parsed = parseDemoFiatStatementCsv(
    readFileSync(AED_STATEMENT_FIXTURE_PATH, 'utf8'),
  );

  const createdImport = await (prisma as any).fiatStatementImport.create({
    data: {
      importNo: 'STI-WF16-DEMO-AED-20260401',
      runId: null,
      businessDate: DEMO_BUSINESS_DATE,
      assetId,
      walletId,
      fileName: path.basename(AED_STATEMENT_FIXTURE_PATH),
      status: 'READY',
      closingBalance: asDecimal(parsed.closingBalance),
      parsedAt: new Date(`${DEMO_BUSINESS_DATE}T12:30:00.000Z`),
      traceId: demoTraceId('AED'),
      detailsJson: JSON.stringify({ rowCount: parsed.rows.length, fixture: true }),
    },
  });

  await (prisma as any).fiatStatementEntry.createMany({
    data: parsed.rows.map((row) => ({
      id: randomUUID(),
      importId: createdImport.id,
      lineNo: row.lineNo,
      valueDate: row.valueDate,
      referenceNo: row.referenceNo,
      description: row.description,
      amount: asDecimal(row.amount),
      balance: asDecimal(row.balance),
      rawRowJson: row.rawRowJson,
    })),
  });
}

async function main() {
  try {
    console.log('--- Seeding Wave 8 safeguarding warning-only demo data ---');
    await ensurePrerequisites();
    const assets = await loadDemoAssets();
    const customer = await loadDemoCustomer();
    const wallets = await loadDemoWallets(assets, customer);

    await assertNoFiatInTransit();
    await assertNoUnexpectedAssetLiabilities(customer.id, [
      assets.btc.id,
      assets.usdt.id,
      assets.aed.id,
    ]);
    await cleanupDemoArtifacts(assets, wallets);
    await assertManagedPoolSurface(assets, wallets);

    await adjustLiability(
      customer.id,
      assets.btc.id,
      DEMO_SCENARIOS.BTC.targetLiability,
      'A.CLIENT_CUSTODY',
      'WF16-DEMO-BTC-LIABILITY',
      'Wave 8 safeguarding demo BTC liability fixture',
    );
    await adjustLiability(
      customer.id,
      assets.usdt.id,
      DEMO_SCENARIOS.USDT.targetLiability,
      'A.CLIENT_CUSTODY',
      'WF16-DEMO-USDT-LIABILITY',
      'Wave 8 safeguarding demo USDT liability fixture',
    );
    await adjustLiability(
      customer.id,
      assets.aed.id,
      DEMO_SCENARIOS.AED.targetLiability,
      'A.CLIENT_BANK',
      'WF16-DEMO-AED-LIABILITY',
      'Wave 8 safeguarding demo AED liability fixture',
    );

    await upsertWalletSnapshot(
      wallets.btcDeposit.id,
      assets.btc.id,
      DEMO_SCENARIOS.BTC.poolTargets.deposit,
      `${DEMO_BUSINESS_DATE}T20:00:00.000Z`,
    );
    await upsertWalletSnapshot(
      wallets.btcMaster.id,
      assets.btc.id,
      DEMO_SCENARIOS.BTC.poolTargets.master,
    );
    await upsertWalletSnapshot(
      wallets.btcPayout.id,
      assets.btc.id,
      DEMO_SCENARIOS.BTC.poolTargets.payout,
    );
    await upsertWalletSnapshot(
      wallets.usdtMaster.id,
      assets.usdt.id,
      DEMO_SCENARIOS.USDT.poolTargets.master,
    );
    await upsertWalletSnapshot(
      wallets.usdtPayout.id,
      assets.usdt.id,
      DEMO_SCENARIOS.USDT.poolTargets.payout,
    );
    await upsertWalletSnapshot(
      wallets.aedCustBank.id,
      assets.aed.id,
      DEMO_SCENARIOS.AED.poolTargets.custBank,
    );

    await seedPolicies(assets);
    await seedFiatStatementImport(assets.aed.id, wallets.aedCustBank.id);

    console.log('✅ Wave 8 safeguarding demo data ready.');
    console.log(`Demo date: ${DEMO_BUSINESS_DATE}`);
    console.log(
      'Next: POST /admin/reconciliation/safeguarding-breaks/generate-daily-diff with the demo date.',
    );
  } catch (error) {
    console.error('Failed to seed Wave 8 safeguarding demo data:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
