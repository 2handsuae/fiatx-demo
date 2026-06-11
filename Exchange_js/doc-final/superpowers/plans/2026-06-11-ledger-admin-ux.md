# Ledger Admin UX 打磨 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 账户页展示客户名+客户搜索+跳转;证据页加 ID 列+三合一搜索+COA 筛选(spec: doc-final/superpowers/specs/2026-06-11-ledger-admin-ux-design.md)。

**Architecture:** 后端两个只读查询服务扩参(enrich ownerName / q / coa),controller 透传;前端四个页面按既有 Zone 布局加列与筛选控件。无审计写入(纯读),无 schema 变更。

**Tech Stack:** NestJS+Prisma(后端)、React+Vite(admin-web)。测试 `npx jest <file>`;admin 校验 `cd admin-web && npx tsc --noEmit`。只 commit 到 `branch`。

**已钉事实:** 客户跳转惯例 `navigate(\`/dashboard/customer/management/${uuid}\`)`(MaterialHoldingDetailPage.tsx:350 同款);证据详情 Transfer ID+CopyBtn 已存在(TransferEvidenceDetail.tsx:306-315,无需改);customer_main 姓名字段 firstName/lastName;COA_TO_TB_CODE 在 `tb-account-codes.constant.ts`。

---

### Task 1: 后端 — registry findAll/findByTbAccountId enrich + q(TDD)

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/tb-account-registry.service.ts:71-94`
- Modify: `src/modules/accounting/tigerbeetle/tb-admin.controller.ts`(findAccounts 加 @Query('q'))
- Test: `src/modules/accounting/tigerbeetle/tb-account-registry.service.spec.ts`(先 Read 现有 mock 风格)

- [x] **Step 1: 写失败测试**(追加到现有 describe;prisma mock 需补 `customerMain: { findMany: jest.fn() }`)

```typescript
  describe('findAll q + ownerName enrich', () => {
    it('CUSTOMER 行批量附 ownerName,SYSTEM 行为 null(单次 IN 查询)', async () => {
      prisma.tbAccountRegistry.findMany.mockResolvedValue([
        { tbAccountId: 'a1', ownerType: 'CUSTOMER', ownerUuid: 'u1', ownerNo: 'CU1' },
        { tbAccountId: 'a2', ownerType: 'SYSTEM', ownerUuid: null, ownerNo: null },
      ]);
      prisma.tbAccountRegistry.count.mockResolvedValue(2);
      prisma.customerMain.findMany.mockResolvedValue([{ id: 'u1', firstName: 'Alice', lastName: 'Happy' }]);

      const { items } = await service.findAll({});
      expect(items[0].ownerName).toBe('Alice Happy');
      expect(items[1].ownerName).toBeNull();
      expect(prisma.customerMain.findMany).toHaveBeenCalledTimes(1); // 无 N+1
    });

    it('q 命中 ownerNo/姓名/description 三路 OR', async () => {
      prisma.customerMain.findMany
        .mockResolvedValueOnce([{ id: 'u9' }]) // 姓名反查
        .mockResolvedValueOnce([]);            // enrich 批量
      prisma.tbAccountRegistry.findMany.mockResolvedValue([]);
      prisma.tbAccountRegistry.count.mockResolvedValue(0);

      await service.findAll({ q: 'ali' });
      const where = prisma.tbAccountRegistry.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { ownerNo: { contains: 'ali' } },
        { description: { contains: 'ali' } },
        { ownerUuid: { in: ['u9'] } },
      ]);
    });
  });
