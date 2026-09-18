import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CAUSE_REGISTRY, DISPOSITION_LABEL, DispositionKind } from '../disposition/cause-registry';

export class RecordDispositionDto {
  @IsIn(['AMOUNT_MISMATCH', 'ORPHAN_INTERNAL', 'ORPHAN_EXTERNAL']) matchType!: 'AMOUNT_MISMATCH' | 'ORPHAN_INTERNAL' | 'ORPHAN_EXTERNAL';
  // 锚：ORPHAN_INTERNAL 只有 flowId、ORPHAN_EXTERNAL 只有 externalLineId、
  // AMOUNT_MISMATCH 两个都有（与 CreateAdjustmentDto 的锚同一套约定）。
  @IsOptional() @IsString() explainedFlowId?: string;
  @IsOptional() @IsString() explainedExternalLineId?: string;
  @IsIn(Object.keys(CAUSE_REGISTRY)) causeCode!: keyof typeof CAUSE_REGISTRY;
  // 写端翻转（Task 3）：财务先选处置，码只用来配对校验——record() 里矩阵（这一格允许
  // 哪些处置）→ 码（该码是否归属所选处置）两道校验，出口 = outletOf(disposition)。
  @IsIn(Object.keys(DISPOSITION_LABEL)) disposition!: DispositionKind;
  @IsString() @IsNotEmpty() findingNote!: string;
  // 行事实（出口判定的输入）——前端从被点的那一行原样带上
  @IsOptional() @IsIn([1, -1]) deltaSign?: 1 | -1;
  @IsOptional() @IsIn(['IN', 'OUT']) internalDirection?: 'IN' | 'OUT';
  @IsOptional() @IsString() internalSourceType?: string;
  @IsOptional() @IsIn(['IN', 'OUT']) externalDirection?: 'IN' | 'OUT';
}
