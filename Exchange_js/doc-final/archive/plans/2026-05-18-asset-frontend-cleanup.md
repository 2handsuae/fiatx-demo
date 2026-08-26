# Asset Frontend Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Asset list page column issues, detail page spec violations, and remove contractAddress from all frontend pages.

**Architecture:** Pure frontend changes across 4 React pages. No backend or API changes. All changes are independent per-file.

**Tech Stack:** React, TypeScript, Tailwind CSS, react-router-dom

---

### Task 1: Refactor AssetList.tsx — columns, row click, remove Action

**Files:**
- Modify: `admin-web/src/pages/AssetList.tsx`

- [ ] **Step 1: Replace table header row**

In `AssetList.tsx`, find the `<thead>` block (lines 211–222):

```tsx
          <thead className="sticky top-0 z-10 bg-adm-panel">
            <tr className="border-b border-adm-border">
              <th className={th} style={{ width: 120 }}>Asset No</th>
              <th className={th} style={{ width: 80 }}>Type</th>
              <th className={th} style={{ width: 100 }}>Network</th>
              <th className={th} style={{ width: 70 }}>Decimals</th>
              <th className={th}>Description</th>
              <th className={th} style={{ width: 80 }}>Status</th>
              <th className={th} style={{ width: 140 }}>Updated</th>
              <th className={th} style={{ width: 120 }}>Action</th>
            </tr>
          </thead>
```

Replace with:

```tsx
          <thead className="sticky top-0 z-10 bg-adm-panel">
            <tr className="border-b border-adm-border">
              <th className={th} style={{ width: 120 }}>Asset No</th>
              <th className={th} style={{ width: 80 }}>Code</th>
              <th className={th} style={{ width: 80 }}>Type</th>
              <th className={th} style={{ width: 100 }}>Network</th>
              <th className={th} style={{ width: 70 }}>Decimals</th>
              <th className={th} style={{ width: 100 }}>Status</th>
              <th className={th} style={{ width: 140 }}>Updated</th>
            </tr>
          </thead>
```

- [ ] **Step 2: Replace empty-state row colspan**

Find (line 226):

```tsx
                <td colSpan={8} className="px-3 py-12 text-center text-[11px] text-adm-t3">
```

Replace with:

```tsx
                <td colSpan={7} className="px-3 py-12 text-center text-[11px] text-adm-t3">
```

- [ ] **Step 3: Replace each data row**

Find the entire `items.map` callback (lines 231–293):

```tsx
              items.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-adm-border hover:bg-adm-hover"
                >
                  <td className="px-3 py-2">
                    <button
                      className={adminButtonClass('rowKeyLink')}
                      onClick={() => navigate(`/dashboard/system/assets/${a.id}`)}
                      title={a.assetNo || a.code}
                    >
                      {a.assetNo || a.code}
                    </button>
                    <div className="mt-0.5 font-mono text-[10px] text-adm-t3">{a.code}</div>
                  </td>
                  <td className="px-3 py-2">
                    <AdminBadge value={a.type} />
                  </td>
                  <td className="px-3 py-2 font-mono text-adm-t2">
                    {a.network || '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-adm-t2">
                    {a.decimals}
                  </td>
                  <td className="px-3 py-2 text-adm-t2 truncate max-w-[200px]" title={a.description || ''}>
                    {a.description || '—'}
                  </td>
                  <td className="px-3 py-2">
                    <AdminBadge value={a.status} />
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-adm-t2">
                    {fmt(a.updatedAt)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {a.status === 'PROVISIONING' && (
                        <button
                          onClick={() => navigate(`/dashboard/system/assets/${a.id}`)}
                          className={adminButtonClass('rowSecondaryUtility')}
                        >
                          Activate
                        </button>
                      )}
                      {a.status === 'ACTIVE' && (
                        <button
                          onClick={() => navigate(`/dashboard/system/assets/${a.id}`)}
                          className={adminButtonClass('rowSecondaryUtility')}
                        >
                          Suspend
                        </button>
                      )}
                      {a.status === 'SUSPENDED' && (
                        <button
                          onClick={() => navigate(`/dashboard/system/assets/${a.id}`)}
                          className={adminButtonClass('rowSecondaryUtility')}
                        >
                          Reactivate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
```

Replace with:

