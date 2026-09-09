import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class WithdrawalSimulatorDto {
  @ApiProperty({ description: 'Asset id' })
  @IsUUID()
  assetId!: string;

  @ApiProperty({ description: 'Withdraw amount' })
  @IsNumber()
  @Type(() => Number)
  @Min(0.00000001)
  amount!: number;
}

export class CreateWithdrawPricingQuoteDto extends WithdrawalSimulatorDto {
  @ApiPropertyOptional({ description: 'Optional operator note for quote creation' })
  @IsOptional()
  @IsString()
  overrideReason?: string;
}
