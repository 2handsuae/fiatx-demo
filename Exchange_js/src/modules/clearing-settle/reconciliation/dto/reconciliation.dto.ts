import { IsOptional, IsString } from 'class-validator';
export class ReconRunQueryDto {
  @IsOptional() @IsString() businessDate?: string;
  @IsOptional() @IsString() layer?: string;
  // Phase B engine stamp: V8_FORMULA (legacy credit-net five-formula) | WALLET_V1 (T7 per-wallet).
  // Omitted = all engines.
  @IsOptional() @IsString() engineVersion?: string;
}
export class ReconCaseQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() assetCode?: string;
}
export class ReconExternalBalanceQueryDto {
  @IsOptional() @IsString() cutoffDate?: string;
  @IsOptional() @IsString() book?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() currency?: string;
}
