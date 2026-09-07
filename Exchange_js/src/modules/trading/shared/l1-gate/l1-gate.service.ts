import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import {
  CustomerAccessService,
  type Capability,
} from '../../../identity/customers/customer-access.service';
import type {
  L1Check,
  L1CheckCode,
  L1Domain,
  L1GateInput,
  L1Snapshot,
  L1Verdict,
} from './l1-gate.types';

/** 十项的固定顺序 —— 详情页按这个顺序渲染,三域一致。 */
const CHECK_ORDER: L1CheckCode[] = [
  'CUSTOMER_ELIGIBILITY',
  'CUSTOMER_RESTRICTION',
  'SINGLE_LIMIT',
  'CUMULATIVE_LIMIT',
  'LARGE_APPROVAL',
  'ACCOUNT_READINESS',
  'BALANCE_SUFFICIENCY',
  'QUOTE_VALIDITY',
  'TRADING_READINESS',
  'ASSET_AVAILABILITY',
];

/** 各域天然不适用的项（业主 2026-08-22 逐条拍板）。 */
const NOT_APPLICABLE: Record<L1Domain, L1CheckCode[]> = {
  // 充值：钱是进来的 → 无余额/报价问题；累计额度「拦不住」、大额审批「拒了也没用」
  DEPOSIT: ['CUMULATIVE_LIMIT', 'LARGE_APPROVAL', 'BALANCE_SUFFICIENCY', 'QUOTE_VALIDITY'],
  WITHDRAW: [],
  // 兑换：资金不出境,刻意无大额审批门
  SWAP: ['LARGE_APPROVAL'],
};

const DOMAIN_CAPABILITY: Record<L1Domain, Capability> = {
  DEPOSIT: 'DEPOSIT',
  WITHDRAW: 'WITHDRAW',
  SWAP: 'SWAP',
};

/**
 * 本 service 亲自执行、自判自赢的项 —— `preChecks` 里若意外带上同名 code
 * （复制粘贴带出多余字段、误传整份旧快照等）一律丢弃，绝不覆盖本 service
 * 刚算出来的结果。这三项是安全关键判定：覆盖成 PASS 等于闸门被静默绕过。
 */
const SELF_OWNED_CHECKS: ReadonlySet<L1CheckCode> = new Set<L1CheckCode>([
  'CUSTOMER_ELIGIBILITY',
  'CUSTOMER_RESTRICTION',
  'ASSET_AVAILABILITY',
]);

/** L1 失败项 → 稳定的机器可读原因码（充值 holdReason / 提现兑换 BLOCK 审计 reasonCode 共用一份映射） */
export function l1ReasonCodeOf(code: L1CheckCode): string {
  switch (code) {
    case 'CUSTOMER_ELIGIBILITY': return 'LIFECYCLE_NOT_ACTIVE';
    case 'CUSTOMER_RESTRICTION': return 'CAPABILITY_RESTRICTED';
    case 'SINGLE_LIMIT': return 'BELOW_MIN';
    case 'ASSET_AVAILABILITY': return 'ASSET_SUSPENDED';
    default: return code;
  }
}

/**
 * L1 闸门求值器（三域共用的**唯一**一份 —— 业主 2026-08-22：「通用模块要变成
 * 公共服务」。注意这是 deliberate fork 的例外：状态机/处置弧仍然三域各写各的,
 * 只有横切关注点收成公共实现）。
 *
 * 本 service **不抛错**,只返回快照。怎么处置由各域自己决定：
 *   - 提现/兑换 verdict==='BLOCK' → 抛（钱还没动,可以拒）
 *   - 充值 verdict==='HOLD'      → 落挂起原因,单子照建（钱已到链上,拒不了）
 *
 * 它亲自执行的只有四件事：客户资格、客户限制、资产可用性、档位快照。其余七项
 * 住在各域自己的守卫里（`TransactionLimitGateService` 等）,由调用方判完通过
 * `preChecks` 传进来 —— 本批不重写那些能跑的代码,只把结果收成一份可回显的快照。
 */
@Injectable()
export class L1GateService {
  constructor(
    private readonly customerAccess: CustomerAccessService,
    private readonly prisma: PrismaService,
  ) {}

