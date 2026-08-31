// scripts/verify-rbac.ts
//
// 第一幕职权重划的行为验收（Task 13）。跟 verify-audit.ts / verify-realtime-coa.ts
// 同一范式：check() 打勾/叉，净失败数决定退出码。
//
// 红线（本仓库有过「注释喂饱 toContain」的自证型绿灯前科，见 MEMORY batch5 那次）：
//   · 静态部分只读结构 —— 直接 import rbac.catalog.ts / approval.constants.ts 的常量，
//     不 grep 源码文本、不 toContain 字符串。
//   · 行为部分一律真登录 + 真 HTTP，不读策略常量猜答案。
//
// 🔴 路径存在性预检（本任务的核心质量要求，教训见下）：
//   今天造 probe-sod.sh 时，控制器把费率路径误写成 /admin/trading/swap-fee-levels
//   （真实是 /admin/swap-fee-levels）。结果 DENY 用例拿到 404 正确报 FAIL；但 ALLOW
//   用例的判据是「非 403」，404 也满足「非 403」，于是被判「通过」——路径写错时 ALLOW
//   方向会假绿，整个校验器变成自证型绿灯。
//   解法：开跑前用 GET /admin/iam/permissions（超管令牌）拉一份真实路由清单，把下面
//   探针表里每条 method+routePattern 与之比对，对不上的在跑任何探针之前就报错退出
//   （见 assertProbesRegistered()）。这比「ALLOW 拿 404 就判 FAIL」更准：后者会把大量
//   合法的「路由对、但业务实体确实不存在」的 404（如对 NOT-EXIST 占位 id 的探测）也
//   一并误杀成 FAIL，而预检从根上锁死路径本身，不需要在运行时猜 404 的成因。

import { loginAs } from './demo-mlro';
import {
  RBAC_PERMISSION_DEFINITIONS,
  RBAC_ROLE_GROUP_BINDINGS,
  ACTION_BUCKET_CATALOG,
  RBAC_ROLE_DEFINITIONS,
} from '../src/modules/identity/access-control/rbac.catalog';
import { DEFAULT_APPROVAL_POLICIES } from '../src/modules/governance/approvals/constants/approval.constants';

// ══════════════════════ API base ══════════════════════
//
// ⚠️ 不能照抄 brief 骨架里的 `process.env.API_BASE ?? 'http://localhost:3000'`——
// scripts/on-stack.sh 只注入 DATABASE_URL / TB_ADDRESS / TB_DATA_FILE，从不设
// API_BASE。若照抄，`on-stack.sh self verify:rbac` 会悄悄打到 main 栈的 3000 端口，
// 违反 CLAUDE.md 的端口隔离铁律，还可能读/改到 main 栈的数据。
// 改用 demo-lib.ts 同款的 .stackports 探测（worktree 自动分端口的落地文件），但不
// import demo-lib.ts 本体——它顶部拉的是整棵 NestJS AppModule + 一堆领域 service，
// 只为借一个十行函数没必要背这份重量，本地内联同款逻辑即可。
import * as fs from 'node:fs';
import * as path from 'node:path';

function resolveApiBase(): string {
  if (process.env.API_BASE) return process.env.API_BASE;
  try {
    const stackportsPath = path.resolve(__dirname, '../../.stackports');
    const port = parseInt(fs.readFileSync(stackportsPath, 'utf8').trim(), 10);
    if (Number.isFinite(port)) return `http://localhost:${port}`;
  } catch {
    // 没有 .stackports —— 不是 worktree 自动分端口栈，落回 main 的固定端口。
  }
  return 'http://localhost:3000';
}

const API = resolveApiBase();

// ══════════════════════ check() 记账 ══════════════════════

let failed = 0;
let guardOpenCount = 0;

function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✓' : '✗'} ${name} —— ${detail}`);
  if (!ok) failed += 1;
}

// ══════════════════════ 账号花名册 ══════════════════════
// 职务 → 登录邮箱前缀（域名统一 fiatx.com，密码统一 123456）。

const ROLE_LOGIN: Record<string, string> = {
  SUPER_ADMIN: 'admin',
  SENIOR_MANAGEMENT_OFFICER: 'sm',
  CISO: 'ciso',
  MLRO: 'mlro',
  DPO: 'dpo',
  INTERNAL_AUDITOR: 'auditor',
  COMPLIANCE_OFFICER: 'compliance_lead',
  CFO: 'cfo',
  TREASURY_OFFICER: 'treasury',
  TECH_OFFICER: 'tech_admin',
  OPS_OFFICER: 'ops_officer',
};
const ALL_LOGIN_PREFIXES = Object.values(ROLE_LOGIN);

// ══════════════════════ HTTP 小工具 ══════════════════════

