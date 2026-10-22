import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** 只能改标签；受益人 / 关系 / 托管自报是申报证据，登记后冻结。地址 / IBAN 也不可改——改地址 = 新登记，冷却闸才有意义（spec §5） */
export class UpdateWithdrawalAddressDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  label?: string;
}
