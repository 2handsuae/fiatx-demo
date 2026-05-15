import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateLimitDto {
  @IsNumber()
  @Min(0.01)
  limitAmount!: number;

  @IsString()
  @IsNotEmpty()
  changeReason!: string;
}

export class ListTransactionLimitPoliciesDto {
  @IsOptional()
  @IsString()
  tradingTier?: string;

  @IsOptional()
  @IsString()
  operationType?: string;

  @IsOptional()
  @IsString()
  skip?: string;

  @IsOptional()
  @IsString()
  take?: string;
}