async function call(
  method: 'GET' | 'POST',
  urlPath: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // 非 JSON 响应体，保留原始文本供报错引用
  }
  return { status: res.status, json, text };
}

async function findApprovalIdByNo(token: string, approvalNo: string): Promise<string | null> {
  const { status, json } = await call('GET', `/admin/control-gates/approvals?approvalNo=${encodeURIComponent(approvalNo)}`, token);
  if (status !== 200) return null;
  const items = json?.items ?? [];
  return items[0]?.id ?? null;
}

async function fetchIamRoles(token: string): Promise<any[]> {
  const { status, json } = await call('GET', '/admin/iam/roles', token);
  if (status !== 200) throw new Error(`GET /admin/iam/roles failed: ${status}`);
  return json;
}

// ══════════════════════ 静态部分（读结构，不读文本）══════════════════════
//
// 直接 import rbac.catalog.ts 的常量再做集合运算 —— 不是 grep 源码，是解析已经被
// TypeScript 解析过一次的真实数据结构。

// ① 每个有路由的组至少一个角色持有；未持有者必须落在白名单 3 个已知例外内。
const ROUTE_ORPHAN_WHITELIST: Record<string, string> = {
  TRADING_DEPOSIT_WRITE: '客户侧 /deposit-transactions/my/inbound-signals 入口，非管理端能力（T7 Step 6 已定）',
  INTERNAL_TRANSFER_READ: 'V7 遗留后端路由，App.tsx 明写前端已迁走，零消费方',
  INTERNAL_TRANSFER_WRITE: '同上',
};

// ② 审批策略里出现过、但本轮矩阵刻意没有对应「谁能碰哪个端点」判据的职务代码，
//    不在此列——S4 只验证「策略点名的都是真实存在的角色」，不关心是否被本文件的
//    行为探针覆盖到。

function runStaticChecks(): void {
  const routedGroups = new Set<string>(RBAC_PERMISSION_DEFINITIONS.flatMap((d) => d.groups));
  const heldGroups = new Set<string>(Object.values(RBAC_ROLE_GROUP_BINDINGS).flat());
  const bucketGroups = new Set<string>(
    ACTION_BUCKET_CATALOG.flatMap((domain) => domain.buckets.flatMap((b) => b.groups)),
  );

  // S1：有路由无人持有 —— 未持有者必须落在白名单内
  const orphans = [...routedGroups].filter((g) => !heldGroups.has(g));
  const unexpectedOrphans = orphans.filter((g) => !(g in ROUTE_ORPHAN_WHITELIST));
  check(
    'S1 有路由无人持有的组仅限白名单 3 例外',
    unexpectedOrphans.length === 0,
    unexpectedOrphans.length === 0
      ? `孤儿组 ${orphans.length} 个，全部落在白名单（${orphans.join(', ') || '无孤儿'}）`
      : `意外孤儿组（未列入白名单，视为真实缺陷）: ${unexpectedOrphans.join(', ')}`,
  );

  // S1b：白名单本身要名副其实 —— 例外条目一旦被某角色持有，就不再是「有路由无人持有」，
  //      应该从白名单里删掉，否则白名单会悄悄放过未来真正的孤儿。
  const staleExceptions = Object.keys(ROUTE_ORPHAN_WHITELIST).filter((g) => heldGroups.has(g));
  check(
    'S1b 白名单例外条目名副其实（确认零角色持有）',
    staleExceptions.length === 0,
    staleExceptions.length === 0
      ? '3 个例外全部确认零角色持有'
      : `以下例外已被角色持有，应从白名单移除: ${staleExceptions.join(', ')}`,
  );

  // S2：有绑定无桶为空 —— 角色持有某组，但该组在任何桶里都不可见（有权限没入口）
  const boundButBucketless = [...heldGroups].filter((g) => !bucketGroups.has(g));
  check(
    'S2 有绑定无桶为空',
    boundButBucketless.length === 0,
    boundButBucketless.length === 0
      ? '所有被角色持有的组都能在某个 Action Bucket 里被看到'
      : `以下组被角色持有但没有任何桶入口: ${boundButBucketless.join(', ')}`,
  );

  // S2b：有桶无组为空 —— 桶背后的组没有任何角色持有（有入口没权限，死开关）
  const bucketedButUnheld = [...bucketGroups].filter((g) => !heldGroups.has(g));
  check(
    'S2b 有桶无组为空（防「有入口没权限」的死开关）',
    bucketedButUnheld.length === 0,
    bucketedButUnheld.length === 0
      ? '所有桶背后的组都至少一个角色真持有'
      : `以下桶是死开关（无人持有对应组）: ${bucketedButUnheld.join(', ')}`,
  );

  // S4：审批策略点名的每个职务都真实存在
  const realRoleCodes = new Set(RBAC_ROLE_DEFINITIONS.map((r) => r.code));
  const badPolicyRoles: string[] = [];
  let totalPolicies = 0;
  for (const [actionType, policy] of Object.entries(DEFAULT_APPROVAL_POLICIES)) {
    totalPolicies += 1;
    for (const step of policy.steps) {
      for (const role of step.roles) {
        if (!realRoleCodes.has(role)) badPolicyRoles.push(`${actionType}/step${step.stepNo}:${role}`);
      }
    }
  }
  check(
    'S4 审批策略点名的职务都真实存在',
    badPolicyRoles.length === 0,
    badPolicyRoles.length === 0
      ? `${totalPolicies} 条策略全部点名真实职务代码`
      : `以下策略点名了不存在的职务代码: ${badPolicyRoles.join(', ')}`,
  );
}

