import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { FEEDABLE_VASP_KEYS, type FeedableVaspKey } from '../../sumsub-shared/travel-rule/mock-travel-rule.adapter';

/**
 * ⚡喂来源归因（演示用）：站在 Sumsub 一侧告诉我方"这笔入金的对手方是谁"。
 * 对外用业务键 depositNo（铁律⑥）；仅 COMPLIANCE_PENDING 的 crypto TR 单可喂。
 */
export class FeedAttributionDto {
  @ApiProperty({ description: 'Business key of the deposit (depositNo)' })
  @IsString()
  @MinLength(1)
  depositNo!: string;

  @ApiProperty({ description: 'VASP = hosted by a directory VASP; UNHOSTED = self-custody wallet', enum: ['VASP', 'UNHOSTED'] })
  @IsIn(['VASP', 'UNHOSTED'])
  attribution!: 'VASP' | 'UNHOSTED';

  @ApiPropertyOptional({
    description: 'Which directory sample to attribute (VASP only; default MOCK_VASP_EXCHANGE)',
    enum: FEEDABLE_VASP_KEYS,
  })
  @IsOptional()
  @IsIn(FEEDABLE_VASP_KEYS)
  vasp?: FeedableVaspKey;
}
