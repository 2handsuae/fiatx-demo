import { IsEnum } from 'class-validator';
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

export enum WalletRole {
  C_DEP = 'C_DEP',
  C_VIBAN = 'C_VIBAN',
  C_MAIN = 'C_MAIN',
  C_OUT = 'C_OUT',
  C_CMA = 'C_CMA',
  F_LIQ = 'F_LIQ',
  F_OPS = 'F_OPS',
  F_SET = 'F_SET',
  F_FEE = 'F_FEE',
}

export enum WalletStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  CREATING = 'CREATING',
  ACTIVE = 'ACTIVE',
  FROZEN = 'FROZEN',
  DISABLED = 'DISABLED',
  FAILED = 'FAILED',
}

export class UpdateWalletStatusDto {
  @ApiProperty({ enum: WalletStatus })
  @IsEnum(WalletStatus)
  status!: WalletStatus;
}
