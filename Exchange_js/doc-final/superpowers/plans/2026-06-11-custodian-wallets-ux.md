# Custodian Wallets UX 打磨 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec `doc-final/superpowers/specs/2026-06-11-custodian-wallets-ux-design.md` 修正钱包银行信息(Zand)、脏数据、verify 脚本,并重做钱包列表/详情的搜索、Owner 拆列与字段分组(删 Surface)。

**Architecture:** seed/SQL 修数据;verify 脚本改走标准编号器+CMA 继承;后端 wallet-query 批量 enrich(消灭既有 N+1)+ controller 加 walletNo/ownerNo 参数 + 删 surfaceCategory;前端两页按既有 Zone/Section 风格重排。`classifyWalletSurface` util **保留**(safeguarding-reconciliation.service.ts:434/445 在用),只删钱包响应与 UI。

**Tech Stack:** NestJS+Prisma、React+Vite。测试 `npx jest <file>`;admin 校验 `cd admin-web && npx tsc --noEmit`。分支 `branch`,只 commit 不 push。branch DB:`/tmp/exchange_js_branch/dev.db`,TB `127.0.0.1:3503`。

**已钉事实:**
- `wallet-query.service.ts` 的 `resolveOwnerInfo`(63-78 行)是 per-wallet N+1;客户姓名取 `companyName || fullName || email` 而 customer_main 无 `fullName`(只有 firstName/lastName:schema 189-190 行)→ 个人客户名显示成 email,本次一并修
- controller `findAll`(wallets.controller.ts:63-95)admin 分支构造 where;CUSTOMER token 分支强制只看自己,**不动**
- 前端两页接口类型已有 `ownerName?`,展示为合并 ownerLabel(List:292、Detail:196),要拆开
- `buildDeterministicNo(prefix, ...segments)` 产出 `WA260101XXXX` 式样(no-generator.util.ts:14-23)
- seed 钱包 upsert 的 update 分支含 bankName/accountName/iban → 重跑 seed 即刷新存量平台行
- 脏数据两行:`WA-VERIFY-DEP-1781115747314`(crypto)、`WA-VERIFY-VIBAN-1781115747314`(fiat)

---

### Task 1: seed — Zand 银行信息 + 合规 IBAN

**Files:**
- Modify: `prisma/seed.business.ts`(`buildSystemPoolIban` ~86-92 行;法币钱包 upsert ~169-197 行)

- [x] **Step 1: 改 IBAN 生成器**(替换现函数;AE+2 位校验+3 位银行码+16 位账号=23 字符,全数字,确定性)

```typescript
function buildSystemPoolIban(role: SystemWalletRole, assetCode: string): string {
  const hash = createHash('sha256')
    .update(`${role}|${normalizeSegment(assetCode)}`)
    .digest('hex');
  // AE IBAN 形制:AE + 2 check digits + 3-digit bank code + 16-digit account (23 chars)。
  // 演示库:数字从 hash 确定性导出,不做真实 mod-97 校验(spec §7 范围外)。
  const digits = BigInt('0x' + hash.slice(0, 24)).toString().padStart(18, '0');
  return `AE${digits.slice(0, 2)}086${digits.slice(2, 18)}`;
}
```

- [x] **Step 2: 改法币钱包 upsert 的银行字段**(update 与 create 两分支同改)

```typescript
            bankName: 'Zand Bank PJSC',
            accountName: 'FiatX Ltd',
```

(替换原 `bankName: 'FiatX Internal Bank'` 与 `accountName: \`Platform ${role} (${asset.code})\``,两处分支各两行。)

- [x] **Step 3: 重跑 seed 刷新存量平台行**

Run:
```bash
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" TB_ADDRESS=127.0.0.1:3503 npm run db:biz:init
```
(先 `grep '"db:biz:init"' package.json` 确认脚本名;若叫别名以实际为准。)
Expected: seed 输出正常结束。

- [x] **Step 4: 验证**

```bash
sqlite3 /tmp/exchange_js_branch/dev.db "SELECT walletNo, walletRole, bankName, accountName, iban FROM wallets WHERE type='FIAT_BANK' AND ownerType='PLATFORM';"
```
Expected: 5 行(C_CMA/F_SET/F_FEE/F_OPS/F_LIQ)全部 `Zand Bank PJSC|FiatX Ltd|AE\d{2}086\d{16}`。

