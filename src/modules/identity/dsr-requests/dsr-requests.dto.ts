// 战役丙波四 T5 · DSR admin 面 HTTP DTO。校验只做既有惯例的必填/枚举，不加其余防御性校验（CLAUDE.md §2）。
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { DsrResolutionCode, DsrType, DsrTypeValue } from './dsr.constants';

const DSR_RESOLUTION_CODE_VALUES = Object.values(DsrResolutionCode);
const DSR_TYPE_VALUES = Object.values(DsrType);

/** 客户提交：type 三值枚举（唯一一道校验——服务层 submit 不再判）；detail 是客户自述，DPO 办理时要读，必填。 */
export class SubmitDsrBodyDto {
  @ApiProperty({ enum: DSR_TYPE_VALUES }) @IsIn(DSR_TYPE_VALUES) type!: DsrTypeValue;
  @ApiProperty() @IsString() @IsNotEmpty() detail!: string;
}

/** 办结：resolutionCode 与 type 的匹配是业务规则，在服务层判（DSR_RESOLUTION_BY_TYPE）；DTO 只认四值枚举。 */
export class ResolveDsrBodyDto {
  @ApiProperty({ enum: DSR_RESOLUTION_CODE_VALUES }) @IsIn(DSR_RESOLUTION_CODE_VALUES) resolutionCode!: string;
  @ApiProperty() @IsString() @IsNotEmpty() resolutionNote!: string;
}
