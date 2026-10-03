// 战役丙波四 T5 · DSR admin 面 HTTP DTO。校验只做既有惯例的必填/枚举，不加其余防御性校验（CLAUDE.md §2）。
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { DsrResolutionCode } from './dsr.constants';

const DSR_RESOLUTION_CODE_VALUES = Object.values(DsrResolutionCode);

/** 办结：resolutionCode 与 type 的匹配是业务规则，在服务层判（DSR_RESOLUTION_BY_TYPE）；DTO 只认四值枚举。 */
export class ResolveDsrBodyDto {
  @ApiProperty({ enum: DSR_RESOLUTION_CODE_VALUES }) @IsIn(DSR_RESOLUTION_CODE_VALUES) resolutionCode!: string;
  @ApiProperty() @IsString() @IsNotEmpty() resolutionNote!: string;
}
