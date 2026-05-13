import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SuspendWithdrawalAddressDto {
  @ApiProperty({ description: 'Reason for suspension' })
  @IsString()
  @MinLength(1)
  reason!: string;
}
