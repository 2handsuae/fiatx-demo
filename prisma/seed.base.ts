import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  ACTIVE_RBAC_ROLE_CODES,
  RBAC_PERMISSION_DEFINITIONS,
  RBAC_ROLE_DEFINITIONS,
  buildRolePermissionCodeMap,
} from '../src/modules/identity/access-control/rbac.catalog';
import {
  ApprovalSoDRuleCodes,
  DEFAULT_APPROVAL_POLICIES,
  deriveCheckerRoles,
  joinRoleCsv,
} from '../src/modules/governance/approvals/constants/approval.constants';

const DEFAULT_ADMIN_EMAIL = 'admin@fiatx.com';
const DEFAULT_ADMIN_USER_NO = 'ADM2501010001';
const DEFAULT_ADMIN_PASSWORD = '123456';
const DEFAULT_ROLE_ADMIN_PASSWORD = '123456';

type RoleSeedAccount = {
  roleCode: string;
  email: string;
  userNo: string;
};

const ROLE_SEED_ACCOUNTS: RoleSeedAccount[] = [
  { roleCode: 'SUPER_ADMIN', email: 'admin@fiatx.com', userNo: 'ADM2501010001' },
  { roleCode: 'SENIOR_MANAGEMENT_OFFICER', email: 'sm@fiatx.com', userNo: 'ADM2501010002' },
  { roleCode: 'CISO', email: 'ciso@fiatx.com', userNo: 'ADM2501010003' },
  { roleCode: 'MLRO', email: 'mlro@fiatx.com', userNo: 'ADM2501010004' },
  { roleCode: 'DPO', email: 'dpo@fiatx.com', userNo: 'ADM2501010005' },
  { roleCode: 'COMPLIANCE_OFFICER', email: 'compliance_lead@fiatx.com', userNo: 'ADM2501010006' },
  { roleCode: 'TECH_OFFICER', email: 'tech_admin@fiatx.com', userNo: 'ADM2501010007' },
  { roleCode: 'OPS_OFFICER', email: 'ops_officer@fiatx.com', userNo: 'ADM2501010008' },
  // 2026-08-31 第一幕职权重划新增三职务：内审（全域只读，监管上门给这个账号）、
  // 财务负责人（唯一持费率写权限，且裁决充值没收）、金库专员（钱放在哪归他）。
  { roleCode: 'INTERNAL_AUDITOR', email: 'auditor@fiatx.com', userNo: 'ADM2501010009' },
  { roleCode: 'CFO', email: 'cfo@fiatx.com', userNo: 'ADM2501010010' },
  { roleCode: 'TREASURY_OFFICER', email: 'treasury@fiatx.com', userNo: 'ADM2501010011' },
  // 2026-09-14 迪拜团队个人超管号：都给 SUPER_ADMIN，密码 123456（DEFAULT_ROLE_ADMIN_PASSWORD）、
  // MFA 默认关（不写 mfa 字段，login 见 mfaEnabledAt=null 直接发令牌）。各人一号是为审计留痕（铁律①）——
  // 共用一个号分不清谁操作。加进本数组即随 db:base:sync 一起注入；不在数组里的号会被
  // deleteObsoleteRoleAdminAccounts 当过期删掉，所以新号必须挂在这里、配唯一 userNo。
  { roleCode: 'SUPER_ADMIN', email: 'roger@fiatx.com', userNo: 'ADM2501010012' },
  { roleCode: 'SUPER_ADMIN', email: 'jimsa@fiatx.com', userNo: 'ADM2501010013' },
  { roleCode: 'SUPER_ADMIN', email: 'riyas@fiatx.com', userNo: 'ADM2501010014' },
  { roleCode: 'SUPER_ADMIN', email: 'shaik@fiatx.com', userNo: 'ADM2501010015' },
  { roleCode: 'SUPER_ADMIN', email: 'nusrat@fiatx.com', userNo: 'ADM2501010016' },
  { roleCode: 'SUPER_ADMIN', email: 'shaista@fiatx.com', userNo: 'ADM2501010017' },
  { roleCode: 'SUPER_ADMIN', email: 'syedhadi@fiatx.com', userNo: 'ADM2501010018' },
  { roleCode: 'SUPER_ADMIN', email: 'steven@fiatx.com', userNo: 'ADM2501010019' },
  { roleCode: 'SUPER_ADMIN', email: 'rhea@fiatx.com', userNo: 'ADM2501010020' },
];