  async evaluate(input: L1GateInput): Promise<L1Snapshot> {
    const access = await this.customerAccess.resolve(input.customerId);
    const customer = await (this.prisma as any).customerMain.findUnique({
      where: { id: input.customerId },
      select: { tradingTier: true },
    });

    const own: L1Check[] = [];

    // ① 客户资格
    const lifecycleOk = access.lifecycle === 'ACTIVE';
    own.push({
      code: 'CUSTOMER_ELIGIBILITY',
      outcome: lifecycleOk ? 'PASS' : 'FAIL',
      detail: lifecycleOk
        ? 'Customer lifecycle ACTIVE'
        : `Customer lifecycle is ${access.lifecycle} — cannot trade`,
    });

    // ② 客户限制 —— 只看卡不卡**本域**这个能力。
    //    七种因由里只有 SANCTION / ADMIN_SUSPENSION 的 scope 是 ALL（含 DEPOSIT）,
    //    其余五种只卡 WITHDRAW+SWAP —— 材料过期不该挡住别人给你打钱。
    const capability = DOMAIN_CAPABILITY[input.domain];
    const restricted = access.blocked.has(capability);
    own.push({
      code: 'CUSTOMER_RESTRICTION',
      outcome: restricted ? 'FAIL' : 'PASS',
      detail: restricted
        ? `Customer restriction holds down ${capability} capability (${access.blocked.size} capability item(s) restricted in total)`
        : 'No OPEN restriction note blocks this domain\'s capability',
    });

    // ③ 资产可用性 —— 波二第十项。资产 SUSPENDED = 三条路的硬门（决定 2026-09-05）。
    //    只查不抛：提现/兑换见 BLOCK 自己抛，充值见 HOLD 打标不换状态（先合规后挂起）。
    if (input.assetIds && input.assetIds.length > 0) {
      const assets: Array<{ id: string; assetNo: string | null; currency: string; status: string }> =
        await (this.prisma as any).asset.findMany({
          where: { id: { in: input.assetIds } },
          select: { id: true, assetNo: true, currency: true, status: true },
        });
      const missing = input.assetIds.filter((id) => !assets.some((a) => a.id === id));
      const inactive = assets.filter((a) => a.status !== 'ACTIVE');
      const ok = missing.length === 0 && inactive.length === 0;
      own.push({
        code: 'ASSET_AVAILABILITY',
        outcome: ok ? 'PASS' : 'FAIL',
        detail: ok
          ? `Asset(s) ${assets.map((a) => a.currency).join(' / ')} all ACTIVE`
          : [
              ...inactive.map((a) => `Asset ${a.assetNo ?? a.id} (${a.currency}) status ${a.status} — cannot trade`),
              ...missing.map((id) => `Asset ${id} does not exist`),
            ].join('; '),
      });
    }

    // ④ 合并：本 service 判的 + 调用方传进来的 + 域内不适用的 + 其余 SKIPPED
    //    自判项（①②③）永远以本 service 为准，preChecks 里同名 code 一律丢弃 ——
    //    不依赖两个循环的写入顺序,语义显式钉在 SELF_OWNED_CHECKS 里。
    const provided = new Map<L1CheckCode, L1Check>();
    for (const c of own) provided.set(c.code, c);
    for (const c of input.preChecks ?? []) {
      if (SELF_OWNED_CHECKS.has(c.code)) continue;
      provided.set(c.code, c);
    }

    const na = new Set(NOT_APPLICABLE[input.domain]);
    const checks: L1Check[] = CHECK_ORDER.map((code) => {
      const hit = provided.get(code);
      if (hit) return hit;
      if (na.has(code)) {
        return { code, outcome: 'NA' as const, detail: 'Not applicable to this domain' };
      }
      return { code, outcome: 'SKIPPED' as const, detail: 'Not evaluated this time' };
    });

    const failed = checks.filter((c) => c.outcome === 'FAIL');
    const verdict: L1Verdict =
      failed.length === 0 ? 'PASS' : input.domain === 'DEPOSIT' ? 'HOLD' : 'BLOCK';

    return {
      evaluatedAt: new Date().toISOString(),
      domain: input.domain,
      verdict,
      holdReason: verdict === 'HOLD' ? this.holdReasonOf(failed[0]) : null,
      tradingTier: customer?.tradingTier || 'BASIC',
      checks,
    };
  }

  /** 充值挂起原因：取第一条没过的项,映射成一个稳定的机器可读串。 */
  private holdReasonOf(first: L1Check): string {
    return l1ReasonCodeOf(first.code);
  }
}
