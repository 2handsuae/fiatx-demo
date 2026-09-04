import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** 只能改标签与收款人；地址 / IBAN 不可改——改地址 = 新登记，冷却闸才有意义（spec §5） */
export class UpdateWithdrawalAddressDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  label?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  beneficiaryName?: string;
}