// ══════════════════════ 路径存在性预检 ══════════════════════

async function fetchLiveRoutes(adminToken: string): Promise<Set<string>> {
  const { status, json } = await call('GET', '/admin/iam/permissions', adminToken);
  if (status !== 200 || !Array.isArray(json)) {
    throw new Error(`GET /admin/iam/permissions 拉真实路由清单失败: status=${status}`);
  }
  return new Set(json.map((r: any) => `${String(r.method).toUpperCase()} ${r.path}`));
}

interface RouteUsage {
  section: string;
  name: string;
  method: 'GET' | 'POST';
  routePattern: string;
}

/** 纯函数，方便单独喂一份「故意写错的探针表」做验证（见 task-13-report.md 的实证）。*/
function findUnregisteredRoutes(liveRoutes: Set<string>, usages: RouteUsage[]): string[] {
  const missing: string[] = [];
  for (const u of usages) {
    const key = `${u.method} ${u.routePattern}`;
    if (!liveRoutes.has(key)) missing.push(`[${u.section}] ${u.name} —— ${key}`);
  }
  return missing;
}

// ══════════════════════ 行为探针表 ══════════════════════
//
// 每条探针：谁登录、打哪个端点（真实占位 id，业务上必然查不到）、期望什么方向。
// DENY  → 必须精确拿到 403。拿到 404/500 说明守卫在此处 fail-open（技术兜底，见
//         CLAUDE.md §2 禁做清单，不许改守卫）——判成 GUARD_OPEN 而非笼统 FAIL。
// ALLOW → 必须不是 403。GET 进一步收紧到必须 2xx（列表端点没有理由业务性 404）。
//         POST 允许 404/400（占位 id 不存在，属守卫放行后的业务层拒绝，判据只验
//         权限闸，不验业务）—— 但这一步能安全成立，前提是 routePattern 已经过
//         上面的预检确认真实存在，404 就只可能是「实体不存在」而不是「路由本身
//         就没有」。

const NOPE = 'RBAC-PROBE-404'; // 占位 id：任何域都不可能真实存在的业务键

interface DirectionalProbe {
  section: string;
  name: string;
  method: 'GET' | 'POST';
  routePattern: string;
  path: string;
  role: string; // ROLE_LOGIN 的前缀值
  expect: 'DENY' | 'ALLOW';
  body?: unknown;
}

