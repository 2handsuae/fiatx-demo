import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  APPOINTMENT_STATUS_VALUES,
  CONFLICT_DISCLOSURE_STATUS_VALUES,
  SHAREHOLDING_PARTICIPANT_TYPE_VALUES,
  SHAREHOLDING_REGISTRY_STATUS_VALUES,
  TRAINING_STATUS_VALUES,
  WIND_DOWN_MATERIAL_STATUS_VALUES,
} from '../constants/governance-registries.constants';

export class GovernanceRegistryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class ShareholdingParticipantDto {
  @IsIn(SHAREHOLDING_PARTICIPANT_TYPE_VALUES)
  participantType!: string;

  @IsString()
  participantName!: string;

  @IsOptional()
  @IsNumberString()
  ownershipPercent?: string;

  @IsOptional()
  @IsString()
  controlSummary?: string;

  @IsOptional()
  @IsString()
  evidenceRef?: string;

  @IsOptional()
  metadataJson?: Record<string, unknown>;
}

export class CreateShareholdingRegistryVersionDto {
  @IsOptional()
  @IsString()
  versionLabel?: string;

  @ApiPropertyOptional({ enum: SHAREHOLDING_REGISTRY_STATUS_VALUES })
  @IsOptional()
  @IsIn(SHAREHOLDING_REGISTRY_STATUS_VALUES)
  status?: string;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsString()
  supersedesId?: string;

  @IsOptional()
  @IsString()
  docRef?: string;

  @IsOptional()
  @IsString()
  evidenceRef?: string;

  @IsOptional()
  metadataJson?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  traceId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ShareholdingParticipantDto)
  participants!: ShareholdingParticipantDto[];
}

export class UpdateShareholdingRegistryVersionDto {
  @IsOptional()
  @IsString()
  versionLabel?: string;

  @ApiPropertyOptional({ enum: SHAREHOLDING_REGISTRY_STATUS_VALUES })
  @IsOptional()
  @IsIn(SHAREHOLDING_REGISTRY_STATUS_VALUES)
  status?: string;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @IsOptional()
  @IsString()
  docRef?: string;

  @IsOptional()
  @IsString()
  evidenceRef?: string;

  @IsOptional()
  metadataJson?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  traceId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShareholdingParticipantDto)
  participants?: ShareholdingParticipantDto[];
}

export class CreateAppointmentRecordDto {
  @IsString()
  roleType!: string;

  @IsString()
  personName!: string;

  @IsOptional()
  @IsBoolean()
  regulatedFlag?: boolean;

  @ApiPropertyOptional({ enum: APPOINTMENT_STATUS_VALUES })
  @IsOptional()
  @IsIn(APPOINTMENT_STATUS_VALUES)
  status?: string;

  @IsOptional()
  @IsDateString()
  proposedEffectiveAt?: string;

  @IsOptional()
  @IsDateString()
  effectiveAt?: string;

  @IsOptional()
  @IsString()
  docRef?: string;

  @IsOptional()
  @IsString()
  evidenceRef?: string;

