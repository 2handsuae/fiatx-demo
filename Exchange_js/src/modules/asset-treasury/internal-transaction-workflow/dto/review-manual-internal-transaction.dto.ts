import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export enum ManualInternalTransactionReviewAction {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

export class ReviewManualInternalTransactionDto {
  @ApiProperty({ enum: ManualInternalTransactionReviewAction })
  @IsEnum(ManualInternalTransactionReviewAction)
  action!: ManualInternalTransactionReviewAction;

  @ApiPropertyOptional({
    description: 'Optional review reason. Recommended for reject action.',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  reason?: string;
}
