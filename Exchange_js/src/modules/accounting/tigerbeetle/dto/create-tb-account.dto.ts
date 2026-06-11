import { IsString, IsInt, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTbAccountDto {
  @ApiProperty({ description: 'Account category', enum: ['SYSTEM', 'CUSTOMER'] })
  @IsString()
  @IsIn(['SYSTEM', 'CUSTOMER'])
  accountCategory!: 'SYSTEM' | 'CUSTOMER';

  @ApiProperty({ description: 'Asset currency (must be a provisioned asset with tbLedgerId)' })
  @IsString()
  assetCurrency!: string;

  @ApiProperty({ description: 'TB account type code (e.g. 1=BANK, 100=CLIENT_PAYABLE)' })
  @IsInt()
  code!: number;

  @ApiPropertyOptional({ description: 'Customer No (required when accountCategory=CUSTOMER)' })
  @IsOptional()
  @IsString()
  customerNo?: string;

  @ApiPropertyOptional({ description: 'Optional description/note' })
  @IsOptional()
  @IsString()
  description?: string;
}
