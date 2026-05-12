import {
  IsString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum OwnerType {
  PLATFORM = 'PLATFORM',
  CUSTOMER = 'CUSTOMER',
  LIQUIDITY_PROVIDER = 'LIQUIDITY_PROVIDER',
}

export enum WalletType {
  FIAT_BANK = 'FIAT_BANK',
  CRYPTO_ADDRESS = 'CRYPTO_ADDRESS',
}

export enum WalletDirection {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
  BIDIRECTIONAL = 'BIDIRECTIONAL',
}

export enum WalletRole {
  C_DEP = 'C_DEP',
  C_VIBAN = 'C_VIBAN',
  C_MAIN = 'C_MAIN',
  C_OUT = 'C_OUT',
  C_CMA = 'C_CMA',
  F_LIQ = 'F_LIQ',
  F_OPS = 'F_OPS',
}

export enum WalletStatus {
  ACTIVE = 'ACTIVE',
  FROZEN = 'FROZEN',
  DISABLED = 'DISABLED',
}

export class CreateWalletDto {
  @ApiProperty({ enum: OwnerType })
  @IsEnum(OwnerType)
  ownerType!: OwnerType;

  @ApiProperty({
    required: false,
    description: 'Required if ownerType is not PLATFORM',
  })
  @IsString()
  @IsOptional()
  ownerId?: string;

  @ApiProperty({ enum: WalletType })
  @IsEnum(WalletType)
  type!: WalletType;

  @ApiProperty({ enum: WalletDirection })
  @IsEnum(WalletDirection)
  direction!: WalletDirection;

  @ApiProperty({ enum: WalletRole, required: false })
  @IsEnum(WalletRole)
  @IsOptional()
  walletRole?: WalletRole;

  @ApiProperty({ description: 'Asset ID' })
  @IsUUID()
  assetId!: string;

  // Crypto specific
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  memo?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  beneficiaryName?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  counterpartyVasp?: string;

  // Fiat specific
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  bankName?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  bankAccount?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  bankCode?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  accountName?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  iban?: string;
}

export class UpdateWalletStatusDto {
  @ApiProperty({ enum: WalletStatus })
  @IsEnum(WalletStatus)
  status!: WalletStatus;
}
