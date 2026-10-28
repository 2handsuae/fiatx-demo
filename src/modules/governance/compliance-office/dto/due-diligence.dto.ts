// 甲波六 T3：尽调评估（DDA / SCR）的 HTTP 入参 DTO。校验只做业务封闭枚举与必填（照
// compliance-office.dto.ts 风格），不加防御性校验（CLAUDE.md §2）。控制器在 T4 / T6 的 LP / 服务商线上接线。
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import {
  DD_CONCLUSIONS, INFOSEC_CERT_STATES, INFOSEC_VERDICTS, RISK_TIERS,
  SCREENING_LISTS, SCREENING_RESULTS, SUBJECT_KINDS,
} from '../due-diligence.constants';

export class RecordScreeningDto {
  @ApiProperty({ enum: SUBJECT_KINDS }) @IsIn(SUBJECT_KINDS) subjectKind!: string;
  @ApiProperty() @IsString() @IsNotEmpty() subjectName!: string;
  /** 实际控制人记录必须指向申请表里的某一位（seq）；公司记录无此项。 */
  @ApiPropertyOptional() @ValidateIf((o: RecordScreeningDto) => o.subjectKind === 'BENEFICIAL_OWNER') @IsInt() uboSeq?: number;
  @ApiProperty({ enum: SCREENING_LISTS, isArray: true }) @IsArray() @IsIn(SCREENING_LISTS, { each: true }) listsChecked!: string[];
  @ApiProperty({ enum: SCREENING_RESULTS }) @IsIn(SCREENING_RESULTS) result!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() screenedAt?: string;
}

export class SaveAssessmentDto {
  @ApiProperty({ enum: RISK_TIERS }) @IsIn(RISK_TIERS) riskTier!: string;
  @ApiProperty() @IsString() @IsNotEmpty() opinion!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() conditions?: string;
}

export class RecordInfosecDto {
  @ApiProperty({ enum: INFOSEC_CERT_STATES }) @IsIn(INFOSEC_CERT_STATES) soc2!: string;
  @ApiProperty({ enum: INFOSEC_CERT_STATES }) @IsIn(INFOSEC_CERT_STATES) iso27001!: string;
  @ApiProperty() @IsBoolean() dataLocationAcceptable!: boolean;
  @ApiProperty() @IsBoolean() drPlanAcceptable!: boolean;
  @ApiProperty() @IsString() @IsNotEmpty() opinion!: string;
  @ApiProperty({ enum: INFOSEC_VERDICTS }) @IsIn(INFOSEC_VERDICTS) verdict!: string;
}

/** RETURNED / REJECTED 必带 reason——服务层校验（DTO 里 reason 一律可选）。 */
export class ConcludeAssessmentDto {
  @ApiProperty({ enum: DD_CONCLUSIONS }) @IsIn(DD_CONCLUSIONS) conclusion!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}
