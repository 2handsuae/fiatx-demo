import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString } from 'class-validator';

/**
 * Query params for the unified funds-orders admin list (C6).
 * `parent` is a virtual filter over the deposit/withdraw/swap FKs.
 */
export class FundsOrdersAdminQueryDto {
  @ApiPropertyOptional({ enum: ['all', 'deposit', 'withdraw', 'swap', 'internal-transfer', 'lp-exchange'] })
  @IsOptional()
  @IsIn(['all', 'deposit', 'withdraw', 'swap', 'internal-transfer', 'lp-exchange'])
  parent?: 'all' | 'deposit' | 'withdraw' | 'swap' | 'internal-transfer' | 'lp-exchange';

  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() assetId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() fundsOrderNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() txHash?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) skip?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) take?: number;
}
