import { IsOptional, IsString, IsEnum, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export enum PayoutStatus {
  CREATED = 'CREATED',
  SIGNING = 'SIGNING',
  BROADCASTED = 'BROADCASTED',
  CONFIRMING = 'CONFIRMING',
  CONFIRMED = 'CONFIRMED',
  CLEARED = 'CLEARED',
  FAILED = 'FAILED',
  TIMEOUT = 'TIMEOUT',
  RETURNED = 'RETURNED',
}

export enum PayoutAction {
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
  REORG = 'REORG',
}

export enum AdminPayoutAction {
  SIGN = 'SIGN',
  BROADCAST = 'BROADCAST',
  SIGN_FAIL = 'SIGN_FAIL',
  SEEN_IN_MEMPOOL = 'SEEN_IN_MEMPOOL',
  DROP = 'DROP',
  TIMEOUT = 'TIMEOUT',
  CONFIRM = 'CONFIRM',
  FAIL = 'FAIL',
  SUBMIT = 'SUBMIT',
  RETURN = 'RETURN',
  REORG = 'REORG',
}

export enum PayoutType {
  // Raw query/update contract stays uppercase; admin read-model normalizes payin/payout display.
  CRYPTO = 'CRYPTO',
  FIAT = 'FIAT',
}

export class PayoutQueryDto {
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
  withdrawId?: string;

  @IsOptional()
  @IsEnum(PayoutStatus)
  status?: PayoutStatus;

  @IsOptional()
  @IsEnum(PayoutType)
  type?: PayoutType;

  @IsOptional()
  @IsString()
  assetId?: string;
}

export class CreatePayoutDto {
  @IsString()
  withdrawId!: string;

  @IsEnum(PayoutType)
  type!: PayoutType;

  @IsNumber()
  @Type(() => Number)
  amount!: number;

  @IsString()
  assetId!: string;

  @IsOptional()
  @IsString()
  toWalletId?: string;

  @IsOptional()
  @IsString()
  toAddress?: string;

  @IsOptional()
  @IsString()
  toIban?: string;
}

export class UpdatePayoutStatusDto {
  @IsEnum(PayoutAction)
  action!: PayoutAction;

  @IsOptional()
  @IsString()
  txHash?: string;

  @IsOptional()
  @IsString()
  referenceNo?: string;

  @IsOptional()
  @IsString()
  gasUsed?: string;

  @IsOptional()
  @IsString()
  effectiveGasPrice?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class AdminUpdatePayoutStatusDto {
  @IsEnum(AdminPayoutAction)
  action!: AdminPayoutAction;

  @IsOptional()
  @IsString()
  txHash?: string;

  @IsOptional()
  @IsString()
  referenceNo?: string;

  @IsOptional()
  @IsString()
  gasUsed?: string;

  @IsOptional()
  @IsString()
  effectiveGasPrice?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
