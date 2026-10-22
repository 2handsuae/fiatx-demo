import { IsString, IsBoolean, IsOptional, IsIn, Equals, ValidateIf } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateBankAccountDto {
  @ApiProperty({ description: 'Full legal name of the bank account holder' })
  @IsString()
  beneficiaryName!: string;

  @ApiProperty({ description: 'Name of the bank' })
  @IsString()
  bankName!: string;

  @ApiProperty({ description: 'International Bank Account Number (IBAN)' })
  @IsString()
  iban!: string;

  @ApiProperty({ description: 'SWIFT/BIC code (8 or 11 characters)' })
  @IsString()
  swiftBic!: string;

  @ApiProperty({ required: false, description: 'Optional account label, e.g. "My Savings"' })
  @IsString()
  @IsOptional()
  label?: string;

  @ApiProperty({ description: 'Whose account this is: the customer (SELF) or someone else (THIRD_PARTY)', enum: ['SELF', 'THIRD_PARTY'] })
  @IsIn(['SELF', 'THIRD_PARTY'])
  ownerType!: 'SELF' | 'THIRD_PARTY';

  @ApiProperty({ required: false, description: 'Relationship to the account holder, e.g. "Spouse" (required when ownerType is THIRD_PARTY)' })
  @ValidateIf((o) => o.ownerType === 'THIRD_PARTY')
  @IsString()
  beneficiaryRelationship?: string;

  @ApiProperty({ description: 'Must be true — ownership declaration' })
  @IsBoolean()
  @Equals(true, { message: 'Ownership declaration must be accepted' })
  ownershipDeclaration!: boolean;
}
