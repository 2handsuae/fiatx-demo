import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  IsNumberString,
  IsDateString,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum JournalSourceType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
  SWAP = 'SWAP',
  OTC_ORDER = 'OTC_ORDER',
}

export enum JournalPostingStatus {
  POSTED = 'POSTED',
  VOID = 'VOID',
}

export class JournalQueryDto {
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
  id?: string;

  @ApiPropertyOptional({ enum: JournalSourceType })
  @IsOptional()
  @IsEnum(JournalSourceType)
  sourceType?: JournalSourceType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  eventCode?: string;

  @ApiPropertyOptional({ enum: JournalPostingStatus })
  @IsOptional()
  @IsEnum(JournalPostingStatus)
  postingStatus?: JournalPostingStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  baseAssetId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  createdAtStart?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  createdAtEnd?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  postedAtStart?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  postedAtEnd?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';
}
