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
  'fundsOrder',
  // internal_transfers：FK → asset(RESTRICT)，且 fundsOrder.internalTransferId 引用它——必须排在
  // fundsOrder 之后、asset 之前。平账二期 Task 2（c1fde421）加表时漏登记本清单，
  // 直到 Task 10 重铺验证撞 P2003 才发现（TOOLING-DEBT）。
  'internalTransfer',
  'internalTransaction',
  'reimbursementObligation',

  // ── Wallet reconciliation (children before parents) ────────────────
  // 调账单：引用 caseNo（文本列、无 FK 约束），但必须一起清——否则重铺后
  // 旧调账单还挂在已删除案件的单号上，案件页的「本案调账单」块会长期堆
  // 陈年残留（一期落地当天就攒了 79 行）。放在 case 之前只是与本节
  // 「children before parents」的书写顺序保持一致。
  // 平账三期：事故登记（零 FK 到 asset，但 notes/remediations FK → incidents，子先删）
  'incidentNote',
  'incidentRemediation',
  'incident',
  'reconciliationAdjustment',
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

  // ── Fee-level config (change-requests before levels) ────────────────
  'swapFeeLevelChangeRequest',
  'swapFeeLevel',
  'withdrawalFeeLevelChangeRequest',
  'withdrawalFeeLevel',
  'pricingPolicy',

  // ── Transaction limit rules ────────────────────────────────────────
  'transactionLimitRule',

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
  'kytCase',
  'travelRuleCase',
  // materialRefreshCycle 先于 customerMaterialHolding：见 resetBusinessData() 里
  // 断循环外键那一步的注释。
  'materialRefreshCycle',
  'customerMaterialHolding',
  'sumsubWebhookEvent',

  // ── Customers / assets / wallets / TB registry ─────────────────────
  // tb_account_registry references customer/asset by business key, not FK,
  // but clear it before customers/assets for cleanliness.
  'tbAccountRegistry',
  'wallet',
  // customer_restrictions FK → customer_main：子表必须先删，否则 reset 撞 FK。
  'customerRestriction',
  // 2026-08-24 补：这两张也 FK → customer_main，此前漏在清单外 —— `material_requests`
  // 有行时 reset-main 会在 customerMain 上抛 P2003（业主实测撞到过，库被清到一半卡住）。
  // 两张表分别由 20260817000000_material_requests 与客户标签那批迁移加入，
  // 加表时都没有同步更新本清单。**以后加任何 FK → customer_main 的表，必须回来加一行。**
  'materialRequest',
  'customerExplicitTag',
  'customerMain',
  'asset',
];

async function resetBusinessData(): Promise<void> {
  console.log('--- Clearing ALL business-layer data (base IAM preserved) ---');

  // CustomerMaterialHolding ⇄ MaterialRefreshCycle 是一对真循环外键
  // （holding.activeRefreshCycleId → cycle.id，cycle.holdingId → holding.id，
  // 两条边都没有 onDelete，默认 RESTRICT）。光靠"子表先于父表"的线性顺序解不开
  // 循环——不管这两张表谁排前面，都会被另一条边挡住撞 P2003。先把
  // activeRefreshCycleId 置空断开其中一条边，再按下面 materialRefreshCycle
  // 先于 customerMaterialHolding 的顺序删，两张表才都能删干净。
  const holdingDelegate = (prisma as any).customerMaterialHolding;
  if (holdingDelegate?.updateMany) {
    await holdingDelegate.updateMany({ data: { activeRefreshCycleId: null } });
  }

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
