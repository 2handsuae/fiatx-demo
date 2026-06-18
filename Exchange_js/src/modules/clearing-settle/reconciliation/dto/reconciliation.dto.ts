import { IsOptional, IsString } from 'class-validator';
export class ReconRunQueryDto {
  @IsOptional() @IsString() businessDate?: string;
  @IsOptional() @IsString() layer?: string;
}
export class ReconCaseQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() assetCode?: string;
}
