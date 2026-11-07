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

/** 戊波二：补款用途改名 SHORTFALL_TOPUP（认损补缺，是改名不是新增）；CLIENT_ADVANCE 原样（入口置灰）。 */
const INTERNAL_TRANSFER_PURPOSES = ['SHORTFALL_TOPUP', 'CLIENT_ADVANCE'] as const;
type InternalTransferPurpose = (typeof INTERNAL_TRANSFER_PURPOSES)[number];
/** 认损补缺的来路：账龄到线（AGING）/ 事故定损（INCIDENT）——服务端按锚中定性行判，不由客户端传。 */
export type ShortfallLossSource = 'AGING' | 'INCIDENT';

export class InitiateShortfallTopupDto {
  @ApiProperty() @IsString() @IsNotEmpty() caseNo!: string;
  // 差异行的隐藏锚（案件页行没有 lineNo；照 CreateAdjustmentDto 的隐锚写法）：内部流水 id / 外部账单行 id，至少一个。
  // 金额、成因、生效日都不由客户端传——服务端按锚找到那一行与事故定损现算（金额锁定）。
  @ApiPropertyOptional({ description: 'Internal flow id of the difference row (hidden anchor)' }) @IsOptional() @IsString() flowId?: string;
  @ApiPropertyOptional({ description: 'External statement line id of the difference row (hidden anchor)' }) @IsOptional() @IsString() externalLineId?: string;
  @ApiProperty({ description: 'The company wallet the top-up is paid from (Company Operations or Company Fees wallet on the asset network)' }) @IsString() @IsNotEmpty() fromWalletId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}
export class InitiateAdvanceDto {
  @ApiProperty() @IsString() @IsNotEmpty() caseNo!: string;
  @ApiProperty({ description: 'The bounced statement line (hidden anchor, from the case view nextStep.externalLineId)' }) @IsString() @IsNotEmpty() externalLineId!: string;
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
interface InternalTransferLegView {
  fundsOrderNo: string; legSeq: number; status: string;
  fromWalletNo: string | null; toWalletNo: string | null; externalRef: string | null;
}
export interface InternalTransferView {
  transferNo: string; purpose: InternalTransferPurpose; status: string;
  customerNo: string; assetCode: string; currency: string; decimals: number;
  amount: string; // 元，按资产精度定位
  reason: string; sourceCaseNo: string; sourceExternalRef: string | null;
  // 认损补缺（戊波二）：生效日（案件业务日 YYYY-MM-DD）、来路、事故单号、记短缺回执时刻（有值 = 短缺已记，批准那一步落账成功）
  effectiveDate: string; lossSource: ShortfallLossSource | null; sourceIncidentNo: string | null; recognizedAt: string | null;
  approvalNo: string | null; failureReasonCode: string | null; failureNote: string | null;
  fromWalletNo: string | null; viaWalletNo: string | null; toWalletNo: string | null;
  createdBy: string; createdAt: string; executedAt: string | null; settledAt: string | null;
  legs: InternalTransferLegView[];
}
export interface CreateInternalTransferInput {
  purpose: InternalTransferPurpose; assetId: string; amountMajor: string;
  fromWalletId: string; viaWalletId: string | null; toWalletId: string;
  customerId: string; customerNo: string; reason: string; sourceCaseNo: string;
  sourceExternalLineId?: string | null;
  /** 认损补缺的锚 / 来路（垫款单全空）。 */
  explainedFlowId?: string | null; explainedExternalLineId?: string | null;
  lossSource?: ShortfallLossSource | null; sourceIncidentNo?: string | null;
  /** 业务生效日（迪拜日起点）：认损补缺与垫款都取案件业务日（垫款经 ClaimableLine.businessDate，其值即案件业务日）。 */
  effectiveDate: Date;
  traceId?: string | null; createdByUserId: string;
}