- [x] **Step 5: Commit** `git add -A && git commit -m "feat(seed): platform fiat wallets carry Zand Bank PJSC / FiatX Ltd + well-formed AE IBAN"`

---

### Task 2: 存量脏数据 SQL 原位修正

**Files:** 无代码文件(一次性 SQL,操作 branch DB)

- [x] **Step 1: 选定两个不冲突的标准号**

```bash
sqlite3 /tmp/exchange_js_branch/dev.db "SELECT walletNo FROM wallets WHERE walletNo IN ('WA2601019901','WA2601019902');"
```
Expected: 空输出(可用);若被占用换 9903/9904 顺延。

- [x] **Step 2: 修正(前后对比都要贴)**

```bash
sqlite3 /tmp/exchange_js_branch/dev.db "
SELECT walletNo, walletRole, bankName, accountName FROM wallets WHERE walletNo LIKE 'WA-VERIFY-%';
UPDATE wallets SET walletNo='WA2601019901' WHERE walletNo LIKE 'WA-VERIFY-DEP-%';
UPDATE wallets SET walletNo='WA2601019902', bankName='Zand Bank PJSC', accountName='FiatX Ltd' WHERE walletNo LIKE 'WA-VERIFY-VIBAN-%';
SELECT walletNo, walletRole, bankName, accountName FROM wallets WHERE walletNo IN ('WA2601019901','WA2601019902');
"
```
Expected: 修正后两行标准号;VIBAN 行带 Zand/FiatX Ltd;再跑一次 UPDATE 零行命中(幂等)。

- [x] **Step 3:** 无 commit(纯数据操作);在 Task 7 终验里复查列表页不再出现 `WA-VERIFY`。

---

### Task 3: verify-two-book.ts 治本

**Files:**
- Modify: `scripts/verify-two-book.ts:140-160`(先 Read 该段)

- [x] **Step 1: 钱包创建改标准编号 + VIBAN 继承 CMA**

文件头 import 区加:
```typescript
import { buildDeterministicNo } from '../src/common/utils/no-generator.util';
```

C_DEP 钱包(原 `walletNo: \`WA-VERIFY-DEP-${tag}\``)改:
```typescript
        walletNo: buildDeterministicNo('WA', 'VERIFY', 'C_DEP', alice.customerNo),
```

C_VIBAN 钱包:创建前查 CMA 并继承(原手写 bankName/accountName 删除):
```typescript
      const cma = await prisma.wallet.findFirst({
        where: { walletRole: 'C_CMA', assetId: aedAsset.id, status: 'ACTIVE' },
        select: { bankName: true, accountName: true },
      });
```
```typescript
        walletNo: buildDeterministicNo('WA', 'VERIFY', 'C_VIBAN', alice.customerNo),
        bankName: cma?.bankName ?? null,
        accountName: cma?.accountName ?? null,
```
(变量名 `alice`/`aedAsset`/`tag` 以脚本实际为准;upsert 按 walletNo 唯一键 → 确定性编号天然幂等。)

- [x] **Step 2: 编译校验**

Run: `npx tsc --noEmit scripts/verify-two-book.ts --esModuleInterop --skipLibCheck --module commonjs --target es2020 2>&1 | head -5`
Expected: 无该文件自身错误(第三方类型噪音可忽略;或直接 `npx ts-node --transpileOnly -e "console.log('ok')"` 级别确认 ts-node 可用,脚本完整执行留给将来重建场景)。

- [x] **Step 3: Commit** `git add -A && git commit -m "fix(scripts): verify-two-book wallets use standard numbering + VIBAN inherits CMA bank fields"`

---

### Task 4: 后端 — walletNo/ownerNo 搜索 + 批量 enrich + 删 surfaceCategory(TDD)

**Files:**
- Modify: `src/modules/asset-treasury/wallets/wallet-query.service.ts`
- Modify: `src/modules/asset-treasury/wallets/wallets.controller.ts`(findAll)
- Test: `src/modules/asset-treasury/wallets/wallet-query.service.spec.ts`(先 Read 现 mock 结构)

- [x] **Step 1: 写失败测试**(改造现 spec:删 surfaceCategory 正断言,加以下用例;mock prisma 需有 customerMain.findMany / liquidityProvider.findMany)

