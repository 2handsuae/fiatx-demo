import { PrismaClient } from '@prisma/client';
import { seedBusiness } from '../prisma/seed.business';
import {
  buildCryptoSystemWalletNo,
  buildFiatPoolWalletNo,
} from '../src/modules/asset-treasury/wallets/system-wallet.util';
import { cleanupWave8TreasuryDemoData } from '../src/modules/asset-treasury/demo/wave8-treasury-demo.util';
import { cleanupWave8Gov02DemoData } from '../src/modules/governance/regulatory-gates/demo/wave8-gov02-demo.util';

const prisma = new PrismaClient({
  log: ['warn', 'error'],
});

async function getPreservedBaselineWalletNos(): Promise<string[]> {
  const assets = await prisma.asset.findMany({
    where: { status: 'ACTIVE' },
    select: { type: true, code: true, network: true },
    orderBy: [{ type: 'asc' }, { code: 'asc' }, { network: 'asc' }],
  });

  const walletNos: string[] = [];
  for (const asset of assets) {
    if (asset.type === 'CRYPTO') {
      walletNos.push(
        buildCryptoSystemWalletNo('MASTER', asset.code, asset.network),
        buildCryptoSystemWalletNo('PAYOUT', asset.code, asset.network),
        buildCryptoSystemWalletNo('LIQ', asset.code, asset.network),
      );
      continue;
    }

    if (asset.type === 'FIAT') {
      walletNos.push(
        buildFiatPoolWalletNo('CUST_BANK', asset.code),
        buildFiatPoolWalletNo('LIQ_BANK', asset.code),
      );
    }
  }

  return walletNos;
}

async function deleteManyIfDelegateExists(delegateName: string): Promise<number> {
  const delegate = (prisma as any)[delegateName];
  if (!delegate?.deleteMany) {
    return 0;
  }
  return (await delegate.deleteMany()).count;
}

