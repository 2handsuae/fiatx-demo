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
  REORG = 'reorg',
}

export enum PayinMockEvent {
  MEMPOOL_SEEN = 'MEMPOOL_SEEN',
  CHAIN_CONFIRMED = 'CHAIN_CONFIRMED',
  DROPPED = 'DROPPED',
  REORG = 'REORG',
  FIAT_CONFIRMED = 'FIAT_CONFIRMED',
  FIAT_FAILED = 'FIAT_FAILED',
}

export enum PayinSimulationMode {
  INTERACTIVE = 'INTERACTIVE',
}

export enum PayinType {
  CRYPTO = 'CRYPTO',
  FIAT = 'FIAT',
}

export class UpdatePayinStatusDto {
  @IsEnum(PayinAction)
  action!: PayinAction;
}

export class MockPayinEventDto {
  @IsEnum(PayinMockEvent)
  event!: PayinMockEvent;
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
