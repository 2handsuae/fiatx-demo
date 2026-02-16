import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumberString,
  Matches,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum OwnerScope {
  CUSTOMER = 'CUSTOMER',
  LP = 'LP',
  ALL = 'ALL',
}

export enum AssetType {
  FIAT = 'FIAT',
  CRYPTO = 'CRYPTO',
  ALL = 'ALL',
}

export enum TriggerType {
  STATUS_TRANSITION = 'STATUS_TRANSITION',
  EXTERNAL_CALLBACK = 'EXTERNAL_CALLBACK',
  COMMAND = 'COMMAND',
  SYSTEM_RULE = 'SYSTEM_RULE',
  SCHEDULED = 'SCHEDULED',
}

export enum PostingMode {
  TEMPLATE = 'TEMPLATE',
  AUTO_REVERSAL = 'AUTO_REVERSAL',
  BULK_REVERSAL_BY_SOURCE = 'BULK_REVERSAL_BY_SOURCE',
  NONE = 'NONE',
}

export enum ClearingMode {
  TEMPLATE = 'TEMPLATE',
  NONE = 'NONE',
}

export class CreateAcctEventDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @Matches(/^EVT_/, { message: 'eventCode must start with EVT_' })
  eventCode!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  entityType!: string;

  @ApiProperty({ enum: OwnerScope })
  @IsEnum(OwnerScope)
  ownerScope!: OwnerScope;

  @ApiProperty({ enum: AssetType })
  @IsEnum(AssetType)
  assetType!: AssetType;

  @ApiProperty({ enum: TriggerType })
  @IsEnum(TriggerType)
  triggerType!: TriggerType;

  @ApiProperty({ enum: PostingMode })
  @IsEnum(PostingMode)
  postingMode!: PostingMode;

  @ApiProperty({ enum: ClearingMode })
  @IsEnum(ClearingMode)
  clearingMode!: ClearingMode;

  @ApiPropertyOptional()
  @ValidateIf((o) => o.postingMode === PostingMode.AUTO_REVERSAL)
  @IsString()
  @IsNotEmpty({
    message:
      'postingReversalOfEventCode is required when postingMode is AUTO_REVERSAL',
  })
  postingReversalOfEventCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clearingReversalOfEventCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateAcctEventDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional({ enum: OwnerScope })
  @IsOptional()
  @IsEnum(OwnerScope)
  ownerScope?: OwnerScope;

  @ApiPropertyOptional({ enum: AssetType })
  @IsOptional()
  @IsEnum(AssetType)
  assetType?: AssetType;

  @ApiPropertyOptional({ enum: TriggerType })
  @IsOptional()
  @IsEnum(TriggerType)
  triggerType?: TriggerType;

  @ApiPropertyOptional({ enum: PostingMode })
  @IsOptional()
  @IsEnum(PostingMode)
  postingMode?: PostingMode;

  @ApiPropertyOptional({ enum: ClearingMode })
  @IsOptional()
  @IsEnum(ClearingMode)
  clearingMode?: ClearingMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  postingReversalOfEventCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clearingReversalOfEventCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

export class AcctEventQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString()
  skip?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString()
  take?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  eventCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional({ enum: OwnerScope })
  @IsOptional()
  @IsEnum(OwnerScope)
  ownerScope?: OwnerScope;

  @ApiPropertyOptional({ enum: AssetType })
  @IsOptional()
  @IsEnum(AssetType)
  assetType?: AssetType;

  @ApiPropertyOptional({ enum: TriggerType })
  @IsOptional()
  @IsEnum(TriggerType)
  triggerType?: TriggerType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString() // 'true' or 'false'
  isActive?: string;
}
