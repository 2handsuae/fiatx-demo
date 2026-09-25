/**
 * 派生"角色实际持有哪些权限组"——从角色持有的权限码集合反推。
 *
 * 战役甲波一 T9 修复轮 1（评审 Ruling-12，Critical C1）：`RoleDetailPage.tsx` 原实现是
 * "持有任一码即持有该码所属全部组"——`GET /admin/iam/action-buckets` 返回的
 * `permCodeToGroups[code]` 是该码在 `rbac.catalog.ts` 里声明的**全部**归属组（不是"角色
 * 实际靠哪个组拿到这个码"），一个码若同时属于多个组（T9 起 12 条事故路由码同属五桶 OR），
 * 反查会把只持其中一个组的角色，误判成五个组全持有。后果不是展示层小瑕疵：Modify 弹窗
 * 按误判结果预选桶（同一批被误判为"持有"），运营改一次角色描述、不碰事故域，提交时
 * 仍把误判的桶一并塞进 `proposedPermissionGroups`——真实越权。
 *
 * 修法（子集完备）：组 G 被判定为"持有" ⟺ G 名下的**全部**权限码都在角色的持码集合里
 * （不是"任一码属于 G"）。`rbac.catalog.ts` 的 `cap.incident.*` 五个族独占能力码（Ruling-6，
 * 服务层门标记，`method: 'MARKER'`）各自只挂一个组，是这五个经办桶唯一"天然可区分"的锚点：
 * 一个角色若真持有 `INCIDENT_TECH_WRITE`，它的持码集合里必然连 `cap.incident.tech` 一起有
 * （两者由后端 `buildRolePermissionCodeMap()` 同源生成，见该函数注释）；反之，只持
 * `INCIDENT_WRITE`（FUNDS 族）的角色不会持有 `cap.incident.tech`，子集判据就会把
 * `INCIDENT_TECH_WRITE` 判为未持有——纵使它同 12 条事故路由码共享、也被五桶其它成员
 * "带"进了持码集合的表面。
 *
 * 对没有跨组共享码的组（仓库里除事故域外的全部组），子集判据退化为与旧逻辑等价的单码
 * 成员判定——本次修复不改变除事故域外任何组的展示/预选结果。
 */
export function deriveHeldGroups(
  heldPermissionCodes: readonly string[],
  permCodeToGroups: Record<string, readonly string[]>,
): Set<string> {
  const heldCodeSet = new Set(heldPermissionCodes);

  // 倒排 permCodeToGroups → groupToCodes：组 G 名下的全部权限码。
  const groupToCodes = new Map<string, Set<string>>();
  for (const [code, groups] of Object.entries(permCodeToGroups)) {
    for (const group of groups) {
      let codes = groupToCodes.get(group);
      if (!codes) {
        codes = new Set<string>();
        groupToCodes.set(group, codes);
      }
      codes.add(code);
    }
  }

  const held = new Set<string>();
  for (const [group, codes] of groupToCodes) {
    let complete = true;
    for (const code of codes) {
      if (!heldCodeSet.has(code)) {
        complete = false;
        break;
      }
    }
    if (complete) held.add(group);
  }
  return held;
}
