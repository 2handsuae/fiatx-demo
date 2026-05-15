import { IsUUID, IsString, IsBoolean, IsOptional, Equals } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateWithdrawalAddressDto {
  @ApiProperty({ description: 'Asset UUID' })
  @IsUUID()
  assetId!: string;

  @ApiProperty({ description: 'Blockchain address' })
  @IsString()
  address!: string;

  @ApiProperty({ description: 'Must be true — ownership declaration' })
  @IsBoolean()
  @Equals(true, { message: 'Ownership declaration must be accepted' })
  ownershipDeclaration!: boolean;

  @ApiProperty({ required: false, description: 'Optional label, e.g. "My Ledger"' })
  @IsString()
  @IsOptional()
  label?: string;

  @ApiProperty({ required: false, description: 'Beneficiary full name' })
  @IsString()
  @IsOptional()
  beneficiaryName?: string;

  @ApiProperty({ required: false, description: 'Memo / Tag for chains that require it' })
  @IsString()
  @IsOptional()
  memo?: string;
}
