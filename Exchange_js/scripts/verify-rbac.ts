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
import { buildPermissionCode } from '../src/modules/identity/access-control/permission-code.util';

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
  // 判据：对每条「maker 权限组唯一确定」的审批策略，
  //        持有该 maker 组的角色集合  ∩  该策略任一步骤的裁决人集合  必须为空。
  //
  // 交集非空 = 存在某个角色既能提又能批 = 该业务出路可能变回死锁（若他恰好是唯一
  // 提单人）或破坏 maker≠checker。终审判定：不补这条判据，未来有人改
  // `approval.constants.ts` 就会把死锁悄悄改回来且无人发现。
  //
  // ⚠️ 这张表是**人工维护**的 policy→maker 组映射——代码里没有可推导的关联
  // （谁能提某个审批，取决于哪个端点会建这张单，那是 workflow 的事）。新增
  // maker-checker 型审批策略时**必须往这里加一行**，否则新策略不受本闸门保护。
  const MAKER_GROUP_BY_POLICY: Record<string, string> = {
    DEPOSIT_CONFISCATION: 'DEPOSIT_CONFISCATE_WRITE',
    DEPOSIT_RETURN: 'DEPOSIT_RETURN_WRITE',
    DEPOSIT_SEIZE: 'DEPOSIT_SEIZE_WRITE',
    DEPOSIT_UNFREEZE: 'DEPOSIT_UNFREEZE_WRITE',
    WITHDRAW_UNFREEZE: 'WITHDRAW_UNFREEZE_WRITE',
    WITHDRAW_SANCTION_REFUND: 'WITHDRAW_REFUND_WRITE',
    TRANSACTION_LIMIT_CREATION: 'TRANSACTION_LIMIT_WRITE',
    TRANSACTION_LIMIT_CHANGE: 'TRANSACTION_LIMIT_WRITE',
    SWAP_FEE_LEVEL_CREATION: 'SWAP_FEE_LEVEL_WRITE',
    SWAP_FEE_LEVEL_CHANGE: 'SWAP_FEE_LEVEL_WRITE',
    WITHDRAWAL_FEE_LEVEL_CREATION: 'WITHDRAWAL_FEE_LEVEL_WRITE',
    WITHDRAWAL_FEE_LEVEL_CHANGE: 'WITHDRAWAL_FEE_LEVEL_WRITE',
    RECON_ADJUSTMENT_POST: 'RECON_ADJUSTMENT_WRITE',
    DEPOSIT_SUPPLEMENT: 'DEPOSIT_SUPPLEMENT_WRITE',
    DEPOSIT_CLAWBACK: 'DEPOSIT_CLAWBACK_WRITE',
    WITHDRAW_RETURN_CLAIM: 'WITHDRAW_RETURN_CLAIM_WRITE',
  };

  const holdersOf = (group: string): string[] =>
    Object.entries(RBAC_ROLE_GROUP_BINDINGS)
      .filter(([role, groups]) => role !== 'SUPER_ADMIN' && (groups as string[]).includes(group))
      .map(([role]) => role);

  const deadlocks: string[] = [];
  const missingFromTable: string[] = [];
  let gatedPolicies = 0;

  for (const [actionType, makerGroup] of Object.entries(MAKER_GROUP_BY_POLICY)) {
    const policy = (DEFAULT_APPROVAL_POLICIES as Record<string, any>)[actionType];
    if (!policy) {
      missingFromTable.push(`${actionType}（表里有、策略里没有——策略被删或改名了？）`);
      continue;
    }
    gatedPolicies += 1;
    const makers = new Set(holdersOf(makerGroup));
    const checkers = new Set<string>(policy.steps.flatMap((st: any) => st.roles as string[]));
    const both = [...makers].filter((r) => checkers.has(r));
    if (both.length > 0) {
      deadlocks.push(
        `${actionType}: ${both.join('/')} 既持 ${makerGroup}（能提）又在裁决人集合 {${[...checkers].join(',')}} 里（能批）`,
      );
    }
  }

  check(
    'S5 自批死锁闸门（裁决人 ∩ 提单权限持有者 = 空）',
    deadlocks.length === 0 && missingFromTable.length === 0,
    deadlocks.length === 0 && missingFromTable.length === 0
      ? `${gatedPolicies} 条 maker-checker 策略逐条验过，无任何角色同时具备提单与裁决资格`
      : [...deadlocks, ...missingFromTable].join(' ｜ '),
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
const S7_PENDING_DEAD_ROWS = new Set<string>([
  'api.post.deposit_transactions_supplement',        // Task ?：POST /deposit-transactions/supplement 控制器落地后删
  'api.post.deposit_transactions_depositno_clawback', // Task ?：POST /deposit-transactions/:depositNo/clawback 控制器落地后删
  'api.post.withdraw_transactions_withdrawno_return_claim', // Task ?：POST /withdraw-transactions/:withdrawNo/return-claim 控制器落地后删
  'api.get.admin_reconciliation_cases_caseno_supplement_candidates', // Task ?：GET .../supplement-candidates 控制器落地后删
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
      ? `catalog ${RBAC_PERMISSION_DEFINITIONS.length} 行中死行 ${deadRows.length} 个（白名单已清零，字典 100% 对应真实端点）`
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
