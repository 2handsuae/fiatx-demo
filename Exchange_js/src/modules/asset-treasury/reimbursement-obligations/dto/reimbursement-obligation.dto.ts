import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export enum ReimbursementObligationStatus {
  OPEN = 'OPEN',
  REIMBURSED = 'REIMBURSED',
  CANCELLED = 'CANCELLED',
}

export class ReimbursementObligationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  skip?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  take?: string;

  @ApiPropertyOptional({ enum: ReimbursementObligationStatus })
  @IsOptional()
  @IsEnum(ReimbursementObligationStatus)
  status?: ReimbursementObligationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assetId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  poolRole?: string;
}

export class UpdateReimbursementObligationStatusDto {
  @ApiProperty({ enum: ReimbursementObligationStatus })
  @IsEnum(ReimbursementObligationStatus)
  status!: ReimbursementObligationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  settlementInternalTransactionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  settlementReferenceNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}
