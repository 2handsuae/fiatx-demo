import { PrismaClient } from '@prisma/client';

/**
 * Prisma-clearing half of the complete business reset.
 *
 * Scope: wipe ALL business-layer Prisma rows so the demo can be re-seeded from a
 * clean slate (see prisma/seed.business.ts). This script does NOT touch base IAM
 * (users / roles / permissions / role_permissions / user_roles /
 * approval_action_policies / approval_sod_rules) — those belong to the base seed.
 *
 * It also does NOT reformat TigerBeetle or re-seed. The full reset
 * (clear → reformat TB → re-seed) is orchestrated by
 * scripts/reset-business-complete.sh (npm run db:reset:business).
 */

const prisma = new PrismaClient({
  log: ['warn', 'error'],
});

async function deleteManyIfDelegateExists(delegateName: string): Promise<number> {
  const delegate = (prisma as any)[delegateName];
  if (!delegate?.deleteMany) {
    return 0;
  }
  return (await delegate.deleteMany()).count;
}

// FK-safe order: children before parents. Each entry is a Prisma delegate name;
// every name here is verified against prisma/schema.prisma. Delegates that may
// not exist in every schema revision are guarded via deleteManyIfDelegateExists.
const BUSINESS_DELEGATES_FK_SAFE: string[] = [
  // ── Settlement / netting ───────────────────────────────────────────
  'settlementBatchItem',
  'settlementBatch',
  'outstanding',
  'feeAccrual',  // FK to asset (RESTRICT) — must precede asset cleanup downstream.

  // ── Funds layer (internal transfers) ───────────────────────────────
  'tbTransferEvidence',
  'tbEvidenceBacklog',
  'internalFundAuditLog',
  'internalTransactionAuditLog',
  'internalFund',
  'internalTransaction',
  'reimbursementObligation',

  // ── Wallet reconciliation (children before parents) ────────────────
  'reconciliationLineItem',
  'reconciliationCase',
  'reconciliationRun',
  // account_flows: projection of tb_transfer_evidence into wallet-level
  // rows. Has no FK constraint (text columns only), so safe to truncate
  // anywhere in the FK chain — but must be cleared, otherwise old rows
  // with walletRef pointing to freshly-deleted wallets create R2
  // dangling-walletRef violations in the new seed run.
  'accountFlow',
  // External ingest (no FK; standalone demo data — must be cleared too).
  'externalStatementLine',
  'externalBalance',

  // ── Payment legs ───────────────────────────────────────────────────
  'payout',
  'payin',

  // ── Deposit / withdraw / swap runtime ──────────────────────────────
  'inboundTransferSignal',
  'depositTransaction',
  'withdrawTransaction',
  'swapTransaction',
  'swapQuote',
  'withdrawPricingQuote',
  'withdrawalAddress',

  // ── Fee-level config (bindings/change-requests before levels) ──────
  'swapFeeLevelBinding',
  'swapFeeLevelChangeRequest',
  'swapFeeLevel',
  'withdrawalFeeLevelBinding',
  'withdrawalFeeLevelChangeRequest',
  'withdrawalFeeLevel',
  'pricingPolicy',

  // ── Transaction limit policies ─────────────────────────────────────
  'transactionLimitChangeRequest',
  'transactionLimitPolicy',

  // ── Compliance / KYC artifacts (reports before cases) ──────────────
  'cddResponseReport',
  'eddResponseReport',
  'kytCaseReport',
  'travelRuleCaseReport',
  'workflowDecisionRecord',
  'complianceSession',
  'eddResponse',
  'cddResponse',
  'periodicReviewCycle',
  'corporateProfile',
  'uboProfile',
  'kytCase',
  'travelRuleCase',
  'customerMaterialHolding',
  'materialRefreshCycle',
  'clientRiskAssessment',
  'tierUpgradeCase',
  'sumsubWebhookEvent',

  // ── Liquidity ──────────────────────────────────────────────────────
  'liquidityConfiguration',
  'liquidityProvider',

  // ── Customers / assets / wallets / TB registry ─────────────────────
  // tb_account_registry references customer/asset by business key, not FK,
  // but clear it before customers/assets for cleanliness.
  'tbAccountRegistry',
  'wallet',
  'customerMain',
  'asset',
];

async function resetBusinessData(): Promise<void> {
  console.log('--- Clearing ALL business-layer data (base IAM preserved) ---');

  const deleted: Record<string, number> = {};
  for (const delegate of BUSINESS_DELEGATES_FK_SAFE) {
    deleted[delegate] = await deleteManyIfDelegateExists(delegate);
  }

  for (const [delegate, count] of Object.entries(deleted)) {
    console.log(`Deleted ${count} from ${delegate}`);
  }

  console.log('✅ Business-layer Prisma data cleared.');
}

async function main(): Promise<void> {
  try {
    await resetBusinessData();
  } catch (error) {
    console.error('Failed to reset business data:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