export async function seedBase(prisma: PrismaClient): Promise<void> {
  console.log('--- Seeding Base Configuration ---');
  await deleteObsoleteRoleAdminAccounts(prisma);
  await seedAdmin(prisma);
  await seedRbac(prisma);
  await seedGovernanceApprovalBaseline(prisma);
  console.log('✅ Base configuration seeded.');
}

// admin_role_change_requests.targetUserId → User 是无 onDelete 的必填外键（默认 RESTRICT）。
// 除固定 11 人名册外，管理员账号只应该由「进人」业务流程（站 0 邀请）在演示中现造，
// reset 本该把它们（连同各类 e2e/verify 探针账号：verify:act1 的 ADM-ACT1-*、审计披露
// key 轮换的 ADM-KEY-*、邀请过期 e2e 的 ADM-INVEXP-*……)一并冲掉，回到纯 11 人基线——
// 但此前从没人补过这一步，本 worktree 实测积了 79 个账号（68 个非法定角色探针，从未被
// 任何一次 reset 清理过，因为压根没有对应的删除逻辑）。这里镜像 deleteObsoleteRoles()
// 的写法：先删指向它们的绑定变更申请单，再删账号本身。只在显式 reset/首建库时跑
// （db:base:sync 只被 reset-stack.sh / reset-main.sh / db-setup.sh 调用，不在后端启动
// 路径上），不会误删演示进行中现邀请的新成员。
async function deleteObsoleteRoleAdminAccounts(prisma: PrismaClient): Promise<void> {
  const activeUserNos = ROLE_SEED_ACCOUNTS.map((item) => item.userNo);
  await (prisma as any).adminRoleChangeRequest.deleteMany({
    where: { targetUser: { userNo: { notIn: activeUserNos } } },
  });
  await prisma.user.deleteMany({
    where: { userNo: { notIn: activeUserNos } },
  });
}

export async function ensureBaseSeeded(prisma: PrismaClient): Promise<void> {
  const complete = await isBaseComplete(prisma);
  if (complete) {
    console.log('Base configuration already complete. Skip base sync.');
    return;
  }

  console.log('Base configuration is incomplete. Running base sync...');
  await seedBase(prisma);
}

async function seedAdmin(prisma: PrismaClient): Promise<void> {
  const password = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
  await prisma.user.upsert({
    where: { userNo: DEFAULT_ADMIN_USER_NO },
    update: {
      password,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      firstLoginStatus: 'COMPLETED',
    },
    create: {
      userNo: DEFAULT_ADMIN_USER_NO,
      email: DEFAULT_ADMIN_EMAIL,
      password,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      firstLoginStatus: 'COMPLETED',
    },
  });
}

async function deleteObsoleteRoles(prisma: PrismaClient): Promise<void> {
  // role_definition_modify_requests.roleId → Role 是无 onDelete 的必填外键（默认 RESTRICT）。
  // verify:act1 每轮都会给探针角色留一张已 REJECTED 的定义修改申请单，且没有任何重铺步骤
  // 清理这张表——直接删角色会撞 FK P2003，把整个 reset 卡死。先清掉这些孤儿角色自己的
  // 申请单（跟角色一起是探针数据，没有独立保留价值），再删角色本身。
  await (prisma as any).roleDefinitionModifyRequest.deleteMany({
    where: { role: { code: { notIn: ACTIVE_RBAC_ROLE_CODES } } },
  });
  await (prisma as any).role.deleteMany({
    where: { code: { notIn: ACTIVE_RBAC_ROLE_CODES } },
  });
}

