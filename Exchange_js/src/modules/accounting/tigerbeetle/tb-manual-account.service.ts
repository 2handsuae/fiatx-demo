import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccountingService } from './accounting.service';
import { TbAccountRegistryService } from './tb-account-registry.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { TB_ACCOUNT_CODES } from './constants/tb-account-codes.constant';
import { TB_CODE_TO_COA } from './constants/tb-account-codes.constant';
import { CreateTbAccountParams } from './types/accounting.types';
import {
  AuditActions,
  AuditEntityTypes,
  AuditBusinessWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { isCustomerApprovedAndActive } from '../../identity/customer-status.util';
import { AccountFlags } from 'tigerbeetle-node';

const SYSTEM_CODES = new Set<number>([
  TB_ACCOUNT_CODES.CLIENT_ASSET,
  TB_ACCOUNT_CODES.FIRM_ASSET,
  TB_ACCOUNT_CODES.FIRM_OPS,
  TB_ACCOUNT_CODES.FIRM_SET,
  TB_ACCOUNT_CODES.FIRM_FEE,
  TB_ACCOUNT_CODES.FIRM_LIQ,
]);

const CUSTOMER_CODES = new Set<number>([
  TB_ACCOUNT_CODES.CLIENT_PAYABLE,
  TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE,
]);

interface ManualCreateInput {
  accountCategory: 'SYSTEM' | 'CUSTOMER';
  assetCurrency: string;
  code: number;
  customerNo?: string;
  description?: string;
}

interface ActorContext {
  actorId: string;
  actorNo: string;
  actorRole: string;
}

@Injectable()
export class TbManualAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountingService: AccountingService,
    private readonly registryService: TbAccountRegistryService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async manualCreate(input: ManualCreateInput, actor: ActorContext) {
    // 1. Validate code matches category
    const allowedCodes = input.accountCategory === 'SYSTEM' ? SYSTEM_CODES : CUSTOMER_CODES;
    if (!allowedCodes.has(input.code)) {
      throw new BadRequestException({
        code: 'INVALID_CODE_FOR_CATEGORY',
        message: `Account code ${input.code} is not valid for ${input.accountCategory} accounts`,
      });
    }

    // 2. Load and validate asset (frontend sends asset.code e.g. "USDT-TRON")
    const asset = await this.prisma.asset.findFirst({
      where: { code: input.assetCurrency },
    });
    if (!asset || asset.tbLedgerId == null) {
      throw new BadRequestException({
        code: 'ASSET_NOT_PROVISIONED',
        message: `Asset '${input.assetCurrency}' is not provisioned for TigerBeetle`,
      });
    }

    // 3. If CUSTOMER, load and validate customer
    let customer: { id: string; customerNo: string; onboardingStatus: string; adminStatus: string } | null = null;
    if (input.accountCategory === 'CUSTOMER') {
      if (!input.customerNo) {
        throw new BadRequestException({
          code: 'CUSTOMER_NO_REQUIRED',
          message: 'customerNo is required for CUSTOMER accounts',
        });
      }
      customer = await this.prisma.customerMain.findUnique({
        where: { customerNo: input.customerNo },
        select: { id: true, customerNo: true, onboardingStatus: true, adminStatus: true },
      });
      if (!customer) {
        throw new NotFoundException({
          code: 'CUSTOMER_NOT_FOUND',
          message: `Customer '${input.customerNo}' not found`,
        });
      }
      if (!isCustomerApprovedAndActive(customer)) {
        throw new BadRequestException({
          code: 'CUSTOMER_NOT_APPROVED',
          message: `Customer '${input.customerNo}' is not in APPROVED status`,
        });
      }
    }

    // 4. Check for duplicate
    const ownerType = input.accountCategory === 'SYSTEM' ? 'SYSTEM' : 'CUSTOMER';
    const ownerUuid = customer?.id ?? undefined;
    const existing = await this.registryService.resolve({
      code: input.code,
      ledger: asset.tbLedgerId,
      ownerType,
      ownerUuid,
    });
    if (existing) {
      throw new ConflictException({
        code: 'TB_ACCOUNT_DUPLICATE',
        message: 'TB account already exists for this combination',
      });
    }

    // 5. Derive flags
    let flags = 0;
    if (input.code === TB_ACCOUNT_CODES.CLIENT_PAYABLE) {
      flags = AccountFlags.debits_must_not_exceed_credits;
    }

    // 6. Build params and create
    const codeName = TB_CODE_TO_COA[input.code] || String(input.code);
    const params: CreateTbAccountParams = {
      code: input.code,
      ledger: asset.tbLedgerId,
      ownerType,
      ownerUuid,
      ownerNo: customer?.customerNo,
      assetCurrency: asset.currency,
      description: input.description || `Manual: ${codeName} for ${asset.currency}`,
      flags,
    };

    await this.accountingService.createAccounts([params]);

    // 7. Find the created registry entry (just registered by createAccounts)
    const created = await this.registryService.resolve({
      code: input.code,
      ledger: asset.tbLedgerId,
      ownerType,
      ownerUuid,
    });

    // 8. Audit log
    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.MANUAL_TB_ACCOUNT_CREATED,
        entityType: AuditEntityTypes.TB_ACCOUNT,
        entityId: created?.tbAccountId,
        workflowType: AuditBusinessWorkflowTypes.TB_ACCOUNT_MANUAL_CREATE,
        traceId: randomUUID(),
        result: AuditResult.SUCCESS,
        sourcePlatform: 'ADMIN_API',
        metadata: {
          accountCategory: input.accountCategory,
          assetCode: input.assetCurrency,
          assetCurrency: asset.currency,
          code: input.code,
          codeName,
          customerNo: customer?.customerNo || null,
          tbAccountId: created?.tbAccountId || null,
        },
      },
      {
        actorType: 'ADMIN',
        actorId: actor.actorId,
        actorNo: actor.actorNo,
        actorRole: actor.actorRole,
      },
    );

    return created;
  }
}