const PROBES: DirectionalProbe[] = [
  // ── 解冻只在合规官 ──────────────────────────────────────
  {
    section: '解冻只在合规官', name: '运营 不得 提充值解冻', method: 'POST',
    routePattern: '/deposit-transactions/:id/unfreeze', path: `/deposit-transactions/${NOPE}/unfreeze`,
    role: 'ops_officer', expect: 'DENY',
  },
  {
    section: '解冻只在合规官', name: '运营 不得 提提现解冻', method: 'POST',
    routePattern: '/withdraw-transactions/:id/unfreeze', path: `/withdraw-transactions/${NOPE}/unfreeze`,
    role: 'ops_officer', expect: 'DENY',
  },
  {
    section: '解冻只在合规官', name: '合规官 可以 提充值解冻', method: 'POST',
    routePattern: '/deposit-transactions/:id/unfreeze', path: `/deposit-transactions/${NOPE}/unfreeze`,
    role: 'compliance_lead', expect: 'ALLOW',
  },
  {
    section: '解冻只在合规官', name: '合规官 可以 提提现解冻', method: 'POST',
    routePattern: '/withdraw-transactions/:id/unfreeze', path: `/withdraw-transactions/${NOPE}/unfreeze`,
    role: 'compliance_lead', expect: 'ALLOW',
  },

  // ── 合规官推不动交易单，但持 ⚡ ─────────────────────────
  {
    section: '合规官推不动交易单', name: '合规官 不得 提没收', method: 'POST',
    routePattern: '/deposit-transactions/:id/confiscate', path: `/deposit-transactions/${NOPE}/confiscate`,
    role: 'compliance_lead', expect: 'DENY',
  },
  {
    section: '合规官推不动交易单', name: '合规官 不得 提上缴', method: 'POST',
    routePattern: '/deposit-transactions/:id/seize', path: `/deposit-transactions/${NOPE}/seize`,
    role: 'compliance_lead', expect: 'DENY',
  },
  {
    section: '合规官推不动交易单', name: '合规官 不得 提退回', method: 'POST',
    routePattern: '/deposit-transactions/:id/return', path: `/deposit-transactions/${NOPE}/return`,
    role: 'compliance_lead', expect: 'DENY',
  },
  {
    section: '合规官推不动交易单', name: '合规官 不得 提提现退票', method: 'POST',
    routePattern: '/withdraw-transactions/:id/bounce', path: `/withdraw-transactions/${NOPE}/bounce`,
    role: 'compliance_lead', expect: 'DENY',
  },
  {
    section: '合规官推不动交易单', name: '合规官 不得 提制裁退款', method: 'POST',
    routePattern: '/withdraw-transactions/:id/refund', path: `/withdraw-transactions/${NOPE}/refund`,
    role: 'compliance_lead', expect: 'DENY',
  },
  {
    section: '合规官推不动交易单', name: '合规官 不得 建兑换处置单', method: 'POST',
    routePattern: '/admin/swap-transactions', path: '/admin/swap-transactions',
    role: 'compliance_lead', expect: 'DENY',
  },
  {
    section: '合规官推不动交易单，但持 ⚡', name: '合规官 可以 按 ⚡ 充值裁决', method: 'POST',
    routePattern: '/admin/deposit-sumsub/demo/run-verdict', path: '/admin/deposit-sumsub/demo/run-verdict',
    role: 'compliance_lead', expect: 'ALLOW', body: { depositId: NOPE, verdict: 'approved' },
  },
  {
    section: '合规官推不动交易单，但持 ⚡', name: '合规官 可以 按 ⚡ 提现裁决', method: 'POST',
    routePattern: '/admin/withdraw-sumsub/demo/run-verdict', path: '/admin/withdraw-sumsub/demo/run-verdict',
    role: 'compliance_lead', expect: 'ALLOW', body: { withdrawId: NOPE, verdict: 'approved' },
  },
  {
    section: '合规官推不动交易单，但持 ⚡', name: '合规官 可以 按 ⚡ 兑换裁决', method: 'POST',
    routePattern: '/admin/swap-sumsub/demo/run-verdict', path: '/admin/swap-sumsub/demo/run-verdict',
    role: 'compliance_lead', expect: 'ALLOW', body: { swapId: NOPE, verdict: 'approved' },
  },
  {
    section: '合规官推不动交易单，但持 ⚡', name: '运营 不得 按 ⚡', method: 'POST',
    routePattern: '/admin/deposit-sumsub/demo/run-verdict', path: '/admin/deposit-sumsub/demo/run-verdict',
    role: 'ops_officer', expect: 'DENY', body: { depositId: NOPE, verdict: 'approved' },
  },

  // ── 内审全域只读，零 Act（V9）────────────────────────────
  {
    section: '内审零 Act', name: '内审 不得 开客户限制', method: 'POST',
    routePattern: '/admin/customers/:customerNo/restrictions', path: `/admin/customers/${NOPE}/restrictions`,
    role: 'auditor', expect: 'DENY',
  },
  {
    section: '内审零 Act', name: '内审 不得 跑对账批次', method: 'POST',
    routePattern: '/admin/reconciliation/runs/wallet', path: '/admin/reconciliation/runs/wallet',
    role: 'auditor', expect: 'DENY',
  },
  {
    section: '内审零 Act', name: '内审 不得 推资金单', method: 'POST',
    routePattern: '/admin/funds-orders/:fundsOrderNo/push/sync', path: `/admin/funds-orders/${NOPE}/push/sync`,
    role: 'auditor', expect: 'DENY',
  },
  {
    section: '内审零 Act', name: '内审 不得 建费率等级', method: 'POST',
    routePattern: '/admin/swap-fee-levels', path: '/admin/swap-fee-levels',
    role: 'auditor', expect: 'DENY',
  },
  {
    section: '内审零 Act', name: '内审 不得 建托管钱包', method: 'POST',
    routePattern: '/admin/custodian-wallets', path: '/admin/custodian-wallets',
    role: 'auditor', expect: 'DENY',
  },
  {
    section: '内审零 Act', name: '内审 不得 放行小额挂起', method: 'POST',
    routePattern: '/deposit-transactions/:id/waive-limit', path: `/deposit-transactions/${NOPE}/waive-limit`,
    role: 'auditor', expect: 'DENY',
  },

  // ── 费率只在 CFO（ALLOW 半在 verifyPricingAndPolicySoD 里，跟 V3 共用同一次真实创建）──
  {
    section: '费率只在 CFO', name: '运营 不得 建费率等级', method: 'POST',
    routePattern: '/admin/swap-fee-levels', path: '/admin/swap-fee-levels',
    role: 'ops_officer', expect: 'DENY',
  },
  {
    section: '费率只在 CFO', name: '技术官 不得 建提现费率等级', method: 'POST',
    routePattern: '/admin/withdrawal-fee-levels', path: '/admin/withdrawal-fee-levels',
    role: 'tech_admin', expect: 'DENY',
  },
  {
    section: '费率只在 CFO', name: '金库官 不得 建提现费率等级', method: 'POST',
    routePattern: '/admin/withdrawal-fee-levels', path: '/admin/withdrawal-fee-levels',
    role: 'treasury', expect: 'DENY',
  },

  // ── 钱包地址只在金库 ─────────────────────────────────────
  {
    section: '钱包地址只在金库', name: '金库官 可以 建托管钱包', method: 'POST',
    routePattern: '/admin/custodian-wallets', path: '/admin/custodian-wallets',
    role: 'treasury', expect: 'ALLOW',
  },
  {
    section: '钱包地址只在金库', name: '运营 不得 建托管钱包', method: 'POST',
    routePattern: '/admin/custodian-wallets', path: '/admin/custodian-wallets',
    role: 'ops_officer', expect: 'DENY',
  },
  {
    section: '钱包地址只在金库', name: '技术官 不得 建托管钱包', method: 'POST',
    routePattern: '/admin/custodian-wallets', path: '/admin/custodian-wallets',
    role: 'tech_admin', expect: 'DENY',
  },
  {
    section: '钱包地址只在金库', name: '金库官 可以 冻结提现地址', method: 'POST',
    routePattern: '/admin/withdrawal-addresses/:addressNo/suspend', path: `/admin/withdrawal-addresses/${NOPE}/suspend`,
    role: 'treasury', expect: 'ALLOW',
  },
  {
    section: '钱包地址只在金库', name: '运营 不得 冻结提现地址', method: 'POST',
    routePattern: '/admin/withdrawal-addresses/:addressNo/suspend', path: `/admin/withdrawal-addresses/${NOPE}/suspend`,
    role: 'ops_officer', expect: 'DENY',
  },
  {
    section: '钱包地址只在金库', name: '财务 不得 冻结提现地址', method: 'POST',
    routePattern: '/admin/withdrawal-addresses/:addressNo/suspend', path: `/admin/withdrawal-addresses/${NOPE}/suspend`,
    role: 'cfo', expect: 'DENY',
  },

  // ── 推单跑批只在运营（V4 后半 + 矩阵头条）────────────────
  {
    section: '推单跑批只在运营', name: '运营 可以 推资金单', method: 'POST',
    routePattern: '/admin/funds-orders/:fundsOrderNo/push/sync', path: `/admin/funds-orders/${NOPE}/push/sync`,
    role: 'ops_officer', expect: 'ALLOW',
  },
  {
    section: '推单跑批只在运营', name: '运营 可以 跑对账批次', method: 'POST',
    routePattern: '/admin/reconciliation/runs/wallet', path: '/admin/reconciliation/runs/wallet',
    role: 'ops_officer', expect: 'ALLOW', body: { cutoff: new Date().toISOString() },
  },
  {
    section: '推单跑批只在运营', name: '金库官 不得 跑对账批次', method: 'POST',
    routePattern: '/admin/reconciliation/runs/wallet', path: '/admin/reconciliation/runs/wallet',
    role: 'treasury', expect: 'DENY',
  },

  // ── V4 前半：只持 FUNDS_ORDER_VIEW 的职务看得见、推不动 ──
  ...(['auditor', 'cfo', 'treasury', 'sm', 'mlro', 'tech_admin'].flatMap((role): DirectionalProbe[] => [
    {
      section: 'V4 资金单看推分离', name: `${role} 可以 看资金单列表`, method: 'GET',
      routePattern: '/admin/funds-orders', path: '/admin/funds-orders?take=1',
      role, expect: 'ALLOW',
    },
    {
      section: 'V4 资金单看推分离', name: `${role} 不得 推资金单`, method: 'POST',
      routePattern: '/admin/funds-orders/:fundsOrderNo/push/sync', path: `/admin/funds-orders/${NOPE}/push/sync`,
      role, expect: 'DENY',
    },
  ])),
];

