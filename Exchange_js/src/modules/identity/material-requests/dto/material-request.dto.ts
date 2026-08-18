import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type {
  MaterialRequestOrderDomain,
  MaterialRequestOrigin,
  MaterialRequestStatus,
} from '../constants/material-request.constant';

/** 材料类型 → 人话。运营看得懂 Proof of Address，看不懂 wave3-action-poa-refresh。 */
export const MATERIAL_TYPE_LABELS: Record<string, string> = {
  EMIRATES_ID: 'Emirates ID',
  LIVENESS: 'Liveness Check',
  PROOF_OF_ADDRESS: 'Proof of Address',
  SOURCE_OF_FUNDS: 'Source of Funds',
  SOURCE_OF_WEALTH: 'Source of Wealth',
};

export const materialLabel = (materialType: string): string =>
  MATERIAL_TYPE_LABELS[materialType] ?? materialType;

const ORDER_DOMAINS = ['DEPOSIT', 'WITHDRAW', 'SWAP'] as const;
const SCOPES = ['DEPOSIT', 'WITHDRAW', 'SWAP'] as const;

export class IssueMaterialRequestDto {
  @ApiProperty({ description: 'config/material-refresh-policy.json 的 materials key' })
  @IsString()
  @MinLength(1)
  materialType!: string;

  @ApiPropertyOptional({ enum: ORDER_DOMAINS })
  @IsOptional()
  @IsIn(ORDER_DOMAINS as unknown as string[])
  orderDomain?: MaterialRequestOrderDomain;

  @ApiPropertyOptional({ description: 'depositNo / withdrawNo / swapNo' })
  @IsOptional()
  @IsString()
  orderRef?: string;

  @ApiProperty({ description: '勾了就同时开一张 PENDING_DOCUMENT 便签' })
  @IsBoolean()
  restrict!: boolean;

  @ApiPropertyOptional({ enum: SCOPES, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(SCOPES as unknown as string[], { each: true })
  restrictScopes?: ('DEPOSIT' | 'WITHDRAW' | 'SWAP')[];

  @ApiProperty()
  @IsString()
  @MinLength(1)
  reason!: string;
}

/**
 * 后台面视图。**故意不含 customerId** —— 调用方给的就是 customerNo，
 * 回一个 UUID 只是把原始 ID 递到前端手上（管理台约定）。
 * applicantActionId 保留：后台是运营的操作台，排障时要能对上 Sumsub 侧。
 */
export interface AdminMaterialRequestRow {
  requestNo: string;
  materialType: string;
  materialLabel: string;
  levelName: string;
  applicantActionId: string;
  orderDomain: MaterialRequestOrderDomain | null;
  orderRef: string | null;
  restrictionNo: string | null;
  origin: MaterialRequestOrigin;
  status: MaterialRequestStatus;
  reason: string;
  issuedBy: string;
  issuedAt: Date;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewAnswer: 'GREEN' | 'RED' | null;
  reviewRejectType: 'RETRY' | 'FINAL' | null;
  cancelReason: string | null;
}

/**
 * 客户面视图。**结构上装不下 applicantActionId 与 externalActionId** ——
 * 前者是 Sumsub 侧 id（spec I2），后者是铸 token 的钥匙，两个都只该留在服务端。
 * 由 material-request.contract.spec.ts 扫源码守着。
 */
export interface ClientMaterialRequestRow {
  requestNo: string;
  materialType: string;
  materialLabel: string;
  status: 'PENDING_SUBMISSION' | 'SUBMITTED';
  /** 挂了限制 = 真摁住你了（红档）；没挂 = 只是提醒（黄档） */
  blocking: boolean;
  orderDomain: 'DEPOSIT' | 'WITHDRAW' | 'SWAP' | null;
  orderRef: string | null;
  reason: string;
  issuedAt: string;
}

export interface ClientVerificationSessionView {
  submitted: boolean;
  sdkToken: string | null;
}
