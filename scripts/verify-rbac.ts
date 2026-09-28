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
  PermissionGroup,
} from '../src/modules/identity/access-control/rbac.catalog';
import { DEFAULT_APPROVAL_POLICIES } from '../src/modules/governance/approvals/constants/approval.constants';
import { buildPermissionCode } from '../src/modules/identity/access-control/permission-code.util';
import { DETAIL_READ_GROUP_BY_POLICY } from './verify-rbac.tables';

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
    const stackportsPath = path.resolve(__dirname, '../.stackports');
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
let knownDeadlockCount = 0; // S5 已登记死锁数——不计入 failed，但必须出现在总结行，见 main() 末尾

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

async function fetchIamRoles(token: string): Promise<any[]> {
  const { status, json } = await call('GET', '/admin/iam/roles', token);
  if (status !== 200) throw new Error(`GET /admin/iam/roles failed: ${status}`);
  return json;
}

// ══════════════════════ 静态部分（读结构，不读文本）══════════════════════
//
// 直接 import rbac.catalog.ts 的常量再做集合运算 —— 不是 grep 源码，是解析已经被
// TypeScript 解析过一次的真实数据结构。

// ① 每个有路由的组至少一个角色持有；未持有者必须落在白名单 1 个已知例外内。
const ROUTE_ORPHAN_WHITELIST: Record<string, string> = {
  TRADING_DEPOSIT_WRITE: '客户侧 /deposit-transactions/my/inbound-signals 入口，非管理端能力（T7 Step 6 已定）',
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
    'S1 有路由无人持有的组仅限白名单 1 例外',
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
      ? '1 个例外全部确认零角色持有'
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

  // ── S5：自批死锁闸门 ────────────────────────────────────────────────
  //
  // 本轮的头条业务成果是「解开三处自批死锁」——审批策略的裁决人恰好是唯一可能的
  // 提单人，提完只能自己批，`approvals.service.ts` 的 SoD 当场拒绝，那条业务出路
  // 就此走不通（第一幕走查②在改造前就是这么跑不通的）。
  //
  // 本闸门两条判据都要成立，缺一不可（波一 T13 修复轮二 review Critical：修复轮一把
  // 旧判据 P2 换成新判据 P1，当成「改写」处理，实为拿掉一半——两者不等价，maker 组
  // ≥2 人持有时 P2 严格强于 P1，只留 P1 会漏掉 P2 单独守住的那类真缺口）：
  //
  //   P1（安全 maker 非空）：对每条「maker 权限组唯一确定」的审批策略，持有该 maker
  //       组的角色集合 ∖ 该策略任一步骤的裁决人集合 必须非空（至少一个角色能提但不在
  //       裁决人集合里，永远能正常提单、不会被 SoD 卡死）。安全 maker 集合为空 = 该
  //       策略结构性走不通：唯一能提的人也是唯一能批的人，真死锁例子见
  //       `ADMIN_ROLE_BINDING_CHANGE_APPROVAL`（maker 组只有 CISO 一人持有，已登记见
  //       下方 `S5_KNOWN_DEADLOCKS`）。
  //
  //   P2（maker ∩ checker = ∅，本轮修复轮二恢复，见下方 S5c）：对 P1 覆盖的 28 条策略
  //       中除下方 `MAKER_CHECKER_OVERLAP_EXEMPT` 点名的 5 条之外的其余 23 条，持有
  //       maker 组的角色集合必须与裁决人集合完全不相交——同一职务不能既提单又裁决，
  //       哪怕 maker 组另有安全成员兜底。P1 单独存在时验证不出这个缺口：只要 maker
  //       组还有第二个持有人，P1 就判定"能提"，根本不管这个持有人是不是恰好也是唯一
  //       裁决人——把 `'RECON_ADJUSTMENT_WRITE'` 加进 CFO 绑定（CFO 已是
  //       RECON_ADJUSTMENT_POST 唯一裁决人）、或把 `'SWAP_FEE_LEVEL_WRITE'` 加进
  //       OPS_OFFICER 绑定（OPS_OFFICER 已是三条费率策略唯一裁决人），P1 都因为
  //       TREASURY_OFFICER / CFO 仍是安全 maker 而照样全绿——但业务上就是同一个运营
  //       角色自己提、自己批，没有任何跨部门签字，是本闸门存在的理由本身正被绕开。
  //
  // 为什么不是全部 28 条都要求 P2：本仓库每个角色码在种子数据里只绑一个真人账号（见
  // `ROLE_LOGIN` 花名册），`MAKER_CHECKER_OVERLAP_EXEMPT` 点名的 5 条策略，maker 组是
  // 刻意双持的站点演示装置——checker 就是两个持有人之一，自批被 SoD 当场拒绝，另一
  // 持有人正常提、正常批，业务出路并不会被卡死，这个"双持"事实由 P1 逐次验证（不再
  // 是本轮之前那种只有人工评语担保、代码从不校验的状态）。"重叠即假阳性"这个定性只对
  // 这 5 条成立；其余 23 条没有"刻意双持、checker 是其中之一"这重设计前提，一旦出现
  // 重叠就是真实的 SoD 缺口，必须由 P2 报红，不能被 P1 的"还有安全 maker"结论悄悄
  // 稀释掉。
  //
  // ⚠️ 这张表是**人工维护**的 policy→maker 组映射——代码里没有可推导的关联
  // （谁能提某个审批，取决于哪个端点会建这张单，那是 workflow 的事）。新增
  // maker-checker 型审批策略时**必须往这里加一行**，否则新策略不受本闸门保护。
  // 战役甲波一 Task 8：INCIDENT_CLOSE_TECHSEC 的 maker 横跨三个经办组（技安/数据/运营，
  // 单一动作类型服务四类事故的结案），一个 policy 键装不下一个组名——值类型放宽为
  // `string | string[]`，下方三处消费循环（S5/P1、S5c/P2、S5d 豁免名副其实校验）都要跟着
  // 改：S5/S5c 对数组逐组做同一校验（每个组独立跑一遍原有的单组判据，不是把多个组的持有人
  // 并成一个集合再判），语义上等价于"这条策略实际有几个互不相干的提单人群体，每个群体各自
  // 都不能被唯一裁决人一勺烩"；S5d 取跨组并集（见该处头注释，语义不同）。
  const MAKER_GROUP_BY_POLICY: Record<string, string | string[]> = {
    ASSET_SUSPENSION: 'ASSET_CONFIG_WRITE',
    ASSET_REACTIVATION: 'ASSET_CONFIG_WRITE',
    TRANSACTION_LIMIT_CHANGE: 'TRANSACTION_LIMIT_WRITE',
    SWAP_FEE_LEVEL_CREATION: 'SWAP_FEE_LEVEL_WRITE',
    SWAP_FEE_LEVEL_CHANGE: 'SWAP_FEE_LEVEL_WRITE',
    SWAP_FEE_LEVEL_RETIRE: 'SWAP_FEE_LEVEL_WRITE',
    WITHDRAWAL_FEE_LEVEL_CREATION: 'WITHDRAWAL_FEE_LEVEL_WRITE',
    WITHDRAWAL_FEE_LEVEL_CHANGE: 'WITHDRAWAL_FEE_LEVEL_WRITE',
    WITHDRAWAL_FEE_LEVEL_RETIRE: 'WITHDRAWAL_FEE_LEVEL_WRITE',
    DEPOSIT_CONFISCATION: 'DEPOSIT_CONFISCATE_WRITE',
    DEPOSIT_RETURN: 'DEPOSIT_RETURN_WRITE',
    DEPOSIT_SEIZE: 'DEPOSIT_SEIZE_WRITE',
    DEPOSIT_UNFREEZE: 'DEPOSIT_UNFREEZE_WRITE',
    WITHDRAW_UNFREEZE: 'WITHDRAW_UNFREEZE_WRITE',
    WITHDRAW_SANCTION_REFUND: 'WITHDRAW_REFUND_WRITE',
    SWAP_UNFREEZE: 'SWAP_UNFREEZE_WRITE',
    SWAP_SANCTION_REFUND: 'SWAP_REFUND_WRITE',
    RECON_ADJUSTMENT_POST: 'RECON_ADJUSTMENT_WRITE',
    DEPOSIT_SUPPLEMENT: 'DEPOSIT_SUPPLEMENT_WRITE',
    DEPOSIT_CLAWBACK: 'DEPOSIT_CLAWBACK_WRITE',
    WITHDRAW_RETURN_CLAIM: 'WITHDRAW_RETURN_CLAIM_WRITE',
    INTERNAL_TRANSFER_APPROVAL: 'INTERNAL_TRANSFER_WRITE',
    INCIDENT_CLOSE_SECURITY: 'INCIDENT_WRITE',
    // 战役甲波一 T8 修复轮 1（评审 I2）：INCIDENT_CLOSE_FINANCIAL 服务两个不相干的提单群体——
    // LARGE_UNEXPLAINED/CLIENT_SHORTFALL（FUNDS 族，INCIDENT_WRITE）与 STUCK_TRANSACTION_MAJOR
    // （OPERATIONS 族，INCIDENT_OPS_WRITE，见 incident-type-registry.ts 的 operatorGroup）。此前
    // 只登记了 INCIDENT_WRITE，STUCK 的提单群体不受自批死锁闸门保护——改数组，两组逐组校验。
    INCIDENT_CLOSE_FINANCIAL: ['INCIDENT_WRITE', 'INCIDENT_OPS_WRITE'],
    ADMIN_SUSPENSION_APPROVAL: 'IAM_MEMBER_MANAGE',
    ADMIN_REACTIVATION_APPROVAL: 'IAM_MEMBER_MANAGE',
    ADMIN_ROLE_BINDING_CHANGE_APPROVAL: 'IAM_ROLE_ASSIGN',
    ADMIN_PASSWORD_RESET: 'IAM_CREDENTIAL_RESET',
    ADMIN_MFA_RESET: 'IAM_CREDENTIAL_RESET',
    AUDIT_EVIDENCE_EXPORT_APPROVAL: 'AUDIT_EXPORT_CREATE',
    CUSTOMER_RESTRICTION_RELEASE_OPS: 'CUSTOMER_RESTRICTION_RELEASE',
    // 以下 5 条波一 T13 修复轮从 MAKER_GROUP_EXEMPT 并入——原先靠人工评语担保「maker 组
    // 双持、总有另一个角色能安全提单」，现在统一走上面的「安全 maker 非空」判据，评语
    // 描述的事实由代码逐次重算，不再是一次性写死的文字担保：
    ADMIN_INVITE_APPROVAL: 'IAM_MEMBER_MANAGE',
    APPROVAL_POLICY_CHANGE: 'GOV_APPROVAL_POLICY_WRITE',
    ROLE_DEFINITION_CREATE: 'IAM_ROLE_DEFINE',
    ROLE_DEFINITION_MODIFY: 'IAM_ROLE_DEFINE',
    CUSTOMER_RESTRICTION_RELEASE_MLRO: 'CUSTOMER_RESTRICTION_RELEASE',
    CUSTOMER_ONBOARDING_ACCEPTANCE: 'CUSTOMER_ONBOARDING_ACCEPT_WRITE',
    CUSTOMER_TIER_UPGRADE: 'CUSTOMER_TIER_UPGRADE_WRITE',
    // 战役甲波一 Task 8：两条新结案链。PRUDENTIAL 单组（财务经办桶）；TECHSEC 三组（技安/
    // 数据/运营经办桶，closeActionType 相同但 operatorGroup 按类型三分）。
    INCIDENT_CLOSE_PRUDENTIAL: 'INCIDENT_FIN_WRITE',
    INCIDENT_CLOSE_TECHSEC: ['INCIDENT_TECH_WRITE', 'INCIDENT_DATA_WRITE', 'INCIDENT_OPS_WRITE'],
    // 战役甲波二 Task 5：报送签发——提单唯合规官（REG_FILING_WRITE），裁决唯高管
    // （SENIOR_MANAGEMENT_OFFICER，不持 REG_FILING_WRITE），maker/checker 天然不相交。
    REG_FILING_SUBMIT: 'REG_FILING_WRITE',
    // 战役甲波三 T4：制裁定性——maker 组同 CUSTOMER_RESTRICTION_RELEASE_MLRO/OPS 复用
    // CUSTOMER_RESTRICTION_RELEASE（合规官持有；MLRO 也持有同组，但 checker 恰是 MLRO
    // 本人——P1 判据要求的"安全 maker 非空"由合规官满足，同款先例，非新增死锁）。
    SANCTION_DISPOSITION: 'CUSTOMER_RESTRICTION_RELEASE',
    // 战役甲波四 T5：RI 换人——提单唯合规官（RI_REGISTER_WRITE），裁决唯高管
    // （SENIOR_MANAGEMENT_OFFICER，不持 RI_REGISTER_WRITE），maker/checker 天然不相交。
    RI_REPLACEMENT: 'RI_REGISTER_WRITE',
    // 战役甲波五 T3：波五：运营提、合规官批。maker 组 COMPLAINT_WRITE 唯运营职务持有
    // （T5 登记），checker 为 COMPLIANCE_OFFICER，两者不相交。
    COMPLAINT_RESOLUTION: 'COMPLAINT_WRITE',
    // 战役甲波五 T3：客户族结案：运营提、合规官批。maker 组复用既有 INCIDENT_OPS_WRITE
    // （运营经办桶），checker 为 COMPLIANCE_OFFICER，两者不相交。
    INCIDENT_CLOSE_CUSTOMER: 'INCIDENT_OPS_WRITE',
  };

  // 有意不进上表的策略——maker 组本身不可判定（不是某个角色权限组闸住的，是系统自己在
  // 建单时自动开单，没有"谁能提交"这个角色层面的概念），上面「安全 maker 非空」判据无从
  // 算起，只能手工读源码确认清楚；S8 保证策略全集 = 上表 ∪ 本表。
  const MAKER_GROUP_EXEMPT: Record<string, string> = {
    WITHDRAW_LARGE_VALUE_APPROVAL:
      '系统在建单时自动开单，没有提单权限组——withdraw-workflow.service.ts 的 ' +
      '@OnEvent(WITHDRAWAL_CREATED) 处理器按 AED 估值超阈值触发 openApprovalGate()，用 ' +
      'SYSTEM_APPROVAL_ACTOR 提交，不经任何 @RequirePermissions 端点',
  };

  // P2（maker ∩ checker = ∅，见上方判据说明）专属豁免表——与上面 `MAKER_GROUP_EXEMPT`
  // 语义不同：这 5 条策略确实在 `MAKER_GROUP_BY_POLICY` 里、确实受 P1 保护（"双持、
  // 其中一人是 checker"这件事由 P1 逐次验证，不是靠本表担保），只是 P2 的"完全不相交"
  // 对它们不适用——maker 组是刻意双持的站点演示装置，checker 恰是两个持有人之一，另一
  // 持有人是安全 maker。原 `MAKER_GROUP_EXEMPT`（波一 T13 修复轮一之前）就是这 5 条 +
  // WITHDRAW_LARGE_VALUE_APPROVAL 共 6 条、担保的正是同一件事，只是当时是整条豁免（P1
  // P2 都不查）；现在把这 5 条挪回来，但只窄化到豁免 P2，P1 仍然覆盖，见 S5c。
  const MAKER_CHECKER_OVERLAP_EXEMPT: Record<string, string> = {
    ADMIN_INVITE_APPROVAL:
      '提单组 IAM_MEMBER_MANAGE 由 CISO 与技术官双持，裁决人 CISO 刻意在其中——自批由 ' +
      'approvals.service 的 SoD 当场拒（站 0 演示装置），TECH_OFFICER 是安全 maker，P1 已验证',
    APPROVAL_POLICY_CHANGE:
      '提单组 GOV_APPROVAL_POLICY_WRITE 由高管与 CISO 双持，裁决人 CISO 刻意在其中——站 3' +
      '「门自己也要过门」演的就是自批被拒，SENIOR_MANAGEMENT_OFFICER 是安全 maker，P1 已验证',
    ROLE_DEFINITION_CREATE:
      '提单组 IAM_ROLE_DEFINE 由 CISO 与技术官双持，裁决人 CISO 在其中（站 1），' +
      'TECH_OFFICER 是安全 maker，P1 已验证',
    ROLE_DEFINITION_MODIFY: '同 ROLE_DEFINITION_CREATE',
    CUSTOMER_RESTRICTION_RELEASE_MLRO:
      '提单组 CUSTOMER_RESTRICTION_RELEASE 由 MLRO 与合规官双持，裁决人 MLRO 在其中（合规官' +
      '提、MLRO 批；MLRO 自提自批被 SoD 拒），COMPLIANCE_OFFICER 是安全 maker，P1 已验证',
    SANCTION_DISPOSITION:
      '战役甲波三 T4：定性提单复用「解限制」提单组 CUSTOMER_RESTRICTION_RELEASE（合规官已' +
      '持有，不新增组）——同 CUSTOMER_RESTRICTION_RELEASE_MLRO 一样的双持结构，裁决人 MLRO ' +
      '恰在该组内（合规官提、MLRO 批；MLRO 自提自批被 SoD 拒），COMPLIANCE_OFFICER 是安全 ' +
      'maker，P1 已验证',
    ADMIN_ROLE_BINDING_CHANGE_APPROVAL:
      '提单组 IAM_ROLE_ASSIGN 由 CISO 与技术官双持，裁决人 CISO 刻意在其中——自批由 ' +
      'approvals.service 的 SoD 当场拒（业主拍板甲案，形状同 ADMIN_INVITE_APPROVAL），' +
      'TECH_OFFICER 是安全 maker，P1 已验证',
  };

  // 已知但未修的自批死锁登记——与上面 MAKER_GROUP_EXEMPT 语义不同：豁免表登记的是「maker
  // 组不可判定」；这张表登记的是**真实死锁**（按上方判据算出安全 maker 集合确实为空），
  // S5 依然要为它们报红，只是红得可辨认——见下方专门打印的 ⚠ 行，且不计入"未登记死锁 = 0"
  // 这条判据本身的失败数，避免整个脚本永久红、训练所有人对红视而不见。值 = BACKLOG 落点，
  // 方便一眼找到谁在跟这件事、决定了没有。**唯一合法的清空方式**：业主拍板两个候选修法
  // 之一并落地后，删掉这一行——届时 S5 的主判据自动收紧回"零已知死锁"，不用额外改判据
  // 代码。登记条目本身是否仍站得住由下面的 S5b 守着，不是写一次就永久信任。
  // 目前为空——这是正常终态，不是"忘了写"。历史：2026-09-04 Task 13 曾在此登记
  // ADMIN_ROLE_BINDING_CHANGE_APPROVAL（S8 新增全覆盖判据后第一次照见的既有死锁），同日业主
  // 拍板甲案（给 TECH_OFFICER 加 IAM_ROLE_ASSIGN）真正修掉，按上面写的"唯一合法清空方式"删除。
  // 那条策略随即转登记进 MAKER_CHECKER_OVERLAP_EXEMPT——CISO 双持是刻意的，能提不能批的
  // 安全 maker 由 TECH_OFFICER 提供，P1 继续守着。
  // 战役甲波一 T8 修复轮 1（评审 M2）：本表键仍是 actionType（策略），不是"策略+组"的复合键——
  // MAKER_GROUP_BY_POLICY 数组化后，若某个数组条目（如 INCIDENT_CLOSE_TECHSEC 的某一组）
  // 出现真死锁而要登记，登记的是整个 actionType，覆盖面是该策略名下**所有**组（下面 S5 循环
  // 按 `actionType in S5_KNOWN_DEADLOCKS` 判定，不区分是数组里哪一组），不能只登记"某一组"。
  const S5_KNOWN_DEADLOCKS: Record<string, string> = {};

  const holdersOf = (group: string): string[] =>
    Object.entries(RBAC_ROLE_GROUP_BINDINGS)
      .filter(([role, groups]) => role !== 'SUPER_ADMIN' && (groups as string[]).includes(group))
      .map(([role]) => role);

  // MAKER_GROUP_BY_POLICY 的值现在是 `string | string[]`——统一成数组，标量条目退化成
  // 单元素数组，下游循环对两种形状一视同仁（逐组跑同一判据）。
  const asGroupList = (value: string | string[]): string[] => (Array.isArray(value) ? value : [value]);

  const deadlocks: string[] = [];
  const registeredDeadlocks: string[] = [];
  const missingFromTable: string[] = [];
  const staleDeadlocks: string[] = [];
  let gatedPolicies = 0;

  for (const [actionType, makerGroupValue] of Object.entries(MAKER_GROUP_BY_POLICY)) {
    const policy = (DEFAULT_APPROVAL_POLICIES as Record<string, any>)[actionType];
    if (!policy) {
      missingFromTable.push(`${actionType}（表里有、策略里没有——策略被删或改名了？）`);
      continue;
    }
    gatedPolicies += 1;
    const checkers = new Set<string>(policy.steps.flatMap((st: any) => st.roles as string[]));
    // 逐组跑同一判据——数组型条目（如 INCIDENT_CLOSE_TECHSEC 的三个经办组）里每个组
    // 各自独立判定，不是把多组持有人并成一个集合；标量条目退化成单元素数组，行为不变。
    for (const makerGroup of asGroupList(makerGroupValue)) {
      const makers = new Set(holdersOf(makerGroup));
      // 安全 maker = 持有 maker 组、但不在裁决人集合里的角色——这种角色永远能正常提单，
      // 不会被 SoD 卡死。集合为空才是真死锁（见上方判据说明）。
      const safeMakers = [...makers].filter((r) => !checkers.has(r));
      if (safeMakers.length === 0) {
        // makers.size === 0 是另一种坏：不是「唯一提单人也是裁决人」，是压根没人持有这个
        // maker 组——没人能提单，跟"能提但会被自批拦"是两件不同的事，措辞不能混为一谈。
        const msg = makers.size === 0
          ? `${actionType}: 持 ${makerGroup} 的角色集合为空——没有任何角色持有这个 maker 组，没人能提单`
          : `${actionType}: 持 ${makerGroup} 的角色 {${[...makers].join(',')}} 全部同时在裁决人集合 {${[...checkers].join(',')}} 里——没有一个角色能提但不能批，唯一提单人必自批（SoD 拒绝）`;
        if (actionType in S5_KNOWN_DEADLOCKS) {
          registeredDeadlocks.push(`${msg} —— 已登记：${S5_KNOWN_DEADLOCKS[actionType]}`);
        } else {
          deadlocks.push(msg);
        }
      } else if (actionType in S5_KNOWN_DEADLOCKS) {
        // S5b 的核心：登记表说这是死锁，但按当前绑定算出来已经不是了（比如业主已经把
        // 候选修法之一落地，给了另一个角色安全提单的能力）——登记条目过期了，必须报出来
        // 要求清理，不能悄悄放行，否则未来有人真把重叠改回来，登记表会把新死锁也一并吞掉。
        staleDeadlocks.push(
          `${actionType}（现在存在安全 maker {${safeMakers.join(',')}}，已不再是死锁，应从 S5_KNOWN_DEADLOCKS 删除）`,
        );
      }
    }
  }

  // 登记了但压根对不上当前 MAKER_GROUP_BY_POLICY / DEFAULT_APPROVAL_POLICIES 的登记条目
  // ——同样是过期登记（比如维护表那一行被删了，或策略改名了，登记表忘了跟着删/改）。
  for (const actionType of Object.keys(S5_KNOWN_DEADLOCKS)) {
    if (!(actionType in MAKER_GROUP_BY_POLICY)) {
      staleDeadlocks.push(`${actionType}（登记条目不在 MAKER_GROUP_BY_POLICY 里，应清理登记）`);
    } else if (!(DEFAULT_APPROVAL_POLICIES as Record<string, any>)[actionType]) {
      staleDeadlocks.push(`${actionType}（登记条目指向的策略已不存在，应清理登记）`);
    }
  }

  check(
    'S5 自批死锁闸门（无未登记的自批死锁；已登记死锁见下方 ⚠ 行，不计入本判据）',
    deadlocks.length === 0 && missingFromTable.length === 0,
    deadlocks.length === 0 && missingFromTable.length === 0
      ? `${gatedPolicies} 条 maker-checker 策略逐条验过，无任何未登记的自批死锁` +
        (registeredDeadlocks.length > 0
          ? `（另有 ${registeredDeadlocks.length} 条已登记死锁待业主裁决，见下方 ⚠ 行）`
          : '')
      : [...deadlocks, ...missingFromTable].join(' ｜ '),
  );
  knownDeadlockCount = registeredDeadlocks.length;

  // S5b：已登记死锁名副其实（镜像 S1/S1b 的白名单核验模式）—— 登记条目一旦按当前判据算出
  // 来已经不是死锁了，就该从 S5_KNOWN_DEADLOCKS 删掉；不删的话，未来某次真重叠又发生时，
  // 登记表会把这个"新问题"也一并悄悄放行，S5 的「未登记死锁 = 0」判据也就不再收紧。
  check(
    'S5b 已登记死锁名副其实（确认登记条目仍是真死锁）',
    staleDeadlocks.length === 0,
    staleDeadlocks.length === 0
      ? `${Object.keys(S5_KNOWN_DEADLOCKS).length} 条登记全部确认仍是真死锁`
      : `以下登记条目已过期，应清理: ${staleDeadlocks.join(' ｜ ')}`,
  );

  // 已登记死锁的可见提示——不是 check()，不计入 failed 计数（S5 本身可以整体绿），但也
  // 不是静默通过：单独一行、⚠ 符号（区别于 ✓/✗），点名策略 + BACKLOG 落点，任何人扫一眼
  // 输出都能看到这不是"全干净"，只是"已知问题、业主还没拍板"。
  for (const line of registeredDeadlocks) {
    console.log(`⚠ S5 已登记死锁（不计入判据失败数，需业主裁决）—— ${line}`);
  }

  // ── S5c：maker ≠ checker（P2，波一 T13 修复轮二恢复）────────────────────
  // 见上方判据说明。对 `MAKER_CHECKER_OVERLAP_EXEMPT` 未点名的策略，要求持有 maker 组
  // 的角色集合与裁决人集合完全不相交——单独一个安全 maker 不够，maker 组里不能有任何
  // 一个角色同时也是 checker。已经被上方判定为"无安全 maker"的策略（无论是否已登记）
  // 不重复计入：makers ⊆ checkers 时 makers ∩ checkers = makers ≠ ∅ 必然成立，重叠已经
  // 是那条真死锁本身报出来的同一件事，这里不再算作新发现，避免同一根因被两条判据各报
  // 一次、稀释掉"这是同一个问题"的信号。
  const overlapViolations: string[] = [];
  // 战役甲波一 T8 修复轮 1（评审 M2）：MAKER_GROUP_BY_POLICY 数组化后，下面两个计数器的单位
  // 是 maker 组，不是策略——一条 TECHSEC 策略贡献 3 组。exemptApplied 仍是策略级（豁免判定
  // 发生在进入逐组循环之前，见上面 continue）。三个计数器混着用"条"会谎报（3 组的策略被
  // 数成 3 条），下面 check() 文案按各自真实单位措辞，不统一成"条策略"。
  let overlapChecked = 0; // 组级：通过不相交校验的 maker 组数
  let exemptApplied = 0; // 策略级：豁免表里实际被这个循环用到（consulted）的条目数，见下方判据说明
  let p1SkippedCount = 0; // 组级：已由上方 P1（S5/S5b）报过、这里不重复计入的组数
  for (const [actionType, makerGroupValue] of Object.entries(MAKER_GROUP_BY_POLICY)) {
    if (actionType in MAKER_CHECKER_OVERLAP_EXEMPT) {
      exemptApplied += 1;
      continue;
    }
    const policy = (DEFAULT_APPROVAL_POLICIES as Record<string, any>)[actionType];
    if (!policy) continue; // 已由上方 missingFromTable 报过，这里不重复报
    const checkers = new Set<string>(policy.steps.flatMap((st: any) => st.roles as string[]));
    // 逐组跑同一判据，理由同 S5（P1）上方注释。
    for (const makerGroup of asGroupList(makerGroupValue)) {
      const makers = new Set(holdersOf(makerGroup));
      const safeMakers = [...makers].filter((r) => !checkers.has(r));
      if (safeMakers.length === 0) {
        p1SkippedCount += 1;
        continue; // 已由上方 P1（S5/S5b）报过，见上方注释
      }
      overlapChecked += 1;
      const overlap = [...makers].filter((r) => checkers.has(r));
      if (overlap.length > 0) {
        overlapViolations.push(
          `${actionType}: ${overlap.join('/')} 既持 ${makerGroup}（能提）又在裁决人集合 {${[...checkers].join(',')}} 里（能批）——若确系刻意保留的双持豁免，加进 MAKER_CHECKER_OVERLAP_EXEMPT 并写明理由；若不是，就是真实 SoD 缺口，应上报给上级会话处理，禁止为了让闸门变绿而把它塞进豁免表`,
        );
      }
    }
  }
  check(
    'S5c maker≠checker（不相交判据：同一职务不得既是提单人又是裁决人；MAKER_CHECKER_OVERLAP_EXEMPT 显式豁免的 7 条站点演示策略除外）',
    overlapViolations.length === 0,
    overlapViolations.length === 0
      ? `豁免 ${exemptApplied} 条策略；其余按 maker 组逐组验证 maker 与 checker 角色集合不相交：${overlapChecked} 组确认不相交，另有 ${p1SkippedCount} 组已被 P1 判定无安全 maker、不重复计入`
      : overlapViolations.join(' ｜ '),
  );

  // ── S5d：MAKER_CHECKER_OVERLAP_EXEMPT 名副其实（镜像 S1b/S5b 的白名单核验模式）───
  // 这张豁免表是第三张手工维护的逃生表（另两张是 S1b 守的 ROUTE_ORPHAN_WHITELIST、S5b
  // 守的 S5_KNOWN_DEADLOCKS），本轮之前一直没配套的名副其实校验，两种腐坏都能悄悄
  // 潜伏而全绿：
  //   (a) 垃圾/改名键——S5c 的豁免统计只从 MAKER_GROUP_BY_POLICY 出发，一个不存在的
  //       策略代码压根不会被那个循环遍历到，于是白白占位而不受任何约束；S8 也不覆盖
  //       这张表（S8 读的是另一张 MAKER_GROUP_EXEMPT，语义不同，见上方注释）。
  //   (b) 陈旧豁免——登记时那条策略确实重叠，后来 maker 或 checker 绑定改了、不再
  //       重叠，登记条目却还留着；未来一次不相关的绑定改动如果又造出真重叠，会被这条
  //       陈旧豁免不经任何人审视地悄悄放行，而不是被 S5c 正常报红。
  const exemptGhosts: string[] = [];
  const exemptStale: string[] = [];
  for (const actionType of Object.keys(MAKER_CHECKER_OVERLAP_EXEMPT)) {
    const makerGroupValue = MAKER_GROUP_BY_POLICY[actionType];
    const policy = (DEFAULT_APPROVAL_POLICIES as Record<string, any>)[actionType];
    if (!makerGroupValue || !policy) {
      exemptGhosts.push(`${actionType}（不在 MAKER_GROUP_BY_POLICY 或 DEFAULT_APPROVAL_POLICIES 里，应删除）`);
      continue;
    }
    // 本表目前只登记标量条目（见上方 S5d 头注释），union 展开对标量退化为原逻辑；数组型
    // 条目一旦将来被登记进这张豁免表，取的是跨组持有人并集，与本判据"是否仍真实重叠"
    // 的语义一致（不区分是哪个组重叠）。
    const makers = new Set(asGroupList(makerGroupValue).flatMap((g) => holdersOf(g)));
    const checkers = new Set<string>(policy.steps.flatMap((st: any) => st.roles as string[]));
    const overlap = [...makers].filter((r) => checkers.has(r));
    if (overlap.length === 0) {
      exemptStale.push(`${actionType}（豁免已不需要，应删除）`);
    }
  }
  check(
    'S5d MAKER_CHECKER_OVERLAP_EXEMPT 名副其实（豁免键存在且仍真实重叠）',
    exemptGhosts.length === 0 && exemptStale.length === 0,
    exemptGhosts.length === 0 && exemptStale.length === 0
      ? `${Object.keys(MAKER_CHECKER_OVERLAP_EXEMPT).length} 条豁免全部确认键存在且仍真实重叠`
      : [...exemptGhosts, ...exemptStale].join(' ｜ '),
  );

  // ── S8：MAKER 表与策略一一对应 ────────────────────────────────────────
  // 交付清单要求：新增 maker-checker 策略必须往 MAKER_GROUP_BY_POLICY 加一行——此前靠人记，
  // 波一起由本判据守：策略全集 == 表 ∪ 豁免表，且两表不相交、表里没有策略里不存在的键。
  const policyKeys = new Set(Object.keys(DEFAULT_APPROVAL_POLICIES));
  const tableKeys = new Set(Object.keys(MAKER_GROUP_BY_POLICY));
  const exemptKeys = new Set(Object.keys(MAKER_GROUP_EXEMPT));
  const uncovered = [...policyKeys].filter((k) => !tableKeys.has(k) && !exemptKeys.has(k));
  const unknown = [...tableKeys, ...exemptKeys].filter((k) => !policyKeys.has(k));
  const overlap = [...tableKeys].filter((k) => exemptKeys.has(k));
  check(
    'S8 MAKER 表与策略一一对应（策略全集 = 表 ∪ 豁免表，两表不相交）',
    uncovered.length === 0 && unknown.length === 0 && overlap.length === 0,
    uncovered.length === 0 && unknown.length === 0 && overlap.length === 0
      ? `${policyKeys.size} 条策略：${tableKeys.size} 条受 S5 保护 + ${exemptKeys.size} 条显式豁免`
      : `未覆盖 ${uncovered.join(',') || '无'} ｜ 表里有策略里没有 ${unknown.join(',') || '无'} ｜ 两表重叠 ${overlap.join(',') || '无'}`,
  );

  // ── S9：裁决人看得见 entityRef 的详情页 ────────────────────────────────
  // 镜像 admin-web/src/pages/approvalEntityRoutes.ts 的 ENTITY_ROUTE_BY_ACTION（表本体在
  // scripts/verify-rbac.tables.ts 的 DETAIL_READ_GROUP_BY_POLICY）：审批详情页把 entityRef
  // 链到业务详情页，裁决人若没有那页的读权限，点过去就是 403——"能批却看不见批的是什么"。
  const blindCheckers: string[] = [];
  for (const [actionType, readGroup] of Object.entries(DETAIL_READ_GROUP_BY_POLICY)) {
    const policy = (DEFAULT_APPROVAL_POLICIES as Record<string, any>)[actionType];
    if (!policy) { blindCheckers.push(`${actionType}（策略不存在）`); continue; }
    for (const st of policy.steps) {
      for (const role of st.roles as string[]) {
        if (role === 'SUPER_ADMIN') continue;
        if (!(RBAC_ROLE_GROUP_BINDINGS[role] as string[] | undefined)?.includes(readGroup)) {
          blindCheckers.push(`${actionType}: 裁决人 ${role} 不持 ${readGroup}`);
        }
      }
    }
  }
  check(
    'S9 裁决人持有 entityRef 详情页读权限（镜像 ApprovalDetailPage 回链映射）',
    blindCheckers.length === 0,
    blindCheckers.length === 0
      ? `${Object.keys(DETAIL_READ_GROUP_BY_POLICY).length} 条带回链的策略，裁决人都看得见要批的对象`
      : blindCheckers.join(' ｜ '),
  );

  // ── S10：新权限组「四处齐」+ 唯 MLRO 持有（战役甲波三 T6：REG_FILING_AML_WRITE）──
  // 项目铁律（CLAUDE.md 派发要点）：新权限组必须四处齐——PermissionGroup 联合类型成员｜
  // 至少一条 route() 挂载｜ACTION_BUCKET_CATALOG 某桶挂载｜至少一个职务持有——少一处
  // 这个组在演示里就点不到（有码没入口、有入口没权限、或压根没人能拿到）。联合类型这一处
  // 由 tsc 在编译期收口（下方任一处 `groups: [...]` 字面量若写了不是类型成员的字符串，
  // `groups: PermissionGroup[]` 的类型标注就通不过 tsc——本脚本靠 npx tsc --noEmit 那道
  // 随手闸兜底，这里只做另外三处运行时可验的）。
  const AML_WRITE_GROUP: PermissionGroup = 'REG_FILING_AML_WRITE';
  const amlRoutes = RBAC_PERMISSION_DEFINITIONS.filter((d) => d.groups.includes(AML_WRITE_GROUP));
  const amlBuckets = ACTION_BUCKET_CATALOG.flatMap((domain) => domain.buckets).filter((b) =>
    b.groups.includes(AML_WRITE_GROUP),
  );
  const amlHolders = Object.entries(RBAC_ROLE_GROUP_BINDINGS).filter(([, groups]) =>
    (groups as PermissionGroup[]).includes(AML_WRITE_GROUP),
  );
  check(
    'S10a REG_FILING_AML_WRITE 四处齐（route() / ACTION_BUCKET_CATALOG 桶 / 职务持有；联合类型由 tsc 收口）',
    amlRoutes.length >= 1 && amlBuckets.length >= 1 && amlHolders.length >= 1,
    `route ${amlRoutes.length} 条（含 cap.filing.aml 标记码）、bucket ${amlBuckets.length} 个（filings.aml-desk）、` +
      `持有职务 ${amlHolders.length} 个（${amlHolders.map(([r]) => r).join(',') || '无'}）`,
  );
  check(
    'S10b REG_FILING_AML_WRITE 唯 MLRO 持有（AML 报送族无签发链，非 MLRO 一律不得亲办）',
    amlHolders.length === 1 && amlHolders[0][0] === 'MLRO',
    amlHolders.length === 1 && amlHolders[0][0] === 'MLRO'
      ? '持有职务集合恰为 {MLRO}'
      : `持有职务集合为 {${amlHolders.map(([r]) => r).join(',')}}，期望恰好 {MLRO}`,
  );

  // ── S11：合规办公室四组「四处齐」+ 唯一持有断言（战役甲波四 T5/T6）──────
  // 同 S10 范式：四个新组（COMPLIANCE_OFFICE_VIEW/OBLIGATION_WRITE/VENDOR_REGISTER_
  // WRITE/RI_REGISTER_WRITE）一次性核验 route() 挂载 / ACTION_BUCKET_CATALOG 桶挂载 /
  // 职务持有均 >=1（联合类型成员由 tsc 收口，同 S10 头注释）；再加两条唯一持有断言——
  // 三写组唯合规官（一组一门，与波三报送台"两经办人共享一组"的形状不同，见
  // rbac.catalog.ts T5 域注释），COMPLIANCE_OFFICE_VIEW 恰为五职务（合规官/MLRO/高管/
  // 内审/CISO——裁决人或候选 RI 都要看得见闹钟墙/合规日历/两册）。
  const COMPLIANCE_OFFICE_GROUPS: PermissionGroup[] = [
    'COMPLIANCE_OFFICE_VIEW', 'OBLIGATION_WRITE', 'VENDOR_REGISTER_WRITE', 'RI_REGISTER_WRITE',
  ];
  const groupCoverage = COMPLIANCE_OFFICE_GROUPS.map((g) => {
    const groupRoutes = RBAC_PERMISSION_DEFINITIONS.filter((d) => d.groups.includes(g));
    const groupBuckets = ACTION_BUCKET_CATALOG.flatMap((domain) => domain.buckets).filter((b) => b.groups.includes(g));
    const groupHolders = Object.entries(RBAC_ROLE_GROUP_BINDINGS)
      .filter(([, groups]) => (groups as PermissionGroup[]).includes(g))
      .map(([role]) => role);
    return { group: g, routes: groupRoutes.length, buckets: groupBuckets.length, holders: groupHolders };
  });
  const uncoveredGroups = groupCoverage.filter((c) => c.routes < 1 || c.buckets < 1 || c.holders.length < 1);
  check(
    'S11a 合规办公室四组四处齐（route() / ACTION_BUCKET_CATALOG 桶 / 职务持有；联合类型由 tsc 收口）',
    uncoveredGroups.length === 0,
    uncoveredGroups.length === 0
      ? groupCoverage.map((c) => `${c.group}: route ${c.routes}/bucket ${c.buckets}/职务 ${c.holders.length}`).join('；')
      : `未齐全: ${uncoveredGroups.map((c) => `${c.group}(route ${c.routes}/bucket ${c.buckets}/职务 ${c.holders.length})`).join(', ')}`,
  );

  const groupHoldersOf = (g: PermissionGroup) => groupCoverage.find((c) => c.group === g)!.holders;
  const WRITE_GROUPS: PermissionGroup[] = ['OBLIGATION_WRITE', 'VENDOR_REGISTER_WRITE', 'RI_REGISTER_WRITE'];
  const writeMismatch = WRITE_GROUPS.filter((g) => {
    const holders = groupHoldersOf(g);
    return !(holders.length === 1 && holders[0] === 'COMPLIANCE_OFFICER');
  });
  check(
    'S11b 三写组唯合规官持有（OBLIGATION_WRITE / VENDOR_REGISTER_WRITE / RI_REGISTER_WRITE，一组一门）',
    writeMismatch.length === 0,
    writeMismatch.length === 0
      ? '三组持有职务集合均恰为 {COMPLIANCE_OFFICER}'
      : `不符: ${writeMismatch.map((g) => `${g}={${groupHoldersOf(g).join(',') || '空'}}`).join(', ')}`,
  );

  const viewHolders = new Set(groupHoldersOf('COMPLIANCE_OFFICE_VIEW'));
  const expectedViewHolders = new Set(['COMPLIANCE_OFFICER', 'MLRO', 'SENIOR_MANAGEMENT_OFFICER', 'INTERNAL_AUDITOR', 'CISO']);
  const viewSetsEqual = viewHolders.size === expectedViewHolders.size &&
    [...expectedViewHolders].every((r) => viewHolders.has(r));
  check(
    'S11c COMPLIANCE_OFFICE_VIEW 恰为 {合规官,MLRO,高管,内审,CISO}',
    viewSetsEqual,
    viewSetsEqual
      ? `持有职务集合恰为 {${[...viewHolders].join(',')}}`
      : `持有职务集合为 {${[...viewHolders].join(',')}}，期望恰为 {${[...expectedViewHolders].join(',')}}`,
  );

  // ── S12：投诉两组「四处齐」+ 唯一持有断言（战役甲波五 T5/T6）────────────────
  // 同 S10/S11 范式：两个新组（COMPLAINT_READ/COMPLAINT_WRITE）一次性核验 route() 挂载 /
  // ACTION_BUCKET_CATALOG 桶挂载 / 职务持有均 >=1（联合类型成员由 tsc 收口，同 S10/S11
  // 头注释）；不新增域，两个桶挂既有 incidents 域（rbac.catalog.ts T5 域注释）。再加两条
  // 精确持有断言——COMPLAINT_WRITE 唯 OPS_OFFICER 持有（运营受理调查投诉，裁决人合规官
  // 走审批工单角色路由，不经这张写权限组，同报送台/RI 换人「提单人不持裁决组」反向先例）；
  // COMPLAINT_READ 恰为 {COMPLIANCE_OFFICER, MLRO, INTERNAL_AUDITOR}（裁决人 + 两个治理侧
  // 只读职务要看得见事件登记域里发生了什么，同 REG_FILING_READ/COMPLIANCE_OFFICE_VIEW 先例）。
  // 两条新审批策略（COMPLAINT_RESOLUTION/INCIDENT_CLOSE_CUSTOMER）在 MAKER_GROUP_BY_POLICY
  // 里已由 T3 登记（见上方 S5/S8 消费的那张表本体）——策略全集覆盖由已有的 S8「MAKER 表与
  // 策略一一对应」自动兜住，不必在这里重复一条判据。
  const COMPLAINT_GROUPS: PermissionGroup[] = ['COMPLAINT_READ', 'COMPLAINT_WRITE'];
  const complaintCoverage = COMPLAINT_GROUPS.map((g) => {
    const groupRoutes = RBAC_PERMISSION_DEFINITIONS.filter((d) => d.groups.includes(g));
    const groupBuckets = ACTION_BUCKET_CATALOG.flatMap((domain) => domain.buckets).filter((b) => b.groups.includes(g));
    const groupHolders = Object.entries(RBAC_ROLE_GROUP_BINDINGS)
      .filter(([, groups]) => (groups as PermissionGroup[]).includes(g))
      .map(([role]) => role);
    return { group: g, routes: groupRoutes.length, buckets: groupBuckets.length, holders: groupHolders };
  });
  const uncoveredComplaintGroups = complaintCoverage.filter((c) => c.routes < 1 || c.buckets < 1 || c.holders.length < 1);
  check(
    'S12a 投诉两组四处齐（route() / ACTION_BUCKET_CATALOG 桶 / 职务持有；联合类型由 tsc 收口）',
    uncoveredComplaintGroups.length === 0,
    uncoveredComplaintGroups.length === 0
      ? complaintCoverage.map((c) => `${c.group}: route ${c.routes}/bucket ${c.buckets}/职务 ${c.holders.length}`).join('；')
      : `未齐全: ${uncoveredComplaintGroups.map((c) => `${c.group}(route ${c.routes}/bucket ${c.buckets}/职务 ${c.holders.length})`).join(', ')}`,
  );

  const complaintHoldersOf = (g: PermissionGroup) => complaintCoverage.find((c) => c.group === g)!.holders;
  const complaintWriteHolders = complaintHoldersOf('COMPLAINT_WRITE');
  check(
    'S12b COMPLAINT_WRITE 唯运营职务持有',
    complaintWriteHolders.length === 1 && complaintWriteHolders[0] === 'OPS_OFFICER',
    complaintWriteHolders.length === 1 && complaintWriteHolders[0] === 'OPS_OFFICER'
      ? '持有职务集合恰为 {OPS_OFFICER}'
      : `持有职务集合为 {${complaintWriteHolders.join(',') || '空'}}，期望恰为 {OPS_OFFICER}`,
  );

  const complaintReadHolders = new Set(complaintHoldersOf('COMPLAINT_READ'));
  const expectedComplaintReadHolders = new Set(['COMPLIANCE_OFFICER', 'MLRO', 'INTERNAL_AUDITOR']);
  const complaintReadSetsEqual = complaintReadHolders.size === expectedComplaintReadHolders.size &&
    [...expectedComplaintReadHolders].every((r) => complaintReadHolders.has(r));
  check(
    'S12c COMPLAINT_READ 恰为 {合规官,MLRO,内审}',
    complaintReadSetsEqual,
    complaintReadSetsEqual
      ? `持有职务集合恰为 {${[...complaintReadHolders].join(',')}}`
      : `持有职务集合为 {${[...complaintReadHolders].join(',')}}，期望恰为 {${[...expectedComplaintReadHolders].join(',')}}`,
  );
}