```typescript
    it('CUSTOMER 行批量 enrich ownerName(firstName+lastName,单次 IN),响应不含 surfaceCategory', async () => {
      prisma.wallet.findMany.mockResolvedValue([
        { id: 'w1', ownerType: 'CUSTOMER', ownerId: 'u1', mockBalance: 5, asset: {} },
        { id: 'w2', ownerType: 'CUSTOMER', ownerId: 'u2', mockBalance: 0, asset: {} },
        { id: 'w3', ownerType: 'PLATFORM', ownerId: null, ownerNo: 'PLATFORM', mockBalance: 0, asset: {} },
      ]);
      prisma.wallet.count.mockResolvedValue(3);
      prisma.customerMain.findMany.mockResolvedValue([
        { id: 'u1', customerNo: 'CU1', firstName: 'Alice', lastName: 'Happy', companyName: null, email: 'a@x.com' },
        { id: 'u2', customerNo: 'CU2', firstName: null, lastName: null, companyName: 'Acme Ltd', email: 'b@x.com' },
      ]);

      const result = await service.findAll({ skip: 0, take: 50, where: {}, orderBy: { createdAt: 'desc' } });
      expect(result.items[0].ownerName).toBe('Alice Happy');     // 姓名优先,不再 email
      expect(result.items[1].ownerName).toBe('Acme Ltd');        // 公司名兜底
      expect(result.items[2].ownerName).toBe('Platform');
      expect(result.items[0].surfaceCategory).toBeUndefined();
      expect(prisma.customerMain.findMany).toHaveBeenCalledTimes(1); // 批量 IN,无 N+1
    });
```

- [x] **Step 2: 跑红** `npx jest src/modules/asset-treasury/wallets/wallet-query.service.spec.ts` → FAIL(现实现 ownerName 走 email / surfaceCategory 存在 / findMany 多次)

- [x] **Step 3: 实现**(整体替换 findAll/findOne 的 enrich 路径;删 resolveOwnerInfo、classifyWalletSurface import 与 surfaceCategory 字段)

```typescript
  async findAll({ skip, take, where, orderBy }: any) {
    const [items, total] = await Promise.all([
      this.prisma.wallet.findMany({ skip, take, where, orderBy, include: { asset: true } }),
      this.prisma.wallet.count({ where }),
    ]);
    const enriched = await this.attachOwnerInfo(items);
    return {
      items: enriched.map((w: any) => ({ ...w, balance: w.mockBalance })),
      total,
    };
  }

  async findOne(id: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id },
      include: { asset: true },
    });
    if (!wallet) throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: `Wallet ${id} not found` });
    const [enriched] = await this.attachOwnerInfo([wallet]);
    return { ...enriched, balance: (wallet as any).mockBalance };
  }

  /** 批量 owner enrich:CUSTOMER/LP 各一次 IN 查询(无 N+1);姓名 firstName+lastName 优先。 */
  private async attachOwnerInfo(wallets: any[]): Promise<any[]> {
    const idsOf = (type: string) => [
      ...new Set(wallets.filter((w) => w.ownerType === type && w.ownerId).map((w) => w.ownerId)),
    ];
    const customerIds = idsOf('CUSTOMER');
    const lpIds = idsOf('LIQUIDITY_PROVIDER');
    const [customers, lps] = await Promise.all([
      customerIds.length
        ? (this.prisma as any).customerMain.findMany({
            where: { id: { in: customerIds } },
            select: { id: true, customerNo: true, firstName: true, lastName: true, companyName: true, email: true },
          })
        : Promise.resolve([]),
      lpIds.length
        ? (this.prisma as any).liquidityProvider.findMany({
            where: { id: { in: lpIds } },
            select: { id: true, providerNo: true, name: true },
          })
        : Promise.resolve([]),
    ]);
    const cMap = new Map(customers.map((c: any) => [c.id, c]));
    const lpMap = new Map(lps.map((l: any) => [l.id, l]));

    return wallets.map((w: any) => {
      if (w.ownerType === 'PLATFORM') return { ...w, ownerName: 'Platform', ownerNo: w.ownerNo ?? 'PLATFORM' };
      if (w.ownerType === 'CUSTOMER') {
        const c: any = cMap.get(w.ownerId);
        const name = c
          ? [c.firstName, c.lastName].filter(Boolean).join(' ') || c.companyName || c.email || null
          : null;
        return { ...w, ownerName: name, ownerNo: c?.customerNo ?? w.ownerNo ?? null };
      }
      if (w.ownerType === 'LIQUIDITY_PROVIDER') {
        const l: any = lpMap.get(w.ownerId);
        return { ...w, ownerName: l?.name ?? null, ownerNo: l?.providerNo ?? null };
      }
      return { ...w, ownerName: null, ownerNo: w.ownerNo ?? null };
    });
  }
```

