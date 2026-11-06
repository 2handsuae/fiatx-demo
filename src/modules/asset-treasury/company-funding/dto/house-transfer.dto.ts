// 戊波二 T5 · 公司调拨单 DTO / 投影 / 状态枚举。照 vendor-payment.dto.ts 先例：`...Dto` 是请求体装饰器类，
// `...Input` 是服务入参 interface，两者不是一回事。
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** 六态六边抄划转单（spec §4.2）：出生即待审批；批准即复核 from 余额——够则进 EXECUTING（建唯一一条腿），
 *  不够落 FAILED（零资金单）；EXECUTING 上腿确认落账（码 89，F_FEE → F_OPS 再加码 90）→ SUCCESS，腿失败 → FAILED。 */
export enum HouseTransferStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  EXECUTING = 'EXECUTING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

/** 用途是单上的一个标签（总纲裁定 2）：本波只放「扫费」；以后加用途 = 这里加一个值 + 表单下拉加一项。 */
export const HOUSE_TRANSFER_PURPOSES = ['FEE_SWEEP'] as const;
export type HouseTransferPurpose = (typeof HOUSE_TRANSFER_PURPOSES)[number];

/** HouseTransferService.create() 的入参。from / to 钱包由调用方（workflow，经 FirmWalletPickerService 验过）传入，
 *  本服务不解析钱包（照 CreateVendorPaymentInput 的分工）。 */
export interface CreateHouseTransferInput {
  purpose: string;
  assetId: string;
  amount: string; // 元
  fromWalletId: string;
  toWalletId: string;
  reason: string;
  createdByUserId: string;
}

/** controller 入参——只认业务键 assetId 与金库在表单里选的两只钱包，金额是元字符串。 */
export class InitiateHouseTransferDto {
  @ApiProperty({ enum: HOUSE_TRANSFER_PURPOSES }) @IsIn(HOUSE_TRANSFER_PURPOSES as unknown as string[]) purpose!: HouseTransferPurpose;
  @ApiProperty() @IsString() @IsNotEmpty() assetId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() amount!: string;
  /** 钱从哪只公司钱包出——该币种网络上的运营户或手续费户（下拉数据见 GET /admin/tb/accounts?ownerType=WALLET&code=50）。 */
  @ApiProperty() @IsString() @IsNotEmpty() fromWalletId!: string;
  /** 钱进哪只公司钱包——同上，且 ≠ from。 */
  @ApiProperty() @IsString() @IsNotEmpty() toWalletId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}

export class CancelHouseTransferDto {
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}

export class HouseTransferListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsIn(Object.values(HouseTransferStatus)) status?: HouseTransferStatus;
  @ApiPropertyOptional({ enum: HOUSE_TRANSFER_PURPOSES }) @IsOptional() @IsIn(HOUSE_TRANSFER_PURPOSES as unknown as string[]) purpose?: HouseTransferPurpose;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) skip?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) take?: number;
}

/** 对外投影（铁律⑥）：没有 id / assetId / walletId，只有业务键（钱包只给 walletNo）。 */
export interface HouseTransferLegView {
  fundsOrderNo: string; legSeq: number; status: string;
  fromWalletNo: string | null; toWalletNo: string | null; externalRef: string | null;
}
export interface HouseTransferView {
  transferNo: string; purpose: string;
  assetCode: string; currency: string; decimals: number; amount: string; // 元，按资产精度定位
  fromWalletNo: string | null; fromVaultCode: string | null;
  toWalletNo: string | null; toVaultCode: string | null;
  reason: string; status: string; approvalNo: string | null;
  fundsOrderNo: string | null;
  /** 码 90（扫费同额结转）的回执：按落账顺序的十六进制转账号，没结转（或还没落账）为空数组。 */
  closeTbTransferIds: string[];
  failureReasonCode: string | null; failureNote: string | null;
  createdBy: string; createdAt: string;
  executedAt: string | null; settledAt: string | null;
  legs: HouseTransferLegView[];
}
