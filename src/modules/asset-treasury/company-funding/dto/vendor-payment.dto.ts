// 战役乙波二 T4：付款单 DTO/投影/状态枚举。照 capital-injection.dto.ts 先例。
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';

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
 *  口径：`...Dto` 名留给 T5 装饰器请求体）。fromWalletId（F_OPS）由调用方（T5 workflow，
 *  经 SystemWalletResolver 解析）传入，本服务不解析钱包（照
 *  CapitalInjectionService.create 头注释纪律）。vendorId/vendorName 不由调用方传入——
 *  服务内部按 vendorNo 查外包商档案（OutsourcingVendorsService，铁律③横向读）落快照。 */
export interface CreateVendorPaymentInput {
  vendorNo: string;
  payeeAccountRef: string;
  assetId: string;
  amount: string; // 元
  purposeNote: string;
  prudentialPurpose: string;
  reason: string;
  fromWalletId: string; // F_OPS（付款币网络行）
  traceId?: string | null;
  createdByUserId: string;
}

export class VendorPaymentListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsIn(Object.values(VendorPaymentStatus)) status?: VendorPaymentStatus;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) skip?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) take?: number;
}

/** 对外投影（铁律⑥）：没有 id / assetId / walletId / vendorId，只有业务键。 */
export interface VendorPaymentLegView {
  fundsOrderNo: string; legSeq: number; status: string;
  fromWalletNo: string | null; toWalletNo: string | null; externalRef: string | null;
}
export interface VendorPaymentView {
  payNo: string; vendorNo: string; vendorName: string; payeeAccountRef: string;
  assetCode: string; currency: string; amount: string;
  purposeNote: string; prudentialPurpose: string; reason: string;
  status: string; approvalNo: string | null;
  failureReasonCode: string | null; failureNote: string | null;
  createdBy: string; createdAt: string;
  executedAt: string | null; settledAt: string | null;
  legs: VendorPaymentLegView[];
}