// ══════════════════════ S6：前后端权限码表差集 ══════════════════════
//
// admin-web/src/rbac/permissions.ts 是前端手工维护的权限码常量表——不是从后端
// catalog 自动生成。Task 17/18 改 rbac.catalog.ts 的路径参数名（:id → :userNo /
// :approvalNo）时前端漏改过两回，Task 23 又抓到一次纯抄串（WITHDRAW_QUOTES_* 抄了
// swap 的码）——同一类漂移已复发三次。S6 用集合运算挡住它：前端引用的每个
// 'api.xxx' 字面量都必须能在后端 RBAC_PERMISSION_DEFINITIONS 的 code 集合里找到。
//
// permissions.ts 是前端项目（独立 tsconfig / Vite 模块系统）里的文件，没法安全
// import 进本脚本的 ts-node 执行上下文，只能读文本正则抽取字面量——但抽的是「这个
// as const 对象字面量里硬编码了哪些字符串」，是对数据结构本体的机械抽取，判据仍是
// 集合运算（前端集合 ∖ 后端集合 = 空），不是靠字符串匹配给业务行为投绿灯，跟
// S1–S5 同型（不是文件头红线警告的那种「grep 源码文本代替行为验证」）。
function runS6FrontendBackendCodeDiff(): void {
  const permissionsPath = path.resolve(__dirname, '../admin-web/src/rbac/permissions.ts');
  const text = fs.readFileSync(permissionsPath, 'utf8');
  const frontendCodes = new Set<string>();
  const re = /'(api\.[a-z]+\.[a-z0-9_]+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    frontendCodes.add(m[1]);
  }
  const backendCodes = new Set(RBAC_PERMISSION_DEFINITIONS.map((d) => d.code));
  const missing = [...frontendCodes].filter((c) => !backendCodes.has(c));
  check(
    'S6 前后端权限码表差集（前端引用 ∖ 后端 catalog = 空）',
    missing.length === 0,
    missing.length === 0
      ? `前端 permissions.ts ${frontendCodes.size} 个权限码字面量，全部能在后端 catalog（${backendCodes.size} 条）里找到`
      : `前端引用了后端 catalog 里不存在的权限码（抄串/漂移）: ${missing.join(', ')}`,
  );
}