```

- [x] **Step 2: 跑红** `npx jest src/modules/accounting/tigerbeetle/tb-account-registry.service.spec.ts` → FAIL(ownerName undefined / OR 缺失)

- [x] **Step 3: 实现**(替换 findAll;新增私有方法;findByTbAccountId 同步 enrich)

```typescript
  async findAll(filters: {
    assetCurrency?: string;
    ownerType?: string;
    code?: number;
    q?: string;
    skip?: number;
    take?: number;
  }) {
    const where: any = {};
    if (filters.assetCurrency) where.assetCode = filters.assetCurrency;
    if (filters.ownerType) where.ownerType = filters.ownerType;
    if (filters.code !== undefined) where.code = filters.code;

    const q = filters.q?.trim();
    if (q) {
      const byName = await (this.prisma as any).customerMain.findMany({
        where: { OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }] },
        select: { id: true },
      });
      const or: any[] = [
        { ownerNo: { contains: q } },
        { description: { contains: q } },
      ];
      if (byName.length > 0) or.push({ ownerUuid: { in: byName.map((c: any) => c.id) } });
      where.OR = or;
    }

    const [rows, total] = await Promise.all([
      (this.prisma as any).tbAccountRegistry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filters.skip ?? 0,
        take: filters.take ?? 50,
      }),
      (this.prisma as any).tbAccountRegistry.count({ where }),
    ]);

    return { items: await this.attachOwnerNames(rows), total };
  }

  /** CUSTOMER 行批量附 ownerName(单次 IN 查询,禁 N+1);SYSTEM 行恒 null。 */
  private async attachOwnerNames(rows: any[]): Promise<any[]> {
    const uuids = [
      ...new Set(
        rows.filter((r) => r.ownerType === 'CUSTOMER' && r.ownerUuid).map((r) => r.ownerUuid),
      ),
    ];
    if (uuids.length === 0) return rows.map((r) => ({ ...r, ownerName: null }));
    const customers = await (this.prisma as any).customerMain.findMany({
      where: { id: { in: uuids } },
      select: { id: true, firstName: true, lastName: true },
    });
    const names = new Map(
      customers.map((c: any) => [c.id, [c.firstName, c.lastName].filter(Boolean).join(' ') || null]),
    );
    return rows.map((r) => ({
      ...r,
      ownerName: r.ownerType === 'CUSTOMER' ? (names.get(r.ownerUuid) ?? null) : null,
    }));
  }
```

`findByTbAccountId`(先 Read 现实现):返回前包一层 `const [enriched] = await this.attachOwnerNames([row]); return enriched;`(null 仍返 null)。
controller `findAccounts` 加 `@Query('q') q?: string` 并透传 `q: q || undefined`。

- [x] **Step 4: 跑绿** 同 Step 2 → PASS;`npx jest src/modules/accounting` 全绿
- [x] **Step 5: Commit** `git add -A && git commit -m "feat(admin-api): tb accounts q search + ownerName enrichment"`

---

### Task 2: 后端 — evidence findAll q + coa(TDD)

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/tb-evidence.service.ts:116-133`
- Modify: `src/modules/accounting/tigerbeetle/tb-admin.controller.ts`(findTransfers 加 @Query('q')/@Query('coa'))
- Test: `src/modules/accounting/tigerbeetle/tb-evidence.service.spec.ts`

- [x] **Step 1: 写失败测试**

```typescript
  describe('findAll q + coa', () => {
    it('q → OR[tbTransferId 等值(去0x小写), sourceNo contains, traceId contains]', async () => {
      prisma.tbTransferEvidence.findMany.mockResolvedValue([]);
      prisma.tbTransferEvidence.count.mockResolvedValue(0);
      await service.findAll({ q: '0xAB12' });
      const where = prisma.tbTransferEvidence.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual([
        { OR: [{ tbTransferId: 'ab12' }, { sourceNo: { contains: '0xAB12' } }, { traceId: { contains: '0xAB12' } }] },
      ]);
    });

    it('coa → 借/贷任一侧命中,且兼容历史数字串', async () => {
      prisma.tbTransferEvidence.findMany.mockResolvedValue([]);
      prisma.tbTransferEvidence.count.mockResolvedValue(0);
      await service.findAll({ coa: 'L.CLIENT_PAYABLE' });
      const where = prisma.tbTransferEvidence.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual([
        { OR: [
          { debitCode: 'L.CLIENT_PAYABLE' }, { creditCode: 'L.CLIENT_PAYABLE' },
          { debitCode: '100' }, { creditCode: '100' },
        ] },
      ]);
    });
  });
```

- [x] **Step 2: 跑红** `npx jest src/modules/accounting/tigerbeetle/tb-evidence.service.spec.ts` → FAIL

- [x] **Step 3: 实现**(findAll 签名加 `q?: string; coa?: string;`;where 构造尾部追加;import COA_TO_TB_CODE)

