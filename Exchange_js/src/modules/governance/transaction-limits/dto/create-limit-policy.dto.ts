import { IsIn, IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';
import {
  OPERATION_TYPES,
  LIMIT_PERIODS,
} from '../constants/limit-policy.constants';

export class CreateLimitPolicyDto {
  @IsString()
  @IsNotEmpty()
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
