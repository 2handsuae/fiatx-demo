import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MinLength,
} from 'class-validator';
import { InternalTransactionType } from '../../internal-transactions/dto/internal-transaction.dto';

export class CreateManualInternalTransactionDto {
  @ApiProperty({ enum: InternalTransactionType })
  @IsEnum(InternalTransactionType)
  type!: InternalTransactionType;

  @ApiProperty()
  @IsUUID()
  assetId!: string;

  @ApiProperty()
  @IsUUID()
  fromWalletId!: string;

  @ApiProperty()
  @IsUUID()
  toWalletId!: string;

  @ApiProperty({
    description: 'Decimal amount string',
    example: '1.25',
  })
  @IsString()
  @Matches(/^\d+(\.\d+)?$/, { message: 'amount must be a positive decimal string' })
  amount!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  referenceNo?: string;

  @ApiPropertyOptional({
    description: 'Idempotency key for manual creation',
  })
  @IsOptional()
  @IsString()
  requestId?: string;

  @ApiProperty({
    description: 'Submission reason for manual review',
    example: 'Treasury rebalance before payout window',
  })
  @IsString()
  @MinLength(3)
  reason!: string;
}
