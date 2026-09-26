// 战役甲波四 T5：合规办公室三主体（周期义务 / 外包商 / RI）HTTP 层 DTO。校验只做既有
// 惯例的必填/类型（照 regulatory-filing.dto.ts 风格），不加防御性校验（CLAUDE.md §2）。
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ObligationFrequencies, ObligationFrequency, ObligationStatus } from '../compliance-office.constants';
import { RegulatoryAuthorities } from '../../regulatory-filings/regulatory-filing.constants';

const FREQUENCY_VALUES = Object.values(ObligationFrequencies);
const AUTHORITY_VALUES = Object.keys(RegulatoryAuthorities);
const OBLIGATION_STATUS_VALUES = Object.values(ObligationStatus);
const CRITICALITY_VALUES = ['MATERIAL', 'NON_MATERIAL'] as const;
type Criticality = (typeof CRITICALITY_VALUES)[number];

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

// ── 外包商册 ──────────────────────────────────────────────────────────

export class CreateVendorBodyDto {
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiProperty() @IsString() @IsNotEmpty() serviceDescription!: string;
  @ApiProperty({ enum: CRITICALITY_VALUES }) @IsIn(CRITICALITY_VALUES) criticality!: Criticality;
  @ApiProperty() @IsString() @IsNotEmpty() contractStart!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contractEnd?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class UpdateVendorBodyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() serviceDescription?: string;
  @ApiPropertyOptional({ enum: CRITICALITY_VALUES }) @IsOptional() @IsIn(CRITICALITY_VALUES) criticality?: Criticality;
  @ApiPropertyOptional() @IsOptional() @IsString() contractStart?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contractEnd?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
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
