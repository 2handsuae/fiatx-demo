import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { execSync } from 'child_process';
import { generateReferenceNo } from '../src/common/utils/no-generator.util';
import { sha256Hex } from '../src/modules/audit-logging/utils/audit-digest.util';

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
  const metadataObj = { seedVersion: process.env.npm_package_version ?? '0.0.0', commit: currentCommit() };
  const metadata = JSON.stringify(metadataObj);
  const retainedUntil = new Date(occurredAt);
  retainedUntil.setFullYear(retainedUntil.getFullYear() + 8);

  // payloadDigest 与 AuditLogsService.recordByActor()（audit-logs.service.ts:959-974）
  // 同一份 16 字段身份对象，字段名/取值逐一对齐该处；sha256Hex() 内部按 key 排序
  // 后取 canonical JSON 再哈希，字段书写顺序不影响结果。种子上下文没有 HTTP 请求，
  // 对应字段按服务里同名入参在"缺省"时的取值填：sourceIp/reason 均为 null
  // （maskIpAddress(undefined) 显式返回 null，不是 undefined）。
  const payloadDigest = sha256Hex({
    action: input.action,
    actionDomain: 'CONFIG',
    primarySubjectType: input.subjectType,
    primarySubjectNo: input.subjectNo,
    ownerCustomerNo: input.ownerCustomerNo ?? null,
    traceId: correlationId,
    actorType: 'SYSTEM',
    actorNo: input.actorNo,
    requestId,
    sourceIp: null,
    sourcePlatform: 'SYSTEM',
    outcome: 'SUCCESS',
    reason: null,
    metadata: metadataObj,
    occurredAt: occurredAt.toISOString(),
    retainedUntil: retainedUntil.toISOString(),
  });

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
      payloadDigest,
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
