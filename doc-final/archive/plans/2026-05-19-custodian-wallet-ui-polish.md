# Custodian Wallet UI Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce one-value-per-column in the list page and strict three-block sidebar in the detail page.

**Architecture:** Pure frontend edits to 2 React page components. List page: remove 3 sub-lines, split Asset→Asset+Network. Detail page: delete 2 sidebar groups, move their fields to the main body DETAILS section, fix backLabel. Single commit at end since changes are independent per file but small enough to batch.

**Tech Stack:** React + TypeScript (admin-web)

---

### Task 1: List page — eliminate dual-value columns

**Files:**
- Modify: `admin-web/src/pages/CustodianWalletList.tsx`

- [ ] **Step 1: Update column headers — add Network, adjust widths**

```tsx
// BEFORE (lines 253-263):
              {(
                [
                  ['Wallet No',  '160px'],
                  ['Role',       '100px'],
                  ['Owner',      '140px'],
                  ['Asset',      '100px'],
                  ['Balance',    '130px'],
                  ['Status',     '90px'],
                  ['Vault',      '110px'],
                  ['Updated',    '150px'],
                ] as [string, string][]

// AFTER:
              {(
                [
                  ['Wallet No',  '150px'],
                  ['Role',       '100px'],
                  ['Owner',      '140px'],
                  ['Asset',      '80px'],
                  ['Network',    '90px'],
                  ['Balance',    '130px'],
                  ['Status',     '90px'],
                  ['Vault',      '110px'],
                  ['Updated',    '150px'],
                ] as [string, string][]
```

- [ ] **Step 2: Update colSpan from 8 to 9 in loading and empty rows**

```tsx
// BEFORE (line 278):
                <td colSpan={8} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…

// AFTER:
                <td colSpan={9} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
```

```tsx
// BEFORE (line 285):
                <td colSpan={8} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No wallets found.

// AFTER:
                <td colSpan={9} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No wallets found.
```

- [ ] **Step 3: Wallet No column — remove type sub-line**

```tsx
// BEFORE (lines 299-304):
                  {/* Wallet No */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">
                      {w.walletNo || w.id.slice(0, 8)}
                    </span>
                    <div className="mt-0.5 font-mono text-[9px] text-adm-t3">{w.type}</div>
                  </td>

// AFTER:
                  {/* Wallet No */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">
                      {w.walletNo || w.id.slice(0, 8)}
                    </span>
                  </td>
```

- [ ] **Step 4: Owner column — remove ownerType sub-line**

```tsx
// BEFORE (lines 312-315):
                  {/* Owner */}
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-[11px] text-adm-t1">{ownerLabel}</div>
                    <div className="mt-0.5 font-mono text-[9px] text-adm-t3">{w.ownerType}</div>
                  </td>

// AFTER:
                  {/* Owner */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] text-adm-t1">{ownerLabel}</span>
                  </td>
```

- [ ] **Step 5: Asset column — keep code only, add separate Network column**

```tsx
// BEFORE (lines 318-321):
                  {/* Asset */}
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-[11px] text-adm-t1">{w.asset?.code || '—'}</div>
                    <div className="mt-0.5 font-mono text-[9px] text-adm-t3">{w.asset?.network || '—'}</div>
                  </td>

// AFTER:
                  {/* Asset */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] text-adm-t1">{w.asset?.code || '—'}</span>
                  </td>

                  {/* Network */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] text-adm-t2">{w.asset?.network || '—'}</span>
                  </td>
```

- [ ] **Step 6: Verify in browser**

Open `http://localhost:3501/dashboard/treasury/custodian-wallets` and confirm:
- 9 column headers visible
- Wallet No shows only the walletNo (no type sub-line)
- Owner shows only the owner label (no ownerType sub-line)
- Asset shows only the code
- Network is its own column
- Balance still shows "0.00 AED" (unchanged)

---

### Task 2: Detail page — strict three-block sidebar + backLabel

**Files:**
- Modify: `admin-web/src/pages/CustodianWalletDetail.tsx`

- [ ] **Step 1: Add backLabel to DetailPageHeader**

