import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString } from 'class-validator';

/**
 * Query params for the unified funds-orders admin list (C6).
 * `parent` is a virtual filter over the deposit/withdraw/swap FKs.
 */
export class FundsOrdersAdminQueryDto {
  // 战役乙波二 Task 6（T1 评审收口）：第六/第七父键——注资单/付款单，两族一次接齐
  // （FundsOrderList.tsx/FundsOrderDetail.tsx 同批加行）。
  @ApiPropertyOptional({ enum: ['all', 'deposit', 'withdraw', 'swap', 'internal-transfer', 'lp-exchange', 'capital-injection', 'vendor-payment'] })
  @IsOptional()
  @IsIn(['all', 'deposit', 'withdraw', 'swap', 'internal-transfer', 'lp-exchange', 'capital-injection', 'vendor-payment'])
  parent?: 'all' | 'deposit' | 'withdraw' | 'swap' | 'internal-transfer' | 'lp-exchange' | 'capital-injection' | 'vendor-payment';

  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() assetId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() fundsOrderNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() txHash?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) skip?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) take?: number;
}
