import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { assertNetwork } from '../../../config/manifests/networks.manifest';
import {
  AuditActions,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditOutcome } from '../../audit-logging/dto/audit-log.dto';
import { CustomerAccessService } from '../../identity/customers/customer-access.service';
import { DepositTransactionsService } from './deposit-transactions.service';
import { FundsOrderService } from '../../funds-orders/funds-order.service';
import {
  FundsOrderAction,
  FundsOrderStatus,
} from '../../funds-orders/dto/funds-order.dto';
import {
  InboundTransferScanMode,
  CreateInboundTransferSignalDto,
  InboundTransferChannelType,
  InboundTransferSignalQueryDto,
  InboundTransferSignalStatus,
  ScanInboundTransferSignalsDto,
  SimulationRiskLevel,
  SimulationRiskReason,
} from './dto/inbound-transfer-signal.dto';
// WalletRole 的导入随 main（V3 波一 T5）删除 getCustomerDepositWalletOrThrow 一并退役——
// 钱包解析改按（网络, 地址|IBAN）走 resolveDepositWalletOrThrow，不再按 walletRole 判归属。
// AuditOutcome 已在上方随 main 的 resolveAssetOrReject 一并导入，此处不重复。
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import { SupplementEvidenceService } from '../../clearing-settle/reconciliation/disposition/supplement-evidence.service';
import { DispositionService as ReconDispositionService } from '../../clearing-settle/reconciliation/disposition/disposition.service';
import type { CauseCode } from '../../clearing-settle/reconciliation/disposition/cause-registry';

export interface ScanSummaryRecord {
  signalId: string;
  signalNo: string;
  payinId: string | null;
  payinNo: string | null;
  payinStatus: string | null;
  depositId: string | null;
  depositNo: string | null;
  depositStatus: string | null;
}

export interface ScanSummary {
  scannedCount: number;
  createdPayinCount: number;
  reusedPayinCount: number;
  blockedCount: number;
  failedCount: number;
  depositIds: string[];
  records: ScanSummaryRecord[];
}

@Injectable()
export class InboundTransferSignalsService {
  private readonly logger = new Logger(InboundTransferSignalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly depositService: DepositTransactionsService,
    private readonly fundsOrderService: FundsOrderService,
    private readonly customerAccess: CustomerAccessService,
    private readonly auditLogsService: AuditLogsService,
    private readonly approvalsService: ApprovalsService,
    private readonly supplementEvidence: SupplementEvidenceService,
    private readonly reconDisposition: ReconDispositionService,
  ) {}

  async findAllForCustomer(
    customerId: string,
    query: InboundTransferSignalQueryDto,
  ) {
    const where: Record<string, unknown> = {
      ownerId: customerId,
    };

    if (query.network) where.wallet = { network: query.network };
    if (query.status) where.status = query.status;

    const [items, total] = await Promise.all([
      (this.prisma as any).inboundTransferSignal.findMany({
        where,
        skip: query.skip ?? 0,
        take: query.take ?? 20,
        orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
        include: {
          asset: {
            select: {
              id: true,
              code: true,
              type: true,
              network: true,
              decimals: true,
            },
          },
          wallet: {
            select: {
              id: true,
              address: true,
              iban: true,
              walletNo: true,
              network: true,
              vaultCode: true,
              walletRole: true,
            },
          },
        },
      }),
      (this.prisma as any).inboundTransferSignal.count({ where }),
    ]);

    return { items, total };
  }

  async createForCustomer(
    customerId: string,
    dto: CreateInboundTransferSignalDto,
  ) {
    await this.customerAccess.assertTradingEligibility(customerId, 'DEPOSIT');
    const customer = await (this.prisma as any).customerMain.findUnique({
      where: { id: customerId },
    });
    const { wallet, network } = await this.resolveDepositWalletOrThrow(customerId, dto);
    const asset = await this.resolveAssetOrReject(customer, network, dto);
    const channelType = network.kind === 'CHAIN' ? InboundTransferChannelType.CRYPTO : InboundTransferChannelType.FIAT;

    if (channelType === InboundTransferChannelType.CRYPTO) {
      if (!dto.txHash || !dto.fromAddress) {
        throw new BadRequestException(
          'Crypto inbound signal requires txHash and fromAddress',
        );
      }
    } else if (!dto.referenceNo || !dto.fromIban) {
      throw new BadRequestException(
        'Fiat inbound signal requires referenceNo and fromIban',
      );
    }

    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(new Prisma.Decimal(0))) {
      throw new BadRequestException('Inbound signal amount must be greater than 0');
    }

    this.assertSimulationRiskProfile(dto, channelType);

    const isCrypto = asset.type === 'CRYPTO';
    if (isCrypto && dto.counterpartyIsVasp == null) {
      throw new BadRequestException('counterpartyIsVasp is required for crypto deposits');
    }
    if (!isCrypto && dto.counterpartyIsVasp != null) {
      throw new BadRequestException('counterpartyIsVasp must not be provided for fiat deposits');
    }

    const dedupeKey = this.buildDedupeKey({
      channelType,
      walletId: wallet.id,
      assetId: asset.id,
      txHash: dto.txHash,
      referenceNo: dto.referenceNo,
    });

