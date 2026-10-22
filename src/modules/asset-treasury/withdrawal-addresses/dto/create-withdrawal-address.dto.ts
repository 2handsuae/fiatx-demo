import { IsString, IsIn, IsBoolean, IsOptional, Equals, ValidateIf } from 'class-validator';
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

  @ApiProperty({ description: 'Whose address this is: the customer (SELF) or someone else (THIRD_PARTY)', enum: ['SELF', 'THIRD_PARTY'] })
  @IsIn(['SELF', 'THIRD_PARTY'])
  ownerType!: 'SELF' | 'THIRD_PARTY';

  @ApiProperty({ description: 'Customer-declared hosting of the address', enum: ['SELF_CUSTODY', 'VASP'] })
  @IsIn(['SELF_CUSTODY', 'VASP'])
  declaredHosting!: 'SELF_CUSTODY' | 'VASP';

  @ApiProperty({ required: false, description: 'Optional label, e.g. "My Ledger"' })
  @IsString()
  @IsOptional()
  label?: string;

  @ApiProperty({ required: false, description: 'Beneficiary full name (required when ownerType is THIRD_PARTY)' })
  @ValidateIf((o) => o.ownerType === 'THIRD_PARTY')
  @IsString()
  beneficiaryName?: string;

  @ApiProperty({ required: false, description: 'Relationship to the beneficiary, e.g. "Spouse" (required when ownerType is THIRD_PARTY)' })
  @ValidateIf((o) => o.ownerType === 'THIRD_PARTY')
  @IsString()
  beneficiaryRelationship?: string;

  @ApiProperty({ required: false, description: 'Memo / Tag for chains that require it' })
  @IsString()
  @IsOptional()
  memo?: string;
}
