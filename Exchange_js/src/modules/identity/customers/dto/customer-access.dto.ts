import { IsOptional, IsString } from 'class-validator';

export class FreezeCustomerDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class UnfreezeCustomerDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
