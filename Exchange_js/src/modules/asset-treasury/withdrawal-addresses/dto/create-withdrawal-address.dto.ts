import { IsString, IsIn, IsBoolean, IsOptional, Equals } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { NETWORK_CODES } from '../../../../config/manifests/networks.manifest';

export class CreateWithdrawalAddressDto {
  @ApiProperty({ description: 'Network the address lives on (chain networks only)', enum: NETWORK_CODES })
  @IsString()
  @IsIn(NETWORK_CODES)
  network!: string;

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
