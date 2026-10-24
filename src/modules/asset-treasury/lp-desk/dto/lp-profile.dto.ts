// 战役乙波一 T2：LP 档案 DTO/投影/状态枚举。
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';

/** 四态（乙波一 spec §2.2）：出生即待批；启停是收紧/放松动作，不设门。 */
export enum LpProfileStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  REJECTED = 'REJECTED',
}

export class CreateLpProfileDto {
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiProperty() @IsString() @IsNotEmpty() agreementRef!: string;
  // 尽调档案引用号（LP 两步准入 Task 2）：锚线下尽调档案，照 agreementRef 的叙事锚模式；
  // 业务必填（不是防御性校验），trim 后非空。
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @IsNotEmpty() dueDiligenceRef!: string;
  // 简报 Step 3 的字段清单未列本字段——LP_PROFILE_CREATED 审计契约（Step 4）要求 'reason'，
  // 同 CreateInternalTransferInput.reason → INTERNAL_TRANSFER_REQUESTED 同款先例补上；
  // LiquidityProvider 表没有 reason 列，本字段只喂审计，不落主体行。
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}

/** 启停（战役乙波一 T3）：直接迁移 + 审计，不建审批——reason 供 LP_PROFILE_SUSPENDED /
 *  LP_PROFILE_REACTIVATED 契约（均 requiredFields:['reason']）。 */
export class SuspendLpProfileDto {
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}
export class ReactivateLpProfileDto {
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}

/** 对外投影（铁律⑥）：无 id。 */
export interface LpProfileView {
  lpNo: string;
  name: string;
  agreementRef: string;
  status: string;
  approvalNo: string | null;
  /** 实体背调结论（建档时刻跑一次，GREEN/YELLOW/RED）与尽调档案引用号。 */
  screeningAnswer: string | null;
  screenedAt: string | null;
  dueDiligenceRef: string | null;
  createdBy: string;
  createdAt: string;
}
