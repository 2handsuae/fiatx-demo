// 战役乙波一 T2：LP 档案 DTO/投影/状态枚举。
// 甲波六 T4：档案即「LP 申请表」——六态、申请字段、实际控制人多值；实体背调三列与「理由」独立字段退役
// （理由并入 applicationReason，审计的 reason 取它）。
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsDateString, IsInt, IsNotEmpty, IsNumberString, IsOptional, IsString, ValidateNested } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** 六态（甲波六 spec §4.4）：先评估后审批——出生即待评估；退回补料 / 不通过 / 送审由合规官下结论驱动；
 *  启停是收紧/放松动作，不设门。 */
export enum LpProfileStatus {
  PENDING_ASSESSMENT = 'PENDING_ASSESSMENT',
  RETURNED = 'RETURNED',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  REJECTED = 'REJECTED',
}

/** 实际控制人一行：seq 是申请表内的稳定序号（筛查记录按「seq + 姓名」指认某一位），国籍选填。 */
export class BeneficialOwnerDto {
  @ApiProperty() @IsInt() seq!: number;
  @ApiProperty() @Transform(trim) @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nationality?: string;
}

/** 金库提交的 LP 申请表（spec §4.1）。六份文件不在 body 里——档案建好后逐份走 documents 端点上传。 */
export class CreateLpProfileDto {
  @ApiProperty({ description: 'Legal name' }) @IsString() @IsNotEmpty() name!: string;
  @ApiProperty({ description: 'Country / jurisdiction of registration' }) @IsString() @IsNotEmpty() registeredIn!: string;
  @ApiProperty() @IsString() @IsNotEmpty() registrationNo!: string;
  @ApiProperty() @IsString() @IsNotEmpty() licensingAuthority!: string;
  @ApiProperty() @IsString() @IsNotEmpty() licenceNo!: string;
  @ApiPropertyOptional({ type: [BeneficialOwnerDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => BeneficialOwnerDto) beneficialOwners?: BeneficialOwnerDto[];
  @ApiProperty({ type: [String], description: 'What they will do with us (spot exchange, OTC block, …) — pick at least one' })
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) tradingTypes!: string[];
  @ApiProperty({ description: 'Expected monthly volume, plain decimal string' }) @IsNumberString() expectedMonthlyVolume!: string;
  @ApiProperty() @IsString() @IsNotEmpty() volumeCurrency!: string;
  @ApiProperty() @IsString() @IsNotEmpty() applicationReason!: string;
  @ApiProperty() @IsString() @IsNotEmpty() agreementRef!: string;
  @ApiPropertyOptional({ description: 'Agreement start date (ISO date)' }) @IsOptional() @IsDateString() agreementStart?: string;
  @ApiProperty() @IsString() @IsNotEmpty() contactName!: string;
  @ApiProperty() @IsString() @IsNotEmpty() contactEmail!: string;
}

/** 被退回后金库改申请重提：整张表单覆盖，字段与首次申请一致。 */
export class ResubmitLpProfileDto extends CreateLpProfileDto {}

/** 启停（战役乙波一 T3）：直接迁移 + 审计，不建审批——reason 供 LP_PROFILE_SUSPENDED /
 *  LP_PROFILE_REACTIVATED 契约（均 requiredFields:['reason']）。 */
export class SuspendLpProfileDto {
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}
export class ReactivateLpProfileDto {
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}

/** 对外投影（铁律⑥）：无 id；实际控制人解析成数组、交易类型拆成数组、预计月交易量是普通小数串。 */
export interface LpProfileView {
  lpNo: string;
  name: string;
  registeredIn: string;
  registrationNo: string;
  licensingAuthority: string;
  licenceNo: string;
  beneficialOwners: Array<{ seq: number; name: string; nationality?: string }>;
  tradingTypes: string[];
  expectedMonthlyVolume: string;
  volumeCurrency: string;
  applicationReason: string;
  agreementRef: string;
  /** ISO 时间串（表单传 YYYY-MM-DD 时为当日 UTC 零点）；没填为 null。 */
  agreementStart: string | null;
  contactName: string;
  contactEmail: string;
  status: string;
  approvalNo: string | null;
  createdBy: string;
  createdAt: string;
}
