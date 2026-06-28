// src/modules/accounting/tigerbeetle/tb-evidence.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { COA_TO_TB_CODE, isAssetCode } from './constants/tb-account-codes.constant';
import { AccountFlowProjectorService } from '../../clearing-settle/reconciliation/projector/account-flow-projector.service';

interface WriteEvidenceParams {
  tbTransferId: string;
  sourceType: string;
  sourceNo: string;
  eventCode: string;
  debitCode: string;
  creditCode: string;
  amount: number | Prisma.Decimal;
  assetCurrency: string;
  traceId: string;
  actorType: string;
  actorId: string;
  memo?: string;
  pendingId?: string;
  transferType?: string;
  debitTbAccountId?: string;
  creditTbAccountId?: string;
  // Phase B per-physical-wallet reconciliation fields (all optional / default null|false):
  //   debit/creditWalletRef → which physical wallet each leg sits on
  //   externalRef           → blockchain txHash / bank statement ref when this leg crosses an external boundary
  //   isExternalCrossing    → true only for legs whose movement actually appears on an external statement
  debitWalletRef?: string | null;
  creditWalletRef?: string | null;
  externalRef?: string | null;
  isExternalCrossing?: boolean;
}

@Injectable()
export class TbEvidenceService {
  private readonly logger = new Logger(TbEvidenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Phase B / T3: project each evidence write into 2 AccountFlow rows so
    // per-wallet drill-down is a single indexed query. The projector is
    // optional — if not injected (unit tests with a partial DI surface) the
    // evidence write still succeeds.
    private readonly flowProjector?: AccountFlowProjectorService,
  ) {}

  async writeEvidence(params: WriteEvidenceParams, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    try {
      const evidenceData = {
        tbTransferId: params.tbTransferId,
        sourceType: params.sourceType,
        sourceNo: params.sourceNo,
        eventCode: params.eventCode,
        debitCode: params.debitCode,
        creditCode: params.creditCode,
        amount: params.amount,
        assetCode: params.assetCurrency,
        traceId: params.traceId,
        actorType: params.actorType,
        actorId: params.actorId,
        memo: params.memo ?? null,
        pendingId: params.pendingId ?? null,
        transferType: params.transferType ?? 'POSTED',
        debitTbAccountId: params.debitTbAccountId ?? null,
        creditTbAccountId: params.creditTbAccountId ?? null,
        debitWalletRef: params.debitWalletRef ?? null,
        creditWalletRef: params.creditWalletRef ?? null,
        externalRef: params.externalRef ?? null,
        isExternalCrossing: params.isExternalCrossing ?? false,
        createdAt: new Date(),
      };
      await (client as any).tbTransferEvidence.create({ data: evidenceData });

      // Phase B / T3: project to AccountFlow on the same client (tx if given)
      // so the 2 flow rows commit atomically with the evidence row.
      if (this.flowProjector) {
        await this.flowProjector.persist(client as any, evidenceData as any);
      }
    } catch (error: any) {
      this.logger.error(`Evidence write failed for transfer ${params.tbTransferId}: ${error.message}`);
      await this.writeToBacklog(params, error.message);
      throw error;
    }
  }

  private async writeToBacklog(params: WriteEvidenceParams, errorMessage: string): Promise<void> {
    try {
      await (this.prisma as any).tbEvidenceBacklog.create({
        data: {
          tbTransferId: params.tbTransferId,
          transferData: JSON.stringify({
            sourceType: params.sourceType,
            sourceNo: params.sourceNo,
            eventCode: params.eventCode,
          }),
          evidenceData: JSON.stringify(params),
          errorMessage,
          status: 'PENDING',
        },
      });
    } catch (backlogError: any) {
      this.logger.error(`CRITICAL: Evidence backlog write also failed for ${params.tbTransferId}: ${backlogError.message}`);
    }
  }