async function runDirectionalProbe(tokens: Record<string, string>, p: DirectionalProbe): Promise<void> {
  const token = tokens[p.role];
  if (!token) {
    check(`[${p.section}] ${p.name}`, false, `角色 ${p.role} 没有可用 token（登录步骤失败？）`);
    return;
  }
  const { status } = await call(p.method, p.path, token, p.body);

  if (p.expect === 'DENY') {
    const ok = status === 403;
    if (!ok && (status === 404 || status === 500)) {
      guardOpenCount += 1;
      check(
        `[${p.section}] ${p.name}`, false,
        `GUARD_OPEN —— 期望 403（权限应挡），实得 ${status}（守卫在此处 fail-open，技术兜底，见 CLAUDE.md §2，不修守卫，记 PRODUCTION-NOTES）`,
      );
    } else {
      check(`[${p.section}] ${p.name}`, ok, `${p.role}@ ${p.method} ${p.path} → ${status}（期望 403）`);
    }
    return;
  }

  // ALLOW
  let ok = status !== 403;
  let expectLabel = '非 403';
  if (p.method === 'GET') {
    ok = ok && status >= 200 && status < 300;
    expectLabel = '2xx';
  }
  check(`[${p.section}] ${p.name}`, ok, `${p.role}@ ${p.method} ${p.path} → ${status}（期望 ${expectLabel}）`);
}

