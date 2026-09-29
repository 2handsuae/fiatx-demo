// 战役乙波一 T4：LP 兑换单 DTO/投影/状态枚举。T6 补请求体 DTO（照
// lp-profile.dto.ts CreateLpProfileDto 先例：ValidationPipe whitelist 需要装饰器）。
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** 八态（乙波一 spec §3.2）：先款后货——批准即建卖出腿；卖出腿清算后进悬空期
 *  （等 LP 发货）；LP 打款落前厅为 DELIVERED（待验收）；验收（核数）落第三腿为 SUCCESS。 */
export enum LpExchangeStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  EXECUTING = 'EXECUTING',
  AWAITING_DELIVERY = 'AWAITING_DELIVERY',
  DELIVERED = 'DELIVERED',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

/** LpExchangeService.create() 的入参——只认 lpNo（业务键），lpId 由服务内部解析
 *  （照划转单 CreateInternalTransferInput 先例：调用方不碰 UUID）。三个钱包 id 由
 *  调用方（Task 5 workflow）解析好传入（照划转单 resolveRoute 先例，服务本身不解析钱包）。 */
export interface CreateLpExchangeInput {
  lpNo: string;
  sellAssetId: string;
  sellAmount: string; // 元
  buyAssetId: string;
  buyAmount: string; // 元
  prudentialPurpose: string;
  reason: string;
  sellFromWalletId: string; // F_OPS（卖出币网络行）
  buyViaWalletId: string; // F_LIQ（买入币网络行，前厅）
  buyToWalletId: string; // F_OPS（买入币网络行）
  traceId?: string | null;
  createdByUserId: string;
}

/** T6 controller 入参——字段对齐 workflow 的 InitiateLpExchangeInput（照 CreateLpProfileDto
 *  先例：只认业务键 lpNo + 资产 id，两金额是元字符串）。 */
export class InitiateLpExchangeDto {
  @ApiProperty() @IsString() @IsNotEmpty() lpNo!: string;
  @ApiProperty() @IsString() @IsNotEmpty() sellAssetId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() sellAmount!: string;
  @ApiProperty() @IsString() @IsNotEmpty() buyAssetId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() buyAmount!: string;
  @ApiProperty() @IsString() @IsNotEmpty() prudentialPurpose!: string;
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() traceId?: string;
}

export class CancelLpExchangeDto {
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}

export class LpExchangeListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsIn(Object.values(LpExchangeStatus)) status?: LpExchangeStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() lpNo?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) skip?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) take?: number;
}

/** 对外投影（铁律⑥）：没有 id / lpId / assetId，只有业务键。 */
interface LpExchangeLegView {
  fundsOrderNo: string; legSeq: number; status: string;
  fromWalletNo: string | null; toWalletNo: string | null; externalRef: string | null;
}
export interface LpExchangeView {
  exchangeNo: string; lpNo: string; status: string;
  sellAssetCode: string; sellCurrency: string; sellAmount: string;
  buyAssetCode: string; buyCurrency: string; buyAmount: string;
  prudentialPurpose: string; reason: string;
  approvalNo: string | null; failureReasonCode: string | null; failureNote: string | null;
  createdBy: string; createdAt: string;
  executedAt: string | null; deliveredAt: string | null; settledAt: string | null;
  legs: LpExchangeLegView[];
}