async function resetBusinessData(): Promise<void> {
  console.log(
    '--- Resetting business data (canonical baseline wallets will be preserved) ---',
  );

  const deleted: Record<string, number> = {};
  const preservedBaselineWalletNos = await getPreservedBaselineWalletNos();
  const gov02DemoCleanup = await cleanupWave8Gov02DemoData(prisma as any);
  const treasuryDemoCleanup = await cleanupWave8TreasuryDemoData(prisma as any);
  Object.assign(deleted, gov02DemoCleanup);
  Object.assign(deleted, treasuryDemoCleanup);

  deleted.fiat_statement_entries = (await (prisma as any).fiatStatementEntry.deleteMany()).count;
  deleted.fiat_statement_imports = (await (prisma as any).fiatStatementImport.deleteMany()).count;
  deleted.reconciliation_warnings = (await (prisma as any).reconciliationWarning.deleteMany()).count;
  deleted.reconciliation_breaks = (await (prisma as any).reconciliationBreak.deleteMany()).count;
  deleted.safeguarding_pool_snapshots = (await (prisma as any).safeguardingPoolSnapshot.deleteMany()).count;
  deleted.liability_snapshots = (await (prisma as any).liabilitySnapshot.deleteMany()).count;
  deleted.safeguarding_runs = (await (prisma as any).safeguardingRun.deleteMany()).count;
  deleted.safeguarding_policies = (await (prisma as any).safeguardingPolicy.deleteMany()).count;
  deleted.wallet_balance_entries = (await (prisma as any).walletBalanceEntry.deleteMany()).count;
  deleted.wallet_balance_snapshots = (await (prisma as any).walletBalanceSnapshot.deleteMany()).count;

  deleted.swap_transaction_audit_logs = await deleteManyIfDelegateExists(
    'swapTransactionAuditLog',
  );
  deleted.internal_fund_audit_logs = (await (prisma as any).internalFundAuditLog.deleteMany()).count;
  deleted.internal_transaction_audit_logs = (await (prisma as any).internalTransactionAuditLog.deleteMany()).count;

  deleted.cdd_case_reports = (await prisma.cddResponseReport.deleteMany()).count;
  deleted.edd_case_reports = (await prisma.eddResponseReport.deleteMany()).count;
  deleted.kyt_case_reports = (await prisma.kytCaseReport.deleteMany()).count;
  deleted.travel_rule_case_reports = (await prisma.travelRuleCaseReport.deleteMany()).count;
  deleted.onboarding_decision_records = (await (prisma as any).workflowDecisionRecord.deleteMany()).count;
  deleted.compliance_incident_events = (await prisma.complianceIncidentEvent.deleteMany()).count;
  deleted.compliance_incident_alerts = (await prisma.complianceIncidentAlert.deleteMany()).count;
  deleted.compliance_incidents = (await prisma.complianceIncident.deleteMany()).count;
  deleted.compliance_alert_events = (await prisma.complianceAlertEvent.deleteMany()).count;
  deleted.compliance_alerts = (await prisma.complianceAlert.deleteMany()).count;

  deleted.payouts = (await prisma.payout.deleteMany()).count;
  deleted.withdraw_transactions = (await prisma.withdrawTransaction.deleteMany()).count;
  deleted.internal_funds = (await (prisma as any).internalFund.deleteMany()).count;
  deleted.internal_transactions = (await (prisma as any).internalTransaction.deleteMany()).count;
  deleted.deposit_transactions = (await prisma.depositTransaction.deleteMany()).count;
  deleted.payins = (await prisma.payin.deleteMany()).count;
  deleted.outstandings = (await (prisma as any).outstanding.deleteMany()).count;
  deleted.outstanding_settlement_items = (await (prisma as any).outstandingSettlementItem.deleteMany()).count;
  deleted.outstanding_settlements = (await (prisma as any).outstandingSettlement.deleteMany()).count;
  deleted.swap_transactions = (await prisma.swapTransaction.deleteMany()).count;
  deleted.swap_quotes = (await prisma.swapQuote.deleteMany()).count;
  deleted.withdraw_pricing_quotes = (await (prisma as any).withdrawPricingQuote.deleteMany()).count;
  deleted.withdrawal_fee_level_bindings = (await (prisma as any).withdrawalFeeLevelBinding.deleteMany()).count;
  deleted.withdrawal_fee_level_change_requests = (await (prisma as any).withdrawalFeeLevelChangeRequest.deleteMany()).count;
  deleted.withdrawal_fee_levels = (await (prisma as any).withdrawalFeeLevel.deleteMany()).count;
  deleted.pricing_policies = (await (prisma as any).pricingPolicy.deleteMany()).count;

  deleted.compliance_sessions = (await prisma.complianceSession.deleteMany()).count;
  deleted.edd_cases = (await prisma.eddResponse.deleteMany()).count;
  deleted.cdd_cases = (await prisma.cddResponse.deleteMany()).count;
  deleted.corporate_profiles = (await prisma.corporateProfile.deleteMany()).count;
  deleted.ubo_profiles = (await prisma.uboProfile.deleteMany()).count;
  deleted.kyt_cases = (await prisma.kytCase.deleteMany()).count;
  deleted.travel_rule_cases = (await prisma.travelRuleCase.deleteMany()).count;

  deleted.liquidity_configurations = (await prisma.liquidityConfiguration.deleteMany()).count;
  deleted.liquidity_provider = (await prisma.liquidityProvider.deleteMany()).count;
  deleted.wallets = (
    await prisma.wallet.deleteMany({
      where: preservedBaselineWalletNos.length
        ? {
            OR: [
              { walletNo: null },
              { walletNo: { notIn: preservedBaselineWalletNos } },
            ],
          }
        : undefined,
    })
  ).count;
  deleted.customer_main = (await prisma.customerMain.deleteMany()).count;

  for (const [table, count] of Object.entries(deleted)) {
    console.log(`Deleted ${count} from ${table}`);
  }

  console.log('Re-seeding minimal business sample...');
  await seedBusiness(prisma);
  console.log('✅ Business data reset finished.');
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
