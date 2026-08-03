import { IsOptional, IsString, IsEnum, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

// 状态机收窄(10 状态/13 动作/20 边,定稿于 .superpowers/sdd/task-1-brief.md)。
// CREATED/CANCELLED/UNDER_REVIEW/HELD/APPROVED/PENDING_COMPLIANCE 已删除——这些字符串
// 仅存在于历史落库行(旧行的 status 列),数据库迁移由后续 Task 处理;本次改动只管
// 枚举/转移表/调用点编译通过。PENDING_COMPLIANCE 由 COMPLIANCE_PENDING 取代(对齐充值
// 域命名)。完整跃迁表见 withdraw-transactions.service.ts 的 `transitions` 字段。
export enum WithdrawTransactionStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  COMPLIANCE_PENDING = 'COMPLIANCE_PENDING',
  ACTION_PENDING = 'ACTION_PENDING',
  MANUAL_CHECKING = 'MANUAL_CHECKING',
  FROZEN = 'FROZEN',
  PAYOUT_PENDING = 'PAYOUT_PENDING',
  SUCCESS = 'SUCCESS',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
  RETURNED = 'RETURNED',
}

export enum WithdrawTransactionAction {
  // CHECK/FLAG/CANCEL removed with the 10-state rewrite (Task 1).
  REQUIRE_APPROVAL = 'require_approval',
  GATE_APPROVE = 'gate_approve',
  REJECT = 'reject',
  APPROVE = 'approve',
  SUCCESS = 'success',
  FAIL = 'fail',
  RETURN = 'return',
  ACTION_PENDING = 'action_pending',
  KYT_REJECTED = 'kyt_rejected',
  SLA_BREACH = 'sla_breach',
  FREEZE = 'freeze',
  REJECT_REFUND = 'reject_refund',
  RESUME = 'resume',
}

export enum AdminWithdrawTransactionAction {
  // Admin surface keeps only the residual historical compatibility action.
  // CHECK/FLAG/CANCEL removed with the 10-state rewrite (Task 1).
  REJECT = 'reject',
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
