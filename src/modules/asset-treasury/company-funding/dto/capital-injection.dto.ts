// 战役乙波二 T2：注资单 DTO/投影/状态枚举。照 lp-exchange.dto.ts 先例。
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';

/** 六态（乙波二 spec §2.2）：批准即进「等到款」；⚡模拟到款必经 RECEIVED（核数前）；
 *  确认入账（核数）落 SUCCESS——先账后状态。无 FAILED 态：进项 ⚡到款在演示里不会
 *  失败，审批过期/驳回归 REJECTED。 */
export enum CapitalInjectionStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  AWAITING_FUNDS = 'AWAITING_FUNDS',
  RECEIVED = 'RECEIVED',
  SUCCESS = 'SUCCESS',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

/** CapitalInjectionService.create() 的入参——toWalletId（F_OPS）由调用方（Task 3
 *  workflow，经 SystemWalletResolver 解析）传入，本服务不解析钱包（照
 *  LpExchangeService.create 头注释纪律：三个钱包 id 由 workflow 侧解析）。 */
export interface CreateCapitalInjectionDto {
  contributorName: string;
  assetId: string;
  amount: string; // 元
  prudentialPurpose: string;
  reason: string;
  toWalletId: string; // F_OPS（注入币网络行）
  traceId?: string | null;
  createdByUserId: string;
}

export class CapitalInjectionListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsIn(Object.values(CapitalInjectionStatus)) status?: CapitalInjectionStatus;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) skip?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) take?: number;
}

/** 对外投影（铁律⑥）：没有 id / assetId / walletId，只有业务键。 */
export interface CapitalInjectionLegView {
  fundsOrderNo: string; legSeq: number; status: string;
  fromWalletNo: string | null; toWalletNo: string | null; externalRef: string | null;
}
export interface CapitalInjectionView {
  cinNo: string; contributorName: string; status: string;
  assetCode: string; currency: string; amount: string;
  prudentialPurpose: string; reason: string;
  approvalNo: string | null;
  createdBy: string; createdAt: string;
  receivedAt: string | null; settledAt: string | null;
  legs: CapitalInjectionLegView[];
}
