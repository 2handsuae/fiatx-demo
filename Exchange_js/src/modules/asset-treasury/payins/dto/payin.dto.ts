import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  IsNumberString,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum PayinStatus {
  DETECTED = 'DETECTED',
  CONFIRMING = 'CONFIRMING',
  CONFIRMED = 'CONFIRMED',
  CLEARED = 'CLEARED',
  FAILED = 'FAILED',
}

export enum PayinAction {
  CONFIRM = 'confirm',
  FAIL = 'fail',
  CLEAR = 'clear',
  BLOCK = 'block',
}

export enum PayinType {
  CRYPTO = 'crypto',
  FIAT = 'fiat',
}

export class UpdatePayinStatusDto {
  @IsEnum(PayinAction)
  action!: PayinAction;
}

export class SimulatePayinDto {
  @IsUUID()
  assetId!: string;

  @IsUUID()
  toWalletId!: string;

  @IsEnum(PayinType)
  type!: PayinType;
}

export class PayinQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString()
  skip?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString()
  take?: string;

  @ApiPropertyOptional({ enum: PayinType })
  @IsOptional()
  @IsEnum(PayinType)
  type?: PayinType;

  @ApiPropertyOptional({ enum: PayinStatus })
  @IsOptional()
  @IsEnum(PayinStatus)
  status?: PayinStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assetId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  txHash?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  depositId?: string;
}
