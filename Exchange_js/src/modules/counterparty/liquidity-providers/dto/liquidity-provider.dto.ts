import {
  IsString,
  IsEmail,
  IsEnum,
  IsOptional,
  Length,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum LiquidityProviderStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export class CreateLiquidityProviderDto {
  @ApiProperty({ maxLength: 128, description: 'Provider name (1-128 chars)' })
  @IsString()
  @Length(1, 128)
  name!: string;

  @ApiProperty({ description: 'Contact email' })
  @IsEmail()
  email!: string;

  @ApiProperty({ required: false, description: 'Contact phone (E.164 format)' })
  @IsString()
  @IsOptional()
  @Matches(/^\+[1-9]\d{1,14}$/, {
    message: 'Phone must be in E.164 format (e.g. +8613812345678)',
  })
  @Length(0, 32)
  phone?: string;
}

export class UpdateLiquidityProviderStatusDto {
  @ApiProperty({ enum: LiquidityProviderStatus })
  @IsEnum(LiquidityProviderStatus)
  status!: LiquidityProviderStatus;
}
