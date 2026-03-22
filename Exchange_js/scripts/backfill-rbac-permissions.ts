import 'tsconfig-paths/register';
import { PrismaClient } from '@prisma/client';
import {
  RBAC_PERMISSION_DEFINITIONS,
  RBAC_ROLE_DEFINITIONS,
  buildRolePermissionCodeMap,
} from '../src/modules/identity/access-control/rbac.catalog';

const prisma = new PrismaClient();

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

async function main() {
  const dryRun = !hasFlag('--apply');
  const rolePermissionCodeMap = buildRolePermissionCodeMap();

  const summary = {
    dryRun,
    rolesCreated: 0,
    permissionsCreated: 0,
    rolePermissionsCreated: 0,
  };

  const existingRoles = await prisma.role.findMany({
    select: { id: true, code: true },
  });
  const roleIdByCode = new Map(existingRoles.map((item) => [item.code, item.id]));

  for (const role of RBAC_ROLE_DEFINITIONS) {
    if (roleIdByCode.has(role.code)) {
      continue;
    }
    summary.rolesCreated += 1;
    if (!dryRun) {
      const created = await prisma.role.create({
        data: {
          code: role.code,
          name: role.name,
          description: role.description,
        },
        select: { id: true, code: true },
      });
      roleIdByCode.set(created.code, created.id);
    }
  }

  const existingPermissions = await prisma.permission.findMany({
    select: { id: true, code: true },
  });
  const permissionIdByCode = new Map(
    existingPermissions.map((item) => [item.code, item.id]),
  );

  for (const permission of RBAC_PERMISSION_DEFINITIONS) {
    if (permissionIdByCode.has(permission.code)) {
      continue;
    }
    summary.permissionsCreated += 1;
    if (!dryRun) {
      const created = await prisma.permission.create({
        data: {
          code: permission.code,
          name: permission.name,
          description: permission.description,
          method: permission.method,
          path: permission.path,
        },
        select: { id: true, code: true },
      });
      permissionIdByCode.set(created.code, created.id);
    }
  }

  const rolePermissions = await prisma.rolePermission.findMany({
    select: {
      roleId: true,
      permissionId: true,
    },
  });
  const existingRolePermissionKeys = new Set(
    rolePermissions.map((item) => `${item.roleId}:${item.permissionId}`),
  );

  const missingRolePermissions: Array<{ roleId: string; permissionId: string }> = [];
  for (const [roleCode, permissionCodes] of Object.entries(rolePermissionCodeMap)) {
    const roleId = roleIdByCode.get(roleCode);
    if (!roleId) {
      continue;
    }

    for (const permissionCode of permissionCodes) {
      const permissionId = permissionIdByCode.get(permissionCode);
      if (!permissionId) {
        continue;
      }
      const key = `${roleId}:${permissionId}`;
      if (existingRolePermissionKeys.has(key)) {
        continue;
      }
      missingRolePermissions.push({ roleId, permissionId });
      existingRolePermissionKeys.add(key);
    }
  }

  summary.rolePermissionsCreated = missingRolePermissions.length;

  if (!dryRun && missingRolePermissions.length > 0) {
    for (const item of missingRolePermissions) {
      await prisma.rolePermission.create({
        data: item,
      });
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