// ══════════════════════ S7：catalog 字典真实性（死行侦测）══════════════════════
//
// RBAC_PERMISSION_DEFINITIONS 每一行声称「这个 method+path 有一个真实端点」，但
// route() 只增不减——某条路由被控制器删除/改名后，没人回来删 catalog.ts 里对应的
// 那行，它会作为「可分配权限」继续留在角色配置界面里，指向一个已经不存在的端点
// （死行）。S7 验证 catalog 每一行都对得上一个真实的 controller 端点。
//
// 「真实端点」的权限码由 AdminPermissionGuard.buildRequestPermissionCode()
// （admin-permission.guard.ts）在运行时推导：@Controller() 基础路径 + 方法级
// @Get/@Post/@Patch/@Put/@Delete 子路径拼接后过 buildPermissionCode()；仅当某端点
// 显式挂 @RequirePermissions(buildPermissionCode(method, path)) 时才以挂的值覆盖
// 推导结果（例如路径参数改名后，实际子路径与 catalog canonical 路径对不上的场景）。
//
// 判据实现二选一（brief Step 4），本次选**静态正则抽取**而非运行时启动第二个
// AppModule 实例枚举路由栈：本脚本一贯只对已运行的服务器发真实 HTTP（见文件头），
// 从不在本进程内二次装配 Nest（上面「不 import demo-lib.ts 本体」那条注释是同一条
// 设计取舍的先例）——不为读一份路由表去背负第二次 Prisma / TigerBeetle 客户端连接
// 的重量与不确定性。代价：joinControllerPath() 是对 admin-permission.guard.ts 同名
// 拼接算法的手工镜像，后者若以后改了拼接规则，这里要跟着改，否则会静默漂移——这点
// 已知且接受（brief 原话「执行者二选一，判据语义相同」）。
//
// 已清零，新死行=红。Task 26 把 12 行死行（8 行旧版直连端点 + 4 行 V7
// funds-layer 遗留）连同 PermissionGroup 联合类型里的 INTERNAL_TRANSFER_READ/
// WRITE 孤儿组一并从 catalog.ts 删掉——白名单不再放过任何 code，S7 从本轮起
// 正式上岗：catalog 里出现的每一行都必须对应一个真实端点，否则当场报红。
//
// 平账 B 批·补单三入口（2026-09-03，Task 1/13）：本批刻意先立地基——route()
// 四行随 PermissionGroup/桶/OPS_OFFICER 一起在 Task 1 登记，供后续 12 个任务
// 消费这些名字；真实 controller 端点分别在后续任务里落地。这四行是「暂未出生」
// 不是「用完没删」，与上面这段注释警惕的腐烂死行不同类——每个对应任务落地 controller
// 后必须把自己那一行从这份白名单删掉，任务收尾前 S7 应重新验证不再需要该条例外。
// Task 7（2026-09-03）落地 POST /withdraw-transactions/:withdrawNo/return-claim
// 控制器后删掉最后一行——本批四条暂未出生的 route() 已全部有真实端点，白名单清空。
// 平账二期（2026-09-05，Task 3/8）：五条 route() 与 Task 3 一起登记、Task 8 落地控制器后清空——
// 与 B 批「暂未出生」同类，不是腐烂死行。
// 平账二期 Task 8（2026-09-05）落地五条控制器后清空——白名单再次为空。
//
// 战役甲波一 T9（Ruling-9）：以下五个 cap.incident.* 码是 IncidentService.assertOperator
// 的服务层门标记（rbac.catalog.ts :474-478，method: 'MARKER'），不是真实路由——
// 设计如此，不是腐烂死行，S7 判定逻辑本身不放宽，只在这张白名单里显式点名这五个码。
//
// 战役甲波三 T6：两类新增例外，理由不同，都不是腐烂死行——
//   · cap.filing.general / cap.filing.aml：同上，RegulatoryFilingService.assertFamily 的
//     服务层门标记码，method: 'MARKER'，永久性例外（跟 cap.incident.* 同类，不会「出生」
//     成真路由）。
//   （close-no-filing 端点曾以「暂未出生」列此白名单；T3 controller 落地后已按约删除。）
const S7_PENDING_DEAD_ROWS = new Set<string>([
  'cap.incident.funds',
  'cap.incident.tech',
  'cap.incident.data',
  'cap.incident.ops',
  'cap.incident.fin',
  'cap.filing.general',
  'cap.filing.aml',
]);

