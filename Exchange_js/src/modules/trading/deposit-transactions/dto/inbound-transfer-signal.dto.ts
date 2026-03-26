import {
  ValidateIf,
  IsEnum,
  IsNumber,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum InboundTransferSignalStatus {
  PENDING_SCAN = 'PENDING_SCAN',
  PAYIN_CREATED = 'PAYIN_CREATED',
  IGNORED = 'IGNORED',
  FAILED = 'FAILED',
}

export enum InboundTransferChannelType {
  CRYPTO = 'CRYPTO',
  FIAT = 'FIAT',
}

export enum SimulationRiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum SimulationRiskReason {
  KYT_ISSUE = 'KYT_ISSUE',
  TRAVEL_RULE_ISSUE = 'TRAVEL_RULE_ISSUE',
  LARGE_DEPOSIT_PROFILE_MISMATCH = 'LARGE_DEPOSIT_PROFILE_MISMATCH',
  SANCTIONS_HIT = 'SANCTIONS_HIT',
}

export enum InboundTransferScanMode {
  QUICK_DEMO = 'QUICK_DEMO',
  INTERACTIVE = 'INTERACTIVE',
}

export class InboundTransferSignalQueryDto {
  @IsOptional()
  @IsUUID()
  walletId?: string;

  @IsOptional()
  @IsEnum(InboundTransferSignalStatus)
  status?: InboundTransferSignalStatus;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  skip?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  take?: number;
}

export class CreateInboundTransferSignalDto {
  @IsUUID()
  walletId!: string;

  @IsNumberString()
  amount!: string;

  @IsOptional()
  @IsString()
  txHash?: string;

  @IsOptional()
  @IsString()
  fromAddress?: string;

  @IsOptional()
  @IsString()
  referenceNo?: string;

  @IsOptional()
  @IsString()
  fromIban?: string;

  @IsOptional()
  @IsEnum(SimulationRiskLevel)
  simulationRiskLevel?: SimulationRiskLevel;

  @ValidateIf((object: CreateInboundTransferSignalDto) => object.simulationRiskLevel === SimulationRiskLevel.MEDIUM)
  @IsOptional()
  @IsEnum(SimulationRiskReason)
  simulationRiskReason?: SimulationRiskReason;
}

export class ScanInboundTransferSignalsDto {
  @IsUUID()
  walletId!: string;

  @IsOptional()
  @IsEnum(InboundTransferScanMode)
  mode?: InboundTransferScanMode;
}
