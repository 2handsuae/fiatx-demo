import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CAUSE_REGISTRY } from '../disposition/cause-registry';

export class RecordDispositionDto {
  @IsIn(['AMOUNT_MISMATCH', 'ORPHAN_INTERNAL', 'ORPHAN_EXTERNAL']) matchType!: 'AMOUNT_MISMATCH' | 'ORPHAN_INTERNAL' | 'ORPHAN_EXTERNAL';
  // 锚：ORPHAN_INTERNAL 只有 flowId、ORPHAN_EXTERNAL 只有 externalLineId、
  // AMOUNT_MISMATCH 两个都有（与 CreateAdjustmentDto 的锚同一套约定）。
  @IsOptional() @IsString() explainedFlowId?: string;
  @IsOptional() @IsString() explainedExternalLineId?: string;
  @IsIn(Object.keys(CAUSE_REGISTRY)) causeCode!: keyof typeof CAUSE_REGISTRY;
  @IsString() @IsNotEmpty() findingNote!: string;
  // 行事实（出口判定的输入）——前端从被点的那一行原样带上
  @IsOptional() @IsIn([1, -1]) deltaSign?: 1 | -1;
  @IsOptional() @IsIn(['IN', 'OUT']) internalDirection?: 'IN' | 'OUT';
  @IsOptional() @IsString() internalSourceType?: string;
  @IsOptional() @IsIn(['IN', 'OUT']) externalDirection?: 'IN' | 'OUT';
}