```typescript
    const and: any[] = [];
    const q = filters.q?.trim();
    if (q) {
      const hex = q.toLowerCase().replace(/^0x/, '');
      and.push({ OR: [
        { tbTransferId: hex },
        { sourceNo: { contains: q } },
        { traceId: { contains: q } },
      ] });
    }
    if (filters.coa) {
      const numeric = COA_TO_TB_CODE[filters.coa];
      and.push({ OR: [
        { debitCode: filters.coa }, { creditCode: filters.coa },
        ...(numeric !== undefined ? [{ debitCode: String(numeric) }, { creditCode: String(numeric) }] : []),
      ] });
    }
    if (and.length > 0) where.AND = and;
```

controller `findTransfers` 加 `@Query('q') q?` / `@Query('coa') coa?` 透传。

- [x] **Step 4: 跑绿** + `npx jest src/modules/accounting` 全绿
- [x] **Step 5: Commit** `git add -A && git commit -m "feat(admin-api): tb transfers q (id/sourceNo/trace) + coa account filter"`

---

### Task 3: 前端 — 账户列表(Customer 列 + 搜索框 + 跳转)

**Files:**
- Modify: `admin-web/src/pages/LedgerAccountList.tsx`

- [x] **Step 1: 改造**(逐点,保持 Zone 布局与既有 class)
1. `LedgerAccountRow` 接口加 `ownerName: string | null;`;`FilterState` 加 `q: string;`,`DEFAULT_FILTERS` 加 `q: ''`。
2. fetch 参数:`if (f.q.trim()) params.set('q', f.q.trim());`
3. 筛选区(Asset 下拉之前)加搜索框(样式复用其它列表页的 input class,Enter 触发 handleSearch):
```tsx
        <input
          className={`${fi} w-[240px]`}
          placeholder="Customer no / name / description"
          value={filters.q}
          onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
        />
```
4. 表头:`Owner No` 列改为 `Customer`;行单元格:
```tsx
                <td className="px-3 py-2 font-mono text-[11px]">
                  {row.ownerType === 'CUSTOMER' && row.ownerNo ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/dashboard/customer/management/${row.ownerUuid}`); }}
                      className="text-adm-amber hover:underline"
                      title="Open customer"
                    >
                      {row.ownerNo}{row.ownerName ? ` · ${row.ownerName}` : ''}
                    </button>
                  ) : (
                    <span className="text-adm-t3">—</span>
                  )}
                </td>
```
(`ownerUuid` 已在行数据;若接口未回传该字段先确认 registry findAll select——现状全字段返回,有。)
5. `hasFilter` 判断加 `|| !!filters.q.trim()`;Reset 清 q。

- [x] **Step 2: 验证** `cd admin-web && npx tsc --noEmit` → 0 错;浏览器手验(搜 CU 号/姓名、点击跳客户页)
- [x] **Step 3: Commit** `git add -A && git commit -m "feat(admin): ledger account list — customer column with name + q search + profile link"`

---

### Task 4: 前端 — 账户详情(Customer 行)

**Files:**
- Modify: `admin-web/src/pages/LedgerAccountDetail.tsx`

- [x] **Step 1: 改造**
1. detail 接口类型加 `ownerName: string | null;`(及 `ownerUuid` 若类型缺)。
2. Owner 组(InfoField "Owner Type"/"Owner No" 附近,~218-245 行,先 Read):CUSTOMER 账户时把 Owner No 字段值替换为可点击 `customerNo · ownerName`:
```tsx
              <InfoField
                label="Customer"
                value={
                  detail.ownerType === 'CUSTOMER' && detail.ownerNo ? (
                    <button
                      onClick={() => navigate(`/dashboard/customer/management/${detail.ownerUuid}`)}
                      className="text-adm-amber hover:underline font-mono"
                    >
                      {detail.ownerNo}{detail.ownerName ? ` · ${detail.ownerName}` : ''}
                    </button>
                  ) : (
                    detail.ownerNo ?? '—'
                  )
                }
              />
