import { IsOptional, IsString, IsUUID, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListWithdrawalAddressQueryDto {
  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  assetId?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  addressType?: string;

  @ApiProperty({ required: false, description: 'addressNo / address / IBAN 模糊搜索' })
  @IsString()
  @IsOptional()
  q?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  customerId?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  customerNo?: string;

  @ApiProperty({ required: false, default: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  take?: number;

  @ApiProperty({ required: false, default: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  skip?: number;
}