/** 镜像 admin-permission.guard.ts#buildRequestPermissionCode 的拼接算法——不是重新
 *  发明；两处若不一致，S7 会跟着不准，见上方大注释的已知取舍。 */
function joinControllerPath(controllerPath: string, methodPath: string): string {
  const parts = [controllerPath, methodPath]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .map((part) => part.replace(/^\/+|\/+$/g, ''));
  return `/${parts.join('/')}`.replace(/\/+/g, '/');
}

/** 每个 *.controller.ts 恰好一个 @Controller('...')（已核实）：基础路径 + 每个
 *  HTTP 动词方法的子路径推导一个码；文件内任意 buildPermissionCode('M','p') 字面量
 *  再并入（显式 @RequirePermissions 覆盖值）。两者并集即「真实存在的端点码」。 */
function collectRealControllerCodes(): Set<string> {
  const controllerFiles: string[] = [];
  const srcRoot = path.resolve(__dirname, '../src');
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.controller.ts')) controllerFiles.push(full);
    }
  };
  walk(srcRoot);

  const codes = new Set<string>();
  const controllerRe = /@Controller\(\s*'([^']*)'\s*\)/;
  const verbRe = /@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?\s*\)/g;
  const literalRe = /buildPermissionCode\(\s*'([A-Z]+)'\s*,\s*'([^']+)'\s*\)/g;

  for (const full of controllerFiles) {
    const text = fs.readFileSync(full, 'utf8');

    const controllerMatch = controllerRe.exec(text);
    if (controllerMatch) {
      const controllerPath = controllerMatch[1];
      let vm: RegExpExecArray | null;
      verbRe.lastIndex = 0;
      while ((vm = verbRe.exec(text)) !== null) {
        const joined = joinControllerPath(controllerPath, vm[2] ?? '');
        codes.add(buildPermissionCode(vm[1].toUpperCase(), joined));
      }
    }

    let lm: RegExpExecArray | null;
    literalRe.lastIndex = 0;
    while ((lm = literalRe.exec(text)) !== null) {
      codes.add(buildPermissionCode(lm[1], lm[2]));
    }
  }
  return codes;
}

