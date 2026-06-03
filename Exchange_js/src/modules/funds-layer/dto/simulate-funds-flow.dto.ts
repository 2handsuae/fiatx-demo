import { IsIn, IsOptional, IsString } from 'class-validator';

export class SimulateFundsFlowDto {
  @IsString() fundsFlowId!: string;

  @IsIn(['SIGN', 'BROADCAST', 'SEEN_IN_MEMPOOL', 'CONFIRM', 'CLEAR', 'FAIL', 'DROP', 'TIMEOUT', 'CANCEL'])
  action!: string;

  @IsOptional() @IsString() reason?: string;
}
