# Fiat Bank Account Registration — Design Spec

## Goal

Allow customers to register bank accounts (IBAN-based) as fiat withdrawal addresses, reusing the existing `WithdrawalAddress` model and infrastructure.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data model | Extend `WithdrawalAddress` with nullable bank fields | Consistent with Wallet model pattern; same status machine; avoids parallel service/controller stack |
| Bank standard | IBAN only | Target region is Europe / Middle East |
| Cooling period | 24 hours, same as crypto | Consistent security policy |
| Ownership declaration | Required, same as crypto | Regulatory compliance |
| Max accounts per asset | 3 per fiat asset | Consistent with crypto limit |

---

## 1. Schema Changes

Extend the `WithdrawalAddress` Prisma model with three new nullable fields:

```
iban        String?   // International Bank Account Number
swiftBic    String?   // SWIFT/BIC code (8 or 11 chars)
bankName    String?   // Name of the bank
```

Existing fields reused for bank accounts:
- `label` → Account Label (optional nickname)
- `beneficiaryName` → Full legal name of account holder (required for bank)
- `addressType` → Value `BANK` (new, alongside existing `VASP` / `SELF_CUSTODY`)
- `status`, `activatesAt`, `activatedAt`, `suspendedAt`, `cancelledAt` → Same state machine
- `ownershipDeclaredAt`, `ownershipProofType` → Same declaration flow

Fields NOT used for bank accounts (remain null):
- `address` → Store IBAN here as the canonical "address" for uniqueness constraint
- `network` → Store `"FIAT"` as sentinel value
- `memo` → Not applicable
- `counterpartyVaspName`, `counterpartyVaspDid` → Not applicable (no travel rule for fiat)

**Uniqueness**: The existing unique constraint `(customerId, assetId, address)` works — IBAN goes into `address`, ensuring no duplicate IBAN per customer per asset.

**Migration**: One migration adding `iban`, `swiftBic`, `bankName` columns to `WithdrawalAddress`.

---

## 2. Backend Changes

### 2.1 DTO: `CreateBankAccountDto`

New DTO for fiat bank account registration:

```
assetId: string          // UUID, required
beneficiaryName: string  // required (unlike crypto where it's optional)
bankName: string         // required
iban: string             // required, validated format
swiftBic: string         // required, 8 or 11 chars
label?: string           // optional nickname
ownershipDeclaration: boolean  // must be true
```

### 2.2 IBAN / SWIFT Validation

Add `validateIban(iban: string)` and `validateSwiftBic(code: string)` to a new `bank-validator.util.ts`:

- **IBAN**: Length 15-34 chars, alphanumeric, starts with 2-letter country code + 2 check digits. Apply ISO 13616 mod-97 checksum validation.
- **SWIFT/BIC**: Exactly 8 or 11 alphanumeric characters. Pattern: 4 letters (bank) + 2 letters (country) + 2 alphanum (location) + optional 3 alphanum (branch).

### 2.3 Service Layer: `WithdrawalAddressService`

Extend existing service — NO new service class:

- Add `createBankAccount(data)` method alongside existing `create(data)`:
  - Validates IBAN format and SWIFT/BIC format
  - Checks 3-account-per-asset limit (same query, filter `status in [PENDING_ACTIVATION, ACTIVE]`)
  - Stores IBAN in both `address` field (for uniqueness) and `iban` field (for display)
  - Sets `network = "FIAT"`, `addressType = "BANK"`
  - Sets 24h cooling period via `activatesAt`
  - Returns created record with asset relation

### 2.4 Workflow Layer: `WithdrawalAddressWorkflowService`

Add `registerBankAccount(dto, customerId, customerNo)` method:

- Same pre-flight checks as `registerAddress`: customer approved, account active
- Asset validation: must exist, must be `ACTIVE`, must be `type === 'FIAT'`
- Calls `addressService.createBankAccount(...)`
- Records audit log with action `ADDRESS_REGISTERED`, metadata includes `{ addressType: 'BANK', iban: masked, bankName, assetCode }`
- No travel rule attribution (skip `trAdapter` call)

### 2.5 Controller: `WithdrawalAddressController` (Client API)

Add new endpoint in existing controller:

```
POST /client/withdrawal-addresses/bank-accounts
Body: CreateBankAccountDto
Response: WithdrawalAddress with asset relation
```

The existing `GET /client/withdrawal-addresses` already returns all addresses — the frontend filters by `addressType`.

### 2.6 Admin Controller

