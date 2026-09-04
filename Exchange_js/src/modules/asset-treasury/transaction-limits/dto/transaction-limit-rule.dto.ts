import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

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
  threshold?: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
