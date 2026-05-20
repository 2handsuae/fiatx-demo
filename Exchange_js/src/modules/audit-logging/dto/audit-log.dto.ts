import { ApiPropertyOptional } from '@nestjs/swagger';
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

export enum AuditResult {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REJECTED = 'REJECTED',
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

export interface AuditActorContext {
  actorType: string;
  actorId: string;
  actorNo?: string;
  actorRole?: string;
}

export interface AuditLogView {
  id: string;
  auditNo: string;
  businessWorkflow: string | null;
  businessWorkflowLabel: string | null;
  userAction: string | null;
  userActionLabel: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  entityNo: string | null;
  workflowType: string | null;
  traceId: string | null;
  entityOwnerType: string | null;
  entityOwnerId: string | null;
  entityOwnerNo: string | null;
  actorType: string;
  actorId: string;
  actorNo: string | null;
  actorRole: string | null;
  requestId: string | null;
  sourceIp: string | null;
  sourcePlatform: string | null;
  result: string | null;
  reason: string | null;
  metadata: unknown;
  payloadDigest: string | null;
  retainedUntil: Date | string | null;
  occurredAt: Date | string;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  archivedAt?: Date | string | null;
}

export class CreateAuditLogEventDto {
  @ApiPropertyOptional({ description: '操作动作标识，例如 WITHDRAW_APPROVED' })
  @IsString()
  action!: string;

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

  @ApiPropertyOptional({ description: '流程链追踪ID（本轮主要用于 deposit workflow）' })
  @IsOptional()
  @IsString()
  traceId?: string;

  @ApiPropertyOptional({ description: '工作流类型，例如 DEPOSIT' })
  @IsOptional()
  @IsString()
  workflowType?: string;

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

  @ApiPropertyOptional({ description: '按流程链ID过滤' })
  @IsOptional()
  @IsString()
  traceId?: string;

  @ApiPropertyOptional({ description: '按工作流类型过滤，例如 DEPOSIT' })
  @IsOptional()
  @IsString()
  workflowType?: string;

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
