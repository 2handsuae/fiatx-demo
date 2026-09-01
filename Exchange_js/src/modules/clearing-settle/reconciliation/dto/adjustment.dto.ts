import { IsIn, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { REASON_SPECS } from '../disposition/adjustment-rules';

export class CreateAdjustmentDto {
  @IsString() @IsNotEmpty() caseNo!: string;
  // 这张单在解释哪一条差异。锚在真实证据上——内部流水 id（account_flows.id）与
  // 外部对账单行 id（external_statement_lines.id）——因为 ReconciliationLineItem
  // 每轮对账 delete-then-insert，没有跨轮身份，锚上去下一轮就悬空。
  // 差异行按类型带哪个锚：ORPHAN_INTERNAL 只有内部流水、ORPHAN_EXTERNAL 只有对账
  // 单行、AMOUNT_MISMATCH 两个都有。两个都不传也允许——那是纯余额差、案子上根本
  // 没有差异行可指（此时调账只补余额，不摘任何异常）。
  @IsOptional() @IsString() explainedFlowId?: string;
  @IsOptional() @IsString() explainedExternalLineId?: string;
  @IsIn(Object.keys(REASON_SPECS)) reasonCode!: keyof typeof REASON_SPECS;
  @IsIn(['REDUCE', 'INCREASE']) direction!: 'REDUCE' | 'INCREASE';
  @IsString() @IsNotEmpty() amount!: string;               // 最小单位（分）整数字符串
  @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveDate!: string;
  @IsString() @IsNotEmpty() reasonInternal!: string;
  @IsString() @IsNotEmpty() reasonCustomer!: string;
  @IsOptional() @IsString() relatedOrderNo?: string;
  // 定性联动（spec §3.3）：带上则开单成功后回填 disposition.adjustmentNo 并锁定该定性
  @IsOptional() @IsString() dispositionNo?: string;
  // 第四族改记：正主方案件号（caseNo = 错记方案件）
  @IsOptional() @IsString() toCaseNo?: string;
}
