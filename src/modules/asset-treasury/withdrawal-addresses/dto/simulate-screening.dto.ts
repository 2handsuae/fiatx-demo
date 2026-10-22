import { IsIn, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** ⚡筛查喂（演示用）：answer 与 reason 缺一 400 */
export class SimulateScreeningDto {
  @ApiProperty({ description: 'Simulated screening verdict', enum: ['GREEN', 'YELLOW', 'RED'] })
  @IsIn(['GREEN', 'YELLOW', 'RED'])
  answer!: 'GREEN' | 'YELLOW' | 'RED';

  @ApiProperty({ description: 'Why this verdict is fed (goes into the audit trail)' })
  @IsString()
  @MinLength(1)
  reason!: string;
}
