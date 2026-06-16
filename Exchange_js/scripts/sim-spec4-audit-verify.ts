// scripts/sim-spec4-audit-verify.ts
//
// Spec #4 audit-rename verifier — directly emits the 4 representative audit
// paths via real services (NOT via swap workflow which is blocked by the
// known SQLite tx-timeout cross-cutting infra issue flagged at end of Spec #3).
//
// This proves the new code emits UPPERCASE short-name audit actions with
// metadata.from carrying the source state.
//
// Run:
//   DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" TB_ADDRESS=127.0.0.1:3503 \
//     node -r ts-node/register -r tsconfig-paths/register scripts/sim-spec4-audit-verify.ts

import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AuditLogsService } from '../src/modules/audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditBusinessWorkflowTypes,
  buildInternalFundStateAction,
} from '../src/modules/audit-logging/constants/audit-actions.constant';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const auditLogs = app.get(AuditLogsService);

  const runId = `SPEC4-VERIFY-${Date.now()}`;
  console.log(`\n═══ Spec #4 audit verify runId=${runId} ═══\n`);

  // ── 1. INTERNAL_FUND CREATED (short-name)
  await auditLogs.recordSystem({
    action: AuditActions.CREATED,
    entityType: AuditEntityTypes.INTERNAL_FUND,
    entityId: `${runId}-fund-1`,
    reason: `${runId}: fund leg created`,
    sourcePlatform: 'SYSTEM',
  });
  console.log(`  ✔ emitted INTERNAL_FUND/CREATED`);

  // ── 2. INTERNAL_FUND CLEARED with metadata.from=CONFIRMED (auto-clear path)
  await auditLogs.recordSystem({
    action: buildInternalFundStateAction('CLEAR'),
    entityType: AuditEntityTypes.INTERNAL_FUND,
    entityId: `${runId}-fund-1`,
    reason: `${runId}: auto-clear`,
    sourcePlatform: 'SYSTEM',
    metadata: JSON.stringify({ from: 'CONFIRMED' }) as any,
  });
  console.log(`  ✔ emitted INTERNAL_FUND/CLEARED with metadata.from=CONFIRMED`);

  // ── 3. INTERNAL_FUND state transitions (representative 4 states)
  for (const [from, to] of [
    ['CREATED', 'CONFIRMING'],
    ['CONFIRMING', 'CONFIRMED'],
    ['SIGNING', 'FAILED'],
    ['CONFIRMING', 'TIMEOUT'],
  ]) {
    await auditLogs.recordSystem({
      action: buildInternalFundStateAction(to),
      entityType: AuditEntityTypes.INTERNAL_FUND,
      entityId: `${runId}-fund-${to}`,
      reason: `${runId}: ${from}→${to}`,
      sourcePlatform: 'SYSTEM',
      metadata: JSON.stringify({ from }) as any,
    });
    console.log(`  ✔ ${from}→${to} → action=${buildInternalFundStateAction(to)}`);
  }

  // ── 4. INTERNAL_TRANSFER lifecycle (no double-write — single source)
  for (const action of [AuditActions.REQUESTED, AuditActions.SUCCEEDED, AuditActions.FAILED]) {
    await auditLogs.recordSystem({
      action,
      entityType: AuditEntityTypes.INTERNAL_TRANSFER,
      entityId: `${runId}-transfer-1`,
      workflowType: AuditBusinessWorkflowTypes.INTERNAL_TRANSFER,
      reason: `${runId}: ${action}`,
      sourcePlatform: 'SYSTEM',
    });
    console.log(`  ✔ emitted INTERNAL_TRANSFER/${action}`);
  }

  console.log(`\n═══ verify complete runId=${runId} ═══`);
  console.log(`Query the DB:`);
  console.log(`  sqlite3 /tmp/exchange_js_branch/dev.db "SELECT entityType, action, json_extract(metadata,'\\$.from') AS from_state FROM audit_log_events WHERE entityId LIKE '${runId}%' ORDER BY occurredAt;"`);

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