// ══════════════════════ V2：改角色不丢权限 ══════════════════════
//
// 对每个内建角色：技术官提交「原样重提当前 permissionGroups」的 modify 请求 → CISO
// 批准 → 比对批准前后 GET /admin/iam/roles 里该角色的 permissionCodes 集合，要求
// 逐项相等。用来抓「modify→approve 往返把某个组静默丢了」这类真实的执行期 bug——
// 不是「有没有执行」（那只需 approve 拿 2xx 就够了），是「执行完权限集合完整」。
//
// proposedName/proposedDescription 直接取自静态 RBAC_ROLE_DEFINITIONS（catalog 本身
// 就是这些值的权威来源，不必先绕一圈从 GET 读回来再原样传回去）；proposedPermissionGroups
// 同理直接取 RBAC_ROLE_GROUP_BINDINGS[roleCode]。唯一需要走真实 HTTP 才能拿到的是
// before/after 的 permissionCodes ——这才是本条真正要验证的东西。
async function verifyRoleModifyNoLoss(techToken: string, cisoToken: string, roleCode: string): Promise<void> {
  const label = `V2 改角色不丢权限 · ${roleCode}`;

  const rolesBefore = await fetchIamRoles(techToken);
  const roleBefore = rolesBefore.find((r) => r.code === roleCode);
  if (!roleBefore) {
    check(label, false, `GET /admin/iam/roles 找不到角色 ${roleCode}`);
    return;
  }
  const before: string[] = (roleBefore.permissions ?? []).map((p: any) => p.code).sort();

  const roleDef = RBAC_ROLE_DEFINITIONS.find((r) => r.code === roleCode)!;
  const groups = RBAC_ROLE_GROUP_BINDINGS[roleCode] ?? [];
  if (groups.length === 0) {
    check(label, false, `RBAC_ROLE_GROUP_BINDINGS[${roleCode}] 为空，无法提交非空 proposedPermissionGroups`);
    return;
  }

  const { status: submitStatus, json: submitBody } = await call('POST', `/admin/iam/role-definitions/${roleBefore.id}/modify`, techToken, {
    proposedName: roleDef.name,
    proposedDescription: roleDef.description,
    proposedPermissionGroups: groups,
    changeReason: 'verify:rbac V2 probe — 原样重提当前 groups，验证批准往返不丢权限',
  });
  if (submitStatus < 200 || submitStatus >= 300) {
    check(label, false, `技术官提交 modify 失败: ${submitStatus} ${JSON.stringify(submitBody)}`);
    return;
  }

  const approvalNo = submitBody?.approvalNo;
  const caseId = approvalNo ? await findApprovalIdByNo(cisoToken, approvalNo) : null;
  if (!caseId) {
    check(label, false, `approvalNo=${approvalNo} 查不到内部 id（GET /admin/control-gates/approvals?approvalNo=...）`);
    return;
  }

  const { status: approveStatus, json: approveBody } = await call('POST', `/admin/control-gates/approvals/${caseId}/approve`, cisoToken, {
    reason: 'verify:rbac V2 probe approval',
  });
  if (approveStatus < 200 || approveStatus >= 300) {
    check(label, false, `CISO 批准失败: ${approveStatus} ${JSON.stringify(approveBody)}`);
    return;
  }

  const rolesAfter = await fetchIamRoles(techToken);
  const roleAfter = rolesAfter.find((r) => r.code === roleCode);
  if (!roleAfter) {
    check(label, false, '批准后 GET /admin/iam/roles 再也找不到这个角色了');
    return;
  }
  const after: string[] = (roleAfter.permissions ?? []).map((p: any) => p.code).sort();

  const lost = before.filter((c) => !after.includes(c));
  const gained = after.filter((c) => !before.includes(c));
  check(
    label,
    lost.length === 0 && gained.length === 0,
    lost.length === 0 && gained.length === 0
      ? `提交→批准往返后 ${before.length} 项 permissionCodes 逐一无丢失`
      : `丢失 ${lost.length} 项${lost.length ? `(${lost.slice(0, 5).join(',')}${lost.length > 5 ? '...' : ''})` : ''}` +
        `，新增 ${gained.length} 项${gained.length ? `(${gained.slice(0, 5).join(',')}${gained.length > 5 ? '...' : ''})` : ''}`,
  );
}

