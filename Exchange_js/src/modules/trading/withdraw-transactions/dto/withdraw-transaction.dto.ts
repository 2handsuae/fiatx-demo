import { IsOptional, IsString, IsEnum, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export enum WithdrawTransactionStatus {
  // Legacy compatibility values remain readable for historical records only.
  CREATED = 'CREATED',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  PENDING_COMPLIANCE = 'PENDING_COMPLIANCE',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  PAYOUT_PENDING = 'PAYOUT_PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  RETURNED = 'RETURNED',
  HELD = 'HELD',
}

export enum WithdrawTransactionAction {
  // Legacy action names are retained for historical audit/query compatibility.
  CHECK = 'check',
  REQUIRE_APPROVAL = 'require_approval',
  GATE_APPROVE = 'gate_approve',
  FLAG = 'flag',
  REJECT = 'reject',
  APPROVE = 'approve',
  CANCEL = 'cancel',
  SUCCESS = 'success',
  FAIL = 'fail',
  RETURN = 'return',
}

export enum AdminWithdrawTransactionAction {
  // Admin surface keeps only the residual historical compatibility actions.
  CHECK = 'check',
  FLAG = 'flag',
  REJECT = 'reject',
  CANCEL = 'cancel',
}

export class UpdateWithdrawTransactionStatusDto {
  @IsEnum(WithdrawTransactionAction)
  action!: WithdrawTransactionAction;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class AdminUpdateWithdrawTransactionStatusDto {
  @IsEnum(AdminWithdrawTransactionAction)
  action!: AdminWithdrawTransactionAction;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class CreateWithdrawTransactionDto {
  @IsString()
  assetId!: string;

  @IsNumber()
  @Type(() => Number)
  amount!: number;

  @IsOptional()
  @IsString()
  toWalletId?: string;

  @IsOptional()
  @IsString()
  toAddress?: string;

  @IsOptional()
  @IsString()
  toIban?: string;

  @IsOptional()
  @IsString()
  parentType?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsString()
  quoteId!: string;
}

export enum WithdrawOwnerType {
  CUSTOMER = 'CUSTOMER',
  LP = 'LP',
}

export enum ComplianceStatus {
  // Compatibility snapshot only. Withdraw UI should prefer derivedComplianceStatus.
  PENDING = 'PENDING',
  CLEAR = 'CLEAR',
  HOLD = 'HOLD',
  REJECT = 'REJECT',
}

export enum KytStatus {
  CREATED = 'CREATED',
  RECEIVED = 'RECEIVED',
  FINAL = 'FINAL',
}

export enum TravelRuleStatus {
  CREATED = 'CREATED',
  RECEIVED = 'RECEIVED',
  FINAL = 'FINAL',
}

export class WithdrawTransactionQueryDto {
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
  withdrawNo?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsEnum(WithdrawOwnerType)
  ownerType?: WithdrawOwnerType;

  @IsOptional()
  @IsString()
  assetId?: string;

  @IsOptional()
  @IsEnum(WithdrawTransactionStatus)
  status?: WithdrawTransactionStatus;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}
