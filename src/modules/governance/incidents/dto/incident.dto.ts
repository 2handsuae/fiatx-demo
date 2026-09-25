// 平账三期 · 事故登记（Task 8）：HTTP 层 DTO。校验只做既有惯例的必填/类型，
// 外加上游点名的两条服务层刻意没做的枚举校验（assessmentBasis 七选一、
// saveReportDraft 的 draft 非空）——不加其余防御性校验（CLAUDE.md §2）。
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { IncidentEscalationTargets, IncidentRemediationKinds, IncidentTypes } from '../incident.constants';

const INCIDENT_TYPE_VALUES = Object.values(IncidentTypes);
const ESCALATION_TARGET_VALUES = Object.values(IncidentEscalationTargets);
const REMEDIATION_KIND_VALUES = Object.values(IncidentRemediationKinds);
/** 定损结论七选一（战役甲波一 Task 6：三档口径 MONETARY/IMPACT/SHORTFALL 合并集）——服务层
 * 刻意没做的枚举白名单校验，上游点名要求补在这一层；具体某类型合法取哪几个由
 * IncidentService.assess 按 assessmentScheme 再收窄（400）。 */
export const ASSESSMENT_BASIS_VALUES = [
  'RECOVERED', 'FIRM_LOSS', 'CLIENT_COLLECTION', 'NO_LOSS', // MONETARY
  'SERVICE_IMPACT', 'DATA_IMPACT',                          // IMPACT
  'SHORTFALL',                                              // SHORTFALL
] as const;

export class RegisterIncidentBodyDto {
  @ApiProperty({ enum: INCIDENT_TYPE_VALUES }) @IsIn(INCIDENT_TYPE_VALUES) type!: (typeof INCIDENT_TYPE_VALUES)[number];
  @ApiProperty() @IsString() @IsNotEmpty() title!: string;
  @ApiProperty() @IsString() @IsNotEmpty() description!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sourceCaseNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sourceDispositionNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sourceAdvanceTransferNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() assetCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() amount?: string;
  // 平账三期 Task 3 续作：事故登记原子入口两个新字段，见 incident.constants.ts RegisterIncidentDto 注释。
  @ApiPropertyOptional() @IsOptional() @IsString() explainedExternalLineId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() findingNote?: string;
  // 甲波一 T5 修2（复审确认的实缺口）：新七类锚键值——不加这个字段，main.ts/controller 的
  // ValidationPipe（whitelist:true）会把 subjectRefs 整个剥掉，HTTP 登记新类型永远 400
  // 缺锚（服务层 register() 早就消费 dto.subjectRefs 了，只是 HTTP 这一层没声明）。形状对齐
  // incident.constants.ts 的 RegisterIncidentDto.subjectRefs。HTTP 真链路验证（真实
  // POST /admin/incidents 带 subjectRefs 走通）由 T9 正向探针与 T11 e2e 承接，本任务只保证
  // ValidationPipe 不再剥字段。
  @ApiPropertyOptional() @IsOptional() @IsObject() subjectRefs?: Record<string, string | number | boolean>;
}

export class AddIncidentNoteDto {
  @ApiProperty() @IsString() @IsNotEmpty() body!: string;
}

export class EscalateIncidentBodyDto {
  @ApiProperty({ enum: ESCALATION_TARGET_VALUES }) @IsIn(ESCALATION_TARGET_VALUES) to!: (typeof ESCALATION_TARGET_VALUES)[number];
  @ApiProperty() @IsString() @IsNotEmpty() note!: string;
}

export class AssessIncidentBodyDto {
  @ApiProperty({ enum: ASSESSMENT_BASIS_VALUES }) @IsIn(ASSESSMENT_BASIS_VALUES) assessmentBasis!: (typeof ASSESSMENT_BASIS_VALUES)[number];
  // MONETARY/SHORTFALL 必填、IMPACT 可选——服务层按类型 assessmentScheme 精确校验（400），
  // 这一层只做"字符串类型"的形状校验，不做哪个口径必填。
  @ApiPropertyOptional() @IsOptional() @IsString() assessedAmount?: string;
  // IMPACT 必填——同上，必填与否留给服务层。
  @ApiPropertyOptional() @IsOptional() @IsString() impactSummary?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() impactCount?: number;
  @ApiProperty() @IsBoolean() reportRequired!: boolean;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) reportBasisCodes?: string[];
}

export class LinkRemediationBodyDto {
  @ApiProperty({ enum: REMEDIATION_KIND_VALUES }) @IsIn(REMEDIATION_KIND_VALUES) kind!: (typeof REMEDIATION_KIND_VALUES)[number];
  @ApiProperty() @IsString() @IsNotEmpty() referenceNo!: string;
}

export class SaveReportDraftDto {
  @ApiProperty() @IsString() @IsNotEmpty() draft!: string;
}

export class MarkReportedBodyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() reference?: string;
}

export class WithdrawIncidentDto {
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}

export class IncidentListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional({ enum: INCIDENT_TYPE_VALUES }) @IsOptional() @IsIn(INCIDENT_TYPE_VALUES) type?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sourceCaseNo?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) skip?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) take?: number;
}
