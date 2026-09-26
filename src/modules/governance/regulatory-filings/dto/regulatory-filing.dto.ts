// 战役甲波二 · 报送台骨架（Task 5）：HTTP 层 DTO。校验只做既有惯例的必填/类型，
// 外加评审携带项两条服务层刻意没做的校验（见各字段旁注）——不加其余防御性校验
// （CLAUDE.md §2）。照 incident.dto.ts 风格。
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { FILING_TYPE_REGISTRY } from '../filing-type-registry';
import { FilingEntryKinds, RegulatoryAuthorities } from '../regulatory-filing.constants';

const FILING_TYPE_VALUES = Object.keys(FILING_TYPE_REGISTRY);
const REGULATORY_AUTHORITY_VALUES = Object.keys(RegulatoryAuthorities);
const FILING_ENTRY_KIND_VALUES = Object.values(FilingEntryKinds);

export class OpenFilingBodyDto {
  @ApiProperty({ enum: FILING_TYPE_VALUES }) @IsIn(FILING_TYPE_VALUES) type!: string;
  @ApiPropertyOptional({ enum: REGULATORY_AUTHORITY_VALUES }) @IsOptional() @IsIn(REGULATORY_AUTHORITY_VALUES) authority?: string;
  // 评审携带项②：逐值校验 ∈ RegulatoryAuthorities 键集——service 层的 openManual 对
  // ccAuthorities 只做 join(',') 落库，不校验成员合法性。
  @ApiPropertyOptional({ type: [String], enum: REGULATORY_AUTHORITY_VALUES })
  @IsOptional() @IsArray() @IsIn(REGULATORY_AUTHORITY_VALUES, { each: true }) ccAuthorities?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() incidentNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() basisCode?: string;
  // 评审携带项①：手工开单必填（spec）——service 层缺省时会落类型 label，DTO 层拦住
  // 手工开单不给 title 的情况。
  @ApiProperty() @IsString() @IsNotEmpty() title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() receivedAt?: string;
  // 战役甲波三 T3：外部案件/名单条目引用（Sumsub 案件号或 EOCN 名单条目号）——
  // requiresExternalCaseRef 类型（STR/SAR/CNMR/PNMR）在 service 层缺失即 400，
  // 本字段 DTO 层只做类型/非空校验，是否必填留给 service（因类型而异，不在此穷举）。
  @ApiPropertyOptional() @IsOptional() @IsString() externalCaseRef?: string;
}

export class SaveFilingDraftDto {
  @ApiProperty() @IsString() @IsNotEmpty() body!: string;
}

export class MarkFilingSubmittedBodyDto {
  @ApiProperty() @IsString() @IsNotEmpty() externalRef!: string;
}

export class FilingEntryBodyDto {
  @ApiProperty({ enum: FILING_ENTRY_KIND_VALUES }) @IsIn(FILING_ENTRY_KIND_VALUES) kind!: string;
  @ApiProperty() @IsString() @IsNotEmpty() body!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() externalRef?: string;
  // 战役甲波三 T5（spec §5）：CUSTOMER_COMM 专属必填字段（拟稿人自由文本，MLRO 代录）；
  // DTO 层只做类型/非空校验，「哪些 kind 必填/禁填」这道真闸在 service 层
  // FILING_ENTRY_KIND_RULES 查表判（因 kind 而异，DTO 层不穷举）。
  @ApiPropertyOptional() @IsOptional() @IsString() commDraftedBy?: string;
}

export class CancelFilingDto {
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}

export class CloseFilingDto {
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

// 战役甲波三 T3：「决定不报」结案——noFilingReason 必填闸（DTO 层 + service 层双闸，
// service 层是真闸：DTO 校验只挡空字符串/非字符串，service 侧仍会再判一次)。
export class CloseNoFilingDto {
  @ApiProperty() @IsString() @IsNotEmpty() noFilingReason!: string;
}

// 只带 service.list() 实际消费的三个筛选键——不预铸 skip/take（service 层未支持分页，
// 加了也只是死字段，CLAUDE.md §12 不为想象中的未来写代码）。
export class FilingListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional({ enum: FILING_TYPE_VALUES }) @IsOptional() @IsIn(FILING_TYPE_VALUES) type?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() incidentNo?: string;
}