async function seedRbac(prisma: PrismaClient): Promise<void> {
  const rolePermissionCodeMap = buildRolePermissionCodeMap();

  await deleteObsoleteRoles(prisma);

  for (const role of RBAC_ROLE_DEFINITIONS) {
    await (prisma as any).role.upsert({
      where: { code: role.code },
      update: {
        name: role.name,
        description: role.description,
        status: 'ACTIVE',
      },
      create: {
        code: role.code,
        name: role.name,
        description: role.description,
        status: 'ACTIVE',
      },
    });
  }

  for (const permission of RBAC_PERMISSION_DEFINITIONS) {
    await (prisma as any).permission.upsert({
      where: { code: permission.code },
      update: {
        name: permission.name,
        description: permission.description,
        method: permission.method,
        path: permission.path,
      },
      create: {
        code: permission.code,
        name: permission.name,
        description: permission.description,
        method: permission.method,
        path: permission.path,
      },
    });
  }

  const [roles, permissions] = await Promise.all([
    (prisma as any).role.findMany({
      where: {
        code: { in: RBAC_ROLE_DEFINITIONS.map((item) => item.code) },
      },
      select: { id: true, code: true },
    }),
    (prisma as any).permission.findMany({
      where: {
        code: { in: RBAC_PERMISSION_DEFINITIONS.map((item) => item.code) },
      },
      select: { id: true, code: true },
    }),
  ]);

  const roleIdByCode = new Map<string, string>();
  const permissionIdByCode = new Map<string, string>();
  roles.forEach((item: any) => roleIdByCode.set(item.code, item.id));
  permissions.forEach((item: any) => permissionIdByCode.set(item.code, item.id));

  const desiredPairs: Array<{ roleId: string; permissionId: string }> = [];
  for (const role of RBAC_ROLE_DEFINITIONS) {
    const roleId = roleIdByCode.get(role.code);
    if (!roleId) continue;

    for (const permissionCode of rolePermissionCodeMap[role.code] || []) {
      const permissionId = permissionIdByCode.get(permissionCode);
      if (!permissionId) continue;
      desiredPairs.push({ roleId, permissionId });
    }
  }

  for (const pair of desiredPairs) {
    await (prisma as any).rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: pair.roleId,
          permissionId: pair.permissionId,
        },
      },
      update: {},
      create: pair,
    });
  }

  const desiredPairKey = new Set(
    desiredPairs.map((item) => `${item.roleId}:${item.permissionId}`),
  );

  const existingPairs = await (prisma as any).rolePermission.findMany({
    where: {
      roleId: { in: roles.map((item: any) => item.id) },
    },
    select: { id: true, roleId: true, permissionId: true },
  });

  const stalePairIds = existingPairs
    .filter((item: any) => !desiredPairKey.has(`${item.roleId}:${item.permissionId}`))
    .map((item: any) => item.id);

  if (stalePairIds.length > 0) {
    await (prisma as any).rolePermission.deleteMany({
      where: { id: { in: stalePairIds } },
    });
  }

  await seedRoleAdminAccounts(prisma, roleIdByCode);
}

async function seedGovernanceApprovalBaseline(prisma: PrismaClient): Promise<void> {
  for (const [actionType, policy] of Object.entries(DEFAULT_APPROVAL_POLICIES)) {
    await prisma.approvalActionPolicy.upsert({
      where: { actionType },
      update: {
        riskLevel: 'HIGH',
        checkerRoles: joinRoleCsv(deriveCheckerRoles(policy.steps)),
        timeoutHours: policy.timeoutHours,
        allowCancel: policy.allowCancel,
        allowRetry: true,
      },
      create: {
        actionType,
        riskLevel: 'HIGH',
        checkerRoles: joinRoleCsv(deriveCheckerRoles(policy.steps)),
        timeoutHours: policy.timeoutHours,
        allowCancel: policy.allowCancel,
        allowRetry: true,
      },
    });
  }

  await prisma.approvalSodRule.upsert({
    where: { ruleCode: ApprovalSoDRuleCodes.DENY_SAME_USER_MAKER_CHECKER },
    update: {
      enabled: true,
      description: 'Maker and checker must be different users unless SUPER_ADMIN bypass applies.',
    },
    create: {
      ruleCode: ApprovalSoDRuleCodes.DENY_SAME_USER_MAKER_CHECKER,
      enabled: true,
      description: 'Maker and checker must be different users unless SUPER_ADMIN bypass applies.',
    },
  });
}