function runS7CatalogDeadRows(): void {
  const realCodes = collectRealControllerCodes();
  const deadRows = RBAC_PERMISSION_DEFINITIONS.filter((d) => !realCodes.has(d.code));
  const unexpectedDeadRows = deadRows.filter((d) => !S7_PENDING_DEAD_ROWS.has(d.code));
  check(
    'S7 catalog 字典真实性（死行仅限 S7_PENDING_DEAD_ROWS 白名单）',
    unexpectedDeadRows.length === 0,
    unexpectedDeadRows.length === 0
      // M3 修准（T9 修1）：白名单不再恒为空——T9 起常驻 5 条 cap.incident.* 服务层门标记码
      // （Ruling-6），如实报"白名单外零死行"，不再说"已清零"。
      ? `catalog ${RBAC_PERMISSION_DEFINITIONS.length} 行中死行 ${deadRows.length} 个，白名单外零死行（白名单 ${S7_PENDING_DEAD_ROWS.size} 条，见 Ruling-6：cap.incident.* 服务层门标记码，非路由）`
      : `以下 catalog 行找不到对应的真实 controller 端点，且不在白名单内: ${unexpectedDeadRows.map((d) => d.code).join(', ')}`,
  );
}

// ══════════════════════ 路径存在性预检 ══════════════════════

/**
 * 路由真相源 = `RBAC_PERMISSION_DEFINITIONS`（源码常量），**不是** `GET /admin/iam/permissions`。
 *
 * 2026-08-31 评审逮到：那个端点读的是 DB 的 permissions 表，而 `seed.base.ts` 只
 * `upsert` 从不删除 —— 它是**只增不减的历史超集**（实测 201 行 vs 源码当时 146 条
 * `route()`，含 55 条已退役的老端点）。用它当真相源会留一个窄口子：探针若误用了某条
 * 「退役但历史上真实存在过」的路径，预检会放行，随后打到死端点拿 404，而 ALLOW 分支
 * 判据是「非 403」—— 404 照单全收，**正是本预检要防的那个假绿**。
 *
 * 改用源码常量后，真相源与守卫实际加载的路由表同源，且省掉一次 HTTP 往返。
 */