    const existing = await (this.prisma as any).inboundTransferSignal.findUnique({
      where: { dedupeKey },
      include: {
        asset: {
          select: { id: true, code: true, type: true, network: true, decimals: true },
        },
        wallet: {
          select: {
            id: true,
            address: true,
            iban: true,
            walletNo: true,
            network: true,
            vaultCode: true,
            walletRole: true,
          },
        },
      },
    });
    if (existing) return existing;

    try {
      const created = await (this.prisma as any).inboundTransferSignal.create({
        data: {
          signalNo: generateReferenceNo('SIG'),
          ownerId: customerId,
          walletId: wallet.id,
          assetId: asset.id,
          channelType,
          amount,
          txHash: dto.txHash,
          referenceNo: dto.referenceNo,
          fromAddress: dto.fromAddress,
          fromIban: dto.fromIban,
          simulationRiskLevel: dto.simulationRiskLevel || null,
          simulationRiskReason: dto.simulationRiskReason || null,
          counterpartyIsVasp: dto.counterpartyIsVasp ?? null,
          status: InboundTransferSignalStatus.PENDING_SCAN,
          dedupeKey,
          submittedAt: new Date(),
        },
      });

      await this.recordSignalAudit({
        action: AuditActions.INBOUND_SIGNAL_SUBMITTED,
        signal: created,
        reason: 'Customer submitted inbound transfer signal',

        metadata: {
          signalId: created.id,
          walletId: created.walletId,
          assetId: created.assetId,
          ownerId: created.ownerId,
        },
        sourcePlatform: 'CUSTOMER_API',
      });

      return (this.prisma as any).inboundTransferSignal.findUnique({
        where: { id: created.id },
        include: {
          asset: {
            select: { id: true, code: true, type: true, network: true, decimals: true },
          },
          wallet: {
            select: {
              id: true,
              address: true,
              iban: true,
              walletNo: true,
              network: true,
              vaultCode: true,
              walletRole: true,
            },
          },
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return (this.prisma as any).inboundTransferSignal.findUnique({
          where: { dedupeKey },
        });
      }
      throw error;
    }
  }

  /**
   * 写端翻转（Task 3）：补单三路共用的原子入口——已有定性（dispositionNo）照旧直通；
   * 无定性但带了 causeCode+findingNote 则先落一条 outlet=SUPPLEMENT 的定性再往下走；
   * 两者都没有则 400（错误话术照旧径：assertClaimable 随后会因锚不到定性行而拒，
   * 这里提前给一句更直白的话，不等它绕一圈才报错）。matchType 固定 ORPHAN_EXTERNAL——
   * 补单三路要认领的向来是「外有我无」的账单行，方向复核交给下面 assertClaimable
   * （DIRECTION_BY_KIND），record() 自己的矩阵/成因校验不重复判方向。
   */
  private async resolveDispositionNo(
    dto: { caseNo: string; externalLineId: string; dispositionNo?: string; causeCode?: CauseCode; findingNote?: string },
    actor: ApprovalActorContext,
  ): Promise<string> {
    if (dto.dispositionNo) return dto.dispositionNo;
    if (!dto.causeCode || !dto.findingNote) {
      throw new BadRequestException('A finding must already be recorded for this statement line (dispositionNo), or provide causeCode + findingNote to record one now');
    }
    const recorded = await this.reconDisposition.record({
      caseNo: dto.caseNo, explainedExternalLineId: dto.externalLineId,
      matchType: 'ORPHAN_EXTERNAL', causeCode: dto.causeCode, disposition: 'SUPPLEMENT', findingNote: dto.findingNote,
    }, actor);
    return recorded.dispositionNo;
  }

  // ═══ 平账 B 批 ①：运营凭账单行补录（spec §3）═══════════════════════════════
  // 与 createForCustomer 的区别：① 不做 assertTradingEligibility——那是拦客户「发起」的，
  // 钱已经物理进了，该冻该退由充值域自己的闸决定；② 金额 / 币种 / 钱包 / 参考号全从账单行来，
  // 运营只补来源地址或来源 IBAN；③ 先挂「待复核」，CFO 批了才进通道。
  //
  // 与 V3 波一新钱包/资产解析模型的关系（2026-09-04 合并 main 时判定）：客户自助那条路
  // （createForCustomer）要靠 resolveDepositWalletOrThrow 按（网络, 地址|IBAN）反查钱包、
  // 靠 resolveAssetOrReject 按（网络, 合约）反查资产，合约对不上就当诈骗币/未上架币拒收——
  // 因为那条路的钱包与资产是**客户自己报的**，必须反查校验。补录这条路不经过这两个解析器，
  // 也不该经过：它的钱包与资产由**对账案子**锁定（assertClaimable 返回的 ClaimableLine 直接
  // 带 walletId / assetId / assetType / currency / decimals，其中资产取自案子的 assetId、
  // 并已在 SupplementEvidenceService#loadLine 里跟账单行币种逐字核对过）。证据来源比客户
  // 自报强一级，再跑一遍按合约反查反而是拿弱证据覆盖强证据。
  //
  // 顺带：Wallet 表在波一 T5 已砍掉 assetId 列与 asset 关联（钱包按 vault × network × 归属人
  // 开地址行，一个地址行不再绑死单一资产），所以本路径一律不从 wallet 取资产，只从案子取。
  async initiateSupplement(
    dto: {
      externalLineId: string; caseNo: string; dispositionNo?: string;
      // 写端翻转（Task 3）：行未定性时的原子入口——带上 causeCode+findingNote，先
      // record(outlet=SUPPLEMENT) 落一条定性，再照常走认领；已带 dispositionNo（标准
      // 两步流程：先 POST .../dispositions）照常直通下面的 assertClaimable。
      causeCode?: CauseCode; findingNote?: string;
      fromAddress?: string; fromIban?: string; reason: string;
    },
    actor: ApprovalActorContext,
  ): Promise<{ signalNo: string; approvalNo: string; status: 'SUPPLEMENT_PENDING' }> {
    const dispositionNo = await this.resolveDispositionNo(dto, actor);
    const line = await this.supplementEvidence.assertClaimable({ caseNo: dto.caseNo, externalLineId: dto.externalLineId, dispositionNo, kind: 'SUPPLEMENT_DEPOSIT' });
    const isCrypto = line.assetType === 'CRYPTO';
    if (isCrypto && !dto.fromAddress?.trim()) throw new BadRequestException('On-chain supplement requires a source address');
    if (!isCrypto && !dto.fromIban?.trim()) throw new BadRequestException('Fiat supplement requires a source IBAN');
    if (!line.externalRef) throw new BadRequestException('This statement line has no reference number — after supplement it cannot be matched back in reconciliation; add the reference number on the statement side first');
    const channelType = isCrypto ? InboundTransferChannelType.CRYPTO : InboundTransferChannelType.FIAT;
    const dedupeKey = this.buildDedupeKey({ channelType, walletId: line.walletId, assetId: line.assetId, txHash: isCrypto ? line.externalRef : undefined, referenceNo: isCrypto ? undefined : line.externalRef });
    // spec §2.2：拒绝 / 超时 / 撤回后可再次发起（下方 processSignal 失败分支落的也是
    // 这个态，不止 CFO 这三种决定会到这里）——supplementOfExternalLineId 是
    // @unique 且从不清空（见 SupplementEvidenceService#assertUnclaimed 的同款注释），
    // 上面 assertClaimable 已经过 assertUnclaimed 放行，能走到这里、又查到一条已存在
    // 的信号，那条信号必然是 SUPPLEMENT_REJECTED（其余状态 assertUnclaimed 会先拒）。
    // 复用同一行而不是新建：新建会同时撞 supplementOfExternalLineId 与 dedupeKey 两个
    // @unique 列，后者会抛裸 P2002 变 500；复用也是语义正确的——这条信号本来就是
    // "这次补录申请"的记录本身，被拒后重提是同一次申请的再提交，不是幂等/去重机制。
    const existing = await (this.prisma as any).inboundTransferSignal.findFirst({ where: { supplementOfExternalLineId: line.externalLineId } });
    const created = existing
      ? await (this.prisma as any).inboundTransferSignal.update({
          where: { id: existing.id },
          data: {
            status: InboundTransferSignalStatus.SUPPLEMENT_PENDING,
            fromAddress: dto.fromAddress ?? null, fromIban: dto.fromIban ?? null,
            supplementReconCaseNo: line.caseNo, supplementDispositionNo: line.dispositionNo,
            supplementEffectiveDate: line.businessDate,
          },
        })
      : await (this.prisma as any).inboundTransferSignal.create({
          data: {
            signalNo: generateReferenceNo('SIG'),
            ownerId: line.ownerId, walletId: line.walletId, assetId: line.assetId, channelType,
            amount: new Prisma.Decimal(line.amountMajor),
            txHash: isCrypto ? line.externalRef : null, referenceNo: isCrypto ? null : line.externalRef,
            fromAddress: dto.fromAddress ?? null, fromIban: dto.fromIban ?? null,
            counterpartyIsVasp: isCrypto ? false : null,
            status: InboundTransferSignalStatus.SUPPLEMENT_PENDING, dedupeKey, submittedAt: new Date(),
            supplementOfExternalLineId: line.externalLineId, supplementReconCaseNo: line.caseNo,
            supplementDispositionNo: line.dispositionNo, supplementEffectiveDate: line.businessDate,
          },
        });
    const traceId = randomUUID();
    const impact = `Supplement ${line.ownerNo ?? line.ownerId}'s ${line.amountMajor} ${line.currency} deposit (case ${line.caseNo}, statement line ${line.externalRef}) — the deposit order will go through KYT and compliance gates as usual`;
    const approvalCase = await this.approvalsService.createAndSubmit(
      { actionType: ApprovalActionTypes.DEPOSIT_SUPPLEMENT, entityRef: created.signalNo, traceId,
        objectSnapshot: { signalNo: created.signalNo, caseNo: line.caseNo, dispositionNo: line.dispositionNo, externalLineId: line.externalLineId,
          externalRef: line.externalRef, walletNo: line.walletNo, customerNo: line.ownerNo, amount: line.amountMajor, currency: line.currency, impact } },
      { reason: dto.reason, traceId }, actor,
    );
    await this.reconDisposition.linkSupplement(line.dispositionNo!, created.signalNo, 'SUPPLEMENT_DEPOSIT');
    await this.auditLogsService.recordByActor({
      action: AuditActions.DEPOSIT_SUPPLEMENT_REQUESTED, actionDomain: 'DEPOSIT',
      primarySubjectType: AuditEntityTypes.INBOUND_TRANSFER_SIGNAL, primarySubjectNo: created.signalNo,
      ownerCustomerNo: line.ownerNo ?? undefined,
      subjects: [
        { subjectType: AuditEntityTypes.INBOUND_TRANSFER_SIGNAL, subjectNo: created.signalNo, subjectRole: 'PRIMARY' },
        { subjectType: AuditEntityTypes.RECONCILIATION_CASE, subjectNo: line.caseNo, subjectRole: 'RELATED' },
        { subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: approvalCase.approvalNo, subjectRole: 'INSTRUMENT' },
      ],
      reason: dto.reason, approvalNo: approvalCase.approvalNo,
      requestId: `DEPOSIT_SUPPLEMENT_REQUESTED_${created.signalNo}_${randomUUID()}`,
      metadata: { caseNo: line.caseNo, dispositionNo: line.dispositionNo, externalLineId: line.externalLineId, externalRef: line.externalRef, amount: line.amountMajor, currency: line.currency },
      sourcePlatform: 'ADMIN_API',
    } as any, { actorType: 'ADMIN', actorNo: actor.userNo ?? actor.userId ?? 'ADMIN', actorDisplayName: actor.userNo ?? actor.userId ?? 'ADMIN', actorRolesAtTime: actor.roleCodes ?? [] });
    return { signalNo: created.signalNo, approvalNo: approvalCase.approvalNo, status: 'SUPPLEMENT_PENDING' };
  }

  @OnEvent('workflow.deposit-supplement.decided', { async: true })
  async onSupplementDecided(event: ApprovalDecidedEvent) {
    // 合并 main（V3 波一 T5）后 Wallet 已无 asset 关联，原来的
    // `wallet: { include: { asset: true } }` 会抛 PrismaClientValidationError；
    // 这里本来也没人读 signal.wallet.asset——processSignal 的 wallet 形参全程不被读
    // （单据要的 assetId / walletId 都直接取自 signal 自己的列），资产真要用时读
    // signal.asset（InboundTransferSignal 的 asset 关联仍在）。故只留 wallet 本身。
    const signal = await (this.prisma as any).inboundTransferSignal.findUnique({ where: { signalNo: event.entityRef }, include: { wallet: true, asset: true } });
    if (!signal) return; // entityRef 不是我们的主体
    if (signal.status !== InboundTransferSignalStatus.SUPPLEMENT_PENDING) {
      this.logger.warn(`Supplement ${signal.signalNo} decided ${event.decision} but status is ${signal.status} — ignored`);
      return;
    }
    if (event.decision !== 'APPROVED') {
      await (this.prisma as any).inboundTransferSignal.update({ where: { id: signal.id }, data: { status: InboundTransferSignalStatus.SUPPLEMENT_REJECTED, scanResult: `Supplement ${event.decision} (${event.approvalNo})` } });
      if (signal.supplementDispositionNo) await this.reconDisposition.unlinkSupplement(signal.supplementDispositionNo, signal.signalNo);
      await this.recordSignalAudit({ action: AuditActions.DEPOSIT_SUPPLEMENT_REJECTED, signal, reason: `Supplement approval ${event.decision}: ${event.decisionReason ?? ''}`, approvalNo: event.approvalNo, metadata: { approvalNo: event.approvalNo, decision: event.decision }, sourcePlatform: 'SYSTEM' });
      return;
    }
    // 评审 Important 1（1）：这里不再把信号先翻 PENDING_SCAN 才调 processSignal。
    // processSignal()（下方 ~L500 一带的 inboundTransferSignal.update）在自己成功收尾时
    // 会无条件把信号写成 PAYIN_CREATED，不依赖调用方预先把状态摆在 PENDING_SCAN——它内部
    // 从不读 signal.status。若这里先翻 PENDING_SCAN 再调 processSignal，一旦 processSignal
    // 中途抛错，信号会卡在 PENDING_SCAN；而 scanForCustomer() 查询的正是这个状态，客户下
    // 一次自助扫描会把这条本该走 CFO 通道的信号误捡走，走的是不带 opts.effectiveDate 的
    // 调用点——「生效日=案子业务日」这条硬规矩当场失守且无人知晓。信号在 processSignal
    // 成功前继续停在 SUPPLEMENT_PENDING，自助扫描（只捡 PENDING_SCAN）天然捞不到它。
    await this.recordSignalAudit({ action: AuditActions.DEPOSIT_SUPPLEMENT_STARTED, signal, reason: 'CFO approved the supplement — signal enters the normal deposit channel', approvalNo: event.approvalNo, metadata: { approvalNo: event.approvalNo, caseNo: signal.supplementReconCaseNo }, sourcePlatform: 'SYSTEM' });
    let result: { depositNo: string | null; [key: string]: unknown };
    try {
      result = await this.processSignal(signal, signal.wallet, InboundTransferScanMode.QUICK_DEMO, { effectiveDate: signal.supplementEffectiveDate ?? undefined });
    } catch (err) {
      // 评审 Important 1（2）：失败也要留终态痕，形状照抄 deposit-workflow.service.ts
      // onPayinFailed/onPayinConfirmed 对同类失败的处理——复用既有里程碑码 + outcome:
      // FAILED + reasonCode（该文件 reasonCode:'PAYIN_FAILED' 的既有值），不新铸码。这不是
      // 重试/补偿（禁做清单内）——只是把这次尝试的真实结局写下来，把挂着的定性单解开
      // （不让它悬空指向一个已死的信号），信号本身按「未成功」收口到既有的 REJECTED 态
      // （与 CFO 明确拒绝共用同一个终态值，靠审计的 outcome/reasonCode 区分成因）。
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(`Supplement ${signal.signalNo} processSignal failed: ${error.message}`);
      await (this.prisma as any).inboundTransferSignal.update({ where: { id: signal.id }, data: { status: InboundTransferSignalStatus.SUPPLEMENT_REJECTED, scanResult: `Supplement processing failed: ${error.message}` } });
      if (signal.supplementDispositionNo) await this.reconDisposition.unlinkSupplement(signal.supplementDispositionNo, signal.signalNo);
      await this.recordSignalAudit({ action: AuditActions.DEPOSIT_SUPPLEMENT_REJECTED, signal, reason: `Supplement processing failed: ${error.message}`, approvalNo: event.approvalNo, outcome: AuditOutcome.FAILED, reasonCode: 'PAYIN_FAILED', metadata: { approvalNo: event.approvalNo, caseNo: signal.supplementReconCaseNo, error: error.message }, sourcePlatform: 'SYSTEM' });
      return;
    }
    // deposit 在 processSignal() 内部是无条件重读赋值（没有分支跳过它），depositNo 是
    // schema 里 NOT NULL 的唯一列——非抛出路径下 result.depositNo 结构上不可能是空值，
    // 这里不再对它做运行时防空判断；supplementDispositionNo 是真的可空列（Task 1
    // schema 里 `String?`），继续判它来决定要不要回挂改写／落进审计（评审 Minor：统一
    // 掉此前两行不一致的假设——一行防了 depositNo、下一行又假设它必然存在）。
    const depositNo = result.depositNo;
    if (signal.supplementDispositionNo) {
      await this.reconDisposition.replaceSupplement(signal.supplementDispositionNo, signal.signalNo, depositNo as string);
    }
    await this.recordSignalAudit({ action: AuditActions.DEPOSIT_SUPPLEMENTED, signal, reason: 'Supplement completed: deposit order created, proceeding through normal KYT / compliance', approvalNo: event.approvalNo, depositNo: depositNo as string, metadata: { depositNo, caseNo: signal.supplementReconCaseNo, effectiveDate: signal.supplementEffectiveDate }, sourcePlatform: 'SYSTEM' });
  }

  async scanForCustomer(
    customerId: string,
    dto: ScanInboundTransferSignalsDto,
  ): Promise<ScanSummary> {
    const { wallet } = await this.resolveDepositWalletOrThrow(customerId, dto);
    const signals = await (this.prisma as any).inboundTransferSignal.findMany({
      where: {
        ownerId: customerId,
        walletId: wallet.id,
        status: InboundTransferSignalStatus.PENDING_SCAN,
      },
      orderBy: [{ submittedAt: 'asc' }, { createdAt: 'asc' }],
    });

    const summary: ScanSummary = {
      scannedCount: 0,
      createdPayinCount: 0,
      reusedPayinCount: 0,
      blockedCount: 0,
      failedCount: 0,
      depositIds: [],
      records: [],
    };
    const depositIds = new Set<string>();

    let tradingGateError: unknown = null;
    try {
      await this.customerAccess.assertTradingEligibility(customerId, 'DEPOSIT');
    } catch (error) {
      tradingGateError = error;
    }

    for (const signal of signals) {
      summary.scannedCount += 1;

      await this.recordSignalAudit({
        action: AuditActions.INBOUND_SIGNAL_SCANNED,
        signal,
        reason: 'Customer triggered inbound transfer scan',

        metadata: {
          signalId: signal.id,
          walletId: signal.walletId,
          assetId: signal.assetId,
          ownerId: signal.ownerId,
        },
        sourcePlatform: 'CUSTOMER_API',
      });

      if (tradingGateError) {
        const blockedReason = this.describeError(tradingGateError);
        await this.markSignalIgnored(signal, blockedReason);
        summary.blockedCount += 1;
        continue;
      }

      try {
        const processed = await this.processSignal(
          signal,
          wallet,
          dto.mode || InboundTransferScanMode.QUICK_DEMO,
        );
        if (processed.createdPayin) {
          summary.createdPayinCount += 1;
        } else {
          summary.reusedPayinCount += 1;
        }
        if (processed.depositId) {
          depositIds.add(processed.depositId);
        }
        summary.records.push({
          signalId: signal.id,
          signalNo: signal.signalNo,
          payinId: processed.payinId,
          payinNo: processed.payinNo,
          payinStatus: processed.payinStatus,
          depositId: processed.depositId,
          depositNo: processed.depositNo,
          depositStatus: processed.depositStatus,
        });
      } catch (error) {
        const failureReason = this.describeError(error);
        this.logger.warn(
          `Failed scanning inbound transfer signal ${signal.id}: ${failureReason}`,
        );
        await (this.prisma as any).inboundTransferSignal.update({
          where: { id: signal.id },
          data: {
            status: InboundTransferSignalStatus.FAILED,
            scanResult: failureReason,
          },
        });
        await this.recordSignalAudit({
          action: AuditActions.INBOUND_SIGNAL_FAILED,
          signal,
          reason: failureReason,
  
          metadata: {
            signalId: signal.id,
            walletId: signal.walletId,
            assetId: signal.assetId,
            ownerId: signal.ownerId,
          },
          sourcePlatform: 'CUSTOMER_API',
        });
        summary.failedCount += 1;
      }
    }

    summary.depositIds = Array.from(depositIds);
    return summary;
  }

  private async processSignal(
    signal: any,
    wallet: any,
    mode: InboundTransferScanMode = InboundTransferScanMode.QUICK_DEMO,
    opts?: { effectiveDate?: string },
  ) {
    const existing = await this.resolveExistingDeposit(signal);
    const createdDeposit = !existing;

    let deposit: any;
    let fundsOrder: any;
    if (existing) {
      deposit = existing.deposit;
      fundsOrder = existing.fundsOrder;
    } else {
      const detected = await this.depositService.detected({
        assetId: signal.assetId,
        toWalletId: signal.walletId,
        amount: signal.amount.toString(),
        txHash: signal.txHash || undefined,
        fromAddress: signal.fromAddress || undefined,
        fromIban: signal.fromIban || undefined,
        referenceNo: signal.referenceNo || undefined,
        providerTxnId: signal.id,
        counterpartyIsVasp: signal.counterpartyIsVasp,
        effectiveDate: opts?.effectiveDate,
      });
      deposit = detected.deposit;
      fundsOrder = detected.fundsOrder;
    }

    // QUICK_DEMO advances the funds_order to CLEARED (crypto needs the two-hop
    // OBSERVE_CONFIRMING → CONFIRM; fiat is CONFIRMED-at-birth and auto-driven by
    // the workflow's funds_order.status.changed handler). INTERACTIVE stops at the
    // freshly-created funds_order so an operator can drive it manually.
    if (mode !== InboundTransferScanMode.INTERACTIVE && fundsOrder) {
      fundsOrder = await this.advanceFundsOrder(fundsOrder.id, signal.channelType, opts?.effectiveDate);
    }
    // Re-read the deposit after driving so its status reflects the workflow.
    deposit = await this.findDeposit(deposit.id);

    await (this.prisma as any).inboundTransferSignal.update({
      where: { id: signal.id },
      data: {
        status: InboundTransferSignalStatus.PAYIN_CREATED,
        scanResult: deposit
          ? `Matched to funds order ${fundsOrder?.fundsOrderNo} and deposit ${deposit.depositNo}`
          : `Matched to funds order ${fundsOrder?.fundsOrderNo}`,
      },
    });

    await this.recordSignalAudit({
      action: AuditActions.INBOUND_SIGNAL_MATCHED,
      signal,
      reason: createdDeposit
        ? 'Inbound transfer signal created new deposit'
        : 'Inbound transfer signal reused existing deposit',
      metadata: {
        signalId: signal.id,
        walletId: signal.walletId,
        assetId: signal.assetId,
        ownerId: signal.ownerId,
        fundsOrderId: fundsOrder?.id || null,
        depositId: deposit?.id || null,
      },
      sourcePlatform: 'CUSTOMER_API',
    });

    if (
      String(fundsOrder?.status || '').toUpperCase() === FundsOrderStatus.FAILED
    ) {
      throw new BadRequestException(`Funds order ${fundsOrder.id} is FAILED`);
    }

    return {
      createdPayin: createdDeposit,
      payinId: fundsOrder?.id || null,
      payinNo: fundsOrder?.fundsOrderNo || null,
      payinStatus: fundsOrder?.status || null,
      depositId: deposit?.id || null,
      depositNo: deposit?.depositNo || null,
      // 复审 Critical 2（规则 A，tipping-off 防线）：这个 summary 是
      // POST /deposit-transactions/my/inbound-signals/scan 的响应体，直接
      // 到客户浏览器。`deposit` 是驱动后重读拿到的真实行，`deposit.status`
      // 未经收敛就可能是 FROZEN/SEIZED/… 原始值——绕开了
      // DepositTransactionsService#toCustomerDepositView 那道收敛防线。
      // 复用同一个判据（DepositTransactionsService#toCustomerStatus），
      // 不再写第二份状态清单。
      depositStatus: deposit ? this.depositService.toCustomerStatus(deposit.status) : null,
    };
  }

  /**
   * Dedup a re-scanned signal to its already-created deposit (+ payin funds_order).
   * A funds_order carries the signal id in providerTxnId (set on detected()), so
   * that is the primary key; fall back to wallet + txHash / referenceNo for signals
   * created before providerTxnId was recorded.
   */
  private async resolveExistingDeposit(
    signal: any,
  ): Promise<{ deposit: any; fundsOrder: any } | null> {
    const byProviderTxnId = await (this.prisma as any).fundsOrder.findFirst({
      where: { providerTxnId: signal.id, depositTransactionId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    if (byProviderTxnId) {
      return this.hydrateDepositFundsOrder(byProviderTxnId);
    }

    const walletMatch =
      signal.channelType === InboundTransferChannelType.CRYPTO && signal.txHash
        ? { toWalletId: signal.walletId, txHash: signal.txHash }
        : signal.channelType === InboundTransferChannelType.FIAT &&
            signal.referenceNo
          ? { toWalletId: signal.walletId, referenceNo: signal.referenceNo }
          : null;
    if (walletMatch) {
      const byWallet = await (this.prisma as any).fundsOrder.findFirst({
        where: { ...walletMatch, depositTransactionId: { not: null } },
        orderBy: { createdAt: 'desc' },
      });
      if (byWallet) return this.hydrateDepositFundsOrder(byWallet);
    }

    return null;
  }

  private async hydrateDepositFundsOrder(fundsOrder: any) {
    const deposit = await this.findDeposit(fundsOrder.depositTransactionId);
    return { deposit, fundsOrder };
  }

  /**
   * Drive a payin funds_order to CLEARED. Crypto is born SUBMITTED and needs
   * OBSERVE_CONFIRMING → CONFIRM; fiat is born CONFIRMED. In both cases the
   * workflow's funds_order.status.changed handler carries the order the rest of the
   * way (CONFIRMED → CLEAR), so we advance only as far as the inbound scan owns.
   */
  private async advanceFundsOrder(
    fundsOrderId: string,
    channelType: InboundTransferChannelType,
    effectiveDate?: string,
  ) {
    let current = await this.fundsOrderService.findById(fundsOrderId);
    if (!current) {
      throw new NotFoundException(`Funds order not found: ${fundsOrderId}`);
    }

    if (
      channelType === InboundTransferChannelType.CRYPTO &&
      current.status === FundsOrderStatus.SUBMITTED
    ) {
      await this.fundsOrderService.advance(
        fundsOrderId,
        FundsOrderAction.OBSERVE_CONFIRMING,
        'SYSTEM',
      );
      current = await this.fundsOrderService.findById(fundsOrderId);
    }

    if (current?.status === FundsOrderStatus.CONFIRMING) {
      await this.fundsOrderService.advance(
        fundsOrderId,
        FundsOrderAction.CONFIRM,
        'SYSTEM',
        undefined,
        effectiveDate ? { effectiveDate } : undefined,
      );
      current = await this.fundsOrderService.findById(fundsOrderId);
    }

    if (!current) {
      throw new NotFoundException(
        `Funds order not found after update: ${fundsOrderId}`,
      );
    }

    return current;
  }

  private async findDeposit(depositId: string) {
    return (this.prisma as any).depositTransaction.findUnique({
      where: { id: depositId },
    });
  }

  /** 钥匙①：（网络, 地址 | IBAN）→ 本客户在该网络上的收款行 */
  private async resolveDepositWalletOrThrow(
    customerId: string,
    dto: { network: string; toAddress?: string; iban?: string },
  ) {
    const network = assertNetwork(dto.network);
    const destination = network.kind === 'CHAIN' ? dto.toAddress : dto.iban;
    if (!destination) {
      throw new BadRequestException(
        network.kind === 'CHAIN' ? 'toAddress is required for chain deposits' : 'iban is required for bank-rail deposits',
      );
    }
    const wallet = await (this.prisma as any).wallet.findFirst({
      where: {
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        vaultCode: 'CLIENT_DEPOSIT',
        network: network.code,
        ...(network.kind === 'CHAIN' ? { address: destination } : { iban: destination }),
      },
    });
    if (!wallet) {
      throw new NotFoundException({ code: 'DEPOSIT_WALLET_NOT_FOUND', message: `No deposit address on ${network.code} matches ${destination}` });
    }
    if (wallet.status !== 'ACTIVE') throw new BadRequestException('Deposit wallet must be ACTIVE');
    return { wallet, network };
  }

  /** 钥匙②：（网络, 合约地址）→ 资产；对不上就是诈骗币 / 未上架币，拒收并留痕 */
  private async resolveAssetOrReject(
    customer: { customerNo: string } | null,
    network: { code: string },
    dto: { contractAddress?: string; toAddress?: string; iban?: string; txHash?: string; referenceNo?: string; amount: string },
  ) {
    const contractAddress = dto.contractAddress?.trim() || null;
    const asset = await (this.prisma as any).asset.findFirst({ where: { network: network.code, contractAddress } });
    if (asset) return asset;
    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_SIGNAL_REJECTED,
      actionDomain: 'DEPOSIT',
      primarySubjectType: AuditEntityTypes.INBOUND_TRANSFER_SIGNAL,
      ownerCustomerNo: customer?.customerNo,
      outcome: AuditOutcome.DENIED,
      reasonCode: 'UNKNOWN_ASSET',
      reason: `No asset on ${network.code} with contract ${contractAddress ?? '(native)'}`,
      metadata: { network: network.code, contractAddress, toAddress: dto.toAddress ?? null, iban: dto.iban ?? null, txHash: dto.txHash ?? null, referenceNo: dto.referenceNo ?? null, amount: dto.amount },
      requestId: `DEPOSIT_SIGNAL_REJECTED_${randomUUID()}`,
      sourcePlatform: 'CUSTOMER_API',
    } as any);
    throw new BadRequestException({ code: 'UNKNOWN_ASSET', message: `No asset on ${network.code} with contract ${contractAddress ?? '(native)'}` });
  }

  private buildDedupeKey(input: {
    channelType: InboundTransferChannelType;
    walletId: string;
    assetId: string;
    txHash?: string;
    referenceNo?: string;
  }) {
    const uniquePart =
      input.channelType === InboundTransferChannelType.CRYPTO
        ? this.normalizeToken(input.txHash)
        : this.normalizeToken(input.referenceNo);
    if (!uniquePart) {
      throw new BadRequestException('Inbound signal dedupe identifier is required');
    }

    return [
      input.channelType,
      this.normalizeToken(input.walletId),
      this.normalizeToken(input.assetId),
      uniquePart,
    ].join(':');
  }

  private normalizeToken(value?: string | null) {
    return String(value || '').trim().toLowerCase();
  }

  private assertSimulationRiskProfile(
    dto: CreateInboundTransferSignalDto,
    channelType: InboundTransferChannelType,
  ) {
    const level = String(dto.simulationRiskLevel || '').trim().toUpperCase();
    const reason = String(dto.simulationRiskReason || '').trim().toUpperCase();

    if (!level) {
      return;
    }

    if (level === SimulationRiskLevel.LOW) {
      if (reason) {
        throw new BadRequestException('LOW simulation risk does not accept a reason.');
      }
      return;
    }

    if (level === SimulationRiskLevel.MEDIUM) {
      const allowedReasons =
        channelType === InboundTransferChannelType.FIAT
          ? [SimulationRiskReason.LARGE_DEPOSIT_PROFILE_MISMATCH]
          : [
              SimulationRiskReason.KYT_ISSUE,
              SimulationRiskReason.TRAVEL_RULE_ISSUE,
              SimulationRiskReason.LARGE_DEPOSIT_PROFILE_MISMATCH,
            ];
      if (!allowedReasons.includes(reason as SimulationRiskReason)) {
        throw new BadRequestException(
          channelType === InboundTransferChannelType.FIAT
            ? 'FIAT MEDIUM simulation risk requires LARGE_DEPOSIT_PROFILE_MISMATCH.'
            : 'CRYPTO MEDIUM simulation risk requires KYT_ISSUE, TRAVEL_RULE_ISSUE, or LARGE_DEPOSIT_PROFILE_MISMATCH.',
        );
      }
      return;
    }

    if (level === SimulationRiskLevel.HIGH) {
      if (reason !== SimulationRiskReason.SANCTIONS_HIT) {
        throw new BadRequestException(
          'HIGH simulation risk requires SANCTIONS_HIT.',
        );
      }
      return;
    }

    throw new BadRequestException(`Unsupported simulation risk level: ${level}`);
  }

  private async markSignalIgnored(signal: any, reason: string) {
    await (this.prisma as any).inboundTransferSignal.update({
      where: { id: signal.id },
      data: {
        status: InboundTransferSignalStatus.IGNORED,
        scanResult: reason,
      },
    });
    await this.recordSignalAudit({
      action: AuditActions.INBOUND_SIGNAL_BLOCKED,
      signal,
      reason,
      metadata: {
        signalId: signal.id,
        walletId: signal.walletId,
        assetId: signal.assetId,
        ownerId: signal.ownerId,
      },
      sourcePlatform: 'CUSTOMER_API',
    });
  }

  private async recordSignalAudit(params: {
    action: string;
    signal: any;
    reason: string;
    metadata: Record<string, unknown>;
    sourcePlatform: string;
    // 平账 B 批 ①：DEPOSIT_SUPPLEMENT_STARTED/REJECTED 的审计合同把 approvalNo 定成
    // 顶层必填字段（DEPOSIT_SUPPLEMENTED 是 depositNo）——放进 metadata 不算数，
    // assertActionSpec() 校验的是 input 对象本身的同名属性，见 audit-logs.service.ts。
    approvalNo?: string;
    depositNo?: string;
    // 评审 Important 1（2）：processSignal 失败时复用 DEPOSIT_SUPPLEMENT_REJECTED 这个
    // 里程碑码，用 outcome+reasonCode 区分「CFO 拒绝」与「处理失败」——非成功路径下
    // assertActionSpec() 改成强制 reasonCode（而非 requiredFields），见同一处校验逻辑。
    outcome?: AuditOutcome;
    reasonCode?: string;
  }) {
    const { action, signal, reason, metadata, sourcePlatform, approvalNo, depositNo, outcome, reasonCode } = params;
    await this.auditLogsService.recordSystem({
      action,
      actionDomain: 'DEPOSIT',
      primarySubjectType: AuditEntityTypes.INBOUND_TRANSFER_SIGNAL,
      primarySubjectNo: signal.signalNo,
      subjects: [
        { subjectType: AuditEntityTypes.INBOUND_TRANSFER_SIGNAL, subjectNo: signal.signalNo, subjectRole: 'PRIMARY' },
      ],
      reason,
      requestId: `${action}_${signal.signalNo}_${randomUUID()}`,
      approvalNo,
      depositNo,
      outcome,
      reasonCode,
      metadata,
      sourcePlatform,
    } as any);
  }

  private describeError(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'object' && error && 'message' in error) {
      return String((error as any).message);
    }
    return 'Unknown error';
  }
}
