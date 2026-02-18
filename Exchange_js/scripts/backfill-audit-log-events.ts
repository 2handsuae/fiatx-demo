import { PrismaClient } from '@prisma/client';
import { generateReferenceNo } from '../src/common/utils/no-generator.util';
import {
  AuditEntityTypes,
  AuditModules,
  buildStateTransitionAction,
} from '../src/modules/risk-engine/audit-logs/constants/audit-actions.constant';
import { AuditTriggerType } from '../src/modules/risk-engine/audit-logs/dto/audit-log.dto';
import { sha256Hex } from '../src/modules/risk-engine/audit-logs/utils/audit-digest.util';

const prisma = new PrismaClient();

interface BackfillEvent {
  idempotencyKey: string;
  triggerType: string;
  action: string;
  module: string;
  entityType: string;
  entityId: string;
  entityNo?: string | null;
  entityOwnerType?: string | null;
  entityOwnerId?: string | null;
  entityOwnerNo?: string | null;
  statusFrom?: string | null;
  statusTo?: string | null;
  actorType: string;
  actorId: string;
  actorNo?: string | null;
  actorRole?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt: Date;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const dryRun = args.includes('--dry-run') || !apply;
  return { apply, dryRun };
}

function retainedUntil(occurredAt: Date): Date {
  const d = new Date(occurredAt);
  d.setFullYear(d.getFullYear() + 8);
  return d;
}

function actorTypeFromRole(role?: string | null): string {
  const normalized = String(role || '').toUpperCase();
  if (normalized.includes('CUSTOMER')) return 'CUSTOMER';
  if (normalized) return 'ADMIN';
  return 'SYSTEM';
}

async function resolveActorNo(event: BackfillEvent): Promise<string | null> {
  if (event.actorNo) return event.actorNo;
  if (event.actorType === 'SYSTEM') return 'SYSTEM';

  if (event.actorType === 'ADMIN' && event.actorId) {
    const user = await prisma.user.findUnique({
      where: { id: event.actorId },
      select: { userNo: true },
    });
    return user?.userNo || null;
  }

  if (event.actorType === 'CUSTOMER' && event.actorId) {
    const customer = await prisma.customerMain.findUnique({
      where: { id: event.actorId },
      select: { customerNo: true },
    });
    return customer?.customerNo || null;
  }

  return null;
}

async function resolveEntityOwnerNo(event: BackfillEvent): Promise<string | null> {
  if (event.entityOwnerNo) return event.entityOwnerNo;
  if (event.entityOwnerType !== 'CUSTOMER' || !event.entityOwnerId) return null;

  const customer = await prisma.customerMain.findUnique({
    where: { id: event.entityOwnerId },
    select: { customerNo: true },
  });
  return customer?.customerNo || null;
}

function buildSubjectNos(event: BackfillEvent, actorNo: string | null, entityOwnerNo: string | null) {
  const items: Array<{
    subjectRole: string;
    subjectType: string;
    subjectId?: string | null;
    subjectNo: string;
  }> = [];

  if (actorNo) {
    items.push({
      subjectRole: 'ACTOR',
      subjectType: event.actorType,
      subjectId: event.actorId,
      subjectNo: actorNo,
    });
  }

  if (entityOwnerNo) {
    items.push({
      subjectRole: 'OWNER',
      subjectType: event.entityOwnerType || 'OWNER',
      subjectId: event.entityOwnerId,
      subjectNo: entityOwnerNo,
    });
  }

  if (event.entityNo) {
    items.push({
      subjectRole: 'ENTITY',
      subjectType: event.entityType,
      subjectId: event.entityId,
      subjectNo: event.entityNo,
    });
  }

  const dedup = new Map<string, (typeof items)[number]>();
  for (const item of items) {
    const key = `${item.subjectRole}|${item.subjectType}|${item.subjectId || ''}|${item.subjectNo}`;
    if (!dedup.has(key)) {
      dedup.set(key, item);
    }
  }
  return Array.from(dedup.values());
}

async function attachSubjectNos(
  eventId: string,
  occurredAt: Date,
  subjectNos: Array<{
    subjectRole: string;
    subjectType: string;
    subjectId?: string | null;
    subjectNo: string;
  }>,
) {
  const subjectModel = (prisma as any).auditLogSubjectNo;
  if (!subjectModel || !subjectNos.length) return;

  const existing = await subjectModel.findMany({
    where: { eventId },
    select: {
      subjectRole: true,
      subjectType: true,
      subjectId: true,
      subjectNo: true,
    },
  });

  const existingKeys = new Set(
    existing.map(
      (item: any) =>
        `${item.subjectRole}|${item.subjectType}|${item.subjectId || ''}|${item.subjectNo}`,
    ),
  );

  const rows = subjectNos
    .filter((item) => {
      const key = `${item.subjectRole}|${item.subjectType}|${item.subjectId || ''}|${item.subjectNo}`;
      return !existingKeys.has(key);
    })
    .map((item) => ({
      eventId,
      subjectRole: item.subjectRole,
      subjectType: item.subjectType,
      subjectId: item.subjectId || null,
      subjectNo: item.subjectNo,
      occurredAt,
    }));

  if (!rows.length) return;
  await subjectModel.createMany({ data: rows });
}

