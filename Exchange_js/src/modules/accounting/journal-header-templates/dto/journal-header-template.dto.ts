import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsInt,
  IsEnum,
  IsDateString,
  IsNumberString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum TemplateStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export class CreateJournalHeaderTemplateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  templateCode!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  eventCode!: string;

  @ApiProperty()
  @IsInt()
  @IsOptional()
  version?: number;

  @ApiProperty({ enum: TemplateStatus })
  @IsEnum(TemplateStatus)
  @IsOptional()
  status?: TemplateStatus;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  baseAssetId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;
}

export class UpdateJournalHeaderTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  version?: number;

  @ApiPropertyOptional({ enum: TemplateStatus })
  @IsOptional()
  @IsEnum(TemplateStatus)
  status?: TemplateStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  baseAssetId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;
}

export class JournalHeaderTemplateQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString()
  skip?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString()
  take?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  templateCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  eventCode?: string;

  @ApiPropertyOptional({ enum: TemplateStatus })
  @IsOptional()
  @IsEnum(TemplateStatus)
  status?: TemplateStatus;
}
