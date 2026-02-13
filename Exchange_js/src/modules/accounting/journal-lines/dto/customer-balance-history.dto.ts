import { IsOptional, IsString, IsNumberString, IsNotEmpty, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CustomerBalanceHistoryQueryDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  customerId!: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  assetId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString()
  skip?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString()
  take?: string;
}
