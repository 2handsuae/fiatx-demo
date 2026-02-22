import { PrismaClient } from '@prisma/client';
import { seedBusiness } from '../prisma/seed.business';

const prisma = new PrismaClient({
  log: ['warn', 'error'],
});

async function resetBusinessData(): Promise<void> {
  console.log('--- Resetting business data (base config will be preserved) ---');

  const deleted: Record<string, number> = {};

  deleted.clearing_lines = (await prisma.clearingLine.deleteMany()).count;
  deleted.clearings = (await prisma.clearing.deleteMany()).count;
  deleted.journal_lines = (await prisma.journalLine.deleteMany()).count;
  deleted.journals = (await prisma.journal.deleteMany()).count;

  deleted.payin_audit_logs = (await prisma.payinAuditLog.deleteMany()).count;
  deleted.deposit_audit_logs = (await prisma.depositAuditLog.deleteMany()).count;
  deleted.swap_transaction_audit_logs = (await prisma.swapTransactionAuditLog.deleteMany()).count;
  deleted.payout_audit_logs = (await prisma.payoutAuditLog.deleteMany()).count;
  deleted.withdraw_audit_logs = (await prisma.withdrawAuditLog.deleteMany()).count;
  deleted.internal_fund_audit_logs = (await (prisma as any).internalFundAuditLog.deleteMany()).count;
  deleted.internal_transaction_audit_logs = (await (prisma as any).internalTransactionAuditLog.deleteMany()).count;

  deleted.cdd_case_reports = (await prisma.cddCaseReport.deleteMany()).count;
  deleted.edd_case_reports = (await prisma.eddCaseReport.deleteMany()).count;
  deleted.kyt_case_reports = (await prisma.kytCaseReport.deleteMany()).count;
  deleted.travel_rule_case_reports = (await prisma.travelRuleCaseReport.deleteMany()).count;
  deleted.onboarding_audit_logs = (await prisma.onboardingAuditLog.deleteMany()).count;
  deleted.onboarding_decision_records = (await (prisma as any).onboardingDecisionRecord.deleteMany()).count;
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
  deleted.customer_swap_rate_configurations = (await prisma.customerSwapRateConfiguration.deleteMany()).count;

  deleted.compliance_sessions = (await prisma.complianceSession.deleteMany()).count;
  deleted.edd_cases = (await prisma.eddCase.deleteMany()).count;
  deleted.cdd_cases = (await prisma.cddCase.deleteMany()).count;
  deleted.corporate_profiles = (await prisma.corporateProfile.deleteMany()).count;
  deleted.ubo_profiles = (await prisma.uboProfile.deleteMany()).count;
  deleted.kyt_cases = (await prisma.kytCase.deleteMany()).count;
  deleted.travel_rule_cases = (await prisma.travelRuleCase.deleteMany()).count;

  deleted.liquidity_configurations = (await prisma.liquidityConfiguration.deleteMany()).count;
  deleted.liquidity_provider = (await prisma.liquidityProvider.deleteMany()).count;
  deleted.wallets = (await prisma.wallet.deleteMany()).count;
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
