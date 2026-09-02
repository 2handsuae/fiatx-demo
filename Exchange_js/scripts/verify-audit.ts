import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
let failed = 0;

function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✓' : '✗'} ${name} —— ${detail}`);
  if (!ok) failed += 1;
}

async function main() {
  // ── Q2 按单据查全部（含它只是「相关方」的事件）──────────────
  const anyPrimary = await prisma.auditLogSubject.findFirst({ where: { subjectRole: 'PRIMARY' } });
  if (!anyPrimary) {
    check('Q2 按单据查全部', false, '库里没有任何 PRIMARY 子表行，前置数据缺失');
  } else {
    const rows = await prisma.auditLogEvent.findMany({
      where: { subjects: { some: { subjectNo: anyPrimary.subjectNo } } },
      select: { eventNo: true, action: true },
    });
    check('Q2 按单据查全部', rows.length > 0, `${anyPrimary.subjectNo} 命中 ${rows.length} 条`);
  }

  // ── Q4 按客户查全部（客户从未被改，只作为 OWNER 出现）────────
  const anyOwner = await prisma.auditLogSubject.findFirst({
    where: { subjectRole: 'OWNER', subjectType: 'CUSTOMER' },
  });
  if (!anyOwner) {
    check('Q4 按客户查全部', false, '库里没有任何 OWNER=CUSTOMER 子表行');
  } else {
    const rows = await prisma.auditLogEvent.findMany({
      where: { subjects: { some: { subjectNo: anyOwner.subjectNo, subjectRole: 'OWNER' } } },
      select: { eventNo: true, primarySubjectType: true },
    });
    const notCustomerPrimary = rows.filter((r) => r.primarySubjectType !== 'CUSTOMER').length;
    check('Q4 按客户查全部', rows.length > 0 && notCustomerPrimary > 0,
      `${anyOwner.subjectNo} 命中 ${rows.length} 条，其中 ${notCustomerPrimary} 条主对象不是客户本人`);
  }

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
  // 2026-09-02（Task 15 收尾）移出 MFA_LOGIN_VERIFIED：核实后它不是退役码，只是
  // 从旧附册搬进 V1_AUDIT_ACTIONS 合同（码值不变，仍由 verifyMfaLogin() 每次常规
  // 登录写入）——留在这份闸里会把合法的常规登录审计当成退役码误判。
  const deprecated = await prisma.auditLogEvent.count({
    where: { action: { in: [
      'ADMIN_LOGIN_SUCCESS', 'RESET_FAILED',
      'CREATION_REQUESTED', 'CREATION_APPLIED', 'CREATION_APPLY_FAILED', 'CREATION_CANCELLED',
      'CHANGE_REQUESTED', 'CHANGE_APPLIED', 'CHANGE_APPLY_FAILED', 'CHANGE_CANCELLED',
      'TAG_ASSIGNED', 'TAG_REVOKED',
      'CREATE_REQUESTED', 'WALLET_CREATED', 'WALLET_CREATE_FAILED', 'CREATE_CANCELLED',
      'ADDRESS_REGISTERED', 'ADDRESS_ACTIVATED', 'ADDRESS_CANCELLED', 'ADDRESS_SUSPENDED',
      'ADDRESS_DEACTIVATED', 'MANUAL_COOLING_SKIP',
    ] } },
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
