import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export enum AuditTriggerType {
  EVIDENCE_EXPORT = 'EVIDENCE_EXPORT',
  STATE_TRANSITION = 'STATE_TRANSITION',
  MANUAL_OVERRIDE = 'MANUAL_OVERRIDE',
  AUTH_EVENT = 'AUTH_EVENT',
  PERMISSION_CHANGE = 'PERMISSION_CHANGE',
  CONFIG_CHANGE = 'CONFIG_CHANGE',
  DATA_CREATE = 'DATA_CREATE',
  DATA_UPDATE = 'DATA_UPDATE',
  DATA_DELETE = 'DATA_DELETE',
  SYSTEM_EVENT = 'SYSTEM_EVENT',
}

export enum AuditResult {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REJECTED = 'REJECTED',
}

export interface AuditActorContext {
  actorType: string;
  actorId: string;
  actorNo?: string;
  actorRole?: string;
}

export enum AuditSubjectRole {
  ACTOR = 'ACTOR',
  OWNER = 'OWNER',
  ENTITY = 'ENTITY',
  RELATED = 'RELATED',
  SOURCE = 'SOURCE',
}

export class AuditSubjectNoDto {
  @ApiPropertyOptional({ enum: AuditSubjectRole })
  @IsEnum(AuditSubjectRole)
  subjectRole!: AuditSubjectRole;

  @ApiPropertyOptional({ description: '主体类型，例如 CUSTOMER/WITHDRAW/PAYOUT/KYT_CASE' })
  @IsString()
  subjectType!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subjectId?: string;

  @ApiPropertyOptional()
  @IsString()
  subjectNo!: string;
}

export class CreateAuditLogEventDto {
  @ApiPropertyOptional({ enum: AuditTriggerType })
  @IsOptional()
  @IsEnum(AuditTriggerType)
  triggerType?: AuditTriggerType;

  @ApiPropertyOptional({ description: '操作动作标识，例如 WITHDRAW_APPROVED' })
  @IsString()
  action!: string;

  @ApiPropertyOptional({ description: '模块名，例如 trading/withdraw' })
  @IsString()
  module!: string;

  @ApiPropertyOptional({ description: '实体类型，例如 WITHDRAW_TRANSACTION' })
  @IsString()
  entityType!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityOwnerType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityOwnerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityOwnerNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  statusFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  statusTo?: string;

  @ApiPropertyOptional({ enum: AuditResult })
  @IsOptional()
  @IsEnum(AuditResult)
  result?: AuditResult;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  beforeData?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  afterData?: Record<string, unknown>;

  @ApiPropertyOptional({
    type: [AuditSubjectNoDto],
    description: '事件关联主体No集合（可选，未传则由系统自动构造）',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AuditSubjectNoDto)
  subjectNos?: AuditSubjectNoDto[];

  @ApiPropertyOptional({ description: '幂等键，不传则系统按规则自动生成' })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  requestId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceIp?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourcePlatform?: string;

  @ApiPropertyOptional({ description: 'UTC 时间字符串，不传则默认当前时间' })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;
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

  @ApiPropertyOptional({ enum: AuditTriggerType })
  @IsOptional()
  @IsEnum(AuditTriggerType)
  triggerType?: AuditTriggerType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  module?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  actorNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityOwnerNo?: string;

  @ApiPropertyOptional({ description: '按主体No精确匹配' })
  @IsOptional()
  @IsString()
  subjectNo?: string;

  @ApiPropertyOptional({ description: '按主体类型过滤（可选）' })
  @IsOptional()
  @IsString()
  subjectType?: string;

  @ApiPropertyOptional({ enum: AuditResult })
  @IsOptional()
  @IsEnum(AuditResult)
  result?: AuditResult;

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
