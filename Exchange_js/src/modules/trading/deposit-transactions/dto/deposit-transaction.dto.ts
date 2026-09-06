import { IsOptional, IsString, IsEnum, IsNumber, IsNotEmpty, Min } from 'class-validator';
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
  /** 平账 B 批②：入账后被银行/托管方退汇，反向分录已落，零出边终态 */
  CLAWED_BACK = 'CLAWED_BACK',
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

  // 客户详情页 → 三域交易跳转（第二幕波一）：按客户业务键过滤，见铁律⑥。
  @IsOptional()
  @IsString()
  ownerNo?: string;

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
  // 2026-08-22(A3)退役 CONFISCATE_FAILED:没收腿改重试三级梯,attempt 已穿透进
  // deterministicTransferId 第 4 参,不再需要「一次失败就退回 OPERATION_PENDING」这条边。
  // 耗尽后原地留 CONFISCATING + 置 needsReview 红标,与退回/上缴弧同形状。
  FAIL = 'fail',
  SLA_BREACH = 'sla_breach',
  KYT_REJECTED = 'kyt_rejected',
  RETURN = 'return',
  RETURNED_DONE = 'returned_done',
  SEIZE = 'seize',
  SEIZED_DONE = 'seized_done',
  CLAWBACK = 'clawback',
}

export class UpdateDepositTransactionStatusDto {
  @IsEnum(DepositTransactionAction)
  action!: DepositTransactionAction;

  @IsOptional()
  @IsString()
  reason?: string;
}

// 第四批 C1：POST /deposit-transactions/:id/return 的入参。退回是 MLRO maker-checker
// 审批案（不是直推），reason 会进审批单与审计留痕，必填。
export class InitiateDepositReturnDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

// 平账 B 批 ①：POST /deposit-transactions/supplement 的入参。金额 / 币种 / 钱包 / 参考号
// 全从账单行来（服务端经 SupplementEvidenceService.assertClaimable 查证），运营只补来源
// 地址（链上）或来源 IBAN（法币）+ 理由；reason 进审批单与审计留痕。
export class InitiateDepositSupplementDto {
  @IsString() externalLineId!: string;
  @IsString() caseNo!: string;
  @IsString() dispositionNo!: string;
  @IsOptional() @IsString() fromAddress?: string;
  @IsOptional() @IsString() fromIban?: string;
  @IsString() @IsNotEmpty() reason!: string;
}

// 平账 B 批 ②：POST /deposit-transactions/:depositNo/clawback 的入参。金额 / 币种 / 钱包
// 全从账单行来（服务端经 SupplementEvidenceService.assertClaimable 查证），运营只给出账单行 /
// 案子 / 定性三个业务键 + 理由；reason 进审批单与审计留痕。
export class InitiateDepositClawbackDto {
  @IsString() externalLineId!: string;
  @IsString() caseNo!: string;
  @IsString() dispositionNo!: string;
  @IsString() @IsNotEmpty() reason!: string;
}
