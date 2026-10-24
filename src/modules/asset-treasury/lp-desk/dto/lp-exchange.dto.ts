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
  /** LP 两步准入 Task 5：开单时由 workflow 从收款地址簿抄下的坐标快照（单据即快照，此后不回读地址簿）。
   *  地址簿条目是链上组或法币组二选一，故 payoutAddress / payoutIban 恰有一个非空。 */
  payoutAddressNo: string;
  payoutAddress?: string | null;
  payoutIban?: string | null;
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
  /** LP 两步准入 Task 5：必选一条该 LP、该卖出资产下 ACTIVE 的收款地址（LPA 单号）。 */
  @ApiProperty() @IsString() @IsNotEmpty() payoutAddressNo!: string;
  @ApiProperty() @IsString() @IsNotEmpty() prudentialPurpose!: string;
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() traceId?: string;
}

export class CancelLpExchangeDto {
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}

/** LP 两步准入 Task 6：⚡到货的可选入参——演示者决定「这笔钱从哪个坐标打来」，从而演示来源筛查三档结局。
 *  trim 后为空视同未填（业务语义：表单里留空 = 用系统占位），所以这里只认字符串、不判非空；
 *  trim 与占位替换在 workflow（服务也被直调，不依赖 DTO 层的 Transform）。结论不是入参——调用方不能自报。 */
export class SimulateLpDeliveryDto {
  @ApiPropertyOptional({ description: 'Where the LP money comes from — an on-chain address (crypto buy) or an IBAN (fiat buy). Blank = the clean placeholder.' })
  @IsOptional() @IsString() fromSource?: string;
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
  /** LP 两步准入 Task 5：开单时抄下的收款坐标快照（老单据无 → null）。 */
  payoutAddressNo: string | null; payoutAddress: string | null; payoutIban: string | null;
  /** LP 两步准入 Task 6：⚡到货时落的来源坐标快照 + 来源筛查结论（GREEN / YELLOW / RED）与筛查时刻——
   *  链上买入币来源落 deliveryFromAddress、法币落 deliveryFromIban；未到货的单据全为 null。结论是监控标记，不是门。 */
  deliveryFromAddress: string | null; deliveryFromIban: string | null;
  deliveryScreeningAnswer: string | null; deliveryScreenedAt: string | null;
  approvalNo: string | null; failureReasonCode: string | null; failureNote: string | null;
  createdBy: string; createdAt: string;
  executedAt: string | null; deliveredAt: string | null; settledAt: string | null;
  legs: LpExchangeLegView[];
}
