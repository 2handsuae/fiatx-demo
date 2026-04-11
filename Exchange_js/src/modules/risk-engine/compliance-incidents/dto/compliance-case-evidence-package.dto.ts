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
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { AuditEvidencePackageStatus } from '../../../audit-logging/dto/audit-log.dto';
import { ComplianceCaseType, ComplianceIncidentStatus } from '../constants/compliance-incident-rules.constant';

export class ExportComplianceCaseEvidencePackageDto {
  @ApiPropertyOptional({ enum: ComplianceCaseType })
  @IsOptional()
  @IsEnum(ComplianceCaseType)
  caseType?: ComplianceCaseType;

  @ApiPropertyOptional({ enum: ComplianceIncidentStatus })
  @IsOptional()
  @IsEnum(ComplianceIncidentStatus)
  status?: ComplianceIncidentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assigneeUserId?: string;

  @ApiPropertyOptional({ description: 'ISO date string inclusive start bound' })
  @IsOptional()
  @IsDateString()
  periodFrom?: string;

  @ApiPropertyOptional({ description: 'ISO date string inclusive end bound' })
  @IsOptional()
  @IsDateString()
  periodTo?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  selectedCaseIds?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeRecords?: boolean;
}

export class ComplianceCaseEvidencePackageQueryDto {
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
