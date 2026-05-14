# TB Manual Account Creation Workflow

## Goal

Provide an admin-operated manual entry point on the TB Account List page to create TigerBeetle accounts as a fallback/repair mechanism. Supports both system-level asset accounts (BANK, CUSTODY, TRADE_CLEARING, FEE_RECEIVABLE) and customer-level liability accounts (CLIENT_CREDIT, CLIENT_AUDIT). All manual creates are audit-logged.

## Context

Automatic TB account creation covers two scenarios (implemented separately):
- **Asset provision** creates 3 system accounts + batch customer accounts
- **Customer APPROVED** creates CLIENT_CREDIT + CLIENT_AUDIT per provisioned asset

This workflow handles the gap: when automatic creation fails or a special-case account is needed, an admin can manually create the missing account from the TB Account List page.

## Scope

- Backend: `POST /admin/tb/accounts` endpoint
- Frontend: "Create Account" button + modal on TB Account List page
- Audit logging for manual creates only
- No approval workflow (direct create)

---

## 1. Backend

### 1.1 Endpoint

`POST /admin/tb/accounts` on `TbAdminController`, guarded by `AuthGuard('jwt')` + `AdminPermissionGuard`.

### 1.2 Request DTO

```typescript
// dto/create-tb-account.dto.ts
class CreateTbAccountDto {
  accountCategory: 'SYSTEM' | 'CUSTOMER';  // determines ownerType and allowed codes
  assetCode: string;                         // must match a provisioned asset with tbLedgerId
  code: number;                              // TB account type code
  customerNo?: string;                       // required when accountCategory = 'CUSTOMER'
  description?: string;                      // optional note
}
```

### 1.3 Validation Rules

| Rule | Detail |
|------|--------|
| Asset must exist and be provisioned | `asset.tbLedgerId` must be non-null |
| Code must match category | SYSTEM: 1, 10, 110, 120. CUSTOMER: 100, 101 |
| Customer must exist and be APPROVED | Only when `accountCategory = 'CUSTOMER'`; lookup by `customerNo` |
| No duplicate | TbAccountRegistry unique constraint `@@unique([code, ledger, ownerType, ownerUuid])` prevents doubles. Service checks before calling TB to provide a clear error message |

### 1.4 Service Method

Add `manualCreateAccount()` to `AccountingService`:

```
Input: { accountCategory, assetCode, code, customerNo?, description? }
       + actorId, actorNo (from JWT)

Steps:
1. Load asset by assetCode, verify tbLedgerId exists
2. If CUSTOMER: load customer by customerNo, verify approvalStatus = 'APPROVED'
3. Check TbAccountRegistry for existing entry (code + ledger + ownerType + ownerUuid)
   → if exists, throw ConflictException
4. Derive params:
   - ledger = asset.tbLedgerId
   - ownerType = accountCategory === 'SYSTEM' ? 'SYSTEM' : 'CUSTOMER'
   - ownerUuid = accountCategory === 'CUSTOMER' ? customer.id : null
   - ownerNo = accountCategory === 'CUSTOMER' ? customer.customerNo : null
   - flags: derive from code using same logic as asset provisioning:
     - CLIENT_CREDIT(100): `AccountFlags.debits_must_not_exceed_credits`
     - FEE_RECEIVABLE(120): `AccountFlags.credits_must_not_exceed_debits`
     - All others: 0
5. Call accountingService.createAccounts([params])
6. Write audit log via AuditLogsService.recordByActor()
7. Return created registry entry
```

### 1.5 Audit Log

| Field | Value |
|-------|-------|
| action | `MANUAL_TB_ACCOUNT_CREATED` |
| entityType | `TB_ACCOUNT` |
| workflowType | `TB_ACCOUNT_MANUAL_CREATE` |
| result | `SUCCESS` or `FAILED` |
| metadata | `{ accountCategory, assetCode, code, codeName, customerNo?, tbAccountId }` |
| actorType | `ADMIN` |

New constants to add:
- `AuditActions.MANUAL_TB_ACCOUNT_CREATED`
- `AuditEntityTypes.TB_ACCOUNT`
- `AuditBusinessWorkflowTypes.TB_ACCOUNT_MANUAL_CREATE`

---

## 2. Frontend

### 2.1 Entry Point

TB Account List page (`TbAccountList.tsx`): add a "Create Account" button in the `PageTitleBar` next to the existing Refresh button.

### 2.2 Create Modal

Overlay modal with the following form fields:

| Field | Type | Behavior |
|-------|------|----------|
| Account Category | Radio: "System Account" / "Customer Account" | Toggles which code options and customer field visibility |
| Asset | Dropdown | Lists all provisioned assets (fetched from `/admin/assets?status=ACTIVE` or similar) |
| Account Type | Dropdown | SYSTEM: BANK(1), CUSTODY(10), TRADE_CLEARING(110), FEE_RECEIVABLE(120). CUSTOMER: CLIENT_CREDIT(100), CLIENT_AUDIT(101) |
| Customer No | Text input | Only visible when "Customer Account" selected. Input customerNo to identify the customer |
| Description | Text input (optional) | Free text note |

### 2.3 Form Behavior

- Switching Account Category resets Account Type dropdown to appropriate options
- Submit button disabled until all required fields filled
- On submit: `POST /admin/tb/accounts` with the form data
- Success: close modal, show success toast, refresh account list
- Error: display error message inline (duplicate, customer not found, asset not provisioned, etc.)

### 2.4 Styling

Follow existing admin design system:
- Modal overlay with `bg-adm-bg` background
- `border-adm-border` borders
- `font-mono text-[11px]` for inputs
- `adminButtonClass('listPrimary')` for submit
- Same input styling as filter bar: `fi` class pattern

---

## 3. Data Flow

```
Admin clicks "Create Account"
  → Modal opens
  → Fills form (category, asset, code, customerNo?)
  → Submits
  → POST /admin/tb/accounts
    → Validate asset (provisioned?)
    → Validate customer (APPROVED?) if customer category
    → Check registry for duplicate
    → Create TB account via TigerBeetleService
    → Register in TbAccountRegistry
    → Write audit log
    → Return registry entry
  → Modal closes, list refreshes
```

---

## 4. Error Handling

| Error | HTTP Status | Message |
|-------|-------------|---------|
| Asset not found or not provisioned | 400 | "Asset '{code}' is not provisioned for TigerBeetle" |
| Invalid code for category | 400 | "Account code {code} is not valid for {category} accounts" |
| Customer not found | 404 | "Customer '{customerNo}' not found" |
| Customer not APPROVED | 400 | "Customer '{customerNo}' is not in APPROVED status" |
| Duplicate account | 409 | "TB account already exists for this combination" |
| TB unavailable | 503 | "TigerBeetle service is currently unavailable" |

---

## 5. Non-Goals

- No approval workflow for manual creation (direct admin action)
- No batch creation UI (one account at a time)
- Automatic creation on customer APPROVED (separate workflow)
- Automatic creation on asset provision (separate workflow)
