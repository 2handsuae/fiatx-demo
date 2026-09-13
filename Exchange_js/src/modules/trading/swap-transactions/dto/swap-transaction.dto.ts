import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { InternalFundAction } from '../../../funds-layer/dto/internal-fund.dto';

export enum SwapTransactionStatus {
  COMPLIANCE_PENDING = 'COMPLIANCE_PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  REJECTED = 'REJECTED',
  // 2026-08-20 制裁分主体：客户本人命中制裁 → 冻单。零出边终态。
  // 唯一入边 COMPLIANCE_PENDING --freeze--> FROZEN，两个驱动方（本单 KYT 裁决 /
  // 跨域冻人广播）。PROCESSING 刻意不设入边 —— 四条腿正在逐条过账，半程冻结
  // 会把账本劈成两半。
  // ⚠️ FROZEN 是活态、可达，不属于下面那段死枚举。
  FROZEN = 'FROZEN',
}

export enum SwapTransactionAction {
  KYT_APPROVED = 'kyt_approved',
  KYT_REJECTED = 'kyt_rejected',
  SLA_BREACH = 'sla_breach',
  SUCCESS = 'success',
  // 与 deposit-transaction.dto.ts / withdraw-transaction.dto.ts 的 FREEZE 逐字同款。
  FREEZE = 'freeze',
}

export type SwapRejectReason = 'KYT_REJECTED' | 'TIMEOUT' | 'SANCTION_APPLICANT' | 'FROZEN_BY_MLRO';

export class CreateSwapTransactionDto {
  @ApiPropertyOptional({ description: 'Business transaction number' })
  @IsOptional()
  @IsString()
  swapNo?: string;

  @ApiProperty({ enum: ['CUSTOMER', 'LP'], description: 'Owner type' })
  @IsEnum(['CUSTOMER', 'LP'])
  ownerType!: string;

  @ApiProperty({ description: 'Owner ID' })
  @IsString()
  ownerId!: string;

  @ApiProperty({ description: 'Source asset ID' })
  @IsUUID()
  fromAssetId!: string;

  @ApiProperty({ description: 'Source amount' })
  @IsNumber()
  @Type(() => Number)
  fromAmount!: number;

  @ApiProperty({ description: 'Target asset ID' })
  @IsUUID()
  toAssetId!: string;

  @ApiProperty({ description: 'Target amount' })
  @IsNumber()
  @Type(() => Number)
  toAmount!: number;
}

export class AdvanceSwapLegDto {
  @ApiProperty({ enum: InternalFundAction, description: 'Action to apply to the swap settlement leg' })
  @IsEnum(InternalFundAction)
  action!: InternalFundAction;
}

export class SwapTransactionQueryDto {
  @ApiPropertyOptional({ description: 'Number of records to skip' })
  @IsOptional()
  @Type(() => Number)
  skip?: number;

  @ApiPropertyOptional({ description: 'Number of records to take' })
  @IsOptional()
  @Type(() => Number)
  take?: number;

  @ApiPropertyOptional({ description: 'Business transaction number' })
  @IsOptional()
  @IsString()
  swapNo?: string;

  @ApiPropertyOptional({ description: 'Owner ID' })
  @IsOptional()
  @IsString()
  ownerId?: string;

  // 客户详情页 → 三域交易跳转（第二幕波一）：按客户业务键过滤，见铁律⑥。
  @ApiPropertyOptional({ description: 'Owner business number (customerNo)' })
  @IsOptional()
  @IsString()
  ownerNo?: string;

  @ApiPropertyOptional({ enum: ['CUSTOMER', 'LP'], description: 'Owner type' })
  @IsOptional()
  @IsEnum(['CUSTOMER', 'LP'])
  ownerType?: string;

  @ApiPropertyOptional({ description: 'Status' })
  @IsOptional()
  @IsEnum(SwapTransactionStatus)
  status?: SwapTransactionStatus;

  @ApiPropertyOptional({ description: 'Start date' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date' })
  @IsOptional()
  @IsString()
  endDate?: string;
}
