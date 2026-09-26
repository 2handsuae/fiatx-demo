import { ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import {
  RESTRICTION_CAUSE_POLICY,
  RestrictionCause,
  RestrictionScope,
} from '../constants/restriction-cause.constant';

/** 合法 cause 直接从策略表取键，避免第二份枚举漂移 */
const RESTRICTION_CAUSE_VALUES = Object.keys(RESTRICTION_CAUSE_POLICY) as RestrictionCause[];
const RESTRICTION_SCOPE_VALUES: RestrictionScope[] = ['ALL', 'DEPOSIT', 'WITHDRAW', 'SWAP'];

/**
 * 建限制入参。刻意**不含** visibility / releasePolicy —— 这两个由
 * RESTRICTION_CAUSE_POLICY[cause] 派生，调用方传了就是 400
 * （靠控制器上的 forbidNonWhitelisted 管子拦，不靠这里）。
 */
export class OpenRestrictionDto {
  @IsIn(RESTRICTION_CAUSE_VALUES)
  cause!: RestrictionCause;

  /** 仅 scopeSelectable=true 的 cause（今天只有 PENDING_DOCUMENT）接受；其余传了即 400 */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(RESTRICTION_SCOPE_VALUES, { each: true })
  scopes?: RestrictionScope[];

  @IsString()
  @MinLength(1)
  reason!: string;

  @IsOptional()
  @IsString()
  caseRef?: string;
}

export class ReleaseRestrictionDto {
  @IsString()
  @MinLength(1)
  reason!: string;

  /** releasePolicy=MLRO_APPROVAL 时必填，缺失 400 —— 该校验在 workflow.initiateRelease 里做 */
  @IsOptional()
  @IsString()
  releaseOrderRef?: string;
}

/** 战役甲波三 T4：制裁定性提单入参（spec §4）——outcome 三选一由合规官定，
 * MLRO 单步批；summary/externalCaseRef 校验在此，前置存在性校验（该客户须有 OPEN
 * 的 SANCTION 便签）在 workflow.initiateDisposition 里做。 */
export class SanctionDispositionDto {
  @IsIn(['CLEARED', 'PARTIAL', 'CONFIRMED'])
  outcome!: 'CLEARED' | 'PARTIAL' | 'CONFIRMED';

  @IsString()
  @MinLength(1)
  summary!: string;

  /** EOCN 名单条目引用——PNMR/CNMR 开单必填（复用 T3 的 requiresExternalCaseRef 口径）。 */
  @IsString()
  @MinLength(1)
  externalCaseRef!: string;
}
