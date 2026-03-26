import { IsOptional, IsString, IsEnum, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum DepositTransactionStatus {
  PAYIN_PENDING = 'PAYIN_PENDING',
  COMPLIANCE_PENDING = 'COMPLIANCE_PENDING',
  SUCCESS = 'SUCCESS',
  UNDER_REVIEW = 'UNDER_REVIEW',
  FROZEN = 'FROZEN',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
}

export enum DepositOwnerType {
  CUSTOMER = 'CUSTOMER',
  LP = 'LP',
}

export class DepositTransactionQueryDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  skip?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  take?: number;

  @IsOptional()
  @IsString()
  depositNo?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsEnum(DepositOwnerType)
  ownerType?: DepositOwnerType;

  @IsOptional()
  @IsString()
  assetId?: string;

  @IsOptional()
  @IsString()
  toWalletId?: string;

  @IsOptional()
  @IsEnum(DepositTransactionStatus)
  status?: DepositTransactionStatus;

  @IsOptional()
  @IsString()
  kytStatus?: string;

  @IsOptional()
  @IsString()
  travelRuleStatus?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}

export enum DepositTransactionAction {
  PAYIN_CONFIRMED = 'payin_confirmed',
  SUCCESS = 'success',
  FLAG = 'flag',
  FREEZE = 'freeze',
  REJECT = 'reject',
  FAIL = 'fail',
}

export class UpdateDepositTransactionStatusDto {
  @IsEnum(DepositTransactionAction)
  action!: DepositTransactionAction;

  @IsOptional()
  @IsString()
  reason?: string;
}
