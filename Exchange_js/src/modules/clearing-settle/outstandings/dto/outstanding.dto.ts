import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum OutstandingDirection {
  IN = 'IN',
  OUT = 'OUT',
}

export enum OutstandingStatus {
  OPEN = 'OPEN',
  LOCKED = 'LOCKED',
  CLOSED = 'CLOSED',
}

export class OutstandingQueryDto {
  @ApiPropertyOptional({ description: 'Number of records to skip' })
  @IsOptional()
  @Type(() => Number)
  skip?: number;

  @ApiPropertyOptional({ description: 'Number of records to take' })
  @IsOptional()
  @Type(() => Number)
  take?: number;

  @ApiPropertyOptional({ enum: OutstandingStatus })
  @IsOptional()
  @IsEnum(OutstandingStatus)
  status?: OutstandingStatus;

  @ApiPropertyOptional({ enum: OutstandingDirection })
  @IsOptional()
  @IsEnum(OutstandingDirection)
  direction?: OutstandingDirection;

  @ApiPropertyOptional({ description: 'Source type, e.g. SWAP' })
  @IsOptional()
  @IsString()
  sourceType?: string;

  @ApiPropertyOptional({ description: 'Source ID, e.g. swapId' })
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiPropertyOptional({ description: 'Source business no, e.g. swapNo' })
  @IsOptional()
  @IsString()
  sourceNo?: string;

  @ApiPropertyOptional({ description: 'Owner ID' })
  @IsOptional()
  @IsString()
  ownerId?: string;

  @ApiPropertyOptional({ description: 'Owner business no' })
  @IsOptional()
  @IsString()
  ownerNo?: string;

  @ApiPropertyOptional({ description: 'Outstanding business no' })
  @IsOptional()
  @IsString()
  outstandingNo?: string;

  @ApiPropertyOptional({ description: 'Asset ID' })
  @IsOptional()
  @IsString()
  assetId?: string;

  @ApiPropertyOptional({ description: 'Start date (ISO)' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (ISO)' })
  @IsOptional()
  @IsString()
  endDate?: string;
}