  async updateTransferType(
    tbTransferId: string,
    newTransferType: string,
    postTbTransferId?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const data: any = { transferType: newTransferType };
    if (postTbTransferId) data.pendingId = postTbTransferId;
    await (client as any).tbTransferEvidence.update({
      where: { tbTransferId },
      data,
    });

    // Phase B / T3: re-project so AccountFlow rows reflect the new transferType.
    // Without this, account_flows stays PENDING after a POST/VOID and the
    // wallet's Account Statement page (POSTED-only) silently drops the row.
    // Same idiom as enrichForPost — the re-project is idempotent via upsert.
    if (this.flowProjector) {
      const updated = await (client as any).tbTransferEvidence.findUnique({
        where: { tbTransferId },
      });
      if (updated) {
        await this.flowProjector.persist(client as any, updated);
      }
    }
  }

  /**
   * Phase B: when a pending LOCK transitions to POSTED, the row now represents a
   * real external crossing (e.g. a withdrawal that actually moved on-chain). The
   * caller passes the POST-event eventCode + the Phase B recon fields so the row
   * records the crossing semantics. `postPendingTransfer` itself doesn't write a
   * new evidence row (it only flips transferType), so this is the hook that lets
   * the workflow promote a LOCK row to a POST event without duplicating evidence.
   */
  async enrichForPost(
    tbTransferId: string,
    fields: {
      eventCode?: string;
      memo?: string | null;
      debitWalletRef?: string | null;
      creditWalletRef?: string | null;
      externalRef?: string | null;
      isExternalCrossing?: boolean;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const data: any = {};
    if (fields.eventCode !== undefined) data.eventCode = fields.eventCode;
    if (fields.memo !== undefined) data.memo = fields.memo;
    if (fields.debitWalletRef !== undefined) data.debitWalletRef = fields.debitWalletRef;
    if (fields.creditWalletRef !== undefined) data.creditWalletRef = fields.creditWalletRef;
    if (fields.externalRef !== undefined) data.externalRef = fields.externalRef;
    if (fields.isExternalCrossing !== undefined) data.isExternalCrossing = fields.isExternalCrossing;
    if (Object.keys(data).length === 0) return;
    await (client as any).tbTransferEvidence.update({
      where: { tbTransferId },
      data,
    });

    // Phase B / T3: re-project so AccountFlow rows reflect the enriched fields
    // (eventCode/externalRef/isExternalCrossing/wallet refs). Re-read the row
    // post-update so the projection input is the canonical persisted state.
    if (this.flowProjector) {
      const updated = await (client as any).tbTransferEvidence.findUnique({
        where: { tbTransferId },
      });
      if (updated) {
        await this.flowProjector.persist(client as any, updated);
      }
    }
  }

  async findBySource(sourceType: string, sourceNo: string) {
    return (this.prisma as any).tbTransferEvidence.findMany({
      where: { sourceType, sourceNo },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findByTraceId(traceId: string) {
    return (this.prisma as any).tbTransferEvidence.findMany({
      where: { traceId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(tbTransferId: string) {
    return (this.prisma as any).tbTransferEvidence.findUnique({
      where: { tbTransferId },
    });
  }

  async findAll(filters: {
    sourceType?: string;
    assetCurrency?: string;
    eventCode?: string;
    transferType?: string;
    actorType?: string;
    actorId?: string;
    q?: string;
    coa?: string;
    skip?: number;
    take?: number;
  }) {
    const where: any = {};
    if (filters.sourceType) where.sourceType = filters.sourceType;
    if (filters.assetCurrency) where.assetCode = filters.assetCurrency;
    if (filters.eventCode) where.eventCode = filters.eventCode;
    if (filters.transferType) where.transferType = filters.transferType;
    if (filters.actorType) where.actorType = filters.actorType;
    if (filters.actorId) where.actorId = filters.actorId;

    const and: any[] = [];
    const q = filters.q?.trim();
    if (q) {
      const hex = q.toLowerCase().replace(/^0x/, '');
      and.push({ OR: [
        { tbTransferId: hex },
        { sourceNo: { contains: q } },
        { traceId: { contains: q } },
      ] });
    }
    if (filters.coa) {
      const numeric = COA_TO_TB_CODE[filters.coa];
      and.push({ OR: [
        { debitCode: filters.coa }, { creditCode: filters.coa },
        ...(numeric !== undefined ? [{ debitCode: String(numeric) }, { creditCode: String(numeric) }] : []),
      ] });
    }
    if (and.length > 0) where.AND = and;

    const [items, total] = await Promise.all([
      (this.prisma as any).tbTransferEvidence.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filters.skip ?? 0,
        take: filters.take ?? 50,
      }),
      (this.prisma as any).tbTransferEvidence.count({ where }),
    ]);

    return { items, total };
  }

  async getAccountStatement(
    tbAccountId: string,
    opts: { crossingOnly?: boolean } = {},
  ): Promise<{
    items: Array<{
      tbTransferId: string;
      sourceType: string;
      sourceNo: string;
      eventCode: string;
      direction: 'IN' | 'OUT';
      amount: number;
      runningBalance: number;
      assetCode: string;
      memo: string | null;
      isExternalCrossing: boolean;
      externalRef: string | null;
      createdAt: string;
    }>;
    currentBalance: number;
  }> {
    // Sign convention by account class: assets are DEBIT-normal (a debit = IN/+,
    // balance = debits − credits); liabilities & equity are CREDIT-normal
    // (a credit = IN/+). Without this an asset account shows a negative balance.
    const reg = await (this.prisma as any).tbAccountRegistry.findUnique({
      where: { tbAccountId },
      select: { code: true },
    });
    const isAsset = reg ? isAssetCode(reg.code) : false;

    // tb_transfer_evidence historically stored debit/creditTbAccountId in BOTH
    // 32-char padded ("0886…") and 31-char unpadded ("886…") forms across rows.
    // Match either form so a query with one variant doesn't silently drop the
    // other. (Long term the writer should normalize to 32 chars + backfill.)
    const padId = (id: string) => (id.length < 32 ? id.padStart(32, '0') : id);
    const padded = padId(tbAccountId);
    const unpadded = padded.replace(/^0+/, '') || padded;
    const idVariants = padded === unpadded ? [padded] : [padded, unpadded];

    const where: any = {
      transferType: 'POSTED',
      OR: [
        ...idVariants.map((id) => ({ creditTbAccountId: id })),
        ...idVariants.map((id) => ({ debitTbAccountId: id })),
      ],
    };
    if (opts.crossingOnly) where.isExternalCrossing = true;

    const rows = await (this.prisma as any).tbTransferEvidence.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });

    let balance = 0;
    const idVariantSet = new Set(idVariants);
    const items = rows.map((row: any) => {
      // Side detection must be tolerant to the same padding inconsistency that
      // forced the WHERE clause above — strict equality on tbAccountId fails
      // when the row was stored as 31-char but the caller passes 32-char (or
      // vice versa), which silently flipped every leg to OUT.
      const isCreditSide = idVariantSet.has(row.creditTbAccountId);
      // asset: debit = IN ; liability/equity: credit = IN
      const direction: 'IN' | 'OUT' = isAsset
        ? (isCreditSide ? 'OUT' : 'IN')
        : (isCreditSide ? 'IN' : 'OUT');
      const amount = Number(row.amount);
      balance += direction === 'IN' ? amount : -amount;
      return {
        tbTransferId: row.tbTransferId,
        sourceType: row.sourceType,
        sourceNo: row.sourceNo,
        eventCode: row.eventCode,
        direction,
        amount,
        runningBalance: balance,
        assetCode: row.assetCode,
        memo: row.memo,
        isExternalCrossing: row.isExternalCrossing === true,
        externalRef: row.externalRef ?? null,
        createdAt: row.createdAt,
      };
    });

    return { items, currentBalance: balance };
  }

  /**
   * Phase B / T4: aggregate flow of all account legs landing on a single
   * physical wallet (identified by `walletRef`). For a customer wallet this
   * merges that customer's SUSPENSE + PAYABLE legs naturally — both legs
   * carry the same walletRef per T2a's "same-ref" convention.
   *
   * Filters out aggregate-account legs (e.g. CLIENT_ASSET / FIRM_ASSET) whose
   * registry owner does not match this wallet's owner — those legs share the
   * walletRef purely for traceability, but their balance changes belong to
   * the aggregate book, not to this wallet's view.
   *
   * Reads from the AccountFlow projection (T3) for O(1) indexed lookup.
   */
  async getWalletStatement(
    walletRef: string,
    opts: { crossingOnly?: boolean } = {},
  ): Promise<{
    items: Array<{
      tbTransferId: string;
      tbAccountId: string;
      sourceType: string;
      sourceNo: string;
      eventCode: string;
      direction: 'IN' | 'OUT';
      amount: number;
      runningBalance: number;
      assetCode: string;
      accountCode: number | null;
      isExternalCrossing: boolean;
      externalRef: string | null;
      createdAt: string;
    }>;
    currentBalance: number;
    walletRef: string;
    account: {
      walletRef: string;
      ownerType: string | null;
      ownerNo: string | null;
      ownerName: string | null;
      assetCode: string | null;
    };
    decimals: number;
    assetCurrency: string | null;
    crossingOnly: boolean;
  }> {
    // 1. Resolve the wallet → owner (so we can drop aggregate-account legs that
    //    share the walletRef but don't belong to this wallet's view).
    const wallet = await (this.prisma as any).wallet.findUnique({
      where: { id: walletRef },
      include: { asset: true },
    });

    // 2. Pull AccountFlow rows for this walletRef (POSTED only, optional crossing filter).
    const where: any = { walletRef, transferType: 'POSTED' };
    if (opts.crossingOnly) where.isExternalCrossing = true;
    const flows = await (this.prisma as any).accountFlow.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });

    // 3. Resolve each row's tbAccountId → registry entry. The historical
    //    backfill stores tbAccountId without the leading zero in some rows;
    //    normalize to 32-char left-padded hex before lookup.
    const padId = (id: string) => (id.length < 32 ? id.padStart(32, '0') : id);
    const accountIds = Array.from(
      new Set(flows.map((f: any) => padId(String(f.tbAccountId)))),
    ) as string[];
    const registries = accountIds.length
      ? await (this.prisma as any).tbAccountRegistry.findMany({
          where: { tbAccountId: { in: accountIds } },
        })
      : [];
    const regByPaddedId = new Map<string, any>(
      registries.map((r: any) => [r.tbAccountId, r]),
    );
    const regOf = (id: string) => regByPaddedId.get(padId(String(id))) ?? null;

    // 4. Drop rows whose account belongs to a DIFFERENT owner than this wallet.
    //    Rows with no registry match are kept (we can't disprove ownership).
    const ownerNo = wallet?.ownerNo ?? null;
    const filtered = flows.filter((f: any) => {
      const reg = regOf(f.tbAccountId);
      if (!reg) return true;
      if (!ownerNo) return true;
      // Drop rows that hit a registry entry owned by someone else (the
      // aggregate-account legs are SYSTEM-owned, not this customer).
      if (reg.ownerType === 'CUSTOMER' && reg.ownerNo !== ownerNo) return false;
      // For a customer wallet, drop SYSTEM-owned account legs (CLIENT_ASSET etc).
      if (wallet?.ownerType === 'CUSTOMER' && reg.ownerType === 'SYSTEM') return false;
      return true;
    });

    // 5. Compute class-aware direction and running balance.
    //    The AccountFlow.direction field is set by the projector based on
    //    debit/credit side (not class). For balance arithmetic we need the
    //    class-aware "IN means balance up" view:
    //      asset class (DEBIT-normal): debit side = balance up
    //      L/E class  (CREDIT-normal): credit side = balance up
    //    Translation: for an asset row, flip the projector's direction so the
    //    rendered direction is the user-facing one.
    let balance = 0;
    const items = filtered.map((row: any) => {
      const reg = regOf(row.tbAccountId);
      const code = reg?.code ?? null;
      const isAsset = code != null ? isAssetCode(code) : false;
      // AccountFlow.direction: 'IN' = was on credit side; 'OUT' = was on debit side.
      // For asset accounts we flip to keep "IN = balance up".
      const projDirection = row.direction as 'IN' | 'OUT';
      const direction: 'IN' | 'OUT' = isAsset
        ? (projDirection === 'IN' ? 'OUT' : 'IN')
        : projDirection;
      const amount = Number(row.amount);
      balance += direction === 'IN' ? amount : -amount;
      return {
        tbTransferId: row.tbTransferId,
        tbAccountId: row.tbAccountId,
        sourceType: row.sourceType,
        sourceNo: row.sourceNo,
        eventCode: row.eventCode,
        direction,
        amount,
        runningBalance: balance,
        assetCode: row.assetCode,
        accountCode: code,
        isExternalCrossing: row.isExternalCrossing === true,
        externalRef: row.externalRef ?? null,
        createdAt: row.createdAt,
      };
    });

    // 6. Owner header — prefer the Wallet table; fall back to the most common
    //    registry owner among the rows for defensiveness.
    let ownerType: string | null = wallet?.ownerType ?? null;
    let derivedOwnerNo: string | null = ownerNo;
    let ownerName: string | null = null;
    let assetCode: string | null = wallet?.asset?.currency ?? null;
    if (!ownerType || !derivedOwnerNo) {
      // Fallback: most common (ownerType, ownerNo) among row registry entries.
      const tally = new Map<string, { count: number; reg: any }>();
      for (const f of filtered) {
        const reg = regOf(f.tbAccountId);
        if (!reg) continue;
        const k = `${reg.ownerType}:${reg.ownerNo ?? ''}`;
        const prev = tally.get(k);
        if (prev) prev.count += 1;
        else tally.set(k, { count: 1, reg });
      }
      let topReg: any = null;
      let topCount = 0;
      for (const v of tally.values()) {
        if (v.count > topCount) {
          topCount = v.count;
          topReg = v.reg;
        }
      }
      if (topReg) {
        ownerType = ownerType ?? topReg.ownerType;
        derivedOwnerNo = derivedOwnerNo ?? topReg.ownerNo;
        ownerName = topReg.ownerName ?? null;
        assetCode = assetCode ?? topReg.assetCode ?? null;
      }
    }
    if (!ownerName && derivedOwnerNo) {
      // Resolve customer name from CustomerMain for nicer header labels.
      const cust = await (this.prisma as any).customerMain.findFirst({
        where: { customerNo: derivedOwnerNo },
        select: { firstName: true, lastName: true },
      });
      if (cust) {
        ownerName = [cust.firstName, cust.lastName].filter(Boolean).join(' ') || null;
      }
    }

    // 7. Decimal scaling — assets table by currency.
    let decimals = 6;
    if (assetCode) {
      const asset = await (this.prisma as any).asset.findFirst({
        where: { currency: assetCode, status: 'ACTIVE' },
        select: { decimals: true },
      });
      if (asset?.decimals != null) decimals = asset.decimals;
    }

    return {
      items,
      currentBalance: balance,
      walletRef,
      account: {
        walletRef,
        ownerType,
        ownerNo: derivedOwnerNo,
        ownerName,
        assetCode,
      },
      decimals,
      assetCurrency: assetCode,
      crossingOnly: opts.crossingOnly === true,
    };
  }

  /**
   * Phase B / T4: list distinct walletRefs from account_flows with their owner
   * info (joined via tbAccountRegistry → Wallet). Drives the "Wallets" mode in
   * the Account Statement page's left panel.
   */
  async listWallets(): Promise<Array<{
    walletRef: string;
    ownerType: string | null;
    ownerNo: string | null;
    ownerName: string | null;
    assetCodes: string[];
    walletRole: string | null;
    flowCount: number;
  }>> {
    // 1. Distinct walletRefs + per-ref flow counts.
    const rows = await (this.prisma as any).accountFlow.groupBy({
      by: ['walletRef'],
      where: { walletRef: { not: null } },
      _count: { _all: true },
    });
    const walletRefs: string[] = rows
      .map((r: any) => r.walletRef)
      .filter((x: any): x is string => typeof x === 'string' && x.length > 0);
    if (walletRefs.length === 0) return [];

    // 2. Resolve owners from Wallet table.
    const wallets = await (this.prisma as any).wallet.findMany({
      where: { id: { in: walletRefs } },
      include: { asset: true },
    });
    const walletById = new Map<string, any>(wallets.map((w: any) => [w.id, w]));

    // 3. For each walletRef, gather the set of asset currencies seen in its flows.
    //    (Customer wallets are single-currency; firm wallets too. But we still
    //    aggregate defensively in case a wallet UUID is reused across assets.)
    const flowAssetRows = await (this.prisma as any).accountFlow.groupBy({
      by: ['walletRef', 'assetCode'],
      where: { walletRef: { in: walletRefs } },
    });
    const assetsByWalletRef = new Map<string, Set<string>>();
    for (const r of flowAssetRows as any[]) {
      if (!r.walletRef) continue;
      let s = assetsByWalletRef.get(r.walletRef);
      if (!s) {
        s = new Set();
        assetsByWalletRef.set(r.walletRef, s);
      }
      if (r.assetCode) s.add(r.assetCode);
    }

    // 4. Resolve customer names for CUSTOMER wallets.
    const customerNos = Array.from(
      new Set(
        wallets
          .filter((w: any) => w.ownerType === 'CUSTOMER' && w.ownerNo)
          .map((w: any) => w.ownerNo as string),
      ),
    );
    const customers = customerNos.length
      ? await (this.prisma as any).customerMain.findMany({
          where: { customerNo: { in: customerNos } },
          select: { customerNo: true, firstName: true, lastName: true },
        })
      : [];
    const custNameByNo = new Map<string, string>(
      customers.map((c: any) => [
        c.customerNo,
        [c.firstName, c.lastName].filter(Boolean).join(' '),
      ]),
    );

    const countByRef = new Map<string, number>(
      rows.map((r: any) => [r.walletRef as string, r._count._all as number]),
    );

    return walletRefs
      .map((ref) => {
        const w = walletById.get(ref);
        const assetCodes = Array.from(assetsByWalletRef.get(ref) ?? []).sort();
        const ownerName = w?.ownerType === 'CUSTOMER' && w?.ownerNo
          ? (custNameByNo.get(w.ownerNo) || null)
          : null;
        return {
          walletRef: ref,
          ownerType: w?.ownerType ?? null,
          ownerNo: w?.ownerNo ?? null,
          ownerName,
          assetCodes,
          walletRole: w?.walletRole ?? null,
          flowCount: countByRef.get(ref) ?? 0,
        };
      })
      .sort((a, b) => {
        // CUSTOMER first, then SYSTEM, then unknown; within each by ownerNo.
        const rank = (x: string | null) =>
          x === 'CUSTOMER' ? 0 : x === 'SYSTEM' ? 1 : 2;
        const r = rank(a.ownerType) - rank(b.ownerType);
        if (r !== 0) return r;
        return (a.ownerNo ?? '').localeCompare(b.ownerNo ?? '');
      });
  }

  async findBacklog(filters: {
    status?: string;
    skip?: number;
    take?: number;
  }) {
    const where: any = {};
    if (filters.status) where.status = filters.status;

    const [items, total] = await Promise.all([
      (this.prisma as any).tbEvidenceBacklog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filters.skip ?? 0,
        take: filters.take ?? 50,
      }),
      (this.prisma as any).tbEvidenceBacklog.count({ where }),
    ]);

    return { items, total };
  }
}
