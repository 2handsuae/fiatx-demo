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
  /** 默认 'CONFIG'（本文件原设计——见下方函数注释）；显式传其它域给非 CONFIG 域的动作码
   *  写一条留痕（2026-09-29 战役乙波一 T9 加：LP_PROFILE_CREATED 是 TREASURY 域）。 */
  actionDomain?: string;
  /** 默认 null（原 7 处调用的契约都要求 `afterData`，不要求 `reason`）；显式传给要求
   *  `reason` 的动作码——2026-09-29 战役乙波一 T9 评审 M3 加：`LP_PROFILE_CREATED` 的契约
   *  `requiredFields` 含 `reason`（`AuditLogEvent.reason` 是真实列，本文件此前恒写 null）。
   *  注意：`writeSeedAudit` 绕过 `AuditLogsService`，`requiredFields` 校验本身不会在这条
   *  路径上跑——加这个参数是为了让写出的行本身带上业务要求的字段，不是让校验通过。 */
  reason?: string | null;
}

// 审计单号 = AUD + 日期 + 6 位随机数，同一天内会撞（生日问题）。服务侧
// AuditLogsService.createEventWithUniqueNo 撞 eventNo 就换号重写、上限 MAX_NO_RETRIES=10，这里照抄同一取号法。
const MAX_EVENT_NO_ATTEMPTS = 10;

function isEventNoConflict(error: unknown): boolean {
  const e = error as { code?: string; meta?: { target?: string[] | string } };
  if (e?.code !== 'P2002') return false;
  const target = e.meta?.target;
  if (Array.isArray(target)) return target.includes('eventNo');
  return typeof target === 'string' && target.includes('eventNo');
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
 *  原设计只给"配置"写：资产 / 平台钱包行 / 限额 / 费率两族 / 演示客户的收款地址与提现地址——
 *  这些调用不传 actionDomain，落 CONFIG。2026-09-29 战役乙波一 T9 加 actionDomain 可选参：
 *  LP 档案建档审计（LP_PROFILE_CREATED）码本身注册在 TREASURY 域，写 CONFIG 会与契约表打架，
 *  显式传 'TREASURY' 覆盖默认值。 */
export async function writeSeedAudit(prisma: PrismaClient, input: SeedAuditInput) {
  const actionDomain = input.actionDomain ?? 'CONFIG';
  const requestId = `${input.action}_${input.subjectNo}`;
  const idempotencyKey = createHash('sha256')
    .update([actionDomain, input.action, input.subjectType, input.subjectNo, 'NO_CORRELATION', requestId].join('|'))
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
    actionDomain,
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
    reason: input.reason ?? null,
    metadata: metadataObj,
    occurredAt: occurredAt.toISOString(),
    retainedUntil: retainedUntil.toISOString(),
  });

  for (let attempt = 0; attempt < MAX_EVENT_NO_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.auditLogEvent.create({
        data: {
          eventNo: generateReferenceNo('AUD'),
          category: 'SYSTEM',
          occurredAt,
          recordedAt: occurredAt,
          action: input.action,
          actionDomain,
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
          reason: input.reason ?? null,
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
    } catch (error) {
      if (isEventNoConflict(error)) continue;
      throw error;
    }
  }
  throw new Error(`writeSeedAudit: eventNo collided ${MAX_EVENT_NO_ATTEMPTS} times (${input.action} ${input.subjectNo})`);
}