async function collectEvents(): Promise<BackfillEvent[]> {
  const events: BackfillEvent[] = [];

  const onboarding = await (prisma as any).onboardingAuditLog.findMany({
    include: {
      customer: {
        select: { customerNo: true },
      },
    },
  });
  onboarding.forEach((row: any) => {
    events.push({
      idempotencyKey: `BACKFILL::ONBOARDING::${row.id}`,
      triggerType:
        row.fromStage && row.toStage && row.fromStage !== row.toStage
          ? AuditTriggerType.STATE_TRANSITION
          : AuditTriggerType.DATA_UPDATE,
      action: row.action,
      module: AuditModules.ONBOARDING,
      entityType: AuditEntityTypes.ONBOARDING,
      entityId: row.caseId || row.customerId,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: row.customerId,
      entityOwnerNo: row.customer?.customerNo || null,
      statusFrom: row.fromStage,
      statusTo: row.toStage,
      actorType: actorTypeFromRole(row.actorRole),
      actorId: row.actorId || 'SYSTEM',
      actorRole: row.actorRole,
      reason: row.detail,
      metadata: {
        caseType: row.caseType,
        caseId: row.caseId,
        sourceTable: 'onboarding_audit_logs',
      },
      occurredAt: row.createdAt,
    });
  });

  const payin = await (prisma as any).payinAuditLog.findMany({
    include: { payin: true },
  });
  payin.forEach((row: any) => {
    events.push({
      idempotencyKey: `BACKFILL::PAYIN::${row.id}`,
      triggerType: AuditTriggerType.STATE_TRANSITION,
      action: buildStateTransitionAction('PAYIN', row.oldStatus, row.newStatus),
      module: AuditModules.PAYINS,
      entityType: AuditEntityTypes.PAYIN,
      entityId: row.payinId,
      entityNo: row.payin?.payinNo,
      entityOwnerType: row.payin?.ownerId ? 'CUSTOMER' : null,
      entityOwnerId: row.payin?.ownerId,
      entityOwnerNo: row.payin?.ownerNo || null,
      statusFrom: row.oldStatus,
      statusTo: row.newStatus,
      actorType: row.operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
      actorId: row.operatorId || 'SYSTEM',
      actorRole: row.operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
      reason: row.reason,
      metadata: { sourceTable: 'payin_audit_logs' },
      occurredAt: row.createdAt,
    });
  });

  const deposit = await (prisma as any).depositAuditLog.findMany({
    include: { depositTransaction: true },
  });
  deposit.forEach((row: any) => {
    events.push({
      idempotencyKey: `BACKFILL::DEPOSIT::${row.id}`,
      triggerType: AuditTriggerType.STATE_TRANSITION,
      action: buildStateTransitionAction('DEPOSIT', row.oldStatus, row.newStatus),
      module: AuditModules.DEPOSIT_TRANSACTIONS,
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: row.depositTransactionId,
      entityNo: row.depositTransaction?.depositNo,
      entityOwnerType: row.depositTransaction?.ownerType,
      entityOwnerId: row.depositTransaction?.ownerId,
      entityOwnerNo: row.depositTransaction?.ownerNo || null,
      statusFrom: row.oldStatus,
      statusTo: row.newStatus,
      actorType: row.operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
      actorId: row.operatorId || 'SYSTEM',
      actorRole: row.operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
      reason: row.reason,
      metadata: { sourceTable: 'deposit_audit_logs' },
      occurredAt: row.createdAt,
    });
  });

  const swap = await (prisma as any).swapTransactionAuditLog.findMany({
    include: { swapTransaction: true },
  });
  swap.forEach((row: any) => {
    events.push({
      idempotencyKey: `BACKFILL::SWAP::${row.id}`,
      triggerType: AuditTriggerType.STATE_TRANSITION,
      action: buildStateTransitionAction('SWAP', row.oldStatus, row.newStatus),
      module: AuditModules.SWAP_TRANSACTIONS,
      entityType: AuditEntityTypes.SWAP_TRANSACTION,
      entityId: row.swapTransactionId,
      entityNo: row.swapTransaction?.swapNo,
      entityOwnerType: row.swapTransaction?.ownerType,
      entityOwnerId: row.swapTransaction?.ownerId,
      entityOwnerNo: row.swapTransaction?.ownerNo || null,
      statusFrom: row.oldStatus,
      statusTo: row.newStatus,
      actorType: row.operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
      actorId: row.operatorId || 'SYSTEM',
      actorRole: row.operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
      reason: row.reason,
      metadata: { sourceTable: 'swap_transaction_audit_logs' },
      occurredAt: row.createdAt,
    });
  });

  const withdraw = await (prisma as any).withdrawAuditLog.findMany({
    include: { withdrawTransaction: true },
  });
  withdraw.forEach((row: any) => {
    events.push({
      idempotencyKey: `BACKFILL::WITHDRAW::${row.id}`,
      triggerType: AuditTriggerType.STATE_TRANSITION,
      action: buildStateTransitionAction('WITHDRAW', row.oldStatus, row.newStatus),
      module: AuditModules.WITHDRAW_TRANSACTIONS,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: row.withdrawTransactionId,
      entityNo: row.withdrawTransaction?.withdrawNo,
      entityOwnerType: row.withdrawTransaction?.ownerType,
      entityOwnerId: row.withdrawTransaction?.ownerId,
      entityOwnerNo: row.withdrawTransaction?.ownerNo || null,
      statusFrom: row.oldStatus,
      statusTo: row.newStatus,
      actorType: row.operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
      actorId: row.operatorId || 'SYSTEM',
      actorRole: row.operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
      reason: row.reason,
      metadata: { sourceTable: 'withdraw_audit_logs' },
      occurredAt: row.createdAt,
    });
  });

  const payout = await (prisma as any).payoutAuditLog.findMany({
    include: { payout: true },
  });
  payout.forEach((row: any) => {
    events.push({
      idempotencyKey: `BACKFILL::PAYOUT::${row.id}`,
      triggerType: AuditTriggerType.STATE_TRANSITION,
      action: buildStateTransitionAction('PAYOUT', row.oldStatus, row.newStatus),
      module: AuditModules.PAYOUTS,
      entityType: AuditEntityTypes.PAYOUT,
      entityId: row.payoutId,
      entityNo: row.payout?.payoutNo,
      entityOwnerType: row.payout?.ownerId ? 'CUSTOMER' : null,
      entityOwnerId: row.payout?.ownerId,
      entityOwnerNo: row.payout?.ownerNo || null,
      statusFrom: row.oldStatus,
      statusTo: row.newStatus,
      actorType: row.operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
      actorId: row.operatorId || 'SYSTEM',
      actorRole: row.operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
      reason: row.reason,
      metadata: { sourceTable: 'payout_audit_logs' },
      occurredAt: row.createdAt,
    });
  });

  const internalTx = await (prisma as any).internalTransactionAuditLog.findMany({
    include: { internalTransaction: true },
  });
  internalTx.forEach((row: any) => {
    events.push({
      idempotencyKey: `BACKFILL::INTERNAL_TX::${row.id}`,
      triggerType: AuditTriggerType.STATE_TRANSITION,
      action: buildStateTransitionAction('INTERNAL_TX', row.oldStatus, row.newStatus),
      module: AuditModules.INTERNAL_TRANSACTIONS,
      entityType: AuditEntityTypes.INTERNAL_TRANSACTION,
      entityId: row.internalTransactionId,
      entityNo: row.internalTransaction?.internalTxNo,
      entityOwnerType: row.internalTransaction?.ownerType,
      entityOwnerId: row.internalTransaction?.ownerId,
      entityOwnerNo: row.internalTransaction?.ownerNo || null,
      statusFrom: row.oldStatus,
      statusTo: row.newStatus,
      actorType: row.operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
      actorId: row.operatorId || 'SYSTEM',
      actorRole: row.operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
      reason: row.reason,
      metadata: { sourceTable: 'internal_transaction_audit_logs' },
      occurredAt: row.createdAt,
    });
  });

  const internalFund = await (prisma as any).internalFundAuditLog.findMany({
    include: { internalFund: true },
  });
  internalFund.forEach((row: any) => {
    events.push({
      idempotencyKey: `BACKFILL::INTERNAL_FUND::${row.id}`,
      triggerType: AuditTriggerType.STATE_TRANSITION,
      action: buildStateTransitionAction('INTERNAL_FUND', row.oldStatus, row.newStatus),
      module: AuditModules.INTERNAL_FUNDS,
      entityType: AuditEntityTypes.INTERNAL_FUND,
      entityId: row.internalFundId,
      entityNo: row.internalFund?.internalFundNo,
      entityOwnerType: row.internalFund?.ownerType,
      entityOwnerId: row.internalFund?.ownerId,
      entityOwnerNo: row.internalFund?.ownerNo || null,
      statusFrom: row.oldStatus,
      statusTo: row.newStatus,
      actorType: row.operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
      actorId: row.operatorId || 'SYSTEM',
      actorRole: row.operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
      reason: row.reason,
      metadata: { sourceTable: 'internal_fund_audit_logs' },
      occurredAt: row.createdAt,
    });
  });

  return events;
}