(`classifyWalletSurface` import 删除;util 文件**不动**——safeguarding-reconciliation 在用。`findBalance` 不动。)

controller `findAll` 参数区加:
```typescript
    @Query('walletNo') walletNo?: string,
    @Query('ownerNo') ownerNo?: string,
```
admin 分支 where 构造尾部加:
```typescript
    if (walletNo?.trim()) where.walletNo = { contains: walletNo.trim() };
    if (ownerNo?.trim()) where.ownerNo = { contains: ownerNo.trim() };
```
(CUSTOMER token 分支不动;@ApiQuery 装饰器照既有风格补两条。)

- [x] **Step 4: 跑绿** 同文件 PASS + `npx jest src/modules/asset-treasury` 全绿 + `npm run build` 零错
- [x] **Step 5: Commit** `git add -A && git commit -m "feat(wallets-api): walletNo/ownerNo search, batched owner enrichment (kills N+1 + email-as-name), drop surfaceCategory"`

---

### Task 5: 前端列表(CustodianWalletList.tsx)

**Files:**
- Modify: `admin-web/src/pages/CustodianWalletList.tsx`(先 Read 全文)

- [x] **Step 1: 改造**
1. `FilterState`:删 `ownerIdSearch`,加 `walletNoSearch: string; customerNoSearch: string;`,DEFAULT_FILTERS 同步。
2. `buildParams`:删 `ownerId` 行,加:
```typescript
    if (next.walletNoSearch.trim()) params.set('walletNo', next.walletNoSearch.trim());
    if (next.customerNoSearch.trim()) params.set('ownerNo', next.customerNoSearch.trim());
```
3. 筛选区:旧 "Owner ID / No" input 替换为两个输入框(均 Enter 触发 Search,样式用页内 `fi`):
```tsx
        <input
          className={`${fi} w-[170px]`}
          placeholder="Wallet No"
          value={filters.walletNoSearch}
          onChange={(e) => updateFilter('walletNoSearch', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <input
          className={`${fi} w-[170px]`}
          placeholder="Customer No"
          value={filters.customerNoSearch}
          onChange={(e) => updateFilter('customerNoSearch', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
```
4. 列:表头 `Owner` 拆为 `Owner No` + `Owner Name`(列宽各 ~120/140px);行渲染(替换原 ownerLabel 单元格):
```tsx
                {/* Owner No */}
                <td className="px-3 py-2 font-mono text-[11px]">
                  {w.ownerType === 'CUSTOMER' && w.ownerNo && w.ownerId ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/dashboard/customer/${w.ownerId}`); }}
                      className="text-adm-amber hover:underline"
                      title="Open customer"
                    >
                      {w.ownerNo}
                    </button>
                  ) : (
                    <span className="text-adm-t2">{w.ownerNo ?? '—'}</span>
                  )}
                </td>
                {/* Owner Name */}
                <td className="px-3 py-2 text-[11px] text-adm-t2">
                  {w.ownerName ?? <span className="text-adm-t3">—</span>}
                </td>
```
(行接口需含 `ownerId`;缺则在 interface 补 `ownerId: string | null;`。)
5. Balance 表头改 `Balance (mock)`。
6. 空态/loading 的 colSpan 按新列数 +1(原列数先数清再改,两处)。

- [x] **Step 2: 验证** `cd admin-web && npx tsc --noEmit` 0 错;`curl -s -o /dev/null -w "%{http_code}" http://localhost:3501/src/pages/CustodianWalletList.tsx` → 200
- [x] **Step 3: Commit** `git add -A && git commit -m "feat(admin): custodian wallet list — walletNo/customerNo search, owner split columns, mock balance label"`

---

### Task 6: 前端详情(CustodianWalletDetail.tsx)

