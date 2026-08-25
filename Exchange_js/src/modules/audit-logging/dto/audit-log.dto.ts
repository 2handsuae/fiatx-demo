import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  IsString,
  Max,
  Min,
} from 'class-validator';

/** 动作执行成没成——不是「业务结果好不好」。审批被驳回时 outcome 仍是 SUCCESS。 */
export enum AuditOutcome {
  /** 动作成功执行 */
  SUCCESS = 'SUCCESS',
  /** 系统主动挡住、动作压根没执行成：SoD 冲突、自审防篡改、速率限制、令牌失效 */
  DENIED = 'DENIED',
  /** 试了但技术上没成：邮件发送失败、下游写库失败 */
  FAILED = 'FAILED',
  /** 部分成功 */
  PARTIAL = 'PARTIAL',
}

export enum AuditCategory {
  BUSINESS = 'BUSINESS',
  GOVERNANCE = 'GOVERNANCE',
  SECURITY = 'SECURITY',
  SYSTEM = 'SYSTEM',
}

/**
 * 主体在本条审计事件里扮演的角色。五值封闭。
 * 刻意不设 ACTOR —— 操作人已由主表 actorNo 记录，同一份信息只存一处。
 */
export enum AuditSubjectRole {
  /** 事件直接作用的对象。至多一个；零个合法（建单前被拦截时没有主对象） */
  PRIMARY = 'PRIMARY',
  /** 归属主体，通常是客户。监管索档走这个角色 */
  OWNER = 'OWNER',
  /** 动作所依据的凭据：审批单、规则行、提现地址、报价单 */
  INSTRUMENT = 'INSTRUMENT',
  /** 被牵连的相关单据：资金单、资产、钱包、账本账户 */
  RELATED = 'RELATED',
  /** 对手方：外部 VASP、收款人、汇款人 */
  COUNTERPARTY = 'COUNTERPARTY',
}

export enum AuditCorrelationMode {
  /** 开启新旅程：生成 UUID v4，同事务写回主单 */
  START = 'START',
  /** 延续已有旅程：从 PRIMARY 主体上读；读不到必须报错，不许静默生成 */
  INHERIT = 'INHERIT',
  /** 不属于任何旅程 */
  NONE = 'NONE',
}

export interface AuditSubjectInput {
  subjectType: string;
  /** 业务键，不是 UUID —— 对象可能被删，业务键在记录里仍可读 */
  subjectNo: string;
  subjectRole: AuditSubjectRole;
}

export interface AuditActorContext {
  actorType: string;
  actorNo: string;
  /** 当时的姓名/账号快照。人会离职改名，不存快照则记录三年后读不懂 */
  actorDisplayName: string;
  actorRolesAtTime?: string[];
  onBehalfOfType?: string;
  onBehalfOfNo?: string;
  authnMethod?: string;
}

export enum AuditEvidencePackageStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  READY = 'READY',
  FAILED = 'FAILED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum AuditEvidenceExportMode {
  SELECTION = 'SELECTION',
}

export interface AuditLogView {
  id: string;
  eventNo: string;
  businessWorkflow: string | null;
  businessWorkflowLabel: string | null;
  userAction: string | null;
  userActionLabel: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  entityNo: string | null;
  primarySubjectType: string | null;
  primarySubjectNo: string | null;
  workflowType: string | null;
  traceId: string | null;
  correlationId: string | null;
  causationId: string | null;
  ownerCustomerNo: string | null;
  actorType: string;
  actorNo: string | null;
  actorDisplayName: string;
  /** 当时的角色快照数组（JSON 反序列化）。取代旧单值 actorRole —— 一个人当时可能兼多角色 */
  actorRolesAtTime: string[];
  isReadOnly: boolean;
  reasonCode: string | null;
  requestId: string | null;
  sourceIp: string | null;
  sourcePlatform: string | null;
  outcome: string | null;
  reason: string | null;
  metadata: unknown;
  payloadDigest: string | null;
  retainedUntil: Date | string | null;
  occurredAt: Date | string;
  recordedAt?: Date | string | null;
  archivedAt?: Date | string | null;
}

export class CreateAuditLogEventDto {
  @ApiProperty() @IsString()
  action!: string;

  /**
   * ⚠️ 本批刻意声明为可选：只对 V1 词表内的码强制（见 assertActionSpec）。
   * 其他域的调用不填也能编译能跑，写出来的记录内容残缺——业主 2026-08-25 裁定接受，
   * 各域的审计正确性留给各域自己的任务。
   */
  @ApiPropertyOptional() @IsOptional() @IsString()
  actionDomain?: string;

  @ApiPropertyOptional({ enum: AuditCategory }) @IsOptional() @IsEnum(AuditCategory)
  category?: AuditCategory;

  @ApiPropertyOptional() @IsOptional() @IsString()
  primarySubjectType?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  primarySubjectNo?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  ownerCustomerNo?: string;

  @ApiPropertyOptional() @IsOptional()
  subjects?: AuditSubjectInput[];

