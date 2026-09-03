import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UnsuspendWithdrawalAddressDto {
  @ApiProperty({ description: 'Reason for lifting the suspension' })
  @IsString()
  @MinLength(1)
  reason!: string;
}
