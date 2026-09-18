import { IsNotEmpty, IsString, Matches } from 'class-validator';

// 平账·推单 人工确认证据三件套（spec §2）：回执号 + 外部实际动账日 + 原因，全必填。
export class ManualPushDto {
  @IsString()
  @IsNotEmpty()
  receiptRef!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'externalDate 须为 YYYY-MM-DD' })
  externalDate!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
