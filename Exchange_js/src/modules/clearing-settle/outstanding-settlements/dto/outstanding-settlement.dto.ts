import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum OutstandingSettlementStatus {
  CREATED = 'CREATED',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export enum OutstandingSettlementItemStatus {
  NETTED = 'NETTED',
  PROCESSING = 'PROCESSING',
  CLOSED = 'CLOSED',
  FAILED = 'FAILED',
}

export class CreateOutstandingSettlementDto {
  @ApiPropertyOptional({
    description: 'Outstanding source type. Only SWAP is supported for now.',
    default: 'SWAP',
  })
  @IsOptional()
  @IsString()
  sourceType?: string;

  @ApiPropertyOptional({
    description: 'Optional inclusive start time (ISO string)',
  })
  @IsOptional()
  @IsString()
  rangeStartAt?: string;

  @ApiPropertyOptional({
    description: 'Optional idempotency key for creation',
  })
  @IsOptional()
  @IsString()
  requestId?: string;

  @ApiPropertyOptional({
    description: 'Optional note',
  })
  @IsOptional()
  @IsString()
  note?: string;
}

export class OutstandingSettlementQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  skip?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  take?: number;

  @ApiPropertyOptional({ enum: OutstandingSettlementStatus })
  @IsOptional()
  @IsEnum(OutstandingSettlementStatus)
  status?: OutstandingSettlementStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  settlementNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  requestId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceType?: string;

  @ApiPropertyOptional({ description: 'Start date (ISO)' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (ISO)' })
  @IsOptional()
  @IsString()
  endDate?: string;
}