```tsx
              items.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-adm-border hover:bg-adm-hover cursor-pointer"
                  onClick={() => navigate(`/dashboard/system/assets/${a.id}`)}
                >
                  <td className="px-3 py-2 font-mono text-[11px] text-adm-amber">
                    {a.assetNo || '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] font-semibold text-adm-t1">
                    {a.code}
                  </td>
                  <td className="px-3 py-2">
                    <AdminBadge value={a.type} />
                  </td>
                  <td className="px-3 py-2 font-mono text-adm-t2">
                    {a.network || '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-adm-t2">
                    {a.decimals}
                  </td>
                  <td className="px-3 py-2">
                    <AdminBadge value={a.status} />
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-adm-t2">
                    {fmt(a.updatedAt)}
                  </td>
                </tr>
              ))
```

- [ ] **Step 4: Verify build**

Run: `cd admin-web && npx tsc --noEmit`
Expected: zero errors in `AssetList.tsx`

- [ ] **Step 5: Commit**

```bash
git add admin-web/src/pages/AssetList.tsx
git commit -m "refactor(admin): clean up asset list page columns and row click"
```

---

### Task 2: Fix AssetDetail.tsx — 5 spec violations + remove contractAddress

**Files:**
- Modify: `admin-web/src/pages/AssetDetail.tsx`

- [ ] **Step 1: Fix violation 1 — remove title/subtitle from DetailPageHeader**

Find (lines 226–232):

```tsx
      <DetailPageHeader
        title="ASSET"
        subtitle={asset.assetNo || asset.code}
        onBack={() => navigate('/dashboard/system/assets')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
      />
```

Replace with:

```tsx
      <DetailPageHeader
        onBack={() => navigate('/dashboard/system/assets')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
      />
```

- [ ] **Step 2: Fix violation 2 — remove Cap label from Hero + add network to hero subtitle**

Find the Hero section (lines 257–266):

```tsx
          <section className="bg-adm-card px-6 py-5">
            <Cap>Asset</Cap>
            <p className="mt-1.5 font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {asset.assetNo || asset.code}
            </p>
            <div className="mt-2.5 flex items-center gap-2">
              <AdminBadge value={asset.status} />
              <span className="font-mono text-[10px] text-adm-t2">{asset.code} · {asset.type}</span>
            </div>
          </section>
```

Replace with:

```tsx
          <section className="bg-adm-card px-6 py-5">
            <p className="font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {asset.assetNo || asset.code}
            </p>
            <div className="mt-2.5 flex items-center gap-2">
              <AdminBadge value={asset.status} />
              <span className="font-mono text-[10px] text-adm-t2">
                {asset.code} · {asset.type}{asset.network ? ` · ${asset.network}` : ''}
              </span>
            </div>
          </section>
```

- [ ] **Step 3: Remove contractAddress from Details section**

Find the Details section grid (lines 269–277):

```tsx
          <section className="px-6 py-5">
            <Cap>Details</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Network" value={asset.network || '—'} />
              <InfoField label="Decimals" value={String(asset.decimals)} mono />
              <InfoField label="Contract Address" value={asset.contractAddress || '—'} mono />
              <InfoField label="Description" value={asset.description || '—'} />
            </div>
          </section>
```

Replace with:

```tsx
          <section className="px-6 py-5">
            <Cap>Asset Details</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Code" value={asset.code} mono />
              <InfoField label="Type" value={asset.type} />
              <InfoField label="Network" value={asset.network || '—'} />
              <InfoField label="Decimals" value={String(asset.decimals)} mono />
              <InfoField label="Description" value={asset.description || '—'} />
            </div>
          </section>
```

- [ ] **Step 4: Fix violations 4+5 — remove Audit section from main body**

Find the Audit section (lines 303–310):

```tsx
          {/* ⑤ Audit */}
          <section className="px-6 py-5">
            <Cap>Audit</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Created" value={fmt(asset.createdAt)} mono />
              <InfoField label="Updated" value={fmt(asset.updatedAt)} mono />
            </div>
          </section>
```

Delete this entire block.

- [ ] **Step 5: Fix violations 3+5 — replace sidebar Quick Reference with Identity + add Lifecycle block**

Find the sidebar Quick Reference block (lines 362–369):