  @IsOptional()
  metadataJson?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class UpdateAppointmentRecordDto {
  @IsOptional()
  @IsString()
  roleType?: string;

  @IsOptional()
  @IsString()
  personName?: string;

  @IsOptional()
  @IsBoolean()
  regulatedFlag?: boolean;

  @ApiPropertyOptional({ enum: APPOINTMENT_STATUS_VALUES })
  @IsOptional()
  @IsIn(APPOINTMENT_STATUS_VALUES)
  status?: string;

  @IsOptional()
  @IsDateString()
  proposedEffectiveAt?: string;

  @IsOptional()
  @IsDateString()
  effectiveAt?: string;

  @IsOptional()
  @IsDateString()
  endedAt?: string;

  @IsOptional()
  @IsString()
  docRef?: string;

  @IsOptional()
  @IsString()
  evidenceRef?: string;

  @IsOptional()
  metadataJson?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class CreateTrainingRecordDto {
  @IsString()
  assignee!: string;

  @IsString()
  trainingType!: string;

  @ApiPropertyOptional({ enum: TRAINING_STATUS_VALUES })
  @IsOptional()
  @IsIn(TRAINING_STATUS_VALUES)
  status?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsDateString()
  completedAt?: string;

  @IsOptional()
  @IsString()
  evidenceRef?: string;

  @IsOptional()
  @IsString()
  waiverReason?: string;

  @IsOptional()
  metadataJson?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class UpdateTrainingRecordDto {
  @IsOptional()
  @IsString()
  assignee?: string;

  @IsOptional()
  @IsString()
  trainingType?: string;

  @ApiPropertyOptional({ enum: TRAINING_STATUS_VALUES })
  @IsOptional()
  @IsIn(TRAINING_STATUS_VALUES)
  status?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsDateString()
  completedAt?: string;

  @IsOptional()
  @IsString()
  evidenceRef?: string;

  @IsOptional()
  @IsString()
  waiverReason?: string;

  @IsOptional()
  metadataJson?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class CreateConflictDisclosureDto {
  @IsString()
  disclosureType!: string;

  @IsString()
  disclosedByName!: string;

  @IsOptional()
  @IsDateString()
  disclosedAt?: string;

  @ApiPropertyOptional({ enum: CONFLICT_DISCLOSURE_STATUS_VALUES })
  @IsOptional()
  @IsIn(CONFLICT_DISCLOSURE_STATUS_VALUES)
  status?: string;

  @IsOptional()
  @IsDateString()
  reviewDueAt?: string;

  @IsOptional()
  @IsString()
  mitigationSummary?: string;

  @IsOptional()
  @IsString()
  evidenceRef?: string;

  @IsOptional()
  metadataJson?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class UpdateConflictDisclosureDto {
  @IsOptional()
  @IsString()
  disclosureType?: string;

  @IsOptional()
  @IsString()
  disclosedByName?: string;

  @IsOptional()
  @IsDateString()
  disclosedAt?: string;

  @ApiPropertyOptional({ enum: CONFLICT_DISCLOSURE_STATUS_VALUES })
  @IsOptional()
  @IsIn(CONFLICT_DISCLOSURE_STATUS_VALUES)
  status?: string;

  @IsOptional()
  @IsDateString()
  reviewDueAt?: string;

  @IsOptional()
  @IsString()
  mitigationSummary?: string;

  @IsOptional()
  @IsDateString()
  closedAt?: string;

  @IsOptional()
  @IsString()
  evidenceRef?: string;

  @IsOptional()
  metadataJson?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class CreateWindDownMaterialRecordDto {
  @IsString()
  materialType!: string;

  @IsString()
  versionLabel!: string;

  @ApiPropertyOptional({ enum: WIND_DOWN_MATERIAL_STATUS_VALUES })
  @IsOptional()
  @IsIn(WIND_DOWN_MATERIAL_STATUS_VALUES)
  status?: string;

  @IsOptional()
  @IsDateString()
  effectiveAt?: string;

  @IsOptional()
  @IsDateString()
  reviewDueAt?: string;

  @IsOptional()
  @IsString()
  evidenceRef?: string;

  @IsOptional()
  metadataJson?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class UpdateWindDownMaterialRecordDto {
  @IsOptional()
  @IsString()
  materialType?: string;

  @IsOptional()
  @IsString()
  versionLabel?: string;

  @ApiPropertyOptional({ enum: WIND_DOWN_MATERIAL_STATUS_VALUES })
  @IsOptional()
  @IsIn(WIND_DOWN_MATERIAL_STATUS_VALUES)
  status?: string;

  @IsOptional()
  @IsDateString()
  effectiveAt?: string;

  @IsOptional()
  @IsDateString()
  reviewDueAt?: string;

  @IsOptional()
  @IsDateString()
  supersededAt?: string;

  @IsOptional()
  @IsString()
  evidenceRef?: string;

  @IsOptional()
  metadataJson?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  traceId?: string;
}
