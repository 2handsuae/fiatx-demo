import { IsIn, IsOptional, IsString } from 'class-validator';
export class ReconRunQueryDto {
  @IsOptional() @IsString() businessDate?: string;
  @IsOptional() @IsString() layer?: string;
}
export class ReconCaseQueryDto {
  // T3 cockpit default: when status is omitted the list is filtered to OPEN
  // (the cockpit screen only shows actionable cases). Pass status='ALL' to opt
  // out of the default and see every status.
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() assetCode?: string;
  @IsOptional() @IsString() runNo?: string;  // filter to cases touched by a specific run
  // T6: filter by five-bucket classification (Round3) — IN_TRANSIT | SOFT_FLAG | BREAK.
  @IsOptional() @IsIn(['IN_TRANSIT', 'SOFT_FLAG', 'BREAK']) bucket?: string;
}
export class ReconExternalBalanceQueryDto {
  @IsOptional() @IsString() cutoffDate?: string;
  @IsOptional() @IsString() book?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() currency?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// T3 response shapes — surfaced to admin cockpit UI (T4–T6).
// These are pure response types (no validation needed); kept here so the
// frontend codegen has a single source of truth alongside the query DTOs.
// All numeric fields are serialised as strings to dodge JSON BigInt issues.
// ─────────────────────────────────────────────────────────────────────────────

// Round3 five-bucket classification (T4 bucket-classifier). MATCHED doesn't
// open a Case; the other three do. Replaces the old three-tier
// MATCH/FLOW_REVIEW/BREAK status (T6 — getRun now reads the run-wallet
// snapshot table instead of recomputing via the balance checker).
export type ReconWalletBucket = 'MATCHED' | 'IN_TRANSIT' | 'SOFT_FLAG' | 'BREAK';

export interface AccountStatusRow {
  walletRef: string;
  walletNo: string | null;          // business key (e.g. 'WAL-001'); null for XREF synthetic refs
  walletRole?: string | null;       // 'C_DEP' | 'C_VIBAN' | 'F_FEE' | ... — from wallets lookup
  ownerNo?: string | null;          // customer / firm owner number
  ownerName?: string | null;        // first+last name or company name (null for firm)
  asset: string;                    // 'AED' | 'USDT-TRON'
  decimals: number;                 // asset.decimals — display layer scales 分→元 by 10^decimals
  book: string;                     // CUSTOMER | FIRM
  coaCode: string | null;           // 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE' | 'E.INCOME_SWAP_FEE+E.INCOME_WITHDRAW_FEE+E.INCOME_OTHER' | ...
  internal: { balance: string };
  external: { balance: string };
  delta: string;                    // external − internal
  inTransitAmount: string;          // signed sum of in-transit lines (IN +, OUT −)
  flowMatched: number;
  flowTotal: number;
  flowOrphanInternal: number;
  flowOrphanExternal: number;
  flowMismatch: number;
  inTransitCount: number;
  bucket: ReconWalletBucket;
  caseId?: string | null;           // null for MATCHED rows
  caseNo?: string | null;           // human-readable case key (null for MATCHED)
}

export interface RunDetailSummary {
  // Round3 five-bucket wallet counts, taken straight from the run row
  // (ReconciliationRun.walletCount/matchedCount/inTransitCount/softFlagCount/
  // breakCount) — no per-wallet recompute.
  walletCount: number;
  matchedCount: number;
  inTransitCount: number;
  softFlagCount: number;
  breakCount: number;
  // Case lifecycle triple (from the run row): opened/re-observed/closed this run.
  openedCount: number;
  reObservedCount: number;
  closedCount: number;
}

export interface ReconRunDetail {
  accountStatusTable: AccountStatusRow[];
  summary: RunDetailSummary;
  // T6: true when this run predates the reconciliation_run_wallets snapshot
  // table (no snapshot rows exist) — accountStatusTable is empty and the UI
  // should show a "legacy run, no per-wallet detail" notice instead of an
  // empty-state "all clear".
  legacy?: boolean;
  [key: string]: unknown;
}

// T6: case-level residual explanation — how delta decomposes into the
// in-transit-explained portion vs what's left over (the bucket-classifier's
// residual = delta − inTransitSigned; see engine/v2/bucket-classifier.ts).
export interface CaseExplain {
  internalTotal: string;
  externalClosing: string;
  delta: string;
  inTransitSigned: string;
  residual: string;
}

// T6: observation history — when this case was first/last seen, how many
// times it's been re-observed across reruns, and (if resolved) which run
// closed it.
export interface CaseObservation {
  firstSeenRunNo: string | null;
  firstSeenAt: string | null;       // ISO — firstSeenRun.startedAt
  lastObservedRunNo: string | null;
  reObservedCount: number;
  closedByRunNo: string | null;     // null unless status=RESOLVED
  ageDays: number | null;           // null unless status=OPEN
}

export type FlowComparisonMatchType =
  | 'MATCHED'
  | 'ORPHAN_EXTERNAL'
  | 'ORPHAN_INTERNAL'
  | 'AMOUNT_MISMATCH'
  | 'IN_TRANSIT';        // T6: sourced from the case's persisted IN_TRANSIT line items

export interface FlowComparisonExternalSide {
  id?: string;
  externalRef: string | null;
  amount: string;
  direction: 'IN' | 'OUT';
  timestamp: string;                // ISO
  description?: string | null;
}

export interface FlowComparisonInternalSide {
  id?: string;
  externalRef: string | null;
  amount: string;
  direction: 'IN' | 'OUT';
  timestamp: string;                // ISO (account_flows.createdAt)
  eventCode: string;
  sourceType: string;
  sourceNo: string;
}

export interface FlowComparisonRow {
  externalLine: FlowComparisonExternalSide | null;
  internalFlow: FlowComparisonInternalSide | null;
  matchType: FlowComparisonMatchType;
  deltaAmount?: string;             // only for AMOUNT_MISMATCH
  fundsOrderNo?: string | null;     // only for IN_TRANSIT — the explaining funds order
  fundsOrderStatus?: string | null; // T4: current status of the explaining funds order
                                    // (IN_TRANSIT only) — CLEARED here + case OPEN means
                                    // "已推进·待重对账": a rerun will close the case.
}

export interface FlowComparisonSummary {
  matched: number;
  orphanInternal: number;
  orphanExternal: number;
  mismatch: number;
}