**Files:**
- Modify: `admin-web/src/pages/CustodianWalletDetail.tsx`(先 Read 全文,310-420 行是分区主体)

- [x] **Step 1: 改造**
1. 删 `SURFACE_LABELS` 常量、`surfaceLabel` 计算、hero/任意处的 `<InfoField label="Surface" …>` 与 `surfaceCategory` 接口字段。
2. Details 区重排为(原 Owner/Owner Type/Owner No 三件套替换):
```tsx
              <InfoField label="Role" value={wallet.walletRole} mono />
              <InfoField label="Owner Type" value={wallet.ownerType} />
              <div className="min-w-0">
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Owner No</div>
                <div className="mt-1 text-[13px]">
                  {wallet.ownerType === 'CUSTOMER' && wallet.ownerNo && wallet.ownerId ? (
                    <button
                      onClick={() => navigate(`/dashboard/customer/${wallet.ownerId}`)}
                      className="text-adm-amber hover:underline font-mono text-[11px]"
                      title="Open customer"
                    >
                      {wallet.ownerNo}
                    </button>
                  ) : (
                    <span className="font-mono text-[11px] text-adm-t2">{wallet.ownerNo ?? '—'}</span>
                  )}
                </div>
              </div>
              <InfoField label="Owner Name" value={wallet.ownerName ?? '—'} />
              <InfoField label="Asset" value={wallet.asset.code} />
              <InfoField label="Network" value={wallet.asset.network || '—'} />
```
(Role 若 hero 已有 badge 可不重复——以现页为准,保持信息不丢即可;Vault ID 移到 Crypto Address 区。)
3. 分区顺序核对为:Details → Balance(label 标 `Balance (mock)`)→ Bank Account(fiat:Bank Name/Account Holder/IBAN)或 Crypto Address(crypto:Address/Vault ID)→ Deposit Collection(仅 C_DEP,现有保留)→ Audit(Created/Updated;Updated 字段若接口缺,用 wallet.updatedAt——schema 有)。
4. sidebar:删 Surface 相关行;Owner 行拆 `Owner No`(文本)+ `Owner Name`(文本)。

- [x] **Step 2: 验证** admin tsc 0 错;`curl …/CustodianWalletDetail.tsx` → 200
- [x] **Step 3: Commit** `git add -A && git commit -m "feat(admin): custodian wallet detail — regrouped sections, owner split + link, drop Surface"`

---

### Task 7: 终验

- [x] **Step 1:** `npx jest`(0 failed)+ `npm run build`(0 错)+ `cd admin-web && npx tsc --noEmit`(0 错)
- [x] **Step 2:** 重启栈:`npm run dev:stop && npm run dev:start`,确认 3500/3503 LISTEN
- [x] **Step 3:** 手验清单(贴 sqlite/接口证据):
  - 列表无 `WA-VERIFY` 残留;搜 `WA26` 命中、搜 `CU2601019430` 命中其钱包
  - CMA/F_* 行显示 `Zand Bank PJSC` / `FiatX Ltd`、IBAN 形如 `AE\d{2}086\d{16}`
  - 修正后的 VIBAN 行(WA2601019902)同显 Zand 信息
  - 详情页:无 Surface;分区顺序 Details/Balance/Bank|Address/(Deposit Collection)/Audit;Owner No 可跳客户详情
- [x] **Step 4:** plan checkbox 全勾 + `git add -A && git commit -m "docs(admin): custodian wallets UX plan checkboxes"`

---

## Self-Review 记录

- **Spec 覆盖**:§1.1→Task 1;§1.2→Task 2;§2→Task 3;§3→Task 4;§4→Task 5;§5→Task 6;§6→各任务+Task 7。
- **占位符**:无 TBD;Task 3 变量名声明"以脚本实际为准"并给出语义,非留白;Task 6 标注"以现页为准,信息不丢"的裁量规则。
- **类型一致**:`attachOwnerInfo` 返回 `ownerName/ownerNo` 与前端接口字段一致;查询参数 `walletNo`/`ownerNo` 前后端一致;`ownerId` 用于跳转与 CUSTOMER 判定贯穿 Task 4/5/6。
- **保护项**:`classifyWalletSurface` util 不删(safeguarding 在用);CUSTOMER token 分支不动;`findBalance` 不动。
