import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
} from 'class-validator';

export enum PoolSettlementBatchStatus {
  CREATED = 'CREATED',
  APPROVAL_PENDING = 'APPROVAL_PENDING',
  APPROVED = 'APPROVED',
  EXECUTING = 'EXECUTING',
  SUCCESS = 'SUCCESS',
  PARTIAL_FAILED = 'PARTIAL_FAILED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export class PoolSettlementBatchQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  skip?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  take?: number;

  @ApiPropertyOptional({ enum: PoolSettlementBatchStatus })
  @IsOptional()
  @IsEnum(PoolSettlementBatchStatus)
  status?: PoolSettlementBatchStatus;

  @ApiPropertyOptional({ description: 'Filter auto-created batches' })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
    return value;
  })
  @IsBoolean()
  autoCreated?: boolean;
}

export class CreatePoolSettlementBatchDto {
  @ApiPropertyOptional({ description: 'Marks the batch as auto-created' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  autoCreated?: boolean;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Opaque metadata for the batch',
  })
  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, unknown>;
}
