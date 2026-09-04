// scripts/verify-act1.ts —— 第一幕系统属性行为校验器（Task 29，15 条判据 B0–B14）
//
// 同范式：verify-rbac.ts 的三条铁规矩——
//   ① 端口从 .stackports 读，绝不写死（写死会打到 main 栈）。
//   ② 每条判据先做路径存在性预检——404 冒充「非 403=通过」的假绿本仓库栽过
//     （verify-rbac.ts 文件头那次事故）。本文件对没有「先证明路由存在的 2xx
//     步骤」的判据（B7/B11/B12/B13），用 RBAC_PERMISSION_DEFINITIONS（已解析的
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

function skip(id: string, msg: string): void {
  results.push({ id, status: 'SKIP', msg });
  console.log(`○ ${id} SKIP —— ${msg}`);
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

  // ══════════════════════ B13：收编生效（业主裁决5，Task 24）══════════════════════
  //
  // 预检用一个真实 holding id——库里没有就跳过（不伪造夹具：CustomerMaterialHolding
  // 挂在真实客户 KYC 材料生命周期上，不是纯治理记录，brief 明确指示跳过而非造假）。

  const holding = await prisma.customerMaterialHolding.findFirst();
  if (!holding) {
    skip('B13', '库里没有真实 material holding（此栈尚无客户走过材料生命周期）——按 brief 指示跳过，不伪造夹具');
  } else {
    precheckRoute('POST', '/admin/material-management/holdings/:id/simulate-stage');
    const holdingPrecheck = await call('GET', `/admin/material-management/holdings/${holding.id}`, tokens.admin);
    if (holdingPrecheck.status === 404) {
      throw new Error(`B13 预检失败：holding id ${holding.id}（来自 prisma 查询）GET 详情 404，判据路径写错`);
    }
    const b13 = await call('POST', `/admin/material-management/holdings/${holding.id}/simulate-stage`, tokens.auditor, {
      targetStage: 'T_MINUS_30',
    });
    judge('B13', b13.status === 403, `POST simulate-stage(auditor) → ${b13.status}（期望 403，收编前是 200）`);
  }

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

  // ══════════════════════ 汇总 ══════════════════════

  console.log('');
  const passCount = results.filter((r) => r.status === 'PASS').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;
  const skipCount = results.filter((r) => r.status === 'SKIP').length;
  console.log(`${passCount}/15 PASS${skipCount > 0 ? ` + ${skipCount} SKIP` : ''}${failCount > 0 ? ` + ${failCount} FAIL` : ''}`);

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
