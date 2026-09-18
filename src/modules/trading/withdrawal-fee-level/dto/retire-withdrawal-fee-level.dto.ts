import { IsNotEmpty, IsString } from 'class-validator';

export class RetireWithdrawalFeeLevelDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
