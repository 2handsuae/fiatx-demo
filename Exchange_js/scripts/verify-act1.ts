// scripts/verify-act1.ts —— 第一幕系统属性行为校验器（Task 29，14 条判据 B0–B14，
//   无 B13——2026-09-06 随材料管理路由族退役摘除，见 Task1 评审修复）
//
// 同范式：verify-rbac.ts 的三条铁规矩——
//   ① 端口从 .stackports 读，绝不写死（写死会打到 main 栈）。
//   ② 每条判据先做路径存在性预检——404 冒充「非 403=通过」的假绿本仓库栽过
//     （verify-rbac.ts 文件头那次事故）。本文件对没有「先证明路由存在的 2xx
//     步骤」的判据（B7/B11/B12），用 RBAC_PERMISSION_DEFINITIONS（已解析的
//     源码常量，不是 grep 文本）核对 method+path 真实存在；其余判据（B0/B4/B6/
//     B9/B10）天然先有一次「正确 key 应 2xx」的步骤在前，同一路由已被验证不是
//     404，不需要再补一次静态核对。
//   ③ 真登录真 HTTP，禁扫源码；B8/B9/B11/B14 的审计断言直查 prisma（比走 HTTP
//     稳），brief 原话「两者都算行为」。
//
// 会写数据（EXPIRED 单、REJECTED 申请单、若干 403 审计行等）——运行顺序见
// doc-final/demo/baseline.md「verify:act1 操作约束」：verify:rbac → verify:act1
// → stack.sh reset → demo:all，绝不在演示前跑。

import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { RBAC_PERMISSION_DEFINITIONS } from '../src/modules/identity/access-control/rbac.catalog';
import { MAX_ADDRESSES_PER_NETWORK } from '../src/modules/asset-treasury/withdrawal-addresses/withdrawal-address.service';

// ══════════════════════ API base（.stackports 探测，同 verify-rbac.ts） ══════════════════════
//
// brief 骨架给的 `/BACKEND_PORT=(\d+)/` 正则读不出真值——本仓库 .stackports 只有
// 一行裸端口数字（stack-common.sh#allocate_worktree_ports 写的格式），不是
// `BACKEND_PORT=xxx`。改用 verify-rbac.ts 已验证过的探测法：整份文件当整数读。

function resolveApiBase(): string {
  if (process.env.API_BASE) return process.env.API_BASE;
  try {
    const stackportsPath = join(__dirname, '..', '..', '.stackports');
    const port = parseInt(readFileSync(stackportsPath, 'utf8').trim(), 10);
    if (Number.isFinite(port)) return `http://localhost:${port}`;
  } catch {
    // 没有 .stackports —— 不是 worktree 自动分端口栈，落回 main 的固定端口。
  }
  return 'http://localhost:3000';
}

const API = resolveApiBase();
const prisma = new PrismaClient();

// ══════════════════════ judge() 记账 ══════════════════════

type Status = 'PASS' | 'FAIL' | 'SKIP';
const results: Array<{ id: string; status: Status; msg: string }> = [];

function judge(id: string, ok: boolean, msg: string): void {
  const status: Status = ok ? 'PASS' : 'FAIL';
  results.push({ id, status, msg });
  console.log(`${ok ? '✓' : '✗'} ${id} ${msg}`);
}

// ══════════════════════ HTTP 小工具 ══════════════════════

async function login(emailPrefix: string): Promise<string> {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${emailPrefix}@fiatx.com`, password: '123456' }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error(`登录失败: ${emailPrefix}@fiatx.com → ${r.status} ${JSON.stringify(j)}`);
  return j.access_token as string;
}

interface CallResult {
  status: number;
  json: any;
  text: string;
}

async function call(method: 'GET' | 'POST', p: string, token?: string, body?: unknown): Promise<CallResult> {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

async function customerLogin(email: string): Promise<string> {
  const r = await fetch(`${API}/auth/customer/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: '123456' }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error(`客户登录失败: ${email} → ${r.status} ${JSON.stringify(j)}`);
  return j.access_token as string;
}

/** 运营提暂停/恢复 → CISO 批 → 等资产落到目标状态 */
async function driveAssetStatus(assetNo: string, target: 'SUSPENDED' | 'ACTIVE', tokens: Record<string, string>): Promise<string> {
  const action = target === 'SUSPENDED' ? 'suspend' : 'reactivate';
  precheckRoute('POST', `/admin/assets/:assetNo/${action}`);
  const req = await call('POST', `/admin/assets/${assetNo}/${action}`, tokens.ops_officer, { reason: `verify:act1 V 组 ${action}` });
  if (req.status >= 300) throw new Error(`${action} → ${req.status} ${req.text}`);
  const approvalNo: string = req.json.approvalNo;
  const ok = await call('POST', `/admin/control-gates/approvals/${approvalNo}/approve`, tokens.ciso, { reason: 'verify:act1' });
  if (ok.status >= 300) throw new Error(`approve ${approvalNo} → ${ok.status} ${ok.text}`);
  const landed = await waitUntil(async () => (await prisma.asset.findFirst({ where: { assetNo } }))?.status === target, 15_000, 300);
  if (!landed) throw new Error(`资产 ${assetNo} 未在 15s 内到 ${target}`);
  return approvalNo;
}

