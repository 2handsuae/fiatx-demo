// src/modules/accounting/tigerbeetle/accounting.service.ts
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TigerBeetleService } from './tigerbeetle.service';
import { TbAccountRegistryService } from './tb-account-registry.service';
import { TbEvidenceService } from './tb-evidence.service';
import { deterministicTransferId, bigintToHex, hexToBigint } from './utils/tb-id.util';
import { CreateTbAccountParams, EvidenceParams, TbBalanceResult, CustomerAvailableBalance, ExecutePendingTransferParams, PostOrVoidPendingTransferParams } from './types/accounting.types';
import { TB_ACCOUNT_CODES } from './constants/tb-account-codes.constant';
import { TB_LEDGERS } from './constants/tb-ledgers.constant';
import { id as tbId, CreateAccountStatus, CreateTransferStatus, TransferFlags } from 'tigerbeetle-node';

@Injectable()
export class AccountingService {
  private readonly logger = new Logger(AccountingService.name);

  constructor(
    private readonly tbService: TigerBeetleService,
    private readonly registryService: TbAccountRegistryService,
    private readonly evidenceService: TbEvidenceService,
  ) {}

  // ── Account Lifecycle ──

  async createAccounts(paramsList: CreateTbAccountParams[], tx?: Prisma.TransactionClient): Promise<void> {
    const tbAccounts = paramsList.map((p) => {
      const accountId = tbId();
      return { accountId, params: p };
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
        user_data_32: params.ownerType === 'SYSTEM' ? 0 : params.ownerType === 'CUSTOMER' ? 1 : 2,
        reserved: 0,
        ledger: params.ledger,
        code: params.code,
        flags: params.flags ?? 0,
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
        tbAccountId: bigintToHex(accountId),
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
      // Phase B forwarding: per-physical-wallet refs + external crossing flag (all optional)
      debitWalletRef: params.evidence.debitWalletRef ?? null,
      creditWalletRef: params.evidence.creditWalletRef ?? null,
      externalRef: params.evidence.externalRef ?? null,
      isExternalCrossing: params.evidence.isExternalCrossing ?? false,
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
      // Phase B forwarding: per-physical-wallet refs + external crossing flag (all optional)
      debitWalletRef: params.evidence.debitWalletRef ?? null,
      creditWalletRef: params.evidence.creditWalletRef ?? null,
      externalRef: params.evidence.externalRef ?? null,
      isExternalCrossing: params.evidence.isExternalCrossing ?? false,
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
      e.status !== CreateTransferStatus.exists && e.status !== CreateTransferStatus.created,
    );
    if (realErrors.length > 0) {
      throw new BadRequestException({
        code: 'TB_POST_PENDING_FAILED',
        message: `TigerBeetle post pending transfer failed: ${JSON.stringify(realErrors, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`,
      });
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
      e.status !== CreateTransferStatus.exists && e.status !== CreateTransferStatus.created,
    );
    if (realErrors.length > 0) {
      throw new BadRequestException({
        code: 'TB_VOID_PENDING_FAILED',
        message: `TigerBeetle void pending transfer failed: ${JSON.stringify(realErrors, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`,
      });
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

  async resolveTbAccountId(params: {
    code: number;
    ledger: number;
    ownerType: string;
    ownerUuid?: string;
  }): Promise<bigint> {
    const entry = await this.registryService.resolve(params);
    if (!entry) {
      throw new NotFoundException({
        code: 'TB_ACCOUNT_REGISTRY_NOT_FOUND',
        message: `No TB account found for code=${params.code} ledger=${params.ledger} ownerType=${params.ownerType} ownerUuid=${params.ownerUuid}`,
      });
    }
    return hexToBigint(entry.tbAccountId);
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
