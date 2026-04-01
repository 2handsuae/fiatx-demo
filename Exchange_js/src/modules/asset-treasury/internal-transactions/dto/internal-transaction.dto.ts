import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum InternalTransactionType {
  DEP_TO_MASTER = 'DEP_TO_MASTER',
  MASTER_TO_PAYOUT = 'MASTER_TO_PAYOUT',
  PAYOUT_TO_MASTER = 'PAYOUT_TO_MASTER',
  MASTER_TO_LIQ = 'MASTER_TO_LIQ',
  LIQ_TO_MASTER = 'LIQ_TO_MASTER',
  LIQ_TO_PAYOUT = 'LIQ_TO_PAYOUT',
  PAYOUT_TO_LIQ = 'PAYOUT_TO_LIQ',
  CLIENT_BANK_TO_LIQ_BANK = 'CLIENT_BANK_TO_LIQ_BANK',
  LIQ_BANK_TO_CLIENT_BANK = 'LIQ_BANK_TO_CLIENT_BANK',
}

export enum InternalTransactionSourceType {
  DEPOSIT = 'DEPOSIT',
  INTERNAL_MANUAL = 'INTERNAL_MANUAL',
  INTERNAL_TX = 'INTERNAL_TX',
  OUTSTANDING_SETTLEMENT = 'OUTSTANDING_SETTLEMENT',
  POOL_SETTLEMENT_BATCH_ITEM = 'POOL_SETTLEMENT_BATCH_ITEM',
}

export enum TreasuryTransferPurpose {
  DEPOSIT_COLLECTION = 'DEPOSIT_COLLECTION',
  PAYOUT_FUNDING = 'PAYOUT_FUNDING',
  PAYOUT_RETURN = 'PAYOUT_RETURN',
  LIQUIDITY_TOPUP = 'LIQUIDITY_TOPUP',
  LIQUIDITY_RETURN = 'LIQUIDITY_RETURN',
  POOL_REBALANCING = 'POOL_REBALANCING',
}

export enum TreasuryTransferInitiationMode {
  MANUAL = 'MANUAL',
  AUTOMATED = 'AUTOMATED',
}

export enum InternalTransactionStatus {
  INTERNAL_FUNDS_PENDING = 'INTERNAL_FUNDS_PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export enum InternalTransactionApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export class InternalTransactionQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  skip?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  take?: number;

  @ApiPropertyOptional({ enum: InternalTransactionStatus })
  @IsOptional()
  @IsEnum(InternalTransactionStatus)
  status?: InternalTransactionStatus;

  @ApiPropertyOptional({ enum: InternalTransactionType })
  @IsOptional()
  @IsEnum(InternalTransactionType)
  type?: InternalTransactionType;

  @ApiPropertyOptional({ enum: TreasuryTransferPurpose })
  @IsOptional()
  @IsEnum(TreasuryTransferPurpose)
  purpose?: TreasuryTransferPurpose;

  @ApiPropertyOptional({ enum: TreasuryTransferInitiationMode })
  @IsOptional()
  @IsEnum(TreasuryTransferInitiationMode)
  initiationMode?: TreasuryTransferInitiationMode;

  @ApiPropertyOptional({ enum: InternalTransactionApprovalStatus })
  @IsOptional()
  @IsEnum(InternalTransactionApprovalStatus)
  approvalStatus?: InternalTransactionApprovalStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownerNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assetId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  internalTxNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  endDate?: string;
}