No new admin endpoints needed. The existing admin list/suspend/skip-cooling endpoints work for all address types since they operate on `addressNo`.

---

## 3. Frontend Changes

### 3.1 Bank Accounts Tab — List View

Replace the "Coming Soon" placeholder in the `bank` tab with:

- **Top bar**: "Registered Accounts (N/3)" + "+ Add Account" button (brass, disabled at limit)
- **Account cards**: Each card shows:
  - Account label (or masked IBAN if no label)
  - Asset code badge (e.g. `USD`)
  - Masked IBAN: `AE07 •••• •••• 8901` (first 4 + last 4 visible)
  - Bank name in smaller text
  - Status badge (Active / Cooling / Suspended)
  - Cooling countdown if `PENDING_ACTIVATION`
  - Chevron right → opens detail modal
- **Empty state**: Same pattern as crypto — icon + "No Bank Accounts Yet" + "Add Your First Account" button
- **Limit warning**: Same amber banner when 3/3 reached

**Data**: Filter `addresses` where `addressType === 'BANK'`.

### 3.2 Add Bank Account Modal

Fields (top to bottom):
1. **Asset** — Dropdown, only assets where `type === 'FIAT'`
2. **Beneficiary Name** — Text input, required, placeholder "Full legal name of account holder"
3. **Bank Name** — Text input, required, placeholder "e.g. Emirates NBD, HSBC"
4. **IBAN** — Mono text input, required, placeholder "AE07 0331 0000 1234 5678 901"
5. **SWIFT / BIC Code** — Mono text input, required, placeholder "EBILAEAD"
6. **Account Label** — Text input, optional, placeholder "e.g. My Savings, Business Account"
7. **Ownership Declaration** — Checkbox with brass border, same style as crypto

Footer: Cancel + Register Account buttons.

**Endpoint**: `POST /client/withdrawal-addresses/bank-accounts`

### 3.3 Detail Modal

Same modal pattern as crypto detail. Sections:

1. **Header**: Label (or "Account Details"), addressNo in mono, status badge
2. **Cooling countdown banner** (if PENDING_ACTIVATION)
3. **IBAN card**: Full IBAN with copy button, SWIFT/BIC below with divider
4. **Info grid (2×2)**: Asset, Bank, Beneficiary, Registered date
5. **Ownership Declared** section (sage green)
6. **Close button** footer

---

## 4. Asset Loading

The frontend currently loads only CRYPTO assets for the crypto tab. Changes:

- Load all assets once: `GET /assets?take=200`
- Split into `cryptoAssets = items.filter(a => a.type === 'CRYPTO')` and `fiatAssets = items.filter(a => a.type === 'FIAT')`
- Crypto tab form uses `cryptoAssets`, bank tab form uses `fiatAssets`

---

## 5. Address Filtering

The existing `GET /client/withdrawal-addresses` returns all types. The frontend handles filtering:

- Crypto tab: `addresses.filter(a => a.addressType !== 'BANK')`
- Bank tab: `addresses.filter(a => a.addressType === 'BANK')`

No backend changes to the list endpoint needed.

---

## 6. IBAN Masking

Display utility for masking IBAN in list view:

```typescript
function maskIban(iban: string): string {
  const clean = iban.replace(/\s/g, '');
  if (clean.length <= 8) return clean;
  return `${clean.slice(0, 4)} •••• •••• ${clean.slice(-4)}`;
}
```

Detail view shows full IBAN with copy button.

---

## 7. Files to Create / Modify

| Action | File |
|--------|------|
| Create | `prisma/migrations/YYYYMMDD_add_bank_account_fields/migration.sql` |
| Create | `src/.../withdrawal-addresses/dto/create-bank-account.dto.ts` |
| Create | `src/.../withdrawal-addresses/bank-validator.util.ts` |
| Modify | `prisma/schema.prisma` — add 3 fields to WithdrawalAddress |
| Modify | `src/.../withdrawal-addresses/withdrawal-address.service.ts` — add `createBankAccount()` |
| Modify | `src/.../withdrawal-addresses/withdrawal-address-workflow.service.ts` — add `registerBankAccount()` |
| Modify | `src/.../withdrawal-addresses/withdrawal-address.controller.ts` — add POST endpoint |
| Modify | `client-web/src/pages/WithdrawalAddresses.tsx` — implement bank tab |

---

## 8. Out of Scope

- Bank account verification / micro-deposit confirmation
- Non-IBAN account formats (routing number, sort code)
- Admin-specific bank account management UI (existing admin list/suspend works)
- Fiat withdrawal transaction flow (separate feature)
