// 战役甲波五 T5 · 投诉两面控制器 HTTP 层 DTO。校验只做既有惯例的必填/类型，不加其余
// 防御性格式校验（CLAUDE.md §2）。照 regulatory-filing.dto.ts 风格。
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import {
  ComplaintCategories, ComplaintCategory, ComplaintResolutionOutcomes, ComplaintResolutionOutcome,
} from '../complaint.constants';

const COMPLAINT_CATEGORY_VALUES = Object.values(ComplaintCategories);
const COMPLAINT_RESOLUTION_OUTCOME_VALUES = Object.values(ComplaintResolutionOutcomes);

/** 客户端提交（client 面）。 */
export class SubmitComplaintBodyDto {
  @ApiProperty({ enum: COMPLAINT_CATEGORY_VALUES }) @IsIn(COMPLAINT_CATEGORY_VALUES) category!: ComplaintCategory;
  @ApiProperty() @IsString() @IsNotEmpty() subject!: string;
  @ApiProperty() @IsString() @IsNotEmpty() description!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() relatedOrderNo?: string;
}

/** 确认收悉（admin 面）——确认函文本必填，entries CLIENT_MESSAGE/ACK 落这个值。 */
export class AcknowledgeComplaintBodyDto {
  @ApiProperty() @IsString() @IsNotEmpty() message!: string;
}

/** 内部备注（admin 面）——service.addNote 第三参是裸字符串，DTO 只包一层 body。 */
export class AddNoteBodyDto {
  @ApiProperty() @IsString() @IsNotEmpty() body!: string;
}

/** 延期（admin 面）——强制解释文字（spec 裁定 4）。 */
export class ExtendComplaintBodyDto {
  @ApiProperty() @IsString() @IsNotEmpty() explanation!: string;
}

/** 裁决提案（admin 面，propose-resolution 调 T3 workflow）。 */
export class ResolutionBodyDto {
  @ApiProperty({ enum: COMPLAINT_RESOLUTION_OUTCOME_VALUES }) @IsIn(COMPLAINT_RESOLUTION_OUTCOME_VALUES) outcome!: ComplaintResolutionOutcome;
  @ApiProperty() @IsString() @IsNotEmpty() resolutionText!: string;
}

/** ⚡ 演示装置——拨哪一口钟。 */
export class SimulateTimeoutBodyDto {
  @ApiProperty({ enum: ['ACK', 'RESOLVE'] }) @IsIn(['ACK', 'RESOLVE']) target!: 'ACK' | 'RESOLVE';
}
