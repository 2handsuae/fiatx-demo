// 战役乙波一 T2：LP 档案 DTO/投影/状态枚举。
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** 四态（乙波一 spec §2.2）：出生即待批；启停是收紧/放松动作，不设门。 */
export enum LpProfileStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  REJECTED = 'REJECTED',
}

export class CreateLpProfileDto {
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiProperty() @IsString() @IsNotEmpty() fiatBankName!: string;
  @ApiProperty() @IsString() @IsNotEmpty() fiatIban!: string;
  @ApiProperty() @IsString() @IsNotEmpty() cryptoNetwork!: string;
  @ApiProperty() @IsString() @IsNotEmpty() cryptoAddress!: string;
  @ApiProperty() @IsString() @IsNotEmpty() agreementRef!: string;
  // 简报 Step 3 的字段清单未列本字段——LP_PROFILE_CREATED 审计契约（Step 4）要求 'reason'，
  // 同 CreateInternalTransferInput.reason → INTERNAL_TRANSFER_REQUESTED 同款先例补上；
  // LiquidityProvider 表没有 reason 列，本字段只喂审计，不落主体行。
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}

/** 四个结算坐标字段各自可选——不做「至少一个坐标」的后端校验（R9 裁定：输入防御性
 *  校验属禁做清单）；前端 modal 预填四字段。reason 必填，供
 *  LP_PROFILE_CHANGE_PROPOSED 契约。 */
export class ProposeSettlementChangeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() fiatBankName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() fiatIban?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cryptoNetwork?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cryptoAddress?: string;
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
  fiatBankName: string;
  fiatIban: string;
  cryptoNetwork: string;
  cryptoAddress: string;
  agreementRef: string;
  status: string;
  approvalNo: string | null;
  createdBy: string;
  createdAt: string;
}