async function seedRoleAdminAccounts(
  prisma: PrismaClient,
  roleIdByCode: Map<string, string>,
): Promise<void> {
  const password = await bcrypt.hash(DEFAULT_ROLE_ADMIN_PASSWORD, 10);

  for (const account of ROLE_SEED_ACCOUNTS) {
    const roleId = roleIdByCode.get(account.roleCode);
    if (!roleId) {
      throw new Error(`Role not found for seed account: ${account.roleCode}`);
    }

    const user = await prisma.user.upsert({
      where: { userNo: account.userNo },
      update: {
        email: account.email,
        password,
        role: account.roleCode,
        status: 'ACTIVE',
        firstLoginStatus: 'COMPLETED',
      },
      create: {
        userNo: account.userNo,
        email: account.email,
        password,
        role: account.roleCode,
        status: 'ACTIVE',
        firstLoginStatus: 'COMPLETED',
      },
      select: { id: true },
    });

    await (prisma as any).userRole.upsert({
      where: {
        userId_roleId: {
          userId: user.id,
          roleId,
        },
      },
      update: {},
      create: {
        userId: user.id,
        roleId,
      },
    });

    await (prisma as any).userRole.deleteMany({
      where: {
        userId: user.id,
        roleId: { not: roleId },
      },
    });
  }

}

async function areRoleSeedAccountsComplete(prisma: PrismaClient): Promise<boolean> {
  const users = await prisma.user.findMany({
    where: {
      email: {
        in: ROLE_SEED_ACCOUNTS.map((item) => item.email),
      },
    },
    select: {
      id: true,
      userNo: true,
      email: true,
      role: true,
      status: true,
      userRoles: {
        include: {
          role: {
            select: {
              code: true,
            },
          },
        },
      },
    },
  });

  if (users.length !== ROLE_SEED_ACCOUNTS.length) {
    return false;
  }

  const userByEmail = new Map(users.map((item) => [item.email, item]));

  for (const expected of ROLE_SEED_ACCOUNTS) {
    const user = userByEmail.get(expected.email);
    if (!user) {
      return false;
    }

    if (user.userNo !== expected.userNo) {
      return false;
    }

    if (user.status !== 'ACTIVE') {
      return false;
    }

    if (user.role !== expected.roleCode) {
      return false;
    }

    const boundRoleCodes = user.userRoles.map((item) => item.role.code).sort();
    if (boundRoleCodes.length !== 1 || boundRoleCodes[0] !== expected.roleCode) {
      return false;
    }
  }

  return true;
}

async function isBaseComplete(prisma: PrismaClient): Promise<boolean> {
  const adminExists =
    (await prisma.user.count({ where: { email: DEFAULT_ADMIN_EMAIL } })) > 0;
  if (!adminExists) {
    return false;
  }

  const activeRoleCount = await (prisma as any).role.count({
    where: {
      status: 'ACTIVE',
      code: { in: ACTIVE_RBAC_ROLE_CODES },
    },
  });

  if (activeRoleCount !== ACTIVE_RBAC_ROLE_CODES.length) {
    return false;
  }

  const roleSeedAccountsComplete = await areRoleSeedAccountsComplete(prisma);
  if (!roleSeedAccountsComplete) {
    return false;
  }

  const approvalPolicies = await prisma.approvalActionPolicy.findMany({
    where: {
      actionType: { in: Object.keys(DEFAULT_APPROVAL_POLICIES) },
    },
    select: {
      actionType: true,
      riskLevel: true,
      checkerRoles: true,
      timeoutHours: true,
      allowCancel: true,
      allowRetry: true,
    },
  });
  if (approvalPolicies.length !== Object.keys(DEFAULT_APPROVAL_POLICIES).length) {
    return false;
  }
  for (const [actionType, policy] of Object.entries(DEFAULT_APPROVAL_POLICIES)) {
    const existing = approvalPolicies.find((item) => item.actionType === actionType);
    if (!existing) {
      return false;
    }
    if (
      existing.riskLevel !== 'HIGH' ||
      existing.checkerRoles !== joinRoleCsv(deriveCheckerRoles(policy.steps)) ||
      existing.timeoutHours !== policy.timeoutHours ||
      existing.allowCancel !== policy.allowCancel ||
      existing.allowRetry !== true
    ) {
      return false;
    }
  }
  return true;
}
