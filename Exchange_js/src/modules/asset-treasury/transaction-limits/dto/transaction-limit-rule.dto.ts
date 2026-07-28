import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { GATE_TYPES, LIMIT_OPERATION_TYPES } from '../constants/transaction-limit.constants';

// DTO 保持宽松:具体哪种 gateType 需要哪些字段由 TransactionLimitRulesService.validateShape 在运行时校验
export class CreateTransactionLimitRuleDto {
  @IsString()
  @IsNotEmpty()
  @IsIn([...GATE_TYPES])
  gateType!: string;

  @IsString()
  @IsNotEmpty()
  @IsIn([...LIMIT_OPERATION_TYPES])
  operationType!: string;

  @IsString()
  @IsOptional()
  assetId?: string;

  @IsString()
  @IsOptional()
  tradingTier?: string;

  @IsString()
  @IsOptional()
  period?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  minAmount?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  maxAmount?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  defaultLimit?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  cap?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  threshold?: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}

// 变更 DTO:仅金额字段(允许留空)+ reason;哪几个金额字段合法由 validateShape(合并行)运行时校验
export class ChangeTransactionLimitRuleDto {
  @IsNumber()
  @Min(0)
  @IsOptional()
  minAmount?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  maxAmount?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  defaultLimit?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  cap?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  threshold?: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
