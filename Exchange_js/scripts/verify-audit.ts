import { PrismaClient } from '@prisma/client';
import { DEPRECATED_AUDIT_ACTIONS, SUBJECTS_COVERED_ACTIONS } from '../src/modules/audit-logging/constants/audit-actions.constant';

const prisma = new PrismaClient();
let failed = 0;

function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✓' : '✗'} ${name} —— ${detail}`);
  if (!ok) failed += 1;
}

async function main() {
  // ── Q2 名册子表覆盖（波二升级：从"任取一条自证"改为按码断言全覆盖）──────
  // Step 4 实测钉数（2026-09-16，worktree self 栈 reset→demo:all 实测）：demo:all 只驱动
  // 交易域业务流，47 码名册里只有横切审批码 APPROVAL_SUBMITTED/APPROVAL_GRANTED 会被
  // 途经（confiscation/大额提现等 maker-checker 场景）。其余 45 码是治理域（邀请/MFA/
  // 角色/证据导出等），要靠管理台操作或 e2e 才会产生事件，demo:all 摸不到——阈值按可
  // 复现的这条路径实测值钉 2，不取更小值；45 码的"从未被 demo 验证过"是环境缺口，见
  // BACKLOG.md §H「治理域 demo 脚本缺位」观察条，不在本任务改动范围内。
  const MIN_EXERCISED_ROSTER_ACTIONS = 2;
  const rosterEvents = await prisma.auditLogEvent.findMany({
    where: { action: { in: [...SUBJECTS_COVERED_ACTIONS] } },
    select: { action: true, subjects: { select: { id: true }, take: 1 } },
  });
  const byAction = new Map<string, { total: number; missing: number }>();
  for (const r of rosterEvents) {
    const e = byAction.get(r.action) ?? { total: 0, missing: 0 };
    e.total += 1;
    if (r.subjects.length === 0) e.missing += 1;
    byAction.set(r.action, e);
  }
  const violated = [...byAction.entries()].filter(([, v]) => v.missing > 0);
  check('Q2 名册子表覆盖', violated.length === 0 && byAction.size >= MIN_EXERCISED_ROSTER_ACTIONS,
    `${byAction.size}/${SUBJECTS_COVERED_ACTIONS.length} 个名册码有事件（阈值 ${MIN_EXERCISED_ROSTER_ACTIONS}）` +
    (violated.length
      ? `；违约 ${violated.map(([a, v]) => `${a}(${v.missing}/${v.total})`).join(', ')}`
      : '；违约 0'));

  // ── Q4 查询留痕（波二升级：带 owner 参数的查询事件必须全部落 OWNER=CUSTOMER 行）──
  // 结构性说明保留：V1 治理域没有其他把 CUSTOMER 设为 OWNER 的场景——本判据看守的是
  // "查询留痕自身的子表纪律"，交易域 OWNER 场景待其接入 subjects 后另立判据（BACKLOG §H Q4 条）。
  const ownerQueries = await prisma.auditLogEvent.findMany({
    where: { action: 'AUDIT_LOG_QUERIED', ownerCustomerNo: { not: null } },
    select: { id: true, subjects: { where: { subjectRole: 'OWNER', subjectType: 'CUSTOMER' }, select: { id: true }, take: 1 } },
  });
  const q4Missing = ownerQueries.filter((r) => r.subjects.length === 0).length;
  check('Q4 带 owner 参数的查询全部落 OWNER 行', ownerQueries.length > 0 && q4Missing === 0,
    `${ownerQueries.length} 条带 owner 参数的 AUDIT_LOG_QUERIED，其中 ${q4Missing} 条缺 OWNER=CUSTOMER 子表行`);

  // ── Q5 拒绝有痕 ──────────────────────────────────────────
  const denied = await prisma.auditLogEvent.findMany({
    where: { outcome: { not: 'SUCCESS' } },
    select: { eventNo: true, action: true, outcome: true, reasonCode: true },
  });
  const withCode = denied.filter((r) => !!r.reasonCode).length;
  check('Q5 拒绝有痕', denied.length > 0 && withCode === denied.length,
    `${denied.length} 条非 SUCCESS，其中 ${withCode} 条带 reasonCode`);

  // ── Q6 谁查过审计日志 ────────────────────────────────────
  const queried = await prisma.auditLogEvent.count({
    where: { action: 'AUDIT_LOG_QUERIED', isReadOnly: true },
  });
  check('Q6 谁查过审计日志', queried > 0, `${queried} 条 AUDIT_LOG_QUERIED`);

  // ── 不变量①：每条事件至多一个 PRIMARY ────────────────────
  const grouped = await prisma.auditLogSubject.groupBy({
    by: ['eventId'], where: { subjectRole: 'PRIMARY' }, _count: { _all: true },
  });
  const multiPrimary = grouped.filter((g) => g._count._all > 1);
  check('不变量① PRIMARY 至多一个', multiPrimary.length === 0,
    multiPrimary.length === 0 ? '全部合规' : `${multiPrimary.length} 条事件挂了多个 PRIMARY`);

  // ── 不变量②：INHERIT 的码必须有 correlationId ─────────────
  const inheritCodes = ['ADMIN_SUSPENSION_APPLIED', 'ADMIN_ROLE_CHANGE_APPLIED', 'APPROVAL_GRANTED'];
  const orphan = await prisma.auditLogEvent.count({
    where: { action: { in: inheritCodes }, correlationId: null },
  });
  check('不变量② INHERIT 必有 correlationId', orphan === 0,
    orphan === 0 ? '无孤儿记录' : `${orphan} 条 INHERIT 记录缺 correlationId`);

  // ── 不变量③：退役码零新写入 ──────────────────────────────
  // 2026-09-02（Task 14）补入限额两族 + 客户标签共用裸名——换名册后这条判据
  // 第一次真正约束这 8 个裸名（此前它们被 TRANSACTION_LIMIT_CREATION/CHANGE
  // 两族实际写入，不能提前登记，见 audit-actions.constant.ts 的迁移注释）。
  // 2026-09-02（Task 15）补入托管钱包创建 + 提现地址登记两族共用裸名——同理，
  // 此前是 CUSTODIAN_WALLET_CREATE/WITHDRAWAL_ADDRESS_REGISTRATION 实际写入。
  const deprecated = await prisma.auditLogEvent.count({
    where: { action: { in: [...DEPRECATED_AUDIT_ACTIONS] } },
  });
  check('不变量③ 退役码零写入', deprecated === 0, `${deprecated} 条退役码记录`);

  // ── V1 词表覆盖率 ────────────────────────────────────────
  const used = await prisma.auditLogEvent.groupBy({ by: ['action'] });
  const v1Used = used.filter((u) =>
    /^(APPROVAL_|ADMIN_|ROLE_DEFINITION_|AUDIT_)/.test(u.action)).length;
  check('V1 词表已被使用', v1Used > 0, `${v1Used} 个 V1 码有真实写入`);

  console.log('');
  console.log(failed === 0 ? 'ALL AUDIT CHECKS PASS' : `FAIL: ${failed} check(s) failed`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main();
