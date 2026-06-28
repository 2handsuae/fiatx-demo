import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';

export enum InternalFundStatus {
  CREATED = 'CREATED',
  SIGNING = 'SIGNING',
  BROADCASTED = 'BROADCASTED',
  CONFIRMING = 'CONFIRMING',
  CONFIRMED = 'CONFIRMED',
  CLEAR = 'CLEAR',
  FAILED = 'FAILED',
  TIMEOUT = 'TIMEOUT',
  RETURNED = 'RETURNED',
  NEEDS_REVIEW = 'NEEDS_REVIEW',
  CANCELLED = 'CANCELLED',
}

export enum InternalFundAction {
  SIGN = 'SIGN',
  BROADCAST = 'BROADCAST',
  SIGN_FAIL = 'SIGN_FAIL',
  SEEN_IN_MEMPOOL = 'SEEN_IN_MEMPOOL',
  DROP = 'DROP',
  TIMEOUT = 'TIMEOUT',
  CONFIRM = 'CONFIRM',
  FAIL = 'FAIL',
  CLEAR = 'CLEAR',
  SUBMIT = 'SUBMIT',
  RETURN = 'RETURN',
  CANCEL = 'CANCEL',
  REORG = 'REORG',
}

export class InternalFundQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  skip?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  take?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  internalTransactionId?: string;

  @ApiPropertyOptional({ enum: InternalFundStatus })
  @IsOptional()
  @IsEnum(InternalFundStatus)
  status?: InternalFundStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  txHash?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  internalFundNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assetId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  endDate?: string;
}

export class UpdateInternalFundStatusDto {
  @IsEnum(InternalFundAction)
  action!: InternalFundAction;

  @IsOptional()
  @IsString()
  txHash?: string;

  @IsOptional()
  @IsString()
  referenceNo?: string;

  @IsOptional()
  @IsString()
  feeAmount?: string;

  @IsOptional()
  @IsString()
  providerTxnId?: string;

  @IsOptional()
  @IsString()
  nonce?: string;

  @IsOptional()
  @IsString()
  blockNo?: string;

  @IsOptional()
  @IsString()
  gasUsed?: string;

  @IsOptional()
  @IsString()
  effectiveGasPrice?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  confirmations?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
