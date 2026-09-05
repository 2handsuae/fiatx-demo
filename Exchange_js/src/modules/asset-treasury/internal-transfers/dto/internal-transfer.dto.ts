import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** 六态（spec §3）：出生即待审批；不设草稿态、不设「已批准」中间态。 */
export enum InternalTransferStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  EXECUTING = 'EXECUTING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export const INTERNAL_TRANSFER_PURPOSES = ['CLIENT_COMPENSATION', 'CLIENT_ADVANCE'] as const;
export type InternalTransferPurpose = (typeof INTERNAL_TRANSFER_PURPOSES)[number];
export type InternalTransferFailureReason = 'INSUFFICIENT_FIRM_BALANCE' | 'LEG_FAILED' | 'POSTING_FAILED';

export class InitiateCompensationDto {
  @ApiProperty() @IsString() @IsNotEmpty() adjustmentNo!: string;
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}
export class InitiateAdvanceDto {
  @ApiProperty() @IsString() @IsNotEmpty() caseNo!: string;
  @ApiProperty({ description: '被退汇的账单行（隐藏锚，来自案件读面 nextStep.externalLineId）' }) @IsString() @IsNotEmpty() externalLineId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}
export class CancelInternalTransferDto {
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}
export class InternalTransferListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional({ enum: INTERNAL_TRANSFER_PURPOSES }) @IsOptional() @IsIn(INTERNAL_TRANSFER_PURPOSES as unknown as string[]) purpose?: InternalTransferPurpose;
  @ApiPropertyOptional() @IsOptional() @IsString() customerNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sourceCaseNo?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) skip?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) take?: number;
}

/** 对外投影（铁律⑥）：没有 id / walletId / customerId / externalLineId，只有业务键。 */
export interface InternalTransferLegView {
  fundsOrderNo: string; legSeq: number; status: string;
  fromWalletNo: string | null; toWalletNo: string | null; externalRef: string | null;
}
export interface InternalTransferView {
  transferNo: string; purpose: InternalTransferPurpose; status: string;
  customerNo: string; assetCode: string; currency: string; decimals: number;
  amount: string; // 元，按资产精度定位
  reason: string; sourceCaseNo: string; sourceAdjustmentNo: string | null; sourceExternalRef: string | null;
  approvalNo: string | null; failureReasonCode: string | null; failureNote: string | null;
  fromWalletNo: string | null; viaWalletNo: string | null; toWalletNo: string | null;
  createdBy: string; createdAt: string; executedAt: string | null; settledAt: string | null;
  legs: InternalTransferLegView[];
}
export interface CreateInternalTransferInput {
  purpose: InternalTransferPurpose; assetId: string; amountMajor: string;
  fromWalletId: string; viaWalletId: string | null; toWalletId: string;
  customerId: string; customerNo: string; reason: string; sourceCaseNo: string;
  sourceAdjustmentNo?: string | null; sourceExternalLineId?: string | null;
  traceId?: string | null; createdByUserId: string;
}
