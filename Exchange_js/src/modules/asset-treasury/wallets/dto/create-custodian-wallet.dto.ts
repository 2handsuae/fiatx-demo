import { IsString, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WalletRole } from './wallet.dto';

export class CreateCustodianWalletDto {
  @ApiProperty({ description: 'Asset operator key (e.g. AS2605130001)' })
  @IsString()
  assetNo!: string;

  @ApiProperty({ enum: WalletRole, description: 'Wallet role to assign' })
  @IsEnum(WalletRole)
  role!: WalletRole;

  @ApiProperty({ required: false, description: 'Customer UUID — required for customer-level roles (C_DEP, C_VIBAN)' })
  @IsString()
  @IsOptional()
  ownerId?: string;

  @ApiProperty({ required: false, description: 'Custodian provider — defaults to HEXTRUST' })
  @IsString()
  @IsOptional()
  custodianProvider?: string;

  @ApiProperty({ required: false, description: 'Existing vault ID — if provided, creates address under this vault; otherwise creates a new vault' })
  @IsString()
  @IsOptional()
  vaultId?: string;
}