function collectLiveRoutes(): Set<string> {
  return new Set(
    RBAC_PERMISSION_DEFINITIONS.map((d) => `${String(d.method).toUpperCase()} ${d.path}`),
  );
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
  /**
   * 仅 DENY 探针可选（战役甲波三 T6：报送台按族独占）。默认只认精确 403（见上方红线
   * 注释）；报送台的 family 独占门是 RegulatoryFilingService.assertFamily 在 DTO
   * ValidationPipe 之后跑的业务层判定（ForbiddenException → 403），但 T6 登记这两条
   * 探针时 T3 的服务层实现仍在并行推进，不能保证请求体每个字段都刚好绕过校验管线走到
   * assertFamily 那一步——若校验管线先拦一步会吐 400，不是族门本身的信号但同样是
   * "这个族被挡住了"。显式放宽到 [403, 400] 两个族独占探针专用，不改其余探针的默认
   * 行为（未设置此字段一律仍是精确 403）。
   */
  denyStatuses?: number[];
  /**
   * 仅 ALLOW 探针可选（战役甲波一 T9 修1，评审 M4）：请求成功（非 403）后做收尾清理——
   * 本脚本一贯的行为化写法会真建出业务行（ALLOW 探针不是只读探测），不清理就留一条真实
   * 事故单残留在库里，撞 T11 demo 剧本按事故清单遍历/计数。清理本身失败只报一条独立的
   * check() 失败，不影响探针本身的 ALLOW/DENY 判据。
   */
  cleanup?: (ctx: { json: any; token: string }) => Promise<void>;
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
  {
    section: '钱包地址只在金库', name: '金库官 可以 恢复提现地址', method: 'POST',
    routePattern: '/admin/withdrawal-addresses/:addressNo/unsuspend', path: `/admin/withdrawal-addresses/${NOPE}/unsuspend`,
    role: 'treasury', expect: 'ALLOW', body: { reason: 'verify:rbac probe' },
  },
  {
    section: '钱包地址只在金库', name: '运营 不得 恢复提现地址', method: 'POST',
    routePattern: '/admin/withdrawal-addresses/:addressNo/unsuspend', path: `/admin/withdrawal-addresses/${NOPE}/unsuspend`,
    role: 'ops_officer', expect: 'DENY', body: { reason: 'verify:rbac probe' },
  },

  // ── 资产暂停 / 恢复只在运营（波一：技术官只剩 IAM）──────────
  {
    section: '资产管控只在运营', name: '运营 可以 提暂停资产', method: 'POST',
    routePattern: '/admin/assets/:assetNo/suspend', path: `/admin/assets/${NOPE}/suspend`,
    role: 'ops_officer', expect: 'ALLOW', body: { reason: 'verify:rbac probe' },
  },
  {
    section: '资产管控只在运营', name: '技术官 不得 提暂停资产', method: 'POST',
    routePattern: '/admin/assets/:assetNo/suspend', path: `/admin/assets/${NOPE}/suspend`,
    role: 'tech_admin', expect: 'DENY', body: { reason: 'verify:rbac probe' },
  },
  {
    section: '资产管控只在运营', name: '金库官 不得 提恢复资产', method: 'POST',
    routePattern: '/admin/assets/:assetNo/reactivate', path: `/admin/assets/${NOPE}/reactivate`,
    role: 'treasury', expect: 'DENY',
  },

  // ── 费率退役只在 CFO ─────────────────────────────────────
  {
    section: '费率只在 CFO', name: '财务 可以 提退役费率等级', method: 'POST',
    routePattern: '/admin/swap-fee-levels/:levelCode/retire', path: `/admin/swap-fee-levels/${NOPE}/retire`,
    role: 'cfo', expect: 'ALLOW', body: { reason: 'verify:rbac probe' },
  },
  {
    section: '费率只在 CFO', name: '运营 不得 提退役费率等级', method: 'POST',
    routePattern: '/admin/withdrawal-fee-levels/:levelCode/retire', path: `/admin/withdrawal-fee-levels/${NOPE}/retire`,
    role: 'ops_officer', expect: 'DENY', body: { reason: 'verify:rbac probe' },
  },

  // ── 推资金单只在金库（对账平账两角色定案 2026-09-10：FUNDS_ORDER_ACT 随对账整组从
  //    OPS_OFFICER 迁入 TREASURY_OFFICER，原 V4 后半 + 矩阵头条断言翻向）─────
  {
    section: '推单只在金库', name: '金库官 可以 推资金单', method: 'POST',
    routePattern: '/admin/funds-orders/:fundsOrderNo/push/sync', path: `/admin/funds-orders/${NOPE}/push/sync`,
    role: 'treasury', expect: 'ALLOW',
  },
  {
    section: '推单只在金库', name: '运营 不得 推资金单', method: 'POST',
    routePattern: '/admin/funds-orders/:fundsOrderNo/push/sync', path: `/admin/funds-orders/${NOPE}/push/sync`,
    role: 'ops_officer', expect: 'DENY',
  },

  // ── 重对账触发只在金库（平账处置改版第 6 任务：RECON_RUN_WRITE 随处置权一并迁出 OPS，
  //    运营退出案件页）────────────────────────────────────
  {
    section: '重对账触发只在金库', name: '金库官 可以 跑对账批次', method: 'POST',
    routePattern: '/admin/reconciliation/runs/wallet', path: '/admin/reconciliation/runs/wallet',
    role: 'treasury', expect: 'ALLOW', body: { cutoff: new Date().toISOString() },
  },
  {
    section: '重对账触发只在金库', name: '运营 不得 跑对账批次', method: 'POST',
    routePattern: '/admin/reconciliation/runs/wallet', path: '/admin/reconciliation/runs/wallet',
    role: 'ops_officer', expect: 'DENY',
  },

  // ── V4 前半：只持 FUNDS_ORDER_VIEW 的职务看得见、推不动 ──
  // 对账平账两角色定案（2026-09-10）：治理不再是「treasury 只读、ops 能推」——名单里
  // 'treasury' 换成 'ops_officer'（金库现持 FUNDS_ORDER_ACT，反倒是运营只剩 FUNDS_ORDER_VIEW）。
  ...(['auditor', 'cfo', 'ops_officer', 'sm', 'mlro', 'tech_admin'].flatMap((role): DirectionalProbe[] => [
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

  // ── 事故登记按族分权（战役甲波一 T9）：路由是五桶 OR 的粗门，真正把关的是
  //    IncidentService.assertOperator 按 cfg.operatorMarkerCode 精确判定持有人所在族
  //    （incident-type-registry.ts）。正向：技术官持 INCIDENT_TECH_WRITE，登得进
  //    TECH_SECURITY 族；反向两条互证"粗门放行、细门仍挡"不是摆设——金库持 INCIDENT_WRITE
  //    （FUNDS 族）却挡不住登 CYBER_BCDR，技术官反过来也登不了 FUNDS 族的
  //    UNAUTHORIZED_OUTFLOW。
  //    M2 修准（T9 修1）：请求顺序其实是 ValidationPipe（controller 级
  //    `@UsePipes(new ValidationPipe(...))`，框架层，先于控制器方法体跑）→ 控制器方法体
  //    → workflow.register() 里的 assertOperator（业务层，见
  //    incident-registration-workflow.service.ts）——ValidationPipe 先于 assertOperator，
  //    不是反过来。下面两条 DENY 探针特意把 title/description 一并带全（满足
  //    ValidationPipe 的必填校验），才能真正跑到 assertOperator 那一步拿到 403；若省掉
  //    title/description，ValidationPipe 会先吐 400，探针就测不到族门这件事了。ALLOW 一条
  //    额外带 CYBER_BCDR 的两个必填锚（affectedSystem/bcdrTriggered，见
  //    incident-type-registry.ts），验证的正是 RegisterIncidentBodyDto.subjectRefs 这条
  //    此前从未有真实 HTTP 走过的链路（T5 修2 头注释：HTTP 真链路验证由 T9 正向探针承接）。
  {
    section: '事故登记按族(T9)', name: '技术官 可以 登记技安事故(CYBER_BCDR)', method: 'POST',
    routePattern: '/admin/incidents', path: '/admin/incidents',
    role: 'tech_admin', expect: 'ALLOW',
    body: {
      type: 'CYBER_BCDR',
      title: 'RBAC probe — cyber/BCDR incident',
      description: 'verify:rbac positive probe for CYBER_BCDR registration by TECH_OFFICER',
      subjectRefs: { affectedSystem: 'OTHER', bcdrTriggered: true },
    },
    // M4 修复（T9 修1）：这条探针真建出一条 CYBER_BCDR 事故（REGISTERED），不是只读探测——
    // 不清理会在库里留一条真实事故行，撞 T11 demo 剧本按事故清单遍历/计数。登记成功后立即
    // 用同一 token（tech_admin 持 cap.incident.tech，REGISTERED→WITHDRAWN 是显式迁移表允许
    // 的边）撤回，reason 写明"probe cleanup"，把探针自己的脚印收干净。
    cleanup: async ({ json, token }) => {
      const incidentNo = json?.incidentNo;
      if (!incidentNo) {
        check('[事故登记按族(T9)] 探针收尾清理', false, '响应体没有 incidentNo，无法撤回');
        return;
      }
      const { status } = await call('POST', `/admin/incidents/${incidentNo}/withdraw`, token, {
        reason: 'probe cleanup',
      });
      check(
        '[事故登记按族(T9)] 探针收尾清理 · 撤回自建事故',
        status === 201,
        `POST /admin/incidents/${incidentNo}/withdraw → ${status}（期望 201，把探针建出的 ${incidentNo} 转 WITHDRAWN）`,
      );
    },
  },
  {
    section: '事故登记按族(T9)', name: '金库 不得 登记技安事故(CYBER_BCDR)', method: 'POST',
    routePattern: '/admin/incidents', path: '/admin/incidents',
    role: 'treasury', expect: 'DENY',
    body: { type: 'CYBER_BCDR', title: 'RBAC probe', description: 'verify:rbac negative probe' },
  },
  {
    section: '事故登记按族(T9)', name: '技术官 不得 登记资金族事故(UNAUTHORIZED_OUTFLOW)', method: 'POST',
    routePattern: '/admin/incidents', path: '/admin/incidents',
    role: 'tech_admin', expect: 'DENY',
    body: { type: 'UNAUTHORIZED_OUTFLOW', title: 'RBAC probe', description: 'verify:rbac negative probe' },
  },

  // ── 报送台经办唯合规官、签发唯高管（战役甲波二 Task 5）───────────────────
  // 正向：合规官持 REG_FILING_WRITE，手工开一条 MATERIAL_CHANGE_NOTIFICATION（不要求
  // incidentNo，defaultAuthority=VARA，走 openManual 的非 requiresIncident 分支）。开单
  // 成功即真建出一条 DRAFT 行，照 M4 先例用同一 token 立即 cancel 收脚印（DRAFT→CANCELLED
  // 是显式迁移表允许的边），不留业务行撞后续 demo 剧本。反向：ops/treasury/tech_admin
  // 三个不持 REG_FILING_WRITE 的角色（spec §6 点名的三反面）各挡一条。
  {
    section: '报送台经办唯合规官', name: '合规官 可以 手工开单(MATERIAL_CHANGE_NOTIFICATION)', method: 'POST',
    routePattern: '/admin/regulatory-filings', path: '/admin/regulatory-filings',
    role: 'compliance_lead', expect: 'ALLOW',
    body: { type: 'MATERIAL_CHANGE_NOTIFICATION', title: 'RBAC probe — material change filing' },
    cleanup: async ({ json, token }) => {
      const filingNo = json?.filingNo;
      if (!filingNo) {
        check('[报送台经办唯合规官] 探针收尾清理', false, '响应体没有 filingNo，无法作废');
        return;
      }
      const { status } = await call('POST', `/admin/regulatory-filings/${filingNo}/cancel`, token, {
        reason: 'probe cleanup',
      });
      check(
        '[报送台经办唯合规官] 探针收尾清理 · 作废自建报送单',
        status === 201,
        `POST /admin/regulatory-filings/${filingNo}/cancel → ${status}（期望 201，把探针建出的 ${filingNo} 转 CANCELLED）`,
      );
    },
  },
  {
    section: '报送台经办唯合规官', name: '运营 不得 手工开单', method: 'POST',
    routePattern: '/admin/regulatory-filings', path: '/admin/regulatory-filings',
    role: 'ops_officer', expect: 'DENY',
    body: { type: 'MATERIAL_CHANGE_NOTIFICATION', title: 'RBAC probe — material change filing' },
  },
  {
    section: '报送台经办唯合规官', name: '金库 不得 手工开单', method: 'POST',
    routePattern: '/admin/regulatory-filings', path: '/admin/regulatory-filings',
    role: 'treasury', expect: 'DENY',
    body: { type: 'MATERIAL_CHANGE_NOTIFICATION', title: 'RBAC probe — material change filing' },
  },
  {
    section: '报送台经办唯合规官', name: '技术官 不得 手工开单', method: 'POST',
    routePattern: '/admin/regulatory-filings', path: '/admin/regulatory-filings',
    role: 'tech_admin', expect: 'DENY',
    body: { type: 'MATERIAL_CHANGE_NOTIFICATION', title: 'RBAC probe — material change filing' },
  },

  // ── 报送台按族独占（战役甲波三 T6，spec §6 / plan T3）───────────────────────
  // 波三起报送台不再是「单经办组」：写路由对合规官（REG_FILING_WRITE）与 MLRO
  // （REG_FILING_AML_WRITE）两组 OR 放行——上面「报送台经办唯合规官」几条测的是路由级
  // 粗门，还成立（ops/treasury/tech_admin 两组都不持）。这里测的是路由放过之后、服务层
  // RegulatoryFilingService.assertFamily 按被开单 type 的 family 做的族独占判定：合规官
  // 推得动 GENERAL 族、推不动 AML 族；MLRO 反过来。双向各一条，互证"粗门放行、细门仍挡"
  // 不是摆设（同 T9 事故按族分权先例）。expect DENY 用 denyStatuses:[403,400]——见
  // DirectionalProbe.denyStatuses 头注释，T3 服务层落地前/校验管线顺序未定时的显式容差。
  {
    section: '报送台按族独占(T6)', name: '合规官 不得 开 AML 单(STR)', method: 'POST',
    routePattern: '/admin/regulatory-filings', path: '/admin/regulatory-filings',
    role: 'compliance_lead', expect: 'DENY', denyStatuses: [403, 400],
    body: { type: 'STR', title: 'RBAC probe — AML family probe (STR), must be denied for compliance officer' },
  },
  {
    section: '报送台按族独占(T6)', name: 'MLRO 不得 开 GENERAL 单(MATERIAL_CHANGE_NOTIFICATION)', method: 'POST',
    routePattern: '/admin/regulatory-filings', path: '/admin/regulatory-filings',
    role: 'mlro', expect: 'DENY', denyStatuses: [403, 400],
    body: { type: 'MATERIAL_CHANGE_NOTIFICATION', title: 'RBAC probe — GENERAL family probe, must be denied for MLRO' },
  },

  // ── 合规办公室四组门（战役甲波四 T6）─────────────────────────────────
  // 三条纯权限闸 DENY：Guard 先于 Pipe 跑（Nest 请求生命周期 Middleware→Guard→
  // Interceptor(前)→Pipe→Handler），这三条不持任何一个新组的角色在 body 校验之前就被
  // 挡下，同「资产管控只在运营」等既有先例不需要造合法业务体。ALLOW 方向（合规官
  // 建义务、⚡拨钟唯金库、RI 换人事前审批链）涉及跨请求依赖（要用上一步返回的
  // obligationNo/riNo/approvalNo），走下方专用函数 verifyComplianceObligationsClockProbe /
  // verifyRiReplacementApprovalChain，不进这张静态表。
  {
    section: '合规办公室四组门(T6)', name: '金库 不得 建周期义务', method: 'POST',
    routePattern: '/admin/compliance-obligations', path: '/admin/compliance-obligations',
    role: 'treasury', expect: 'DENY',
  },
  {
    section: '合规办公室四组门(T6)', name: '内审 不得 建外包商登记（内审零写人设不破）', method: 'POST',
    routePattern: '/admin/outsourcing-vendors', path: '/admin/outsourcing-vendors',
    role: 'auditor', expect: 'DENY',
  },
  {
    section: '合规办公室四组门(T6)', name: '运营 不得 看闹钟墙', method: 'GET',
    routePattern: '/admin/compliance-office/clock-wall', path: '/admin/compliance-office/clock-wall',
    role: 'ops_officer', expect: 'DENY',
  },

  // ── 投诉两组门（战役甲波五 T6）─────────────────────────────────────────
  // 两条纯权限闸 DENY：同上「合规办公室四组门」先例，Guard 先于 Pipe/Handler 跑，
  // 不持 COMPLAINT_WRITE/COMPLAINT_READ 的角色在业务层之前就被挡下，不需要真实
  // complaintNo（NOPE 占位即可）。ALLOW 方向（运营受理/合规官裁决/⚡拨钟门控交叉）涉及
  // 跨请求依赖（真实 complaintNo/approvalNo），走下方专用函数
  // verifyComplaintResolutionAndClockCrossProbe，不进这张静态表。
  {
    section: '投诉两组门(T6)', name: '合规官 不得 确认收悉投诉（写面不越界）', method: 'POST',
    routePattern: '/admin/complaints/:complaintNo/acknowledge', path: `/admin/complaints/${NOPE}/acknowledge`,
    role: 'compliance_lead', expect: 'DENY',
    body: { message: 'RBAC probe — should be denied for compliance officer' },
  },
  {
    section: '投诉两组门(T6)', name: '金库 不得 看投诉列表', method: 'GET',
    routePattern: '/admin/complaints', path: '/admin/complaints',
    role: 'treasury', expect: 'DENY',
  },
];

async function runDirectionalProbe(tokens: Record<string, string>, p: DirectionalProbe): Promise<void> {
  const token = tokens[p.role];
  if (!token) {
    check(`[${p.section}] ${p.name}`, false, `角色 ${p.role} 没有可用 token（登录步骤失败？）`);
    return;
  }
  const { status, json } = await call(p.method, p.path, token, p.body);

  if (p.expect === 'DENY') {
    const acceptable = p.denyStatuses ?? [403];
    const ok = acceptable.includes(status);
    const expectLabel = acceptable.join('/');
    if (!ok && (status === 404 || status === 500)) {
      guardOpenCount += 1;
      check(
        `[${p.section}] ${p.name}`, false,
        `GUARD_OPEN —— 期望 ${expectLabel}（权限应挡），实得 ${status}（守卫在此处 fail-open，技术兜底，见 CLAUDE.md §2，不修守卫，记 PRODUCTION-NOTES）`,
      );
    } else {
      check(`[${p.section}] ${p.name}`, ok, `${p.role}@ ${p.method} ${p.path} → ${status}（期望 ${expectLabel}）`);
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

  if (ok && p.cleanup) {
    try {
      await p.cleanup({ json, token });
    } catch (e: any) {
      check(`[${p.section}] ${p.name} · 探针收尾清理`, false, `清理失败: ${String(e?.message ?? e)}`);
    }
  }
}

// ══════════════════════ 档位升级读安全（波三终审修三）══════════════════════
//
// GET .../tier-upgrade 对不存在的客户抛 404（getAdminView 真查 CustomerMain），静态
// PROBES 表的 NOPE 占位 id 撑不起 ALLOW 分支必须拿 2xx 的判据，故不进静态表——单独一
// 个函数，先用真实 HTTP（GET /customers?take=1，CUSTOMER_READ 组，运营/超管均持有）
// 取一个真实种子客户号，再用同一个 customerNo 跑下面两条：都不写数据——ALLOW 纯读；
// DENY 落在 AdminPermissionGuard（controller 方法体之前），压根碰不到业务层。
async function verifyTierUpgradeReadDenyPair(tokens: Record<string, string>): Promise<void> {
  const label = '档位升级读安全 · 取种子客户号';
  const { status: listStatus, json: listBody } = await call('GET', '/customers?take=1', tokens.admin);
  const seedCustomerNo = listBody?.data?.[0]?.customerNo;
  if (listStatus !== 200 || !seedCustomerNo) {
    check(label, false, `GET /customers?take=1 → ${listStatus}，拿不到真实 customerNo，无法继续`);
    return;
  }
  check(label, true, `取到 ${seedCustomerNo}`);

  const readPath = `/admin/customers/${seedCustomerNo}/tier-upgrade`;
  const { status: readStatus } = await call('GET', readPath, tokens.ops_officer);
  check(
    '[档位升级读安全] 运营 可以 看档位升级全貌', readStatus >= 200 && readStatus < 300,
    `ops_officer@ GET ${readPath} → ${readStatus}（期望 2xx）`,
  );

  const submitPath = `/admin/customers/${seedCustomerNo}/tier-upgrade-acceptance`;
  const { status: submitStatus } = await call('POST', submitPath, tokens.sm, { reason: 'verify:rbac probe' });
  check(
    '[档位升级读安全] 高管 不得 提档位升级核准', submitStatus === 403,
    `sm@ POST ${submitPath} → ${submitStatus}（期望 403，maker 是运营不是高管）`,
  );
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
  if (!approvalNo) {
    check(label, false, 'POST /admin/iam/role-definitions/:roleId/modify 响应体缺 approvalNo');
    return;
  }

  const { status: approveStatus, json: approveBody } = await call('POST', `/admin/control-gates/approvals/${approvalNo}/approve`, cisoToken, {
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
  if (!approvalNo) {
    check('V3 裁决只认审批策略', false, 'POST /admin/swap-fee-levels 响应体缺 approvalNo');
    return;
  }

  const { status: denyStatus } = await call('POST', `/admin/control-gates/approvals/${approvalNo}/approve`, tokens.treasury, {
    reason: 'verify:rbac V3 probe — non-checker role, expect denied',
  });
  check(
    'V3 裁决只认审批策略 —— treasury@（持 GOV_APPROVAL_READ 但策略未点名）approve 必须被拒',
    denyStatus === 403,
    `POST approve as treasury@ → ${denyStatus}（期望 403）`,
  );

  const { status: allowStatus, json: allowBody } = await call('POST', `/admin/control-gates/approvals/${approvalNo}/approve`, tokens.ops_officer, {
    reason: 'verify:rbac V3 probe — the policy-named checkerRole, expect allowed',
  });
  check(
    'V3 裁决只认审批策略 —— ops_officer@（SWAP_FEE_LEVEL_CREATION 策略点名的唯一 checkerRole）approve 必须成功',
    allowStatus >= 200 && allowStatus < 300,
    `POST approve as ops_officer@ → ${allowStatus}${allowStatus >= 300 ? ' ' + JSON.stringify(allowBody) : ''}（期望 2xx）`,
  );
}

// ══════════════════════ AML 单全生命周期零审批单（战役甲波三 T6，spec §6 / plan T3）══════
//
// spec §6：「报送台单不产生签发审批单（无链断言）」——AML 族（STR/SAR/CNMR/PNMR/HRC/
// HRCA）MLRO 亲办，DRAFT→SUBMITTED 直达，不经 GENERAL 族那条「提单唯合规官、裁决唯
// 高管」的 REG_FILING_SUBMIT 审批策略（该策略只服务 GENERAL 族的 signoff 端点）。用真实
// HTTP 走一遍 STR 全生命周期（open → mark-submitted → close），核验全程不产生任何审批
// 单——GET /admin/control-gates/approvals?entityRef=filingNo 应命中零条（ApprovalQueryDto
// 原生支持 entityRef 精确过滤，见 approvals.service.ts list()，不是客户端分页兜底）。
//
// 依赖 T3 落地的服务层（RegulatoryFilingService.assertFamily 放行 MLRO 开 AML 单、
// markSubmitted AML 族跳过 signoff 前置闸）——T6 登记本函数时 T3 仍在并行推进（同一
// worktree 内可见未提交改动），本函数只用 T3 计划改动范围内、已确认落地的三个既有端点
// （open/mark-submitted/close，均无需 T3 新增的 close-no-filing controller 或
// externalCaseRef 字段），headless 环境（无真栈）会在更早的登录步骤就失败退出，本函数
// 实际不会被跑到——留给收尾闸联跑，不在本任务伪造通过。
async function verifyAmlFilingNoApprovalChain(tokens: Record<string, string>): Promise<void> {
  const mlroToken = tokens.mlro;
  if (!mlroToken) {
    check('[AML单零签发链(T6)] 前置条件', false, 'mlro token 不可用（登录步骤失败？）');
    return;
  }

  const openRes = await call('POST', '/admin/regulatory-filings', mlroToken, {
    type: 'STR',
    title: 'RBAC probe — AML lifecycle no-approval-chain (STR)',
    externalCaseRef: 'RBAC-PROBE-CASE-REF', // STR requiresExternalCaseRef（T3 业务闸）；缺则 400 探针中止——终审红1修
  });
  const filingNo = openRes.json?.filingNo;
  check(
    '[AML单零签发链(T6)] MLRO 开 STR 单（AML 族，assertFamily 应放行）',
    openRes.status === 201 && !!filingNo,
    `POST /admin/regulatory-filings(type=STR) → ${openRes.status}（期望 201）`,
  );
  if (openRes.status !== 201 || !filingNo) {
    return; // 开单本身失败，后续步骤无 filingNo 可用，不继续往下跑
  }

  const submitRes = await call('POST', `/admin/regulatory-filings/${filingNo}/mark-submitted`, mlroToken, {
    externalRef: 'RBAC-PROBE-EXTERNAL-REF',
  });
  check(
    '[AML单零签发链(T6)] MLRO 标已提交（DRAFT→SUBMITTED 直达，不经 signoff）',
    submitRes.status === 201,
    `POST /admin/regulatory-filings/${filingNo}/mark-submitted → ${submitRes.status}（期望 201）`,
  );

  const closeRes = await call('POST', `/admin/regulatory-filings/${filingNo}/close`, mlroToken, {
    note: 'verify:rbac probe cleanup',
  });
  check(
    '[AML单零签发链(T6)] MLRO 关闭 STR 单（收尾清理，SUBMITTED→CLOSED 是族内合法边）',
    closeRes.status === 201,
    `POST /admin/regulatory-filings/${filingNo}/close → ${closeRes.status}（期望 201）`,
  );

  const approvalsRes = await call(
    'GET',
    `/admin/control-gates/approvals?entityRef=${encodeURIComponent(filingNo)}`,
    mlroToken,
  );
  const total = approvalsRes.json?.total;
  check(
    '[AML单零签发链(T6)] 全生命周期零审批单（无签发链断言）',
    approvalsRes.status === 200 && total === 0,
    approvalsRes.status !== 200
      ? `GET /admin/control-gates/approvals?entityRef=${filingNo} → ${approvalsRes.status}（期望 200）`
      : `entityRef=${filingNo} 命中审批单 ${total} 条（期望 0——AML 族 DRAFT→SUBMITTED 不经 REG_FILING_SUBMIT 审批策略）`,
  );
}

// ══════════════════════ 合规义务写权 + ⚡ 拨钟唯金库（战役甲波四 T6）══════════
//
// 合规官真建一条周期义务（ALLOW——POST /admin/compliance-obligations 没有 id 路径段，
// 走合法请求体才能验证"写权确实能落库"而不是只验证 Guard 放行，同 V3 费率夹具/AML单
// 开单先例）；用同一条 obligationNo 接着测 ⚡ simulate-due 唯金库：金库 ALLOW、合规官
// （经办人不是这枚 ⚡ 装置的持有者，装置整体挂 Demo Instruments 组，同报送单⚡先例）
// DENY。不清理——本主体无删除/作废通道（status 只在 ACTIVE/DISABLED 间迁移，语义是
// "启用/停用"不是"撤销"），同 V3 天文数字 markup 费率夹具先例：name/basisNote 里
// 明写"探针夹具"，业务上不会被误当真实义务消费。
async function verifyComplianceObligationsClockProbe(tokens: Record<string, string>): Promise<void> {
  const complianceToken = tokens.compliance_lead;
  if (!complianceToken) {
    check('[合规办公室写权(T6)] 前置条件', false, 'compliance_lead token 不可用（登录步骤失败？）');
    return;
  }

  const createRes = await call('POST', '/admin/compliance-obligations', complianceToken, {
    name: 'RBAC probe obligation — verify:rbac 探针夹具，非真实合规义务',
    frequency: 'ANNUAL',
    authority: 'VARA',
    basisNote: 'verify:rbac probe fixture — not a real regulatory citation',
    nextDueAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
  });
  const obligationNo = createRes.json?.obligationNo;
  check(
    '[合规办公室写权(T6)] 合规官 可以 建周期义务',
    createRes.status === 201 && !!obligationNo,
    `compliance_lead@ POST /admin/compliance-obligations → ${createRes.status}（期望 201${createRes.status >= 300 ? ' ' + JSON.stringify(createRes.json) : ''}）`,
  );
  if (createRes.status !== 201 || !obligationNo) {
    check('[合规办公室四组门(T6)] ⚡ simulate-due 唯金库', false, '前置的义务创建没成功，没有真实 obligationNo 可测，跳过');
    return;
  }

  const treasuryRes = await call('POST', `/admin/compliance-obligations/${obligationNo}/simulate-due`, tokens.treasury);
  check(
    '[合规办公室四组门(T6)] ⚡ 金库 可以 拨快义务到期钟',
    treasuryRes.status === 201,
    `treasury@ POST /admin/compliance-obligations/${obligationNo}/simulate-due → ${treasuryRes.status}（期望 201）`,
  );

  const complianceClockRes = await call('POST', `/admin/compliance-obligations/${obligationNo}/simulate-due`, complianceToken);
  check(
    '[合规办公室四组门(T6)] ⚡ 合规官 不得 拨快义务到期钟（装置唯金库，经办人不是自己的裁决人）',
    complianceClockRes.status === 403,
    `compliance_lead@ POST /admin/compliance-obligations/${obligationNo}/simulate-due → ${complianceClockRes.status}（期望 403）`,
  );
}

// ══════════════════════ RI 换人事前审批链（战役甲波四 T6）══════════════════════
//
// 合规官提单唯一入口是 ComplianceOfficeController.proposeReplacement → 正门
// RiReplacementWorkflowService.initiateReplacement（铁律②门不可绕）。先建一个探针
// 专用 RI 席位（本主体无删除/退役通道，status 恒 ACTIVE——同上方义务夹具先例，
// position 里点名 probe，业务上不会被当成真实席位消费），再提换人拿到真实
// approvalNo；同一席位立刻重复提一次必须 400（assertNoPendingReplacement 在途查
// 重，一席一在途）；最后高管（DEFAULT_APPROVAL_POLICIES[RI_REPLACEMENT] 策略唯一
// checkerRole）走审批中心正门批准，验证"合规官提、高管单步批"（spec §4.2）这条主张
// 的完整往返——不清理，approve 会让探针夹具真正换人，留痕即证据，同 AML 单/V2/V3
// 先例里"批准后不撤销"的既有做法。
async function verifyRiReplacementApprovalChain(tokens: Record<string, string>): Promise<void> {
  const complianceToken = tokens.compliance_lead;
  if (!complianceToken || !tokens.sm) {
    check('[RI换人审批链(T6)] 前置条件', false, 'compliance_lead 或 sm token 不可用（登录步骤失败？）');
    return;
  }

  const seatRes = await call('POST', '/admin/responsible-individuals', complianceToken, {
    position: 'RBAC probe seat — verify:rbac 探针夹具，非真实 VARA 责任人席位',
    incumbentName: 'RBAC Probe Incumbent',
    effectiveFrom: new Date().toISOString(),
  });
  const riNo = seatRes.json?.riNo;
  check(
    '[RI换人审批链(T6)] 前置条件 · 合规官建探针专用 RI 席位',
    seatRes.status === 201 && !!riNo,
    `compliance_lead@ POST /admin/responsible-individuals → ${seatRes.status}（期望 201）`,
  );
  if (seatRes.status !== 201 || !riNo) {
    check('[RI换人审批链(T6)] 合规官 可以 提 RI 换人', false, '前置的席位创建没成功，没有真实 riNo 可测，跳过');
    return;
  }

  const proposeRes = await call('POST', `/admin/responsible-individuals/${riNo}/replacement`, complianceToken, {
    newIncumbentName: 'RBAC Probe Successor',
    effectiveFrom: new Date().toISOString(),
    reason: 'verify:rbac probe — RI replacement chain',
  });
  const approvalNo = proposeRes.json?.approvalNo;
  check(
    '[RI换人审批链(T6)] 合规官 可以 提 RI 换人（开出审批单）',
    proposeRes.status === 201 && !!approvalNo,
    `compliance_lead@ POST /admin/responsible-individuals/${riNo}/replacement → ${proposeRes.status}（期望 201${proposeRes.status >= 300 ? ' ' + JSON.stringify(proposeRes.json) : ''}）`,
  );

  const dupRes = await call('POST', `/admin/responsible-individuals/${riNo}/replacement`, complianceToken, {
    newIncumbentName: 'RBAC Probe Successor Duplicate',
    effectiveFrom: new Date().toISOString(),
    reason: 'verify:rbac probe — duplicate proposal, must be rejected (一席一在途)',
  });
  check(
    '[RI换人审批链(T6)] 合规官 不得 对同一席位重复提换人（在途查重）',
    dupRes.status === 400,
    `compliance_lead@ POST /admin/responsible-individuals/${riNo}/replacement（第二次） → ${dupRes.status}（期望 400）`,
  );

  if (proposeRes.status !== 201 || !approvalNo) {
    check('[RI换人审批链(T6)] 高管 可以 经审批中心批准换人', false, '前置的提单没成功，没有真实 approvalNo 可测，跳过');
    return;
  }

  const approveRes = await call('POST', `/admin/control-gates/approvals/${approvalNo}/approve`, tokens.sm, {
    reason: 'verify:rbac probe — RI replacement approval',
  });
  check(
    '[RI换人审批链(T6)] 高管 可以 经审批中心批准换人（策略唯一 checkerRole）',
    approveRes.status >= 200 && approveRes.status < 300,
    `sm@ POST /admin/control-gates/approvals/${approvalNo}/approve → ${approveRes.status}（期望 2xx${approveRes.status >= 300 ? ' ' + JSON.stringify(approveRes.json) : ''}）`,
  );
}

// ══════════════════════ 投诉裁决链 + ⚡拨钟门控交叉（战役甲波五 T6）══════════════════════

/** 客户登录（照 verify-act1.ts customerLogin 先例：/auth/customer/login + 123456 密码
 *  惯例）——client 面投诉路由零权限码（complaints.client.controller.ts 头注释），不走
 *  loginAs()/ROLE_LOGIN 花名册（那张表只认 admin 职务前缀）。只在下面的探针里现场造一张
 *  真实投诉时使用，不单独 check() 登录动作本身（登录失败会在提交那一步的 catch 里报出）。*/
async function loginAsCustomer(email: string): Promise<string> {
  const res = await fetch(`${API}/auth/customer/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: '123456' }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!body.access_token) {
    throw new Error(`客户登录失败: ${email} → ${res.status} ${JSON.stringify(body)}`);
  }
  return body.access_token as string;
}

/**
 * 两条独立弧，都要真实 complaintNo/approvalNo（跨请求依赖，静态 PROBES 表的 NOPE 占位撑
 * 不起，同 verifyRiReplacementApprovalChain 先例：现场造数、真登录、真 HTTP 往返）：
 *
 *   ① 裁决链：运营受理调查（acknowledge RECEIVED→ACKNOWLEDGED、investigation
 *      ACKNOWLEDGED→INVESTIGATING）→ 提裁决（propose-resolution，开出 COMPLAINT_RESOLUTION
 *      审批单）→ 运营自己批同一张单（maker=checker，SoD 当场拒 403）→ 合规官批（策略唯一
 *      checkerRole，2xx）。onDecided 是异步事件处理器（complaint-resolution-workflow.
 *      service.ts），本函数不等它把投诉落到 RESOLVED，只验 approve() 这次 HTTP 调用本身
 *      的状态码——同 verifyRiReplacementApprovalChain「批准后不撤销，留痕即证据」先例。
 *
 *   ② ⚡ 拨钟门控交叉：另开一张全新投诉（RECEIVED，非终态——simulateTimeout 对终态投诉
 *      400，见 complaints.service.ts 终态守卫，不能复用弧①里已经走向 RESOLVED 的那张单）。
 *      DEMO_CLOCK_WRITE 波五起两族持有方向已翻：金库（现持有者）拨得动、运营（此前持有者，
 *      波五 T5 未再给它这个组）拨不动——同一枚 ⚡ 按钮两个角色一个能点一个不能点，是本轮
 *      判据要留的演示话术素材（task-6-brief.md 原话）。
 */
async function verifyComplaintResolutionAndClockCrossProbe(tokens: Record<string, string>): Promise<void> {
  const opsToken = tokens.ops_officer;
  const complianceToken = tokens.compliance_lead;
  const treasuryToken = tokens.treasury;
  if (!opsToken || !complianceToken || !treasuryToken) {
    check('[投诉裁决链(T6)] 前置条件', false, 'ops_officer / compliance_lead / treasury token 不可用（登录步骤失败？）');
    return;
  }

  let customerToken: string;
  try {
    customerToken = await loginAsCustomer('demo_alice@example.com');
  } catch (e: any) {
    check('[投诉裁决链(T6)] 前置条件 · 客户登录', false, String(e?.message ?? e));
    return;
  }

  // ── 弧①：裁决链 ──────────────────────────────────────────────────
  const submitRes = await call('POST', '/client/me/complaints', customerToken, {
    category: 'SERVICE', subject: 'RBAC probe complaint (resolution chain)',
    description: 'verify:rbac probe fixture — 请勿在演示剧本里当真实客诉引用',
  });
  const complaintNo = submitRes.json?.complaintNo;
  check(
    '[投诉裁决链(T6)] 前置条件 · 客户提交投诉',
    submitRes.status === 201 && !!complaintNo,
    `demo_alice@ POST /client/me/complaints → ${submitRes.status}（期望 201${submitRes.status >= 300 ? ' ' + JSON.stringify(submitRes.json) : ''}）`,
  );
  if (submitRes.status !== 201 || !complaintNo) {
    check('[投诉裁决链(T6)] 运营 可以 确认收悉投诉（RECEIVED→ACKNOWLEDGED）', false, '前置的投诉提交没成功，没有真实 complaintNo 可测，跳过');
    return;
  }

  const ackRes = await call('POST', `/admin/complaints/${complaintNo}/acknowledge`, opsToken, {
    message: 'verify:rbac probe — acknowledged',
  });
  check(
    '[投诉裁决链(T6)] 运营 可以 确认收悉投诉（RECEIVED→ACKNOWLEDGED）',
    ackRes.status >= 200 && ackRes.status < 300,
    `ops_officer@ POST /admin/complaints/${complaintNo}/acknowledge → ${ackRes.status}（期望 2xx${ackRes.status >= 300 ? ' ' + JSON.stringify(ackRes.json) : ''}）`,
  );

  const investigateRes = await call('POST', `/admin/complaints/${complaintNo}/investigation`, opsToken, {});
  check(
    '[投诉裁决链(T6)] 前置条件 · 运营立案调查（ACKNOWLEDGED→INVESTIGATING）',
    investigateRes.status >= 200 && investigateRes.status < 300,
    `ops_officer@ POST /admin/complaints/${complaintNo}/investigation → ${investigateRes.status}（期望 2xx${investigateRes.status >= 300 ? ' ' + JSON.stringify(investigateRes.json) : ''}）`,
  );
  if (investigateRes.status >= 300) {
    check('[投诉裁决链(T6)] 运营 不得 批同一张裁决单（maker≠checker，SoD 拒）', false, '前置的立案调查没成功，链路无法继续，跳过');
    check('[投诉裁决链(T6)] 合规官 可以 经审批中心批准裁决(COMPLAINT_RESOLUTION)', false, '前置的立案调查没成功，链路无法继续，跳过');
    return;
  }

  const proposeRes = await call('POST', `/admin/complaints/${complaintNo}/propose-resolution`, opsToken, {
    outcome: 'UPHELD', resolutionText: 'verify:rbac probe — resolution text',
  });
  const approvalNo = proposeRes.json?.approvalNo;
  check(
    '[投诉裁决链(T6)] 前置条件 · 运营提裁决（开出 COMPLAINT_RESOLUTION 审批单）',
    proposeRes.status >= 200 && proposeRes.status < 300 && !!approvalNo,
    `ops_officer@ POST /admin/complaints/${complaintNo}/propose-resolution → ${proposeRes.status}（期望 2xx${proposeRes.status >= 300 ? ' ' + JSON.stringify(proposeRes.json) : ''}）`,
  );
  if (proposeRes.status >= 300 || !approvalNo) {
    check('[投诉裁决链(T6)] 运营 不得 批同一张裁决单（maker≠checker，SoD 拒）', false, '前置的提裁决没成功，没有真实 approvalNo 可测，跳过');
    check('[投诉裁决链(T6)] 合规官 可以 经审批中心批准裁决(COMPLAINT_RESOLUTION)', false, '前置的提裁决没成功，没有真实 approvalNo 可测，跳过');
    return;
  }

  const opsApproveRes = await call('POST', `/admin/control-gates/approvals/${approvalNo}/approve`, opsToken, {
    reason: 'verify:rbac probe — same-role self approve, must be denied (maker≠checker)',
  });
  check(
    '[投诉裁决链(T6)] 运营 不得 批同一张裁决单（maker≠checker，SoD 拒）',
    opsApproveRes.status === 403,
    `ops_officer@ POST /admin/control-gates/approvals/${approvalNo}/approve → ${opsApproveRes.status}（期望 403）`,
  );

  const complianceApproveRes = await call('POST', `/admin/control-gates/approvals/${approvalNo}/approve`, complianceToken, {
    reason: 'verify:rbac probe — the policy-named checkerRole, expect allowed',
  });
  check(
    '[投诉裁决链(T6)] 合规官 可以 经审批中心批准裁决(COMPLAINT_RESOLUTION)',
    complianceApproveRes.status >= 200 && complianceApproveRes.status < 300,
    `compliance_lead@ POST /admin/control-gates/approvals/${approvalNo}/approve → ${complianceApproveRes.status}（期望 2xx${complianceApproveRes.status >= 300 ? ' ' + JSON.stringify(complianceApproveRes.json) : ''}）`,
  );

  // ── 弧②：⚡ 拨钟门控交叉（第二张全新投诉，避免复用已走向 RESOLVED 的弧①那张单）──────
  const submitRes2 = await call('POST', '/client/me/complaints', customerToken, {
    category: 'SERVICE', subject: 'RBAC probe complaint (clock cross)',
    description: 'verify:rbac probe fixture — 请勿在演示剧本里当真实客诉引用',
  });
  const complaintNo2 = submitRes2.json?.complaintNo;
  check(
    '[⚡拨钟门控交叉(T6)] 前置条件 · 客户提交第二张投诉',
    submitRes2.status === 201 && !!complaintNo2,
    `demo_alice@ POST /client/me/complaints → ${submitRes2.status}（期望 201${submitRes2.status >= 300 ? ' ' + JSON.stringify(submitRes2.json) : ''}）`,
  );
  if (submitRes2.status !== 201 || !complaintNo2) {
    check('[⚡拨钟门控交叉(T6)] 金库 可以 ⚡ 拨快投诉确认钟（现持有者）', false, '前置的第二张投诉提交没成功，没有真实 complaintNo 可测，跳过');
    return;
  }

  const treasurySimRes = await call('POST', `/admin/complaints/${complaintNo2}/simulate-timeout`, treasuryToken, { target: 'ACK' });
  check(
    '[⚡拨钟门控交叉(T6)] 金库 可以 ⚡ 拨快投诉确认钟（现持有者）',
    treasurySimRes.status >= 200 && treasurySimRes.status < 300,
    `treasury@ POST /admin/complaints/${complaintNo2}/simulate-timeout → ${treasurySimRes.status}（期望 2xx${treasurySimRes.status >= 300 ? ' ' + JSON.stringify(treasurySimRes.json) : ''}）`,
  );

  const opsSimRes = await call('POST', `/admin/complaints/${complaintNo2}/simulate-timeout`, opsToken, { target: 'ACK' });
  check(
    '[⚡拨钟门控交叉(T6)] 运营 不得 ⚡ 拨快投诉确认钟（波五起两族拨钟权全归金库，旧持有者已退出）',
    opsSimRes.status === 403,
    `ops_officer@ POST /admin/complaints/${complaintNo2}/simulate-timeout → ${opsSimRes.status}（期望 403）`,
  );
}

// ══════════════════════ main ══════════════════════

async function main(): Promise<void> {
  console.log(`API base: ${API}`);
  console.log('');

  console.log('── 静态部分（读结构）──');
  runStaticChecks();
  runS6FrontendBackendCodeDiff();
  runS7CatalogDeadRows();
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
  const liveRoutes = collectLiveRoutes();
  const usages: RouteUsage[] = [
    ...PROBES.map((p) => ({ section: p.section, name: p.name, method: p.method, routePattern: p.routePattern })),
    { section: '支撑调用', name: '角色列表', method: 'GET', routePattern: '/admin/iam/roles' },
    { section: '支撑调用', name: '提交改角色请求', method: 'POST', routePattern: '/admin/iam/role-definitions/:roleId/modify' },
    { section: '支撑调用', name: '批准审批案', method: 'POST', routePattern: '/admin/control-gates/approvals/:approvalNo/approve' },
    { section: '支撑调用', name: '资产列表', method: 'GET', routePattern: '/assets' },
    { section: '支撑调用', name: '客户列表', method: 'GET', routePattern: '/customers' },
    { section: '档位升级读安全', name: '看档位升级全貌', method: 'GET', routePattern: '/admin/customers/:customerNo/tier-upgrade' },
    { section: '档位升级读安全', name: '提档位升级核准', method: 'POST', routePattern: '/admin/customers/:customerNo/tier-upgrade-acceptance' },
    // 战役甲波四 T6：verifyComplianceObligationsClockProbe / verifyRiReplacementApprovalChain
    // 打的三条路由不在 PROBES 静态表里（需要跨请求依赖上一步返回值），单独登记预检。
    { section: '合规办公室写权(T6)', name: '⚡ 拨快义务到期钟', method: 'POST', routePattern: '/admin/compliance-obligations/:obligationNo/simulate-due' },
    { section: 'RI换人审批链(T6)', name: '建探针专用 RI 席位', method: 'POST', routePattern: '/admin/responsible-individuals' },
    { section: 'RI换人审批链(T6)', name: '提 RI 换人', method: 'POST', routePattern: '/admin/responsible-individuals/:riNo/replacement' },
    // 战役甲波五 T6：verifyComplaintResolutionAndClockCrossProbe 打的三条路由不在 PROBES
    // 静态表里（需要跨请求依赖上一步返回的 complaintNo/approvalNo），单独登记预检——同上
    // T6 波四先例。/client/me/complaints 是客户面路由，零权限码、不进 rbac.catalog（见
    // complaints.client.controller.ts 头注释），不在 RBAC_PERMISSION_DEFINITIONS 派生的
    // liveRoutes 集合里，故意不登记（登记了反而会被路径预检误判为「路由写错」）。
    { section: '投诉裁决链(T6)', name: '运营立案调查', method: 'POST', routePattern: '/admin/complaints/:complaintNo/investigation' },
    { section: '投诉裁决链(T6)', name: '运营提裁决', method: 'POST', routePattern: '/admin/complaints/:complaintNo/propose-resolution' },
    { section: '⚡拨钟门控交叉(T6)', name: '⚡ 拨快投诉钟', method: 'POST', routePattern: '/admin/complaints/:complaintNo/simulate-timeout' },
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

  console.log('── 行为部分：矩阵头条主张（真登录 + 真 HTTP；报送台经办唯合规官、签发唯高管）──');
  for (const p of PROBES) {
    await runDirectionalProbe(tokens, p);
  }
  console.log('');

  console.log('── 档位升级读安全（运营可读 / 高管不可提，零写入）──');
  await verifyTierUpgradeReadDenyPair(tokens);
  console.log('');

  console.log('── V3 裁决只认审批策略 + 费率只在CFO(ALLOW半) ──');
  await verifyPricingCfoAndPolicySoD(tokens);
  console.log('');

  console.log('── AML 单全生命周期零审批单（战役甲波三 T6，无签发链断言）──');
  await verifyAmlFilingNoApprovalChain(tokens);
  console.log('');

  console.log('── 合规义务写权 + ⚡ 拨钟唯金库（战役甲波四 T6）──');
  await verifyComplianceObligationsClockProbe(tokens);
  console.log('');

  console.log('── RI 换人事前审批链：合规官提、高管单步批（战役甲波四 T6）──');
  await verifyRiReplacementApprovalChain(tokens);
  console.log('');

  console.log('── 投诉裁决链 + ⚡ 拨钟门控交叉：运营受理/合规官裁决、拨钟唯金库（战役甲波五 T6）──');
  await verifyComplaintResolutionAndClockCrossProbe(tokens);
  console.log('');

  console.log('── V2 改角色不丢权限（对每个内建角色跑一次 modify→approve 往返）──');
  const v2RoleCodes = RBAC_ROLE_DEFINITIONS.map((r) => r.code).filter((c) => c !== 'SUPER_ADMIN');
  for (const roleCode of v2RoleCodes) {
    await verifyRoleModifyNoLoss(tokens.tech_admin, tokens.ciso, roleCode);
  }
  console.log('');
  console.log(`共 ${failed} 条 FAIL，其中 GUARD_OPEN（守卫 fail-open，非权限配错）${guardOpenCount} 条`);
  // 已登记死锁数带进总结行——下游任务（含人）实际读的判据就是这一行字符串 + 退出码，
  // S5 那条 ⚠ 提示在 ~85 行之前，扫到这一行看不到；不带上就等于把"业主还欠一个裁决"这件
  // 事从最容易读到的地方藏起来了。仍然是 PASS（不是 FAIL）——已登记死锁不改变退出码。
  const passLine = knownDeadlockCount > 0
    ? `ALL RBAC CHECKS PASS（另有 ${knownDeadlockCount} 条已登记死锁待业主裁决）`
    : 'ALL RBAC CHECKS PASS';
  console.log(failed === 0 ? passLine : `FAIL: ${failed} check(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
