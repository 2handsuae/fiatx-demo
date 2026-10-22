import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';

/**
 * 来源认领的三个出口（unhosted 钱包超 Travel Rule 线时客户要说清这个钱包是谁的）：
 *   SELF               —— 我自己的钱包（零附加，mock 签名即点即过）
 *   THIRD_PARTY_PERSON —— 别人的钱包：要说名字 + 与我的关系
 *   THIRD_PARTY_VASP   —— 某家 VASP 的托管钱包：要说 VASP 名，无关系可言
 */
export enum OwnershipClaimType {
  SELF = 'SELF',
  THIRD_PARTY_PERSON = 'THIRD_PARTY_PERSON',
  THIRD_PARTY_VASP = 'THIRD_PARTY_VASP',
}

/**
 * 客户提交来源认领。对外用业务键 depositNo（路径参数，不在 body 里）。
 *
 * name / relationship 是否必填取决于 claimType——那是业务规则，由
 * DepositWorkflowService.submitOwnershipClaim 判（单测直调 service 也要守得住），
 * 这里只负责类型与白名单：未装饰的字段会被全局 ValidationPipe（whitelist）剥掉，
 * 漏装饰 = 第三方分支永远缺 name。
 */
export class OwnershipClaimDto {
  @ApiProperty({ enum: OwnershipClaimType })
  @IsEnum(OwnershipClaimType)
  claimType!: OwnershipClaimType;

  @ApiPropertyOptional({ description: 'Person name (THIRD_PARTY_PERSON) or VASP name (THIRD_PARTY_VASP); ignored for SELF' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Relationship to the wallet owner (THIRD_PARTY_PERSON only)' })
  @IsOptional()
  @IsString()
  relationship?: string;
}