```
(InfoField 若只收 string,先 Read 其签名;不支持 ReactNode 就直接在该处用与页面一致的 div 结构渲染。两处 Owner 展示——主体区与 sidebar——主体区放链接,sidebar 保持文本。)

- [x] **Step 2: 验证** admin tsc 0 错 + 手验(SYSTEM 账户不显 Customer 行)
- [x] **Step 3: Commit** `git add -A && git commit -m "feat(admin): ledger account detail — customer name + profile link"`

---

### Task 5: 前端 — 证据列表(ID 列 + q 搜索 + COA 下拉)

**Files:**
- Modify: `admin-web/src/pages/TransferEvidenceList.tsx`
- Modify(导出复用): `admin-web/src/pages/ledger-account.constants.ts`(若需新增 COA 选项导出)

- [x] **Step 1: constants 加 COA 选项导出**(基于既有 TB_CODE_LABELS 派生;class 前缀与后端 COA_TO_TB_CODE 一致)

```typescript
const CLASS_PREFIX: Record<number, string> = {
  1: 'A', 10: 'A', 50: 'A', 60: 'A',
  100: 'L', 101: 'L', 110: 'L',
  200: 'E', 210: 'E',
  300: 'R', 310: 'R', 320: 'R', 330: 'R',
};

/** COA 全名(如 'L.CLIENT_PAYABLE'),证据页筛选用。 */
export const COA_OPTIONS = Object.entries(TB_CODE_LABELS).map(([code, name]) => ({
  value: `${CLASS_PREFIX[Number(code)]}.${name}`,
  label: `${CLASS_PREFIX[Number(code)]}.${name}`,
}));
```

- [x] **Step 2: 列表页改造**
1. `FilterState` 加 `q: string; coa: string;`,DEFAULT_FILTERS 同步;fetch 参数 `q`/`coa` 透传(trim 非空才 set);hasFilter/Reset 同步。
2. 筛选区最前加搜索框(placeholder `Transfer ID / source no / trace`,Enter 触发);Source 下拉后加 COA 下拉:
```tsx
        <select
          className={`${fi} w-[200px]`}
          value={filters.coa}
          onChange={(e) => setFilters((p) => ({ ...p, coa: e.target.value }))}
        >
          <option value="">All accounts</option>
          {COA_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
```
3. 表头第一列加 `<th className={th} style={{ width: 130 }}>ID</th>`;行第一格:
```tsx
                <td className="px-3 py-2 font-mono text-[10px] text-adm-t2">
                  <span className="inline-flex items-center gap-1">
                    <span title={row.tbTransferId}>
                      {row.tbTransferId.slice(0, 8)}…{row.tbTransferId.slice(-6)}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(row.tbTransferId); }}
                      className="text-adm-t3 hover:text-adm-t1"
                      title="Copy full ID"
                    >
                      <Copy size={10} />
                    </button>
                  </span>
                </td>
```
(`Copy` 图标 from 'lucide-react',import 行补;若页面已有 copy util 用既有的。)
4. 空态/loading 行 `colSpan={9}` → `colSpan={10}`(两处)。

- [x] **Step 3: 验证** admin tsc 0 错;手验:搜 `SWP2606119254` 命中 4 笔、搜完整 tbTransferId 命中 1 笔、COA 选 `R.FEE_INCOME` 出全部费分录(含历史数字串行)
- [x] **Step 4: Commit** `git add -A && git commit -m "feat(admin): transfer evidence list — ID column, unified q search, COA account filter"`

---

### Task 6: 终验

- [x] **Step 1:** `npx jest`(全量 0 failed)+ `npm run build`(0 错)+ `cd admin-web && npx tsc --noEmit`(0 错)
- [x] **Step 2:** 证据详情页核验:Transfer ID + copy 已在(spec 2.3,只核不改);截图级手验四个页面
- [x] **Step 3:** 后端重启(`npm run dev:stop && npm run dev:start`)使接口生效;plan checkbox 全勾;`git add -A && git commit -m "docs(admin): ledger UX plan checkboxes"`(如有勾选变更)

---

## Self-Review 记录

- **Spec 覆盖**:§1.1/1.2→Task 1;§2.1→Task 2;§1.3→Task 3;§1.4→Task 4;§2.2→Task 5;§2.3→Task 6 Step 2(已确认存在,核验项);§3 测试→各 Task 内嵌。
- **占位符**:无 TBD;InfoField 签名与 sidebar 取舍在 Task 4 标明 Read-first 的决策规则,非留白。
- **类型一致**:`ownerName: string | null` 贯穿 Task 1/3/4;`q`/`coa` 参数名前后端一致;COA value 串与后端 COA_TO_TB_CODE 键一致(CLASS_PREFIX 表覆盖全部 13 个现行科目)。
