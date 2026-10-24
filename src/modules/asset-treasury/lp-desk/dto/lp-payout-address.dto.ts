// LP 两步准入 Task 4：LP 打款地址端点请求体 DTO（ValidationPipe whitelist 需要装饰器，照 lp-profile.dto.ts 先例）。
// 状态枚举与迁移表在 constants/lp-payout-address-transitions.constant.ts，投影类型在 lp-payout-address.service.ts。
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * 登记入参——lpNo 在路径里，不进 body。坐标二选一：带 iban = 法币组（iban / bankName / swiftBic）；
 * 否则链上组（network / address / declaredHosting）。链上必填 declaredHosting、协议锚 evidenceRef 必填——
 * 这两条是业务规则，由主体服务的登记守卫兜（DTO 只负责 whitelist 与类型）。
 */
export class RegisterLpPayoutAddressDto {
  @ApiProperty({ description: 'Asset the address is registered for (crypto → network + address group, fiat → IBAN group)' })
  @IsString() @IsNotEmpty() assetId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() network?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional({ description: 'Required for an on-chain address — what treasury says the LP custody is', enum: ['SELF_CUSTODY', 'VASP'] })
  @IsOptional() @IsIn(['SELF_CUSTODY', 'VASP']) declaredHosting?: 'SELF_CUSTODY' | 'VASP';
  @ApiPropertyOptional() @IsOptional() @IsString() iban?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bankName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() swiftBic?: string;
  @ApiProperty({ description: 'Agreement clause / contract attachment reference proving the LP owns this coordinate' })
  @Transform(trim) @IsString() @IsNotEmpty() evidenceRef!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() label?: string;
}

/** 撤回 / 停用 / 恢复 / 退役：留痕不批，reason 供 LP_ADDRESS_{CANCELLED,SUSPENDED,REACTIVATED,DEACTIVATED} 契约（均 requiredFields:['reason']）。 */
export class LpPayoutAddressReasonDto {
  @ApiProperty() @Transform(trim) @IsString() @IsNotEmpty() reason!: string;
}

/** 改标签：登记后坐标与申报冻结，改只改 label（改坐标 = 新登记）。 */
export class UpdateLpPayoutAddressLabelDto {
  @ApiProperty() @IsString() @IsNotEmpty() label!: string;
}
