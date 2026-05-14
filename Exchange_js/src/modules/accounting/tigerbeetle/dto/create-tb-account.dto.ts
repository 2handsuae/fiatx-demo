import { IsString, IsInt, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTbAccountDto {
  @ApiProperty({ description: 'Account category', enum: ['SYSTEM', 'CUSTOMER'] })
  @IsString()
  @IsIn(['SYSTEM', 'CUSTOMER'])
  accountCategory!: 'SYSTEM' | 'CUSTOMER';

  @ApiProperty({ description: 'Asset code (must be a provisioned asset with tbLedgerId)' })
  @IsString()
  assetCode!: string;

  @ApiProperty({ description: 'TB account type code (e.g. 1=BANK, 100=CLIENT_CREDIT)' })
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
