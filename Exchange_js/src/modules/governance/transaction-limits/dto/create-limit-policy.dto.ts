import { IsIn, IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';
import {
  TRADING_TIERS,
  OPERATION_TYPES,
  LIMIT_PERIODS,
} from '../constants/limit-policy.constants';

export class CreateLimitPolicyDto {
  @IsString()
  @IsNotEmpty()
  @IsIn([...TRADING_TIERS])
  tradingTier!: string;

  @IsString()
  @IsNotEmpty()
  @IsIn([...OPERATION_TYPES])
  operationType!: string;

  @IsString()
  @IsNotEmpty()
  @IsIn([...LIMIT_PERIODS])
  period!: string;

  @IsNumber()
  @Min(0.01)
  limitAmount!: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
