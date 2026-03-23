import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  BUSINESS_CONFIG_RELEASE_STATUSES,
  BUSINESS_CONFIG_SUBJECT_TYPES,
} from '../business-config.types';

export class BusinessConfigReleaseQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(BUSINESS_CONFIG_SUBJECT_TYPES)
  subjectType?: string;

  @IsOptional()
  @IsString()
  @IsIn(Object.values(BUSINESS_CONFIG_RELEASE_STATUSES))
  status?: string;

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
}

export class BusinessConfigRevisionQueryDto {
  @IsString()
  @IsIn(BUSINESS_CONFIG_SUBJECT_TYPES)
  subjectType!: string;

  @IsString()
  businessKey!: string;

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
}
