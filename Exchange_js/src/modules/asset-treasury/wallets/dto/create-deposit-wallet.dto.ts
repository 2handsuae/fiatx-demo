import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDepositWalletDto {
  @ApiProperty({ description: 'Asset UUID to create a deposit wallet for' })
  @IsUUID()
  assetId!: string;
}