```tsx
// BEFORE (lines 290-294):
      <DetailPageHeader
        onBack={() => navigate('/dashboard/treasury/custodian-wallets')}
        onRefresh={() => void fetchWallet()}
        refreshing={loading}
      />

// AFTER:
      <DetailPageHeader
        backLabel="Custodian Wallets"
        onBack={() => navigate('/dashboard/treasury/custodian-wallets')}
        onRefresh={() => void fetchWallet()}
        refreshing={loading}
      />
```

- [ ] **Step 2: Add Vault ID, Custodian, and Approval Case to DETAILS section**

```tsx
// BEFORE (lines 331-341):
          {/* ② Details */}
          <section className="px-6 py-5">
            <Cap>Details</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Owner" value={ownerLabel} mono />
              <InfoField label="Owner Type" value={wallet.ownerType} />
              <InfoField label="Owner No" value={wallet.ownerNo} mono accent />
              <InfoField label="Direction" value={wallet.direction} />
              <InfoField label="Asset" value={wallet.asset.code} />
              <InfoField label="Network" value={wallet.asset.network || '—'} />
            </div>
          </section>

// AFTER:
          {/* ② Details */}
          <section className="px-6 py-5">
            <Cap>Details</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Owner" value={ownerLabel} mono />
              <InfoField label="Owner Type" value={wallet.ownerType} />
              <InfoField label="Owner No" value={wallet.ownerNo} mono accent />
              <InfoField label="Direction" value={wallet.direction} />
              <InfoField label="Asset" value={wallet.asset.code} />
              <InfoField label="Network" value={wallet.asset.network || '—'} />
              <InfoField label="Vault ID" value={wallet.vaultId} mono />
              <InfoField
                label="Custodian"
                value={wallet.type === 'FIAT_BANK' ? 'ZandBank' : 'HexTrust'}
              />
              {wallet.approvalCaseNo && (
                <InfoField
                  label="Approval Case"
                  value={
                    wallet.approvalCaseId ? (
                      <button
                        onClick={() => navigate(`/dashboard/control-gates/approvals/${wallet.approvalCaseId}`)}
                        className="font-mono text-[10px] text-adm-amber underline"
                      >
                        {wallet.approvalCaseNo}
                      </button>
                    ) : (
                      wallet.approvalCaseNo
                    )
                  }
                />
              )}
            </div>
          </section>
```

- [ ] **Step 3: Delete the Vault Info sidebar group**

```tsx
// DELETE (lines 492-496):
          {/* Vault Info */}
          <SidebarGroup title="Vault Info">
            <SidebarKV label="Vault ID" value={wallet.vaultId} mono />
            <SidebarKV label="Custodian" value={wallet.type === 'FIAT_BANK' ? 'ZandBank' : 'HexTrust'} />
          </SidebarGroup>
```

- [ ] **Step 4: Delete the Approval sidebar group**

```tsx
// DELETE (lines 498-517):
          {/* Approval Info */}
          {wallet.approvalCaseNo && (
            <SidebarGroup title="Approval">
              <SidebarKV
                label="Case No"
                value={
                  wallet.approvalCaseId ? (
                    <button
                      onClick={() => navigate(`/dashboard/control-gates/approvals/${wallet.approvalCaseId}`)}
                      className="font-mono text-[10px] text-adm-amber underline"
                    >
                      {wallet.approvalCaseNo}
                    </button>
                  ) : (
                    wallet.approvalCaseNo
                  )
                }
              />
            </SidebarGroup>
          )}
```

After deletion, sidebar should contain only: Actions (conditional) → Quick Reference → Lifecycle.

- [ ] **Step 5: Verify in browser**

Open `http://localhost:3501/dashboard/treasury/custodian-wallets/{any-wallet-id}` and confirm:
- Back button says "← Custodian Wallets" (not "← Back")
- Sidebar has exactly 3 groups: Actions, Quick Reference, Lifecycle
- No Vault Info or Approval groups in sidebar
- DETAILS section in main body shows: Owner, Owner Type, Owner No, Direction, Asset, Network, Vault ID, Custodian, and (conditionally) Approval Case
- Approval Case No is clickable, navigates to approval detail page

---

### Task 3: Commit

- [ ] **Step 1: Commit both files**

```bash
git add \
  admin-web/src/pages/CustodianWalletList.tsx \
  admin-web/src/pages/CustodianWalletDetail.tsx
git commit -m "fix(admin): enforce single-value columns in wallet list, strict 3-block sidebar in detail"
```
