import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CustomerLifecycle } from '../constants/customer-lifecycle.constant';
import {
  RESTRICTION_CAUSE_POLICY,
  RestrictionCause,
  RestrictionScope,
} from './constants/restriction-cause.constant';
import { CustomerRestrictionsService } from './customer-restrictions.service';

export type Capability = 'DEPOSIT' | 'WITHDRAW' | 'SWAP';

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

const ALL_CAPABILITIES: readonly Capability[] = ['DEPOSIT', 'WITHDRAW', 'SWAP'];

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
  ) {}

  async resolve(customerId: string, tx?: Prisma.TransactionClient): Promise<CustomerAccess> {
    const client = tx ?? this.prisma;
    const customer = await client.customerMain.findUnique({
      where: { id: customerId },
      select: { id: true, customerNo: true, lifecycle: true },
    });
    if (!customer) {
      throw new NotFoundException(`Customer not found: ${customerId}`);
    }

    const openRows = await this.restrictionsService.listOpen(customerId, tx);

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

  /**
   * 交易起始前置门（站6 自 OnboardingService 迁入——一期入驻流程拆除，门是二期
   * 交易地基，落户能力闸本家）。语义逐字保真：能力闸必过；除充值外还须有一个
   * 激活的法币提现地址（交易起始前置，dc6b426b 业主定式）。
   */
  async assertTradingEligibility(customerId: string, action: Capability): Promise<void> {
    await this.assertCapability(customerId, action);
    if (action !== 'DEPOSIT') {
      await this.assertTradingReady(customerId);
    }
  }

  async assertTradingReady(customerId: string): Promise<void> {
    const n = await this.prisma.withdrawalAddress.count({
      where: { customerId, status: 'ACTIVE', addressType: 'BANK' },
    });
    if (n === 0) {
      throw new ForbiddenException({
        code: 'NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS',
        message: '需要先创建并激活一个法币提现地址才能开展业务',
        customerId,
      });
    }
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

}
