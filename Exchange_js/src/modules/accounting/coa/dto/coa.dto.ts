import {
  IsEnum,
  IsNotEmpty,
  IsString,
  IsArray,
  IsOptional,
  IsNumberString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum CoaType {
  ASSET = 'ASSET',
  LIABILITY = 'LIABILITY',
  EQUITY = 'EQUITY',
  REVENUE = 'REVENUE',
  EXPENSE = 'EXPENSE',
}

export enum CoaStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

export class CreateCoaDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({ enum: CoaType })
  @IsEnum(CoaType)
  type!: CoaType;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ enum: CoaStatus })
  @IsEnum(CoaStatus)
  status!: CoaStatus;

  @ApiProperty({ required: false, default: [] })
  @IsArray()
  @IsOptional()
  requiredTags?: string[];
}

export class UpdateCoaDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ required: false, enum: CoaStatus })
  @IsEnum(CoaStatus)
  @IsOptional()
  status?: CoaStatus;

  @ApiProperty({ required: false })
  @IsArray()
  @IsOptional()
  requiredTags?: string[];
}

export class CoaQueryDto {
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
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';
}
