import { IsOptional, IsString, IsEnum, IsNumber, Min } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export enum DepositTransactionStatus {
  PAYIN_PENDING = 'PAYIN_PENDING',
  COMPLIANCE_PENDING = 'COMPLIANCE_PENDING',
  ACTION_PENDING = 'ACTION_PENDING',
  /** 合规已通过、但金额低于下限,等运营处置(放行/没收)。与 ACTION_PENDING(等客户补料)互不重叠。 */
  OPERATION_PENDING = 'OPERATION_PENDING',
  SUCCESS = 'SUCCESS',
  FROZEN = 'FROZEN',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
  CONFISCATED = 'CONFISCATED',
  MANUAL_CHECKING = 'MANUAL_CHECKING',
  RETURNING = 'RETURNING',
  RETURNED = 'RETURNED',
  SEIZING = 'SEIZING',
  SEIZED = 'SEIZED',
  CONFISCATING = 'CONFISCATING',
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

  // Accepts a single status or a comma-separated list (e.g. "RETURNING,SEIZING,CONFISCATING")
  // so the admin list can filter a spec-defined status group in one request.
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : value,
  )
  @IsEnum(DepositTransactionStatus, { each: true })
  status?: DepositTransactionStatus | DepositTransactionStatus[];

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}

export enum DepositTransactionAction {
  PAYIN_CONFIRMED = 'payin_confirmed',
  APPROVE = 'approve',
  REJECT = 'reject',
  FREEZE = 'freeze',
  ACTION_PENDING = 'action_pending',
  OPERATION_PENDING = 'operation_pending',
  RESUME = 'resume',
  CONFISCATE = 'confiscate',
  CONFISCATE_START = 'confiscate_start',
  CONFISCATE_SETTLE = 'confiscate_settle',
  EXPIRE = 'expire',
  FAIL = 'fail',
  MANUAL_CHECK = 'manual_check',
  RETURN = 'return',
  RETURNED_DONE = 'returned_done',
  SEIZE = 'seize',
  SEIZED_DONE = 'seized_done',
}

export class UpdateDepositTransactionStatusDto {
  @IsEnum(DepositTransactionAction)
  action!: DepositTransactionAction;

  @IsOptional()
  @IsString()
  reason?: string;
}
