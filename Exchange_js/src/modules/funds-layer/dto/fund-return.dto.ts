import { IsString, IsNotEmpty } from 'class-validator';

export class FundReturnDto {
  @IsString() @IsNotEmpty() withdrawId!: string;
  @IsString() @IsNotEmpty() withdrawNo!: string;
  @IsString() @IsNotEmpty() assetId!: string;
  @IsString() @IsNotEmpty() amount!: string;
  @IsString() @IsNotEmpty() reason!: string; // repair 必须记原因
}
