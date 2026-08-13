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
  FAILED = 'FAILED',
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

  // Customer-facing filter bucket (see DepositTransactionsService.findAll's
  // CUSTOMER_BUCKETS). Ignored on the admin scope — admin keeps filtering by
  // the raw `status` param above.
  @IsOptional()
  @IsString()
  bucket?: string;
}

export enum DepositTransactionAction {
  PAYIN_CONFIRMED = 'payin_confirmed',
  APPROVE = 'approve',
  FREEZE = 'freeze',
  ACTION_PENDING = 'action_pending',
  OPERATION_PENDING = 'operation_pending',
  RESUME = 'resume',
  CONFISCATE_START = 'confiscate_start',
  CONFISCATE_SETTLE = 'confiscate_settle',
  // 没收腿 FAILED/TIMEOUT → 解锁两笔 pending 后退回待处置(A1)。不做重建重试:
  // 没收腿的 deterministicTransferId 第 4 参是常量 1(非 attempt),抄不了退回弧的三级梯。
  CONFISCATE_FAILED = 'confiscate_failed',
  FAIL = 'fail',
  SLA_BREACH = 'sla_breach',
  KYT_REJECTED = 'kyt_rejected',
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
