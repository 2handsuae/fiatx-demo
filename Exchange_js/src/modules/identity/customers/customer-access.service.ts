import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { FundsOrderService } from '../../funds-orders/funds-order.service';
import { CustomerLifecycle } from '../constants/customer-lifecycle.constant';
import {
  RESTRICTION_CAUSE_POLICY,
  RestrictionCause,
  RestrictionScope,
} from './constants/restriction-cause.constant';
import { CustomerRestrictionsService } from './customer-restrictions.service';

export type Capability = 'DEPOSIT' | 'WITHDRAW' | 'SWAP';

export const ALL_CAPABILITIES: readonly Capability[] = ['DEPOSIT', 'WITHDRAW', 'SWAP'];

export interface DisclosedRestrictionView {
  restrictionNo: string;
  /**
   * 这张便签的故事是否已经由某条活着的材料请求在讲（那条横幅带「去认证」入口，
   * 比一条干巴巴的「Verification required」有用）。客户面据此**只显示其中一条**。
   *
   * 判定放在服务端而不是前端：客户面横幅组件的既定约束是「只把后端给的行换成
   * 文案，禁止自己推导条件」—— 把两条横幅显不显示的判断分散到前端，等于把
   * tipping-off 相关的显示决策放到两个地方。
   */
  claimedByMaterialRequestNo: string | null;
  cause: RestrictionCause;
  scopes: RestrictionScope[];
  label: string;
  reason: string;
  openedAt: string;
}

export interface CustomerAccess {
  lifecycle: CustomerLifecycle;
  /** 服务端执法唯一依据：全部 OPEN 行 scope 并集（ALL 展开）。含 SILENT。 */
  blocked: Set<Capability>;
  /** 客户面唯一可序列化的能力集：仅 DISCLOSED 行贡献。 */
  disclosedBlocked: Set<Capability>;
  /** 客户面：仅 DISCLOSED 的 OPEN 行。 */
  disclosed: DisclosedRestrictionView[];
  /** admin 面：OPEN 的 restrictionNo 去重计数，含 SILENT。 */
  openCount: number;
}

/**
 * 中性文案：与网络失败 / 系统繁忙不可区分，绝不透出 cause / visibility。
 *
 * export 出去是**安全要求**，不是便利：任何域自己手抄一份字面量，都可能在改动时
 * 漏改成一句不一样的话 —— 拒绝理由一旦有差异就可被客户端指纹识别（tipping-off）。
 * 全仓只此一份，提现/兑换的 L1_GATE_BLOCKED 都引用它。
 */
export const NEUTRAL_DENIAL = 'This operation is not available for your account at the moment.';

function expandScopes(scopes: RestrictionScope[]): Capability[] {
  const out: Capability[] = [];
  for (const scope of scopes) {
    if (scope === 'ALL') {
      out.push(...ALL_CAPABILITIES);
    } else {
      out.push(scope);
    }
  }
  return out;
}

/**
 * 客户可做什么的唯一求值器。所有读侧（jwt.strategy / 交易前置门 / profile 提示条 /
 * 客户面端点）一律消费本服务，禁止各自解析限制账。
 */
@Injectable()
export class CustomerAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly restrictionsService: CustomerRestrictionsService,
    private readonly accountingService: AccountingService,
    private readonly fundsOrderService: FundsOrderService,
  ) {}

  async resolve(customerId: string): Promise<CustomerAccess> {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { id: true, customerNo: true, lifecycle: true },
    });
    if (!customer) {
      throw new NotFoundException(`Customer not found: ${customerId}`);
    }

    const openRows = await this.restrictionsService.listOpen(customerId);

    const blocked = new Set<Capability>();
    const disclosedBlocked = new Set<Capability>();
    const disclosed: DisclosedRestrictionView[] = [];

    for (const row of openRows) {
      const capabilities = expandScopes(row.scopes);
      for (const capability of capabilities) {
        blocked.add(capability);
      }
      if (row.visibility !== 'DISCLOSED') continue;

      for (const capability of capabilities) {
        disclosedBlocked.add(capability);
      }
      disclosed.push({
        restrictionNo: row.restrictionNo,
        // 由 CustomerRestrictionsClientController 在客户面出口回填 —— resolve()
        // 同时服务执法侧，不该为了一个展示决策去依赖材料账（会引入模块环）。
        claimedByMaterialRequestNo: null,
        cause: row.cause,
        scopes: row.scopes,
        label: RESTRICTION_CAUSE_POLICY[row.cause].customerLabel,
        reason: row.reason,
        openedAt: row.openedAt.toISOString(),
      });
    }

    return {
      lifecycle: customer.lifecycle as CustomerLifecycle,
      blocked,
      disclosedBlocked,
      disclosed,
      // listOpen 已按 restrictionNo 聚合，一号一行
      openCount: openRows.length,
    };
  }

  async assertCapability(customerId: string, capability: Capability): Promise<void> {
    const access = await this.resolve(customerId);

    if (access.lifecycle !== 'ACTIVE') {
      throw new ForbiddenException({
        code: 'LIFECYCLE_NOT_ACTIVE',
        message: NEUTRAL_DENIAL,
      });
    }
    if (access.blocked.has(capability)) {
      // 响应体只有 code + message —— 客户能看到它，多一个字段就是一次泄密
      throw new ForbiddenException({
        code: 'CAPABILITY_RESTRICTED',
        message: NEUTRAL_DENIAL,
      });
    }
  }

  /**
   * 销户前置（INV-2 / INV-3）。仅 admin 侧调用，故错误体可带排障明细。
   */
  async assertOffboardable(customerId: string): Promise<void> {
    const openRows = await this.restrictionsService.listOpen(customerId);
    const silent = openRows.find((row) => row.visibility === 'SILENT');
    if (silent) {
      throw new ForbiddenException({
        code: 'OFFBOARD_BLOCKED_BY_SANCTION',
        message: 'Customer has an open confidential restriction and cannot be offboarded',
        restrictionNo: silent.restrictionNo,
      });
    }

    for (const currency of Object.keys(TB_LEDGERS)) {
      const total = await this.readTotalBalance(customerId, currency);
      if (total !== 0n) {
        throw new ForbiddenException({
          code: 'OFFBOARD_BLOCKED_BY_BALANCE',
          message: `Customer still holds a ${currency} balance`,
          currency,
          total: total.toString(),
        });
      }
    }

    const inflight = await this.fundsOrderService.countNonTerminalByCustomer(customerId);
    if (inflight > 0) {
      throw new ForbiddenException({
        code: 'OFFBOARD_BLOCKED_BY_INFLIGHT',
        message: 'Customer has funds orders still in flight',
        inflight,
      });
    }
  }

  /** 客户在该 ledger 从未开户时 AccountingService 抛 404，语义上等于零余额。 */
  private async readTotalBalance(customerId: string, currency: string): Promise<bigint> {
    try {
      const balance = await this.accountingService.getCustomerAvailableBalance(customerId, currency);
      return balance.total;
    } catch (e) {
      if (e instanceof NotFoundException) return 0n;
      throw e;
    }
  }
}
