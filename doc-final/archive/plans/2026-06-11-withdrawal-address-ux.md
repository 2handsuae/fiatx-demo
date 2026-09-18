# Withdrawal Address UX 打磨 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec `doc-final/superpowers/specs/2026-06-11-withdrawal-address-ux-design.md` 给提现地址页加 Label 列、客户名、客户跳转、三合一搜索与 Asset 下拉。

**Architecture:** 后端 DTO+service 加 `q` 与 customer include/铺平;前端两页按既有 Zone/Section 风格改造。无 schema 变更、无审计写入。

**Tech Stack:** NestJS+Prisma、React+Vite。测试 `npx jest <file>`;admin 校验 `cd admin-web && npx tsc --noEmit`。分支 `branch`,只 commit 不 push。

**已钉事实:** 模型有 `customer` 关联(schema 1337 行)与 `label/iban` 字段;service 列表现仅 `include: { asset: true }`(withdrawal-address.service.ts:89 附近);DTO 在 `dto/list-withdrawal-address-query.dto.ts`;列表 8 列起于 'Address No'(WithdrawalAddressList.tsx:231 区);详情 Customer 行在 WithdrawalAddressDetail.tsx:297;客户跳转惯例 `/dashboard/customer/:id`;Asset 下拉模式参照 TransferEvidenceList 的 fetchCurrencyOptions(取 `/assets?take=100`,本页 value 用 `a.id`、label 用 `a.code`)。

---

### Task 1: 后端 — q 搜索 + customerName 铺平(TDD)

**Files:**
- Modify: `src/modules/asset-treasury/withdrawal-addresses/dto/list-withdrawal-address-query.dto.ts`
- Modify: `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address.service.ts`(list 查询与 detail 查询;先 Read 全文找 list/findOne 方法实名)
- Test: `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address.service.spec.ts`(先 Read 现 mock 结构)

- [x] **Step 1: 失败测试**(按现 spec mock 风格落地,断言语义如下)

```typescript
    it('q → OR[addressNo/address/iban contains],customerName 由 customer 关联铺平', async () => {
      prisma.withdrawalAddress.findMany.mockResolvedValue([
        { id: 'a1', addressNo: 'ADDR1', customerNo: 'CU1', label: 'My Binance',
          customer: { firstName: 'Alice', lastName: 'Happy' }, asset: { code: 'USDT-TRON' } },
        { id: 'a2', addressNo: 'ADDR2', customerNo: 'CU2', label: null,
          customer: { firstName: null, lastName: null }, asset: { code: 'AED' } },
      ]);
      prisma.withdrawalAddress.count.mockResolvedValue(2);

      const result = await service.list({ q: 'TVx9', take: 50, skip: 0 } as any);
      const where = prisma.withdrawalAddress.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { addressNo: { contains: 'TVx9' } },
        { address: { contains: 'TVx9' } },
        { iban: { contains: 'TVx9' } },
      ]);
      expect(result.items[0].customerName).toBe('Alice Happy');
      expect(result.items[1].customerName).toBeNull();
    });
```

(service 方法名/返回结构以实际为准;若 list 返回 `{ items, total }` 以外结构,断言对位调整,语义不变。)

- [x] **Step 2: 跑红** `npx jest src/modules/asset-treasury/withdrawal-addresses/withdrawal-address.service.spec.ts` → FAIL
- [x] **Step 3: 实现**

DTO 追加:
```typescript
  @ApiProperty({ required: false, description: 'addressNo / address / IBAN 模糊搜索' })
  @IsString()
  @IsOptional()
  q?: string;
```

service list:where 构造尾部加
```typescript
    const q = query.q?.trim();
    if (q) {
      where.OR = [
        { addressNo: { contains: q } },
        { address: { contains: q } },
        { iban: { contains: q } },
      ];
    }
```
include 改 `include: { asset: true, customer: { select: { firstName: true, lastName: true } } }`;返回 items map 铺平:
```typescript
    const flat = (r: any) => ({
      ...r,
      customerName: r.customer
        ? [r.customer.firstName, r.customer.lastName].filter(Boolean).join(' ') || null
        : null,
      customer: undefined,
    });
```
(items.map(flat);detail 方法同样 include + flat;`customer: undefined` 防止把整个关联对象泄给前端。)

- [x] **Step 4: 跑绿** 同文件 + `npx jest src/modules/asset-treasury` 全绿 + `npm run build` 零错
- [x] **Step 5: Commit** `git add -A && git commit -m "feat(withdrawal-address-api): unified q search (addressNo/address/iban) + customerName"`

---

### Task 2: 列表页(WithdrawalAddressList.tsx)

**Files:** Modify `admin-web/src/pages/WithdrawalAddressList.tsx`(先 Read 全文)

