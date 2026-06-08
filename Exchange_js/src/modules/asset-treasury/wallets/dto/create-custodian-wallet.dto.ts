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

  @ApiProperty({ required: false, description: 'Customer business key (e.g. CU2605130001) — required for customer-level roles (C_DEP, C_VIBAN)' })
  @IsString()
  @IsOptional()
  customerNo?: string;

  @ApiProperty({ required: false, description: 'Custodian provider — defaults to HEXTRUST' })
  @IsString()
  @IsOptional()
  custodianProvider?: string;

  @ApiProperty({ required: false, description: 'Existing vault ID — if provided, creates address under this vault; otherwise creates a new vault' })
  @IsString()
  @IsOptional()
  vaultId?: string;

  @ApiProperty({ required: false, description: 'IBAN — required for fiat system wallets (C_CMA, F_LIQ, F_OPS, F_SET, F_FEE), skips adapter call' })
  @IsString()
  @IsOptional()
  iban?: string;

  @ApiProperty({ required: false, description: 'Bank name — required for C_CMA role' })
  @IsString()
  @IsOptional()
  bankName?: string;

  @ApiProperty({ required: false, description: 'Account holder name — required for C_CMA role' })
  @IsString()
  @IsOptional()
  accountName?: string;
}