  @ApiPropertyOptional({ enum: AuditOutcome }) @IsOptional() @IsEnum(AuditOutcome)
  outcome?: AuditOutcome;

  /**
   * 词表声明的必填字段——assertActionSpec 只查 input 上的字段，查不到 actor.authnMethod。
   * 与 AuditActorContext.authnMethod（落库到 actor 快照那份）是两处独立声明，
   * 同调用点应两处都传同一个值：这里满足 requiredFields 校验，actor 那份负责实际落库。
   */
  @ApiPropertyOptional() @IsOptional() @IsString()
  authnMethod?: string;

  /**
   * 同上 authnMethod 的两处独立声明道理——assertActionSpec 只查 input（本 DTO），
   * 查不到 AuditActorContext.onBehalfOfNo（落库到 actor 快照那份）。密码重置/MFA 重置
   * 的官员代操作码词表声明 onBehalfOfNo 必填，同调用点两处都要传同一个值。
   */
  @ApiPropertyOptional() @IsOptional() @IsString()
  onBehalfOfNo?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  reasonCode?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  reason?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  fromStatus?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  toStatus?: string;

  @ApiPropertyOptional() @IsOptional()
  beforeData?: Record<string, unknown>;

  @ApiPropertyOptional() @IsOptional()
  afterData?: Record<string, unknown>;

  @ApiPropertyOptional() @IsOptional() @IsString()
  amount?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  currency?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  permissionCode?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  policyCode?: string;

  @ApiPropertyOptional() @IsOptional()
  policyVersion?: number;

  @ApiPropertyOptional() @IsOptional() @IsString()
  approvalNo?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  ruleCode?: string;

  @ApiPropertyOptional() @IsOptional()
  ruleVersion?: number;

  @ApiPropertyOptional() @IsOptional() @IsString()
  correlationId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  causationId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  traceId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  groupEventId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  externalEvidenceRef?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  requestId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  sessionId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  sourceIp?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  sourcePlatform?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  userAgent?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  endpoint?: string;

  @ApiPropertyOptional() @IsOptional()
  isReadOnly?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString()
  effectiveDate?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  occurredAt?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  idempotencyKey?: string;

  @ApiPropertyOptional() @IsOptional()
  metadata?: Record<string, unknown>;
}

export class AuditLogQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;

  @ApiPropertyOptional({ description: '按主体业务键检索（经子表）——监管索档的主入口' })
  @IsOptional() @IsString()
  subjectNo?: string;

  @ApiPropertyOptional({ enum: AuditSubjectRole, description: '与 subjectNo 组合使用，限定该主体扮演的角色' })
  @IsOptional() @IsEnum(AuditSubjectRole)
  subjectRole?: AuditSubjectRole;

  @ApiPropertyOptional() @IsOptional() @IsString()
  primarySubjectType?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  primarySubjectNo?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  ownerCustomerNo?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  actionDomain?: string;

  @ApiPropertyOptional({ enum: AuditOutcome }) @IsOptional() @IsEnum(AuditOutcome)
  outcome?: AuditOutcome;

  @ApiPropertyOptional() @IsOptional() @IsString()
  correlationId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  causationId?: string;

  @ApiPropertyOptional() @IsOptional()
  isReadOnly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  actorNo?: string;

  @ApiPropertyOptional({ description: '按流程链ID过滤' })
  @IsOptional()
  @IsString()
  traceId?: string;

  @ApiPropertyOptional({ description: '按工作流类型过滤，例如 DEPOSIT' })
  @IsOptional()
  @IsString()
  workflowType?: string;

  @ApiPropertyOptional({ description: 'ISO 时间，起始（含）' })
  @IsOptional()
  @IsDateString()
  startAt?: string;

  @ApiPropertyOptional({ description: 'ISO 时间，结束（含）' })
  @IsOptional()
  @IsDateString()
  endAt?: string;

  @ApiPropertyOptional({ description: '关键字，匹配 action/module/entity/reason' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: '是否包含已归档记录', default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeArchived?: boolean;
}

export class ExportEvidencePackageDto extends AuditLogQueryDto {
  @ApiPropertyOptional({ enum: AuditEvidenceExportMode, default: AuditEvidenceExportMode.SELECTION })
  @IsOptional()
  @IsEnum(AuditEvidenceExportMode)
  mode?: AuditEvidenceExportMode;

  @ApiPropertyOptional({
    type: [String],
    description: '勾选导出的审计事件 ID 列表',
  })
  @IsArray()
  @IsUUID('4', { each: true })
  selectedEventIds!: string[];

  @ApiPropertyOptional({ description: '导出最大条数，默认 1000，最大 5000' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  maxItems?: number;

  @ApiPropertyOptional({ description: '是否包含 records 明细', default: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeRecords?: boolean;
}

export class EvidencePackageQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;

  @ApiPropertyOptional({ enum: AuditEvidencePackageStatus })
  @IsOptional()
  @IsEnum(AuditEvidencePackageStatus)
  status?: AuditEvidencePackageStatus;
}
