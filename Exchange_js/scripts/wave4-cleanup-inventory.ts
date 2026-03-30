import { PrismaClient } from '@prisma/client';
import { WITHDRAW_QUOTE_TTL_SECONDS } from '../src/modules/trading/pricing-center/types/pricing.types';

const defaultDbUrl = 'file:/tmp/exchange_js_main/dev.db';
const workspaceLocalDbUrl = 'file:/tmp/exchange_js_audit_evidence/dev.db';
const configuredDbUrl = String(process.env.DATABASE_URL || '').trim();
const resolvedDatabaseUrl =
  !configuredDbUrl || configuredDbUrl === workspaceLocalDbUrl
    ? defaultDbUrl
    : configuredDbUrl;

process.env.DATABASE_URL = resolvedDatabaseUrl;

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: resolvedDatabaseUrl,
    },
  },
  log: ['warn', 'error'],
});

function isBlankJson(value: string | null | undefined) {
  if (!value) return true;
  const trimmed = value.trim();
  return trimmed === '' || trimmed === '{}' || trimmed === '[]' || trimmed === 'null';
}

async function main() {
  const wallets = await prisma.wallet.findMany({
    select: {
      id: true,
      walletNo: true,
      ownerType: true,
      ownerNo: true,
      walletRole: true,
      assetId: true,
      status: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  const walletSnapshots = await prisma.walletBalanceSnapshot.findMany({
    select: {
      walletId: true,
    },
  });
  const snapshotWalletIdSet = new Set(
    walletSnapshots.map((snapshot: { walletId: string }) => snapshot.walletId),
  );

  const walletsMissingSnapshot = wallets
    .filter((wallet) => !snapshotWalletIdSet.has(wallet.id))
    .map((wallet) => ({
      walletId: wallet.id,
      walletNo: wallet.walletNo,
      ownerType: wallet.ownerType,
      ownerNo: wallet.ownerNo,
      walletRole: wallet.walletRole,
      status: wallet.status,
    }));

  const legacySysWalletNos = wallets
    .filter((wallet) => wallet.walletNo?.startsWith('SYS_'))
    .map((wallet) => ({
      walletId: wallet.id,
      walletNo: wallet.walletNo,
      ownerType: wallet.ownerType,
      walletRole: wallet.walletRole,
      status: wallet.status,
    }));

  const swapQuotes = await prisma.swapQuote.findMany({
    select: {
      id: true,
      quoteNo: true,
      status: true,
      createdAt: true,
      feeBreakdown: true,
      totalsJson: true,
      policyRef: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  const swapQuoteFallbackCandidates = swapQuotes
    .filter(
      (quote) =>
        !isBlankJson(quote.feeBreakdown) &&
        (isBlankJson(quote.totalsJson) || isBlankJson(quote.policyRef)),
    )
    .map((quote) => ({
      quoteId: quote.id,
      quoteNo: quote.quoteNo,
      status: quote.status,
      createdAt: quote.createdAt.toISOString(),
      totalsJson: quote.totalsJson,
      policyRef: quote.policyRef,
    }));

  const withdrawQuotes = await prisma.withdrawPricingQuote.findMany({
    select: {
      id: true,
      quoteNo: true,
      status: true,
      createdAt: true,
      expiresAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  const withdrawFarExpiryCandidates = withdrawQuotes
    .filter((quote) => {
      const effectiveExpiry = new Date(
        quote.createdAt.getTime() + WITHDRAW_QUOTE_TTL_SECONDS * 1000,
      );
      return quote.expiresAt.getTime() > effectiveExpiry.getTime();
    })
    .map((quote) => ({
      quoteId: quote.id,
      quoteNo: quote.quoteNo,
      status: quote.status,
      createdAt: quote.createdAt.toISOString(),
      expiresAt: quote.expiresAt.toISOString(),
      effectiveExpiry: new Date(
        quote.createdAt.getTime() + WITHDRAW_QUOTE_TTL_SECONDS * 1000,
      ).toISOString(),
    }));

  const report = {
    databaseUrl: resolvedDatabaseUrl,
    generatedAt: new Date().toISOString(),
    walletSnapshotCoverage: {
      totalWallets: wallets.length,
      walletsWithSnapshot: walletSnapshots.length,
      walletsMissingSnapshot: walletsMissingSnapshot.length,
      sample: walletsMissingSnapshot.slice(0, 20),
    },
    legacySysWalletNos: {
      count: legacySysWalletNos.length,
      sample: legacySysWalletNos.slice(0, 20),
    },
    swapQuoteFallbackCandidates: {
      count: swapQuoteFallbackCandidates.length,
      sample: swapQuoteFallbackCandidates.slice(0, 20),
    },
    withdrawFarExpiryCandidates: {
      count: withdrawFarExpiryCandidates.length,
      sample: withdrawFarExpiryCandidates.slice(0, 20),
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error('[wave4:cleanup:inventory] failed');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