- [x] **Step 1: 改造**
1. 行接口加 `customerName: string | null; customerId: string; label: string | null;`(已有的不重复)。
2. `FilterState` 加 `q: string; assetId: string;`;DEFAULT_FILTERS 同步;buildParams 加:
```typescript
    if (next.q.trim()) params.set('q', next.q.trim());
    if (next.assetId) params.set('assetId', next.assetId);
```
3. Asset 选项:加 state + 挂载拉取(参照 TransferEvidenceList.fetchCurrencyOptions 模式,但 value 用 `a.id`、label 用 `a.code`,过滤 `tbLedgerId != null`)。
4. 筛选区:最前加搜索框(placeholder `Address No / address / IBAN`,Enter 触发 handleSearch)+ Customer No 框后加 Asset 下拉(`All assets` 默认);hasFilter 加 `|| !!filters.q.trim() || !!filters.assetId`。
5. 列(8→10):`Address No | Customer No | Customer Name | Label | Asset | Network | Address | Type | Status | Registered`。行单元格:
```tsx
                {/* Customer No */}
                <td className="px-3 py-2 font-mono text-[11px]">
                  {row.customerNo && row.customerId ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/dashboard/customer/${row.customerId}`); }}
                      className="text-adm-amber hover:underline"
                      title="Open customer"
                    >
                      {row.customerNo}
                    </button>
                  ) : (
                    <span className="text-adm-t3">—</span>
                  )}
                </td>
                {/* Customer Name */}
                <td className="px-3 py-2 text-[11px] text-adm-t2">
                  {row.customerName ?? <span className="text-adm-t3">—</span>}
                </td>
                {/* Label */}
                <td className="px-3 py-2 text-[11px] text-adm-t2 truncate max-w-[140px]" title={row.label ?? ''}>
                  {row.label ?? <span className="text-adm-t3">—</span>}
                </td>
```
Address 单元格改:
```tsx
                <td className="px-3 py-2 font-mono text-[10px] text-adm-t2">
                  <span className="inline-flex items-center gap-1">
                    <span className="truncate max-w-[130px]" title={row.address}>{row.address}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); copyToClipboard(row.address); }}
                      className="text-adm-t3 hover:text-adm-t1"
                      title="Copy address"
                    >
                      <Copy size={10} />
                    </button>
                  </span>
                </td>
```
(`Copy` 入 lucide import;`copyToClipboard` from '../utils/clipboard';原 Customer 列删除,被 No/Name 两列取代。)
6. 空态/loading colSpan 8→10(全部)。

- [x] **Step 2: 验证** `cd admin-web && npx tsc --noEmit` 0 错;`curl -s -o /dev/null -w "%{http_code}" http://localhost:3501/src/pages/WithdrawalAddressList.tsx` → 200
- [x] **Step 3: Commit** `git add -A && git commit -m "feat(admin): withdrawal address list — label/customer-name columns, customer link, unified search + asset filter"`

---

### Task 3: 详情页(WithdrawalAddressDetail.tsx)

**Files:** Modify `admin-web/src/pages/WithdrawalAddressDetail.tsx`(先 Read 295-305 区与接口定义)

- [x] **Step 1: 改造**
1. 数据接口加 `customerName: string | null; customerId: string;`(缺则补)。
2. Details 区(297 行 `<InfoField label="Customer" value={data.customerNo} mono accent />`)替换为:
```tsx
              <div className="min-w-0">
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Customer No</div>
                <div className="mt-1 text-[13px]">
                  {data.customerNo && data.customerId ? (
                    <button
                      onClick={() => navigate(`/dashboard/customer/${data.customerId}`)}
                      className="text-adm-amber hover:underline font-mono text-[11px]"
                      title="Open customer"
                    >
                      {data.customerNo}
                    </button>
                  ) : (
                    <span className="font-mono text-[11px] text-adm-t2">{data.customerNo ?? '—'}</span>
                  )}
                </div>
              </div>
              <InfoField label="Customer Name" value={data.customerName ?? '—'} />
```
(`navigate` 用页内既有 useNavigate,缺则补 import。)

- [x] **Step 2: 验证** admin tsc 0 错 + curl 200
- [x] **Step 3: Commit** `git add -A && git commit -m "feat(admin): withdrawal address detail — customer no link + customer name"`

---

### Task 4: 终验

- [x] `npx jest`(0 failed)+ `npm run build` + `cd admin-web && npx tsc --noEmit` 全绿
- [x] 重启栈 `npm run dev:stop && npm run dev:start`,3500/3503 LISTEN
- [x] 手验:搜地址片段/编号命中、Asset 下拉过滤、Label 列、Customer No 双页跳转、Customer Name 展示
- [x] plan checkbox 全勾 + commit

## Self-Review 记录

- Spec 覆盖:§1→T1;§2→T2;§3→T3;§4→T4。
- 类型一致:`customerName`/`customerId`/`q`/`assetId` 贯穿前后端;flat() 把 customer 关联剥掉防泄露。
- 占位符:无;service 方法名差异已声明"以实际为准+语义不变"的裁量规则。
