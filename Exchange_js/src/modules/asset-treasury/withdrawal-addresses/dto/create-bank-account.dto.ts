import { IsUUID, IsString, IsBoolean, IsOptional, Equals } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateBankAccountDto {
  @ApiProperty({ description: 'Asset UUID (must be a FIAT asset)' })
  @IsUUID()
  assetId!: string;

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

  @ApiProperty({ description: 'Must be true — ownership declaration' })
  @IsBoolean()
  @Equals(true, { message: 'Ownership declaration must be accepted' })
  ownershipDeclaration!: boolean;
}