async function applyEvents(events: BackfillEvent[]) {
  let inserted = 0;
  let skipped = 0;

  for (const event of events) {
    const actorNo = await resolveActorNo(event);
    const entityOwnerNo = await resolveEntityOwnerNo(event);
    const subjectNos = buildSubjectNos(event, actorNo, entityOwnerNo);

    const metadata = {
      ...(event.metadata || {}),
      backfilledAt: new Date().toISOString(),
      sourcePlatform: 'BACKFILL',
    };

    const payloadDigest = sha256Hex({
      triggerType: event.triggerType,
      action: event.action,
      module: event.module,
      entityType: event.entityType,
      entityId: event.entityId,
      entityNo: event.entityNo || null,
      entityOwnerNo: entityOwnerNo || null,
      statusFrom: event.statusFrom,
      statusTo: event.statusTo,
      actorType: event.actorType,
      actorId: event.actorId,
      actorNo: actorNo || null,
      reason: event.reason,
      metadata,
      occurredAt: event.occurredAt.toISOString(),
      subjectNos,
    });

    const retainedUntilAt = retainedUntil(event.occurredAt);
    let created = false;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const createdRow = await (prisma as any).auditLogEvent.create({
          data: {
            auditNo: generateReferenceNo('AUD'),
            triggerType: event.triggerType,
            action: event.action,
            module: event.module,
            entityType: event.entityType,
            entityId: event.entityId,
            entityNo: event.entityNo || null,
            entityOwnerType: event.entityOwnerType || null,
            entityOwnerId: event.entityOwnerId || null,
            entityOwnerNo: entityOwnerNo || null,
            statusFrom: event.statusFrom || null,
            statusTo: event.statusTo || null,
            actorType: event.actorType,
            actorId: event.actorId,
            actorNo: actorNo || null,
            actorRole: event.actorRole || null,
            sourcePlatform: 'BACKFILL',
            result: 'SUCCESS',
            reason: event.reason || null,
            metadata: JSON.stringify(metadata),
            idempotencyKey: event.idempotencyKey,
            payloadDigest,
            maskVersion: 'v1',
            retainedUntil: retainedUntilAt,
            occurredAt: event.occurredAt,
          },
        });
        await attachSubjectNos(createdRow.id, event.occurredAt, subjectNos);
        created = true;
        inserted += 1;
        break;
      } catch (error) {
        const maybe = error as { code?: string; meta?: { target?: string[] | string } };
        const target = maybe?.meta?.target;
        const isTarget = (name: string) =>
          (Array.isArray(target) && target.includes(name)) ||
          (typeof target === 'string' && target.includes(name));

        if (maybe?.code === 'P2002' && isTarget('idempotencyKey')) {
          const existing = await (prisma as any).auditLogEvent.findUnique({
            where: { idempotencyKey: event.idempotencyKey },
            select: { id: true, occurredAt: true },
          });
          if (existing) {
            await attachSubjectNos(existing.id, existing.occurredAt, subjectNos);
          }
          skipped += 1;
          created = true;
          break;
        }

        if (maybe?.code === 'P2002' && isTarget('auditNo')) {
          continue;
        }

        throw error;
      }
    }

    if (!created) {
      throw new Error(`Failed to insert backfill event after retries: ${event.idempotencyKey}`);
    }
  }

  return { inserted, skipped };
}

async function main() {
  const { apply, dryRun } = parseArgs();

  console.log('[audit-backfill] collecting legacy audit records...');
  const events = await collectEvents();
  console.log(`[audit-backfill] collected ${events.length} legacy records`);

  if (dryRun) {
    const preview = events.slice(0, 5).map((item) => ({
      idempotencyKey: item.idempotencyKey,
      module: item.module,
      entityType: item.entityType,
      action: item.action,
      occurredAt: item.occurredAt,
    }));
    console.log('[audit-backfill] dry-run preview:', JSON.stringify(preview, null, 2));
    console.log('[audit-backfill] dry-run done (no changes applied)');
    return;
  }

  if (!apply) {
    throw new Error('Use --apply to execute write mode');
  }

  const result = await applyEvents(events);
  console.log('[audit-backfill] apply done:', result);
}

main()
  .catch((error) => {
    console.error('[audit-backfill] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
