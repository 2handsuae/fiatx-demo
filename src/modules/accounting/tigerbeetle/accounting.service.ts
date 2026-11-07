// src/modules/accounting/tigerbeetle/accounting.service.ts
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { TigerBeetleService } from './tigerbeetle.service';
import { TbAccountRegistryService } from './tb-account-registry.service';
import { TbEvidenceService } from './tb-evidence.service';
import { deterministicTransferId, bigintToHex, bigintToRegistryHex, hexToBigint } from './utils/tb-id.util';
import { CreateTbAccountParams, EvidenceParams, TbBalanceResult, CustomerAvailableBalance, ExecutePendingTransferParams, PostOrVoidPendingTransferParams } from './types/accounting.types';
import { TB_ACCOUNT_CODES, accountFlagsFor, cashAccountCodeFor } from './constants/tb-account-codes.constant';
import { TB_LEDGERS } from './constants/tb-ledgers.constant';
import { id as tbId, CreateAccountStatus, CreateTransferStatus, TransferFlags } from 'tigerbeetle-node';

@Injectable()
export class AccountingService {
  private readonly logger = new Logger(AccountingService.name);

  constructor(
    private readonly tbService: TigerBeetleService,
    private readonly registryService: TbAccountRegistryService,
    private readonly evidenceService: TbEvidenceService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Account Lifecycle ──

  async createAccounts(paramsList: CreateTbAccountParams[], tx?: Prisma.TransactionClient): Promise<void> {
    // 账本不得为负：未显式给 flags 时按科目类别写（借方户 4 / 贷方户 2，见 accountFlagsFor）。
    // TB 账户与注册表行用同一个值。
    const tbAccounts = paramsList.map((p) => {
      const accountId = tbId();
      return { accountId, params: { ...p, flags: p.flags ?? accountFlagsFor(p.code) } };
    });

    const errors = await this.tbService.createAccounts(
      tbAccounts.map(({ accountId, params }) => ({
        id: accountId,
        debits_pending: 0n,
        credits_pending: 0n,
        debits_posted: 0n,
        credits_posted: 0n,
        user_data_128: params.ownerUuid ? this.uuidToBigint(params.ownerUuid) : 0n,
        user_data_64: 0n,
        user_data_32: params.ownerType === 'SYSTEM' ? 0 : params.ownerType === 'CUSTOMER' ? 1 : params.ownerType === 'WALLET' ? 3 : 2,
        reserved: 0,
        ledger: params.ledger,
        code: params.code,
        flags: params.flags,
        timestamp: 0n,
      })),
    );

    if (errors.length > 0) {
      const realErrors = errors.filter((e: any) =>
        e.status !== CreateAccountStatus.exists && e.status !== CreateAccountStatus.created,
      );
      if (realErrors.length > 0) {
        throw new BadRequestException({
          code: 'TB_ACCOUNT_CREATE_FAILED',
          message: `TigerBeetle account creation failed: ${JSON.stringify(realErrors, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`,
        });
      }
    }

    for (const { accountId, params } of tbAccounts) {
      await this.registryService.register({
        tbAccountId: bigintToRegistryHex(accountId),
        code: params.code,
        ledger: params.ledger,
        ownerType: params.ownerType,
        ownerUuid: params.ownerUuid,
        ownerNo: params.ownerNo,
        assetCurrency: params.assetCurrency,
        description: params.description,
        flags: params.flags,
      }, tx);
    }
  }

  // ── Single Transfer ──

  async executeTransfer(params: {
    debitAccountId: bigint;
    creditAccountId: bigint;
    amount: bigint;
    ledger: number;
    code: number;
    evidence: EvidenceParams;
    tx?: Prisma.TransactionClient;
  }): Promise<{ tbTransferId: bigint }> {
    const transferId = deterministicTransferId(
      params.evidence.sourceType,
      params.evidence.sourceNo,
      params.evidence.eventCode,
      0,
    );

    const errors = await this.tbService.createTransfers([{
      id: transferId,
      debit_account_id: params.debitAccountId,
      credit_account_id: params.creditAccountId,
      amount: params.amount,
      pending_id: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger: params.ledger,
      code: params.code,
      flags: 0,
      timestamp: 0n,
    }]);

    const realErrors = errors.filter((e: any) =>
      e.status !== CreateTransferStatus.exists && e.status !== CreateTransferStatus.created,
    );
    if (realErrors.length > 0) {
      throw new BadRequestException({
        code: 'TB_TRANSFER_FAILED',
        message: `TigerBeetle transfer rejected: ${JSON.stringify(realErrors, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`,
      });
    }

    const alreadyExists = errors.some((e: any) => e.status === CreateTransferStatus.exists);
    if (alreadyExists) {
      // Idempotent replay: this logical transfer (and its evidence row) was fully
      // recorded by the first execution — skip the duplicate evidence write.
      return { tbTransferId: transferId };
    }

    await this.evidenceService.writeEvidence({
      tbTransferId: bigintToHex(transferId),
      sourceType: params.evidence.sourceType,
      sourceNo: params.evidence.sourceNo,
      eventCode: params.evidence.eventCode,
      debitCode: params.evidence.debitCode,
      creditCode: params.evidence.creditCode,
      amount: Number(params.amount),
      assetCurrency: params.evidence.assetCurrency,
      traceId: params.evidence.traceId,
      actorType: params.evidence.actorType,
      actorId: params.evidence.actorId,
      memo: params.evidence.memo,
      transferType: 'POSTED',
      debitTbAccountId: bigintToHex(params.debitAccountId),
      creditTbAccountId: bigintToHex(params.creditAccountId),
      externalRef: params.evidence.externalRef ?? null,
      // 平账回填口透传：不传=writeEvidence 写当天；仅资金单推单链路带值
      effectiveDate: params.evidence.effectiveDate,
    }, params.tx);

    return { tbTransferId: transferId };
  }

  async executePendingTransfer(params: ExecutePendingTransferParams): Promise<{ tbTransferId: bigint }> {
    const transferId = deterministicTransferId(
      params.evidence.sourceType,
      params.evidence.sourceNo,
      params.evidence.eventCode,
      params.legIndex ?? 0,
    );

    const errors = await this.tbService.createTransfers([{
      id: transferId,
      debit_account_id: params.debitAccountId,
      credit_account_id: params.creditAccountId,
      amount: params.amount,
      pending_id: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: params.timeout,
      ledger: params.ledger,
      code: params.code,
      flags: TransferFlags.pending,
      timestamp: 0n,
    }]);

    const realErrors = errors.filter((e: any) =>
      e.status !== CreateTransferStatus.exists && e.status !== CreateTransferStatus.created,
    );
    if (realErrors.length > 0) {
      throw new BadRequestException({
        code: 'TB_PENDING_TRANSFER_FAILED',
        message: `TigerBeetle pending transfer rejected: ${JSON.stringify(realErrors, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`,
      });
    }

    const alreadyExists = errors.some((e: any) => e.status === CreateTransferStatus.exists);
    if (alreadyExists) {
      // Idempotent replay: this logical transfer (and its evidence row) was fully
      // recorded by the first execution — skip the duplicate evidence write.
      return { tbTransferId: transferId };
    }

    await this.evidenceService.writeEvidence({
      tbTransferId: bigintToHex(transferId),
      sourceType: params.evidence.sourceType,
      sourceNo: params.evidence.sourceNo,
      eventCode: params.evidence.eventCode,
      debitCode: params.evidence.debitCode,
      creditCode: params.evidence.creditCode,
      amount: Number(params.amount),
      assetCurrency: params.evidence.assetCurrency,
      traceId: params.evidence.traceId,
      actorType: params.evidence.actorType,
      actorId: params.evidence.actorId,
      memo: params.evidence.memo,
      transferType: 'PENDING',
      debitTbAccountId: bigintToHex(params.debitAccountId),
      creditTbAccountId: bigintToHex(params.creditAccountId),
      externalRef: params.evidence.externalRef ?? null,
      // 平账回填口透传：不传=writeEvidence 写当天；仅资金单推单链路带值
      effectiveDate: params.evidence.effectiveDate,
    }, params.tx);

    return { tbTransferId: transferId };
  }

  async postPendingTransfer(params: PostOrVoidPendingTransferParams): Promise<void> {
    const postId = tbId();

    const errors = await this.tbService.createTransfers([{
      id: postId,
      debit_account_id: 0n,
      credit_account_id: 0n,
      amount: params.amount,
      pending_id: params.pendingTransferId,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger: 0,
      code: 0,
      flags: TransferFlags.post_pending_transfer,
      timestamp: 0n,
    }]);

    const realErrors = errors.filter((e: any) =>
      e.status !== CreateTransferStatus.exists &&
      e.status !== CreateTransferStatus.created &&
      e.status !== CreateTransferStatus.pending_transfer_already_posted,
    );
    if (realErrors.length > 0) {
      throw new BadRequestException({
        code: 'TB_POST_PENDING_FAILED',
        message: `TigerBeetle post pending transfer failed: ${JSON.stringify(realErrors, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`,
      });
    }

    // Idempotent replay: the pending was already posted (e.g. a retry after a
    // transient failure on a sibling leg). The POSTED evidence row already exists
    // from the original post — skip the rewrite so we don't stamp a bogus postId.
    if (errors.some((e: any) => e.status === CreateTransferStatus.pending_transfer_already_posted)) {
      return;
    }

    // Update the original PENDING evidence record → POSTED (not create a new row)
    const originalTbTransferId = bigintToHex(params.pendingTransferId);
    await this.evidenceService.updateTransferType(
      originalTbTransferId,
      'POSTED',
      bigintToHex(postId),
      params.tx,
    );
  }

  async voidPendingTransfer(params: PostOrVoidPendingTransferParams): Promise<void> {
    const voidId = tbId();

    const errors = await this.tbService.createTransfers([{
      id: voidId,
      debit_account_id: 0n,
      credit_account_id: 0n,
      amount: params.amount,
      pending_id: params.pendingTransferId,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger: 0,
      code: 0,
      flags: TransferFlags.void_pending_transfer,
      timestamp: 0n,
    }]);

    const realErrors = errors.filter((e: any) =>
      e.status !== CreateTransferStatus.exists &&
      e.status !== CreateTransferStatus.created &&
      e.status !== CreateTransferStatus.pending_transfer_already_voided,
    );
    if (realErrors.length > 0) {
      throw new BadRequestException({
        code: 'TB_VOID_PENDING_FAILED',
        message: `TigerBeetle void pending transfer failed: ${JSON.stringify(realErrors, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`,
      });
    }

    // Idempotent replay: the pending was already voided — the VOIDED evidence row
    // already exists from the original void; skip the rewrite (bogus voidId).
    if (errors.some((e: any) => e.status === CreateTransferStatus.pending_transfer_already_voided)) {
      return;
    }

    // Update the original PENDING evidence record → VOIDED (not create a new row)
    const originalTbTransferId = bigintToHex(params.pendingTransferId);
    await this.evidenceService.updateTransferType(
      originalTbTransferId,
      'VOIDED',
      bigintToHex(voidId),
      params.tx,
    );
  }

  /**
   * Best-effort void of a pending transfer — used for compensation when a
   * Prisma transaction rolls back but TB transfers have already been created.
   * Skips evidence update (the evidence was rolled back with the Prisma tx).
   * Returns true if the void succeeded, false otherwise.
   */
  async voidPendingTransferBestEffort(pendingTransferId: bigint, amount: bigint): Promise<boolean> {
    try {
      const voidId = tbId();
      const errors = await this.tbService.createTransfers([{
        id: voidId,
        debit_account_id: 0n,
        credit_account_id: 0n,
        amount,
        pending_id: pendingTransferId,
        user_data_128: 0n,
        user_data_64: 0n,
        user_data_32: 0,
        timeout: 0,
        ledger: 0,
        code: 0,
        flags: TransferFlags.void_pending_transfer,
        timestamp: 0n,
      }]);
      const realErrors = errors.filter((e: any) =>
        e.status !== CreateTransferStatus.exists && e.status !== CreateTransferStatus.created,
      );
      if (realErrors.length > 0) {
        this.logger.error(`Best-effort void failed for ${pendingTransferId}: ${JSON.stringify(realErrors, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`);
        return false;
      }
      return true;
    } catch (err: any) {
      this.logger.error(`Best-effort void threw for ${pendingTransferId}: ${err.message}`);
      return false;
    }
  }

  // ── Balance Queries ──

  async lookupBalance(tbAccountId: bigint): Promise<TbBalanceResult> {
    const accounts = await this.tbService.lookupAccounts([tbAccountId]);
    if (accounts.length === 0) {
      throw new NotFoundException({
        code: 'TB_ACCOUNT_NOT_FOUND',
        message: `TigerBeetle account ${tbAccountId} not found`,
      });
    }
    const a = accounts[0];
    return {
      debitsPosted: a.debits_posted,
      creditsPosted: a.credits_posted,
      debitsPending: a.debits_pending,
      creditsPending: a.credits_pending,
    };
  }

  async getCustomerAvailableBalance(customerUuid: string, assetCurrency: string): Promise<CustomerAvailableBalance> {
    const ledger = TB_LEDGERS[assetCurrency as keyof typeof TB_LEDGERS];
    if (!ledger) {
      throw new BadRequestException(`Unsupported asset currency for balance query: ${assetCurrency}`);
    }

    const tbAccountId = await this.resolveTbAccountId({
      code: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
      ledger,
      ownerType: 'CUSTOMER',
      ownerUuid: customerUuid,
    });

    const balance = await this.lookupBalance(tbAccountId);
    const total = balance.creditsPosted - balance.debitsPosted;
    const available = total - balance.debitsPending;
    const held = balance.debitsPending;

    return { available, held, total };
  }

  // ── Account Resolution ──

  async resolveTbAccountId(
    params: {
      code: number;
      ledger: number;
      ownerType: string;
      ownerUuid?: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<bigint> {
    const entry = await this.registryService.resolve(params, tx);
    if (!entry) {
      throw new NotFoundException({
        code: 'TB_ACCOUNT_REGISTRY_NOT_FOUND',
        message: `No TB account found for code=${params.code} ledger=${params.ledger} ownerType=${params.ownerType} ownerUuid=${params.ownerUuid}`,
      });
    }
    return hexToBigint(entry.tbAccountId);
  }

  /**
   * 钱包现金户解析 —— 全仓记账调用点取「钱包的现金户」的唯一入口（戊波一 §2.2）。
   * 读钱包行：CUSTOMER → 1 客户现金，PLATFORM → 50 公司现金；再按 (code, ledger, 'WALLET', walletId) 查注册表。
   * 钱包不存在、或没到 ACTIVE（没开户）→ 抛 NotFoundException，不回落到任何别的户（记账失败 = 流程失败，铁律⑤）。
   */
  async resolveCashAccountId(walletId: string, ledger: number, tx?: Prisma.TransactionClient): Promise<bigint> {
    const db = tx ?? this.prisma;
    const wallet = await db.wallet.findUnique({ where: { id: walletId }, select: { ownerType: true } });
    if (!wallet) {
      throw new NotFoundException({
        code: 'WALLET_NOT_FOUND',
        message: `Wallet ${walletId} not found — cannot resolve its cash account`,
      });
    }
    const code = cashAccountCodeFor(wallet.ownerType);
    return this.resolveTbAccountId({ code, ledger, ownerType: 'WALLET', ownerUuid: walletId }, tx);
  }

  /**
   * 钱包现金户可用额 —— 「可用 = 借已过账 − 贷已过账 − 贷挂起」这条算式在全仓的唯一一份（戊波二 T7a 从 assertWalletBalance 里提出）。
   * 读该钱包的现金户（借方户，经 resolveCashAccountId 取，不回落别的户）；出款挂起是贷方挂起，借挂起是待入账，不可花、不抬高可用。
   * 公司钱包的出款余额闸（assertWalletBalance）与客户钱包的「认损前余量」复查（认损补缺单：待批提现的锁定是贷方挂起，
   * TB 判「贷不得超借」把它算在内）共用它，只是各自的话术与错误码不同。
   */
  async getWalletCashAvailable(walletId: string, ledger: number): Promise<bigint> {
    const cashId = await this.resolveCashAccountId(walletId, ledger);
    const bal = await this.lookupBalance(cashId);
    return bal.debitsPosted - bal.creditsPosted - bal.creditsPending;
  }

  /**
   * 钱包余额闸 —— 公司侧出款类单据（划转 / 付款 / LP 兑换，戊波二起加调拨）共用的唯一一份（戊波二 T3）。
   * 可用额（getWalletCashAvailable）≥ 金额（最小单位）。
   * 不够 → 400 INSUFFICIENT_FIRM_BALANCE（话术带币种 / 钱包号 / 可用 / 需要，铁律⑥：不带 UUID）。
   * 调用方决定「查哪只钱包」；划转 / 付款 / 调拨读单上人选的 from 钱包，LP 兑换恒是 F_OPS。
   */
  async assertWalletBalance(walletId: string, ledger: number, amountMinor: bigint): Promise<void> {
    const available = await this.getWalletCashAvailable(walletId, ledger);
    if (available >= amountMinor) return;
    const wallet = await this.prisma.wallet.findUnique({ where: { id: walletId }, select: { walletNo: true } });
    const currency = Object.entries(TB_LEDGERS).find(([, id]) => id === ledger)?.[0] ?? `ledger ${ledger}`;
    throw new BadRequestException({
      code: 'INSUFFICIENT_FIRM_BALANCE',
      message: `Insufficient ${currency} balance in wallet ${wallet?.walletNo ?? '-'} (available ${available.toString()}, need ${amountMinor.toString()}, smallest unit) — the firm cannot pay out funds it does not have`,
    });
  }

  // ── Helpers ──

  private uuidToBigint(uuid: string): bigint {
    const hex = uuid.replace(/-/g, '');
    // Standard UUID hex is exactly 32 hex chars; fall back to 0 for non-standard values
    if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
      return 0n;
    }
    return BigInt('0x' + hex);
  }
}
