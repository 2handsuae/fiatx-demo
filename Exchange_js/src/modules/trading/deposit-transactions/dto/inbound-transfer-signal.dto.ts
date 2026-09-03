import {
  ValidateIf,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsNumberString,
  IsOptional,
  IsString,
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
  @IsString()
  network?: string;

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
  /** 入金落在哪条网络的哪个地址——钥匙是（网络, 地址 | IBAN），不再是内部 walletId */
  @IsString()
  network!: string;

  @IsOptional()
  @IsString()
  toAddress?: string;

  @IsOptional()
  @IsString()
  iban?: string;

  /** 代币合约地址；原生币 / 法币留空。对不上任何资产的信号拒收留痕——合约地址防诈骗落在这里 */
  @IsOptional()
  @IsString()
  contractAddress?: string;

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

  // crypto 必填 / fiat 禁传 —— 判据依赖 wallet 的 asset.type,校验在
  // InboundTransferSignalsService.createForCustomer() 内(DTO 层拿不到 assetType)。
  @IsOptional()
  @IsBoolean()
  counterpartyIsVasp?: boolean;
}

export class ScanInboundTransferSignalsDto {
  @IsString()
  network!: string;

  @IsOptional()
  @IsString()
  toAddress?: string;

  @IsOptional()
  @IsString()
  iban?: string;

  @IsOptional()
  @IsEnum(InboundTransferScanMode)
  mode?: InboundTransferScanMode;
}
