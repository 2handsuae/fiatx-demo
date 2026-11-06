// 战役乙波二 T4：付款单 DTO/投影/状态枚举。照 capital-injection.dto.ts 先例。
// T5：补 InitiateVendorPaymentDto/CancelVendorPaymentDto——请求体装饰器 DTO（`...Dto` 名
// 留给本层，T4 的 CreateVendorPaymentInput 是服务入参 interface，两者不是一回事，
// 照 CancelCapitalInjectionDto/InitiateCapitalInjectionDto 先例，评审交接第 3 条）。
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** 六态（乙波二 spec §3.2）：批准即复核运营户余额——够则进 EXECUTING（建出款资金单），
 *  不够落 FAILED（零资金单，照 LP/划转单先例）；EXECUTING 上⚡推出款确认（回单先于
 *  落账）落 SUCCESS（码 87），腿失败落 FAILED。 */
export enum VendorPaymentStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  EXECUTING = 'EXECUTING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

/** VendorPaymentService.create() 的入参——服务入参 interface 命名 `...Input`（T2 评审
 *  口径：`...Dto` 名留给 T5 装饰器请求体）。fromWalletId（运营户 F_OPS 或手续费户 F_FEE，
 *  戊波二 T4 起由金库人选）由调用方（workflow，经 FirmWalletPickerService 验过）传入，
 *  本服务不解析钱包（照 CapitalInjectionService.create 头注释纪律）。vendorId/vendorName 不由调用方传入——
 *  服务内部按 vendorNo 查外包商档案（OutsourcingVendorsService，铁律③横向读）落快照。 */
export interface CreateVendorPaymentInput {
  vendorNo: string;
  payeeAccountRef: string;
  assetId: string;
  amount: string; // 元
  purposeNote: string;
  prudentialPurpose: string;
  reason: string;
  fromWalletId: string; // 付款币网络行上的 F_OPS 或 F_FEE（守卫在 workflow）
  traceId?: string | null;
  createdByUserId: string;
}

/** T5 controller 入参——字段对齐 workflow 的 InitiateVendorPaymentInput（照
 *  InitiateCapitalInjectionDto 先例：只认业务键 vendorNo/assetId，金额是元字符串）。 */
export class InitiateVendorPaymentDto {
  @ApiProperty() @IsString() @IsNotEmpty() vendorNo!: string;
  @ApiProperty() @IsString() @IsNotEmpty() payeeAccountRef!: string;
  @ApiProperty() @IsString() @IsNotEmpty() assetId!: string;
  /** 戊波二 T4：付款从哪只公司钱包出——该币种网络上的运营户或手续费户（下拉数据见 GET /admin/tb/accounts?ownerType=WALLET&code=50）。 */
  @ApiProperty() @IsString() @IsNotEmpty() fromWalletId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() amount!: string;
  @ApiProperty() @IsString() @IsNotEmpty() purposeNote!: string;
  @ApiProperty() @IsString() @IsNotEmpty() prudentialPurpose!: string;
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() traceId?: string;
}

export class CancelVendorPaymentDto {
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}

export class VendorPaymentListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsIn(Object.values(VendorPaymentStatus)) status?: VendorPaymentStatus;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) skip?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) take?: number;
}

/** 对外投影（铁律⑥）：没有 id / assetId / walletId / vendorId，只有业务键（from 钱包只给 walletNo）。 */
export interface VendorPaymentLegView {
  fundsOrderNo: string; legSeq: number; status: string;
  fromWalletNo: string | null; toWalletNo: string | null; externalRef: string | null;
}
export interface VendorPaymentView {
  payNo: string; vendorNo: string; vendorName: string; payeeAccountRef: string;
  assetCode: string; currency: string; amount: string;
  fromWalletNo: string | null; // 付出的那只公司钱包（运营户 / 手续费户）
  purposeNote: string; prudentialPurpose: string; reason: string;
  status: string; approvalNo: string | null;
  failureReasonCode: string | null; failureNote: string | null;
  createdBy: string; createdAt: string;
  executedAt: string | null; settledAt: string | null;
  legs: VendorPaymentLegView[];
}
