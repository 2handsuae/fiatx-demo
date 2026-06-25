// DEAD (real-time 1:1 model) — neutered in Phase A, delete in Phase C
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface InvariantViolation { invariant: string; currency: string; detail: string; }
export interface EodAccountingReport {
  sweeps: Array<{ currency: string; amountUnits: string; direction: 'OUT' | 'IN' }>;
  revals: Array<{ currency: string; fixing: string; deltaUnits: string; direction: 'LOSS' | 'GAIN' }>;
  violations: InvariantViolation[];
}

const DEPRECATED =
  'deprecated: replaced by real-time 1:1 model (Phase A); slated for removal in Phase C';

/**
 * DEAD: legacy two-book EOD accounting (bridge sweep + FX revaluation + LP
 * realize over FX_POSITION / TRADE_CLEARING / FX_*_PNL). Fully replaced by the
 * real-time 1:1 model in Phase A — there is no bridge, no FX position book, and
 * no EOD revaluation. Public signatures retained so legacy callers compile;
 * service + wiring deleted in Phase C.
 */
@Injectable()
export class FxEodService {
  private readonly logger = new Logger(FxEodService.name);

  async runEodAccounting(_batchNo: string): Promise<EodAccountingReport> {
    throw new Error(DEPRECATED);
  }

  async runSweepOnly(_batchNo: string): Promise<EodAccountingReport> {
    throw new Error(DEPRECATED);
  }

  async runReval(_batchNo: string): Promise<EodAccountingReport> {
    throw new Error(DEPRECATED);
  }

  async sweepBridges(_batchNo: string, _report: EodAccountingReport): Promise<void> {
    throw new Error(DEPRECATED);
  }

  async revalueFxPositions(_batchNo: string, _report: EodAccountingReport): Promise<void> {
    throw new Error(DEPRECATED);
  }

  async realizeFxPosition(_input: {
    currency: string;
    fillRate: Prisma.Decimal;
    operatorId: string;
  }): Promise<void> {
    throw new Error(DEPRECATED);
  }

  async checkInvariants(_report: EodAccountingReport): Promise<void> {
    throw new Error(DEPRECATED);
  }
}
