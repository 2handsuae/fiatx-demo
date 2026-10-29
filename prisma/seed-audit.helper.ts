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
  /** 甲波六 T9 起可省：真实服务写的状态边 / 评估行大多不带 afterData，种子照样可以不带（落库为 NULL）。 */
  afterData?: Record<string, unknown>;
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
  /** 状态迁移 / 审批驱动动作的契约列（默认 null）——LP 两步准入 Task 9 加：种子直铺终态的「批准」留痕
   *  （LP_ADDRESS_APPROVED，契约 requiredFields=['approvalNo']、requiresCausation）要让行本身带上
   *  approvalNo / causationId / from→to，否则按审批单号反查审计会漏掉种子行。同 `reason` 的做法：
   *  只是让写出的行带上业务要求的列，不让校验通过（本函数绕过 AuditLogsService）。
   *  correlationId 默认每行随机铸一个；同一主体的多条种子留痕要落在同一段旅程时显式传（如地址自己的 traceId）。 */
  approvalNo?: string | null;
  causationId?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  correlationId?: string | null;
  /** 甲波六 T9 加（以下六项都是可选，不传则行为与加之前逐字一致）——种子要把「合作方准入全流程」的留痕铺成与真实服务写出的行同形：
   *  operator：真人操作员（userNo + 角色快照）。传了就按 AuditLogsService.recordByActor 的 ADMIN 形态写
   *  （actorType=ADMIN、actorNo=userNo、sourcePlatform=ADMIN），审计页「谁做的」读得到合规官 / CFO 的 ADM 号；
   *  不传保持原样（SYSTEM + actorNo，种子自己当系统写手——审批裁决驱动的状态边就是这种）。 */
  operator?: { userNo: string; roles: string[] };
  /** 事件发生时刻（默认 new Date()）。旅程时间表是固定时刻，审计时间线要与档案 / 评估 / 文件上的时刻对得上。 */
  occurredAt?: Date;
  /** 默认 `${action}_${subjectNo}`。同一主体上同一动作码要写多条时（两条筛查记录、多份文件）必须显式给不同值，
   *  否则幂等键相同，第二条会被静默当作「已存在」吞掉。 */
  requestId?: string;
  /** 业务元数据（真实服务把业务键镜像进 metadata，requiredFields 的顶层展开项也在这里落得住）；种子来源标记 seedVersion / commit 仍保留。 */
  metadata?: Record<string, unknown>;
  /** 主体之外的牵连主体（真实服务写 RELATED / INSTRUMENT 子主体：审批单、被评估对象、筛查记录等）。 */
  relatedSubjects?: Array<{ subjectType: string; subjectNo: string; subjectRole: 'RELATED' | 'INSTRUMENT' }>;
  /** 默认 'SYSTEM'（原设计）；治理域 / 业务域的码显式传 'GOVERNANCE' / 'BUSINESS'，与真实服务信封的 category 一致。 */
  category?: string;
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
  const requestId = input.requestId ?? `${input.action}_${input.subjectNo}`;
  // 行为人：传了 operator 就是真人（ADMIN），否则种子自己当系统写手（原行为）。
  const actor = input.operator
    ? { type: 'ADMIN', no: input.operator.userNo, roles: input.operator.roles, platform: 'ADMIN' }
    : { type: 'SYSTEM', no: input.actorNo as string, roles: ['SYSTEM'], platform: 'SYSTEM' };
  const idempotencyKey = createHash('sha256')
    .update([actionDomain, input.action, input.subjectType, input.subjectNo, 'NO_CORRELATION', requestId].join('|'))
    .digest('hex');
  const existing = await prisma.auditLogEvent.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  const occurredAt = input.occurredAt ?? new Date();
  const correlationId = input.correlationId ?? randomUUID();
  const afterData = JSON.stringify(input.afterData);
  const metadataObj = { ...(input.metadata ?? {}), seedVersion: process.env.npm_package_version ?? '0.0.0', commit: currentCommit() };
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
    actorType: actor.type,
    actorNo: actor.no,
    requestId,
    sourceIp: null,
    sourcePlatform: actor.platform,
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
          category: input.category ?? 'SYSTEM',
          occurredAt,
          recordedAt: occurredAt,
          action: input.action,
          actionDomain,
          actorType: actor.type,
          actorNo: actor.no,
          actorDisplayName: actor.no,
          actorRolesAtTime: JSON.stringify(actor.roles),
          sourcePlatform: actor.platform,
          requestId,
          primarySubjectType: input.subjectType,
          primarySubjectNo: input.subjectNo,
          ownerCustomerNo: input.ownerCustomerNo ?? null,
          outcome: 'SUCCESS',
          reason: input.reason ?? null,
          approvalNo: input.approvalNo ?? null,
          causationId: input.causationId ?? null,
          fromStatus: input.fromStatus ?? null,
          toStatus: input.toStatus ?? null,
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
              ...(input.relatedSubjects ?? []).map((s) => ({ ...s, occurredAt })),
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
