import { Type } from 'class-transformer';
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

// Task 4（调账单列表端点）：GET /admin/reconciliation/adjustments 查询参数。
// from/to 过滤 createdAt（开单落库时刻）——effectiveDate 是业务日，不是筛选主键。
export class AdjustmentListQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @Type(() => Number) skip?: number;
  @IsOptional() @Type(() => Number) take?: number;
}

// 铁律⑥：列表行只带业务键——无 id/walletRef。decimals 随 assetCode join asset 表现查，
// 供前端（Task 5）分→元 缩放显示，惯例同 reconciliation.dto.ts 的 AccountStatusRow。
export interface AdjustmentListRow {
  adjustmentNo: string;
  caseNo: string;
  ownerNo: string | null;
  assetCode: string;
  decimals: number;
  reasonCode: string;
  direction: string;
  amount: string;       // 最小单位（分）整数字符串
  status: string;
  effectiveDate: string; // YYYY-MM-DD
  createdAt: string;     // ISO
}