// ══════════════════════ V3 + 费率只在 CFO(ALLOW半)：裁决只认审批策略 ══════════════════════
//
// 用一次真实的 CFO 建费率等级请求当燃料：既证明「费率只在 CFO」的 ALLOW 方向（这条
// 端点本身只有 CFO 持有 SWAP_FEE_LEVEL_WRITE），又顺手产出一张真实的
// SWAP_FEE_LEVEL_CREATION 待审单，拿来测 V3——同一张单、同一个 approve 端点，换人
// 结果相反：treasury（持 GOV_APPROVAL_READ 但策略未点名）必须被拒；ops_officer
// （策略唯一点名的 checkerRole）必须成功。
//
// 判据落在「同一张单、同一端点、换人结果相反」，不读 DEFAULT_APPROVAL_POLICIES 常量
// 猜答案（那是静态部分 S4 的事，S4 只验证策略点名的角色存在，不代替这里的行为验证）。
//
// rateMarkupBps 故意给一个不可能中选的天文数字：resolveBestLevel() 按 totalFee 挑
// cheapest 那一档，若给个正常值（哪怕是 10bps）就可能意外顶替掉真实的 STD-AED-USDT
// 默认档、悄悄改变其它演示流程里兑换报价的实际选中费率——手工彩排时正撞上这个坑
// （建单时给了 10bps，一度让这条 probe 夹层顶替了默认档；见 report 的踩坑记录）。
async function verifyPricingCfoAndPolicySoD(tokens: Record<string, string>): Promise<void> {
  const { status: assetsStatus, json: assetsBody } = await call('GET', '/assets', tokens.cfo);
  const assets: any[] = (assetsStatus === 200 ? (assetsBody?.items ?? assetsBody) : []) ?? [];
  const active = assets.filter((a) => a.status === 'ACTIVE');
  if (active.length < 2) {
    check('V3 + 费率只在 CFO 前置条件', false, `需要 >=2 个 ACTIVE 资产来建费率等级夹具，实得 ${active.length}`);
    return;
  }

  const levelCode = `VERIFY-RBAC-PROBE-${Date.now()}`;
  const createBody = {
    levelCode,
    name: 'verify:rbac probe fixture — 请勿删除报表外的说明：天文数字markup，业务上永不中选',
    fromAssetId: active[0].id,
    toAssetId: active[1].id,
    isDefault: false,
    tiersJson: JSON.stringify({
      tiers: [{ id: 'T1', name: 'verify:rbac probe (never cheapest)', rateMarkupBps: 999999, feeItems: [] }],
    }),
    reason: 'verify:rbac V3 + 费率只在CFO probe fixture — extreme markup, never selected by resolveBestLevel',
  };

  const { status: createStatus, json: createBodyResp } = await call('POST', '/admin/swap-fee-levels', tokens.cfo, createBody);
  check(
    '费率只在 CFO —— cfo@ 可以建费率等级（本次创建同时是 V3 的真实夹具来源）',
    createStatus >= 200 && createStatus < 300,
    `POST /admin/swap-fee-levels → ${createStatus} ${createStatus >= 300 ? JSON.stringify(createBodyResp) : `(levelCode=${levelCode})`}`,
  );
  if (createStatus < 200 || createStatus >= 300) {
    check('V3 裁决只认审批策略', false, '前置的费率等级创建没成功，没有真实待审单可测，跳过');
    return;
  }

  const approvalNo = createBodyResp?.approvalNo;
  const caseId = approvalNo ? await findApprovalIdByNo(tokens.cfo, approvalNo) : null;
  if (!caseId) {
    check('V3 裁决只认审批策略', false, `approvalNo=${approvalNo} 查不到内部 id`);
    return;
  }

  const { status: denyStatus } = await call('POST', `/admin/control-gates/approvals/${caseId}/approve`, tokens.treasury, {
    reason: 'verify:rbac V3 probe — non-checker role, expect denied',
  });
  check(
    'V3 裁决只认审批策略 —— treasury@（持 GOV_APPROVAL_READ 但策略未点名）approve 必须被拒',
    denyStatus === 403,
    `POST approve as treasury@ → ${denyStatus}（期望 403）`,
  );

  const { status: allowStatus, json: allowBody } = await call('POST', `/admin/control-gates/approvals/${caseId}/approve`, tokens.ops_officer, {
    reason: 'verify:rbac V3 probe — the policy-named checkerRole, expect allowed',
  });
  check(
    'V3 裁决只认审批策略 —— ops_officer@（SWAP_FEE_LEVEL_CREATION 策略点名的唯一 checkerRole）approve 必须成功',
    allowStatus >= 200 && allowStatus < 300,
    `POST approve as ops_officer@ → ${allowStatus}${allowStatus >= 300 ? ' ' + JSON.stringify(allowBody) : ''}（期望 2xx）`,
  );
}

