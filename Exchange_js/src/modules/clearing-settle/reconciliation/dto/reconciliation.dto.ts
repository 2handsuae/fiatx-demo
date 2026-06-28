import { IsOptional, IsString } from 'class-validator';
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

// Three-tier per industry "balance first" convention. Balance drives the
// account's headline status; flows are a secondary fraud/omission probe
// catching the "fake match" case (orphans that nett to zero).
export type AccountStatusRowStatus =
  | 'MATCH'         // balance OK AND flows OK — green, done
  | 'FLOW_REVIEW'   // balance OK BUT flow line-items have orphan/mismatch
                    // (the "fake match" probe — net happens to balance,
                    //  but underlying flows broken)
  | 'BREAK';        // balance != external — red, hard break

export interface AccountStatusRow {
  walletRef: string;
  walletNo: string | null;          // business key (e.g. 'WAL-001'); null for XREF synthetic refs
  walletRole?: string | null;       // 'C_DEP' | 'C_VIBAN' | 'F_FEE' | ... — from wallets lookup
  ownerNo?: string | null;          // customer / firm owner number
  ownerName?: string | null;        // first+last name or company name (null for firm)
  asset: string;                    // 'AED' | 'USDT-TRON'
  coaCode: string;                  // 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE' | 'E.FIRM_FEE' | ...
  internal: { balance: string };
  external: { balance: string };
  delta: string;                    // external − internal (string of bigint)
  flowMatched: number;
  flowTotal: number;
  flowOrphanInternal: number;
  flowOrphanExternal: number;
  flowMismatch: number;
  status: AccountStatusRowStatus;
  caseId?: string | null;           // null for MATCH rows
  caseNo?: string | null;           // human-readable case key (null for MATCH)
}

export interface RunDetailSummary {
  accountsChecked: number;
  // Three-tier counts (cockpit Overview uses these three):
  matchCount: number;        // status=MATCH       — balance OK + flows OK
  flowReviewCount: number;   // status=FLOW_REVIEW — balance OK + flow anomaly (fake-match probe)
  breakCount: number;        // status=BREAK       — balance != external (hard break)
  // Backwards-compat per-anomaly tallies (independent of status):
  balanceBreakCount: number; // # accounts with delta != 0
  orphanCount: number;       // # accounts with any flow orphan (internal or external)
  mismatchCount: number;     // # accounts with any flow amount mismatch
}

export type FlowComparisonMatchType =
  | 'MATCHED'
  | 'ORPHAN_EXTERNAL'
  | 'ORPHAN_INTERNAL'
  | 'AMOUNT_MISMATCH';

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
}

export interface FlowComparisonSummary {
  matched: number;
  orphanInternal: number;
  orphanExternal: number;
  mismatch: number;
}
