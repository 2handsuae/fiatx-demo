import { IsIn, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { REASON_SPECS } from '../disposition/adjustment-rules';

export class CreateAdjustmentDto {
  @IsString() @IsNotEmpty() caseNo!: string;
  @IsString() @IsNotEmpty() lineItemId!: string;
  @IsIn(Object.keys(REASON_SPECS)) reasonCode!: keyof typeof REASON_SPECS;
  @IsIn(['REDUCE', 'INCREASE']) direction!: 'REDUCE' | 'INCREASE';
  @IsString() @IsNotEmpty() amount!: string;               // 最小单位（分）整数字符串
  @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveDate!: string;
  @IsString() @IsNotEmpty() reasonInternal!: string;
  @IsString() @IsNotEmpty() reasonCustomer!: string;
  @IsOptional() @IsString() relatedOrderNo?: string;
}