// ══════════════════════ main ══════════════════════

async function main(): Promise<void> {
  console.log(`API base: ${API}`);
  console.log('');

  console.log('── 静态部分（读结构）──');
  runStaticChecks();
  console.log('');

  console.log('── 登录可达性：11 个职务账号全部能登录 ──');
  const tokens: Record<string, string> = {};
  for (const prefix of ALL_LOGIN_PREFIXES) {
    try {
      const token = await loginAs(API, `${prefix}@fiatx.com`);
      tokens[prefix] = token;
      check(`登录 ${prefix}@fiatx.com`, true, '拿到 access_token');
    } catch (e: any) {
      check(`登录 ${prefix}@fiatx.com`, false, String(e?.message ?? e));
    }
  }
  console.log('');

  if (!tokens.admin) {
    console.error('✗ SUPER_ADMIN(admin@) 登录失败，路径预检需要超管令牌，无法继续。');
    process.exit(1);
  }

  console.log('── 路径存在性预检（跑任何探针前，先核对真实路由清单）──');
  const liveRoutes = await fetchLiveRoutes(tokens.admin);
  const usages: RouteUsage[] = [
    ...PROBES.map((p) => ({ section: p.section, name: p.name, method: p.method, routePattern: p.routePattern })),
    { section: '支撑调用', name: '角色列表', method: 'GET', routePattern: '/admin/iam/roles' },
    { section: '支撑调用', name: '提交改角色请求', method: 'POST', routePattern: '/admin/iam/role-definitions/:roleId/modify' },
    { section: '支撑调用', name: '按单号查审批案', method: 'GET', routePattern: '/admin/control-gates/approvals' },
    { section: '支撑调用', name: '批准审批案', method: 'POST', routePattern: '/admin/control-gates/approvals/:id/approve' },
    { section: '支撑调用', name: '资产列表', method: 'GET', routePattern: '/assets' },
  ];
  const missing = findUnregisteredRoutes(liveRoutes, usages);
  if (missing.length > 0) {
    console.error(`✗ 路径预检失败 —— 以下 ${missing.length} 条探针的 method+routePattern 在真实路由清单（${liveRoutes.size} 条）里找不到，路径可能写错了：`);
    for (const m of missing) console.error(`   ${m}`);
    console.error('已在跑任何探针之前中止，不产出任何行为判据。');
    process.exit(1);
  }
  check('路径预检', true, `${usages.length} 条探针 + 支撑调用的 method+routePattern 均在真实路由清单（${liveRoutes.size} 条）里找到`);
  console.log('');

  console.log('── 行为部分：矩阵头条主张（真登录 + 真 HTTP）──');
  for (const p of PROBES) {
    await runDirectionalProbe(tokens, p);
  }
  console.log('');

  console.log('── V3 裁决只认审批策略 + 费率只在CFO(ALLOW半) ──');
  await verifyPricingCfoAndPolicySoD(tokens);
  console.log('');

  console.log('── V2 改角色不丢权限（对每个内建角色跑一次 modify→approve 往返）──');
  const v2RoleCodes = RBAC_ROLE_DEFINITIONS.map((r) => r.code).filter((c) => c !== 'SUPER_ADMIN');
  for (const roleCode of v2RoleCodes) {
    await verifyRoleModifyNoLoss(tokens.tech_admin, tokens.ciso, roleCode);
  }
  console.log('');
  console.log(`共 ${failed} 条 FAIL，其中 GUARD_OPEN（守卫 fail-open，非权限配错）${guardOpenCount} 条`);
  console.log(failed === 0 ? 'ALL RBAC CHECKS PASS' : `FAIL: ${failed} check(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
