import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import {
  SwapPricingPolicyConfig,
  WithdrawalPricingPolicyConfig,
} from '../types/pricing.types';

export class SaveSwapPolicyDto {
  @ApiProperty({ description: 'Swap pricing policy payload' })
  @IsObject()
  config!: SwapPricingPolicyConfig;
}

export class SaveWithdrawalPolicyDto {
  @ApiProperty({ description: 'Withdrawal pricing policy payload' })
  @IsObject()
  config!: WithdrawalPricingPolicyConfig;
}

export class SwapSimulatorDto {
  @ApiProperty({ description: 'From asset id' })
  @IsUUID()
  fromAssetId!: string;

  @ApiProperty({ description: 'To asset id' })
  @IsUUID()
  toAssetId!: string;

  @ApiProperty({ description: 'Swap amount' })
  @IsNumber()
  @Type(() => Number)
  @Min(0.00000001)
  amount!: number;
}

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
