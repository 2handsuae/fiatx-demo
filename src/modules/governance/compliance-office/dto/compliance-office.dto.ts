// 战役甲波四 T5：合规办公室三主体（周期义务 / 外包商 / RI）HTTP 层 DTO。校验只做既有
// 惯例的必填/类型（照 regulatory-filing.dto.ts 风格），不加防御性校验（CLAUDE.md §2）。
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumberString, IsOptional, IsString, ValidateNested,
} from 'class-validator';
import { ObligationFrequencies, ObligationFrequency, ObligationStatus } from '../compliance-office.constants';
import { RegulatoryAuthorities } from '../../regulatory-filings/regulatory-filing.constants';

const FREQUENCY_VALUES = Object.values(ObligationFrequencies);
const AUTHORITY_VALUES = Object.keys(RegulatoryAuthorities);
const OBLIGATION_STATUS_VALUES = Object.values(ObligationStatus);
const REPLACEABILITY_VALUES = ['EASY', 'HARD'];

// ── 周期义务 ──────────────────────────────────────────────────────────

export class CreateObligationBodyDto {
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty({ enum: FREQUENCY_VALUES }) @IsIn(FREQUENCY_VALUES) frequency!: ObligationFrequency;
  @ApiProperty({ enum: AUTHORITY_VALUES }) @IsIn(AUTHORITY_VALUES) authority!: string;
  @ApiProperty() @IsString() @IsNotEmpty() basisNote!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() leadBusinessDays?: number;
  @ApiProperty() @IsString() @IsNotEmpty() nextDueAt!: string;
}

export class UpdateObligationBodyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ enum: FREQUENCY_VALUES }) @IsOptional() @IsIn(FREQUENCY_VALUES) frequency?: ObligationFrequency;
  @ApiPropertyOptional({ enum: AUTHORITY_VALUES }) @IsOptional() @IsIn(AUTHORITY_VALUES) authority?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() basisNote?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() leadBusinessDays?: number;
}

export class SetObligationStatusBodyDto {
  @ApiProperty({ enum: OBLIGATION_STATUS_VALUES }) @IsIn(OBLIGATION_STATUS_VALUES) to!: string;
}

// ── 服务商准入（外包商册）──────────────────────────────────────────────
// 甲波六 T6：合规官直接登记 / 修改的两个 DTO 退役；运营提「服务商申请」（spec §5.1），重大性由系统按四问判，不在申请表里。

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** 实际控制人一行：seq 是申请表内的稳定序号（筛查记录按「seq + 姓名」指认某一位），国籍选填。
 *  与 LP 申请表的实控人行同形，但 governance 域不反向依赖 asset-treasury 的 DTO，故在此自备一份。 */
export class VendorBeneficialOwnerDto {
  @ApiProperty() @IsInt() seq!: number;
  @ApiProperty() @Transform(trim) @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nationality?: string;
}

/** 运营提交的服务商申请表（spec §5.1）。材料不在 body 里——申请建好后逐份走 documents 端点上传。
 *  「受监管职能」答是时发牌机构 + 牌照号必填：属业务规则，服务层校验（DTO 里两项都是可选）。 */
export class ApplyVendorBodyDto {
  @ApiProperty({ description: 'Legal name' }) @IsString() @IsNotEmpty() name!: string;
  @ApiProperty({ description: 'Country / jurisdiction of registration' }) @IsString() @IsNotEmpty() registeredIn!: string;
  @ApiProperty() @IsString() @IsNotEmpty() registrationNo!: string;
  @ApiProperty({ type: [String], description: 'Service delivery / data storage locations (countries) — at least one' })
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) deliveryLocations!: string[];
  @ApiProperty() @IsString() @IsNotEmpty() contactName!: string;
  @ApiProperty() @IsString() @IsNotEmpty() contactEmail!: string;
  @ApiPropertyOptional({ type: [VendorBeneficialOwnerDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => VendorBeneficialOwnerDto) beneficialOwners?: VendorBeneficialOwnerDto[];
  @ApiPropertyOptional({ description: 'Required when regulatedFunction is true' }) @IsOptional() @IsString() licensingAuthority?: string;
  @ApiPropertyOptional({ description: 'Required when regulatedFunction is true' }) @IsOptional() @IsString() licenceNo?: string;

  @ApiProperty() @IsString() @IsNotEmpty() serviceDescription!: string;
  @ApiProperty({ description: 'A regulated function (MLRO / CISO / DPO … — VARA IV.A.3)' }) @IsBoolean() regulatedFunction!: boolean;
  @ApiProperty({ description: 'Contract start date (ISO date)' }) @IsDateString() contractStart!: string;
  @ApiPropertyOptional({ description: 'Contract end date (ISO date)' }) @IsOptional() @IsDateString() contractEnd?: string;
  @ApiProperty() @IsBoolean() involvesPersonalData!: boolean;
  @ApiProperty() @IsBoolean() involvesConfidentialInfo!: boolean;
  @ApiPropertyOptional({ description: 'Annual fee, plain decimal string' }) @IsOptional() @IsNumberString() annualFee?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() feeCurrency?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() subcontracts?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() subcontractorNames?: string;
  @ApiProperty() @IsString() @IsNotEmpty() applicationReason!: string;

  // 重大性自判四问（VARA Schedule 1「关键或重要职能」定义 (a)–(d)）：true = 「会」影响
  @ApiProperty({ description: 'If this service stopped, would it affect licence compliance?' }) @IsBoolean() impactLicence!: boolean;
  @ApiProperty({ description: '… other legal obligations?' }) @IsBoolean() impactLegal!: boolean;
  @ApiProperty({ description: '… financial performance?' }) @IsBoolean() impactFinancial!: boolean;
  @ApiProperty({ description: '… core business continuity?' }) @IsBoolean() impactContinuity!: boolean;
  @ApiProperty({ enum: REPLACEABILITY_VALUES, description: 'How hard is it to replace — reference for compliance only, not part of the materiality judgement' })
  @IsIn(REPLACEABILITY_VALUES) replaceability!: string;
}

/** 被退回后运营改申请重提：整张表单覆盖，字段与首次申请一致。 */
export class ResubmitVendorBodyDto extends ApplyVendorBodyDto {}

/** 合规官把 NON_MATERIAL 升为 MATERIAL（只升不降），理由必填。 */
export class UpgradeMaterialityDto {
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}

export class TerminateVendorBodyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

// ── RI 册 ────────────────────────────────────────────────────────────

export class CreateSeatBodyDto {
  @ApiProperty() @IsString() @IsNotEmpty() position!: string;
  @ApiProperty() @IsString() @IsNotEmpty() incumbentName!: string;
  @ApiProperty() @IsString() @IsNotEmpty() effectiveFrom!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() varaRef?: string;
}

export class ProposeReplacementBodyDto {
  @ApiProperty() @IsString() @IsNotEmpty() newIncumbentName!: string;
  @ApiProperty() @IsString() @IsNotEmpty() effectiveFrom!: string;
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() varaRef?: string;
}
