import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class FeeAccrualQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() q?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() feeAccrualNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sourceNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() ownerNo?: string;
  @ApiPropertyOptional({ enum: ['ACCRUED', 'LOCKED', 'SETTLED'] })
  @IsOptional() @IsIn(['ACCRUED', 'LOCKED', 'SETTLED'])
  status?: 'ACCRUED' | 'LOCKED' | 'SETTLED';
  @ApiPropertyOptional({ enum: ['SWAP_FEE', 'WITHDRAW_FEE'] })
  @IsOptional() @IsIn(['SWAP_FEE', 'WITHDRAW_FEE'])
  category?: 'SWAP_FEE' | 'WITHDRAW_FEE';
  @ApiPropertyOptional({ enum: ['SERVICE_FEE', 'SPREAD'] })
  @IsOptional() @IsIn(['SERVICE_FEE', 'SPREAD'])
  feeKind?: 'SERVICE_FEE' | 'SPREAD';
  @ApiPropertyOptional() @IsOptional() @IsString() assetCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() endDate?: string;
  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  pageSize?: number = 20;
}
