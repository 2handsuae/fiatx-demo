import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';

export class FundsQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) skip?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) take?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() txHash?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() internalFundNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() assetId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() type?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() endDate?: string;
}