/**
 * V 组夹具补丁（非本波行为——customer-access.service.ts#assertTradingReady，
 * 2026-07-11 交易起始前置门既有闸门）：SWAP/WITHDRAW 动作、以及登记链上提现地址
 * （registerAddress），都要求客户名下已有 ≥1 条 ACTIVE 的 BANK 提现地址；on a
 * freshly-reset stack 没有任何种子会造这条数据（实测 withdrawal_addresses 表
 * reset 后为空）。V 组要测的是资产暂停这道 L1 门，不是这道更早的前置门——用真实
 * HTTP 把它满足掉（同 test/swap-money-arc.e2e-spec.ts 的 ensureWithdrawalAddress
 * 一个道理；那边直接 prisma 造，这里能走 HTTP 就走 HTTP——客户首条法币地址
 * createBankAccount 不设冷却、即时 ACTIVE，不必再劳烦 admin skip-cooling）。
 * 幂等：已有 ACTIVE 法币地址就跳过，避免重跑撞 IBAN 唯一冲突。
 */
/**
 * ISO 13616 IBAN 校验位计算（mod-97）——bank-validator.util.ts 的 validateIban() 只管验证，
 * 这里反过来按客户号派生 BBAN 再算出配套校验位，让 alice/grace 两条法币地址各有各的 IBAN，
 * 不再共用同一个字面量（银行代码沿用原字面量的 37040044，仅账号段换成客户号派生）。
 */
function computeIbanCheckDigits(countryCode: string, bban: string): string {
  const rearranged = `${bban}${countryCode}00`;
  const numeric = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let remainder = '';
  for (const char of numeric) {
    remainder += char;
    remainder = String(Number(remainder) % 97);
  }
  return String(98 - Number(remainder)).padStart(2, '0');
}

async function ensureFiatWithdrawalAddress(token: string, customerId: string, customerNo: string): Promise<void> {
  const existing = await prisma.withdrawalAddress.count({ where: { customerId, addressType: 'BANK', status: 'ACTIVE' } });
  if (existing > 0) return;
  const bban = `37040044${customerNo.replace(/\D/g, '').padStart(10, '0').slice(-10)}`;
  const iban = `DE${computeIbanCheckDigits('DE', bban)}${bban}`;
  const r = await call('POST', '/client/withdrawal-addresses/bank-accounts', token, {
    beneficiaryName: 'Verify Act1 V Group', bankName: 'Deutsche Bank',
    iban, swiftBic: 'DEUTDEFF', ownershipDeclaration: true,
  });
  if (r.status >= 300) throw new Error(`夹具：开首个法币提现地址失败（交易起始前置门）→ ${r.status} ${r.text}`);
}

/**
 * 路径存在性预检（铁规矩②）——真相源 = RBAC_PERMISSION_DEFINITIONS（已被 TS 解析
 * 过一次的源码常量，不是 grep 文本），同 verify-rbac.ts collectLiveRoutes() 的
 * 取舍：种子只增不减导致 GET /admin/iam/permissions 是历史超集，用它当真相源会
 * 放过「退役但历史上真实存在过」的路径，故不用运行时端点核对，直接比对常量。
 */
const LIVE_ROUTES = new Set(
  RBAC_PERMISSION_DEFINITIONS.map((d) => `${String(d.method).toUpperCase()} ${d.path}`),
);

function precheckRoute(method: 'GET' | 'POST', pattern: string): void {
  const key = `${method} ${pattern}`;
  if (!LIVE_ROUTES.has(key)) {
    throw new Error(
      `预检失败：${key} 不在 RBAC_PERMISSION_DEFINITIONS 真实路由清单（${LIVE_ROUTES.size} 条）里，判据路径可能写错，已中止（不产出任何行为判据）`,
    );
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 轮询直到 predicate 为真或超时；返回最后一次求值结果（不是布尔上限截断）。 */
async function waitUntil(predicate: () => Promise<boolean>, timeoutMs: number, intervalMs: number): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() - start >= timeoutMs) return await predicate();
    await sleep(intervalMs);
  }
}

let seq = 0;
/** 夹具专用唯一后缀——时间戳 + 进程内自增序号，同一秒内多次调用也不会撞号。 */
function uniq(): string {
  seq += 1;
  return `${Date.now()}${seq}`;
}

// ══════════════════════ main ══════════════════════

