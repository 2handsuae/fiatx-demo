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
  // 报送台（战役甲波二 Task 1 加表时漏登记本清单——entries FK → filing(RESTRICT)，
  // 子先删；否则旧库里 e2e/RBAC 探针建出的 filing 行会在 reset 后原样留存）。
  'regulatoryFilingEntry',
  'regulatoryFiling',
  // 公司资金台（战役乙波二 T1 加表——capitalInjection FK → asset(RESTRICT)；vendorPayment
  // 另 FK → outsourcingVendor(RESTRICT)，必须排在下方 outsourcingVendor 之前。funds_orders 的
  // 第六/第七父键 FK → 本两表(ON DELETE CASCADE)，但 fundsOrder 已在上方「Funds layer」段更早
  // 清空，顺序天然安全——同 lpExchange 先例。加表必配，波二判例。）
  'capitalInjection',
  'vendorPayment',
  // 合规办公室三表（战役甲波四 T1 加表时同样漏登记本清单——2026-09-27 T7 重铺闸首验
  // 撞见：verify:rbac 的 OBLIGATION/RI 探针夹具在 reset 后原样留存，与上面 regulatoryFiling
  // 那次一模一样的遗漏形态。三表互无 FK、彼此独立，删除顺序不敏感。）
  'complianceObligation',
  'outsourcingVendor',
  'responsibleIndividual',
  // 投诉工作流两表（战役甲波五 T1 加表——同上两次遗漏一模一样的形态，这次随手一起
  // 登记。两表无 FK（complaintEntry.complaintNo 是文本列，非 @relation），删除顺序
  // 不敏感，子表放前面只是与本节书写习惯保持一致。）
  'complaintEntry',
  'complaint',
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
  'sumsubWebhookEvent',

  // ── Governance approvals (children before parents) ─────────────────
  // approval_cases/approval_steps 从建库起就不在这份清单里——approval_steps FK →
  // approval_cases 在 DB 层有 ON DELETE CASCADE（migration 20260316000000，见
  // schema.prisma ApprovalStep.approvalCase relation），此前没被单独撞见过是因为
  // 走审批流程的功能都靠各自的主体表（internalTransfer/incident 等）一起清、级联
  // 视觉上"看起来清了"——直到战役乙波一 LP 档案/兑换单登场，两条主体表都漏登记
  // 本清单的同时，也才第一次看见 approval_cases/approval_steps 本身的缺口（reset 后
  // 行数不归零，2026-09-29 T7 截图闸走查撞见，TOOLING-DEBT 已登记）。DB 级 CASCADE 已
  // 保证删 approval_cases 会带走 approval_steps，这里仍显式列出子表——照本清单其余
  // 加表先例，一次列全，不靠隐式级联省一行。
  'approvalStep',
  'approvalCase',

  // ── LP desk（战役乙波一 T2/T4 加表）──────────────────────────────────
  // lp_exchanges FK → liquidity_providers 且 FK → asset（均默认 RESTRICT，无 onDelete
  // 覆盖）：必须排在 liquidityProvider 与 asset 之前。funds_orders.lpExchangeId 也
  // FK → lp_exchanges（ON DELETE CASCADE），但 fundsOrder 已在上方「Funds layer」段
  // 更早被清空，顺序天然安全。
  'lpExchange',
  'liquidityProvider',

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
  // tier_upgrade_applications：FK → customer_main，本波（交易档位升级）加表时漏登记
  // 本清单，重铺撞 P2003 才被逮到（TOOLING-DEBT）。
  'tierUpgradeApplication',
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
