import { IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { NETWORK_CODES } from '../../../../config/manifests/networks.manifest';

export class CreateDepositWalletDto {
  @ApiProperty({ description: 'Network code to open a deposit address on', enum: NETWORK_CODES })
  @IsString()
  @IsIn(NETWORK_CODES)
  network!: string;
}