async function main(): Promise<void> {
  console.log(`API base: ${API}`);
  console.log('');

  console.log('── 登录 8 个探针账号 ──');
  const tokens: Record<string, string> = {};
  for (const prefix of ['admin', 'sm', 'mlro', 'ciso', 'tech_admin', 'ops_officer', 'treasury', 'auditor']) {
    tokens[prefix] = await login(prefix);
    console.log(`  ✓ ${prefix}@fiatx.com`);
  }
  console.log('');

  // ══════════════════════ B0–B3：审批超时门（底座 @Cron + ⚡ simulate-timeout）══════════════════════
  //
  // 两张 PENDING 单共享一次夹具：caseA 会被 B0 的 ⚡ 拨过去、caseB 全程留在未来——
  // 同一轮 cron 扫描里天然验出「过期的过、没过期的留」。

  const su1 = uniq();
  const caseA = await prisma.approvalCase.create({
    data: {
      approvalNo: `APR-ACT1-A-${su1}`,
      actionType: 'VERIFY_ACT1_TIMEOUT_PROBE',
      entityRef: `ACT1-TIMEOUT-A-${su1}`,
      createdByUserId: 'verify-act1-fixture',
      status: 'PENDING',
      traceId: `trace-act1-a-${su1}`,
      timeoutAt: new Date(Date.now() + 6 * 60 * 60 * 1000), // 6h 后——B0 的 ⚡ 会把它拨到过去
    },
  });
  await prisma.approvalStep.create({
    data: { approvalCaseId: caseA.id, stepNo: 1, status: 'PENDING', checkerRoleCandidates: 'CISO' },
  });

  const su2 = uniq();
  const caseB = await prisma.approvalCase.create({
    data: {
      approvalNo: `APR-ACT1-B-${su2}`,
      actionType: 'VERIFY_ACT1_TIMEOUT_PROBE',
      entityRef: `ACT1-TIMEOUT-B-${su2}`,
      createdByUserId: 'verify-act1-fixture',
      status: 'PENDING',
      traceId: `trace-act1-b-${su2}`,
      timeoutAt: new Date(Date.now() + 6 * 60 * 60 * 1000), // 全程留在未来，同轮不该被扫到
    },
  });
  await prisma.approvalStep.create({
    data: { approvalCaseId: caseB.id, stepNo: 1, status: 'PENDING', checkerRoleCandidates: 'CISO' },
  });

  precheckRoute('POST', '/admin/control-gates/approvals/:approvalNo/simulate-timeout');
  const b0 = await call('POST', `/admin/control-gates/approvals/${caseA.approvalNo}/simulate-timeout`, tokens.ops_officer);
  judge('B0', b0.status === 200 || b0.status === 201, `POST simulate-timeout(caseA) → ${b0.status}${b0.status >= 300 ? ' ' + b0.text : ''}`);

  console.log('  …轮询 caseA 转 EXPIRED（cron 每分钟一次，预算 90s）');
  const b1ok = await waitUntil(
    async () => {
      const row = await prisma.approvalCase.findUnique({ where: { id: caseA.id } });
      return row?.status === 'EXPIRED';
    },
    90_000,
    3_000,
  );
  judge('B1', b1ok, b1ok ? 'caseA 在 90s 内被 cron 判 EXPIRED' : 'caseA 90s 内未转 EXPIRED——@Cron 未触发或扫描未生效');

  const caseBRow = await prisma.approvalCase.findUnique({ where: { id: caseB.id } });
  judge('B2', caseBRow?.status === 'PENDING', `caseB（未到期）同轮状态=${caseBRow?.status}`);

  const b3 = await call('POST', `/admin/control-gates/approvals/${caseA.approvalNo}/simulate-timeout`, tokens.ops_officer);
  judge('B3', b3.status === 400, `POST simulate-timeout(已过期 caseA) → ${b3.status}（期望 400，不是 500）`);

  // ══════════════════════ B4–B5：审批详情对外用业务键（铁律⑥，Task 17）══════════════════════

  const su3 = uniq();
  const caseC = await prisma.approvalCase.create({
    data: {
      approvalNo: `APR-ACT1-KEY-${su3}`,
      actionType: 'VERIFY_ACT1_KEY_PROBE',
      entityRef: `ACT1-KEY-${su3}`,
      createdByUserId: 'verify-act1-fixture',
      status: 'PENDING',
      traceId: `trace-act1-key-${su3}`,
    },
  });
  const b4 = await call('GET', `/admin/control-gates/approvals/${caseC.approvalNo}`, tokens.ciso);
  judge('B4', b4.status === 200, `GET /admin/control-gates/approvals/<approvalNo> → ${b4.status}`);
  const b5 = await call('GET', `/admin/control-gates/approvals/${caseC.id}`, tokens.ciso);
  judge('B5', b5.status === 404, `同路径拿内部 UUID → ${b5.status}（期望 404）`);

  // ══════════════════════ B6：成员 / 钱包详情对外用业务键（铁律⑥，Task 18）══════════════════════

  const su4 = uniq();
  const userFxB6 = await prisma.user.create({
    data: {
      userNo: `ADM-ACT1-B6-${su4}`,
      email: `verify-act1-b6-${su4}@fiatx.com`,
      password: 'not-a-real-hash',
      role: 'OPS_OFFICER',
      status: 'ACTIVE',
    },
  });
  const walletFxB6 = await prisma.wallet.create({
    data: {
      walletNo: `WA-ACT1-B6-${su4}`, ownerType: 'PLATFORM', ownerId: null, ownerNo: `PLATFORM-ACT1-B6-${su4}`,
      vaultCode: 'F_OPS', walletRole: 'F_OPS', network: 'AED_ZAND', status: 'ACTIVE',
    },
  });
  const b6u200 = await call('GET', `/users/${userFxB6.userNo}`, tokens.treasury);
  const b6u404 = await call('GET', `/users/${userFxB6.id}`, tokens.treasury);
  const b6w200 = await call('GET', `/wallets/${walletFxB6.walletNo}`, tokens.treasury);
  const b6w404 = await call('GET', `/wallets/${walletFxB6.id}`, tokens.treasury);
  judge(
    'B6',
    b6u200.status === 200 && b6u404.status === 404 && b6w200.status === 200 && b6w404.status === 404,
    `users 200/404=${b6u200.status}/${b6u404.status}；wallets 200/404=${b6w200.status}/${b6w404.status}`,
  );

  // ══════════════════════ B7：资产状态迁移表（法二，铁律④）══════════════════════
  // 波一起：上架 / 激活退役，表只剩 ACTIVE⇄SUSPENDED 两边；提单人换运营。
  // 对 ACTIVE 资产打 reactivate 必须被迁移表拒绝（409 + 'Invalid transition'），
  // 而不是请求层另写一条 if——请求层已改走表（asset-reactivation-workflow.service.ts）。

  precheckRoute('POST', '/admin/assets/:assetNo/reactivate');
  const activeAsset = await prisma.asset.findFirstOrThrow({ where: { status: 'ACTIVE' } });
  const b7 = await call('POST', `/admin/assets/${activeAsset.assetNo}/reactivate`, tokens.ops_officer);
  const b7MsgOk = typeof b7.json?.message === 'string' && b7.json.message.includes('Invalid transition');
  judge(
    'B7',
    b7.status === 409 && b7MsgOk,
    `POST reactivate(ACTIVE 资产, ops_officer@) → ${b7.status} ${JSON.stringify(b7.json)}（期望 409 + 'Invalid transition'）`,
  );

  // ══════════════════════ B8：留痕带上下文——B1 那张单的 APPROVAL_EXPIRED 一行 ══════════════════════

  const b8rows = await prisma.auditLogEvent.findMany({
    where: { action: 'APPROVAL_EXPIRED', primarySubjectNo: caseA.approvalNo },
  });
  const b8row = b8rows[0];
  judge(
    'B8',
    b8rows.length === 1 && b8row?.fromStatus === 'PENDING' && b8row?.toStatus === 'EXPIRED',
    `APPROVAL_EXPIRED 行数=${b8rows.length}，fromStatus=${b8row?.fromStatus}，toStatus=${b8row?.toStatus}`,
  );

  // ══════════════════════ B9：两票齐痕（法一纪律1，Task 4）══════════════════════
  //
  // DEPOSIT_SEIZE 现役唯一两步策略（SENIOR_MANAGEMENT_OFFICER → MLRO）。夹具经
  // prisma 直造（与 test/audit-discipline.e2e-spec.ts 同构）：entityRef 是占位
  // 字符串、不对应真实存款单，approve() 触发的 workflow.deposit-seize.decided
  // 会被 deposit-workflow.service.ts#onSeizeDecided 的 NotFoundException 分支静默
  // 吞掉（该分支专为这种情况写的容错），不影响这里的断言。

  const su5 = uniq();
  const seizeCase = await prisma.approvalCase.create({
    data: {
      approvalNo: `APR-ACT1-SEIZE-${su5}`,
      actionType: 'DEPOSIT_SEIZE',
      entityRef: `ACT1-SEIZE-ENTITY-${su5}`,
      createdByUserId: 'verify-act1-fixture',
      status: 'PENDING',
      traceId: `trace-act1-seize-${su5}`,
    },
  });
  await prisma.approvalStep.createMany({
    data: [
      { approvalCaseId: seizeCase.id, stepNo: 1, status: 'PENDING', checkerRoleCandidates: 'SENIOR_MANAGEMENT_OFFICER' },
      { approvalCaseId: seizeCase.id, stepNo: 2, status: 'PENDING', checkerRoleCandidates: 'MLRO' },
    ],
  });
  const b9a = await call('POST', `/admin/control-gates/approvals/${seizeCase.approvalNo}/approve`, tokens.sm, {
    reason: 'verify:act1 B9 first vote',
  });
  const b9b = await call('POST', `/admin/control-gates/approvals/${seizeCase.approvalNo}/approve`, tokens.mlro, {
    reason: 'verify:act1 B9 final vote',
  });
  const b9rows = await prisma.auditLogEvent.findMany({
    where: { action: 'APPROVAL_GRANTED', primarySubjectNo: seizeCase.approvalNo },
  });
  judge(
    'B9',
    b9a.status < 300 && b9b.status < 300 && b9rows.length === 2,
    `sm/mlro 投票 → ${b9a.status}/${b9b.status}；APPROVAL_GRANTED 行数=${b9rows.length}（期望恰 2）`,
  );

  // ══════════════════════ B10：驳回可达（法二迁移表，Task 10）══════════════════════
  //
  // maker=tech_admin@，checker=ciso@（ROLE_DEFINITION_MODIFY 策略唯一 checkerRole）。
  // Role 夹具经 prisma 直造，避免碰任何真实种子角色。

  const su6 = uniq();
  const roleFx = await prisma.role.create({
    data: { code: `VERIFY_ACT1_ROLE_${su6}`, name: `verify-act1 探针角色 ${su6}`, status: 'ACTIVE' },
  });
  precheckRoute('POST', '/admin/iam/role-definitions/:roleId/modify');
  const b10submit = await call('POST', `/admin/iam/role-definitions/${roleFx.id}/modify`, tokens.tech_admin, {
    proposedName: `verify-act1 探针角色 ${su6} v2`,
    proposedPermissionGroups: ['BASE_ACCESS'],
    changeReason: 'verify:act1 B10 probe',
  });
  const requestNo10: string | undefined = b10submit.json?.requestNo;
  const approvalNo10: string | undefined = b10submit.json?.approvalNo;
  let b10ok = false;
  let b10detail = `POST modify → ${b10submit.status} ${JSON.stringify(b10submit.json)}`;
  if (b10submit.status < 300 && approvalNo10 && requestNo10) {
    const b10reject = await call('POST', `/admin/control-gates/approvals/${approvalNo10}/reject`, tokens.ciso, {
      reason: 'verify:act1 B10 reject',
    });
    let finalStatus: string | undefined;
    await waitUntil(
      async () => {
        const row = await prisma.roleDefinitionModifyRequest.findUnique({ where: { requestNo: requestNo10 } });
        finalStatus = row?.status;
        return !!finalStatus && finalStatus !== 'PENDING_APPROVAL';
      },
      10_000,
      300,
    );
    b10ok = b10reject.status < 300 && finalStatus === 'REJECTED';
    b10detail = `POST reject → ${b10reject.status}；roleDefinitionModifyRequest.status=${finalStatus}（期望 REJECTED）`;
  }
  judge('B10', b10ok, b10detail);

  // ══════════════════════ B11：403 留痕（法一纪律4）══════════════════════

  const b11before = new Date();
  precheckRoute('POST', '/admin/reconciliation/runs/wallet');
  const b11 = await call('POST', '/admin/reconciliation/runs/wallet', tokens.auditor, { cutoff: new Date().toISOString() });
  const auditorUser = await prisma.user.findFirstOrThrow({ where: { email: 'auditor@fiatx.com' } });
  const b11row = await prisma.auditLogEvent.findFirst({
    where: { action: 'ADMIN_ACCESS_DENIED', actorNo: auditorUser.userNo, recordedAt: { gte: b11before } },
    orderBy: { recordedAt: 'desc' },
  });
  judge(
    'B11',
    b11.status === 403 && !!b11row && b11row.actorNo === auditorUser.userNo,
    `POST recon/runs/wallet(auditor) → ${b11.status}；ADMIN_ACCESS_DENIED 行 actorNo=${b11row?.actorNo ?? '(无)'}`,
  );

  // ══════════════════════ B12：管理员迁移表非法跃迁（法二，铁律④）══════════════════════

  const su7 = uniq();
  const userFxB12 = await prisma.user.create({
    data: {
      userNo: `ADM-ACT1-B12-${su7}`,
      email: `verify-act1-b12-${su7}@fiatx.com`,
      password: 'not-a-real-hash',
      role: 'OPS_OFFICER',
      status: 'ACTIVE',
    },
  });
  precheckRoute('POST', '/users/:userNo/reactivate');
  const b12 = await call('POST', `/users/${userFxB12.userNo}/reactivate`, tokens.tech_admin, {
    reason: 'verify:act1 B12 probe',
  });
  judge('B12', b12.status === 409, `POST reactivate(ACTIVE 管理员) → ${b12.status}（期望 409）`);

  // B13（收编生效，业主裁决5，Task 24）已随材料管理路由族 2026-09-06 退役摘除——
  // 路由 /admin/material-management/holdings/:id/simulate-stage 已删，判据主体不存在。

  // ══════════════════════ B14：审计子表检索（法三业务键 + 决定4，rbac.catalog:412）══════════════════════

  const b14 = await call('GET', `/admin/audit-logs?subjectNo=${encodeURIComponent(seizeCase.entityRef)}`, tokens.auditor);
  const hasApprovalCaseSubject =
    Array.isArray(b14.json?.items) &&
    b14.json.items.some(
      (item: any) => Array.isArray(item.subjects) && item.subjects.some((s: any) => s.subjectType === 'APPROVAL_CASE'),
    );
  judge(
    'B14',
    b14.status === 200 && hasApprovalCaseSubject,
    `GET audit-logs?subjectNo=<B9 entityRef> → ${b14.status}，命中行数=${b14.json?.items?.length ?? 0}，含 APPROVAL_CASE 主体=${hasApprovalCaseSubject}`,
  );

  // ══════════════════════ V1–V10：波二 · 资产暂停是 L1 硬门 + 留痕 + 报价身份 ══════════════════════
  const usdt = await prisma.asset.findFirstOrThrow({ where: { currency: 'USDT', network: 'TRON' } });
  const aed = await prisma.asset.findFirstOrThrow({ where: { currency: 'AED' } });
  const alice = await prisma.customerMain.findFirstOrThrow({ where: { email: 'demo_alice@example.com' } });
  const grace = await prisma.customerMain.findFirstOrThrow({ where: { email: 'demo_grace@example.com' } });
  const aliceTok = await customerLogin('demo_alice@example.com');
  const graceTok = await customerLogin('demo_grace@example.com');
  const vStart = new Date();

  // ── 夹具补丁：交易起始前置门（见 ensureFiatWithdrawalAddress 注释）——
  // alice 还要一条 AED C_VIBAN 收款钱包，V6 的 initiateSwap R4 收款账户校验要用
  // （USDT 那侧的 C_DEP 由下面 V3 的 /client/deposit-wallets 调用顺带创建）。
  await ensureFiatWithdrawalAddress(aliceTok, alice.id, alice.customerNo);
  await ensureFiatWithdrawalAddress(graceTok, grace.id, grace.customerNo);
  const aedWallet = await call('POST', '/client/deposit-wallets', aliceTok, { network: 'AED_ZAND' });
  if (aedWallet.status >= 300) throw new Error(`夹具：alice 开 AED 收款钱包失败 → ${aedWallet.status} ${aedWallet.text}`);

  // ── 第一轮暂停：V3 暂停期间入金 → V4 通过后挂运营 → 恢复 → V5 放行入账（alice 由此拿到 150 USDT，供 V1/V6 的兑换用）
  await driveAssetStatus(usdt.assetNo!, 'SUSPENDED', tokens);

  const wallet = await call('POST', '/client/deposit-wallets', aliceTok, { network: 'TRON' });
  const toAddress: string = wallet.json?.address ?? wallet.json?.wallet?.address;
  if (!toAddress) throw new Error(`POST /client/deposit-wallets 没返回地址：${wallet.status} ${wallet.text}`);
  const txSeed = `${Date.now()}`;
  // counterpartyIsVasp 是运行时必填（inbound-transfer-signals.service.ts 对 crypto
  // 起手就查，DTO 上标 optional 但没带就 400 "counterpartyIsVasp is required for
  // crypto deposits"）——brief 骨架漏了这个字段，实测会让整条信号创建静默 400、
  // scan 找不到任何 PENDING_SCAN 信号，depositIds 恒为空。
  const sig = await call('POST', '/deposit-transactions/my/inbound-signals', aliceTok, {
    network: 'TRON', toAddress, contractAddress: usdt.contractAddress, amount: '150',
    txHash: Buffer.from(`v3-${txSeed}`).toString('hex').padEnd(64, '0').slice(0, 64),
    fromAddress: `TVerifyAct1${txSeed}`.padEnd(34, 'x').slice(0, 34),
    counterpartyIsVasp: false,
  });
  if (sig.status >= 300) throw new Error(`夹具：创建入站信号失败 → ${sig.status} ${sig.text}`);
  const scan = await call('POST', '/deposit-transactions/my/inbound-signals/scan', aliceTok, { network: 'TRON', toAddress });
  const depositId: string | undefined = scan.json?.depositIds?.[0];
  let v3row: any = null;
  const v3ok = !!depositId && (await waitUntil(async () => {
    v3row = await prisma.depositTransaction.findUnique({ where: { id: depositId } });
    return v3row?.status === 'COMPLIANCE_PENDING' && v3row?.limitHoldReason === 'ASSET_SUSPENDED' && !!v3row?.sumsubTxnId;
  }, 15_000, 300));
  const v3snap = v3row?.l1Snapshot ? JSON.parse(v3row.l1Snapshot) : null;
  const v3held = v3row ? await prisma.auditLogEvent.findFirst({
    where: { action: 'DEPOSIT_L1_HELD', primarySubjectNo: v3row.depositNo, recordedAt: { gte: vStart } },
    include: { subjects: true },
  }) : null;
  judge(
    'V3',
    v3ok && v3snap?.checks?.some((c: any) => c.code === 'ASSET_AVAILABILITY' && c.outcome === 'FAIL')
      && !!v3held && v3held.fromStatus == null && v3held.toStatus == null
      && v3held.subjects.some((s: any) => s.subjectType === 'ASSET' && s.subjectNo === usdt.assetNo && s.subjectRole === 'RELATED'),
    `暂停期间入金 scan → depositIds=${JSON.stringify(scan.json?.depositIds)} status=${v3row?.status} hold=${v3row?.limitHoldReason} sumsubTxnId=${v3row?.sumsubTxnId ? '有' : '无'} DEPOSIT_L1_HELD=${v3held ? '有' : '无'}`,
  );

  const v4 = depositId ? await call('POST', '/admin/deposit-sumsub/demo/run-verdict', tokens.admin, { depositId, verdict: 'V1_APPROVED' }) : { status: 0, json: null, text: 'no deposit' };
  // !!depositId 前置：status:0 哨兵本身满足 `< 300`，没有它 depositId 为空时会
  // 掉进 waitUntil 拿 `id: undefined` 去查 prisma，炸的是 PrismaClientValidationError
  // 而不是一条干净的 FAIL——V6-V10 全部拿不到结果。
  const v4ok = !!depositId && v4.status < 300 && (await waitUntil(async () => (await prisma.depositTransaction.findUnique({ where: { id: depositId! } }))?.status === 'OPERATION_PENDING', 15_000, 300));
  const v4held = v3row ? await prisma.auditLogEvent.findFirst({
    where: { action: 'DEPOSIT_HELD', primarySubjectNo: v3row.depositNo, recordedAt: { gte: vStart } }, include: { subjects: true },
  }) : null;
  judge(
    'V4',
    v4ok && v4held?.fromStatus === 'COMPLIANCE_PENDING' && v4held?.toStatus === 'OPERATION_PENDING' && v4held?.reasonCode === 'ASSET_SUSPENDED'
      && v4held.subjects.some((s: any) => s.subjectType === 'ASSET' && s.subjectNo === usdt.assetNo),
    `run-verdict(V1_APPROVED) → ${v4.status}；DEPOSIT_HELD from=${v4held?.fromStatus} to=${v4held?.toStatus} reason=${v4held?.reasonCode}`,
  );

  await driveAssetStatus(usdt.assetNo!, 'ACTIVE', tokens);
  const suspendedRow = await prisma.auditLogEvent.findFirst({ where: { action: 'ASSET_SUSPENDED', primarySubjectNo: usdt.assetNo!, recordedAt: { gte: vStart } } });
  precheckRoute('POST', '/deposit-transactions/:id/waive-limit');
  const v5 = depositId ? await call('POST', `/deposit-transactions/${depositId}/waive-limit`, tokens.ops_officer) : { status: 0, json: null, text: 'no deposit' };
  const v5ok = !!depositId && v5.status < 300 && (await waitUntil(async () => (await prisma.depositTransaction.findUnique({ where: { id: depositId! } }))?.status === 'SUCCESS', 20_000, 300));
  judge('V5', v5ok && suspendedRow?.fromStatus === 'ACTIVE' && suspendedRow?.toStatus === 'SUSPENDED',
    `恢复后 Release Hold → ${v5.status}，终态=${v5ok ? 'SUCCESS' : '未到 SUCCESS'}；ASSET_SUSPENDED 行 from/to=${suspendedRow?.fromStatus}/${suspendedRow?.toStatus}`);

  // ── V7/V8：地址登记 actor 与四门之一（同时给 V2 备一个 ACTIVE 的 TRON 地址）
  const { fakeTronAddress } = await import('../src/common/utils/tron-address.util');
  // 客户路由不在 RBAC_PERMISSION_DEFINITIONS 里，不走 precheckRoute（它只核管理端路由）
  const reg1 = await call('POST', '/client/withdrawal-addresses', aliceTok, { network: 'TRON', address: fakeTronAddress(`act1-${txSeed}-1`), ownershipDeclaration: true, label: 'verify:act1 V7' });
  const addr1No: string | undefined = reg1.json?.addressNo;
  const v7row = addr1No ? await prisma.auditLogEvent.findFirst({ where: { action: 'WITHDRAWAL_ADDRESS_REGISTERED', primarySubjectNo: addr1No } }) : null;
  judge('V7', reg1.status < 300 && reg1.json?.status === 'PENDING_ACTIVATION' && v7row?.actorType === 'CUSTOMER' && !!v7row?.requestId,
    `登记链上地址 → ${reg1.status} ${reg1.json?.status}；审计 actorType=${v7row?.actorType} requestId=${v7row?.requestId ? '有' : '无'}`);

  const existingActive = await prisma.withdrawalAddress.count({ where: { customerId: alice.id, network: 'TRON', status: { in: ['PENDING_ACTIVATION', 'ACTIVE'] } } });
  for (let i = existingActive; i < MAX_ADDRESSES_PER_NETWORK; i += 1) {
    await call('POST', '/client/withdrawal-addresses', aliceTok, { network: 'TRON', address: fakeTronAddress(`act1-${txSeed}-fill${i}`), ownershipDeclaration: true });
  }
  const reg4 = await call('POST', '/client/withdrawal-addresses', aliceTok, { network: 'TRON', address: fakeTronAddress(`act1-${txSeed}-4`), ownershipDeclaration: true });
  const v8row = await prisma.auditLogEvent.findFirst({
    where: { action: 'WITHDRAWAL_ADDRESS_REQUEST_DENIED', reasonCode: 'ADDRESS_LIMIT_REACHED', ownerCustomerNo: alice.customerNo, recordedAt: { gte: vStart } },
  });
  judge('V8', reg4.status === 400 && reg4.json?.code === 'ADDRESS_LIMIT_REACHED' && !!v8row && v8row.outcome === 'DENIED',
    `同网络第 4 条 → ${reg4.status} ${reg4.json?.code}；DENIED 行=${v8row ? '有' : '无'}`);

  if (addr1No) {
    precheckRoute('POST', '/admin/withdrawal-addresses/:addressNo/skip-cooling');
    const skipCooling = await call('POST', `/admin/withdrawal-addresses/${addr1No}/skip-cooling`, tokens.treasury, { reason: 'verify:act1 V2 需要一个 ACTIVE 地址' });
    if (skipCooling.status >= 300) throw new Error(`skip-cooling ${addr1No} → ${skipCooling.status} ${skipCooling.text}`);
  }
  const activeAddr = await prisma.withdrawalAddress.findFirst({ where: { customerId: alice.id, network: 'TRON', status: 'ACTIVE' } });

  // ── 第二轮暂停：V1 兑换 BLOCK、V2 提现 BLOCK（alice 此刻已有 150 USDT，余额前置不会先拦）
  await driveAssetStatus(usdt.assetNo!, 'SUSPENDED', tokens);
  const q1 = await call('POST', '/swap-transactions/quotes', aliceTok, { fromAssetId: usdt.id, toAssetId: aed.id, fromAmount: 10 });
  // toCustomerQuoteResponse()（swap-transactions-customer.controller.ts）返回的字段是
  // `quoteId`，不是 `id`——brief 骨架写的 q1.json.id 恒 undefined，会在这一步先撞
  // "quoteId must be a UUID" 400，L1 门根本挨不到边。
  const v1 = q1.status < 300 ? await call('POST', '/swap-transactions', aliceTok, { quoteId: q1.json.quoteId }) : { status: q1.status, json: q1.json, text: q1.text };
  const v1row = await prisma.auditLogEvent.findFirst({
    where: { action: 'SWAP_L1_BLOCKED', ownerCustomerNo: alice.customerNo, recordedAt: { gte: vStart } }, include: { subjects: true }, orderBy: { recordedAt: 'desc' },
  });
  judge('V1', v1.status === 403 && v1.json?.code === 'L1_GATE_BLOCKED' && v1row?.outcome === 'DENIED' && v1row?.reasonCode === 'ASSET_SUSPENDED'
      && v1row.subjects.some((s: any) => s.subjectType === 'ASSET' && s.subjectNo === usdt.assetNo),
    `暂停中建兑换单 → ${v1.status} ${v1.json?.code}；SWAP_L1_BLOCKED reason=${v1row?.reasonCode}`);

  // 提现同 swap 一样先建报价（quoteId 是 CreateWithdrawTransactionDto 的必填字段，
  // 这一步不受资产暂停影响——限额闸只挡 SINGLE_LIMIT，USDT 提现最小额 10，取 20
  // 留足余量）；quote 建好后才轮到 L1 门拦。
  const wq2 = await call('POST', '/withdraw-transactions/quotes', aliceTok, { assetId: usdt.id, amount: 20 });
  const v2 = !activeAddr
    ? { status: 0, json: null, text: 'no active TRON address' }
    : wq2.status >= 300
      ? { status: wq2.status, json: wq2.json, text: wq2.text }
      : await call('POST', '/client/withdraw-transactions', aliceTok, { assetId: usdt.id, amount: 20, toAddress: activeAddr.address, quoteId: wq2.json.quoteId });
  const v2row = await prisma.auditLogEvent.findFirst({
    where: { action: 'WITHDRAW_L1_BLOCKED', ownerCustomerNo: alice.customerNo, recordedAt: { gte: vStart } }, orderBy: { recordedAt: 'desc' },
  });
  judge('V2', v2.status === 403 && v2.json?.code === 'L1_GATE_BLOCKED' && v2row?.outcome === 'DENIED' && v2row?.reasonCode === 'ASSET_SUSPENDED',
    `暂停中建提现单 → ${v2.status} ${v2.json?.code}；WITHDRAW_L1_BLOCKED=${v2row ? '有' : '无'}`);

  await driveAssetStatus(usdt.assetNo!, 'ACTIVE', tokens);
  const q6 = await call('POST', '/swap-transactions/quotes', aliceTok, { fromAssetId: usdt.id, toAssetId: aed.id, fromAmount: 10 });
  const v6 = q6.status < 300 ? await call('POST', '/swap-transactions', aliceTok, { quoteId: q6.json.quoteId }) : { status: q6.status, json: q6.json, text: q6.text };
  judge('V6', v6.status === 201, `恢复后同一客户建兑换单 → ${v6.status}（对照：门不是永远关着）${v6.status >= 300 ? ' ' + v6.text : ''}`);

  // ── V9：VIP 预览价 = 确认价（岔口 4）
  // 选档只比平费不比点差；种子里 VIP 全档更便宜，但 demo:all 的 FEE_PLAN（demo-lib.ts:122）
  // 会把 STD-USDT-AED Tier 1 平费压到 10，舞台上 100 USDT 时 Grace 会落 STD——判据与剧本统一
  // 用 1000 USDT（Tier 2：VIP 12 < STD 20），两种库态都成立。
  const rateGrace = await call('GET', `/swap-transactions/rate?fromAssetId=${usdt.id}&toAssetId=${aed.id}&amount=1000`, graceTok);
  const rateAlice = await call('GET', `/swap-transactions/rate?fromAssetId=${usdt.id}&toAssetId=${aed.id}&amount=1000`, aliceTok);
  const quoteGrace = await call('POST', '/swap-transactions/quotes', graceTok, { fromAssetId: usdt.id, toAssetId: aed.id, fromAmount: 1000 });
  // 修复前两人的预览都落默认档 → tierId 相同；修复后 Grace 命中 VIP 档 → tierId 不同。用 tierId 而不用点差数值：
  // 两档点差恰好相等时数值比较会伪绿，tierId 不会。
  // 命中档位名（feeLevelCode）只存在于 SwapQuote 表本身；客户确认响应 toCustomerQuoteResponse() 刻意不透出这个字段（设计如此，非缺陷）——
  // 这里改从报价行直读，不是绕断言、不是弱化判据。
  const graceQuoteRow = quoteGrace.json?.quoteId
    ? await prisma.swapQuote.findUnique({ where: { id: quoteGrace.json.quoteId }, select: { feeLevelCode: true } })
    : null;
  judge('V9',
    rateGrace.status === 200 && rateAlice.status === 200 && quoteGrace.status < 300
      && !!rateGrace.json.tierId && rateGrace.json.tierId !== rateAlice.json.tierId
      && String(graceQuoteRow?.feeLevelCode ?? '').startsWith('VIP'),
    `Grace 预览 tierId=${rateGrace.json?.tierId} vs Alice ${rateAlice.json?.tierId}；Grace 报价 level=${graceQuoteRow?.feeLevelCode}`);

  // ── V10：取证路径本身进判据——审计页 Subject No 栏按资产号能拉出被它拦下的单
  const v10 = await call('GET', `/admin/audit-logs?subjectNo=${encodeURIComponent(usdt.assetNo!)}&take=100`, tokens.admin);
  // 不限时间窗会让 V10 吃到本资产历史上任何一次 SWAP_L1_BLOCKED/DEPOSIT_HELD——哪怕本轮 V1/V3
  // 已经因回归而拦不下来，只要之前跑过一次就能常绿。按 vStart 门控只认本轮新写的行。
  // audit-logs 响应体（audit-logs.service.ts#mapEvent）同时带 occurredAt 与 recordedAt，
  // 两个写入点（swap-workflow.service.ts SWAP_L1_BLOCKED / deposit-workflow.service.ts
  // DEPOSIT_HELD）都不显式传 occurredAt,两者等价于同一个 now()——occurredAt 优先、
  // recordedAt 兜底。
  const v10hit = (a: string) => (v10.json?.items ?? []).some((i: any) => i.action === a && new Date(i.occurredAt ?? i.recordedAt) >= vStart);
  judge('V10', v10.status === 200 && v10hit('SWAP_L1_BLOCKED') && v10hit('DEPOSIT_HELD'),
    `GET audit-logs?subjectNo=${usdt.assetNo} → ${v10.status}，含 ${['SWAP_L1_BLOCKED', 'DEPOSIT_HELD'].filter((a) => v10hit(a)).join('+') || '无'}`);

  // ══════════════════════ 汇总 ══════════════════════

  console.log('');
  const passCount = results.filter((r) => r.status === 'PASS').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;
  const skipCount = results.filter((r) => r.status === 'SKIP').length;
  console.log(`${passCount}/${results.length} PASS${skipCount > 0 ? ` + ${skipCount} SKIP` : ''}${failCount > 0 ? ` + ${failCount} FAIL` : ''}`);

  if (failCount > 0) {
    const first = results.find((r) => r.status === 'FAIL')!;
    console.error(`首条不符: ${first.id} —— ${first.msg}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log('ALL ACT1 CHECKS PASS' + (skipCount > 0 ? `（${skipCount} 条 SKIP，见上方原因，不计入失败）` : ''));
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