```tsx
          {/* Quick Reference */}
          <SidebarGroup title="Quick Reference">
            <SidebarKV label="Asset No" value={asset.assetNo} mono />
            <SidebarKV label="Status" value={<AdminBadge value={asset.status} />} />
            <SidebarKV label="Type" value={asset.type} />
            <SidebarKV label="Code" value={asset.code} mono />
            <SidebarKV label="Asset ID" value={asset.id} mono />
          </SidebarGroup>
```

Replace with:

```tsx
          {/* Identity */}
          <SidebarGroup title="Identity">
            <SidebarKV label="Asset No" value={asset.assetNo} mono />
            <SidebarKV label="Status" value={<AdminBadge value={asset.status} />} />
            <SidebarKV label="Code" value={asset.code} mono />
            <SidebarKV label="Type" value={asset.type} />
          </SidebarGroup>

          {/* Lifecycle */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={fmt(asset.createdAt)} mono />
            <SidebarKV label="Updated" value={fmt(asset.updatedAt)} mono />
          </SidebarGroup>
```

- [ ] **Step 6: Remove contractAddress from interface**

Find in the `AssetDetailData` interface (line 18):

```tsx
  contractAddress?: string | null;
```

Delete this line.

- [ ] **Step 7: Verify build**

Run: `cd admin-web && npx tsc --noEmit`
Expected: zero errors in `AssetDetail.tsx`

- [ ] **Step 8: Commit**

```bash
git add admin-web/src/pages/AssetDetail.tsx
git commit -m "fix(admin): asset detail page spec compliance and remove contractAddress"
```

---

### Task 3: Remove contractAddress from AssetCreate.tsx

**Files:**
- Modify: `admin-web/src/pages/AssetCreate.tsx`

- [ ] **Step 1: Remove contractAddress from form state**

Find in the `formData` useState (line 34):

```tsx
    contractAddress: '',
```

Delete this line.

- [ ] **Step 2: Remove contractAddress from payload**

Find in the `handleSubmit` payload (line 65):

```tsx
      contractAddress: formData.contractAddress || undefined,
```

Delete this line.

- [ ] **Step 3: Remove contractAddress input field**

Find the contractAddress input block (lines 153–156):

```tsx
              <div className="col-span-2">
                <Label>Contract Address</Label>
                <input name="contractAddress" value={formData.contractAddress} onChange={handleChange} placeholder="0x..." className={`${fi} font-mono`} maxLength={128} />
              </div>
```

Delete this entire block.

- [ ] **Step 4: Verify build**

Run: `cd admin-web && npx tsc --noEmit`
Expected: zero errors in `AssetCreate.tsx`

- [ ] **Step 5: Commit**

```bash
git add admin-web/src/pages/AssetCreate.tsx
git commit -m "refactor(admin): remove contractAddress from asset create form"
```

---

### Task 4: Remove contractAddress from AssetEdit.tsx

**Files:**
- Modify: `admin-web/src/pages/AssetEdit.tsx`

- [ ] **Step 1: Remove contractAddress from AssetData interface**

Find in the `AssetData` interface (line 36):

```tsx
  contractAddress: string | null;
```

Delete this line.

- [ ] **Step 2: Remove contractAddress from form state**

Find in the `formData` useState (line 65):

```tsx
    contractAddress: '',
```

Delete this line.

- [ ] **Step 3: Remove contractAddress from data loading**

Find in the useEffect data loading (line 101):

```tsx
          contractAddress: data.contractAddress || '',
```

Delete this line.

- [ ] **Step 4: Remove contractAddress from submit payload**

Find in the `handleSubmit` body (line 143):

```tsx
            contractAddress: formData.contractAddress || undefined,
```

Delete this line.

- [ ] **Step 5: Remove contractAddress input field**

Find the contractAddress input block in the Metadata fieldset (lines 253–256):

```tsx
              <div className="col-span-2">
                <Label>Contract Address</Label>
                <input name="contractAddress" value={formData.contractAddress} onChange={handleChange} placeholder="0x..." className={`${fi} font-mono`} maxLength={128} />
              </div>
```

Delete this entire block.

- [ ] **Step 6: Verify build**

Run: `cd admin-web && npx tsc --noEmit`
Expected: zero errors in `AssetEdit.tsx`

- [ ] **Step 7: Commit**

```bash
git add admin-web/src/pages/AssetEdit.tsx
git commit -m "refactor(admin): remove contractAddress from asset edit form"
```
