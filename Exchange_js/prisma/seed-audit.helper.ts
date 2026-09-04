import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { execSync } from 'child_process';
import { generateReferenceNo } from '../src/common/utils/no-generator.util';

export type SeedActorNo = 'RELEASE' | 'DEMO_SEED';

export interface SeedAuditInput {
  action: string;
  subjectType: string;
  subjectNo: string;
  afterData: Record<string, unknown>;
  actorNo: SeedActorNo;
  ownerCustomerNo?: string | null;
}

let cachedCommit: string | null = null;
function currentCommit(): string {
  if (cachedCommit) return cachedCommit;
  try {
    cachedCommit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    cachedCommit = 'unknown';
  }
  return cachedCommit;
}

/** 种子的留痕：跑在 Nest 之外，照 AuditLogsService 的列约定直写一行（去重钥匙与它同式，重跑种子不会写第二行）。
 *  只给"配置"写：资产 / 平台钱包行 / 限额 / 费率两族 / 演示客户的收款地址与提现地址。 */
export async function writeSeedAudit(prisma: PrismaClient, input: SeedAuditInput) {
  const requestId = `${input.action}_${input.subjectNo}`;
  const idempotencyKey = createHash('sha256')
    .update(['CONFIG', input.action, input.subjectType, input.subjectNo, 'NO_CORRELATION', requestId].join('|'))
    .digest('hex');
  const existing = await prisma.auditLogEvent.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  const occurredAt = new Date();
  const correlationId = randomUUID();
  const afterData = JSON.stringify(input.afterData);
  const metadata = JSON.stringify({ seedVersion: process.env.npm_package_version ?? '0.0.0', commit: currentCommit() });
  const retainedUntil = new Date(occurredAt);
  retainedUntil.setFullYear(retainedUntil.getFullYear() + 8);

  return prisma.auditLogEvent.create({
    data: {
      eventNo: generateReferenceNo('AUD'),
      category: 'SYSTEM',
      occurredAt,
      recordedAt: occurredAt,
      action: input.action,
      actionDomain: 'CONFIG',
      actorType: 'SYSTEM',
      actorNo: input.actorNo,
      actorDisplayName: input.actorNo,
      actorRolesAtTime: JSON.stringify(['SYSTEM']),
      sourcePlatform: 'SYSTEM',
      requestId,
      primarySubjectType: input.subjectType,
      primarySubjectNo: input.subjectNo,
      ownerCustomerNo: input.ownerCustomerNo ?? null,
      outcome: 'SUCCESS',
      afterData,
      correlationId,
      traceId: correlationId,
      payloadDigest: createHash('sha256').update(afterData).digest('hex'),
      retainedUntil,
      idempotencyKey,
      metadata,
      subjects: {
        create: [
          { subjectType: input.subjectType, subjectNo: input.subjectNo, subjectRole: 'PRIMARY', occurredAt },
          ...(input.ownerCustomerNo
            ? [{ subjectType: 'CUSTOMER', subjectNo: input.ownerCustomerNo, subjectRole: 'OWNER', occurredAt }]
            : []),
        ],
      },
    },
  });
}
