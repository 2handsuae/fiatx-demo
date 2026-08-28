import { IsIn, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { REASON_SPECS } from '../disposition/adjustment-rules';

export class CreateAdjustmentDto {
  @IsString() @IsNotEmpty() caseNo!: string;
  // Task 7 控制方裁定：flowComparison 的 5 种行里 4 种的 id 来自
  // ExternalStatementLine/AccountFlow，与 ReconciliationLineItem.id 不是一张表，
  // 且 ReconciliationLineItem 每轮对账 delete-then-insert 没有跨轮身份——传得进来的
  // lineItemId 天生悬空。降级为可选的溯源信息，不再是功能性外键；前端新代码不传它。
  @IsOptional() @IsString() lineItemId?: string;
  @IsIn(Object.keys(REASON_SPECS)) reasonCode!: keyof typeof REASON_SPECS;
  @IsIn(['REDUCE', 'INCREASE']) direction!: 'REDUCE' | 'INCREASE';
  @IsString() @IsNotEmpty() amount!: string;               // 最小单位（分）整数字符串
  @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveDate!: string;
  @IsString() @IsNotEmpty() reasonInternal!: string;
  @IsString() @IsNotEmpty() reasonCustomer!: string;
  @IsOptional() @IsString() relatedOrderNo?: string;
}
