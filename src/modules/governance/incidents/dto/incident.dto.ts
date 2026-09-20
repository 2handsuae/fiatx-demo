// 平账三期 · 事故登记（Task 8）：HTTP 层 DTO。校验只做既有惯例的必填/类型，
// 外加上游点名的两条服务层刻意没做的枚举校验（assessmentBasis 四选一、
// saveReportDraft 的 draft 非空）——不加其余防御性校验（CLAUDE.md §2）。
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IncidentEscalationTargets, IncidentRemediationKinds, IncidentTypes } from '../incident.constants';

const INCIDENT_TYPE_VALUES = Object.values(IncidentTypes);
const ESCALATION_TARGET_VALUES = Object.values(IncidentEscalationTargets);
const REMEDIATION_KIND_VALUES = Object.values(IncidentRemediationKinds);
/** 定损结论四选一（spec §4）——服务层刻意没做的枚举校验，上游点名要求补在这一层。 */
export const ASSESSMENT_BASIS_VALUES = ['RECOVERED', 'FIRM_LOSS', 'CLIENT_COLLECTION', 'NO_LOSS'] as const;

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
}

export class AddIncidentNoteDto {
  @ApiProperty() @IsString() @IsNotEmpty() body!: string;
}

export class EscalateIncidentBodyDto {
  @ApiProperty({ enum: ESCALATION_TARGET_VALUES }) @IsIn(ESCALATION_TARGET_VALUES) to!: (typeof ESCALATION_TARGET_VALUES)[number];
  @ApiProperty() @IsString() @IsNotEmpty() note!: string;
}

export class AssessIncidentBodyDto {
  @ApiProperty() @IsString() @IsNotEmpty() assessedAmount!: string;
  @ApiProperty({ enum: ASSESSMENT_BASIS_VALUES }) @IsIn(ASSESSMENT_BASIS_VALUES) assessmentBasis!: (typeof ASSESSMENT_BASIS_VALUES)[number];
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
